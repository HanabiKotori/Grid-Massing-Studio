import { isFurnitureKind } from './infra'
import { pointInPolygon } from './polygon'
import type { Booth, Infra, InfraKind, Pt } from './types'

/** 旋转后的矩形角点（Three 的 Y 轴旋转约定） */
export function infraCorners(
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation: number,
): Pt[] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const hw = width / 2
  const hd = depth / 2
  return [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ].map((c) => ({ x: x + c.x * cos + c.z * sin, z: z - c.x * sin + c.z * cos }))
}

/** 两个旋转矩形是否相交（分离轴定理） */
export function obbOverlap(
  ax: number,
  az: number,
  aw: number,
  ad: number,
  arot: number,
  bx: number,
  bz: number,
  bw: number,
  bd: number,
  brot: number,
): boolean {
  const axes = [
    { x: Math.cos(arot), z: -Math.sin(arot) },
    { x: Math.sin(arot), z: Math.cos(arot) },
    { x: Math.cos(brot), z: -Math.sin(brot) },
    { x: Math.sin(brot), z: Math.cos(brot) },
  ]
  const dx = bx - ax
  const dz = bz - az

  for (const axis of axes) {
    const ra =
      Math.abs(axis.x * Math.cos(arot) - axis.z * Math.sin(arot)) * (aw / 2) +
      Math.abs(axis.x * Math.sin(arot) + axis.z * Math.cos(arot)) * (ad / 2)
    const rb =
      Math.abs(axis.x * Math.cos(brot) - axis.z * Math.sin(brot)) * (bw / 2) +
      Math.abs(axis.x * Math.sin(brot) + axis.z * Math.cos(brot)) * (bd / 2)
    if (Math.abs(axis.x * dx + axis.z * dz) > ra + rb - 0.02) return false
  }
  return true
}

/** 点所在的展台 */
export function boothAtPoint(booths: Booth[], p: Pt): Booth | null {
  for (const b of booths) {
    if (b.points.length >= 3 && pointInPolygon(p, b.points)) return b
  }
  return null
}

/** 家具是否完整落在指定轮廓内（中心与四个角点都需在馆内） */
export function furnitureInsidePolygon(
  points: Pt[],
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation: number,
): boolean {
  const samples = [{ x, z }, ...infraCorners(x, z, width, depth, rotation)]
  return samples.every((p) => pointInPolygon(p, points))
}

/** 家具是否完整落在同一个展台内部 */
export function furnitureInsideBooth(
  booths: Booth[],
  kind: InfraKind,
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation: number,
): boolean {
  if (!isFurnitureKind(kind)) return true
  const host = boothAtPoint(booths, { x, z })
  return host
    ? furnitureInsidePolygon(host.points, x, z, width, depth, rotation)
    : false
}

/** 判断两个贴墙设施是否在同一条墙线上并发生长度重叠 */
export function wallRunOverlap(
  a: { x: number; z: number; width: number; rotation: number },
  b: { x: number; z: number; width: number; rotation: number },
): boolean {
  if (Math.abs(Math.sin(a.rotation - b.rotation)) > 0.2) return false
  const ux = Math.cos(a.rotation)
  const uz = -Math.sin(a.rotation)
  const vx = Math.sin(a.rotation)
  const vz = Math.cos(a.rotation)
  const dx = b.x - a.x
  const dz = b.z - a.z
  const along = dx * ux + dz * uz
  const perp = dx * vx + dz * vz
  return (
    Math.abs(perp) <= 0.6 &&
    Math.abs(along) < (a.width + b.width) / 2 - 0.02
  )
}

export function gateWindowConflict(
  infras: Infra[],
  x: number,
  z: number,
  width: number,
  rotation: number,
  ignoreId?: string,
): boolean {
  const candidate = { x, z, width, rotation }
  return infras.some(
    (it) =>
      it.id !== ignoreId &&
      it.kind === 'gate' &&
      wallRunOverlap(candidate, it),
  )
}

export function windowGateConflict(
  infras: Infra[],
  x: number,
  z: number,
  width: number,
  rotation: number,
  ignoreId?: string,
): boolean {
  const candidate = { x, z, width, rotation }
  return infras.some(
    (it) =>
      it.id !== ignoreId &&
      it.kind === 'window' &&
      wallRunOverlap(candidate, it),
  )
}

/** 基础设施旋转后的轴对齐包围盒 */
export function infraAabb(
  it: Pick<Infra, 'x' | 'z' | 'width' | 'depth' | 'rotation'>,
) {
  const points = [
    { x: it.x, z: it.z },
    ...infraCorners(it.x, it.z, it.width, it.depth, it.rotation),
  ]
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  }
}

function intervalGap(aMin: number, aMax: number, bMin: number, bMax: number) {
  return Math.max(0, bMin - aMax, aMin - bMax)
}

/** 两个设施是否贴边相邻；多选时至少要与已选组内一个设施接触 */
export function infraTouching(
  a: Pick<Infra, 'x' | 'z' | 'width' | 'depth' | 'rotation'>,
  b: Pick<Infra, 'x' | 'z' | 'width' | 'depth' | 'rotation'>,
): boolean {
  const A = infraAabb(a)
  const B = infraAabb(b)
  return (
    intervalGap(A.minX, A.maxX, B.minX, B.maxX) <= 0.08 &&
    intervalGap(A.minZ, A.maxZ, B.minZ, B.maxZ) <= 0.08
  )
}

/** 多选设施是否通过贴边关系连成一整组 */
export function infraIdsConnected(infras: Infra[], ids: string[]): boolean {
  if (ids.length < 2) return true
  const set = new Set(ids)
  const byId = new Map(infras.map((it) => [it.id, it]))
  const start = byId.get(ids[0])
  if (!start) return false
  const visited = new Set<string>([start.id])
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()!
    for (const id of set) {
      if (visited.has(id)) continue
      const other = byId.get(id)
      if (!other || !infraTouching(current, other)) continue
      visited.add(id)
      queue.push(other)
    }
  }
  return visited.size === ids.length
}

/** 设施落地时不与展台、其他设施重叠；gate 由墙体吸附单独处理 */
export function infraSpotFree(
  infras: Infra[],
  booths: Booth[],
  x: number,
  z: number,
  spec: Pick<Infra, 'kind' | 'width' | 'depth' | 'rotation'>,
  ignoreId?: string | Set<string>,
): boolean {
  if (spec.kind === 'gate') return true
  const ignoreIds =
    typeof ignoreId === 'string' ? new Set([ignoreId]) : ignoreId

  const furniture = isFurnitureKind(spec.kind)
  const cos = Math.cos(spec.rotation)
  const sin = Math.sin(spec.rotation)
  // 贴边接触时允许 1.5 cm 的边界误差，但不允许真实重叠
  const edgeEps = 0.015
  const boothSamples = [
    { x, z },
    ...infraCorners(
      x,
      z,
      Math.max(0.02, spec.width - edgeEps * 2),
      Math.max(0.02, spec.depth - edgeEps * 2),
      spec.rotation,
    ),
  ]

  // 家具本就位于展台内部，跳过与展台的互斥检查
  if (!furniture) {
    for (const b of booths) {
      if (boothSamples.some((p) => pointInPolygon(p, b.points))) return false
      // 展台顶点落在设施内部（设施覆盖展台的情况）
      for (const p of b.points) {
        const dx = p.x - x
        const dz = p.z - z
        const lx = dx * cos - dz * sin
        const lz = dx * sin + dz * cos
        if (
          Math.abs(lx) <= Math.max(0, spec.width / 2 - edgeEps) &&
          Math.abs(lz) <= Math.max(0, spec.depth / 2 - edgeEps)
        ) {
          return false
        }
      }
    }
  }

  for (const it of infras) {
    if (ignoreIds?.has(it.id) || it.kind === 'gate') continue
    // 墙面之间允许连接/交叉
    if (spec.kind === 'wall' && it.kind === 'wall') continue
    if (
      obbOverlap(
        x,
        z,
        spec.width,
        spec.depth,
        spec.rotation,
        it.x,
        it.z,
        it.width,
        it.depth,
        it.rotation,
      )
    ) {
      return false
    }
  }
  return true
}
