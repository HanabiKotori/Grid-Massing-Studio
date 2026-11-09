import { computed, ref, type Ref, type ShallowRef } from 'vue'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import {
  BOOTH_DEFAULT_HEIGHT,
  BOOTH_KIND_LABELS,
  OPEN_FLOOR_HEIGHT,
  boothKindOf,
} from '../core/booth'
import { isFurnitureKind } from '../core/infra'
import {
  boothAtPoint,
  furnitureInsidePolygon,
  infraTouching,
} from '../core/infraGeometry'
import {
  boundsOf,
  centroid,
  pointInPolygon,
  polygonArea,
  polygonInsidePolygon,
} from '../core/polygon'
import type {
  Booth,
  BoothKind,
  BoothMark,
  EditorMode,
  Infra,
  Pt,
  Venue,
} from '../core/types'

interface SceneOperationsOptions {
  venue: ShallowRef<Venue | null>
  booths: ShallowRef<Booth[]>
  infras: ShallowRef<Infra[]>
  selectedIds: ShallowRef<string[]>
  selectedInfraIds: ShallowRef<string[]>
  selectedInfraId: Ref<string | null>
  skipRevealBoothId: Ref<string | null>
  skipRevealInfraId: Ref<string | null>
  mode: Ref<EditorMode>
  draftPoints: ShallowRef<Pt[]>
  venueNoTop: Ref<boolean>
  toast: (text: string) => void
  venueInner: () => Pt[] | null
}

export function useSceneOperations(options: SceneOperationsOptions) {
  const { venue, booths, infras, selectedIds, selectedInfraIds } = options
  let groupSeq = 0
  const mergeDialog = ref<null | {
    ids: string[]
    heights: number[]
    targetId: string
    targetName: string
    targetHeight: number
  }>(null)

  const activeBoothId = computed(
    () => selectedIds.value[selectedIds.value.length - 1] ?? null,
  )

  const hasGroupInSelection = computed(() =>
    booths.value.some(
      (b) => selectedIds.value.includes(b.id) && !!b.groupId,
    ),
  )

  const selectionIsOneGroup = computed(() => {
    const list = booths.value.filter((b) => selectedIds.value.includes(b.id))
    if (list.length < 2) return false
    const gid = list[0].groupId
    if (!gid || list.some((b) => b.groupId !== gid)) return false
    return (
      booths.value.filter((b) => b.groupId === gid).length === list.length
    )
  })

  function nextGroupId() {
    groupSeq += 1
    return `g${groupSeq}`
  }

  function cleanupGroups(list: Booth[]): Booth[] {
    const counts = new Map<string, number>()
    for (const b of list) {
      if (b.groupId) counts.set(b.groupId, (counts.get(b.groupId) ?? 0) + 1)
    }
    return list.map((b) =>
      b.groupId && (counts.get(b.groupId) ?? 0) < 2
        ? { ...b, groupId: undefined }
        : b,
    )
  }

  /** 同组成员 id（含自身） */
  function groupIdsOf(id: string): string[] {
    const spec = booths.value.find((b) => b.id === id)
    if (spec?.groupId) {
      const members = booths.value
        .filter((b) => b.groupId === spec.groupId)
        .map((b) => b.id)
      if (members.length > 1) return members
    }
    return [id]
  }

  function setInfraSelection(ids: string[]) {
    let valid = [...new Set(ids)].filter((id) =>
      infras.value.some((it) => it.id === id),
    )
    // 删除或取消中间设施后若剩余对象断开，只保留最后选中的一个
    if (valid.length > 1) {
      const set = new Set(valid)
      const byId = new Map(infras.value.map((it) => [it.id, it]))
      const start = byId.get(valid[0])
      const visited = new Set<string>(start ? [start.id] : [])
      const queue = start ? [start] : []
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
      if (visited.size !== valid.length) {
        valid = [valid[valid.length - 1]]
      }
    }
    selectedInfraIds.value = valid
    options.selectedInfraId.value = valid[valid.length - 1] ?? null
  }

  function clearInfraSelection() {
    selectedInfraIds.value = []
    options.selectedInfraId.value = null
  }

  function handlePick(
    id: string | null,
    additive = false,
    kind: 'booth' | 'infra' = 'booth',
  ) {
    if (kind === 'infra') {
      options.skipRevealInfraId.value = null
      selectedIds.value = []
      if (!id) {
        if (!additive) clearInfraSelection()
        return
      }
      const target = infras.value.find((it) => it.id === id)
      if (!target) return
      const current = selectedInfraIds.value
      if (additive) {
        if (current.includes(id)) {
          setInfraSelection(current.filter((x) => x !== id))
          return
        }
        const wallItem =
          target.kind === 'gate' ||
          target.kind === 'window' ||
          current.some((x) => {
            const it = infras.value.find((v) => v.id === x)
            return it?.kind === 'gate' || it?.kind === 'window'
          })
        if (current.length && wallItem) {
          options.toast('门窗只能单独选择')
          return
        }
        const touches = current.some((x) => {
          const it = infras.value.find((v) => v.id === x)
          return it ? infraTouching(target, it) : false
        })
        if (current.length && !touches) {
          options.toast('多选的设施必须相互挨着')
          return
        }
        setInfraSelection([...current, id])
        return
      }
      if (current.includes(id)) {
        options.selectedInfraId.value = id
        return
      }
      setInfraSelection([id])
      return
    }

    options.skipRevealBoothId.value = null
    clearInfraSelection()
    if (!id) {
      if (!additive) selectedIds.value = []
      return
    }
    if (additive) {
      selectedIds.value = selectedIds.value.includes(id)
        ? selectedIds.value.filter((x) => x !== id)
        : [...selectedIds.value, id]
      return
    }
    // 选中合并组中的任一成员时，右侧同步选中整组数据（点击的那个作为主选中）
    const group = groupIdsOf(id)
    selectedIds.value = [...group.filter((x) => x !== id), id]
  }

  /** 移除已经不在任何展台内的家具 */
  function cleanupFurniture() {
    if (!infras.value.some((it) => isFurnitureKind(it.kind))) return
    infras.value = infras.value.filter(
      (it) =>
        !isFurnitureKind(it.kind) ||
        boothAtPoint(booths.value, it) !== null,
    )
  }

  function deleteVenue() {
    venue.value = null
    booths.value = []
    infras.value = []
    selectedIds.value = []
    clearInfraSelection()
    options.draftPoints.value = []
    options.mode.value = 'idle'
    options.toast('已清空场馆、展台与基础设施')
  }

  function deleteBooth(id: string) {
    const target = booths.value.find((b) => b.id === id)
    booths.value = cleanupGroups(booths.value.filter((b) => b.id !== id))
    cleanupFurniture()
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
    options.toast(target ? `已删除 ${target.name}` : '已删除展台')
  }

  function deleteSelectedBooths() {
    if (!selectedIds.value.length) return
    const n = selectedIds.value.length
    booths.value = cleanupGroups(
      booths.value.filter((b) => !selectedIds.value.includes(b.id)),
    )
    cleanupFurniture()
    selectedIds.value = []
    options.toast(n > 1 ? `已删除 ${n} 个展台` : '已删除展台')
  }

  function changeVenueHeight(v: number) {
    if (!venue.value) return
    venue.value = {
      ...venue.value,
      height: Math.round(Math.min(24, Math.max(2, v))),
      ceiling: !options.venueNoTop.value,
    }
  }

  function changeBoothHeight(id: string, v: number) {
    booths.value = booths.value.map((b) => {
      if (b.id !== id) return b
      // 光地展台是固定高度的台板，不参与高度调整
      if (boothKindOf(b) === 'openfloor') return b
      return { ...b, height: Math.round(Math.min(8, Math.max(1, v))) }
    })
  }

  /** 标准 / 脚手架 / 光地互换：保留轮廓、家具、标记色、名称、展商和 Logo */
  function changeBoothKind(id: string, kind: BoothKind) {
    const target = booths.value.find((b) => b.id === id)
    if (!target) return
    const from = boothKindOf(target)
    if (from === kind) return

    const height =
      kind === 'openfloor'
        ? OPEN_FLOOR_HEIGHT
        : from === 'openfloor'
          ? BOOTH_DEFAULT_HEIGHT[kind]
          : target.height
    const next: Booth = { ...target, height }
    if (kind === 'massing') {
      delete next.kind
      delete next.canopy
    } else {
      next.kind = kind
    }
    if (kind === 'scaffold') {
      next.canopy = target.canopy !== false
      delete next.noTop
    } else if (kind === 'openfloor') {
      delete next.canopy
      delete next.noTop
    } else {
      delete next.noTop
    }

    booths.value = booths.value.map((b) => (b.id === id ? next : b))
    if (kind === 'openfloor') {
      options.toast(`${target.name} 已转换为光地 · 原高度已清除`)
    } else if (from === 'openfloor') {
      options.toast(
        `${target.name} 已转换为${BOOTH_KIND_LABELS[kind]}展台 · 使用默认高度 ${height} m`,
      )
    } else {
      options.toast(`${target.name} 已转换为${BOOTH_KIND_LABELS[kind]}展台`)
    }
  }

  function setBoothCanopy(id: string, on: boolean) {
    const target = booths.value.find((b) => b.id === id)
    if (!target || boothKindOf(target) !== 'scaffold') return
    booths.value = booths.value.map((b) =>
      b.id === id ? { ...b, canopy: on } : b,
    )
    options.toast(`${target.name} 顶棚已${on ? '开启' : '关闭'}`)
  }

  /** 标准展台去掉顶部时，顶板与立柱一起隐藏，仅保留底部围挡 */
  function setBoothNoTop(id: string, noTop: boolean) {
    const target = booths.value.find((b) => b.id === id)
    if (!target || boothKindOf(target) !== 'massing') return
    booths.value = booths.value.map((b) =>
      b.id === id ? { ...b, noTop: noTop || undefined } : b,
    )
    options.toast(
      `${target.name} ${noTop ? '顶板与立柱已去除' : '顶板与立柱已恢复'}`,
    )
  }

  function setBoothMark(id: string, mark: BoothMark | null) {
    const target = booths.value.find((b) => b.id === id)
    if (!target) return
    booths.value = booths.value.map((b) =>
      b.id === id
        ? { ...b, mark: mark ?? undefined, marked: undefined }
        : b,
    )
    const label =
      mark === 'red'
        ? '红色'
        : mark === 'yellow'
          ? '黄色'
          : mark === 'gray'
            ? '灰色'
            : ''
    options.toast(
      mark
        ? `已将「${target.name}」标记为${label}`
        : `已取消「${target.name}」的标记`,
    )
  }

  /** 按包围盒长宽等比缩放展台轮廓，中心保持不动 */
  function resizeBooth(id: string, patch: { width?: number; depth?: number }) {
    const target = booths.value.find((b) => b.id === id)
    if (!target || target.points.length < 3) return

    const bnd = boundsOf(target.points)
    const curW = Math.max(0.1, bnd.maxX - bnd.minX)
    const curD = Math.max(0.1, bnd.maxZ - bnd.minZ)
    const width = Math.round(Math.min(120, Math.max(1, patch.width ?? curW)))
    const depth = Math.round(Math.min(120, Math.max(1, patch.depth ?? curD)))
    if (width === Math.round(curW) && depth === Math.round(curD)) return

    const cx = (bnd.minX + bnd.maxX) / 2
    const cz = (bnd.minZ + bnd.maxZ) / 2
    const sx = width / curW
    const sz = depth / curD
    const points = target.points.map((p) => ({
      x: cx + (p.x - cx) * sx,
      z: cz + (p.z - cz) * sz,
    }))
    if (polygonArea(points) < 3) {
      options.toast('展台面积不能小于 3 m²（约 3 × 1m）')
      return
    }

    const inner = options.venueInner()
    if (inner && !polygonInsidePolygon(points, inner)) {
      options.toast('展台需完全位于场馆内部')
      return
    }

    const clash = booths.value.find(
      (b) =>
        b.id !== id &&
        !(target.groupId && b.groupId === target.groupId) &&
        overlaps(points, b.points),
    )
    if (clash) {
      options.toast(`与「${clash.name}」重叠，无法调整尺寸`)
      return
    }

    // 展台内的家具跟着轮廓一起缩放，避免缩台后家具悬空
    const nextFurniture = new Map<string, Pt>()
    for (const it of infras.value) {
      if (
        !isFurnitureKind(it.kind) ||
        !pointInPolygon(it, target.points)
      ) {
        continue
      }
      const nx = cx + (it.x - cx) * sx
      const nz = cz + (it.z - cz) * sz
      if (
        !furnitureInsidePolygon(
          points,
          nx,
          nz,
          it.width,
          it.depth,
          it.rotation,
        )
      ) {
        options.toast(`「${it.name}」会超出调整后的展台`)
        return
      }
      nextFurniture.set(it.id, { x: nx, z: nz })
    }

    booths.value = booths.value.map((b) =>
      b.id === id ? { ...b, points } : b,
    )
    if (nextFurniture.size) {
      infras.value = infras.value.map((it) => {
        const p = nextFurniture.get(it.id)
        return p ? { ...it, x: p.x, z: p.z } : it
      })
    }
    options.toast(
      `${target.name} 尺寸已调整为 ${width} × ${depth} m`,
    )
  }

  function rotatePointsAround(pts: Pt[], center: Pt, deg: number): Pt[] {
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return pts.map((p) => {
      const dx = p.x - center.x
      const dz = p.z - center.z
      return {
        x: center.x + dx * cos + dz * sin,
        z: center.z - dx * sin + dz * cos,
      }
    })
  }

  function toPoly(pts: Pt[]): Polygon {
    const ring = pts.map((p) => [p.x, p.z] as [number, number])
    ring.push([pts[0].x, pts[0].z])
    return [ring]
  }

  function ringArea(ring: [number, number][]): number {
    let s = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      s += a[0] * b[1] - b[0] * a[1]
    }
    return s / 2
  }

  /** 用相交面积判断重叠，允许展台贴边拼接 */
  function overlaps(pts: Pt[], other: Pt[]): boolean {
    try {
      const res = polygonClipping.intersection(toPoly(pts), toPoly(other))
      let area = 0
      for (const poly of res) {
        for (const ring of poly) area += Math.abs(ringArea(ring))
      }
      return area > 0.02
    } catch {
      return true
    }
  }

  /** 展台候选位置是否合法，返回错误文案（ignore 为一起变换、无需互检的展台） */
  function boothError(pts: Pt[], ignore: string[] = []): string | null {
    const inner = options.venueInner()
    if (!inner) return '请先绘制场馆'
    if (!polygonInsidePolygon(pts, inner)) return '展台需位于场馆内部'
    const clash = booths.value.find(
      (b) => !ignore.includes(b.id) && overlaps(pts, b.points),
    )
    return clash ? `与「${clash.name}」重叠` : null
  }

  function rotateSelected(dir: 1 | -1) {
    const id = activeBoothId.value
    if (id) rotateBooth(id, dir * 90)
  }

  /** 合并组轮廓（用于相邻性校验） */
  function groupUnion(list: Booth[]): Polygon[] | null {
    if (list.length < 2) return null
    try {
      const res = polygonClipping.union(
        toPoly(list[0].points),
        ...list.slice(1).map((b) => toPoly(b.points)),
      )
      return res.length === 1 ? res : null
    } catch {
      return null
    }
  }

  function mergeSelected() {
    const list = booths.value.filter((b) =>
      selectedIds.value.includes(b.id),
    )
    if (list.length < 2) return
    if (!groupUnion(list)) {
      options.toast('展台需要相互贴合才能合并')
      return
    }

    const active =
      booths.value.find((b) => b.id === activeBoothId.value) ??
      list[list.length - 1]
    const heights = list.map((b) => Number(b.height.toFixed(2)))
    const unique = new Set(heights)

    if (unique.size > 1) {
      mergeDialog.value = {
        ids: list.map((b) => b.id),
        heights,
        targetId: active.id,
        targetName: active.name,
        targetHeight: active.height,
      }
      return
    }
    applyMerge(false)
  }

  function applyMerge(unify: boolean) {
    const d = mergeDialog.value
    const ids = d
      ? d.ids
      : booths.value
          .filter((b) => selectedIds.value.includes(b.id))
          .map((b) => b.id)
    if (ids.length < 2) {
      mergeDialog.value = null
      return
    }

    // 复用已有分组，否则新建（同一合并组合用同一标记色）
    const existing = booths.value.find(
      (b) => ids.includes(b.id) && b.groupId,
    )?.groupId
    const gid = existing ?? nextGroupId()
    const set = new Set(ids)
    const targetHeight = d?.targetHeight

    booths.value = booths.value.map((b) => {
      if (!set.has(b.id)) return b
      return {
        ...b,
        groupId: gid,
        height:
          unify && targetHeight !== undefined ? targetHeight : b.height,
      }
    })
    selectedIds.value = [...ids]
    mergeDialog.value = null
    options.toast(
      unify && targetHeight !== undefined
        ? `已合并 ${ids.length} 个展台 · 高度统一为 ${targetHeight.toFixed(2)} m`
        : `已合并 ${ids.length} 个展台（仅合并模型，结构保持独立）`,
    )
  }

  function unmergeSelected() {
    const set = new Set(selectedIds.value)
    booths.value = booths.value.map((b) =>
      set.has(b.id) && b.groupId ? { ...b, groupId: undefined } : b,
    )
    options.toast('已取消合并')
  }

  function transformPoints(
    ids: string[],
    fn: (pts: Pt[], id: string) => Pt[],
  ): boolean {
    const next = booths.value.map((b) =>
      ids.includes(b.id) ? { ...b, points: fn(b.points, b.id) } : b,
    )
    for (const b of next) {
      if (!ids.includes(b.id)) continue
      const err = boothError(b.points, ids)
      if (err) {
        options.toast(`无法变换：${err}`)
        return false
      }
    }
    booths.value = next
    return true
  }

  /** 展台内的家具（用于随展台一起移动 / 旋转） */
  function furnitureInBooths(list: Booth[]): Infra[] {
    if (!list.length) return []
    return infras.value.filter(
      (it) =>
        isFurnitureKind(it.kind) &&
        list.some((b) => pointInPolygon(it, b.points)),
    )
  }

  function moveBooth(id: string, dx: number, dz: number) {
    const ids = groupIdsOf(id)
    const members = booths.value.filter((b) => ids.includes(b.id))
    const furniture = furnitureInBooths(members)
    if (
      !transformPoints(ids, (pts) =>
        pts.map((p) => ({ x: p.x + dx, z: p.z + dz })),
      )
    ) {
      return
    }
    if (!furniture.length) return
    const moved = new Set(furniture.map((it) => it.id))
    infras.value = infras.value.map((it) =>
      moved.has(it.id)
        ? { ...it, x: it.x + dx, z: it.z + dz }
        : it,
    )
  }

  function rotateBooth(id: string, deg: number) {
    const ids = groupIdsOf(id)
    const members = booths.value.filter((b) => ids.includes(b.id))
    const all: Pt[] = []
    for (const b of members) all.push(...b.points)
    let center: Pt
    if (ids.length === 1) {
      center = centroid(all)
    } else {
      const bnd = boundsOf(all)
      center = {
        x: (bnd.minX + bnd.maxX) / 2,
        z: (bnd.minZ + bnd.maxZ) / 2,
      }
    }

    const furniture = furnitureInBooths(members)
    if (
      !transformPoints(ids, (pts) => rotatePointsAround(pts, center, deg))
    ) {
      return
    }
    if (!furniture.length) return

    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const moved = new Set(furniture.map((it) => it.id))
    infras.value = infras.value.map((it) => {
      if (!moved.has(it.id)) return it
      const dx = it.x - center.x
      const dz = it.z - center.z
      const rotation =
        (((it.rotation + rad) % (Math.PI * 2)) + Math.PI * 2) %
        (Math.PI * 2)
      return {
        ...it,
        x: center.x + dx * cos + dz * sin,
        z: center.z - dx * sin + dz * cos,
        rotation,
      }
    })
  }

  return {
    setInfraSelection,
    clearInfraSelection,
    handlePick,
    activeBoothId,
    hasGroupInSelection,
    selectionIsOneGroup,
    mergeDialog,
    groupIdsOf,
    overlaps,
    cleanupFurniture,
    nextGroupId,
    deleteVenue,
    deleteBooth,
    deleteSelectedBooths,
    changeVenueHeight,
    changeBoothHeight,
    changeBoothKind,
    setBoothCanopy,
    setBoothNoTop,
    setBoothMark,
    resizeBooth,
    rotateSelected,
    mergeSelected,
    applyMerge,
    unmergeSelected,
    moveBooth,
    rotateBooth,
  }
}
