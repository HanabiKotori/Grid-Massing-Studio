import type { Booth, Infra, Pt, Venue } from './types'
import { BOOTH_KIND_LABELS, boothKindOf } from './booth'
import { boundsOf, centroid, pointInPolygon, polygonArea } from './polygon'

/** 路径与展台 / 设施保持的安全距离（米） */
const CLEARANCE = 0.7
/** 单次寻路最多展开的网格数，避免异常场景卡死 */
const MAX_EXPAND = 80000

/** 巡游 UI 展示的展台信息 */
export interface WalkTourStopInfo {
  boothId: string
  name: string
  exhibitor?: string
  /** 纯 base64 Logo；没有上传时为空 */
  logo?: string
  area: number
  kindLabel: string
}

export interface WalkTourInfo {
  /** 正在参观的展台；行进中为 null */
  current: WalkTourStopInfo | null
  /** 下一站；没有下一站时为 null */
  next: WalkTourStopInfo | null
}

export interface WalkTourStop extends WalkTourStopInfo {
  lookAt: Pt
}

/** 去掉 lookAt 等路径内部字段，只保留 UI 需要的信息 */
export function walkTourStopInfo(stop: WalkTourStop): WalkTourStopInfo {
  return {
    boothId: stop.boothId,
    name: stop.name,
    exhibitor: stop.exhibitor,
    logo: stop.logo,
    area: stop.area,
    kindLabel: stop.kindLabel,
  }
}

export interface WalkTourPoint extends Pt {
  stop?: WalkTourStop
}

export interface WalkTourRoute {
  points: WalkTourPoint[]
  /** 最后一个展台停留点的下标；单次巡游到这里结束 */
  lastStopIndex: number
}

interface BuildOptions {
  venue: Venue
  /** 场馆内圈轮廓（已扣除墙厚和安全距离） */
  inner: Pt[]
  booths: Booth[]
  infras: Infra[]
  start: Pt
  gridHalf: number
}

function distPointSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.z - a.z)
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

function distToPolygon(p: Pt, poly: Pt[]): number {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, distPointSegment(p, poly[i], poly[(i + 1) % poly.length]))
  }
  return d
}

function nearPolygon(p: Pt, poly: Pt[], pad: number): boolean {
  if (pointInPolygon(p, poly)) return true
  return distToPolygon(p, poly) <= pad
}

interface Grid {
  minX: number
  minZ: number
  w: number
  h: number
  free: Uint8Array
}

function makeGrid(opts: BuildOptions): Grid | null {
  const b = boundsOf(opts.inner)
  const minX = Math.max(-opts.gridHalf, Math.floor(b.minX))
  const minZ = Math.max(-opts.gridHalf, Math.floor(b.minZ))
  const maxX = Math.min(opts.gridHalf, Math.ceil(b.maxX))
  const maxZ = Math.min(opts.gridHalf, Math.ceil(b.maxZ))
  const w = Math.floor(maxX - minX)
  const h = Math.floor(maxZ - minZ)
  if (w < 2 || h < 2) return null

  const free = new Uint8Array(w * h).fill(1)
  const idx = (ix: number, iz: number) => iz * w + ix
  const center = (ix: number, iz: number): Pt => ({
    x: minX + ix + 0.5,
    z: minZ + iz + 0.5,
  })

  // 场馆内圈之外不可走
  for (let iz = 0; iz < h; iz++) {
    for (let ix = 0; ix < w; ix++) {
      if (!pointInPolygon(center(ix, iz), opts.inner)) free[idx(ix, iz)] = 0
    }
  }

  const markPolygon = (poly: Pt[], pad: number) => {
    if (poly.length < 3) return
    const pb = boundsOf(poly)
    const x0 = Math.max(0, Math.floor(pb.minX - pad - minX))
    const x1 = Math.min(w - 1, Math.ceil(pb.maxX + pad - minX))
    const z0 = Math.max(0, Math.floor(pb.minZ - pad - minZ))
    const z1 = Math.min(h - 1, Math.ceil(pb.maxZ + pad - minZ))
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const i = idx(ix, iz)
        if (!free[i]) continue
        if (nearPolygon(center(ix, iz), poly, pad)) free[i] = 0
      }
    }
  }

  for (const booth of opts.booths) markPolygon(booth.points, CLEARANCE)

  for (const infra of opts.infras) {
    const cos = Math.cos(infra.rotation)
    const sin = Math.sin(infra.rotation)
    const ex = (Math.abs(cos) * infra.width + Math.abs(sin) * infra.depth) / 2 + CLEARANCE
    const ez = (Math.abs(sin) * infra.width + Math.abs(cos) * infra.depth) / 2 + CLEARANCE
    const x0 = Math.max(0, Math.floor(infra.x - ex - minX))
    const x1 = Math.min(w - 1, Math.ceil(infra.x + ex - minX))
    const z0 = Math.max(0, Math.floor(infra.z - ez - minZ))
    const z1 = Math.min(h - 1, Math.ceil(infra.z + ez - minZ))
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const i = idx(ix, iz)
        if (!free[i]) continue
        const p = center(ix, iz)
        const dx = p.x - infra.x
        const dz = p.z - infra.z
        const lx = dx * cos - dz * sin
        const lz = dx * sin + dz * cos
        if (
          Math.abs(lx) <= infra.width / 2 + CLEARANCE &&
          Math.abs(lz) <= infra.depth / 2 + CLEARANCE
        ) {
          free[i] = 0
        }
      }
    }
  }

  return { minX, minZ, w, h, free }
}

function cellIndex(grid: Grid, ix: number, iz: number): number {
  if (ix < 0 || iz < 0 || ix >= grid.w || iz >= grid.h) return -1
  return iz * grid.w + ix
}

function cellOfPoint(grid: Grid, p: Pt): { ix: number; iz: number } | null {
  const ix = Math.floor(p.x - grid.minX)
  const iz = Math.floor(p.z - grid.minZ)
  if (ix < 0 || iz < 0 || ix >= grid.w || iz >= grid.h) return null
  return { ix, iz }
}

function cellCenter(grid: Grid, i: number): Pt {
  const ix = i % grid.w
  const iz = Math.floor(i / grid.w)
  return { x: grid.minX + ix + 0.5, z: grid.minZ + iz + 0.5 }
}

function nearestFreeCell(grid: Grid, p: Pt, maxRing = 10): number {
  const c = cellOfPoint(grid, p)
  if (!c) return -1
  const start = cellIndex(grid, c.ix, c.iz)
  if (start >= 0 && grid.free[start]) return start
  for (let r = 1; r <= maxRing; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const i = cellIndex(grid, c.ix + dx, c.iz + dz)
        if (i >= 0 && grid.free[i]) return i
      }
    }
  }
  return -1
}

class MinHeap {
  private ids: number[] = []
  private scores: number[] = []

  get size() {
    return this.ids.length
  }

  push(id: number, score: number) {
    this.ids.push(id)
    this.scores.push(score)
    let i = this.ids.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.scores[p] <= this.scores[i]) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const id = this.ids[0]
    const lastId = this.ids.pop()!
    const lastScore = this.scores.pop()!
    if (this.ids.length) {
      this.ids[0] = lastId
      this.scores[0] = lastScore
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.ids.length && this.scores[l] < this.scores[m]) m = l
        if (r < this.ids.length && this.scores[r] < this.scores[m]) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return id
  }

  private swap(a: number, b: number) {
    ;[this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]]
    ;[this.scores[a], this.scores[b]] = [this.scores[b], this.scores[a]]
  }
}

function astar(grid: Grid, startIdx: number, goalIdx: number): Pt[] | null {
  if (startIdx < 0 || goalIdx < 0) return null
  if (!grid.free[startIdx] || !grid.free[goalIdx]) return null
  const n = grid.w * grid.h
  const g = new Float32Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const gx = goalIdx % grid.w
  const gz = Math.floor(goalIdx / grid.w)
  const h = (i: number) => {
    const x = i % grid.w
    const z = Math.floor(i / grid.w)
    const dx = Math.abs(x - gx)
    const dz = Math.abs(z - gz)
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
  }

  const heap = new MinHeap()
  g[startIdx] = 0
  heap.push(startIdx, h(startIdx))
  let expanded = 0

  while (heap.size && expanded++ < MAX_EXPAND) {
    const cur = heap.pop()
    if (closed[cur]) continue
    if (cur === goalIdx) {
      const path: Pt[] = []
      let i = cur
      while (i >= 0) {
        path.push(cellCenter(grid, i))
        i = came[i]
      }
      path.reverse()
      return path
    }
    closed[cur] = 1
    const cx = cur % grid.w
    const cz = Math.floor(cur / grid.w)

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue
        const nx = cx + dx
        const nz = cz + dz
        const ni = cellIndex(grid, nx, nz)
        if (ni < 0 || !grid.free[ni] || closed[ni]) continue
        // 斜向移动不能穿过两个被阻挡的正交格
        if (dx && dz) {
          const a = cellIndex(grid, cx + dx, cz)
          const b = cellIndex(grid, cx, cz + dz)
          if (a < 0 || b < 0 || !grid.free[a] || !grid.free[b]) continue
        }
        const cost = dx && dz ? Math.SQRT2 : 1
        const ng = g[cur] + cost
        if (ng + 1e-6 >= g[ni]) continue
        g[ni] = ng
        came[ni] = cur
        heap.push(ni, ng + h(ni))
      }
    }
  }
  return null
}

function clearSegment(grid: Grid, a: Pt, b: Pt): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(1, Math.ceil(d / 0.35))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
    const c = cellOfPoint(grid, p)
    if (!c) return false
    const idx = cellIndex(grid, c.ix, c.iz)
    if (idx < 0 || !grid.free[idx]) return false
  }
  return true
}

/** 拉直路径，保留最后一个点；遇到不可直连就保留拐点 */
function simplify(grid: Grid, points: Pt[]): Pt[] {
  if (points.length <= 2) return points
  const out: Pt[] = [points[0]]
  let i = 0
  while (i < points.length - 1) {
    let j = points.length - 1
    for (; j > i + 1; j--) {
      if (clearSegment(grid, points[i], points[j])) break
    }
    out.push(points[j])
    i = j
  }
  return out
}

function findBoothStop(grid: Grid, booth: Booth): Pt | null {
  const c = centroid(booth.points)
  const b = boundsOf(booth.points)

  const scan = (minD: number, maxD: number, targetD: number) => {
    let best: { p: Pt; score: number } | null = null
    for (let iz = 0; iz < grid.h; iz++) {
      const z = grid.minZ + iz + 0.5
      if (z < b.minZ - 7 || z > b.maxZ + 7) continue
      for (let ix = 0; ix < grid.w; ix++) {
        const i = iz * grid.w + ix
        if (!grid.free[i]) continue
        const x = grid.minX + ix + 0.5
        if (x < b.minX - 7 || x > b.maxX + 7) continue
        const p = { x, z }
        const d = distToPolygon(p, booth.points)
        if (d < minD || d > maxD) continue
        const score = Math.abs(d - targetD) + Math.hypot(p.x - c.x, p.z - c.z) * 0.03
        if (!best || score < best.score) best = { p, score }
      }
    }
    return best?.p ?? null
  }

  // 优先选择离展台边缘约 4.6 m 的通道位置；拥挤场景退回近距离停留点
  return scan(2.2, 7, 4.6) ?? scan(1, 2.2, 1.8)
}

interface PlannedStop {
  pt: Pt
  booth: Booth
  lookAt: Pt
}

/**
 * 自动巡游路径：
 * 1. 在场馆内部按 1 m 网格寻路，展台 / 设施外扩安全距离后作为障碍；
 * 2. 为每个展台在通道侧找一个停留点，按最近邻顺序拜访；
 * 3. 相邻停留点之间用 A* 生成路径，再做直线拉平；
 * 4. 末尾额外生成回到起点的路径，循环开启时可无缝循环。
 */
export function buildWalkTour(opts: BuildOptions): WalkTourRoute | null {
  if (opts.venue.points.length < 3 || opts.inner.length < 3) return null
  const grid = makeGrid(opts)
  if (!grid) return null

  const start: Pt = { ...opts.start }
  const startCell = nearestFreeCell(grid, start)
  if (startCell < 0) return null
  const startPoint = cellCenter(grid, startCell)
  // 起点必须位于可通行区域，否则先提示玩家走到通道
  if (!clearSegment(grid, start, startPoint)) return null

  const stops: PlannedStop[] = []
  for (const booth of opts.booths) {
    if (booth.points.length < 3) continue
    const pt = findBoothStop(grid, booth)
    if (!pt) continue
    if (stops.some((s) => Math.hypot(s.pt.x - pt.x, s.pt.z - pt.z) < 0.8)) continue
    stops.push({ pt, booth, lookAt: centroid(booth.points) })
  }
  if (!stops.length) return null

  // 最近邻排序，减少来回穿行
  const ordered: PlannedStop[] = []
  const left = [...stops]
  let cursor = start
  while (left.length) {
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < left.length; i++) {
      const d = Math.hypot(left[i].pt.x - cursor.x, left[i].pt.z - cursor.z)
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    const next = left.splice(bi, 1)[0]
    ordered.push(next)
    cursor = next.pt
  }

  const points: WalkTourPoint[] = [{ x: start.x, z: start.z }]
  let current = start
  let lastStopIndex = 0

  const legFrom = (from: Pt, raw: Pt[]) => {
    const input: Pt[] = [{ ...from }]
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i]
      if (i === 0 && Math.hypot(p.x - from.x, p.z - from.z) < 0.05) continue
      input.push(p)
    }
    return simplify(grid, input)
  }

  for (const stop of ordered) {
    const fromIdx = nearestFreeCell(grid, current)
    const toIdx = nearestFreeCell(grid, stop.pt)
    if (fromIdx < 0 || toIdx < 0) continue
    const raw = astar(grid, fromIdx, toIdx)
    if (!raw || raw.length < 2) continue
    const leg = legFrom(current, raw)
    if (leg.length < 2) continue
    // 终点用展台停留点覆盖，保证停留位置准确
    leg[leg.length - 1] = { ...stop.pt }
    for (let i = 1; i < leg.length; i++) points.push({ ...leg[i] })
    lastStopIndex = points.length - 1
    points[lastStopIndex].stop = {
      boothId: stop.booth.id,
      name: stop.booth.name,
      exhibitor: stop.booth.exhibitor,
      logo: stop.booth.logo,
      area: polygonArea(stop.booth.points),
      kindLabel: BOOTH_KIND_LABELS[boothKindOf(stop.booth)],
      lookAt: { ...stop.lookAt },
    }
    current = stop.pt
  }

  if (points.length < 2 || lastStopIndex === 0) return null

  // 回到起点：即使当前设置为单次，也先准备好闭环路径，循环开关切换时无需重算
  const backIdx = nearestFreeCell(grid, start)
  const fromIdx = nearestFreeCell(grid, current)
  if (backIdx >= 0 && fromIdx >= 0) {
    const raw = astar(grid, fromIdx, backIdx)
    if (raw && raw.length >= 2) {
      const leg = legFrom(current, raw)
      if (leg.length >= 2) {
        leg[leg.length - 1] = { x: start.x, z: start.z }
        for (let i = 1; i < leg.length; i++) points.push({ ...leg[i] })
      }
    }
  }

  return { points, lastStopIndex }
}
