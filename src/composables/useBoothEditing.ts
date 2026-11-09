import { nextTick, type Ref, type ShallowRef } from 'vue'
import { BOOTH_DEFAULT_HEIGHT, OPEN_FLOOR_HEIGHT } from '../core/booth'
import {
  boundsOf,
  insetPolygon,
  isSimplePolygon,
  pointInPolygon,
  polygonArea,
  polygonInsidePolygon,
} from '../core/polygon'
import type {
  Booth,
  BoothKind,
  EditorMode,
  Infra,
  Pt,
  Venue,
} from '../core/types'
import { PLACE_MODE } from './useInfraEditing'
import type { Stage } from '../core/Stage'

export interface BoothPasteClipboard {
  booths: Booth[]
  infras: Infra[]
  center: Pt
}

interface BoothEditingOptions {
  venue: ShallowRef<Venue | null>
  booths: ShallowRef<Booth[]>
  infras: ShallowRef<Infra[]>
  mode: Ref<EditorMode>
  draftPoints: ShallowRef<Pt[]>
  draftHeight: Ref<number>
  boothKind: Ref<BoothKind>
  venueNoTop: Ref<boolean>
  selectedIds: ShallowRef<string[]>
  selectedInfraId: Ref<string | null>
  skipRevealBoothId: Ref<string | null>
  pendingInfraCopy: Ref<Infra | null>
  renderOnly: Ref<boolean>
  clearInfraSelection: () => void
  clearHover: () => void
  focusAdd: (section: 'booth' | 'infra' | 'furniture') => void
  toast: (text: string) => void
  getStage: () => Stage | null
  applyLiveWeatherForVenue: () => Promise<void> | void
  venueInner: () => Pt[] | null
  insideVenueArea: (p: Pt) => boolean
  clampHeight: (v: number) => number
  overlaps: (a: Pt[], b: Pt[]) => boolean
  cleanupFurniture: () => void
  nextGroupId: () => string
  nextBoothSeq: () => number
  nextInfraSeq: () => number
}

export function useBoothEditing(options: BoothEditingOptions) {
  let pasteClipboard: BoothPasteClipboard | null = null

  function startVenueDraw() {
    options.mode.value = 'draw-venue'
    options.draftPoints.value = []
    options.selectedIds.value = []
    options.clearHover()
    options.getStage()?.viewTop()
  }

  function startBoothDraw(kind: BoothKind = 'massing') {
    if (!options.venue.value) {
      options.toast('请先绘制场馆')
      return
    }
    options.boothKind.value = kind
    options.mode.value = 'draw-booth'
    options.draftPoints.value = []
    options.selectedIds.value = []
    options.clearHover()
    options.getStage()?.viewTop()
    if (kind === 'openfloor') {
      options.toast('光地展台无需设置高度，闭合轮廓后直接生成')
    }
  }

  function handlePlace(p: Pt) {
    const m = options.mode.value
    if (m !== 'draw-venue' && m !== 'draw-booth') return

    const pts = options.draftPoints.value
    // 点到起点附近 => 闭合（阈值须小于 1 格，否则 1×1 这类小展台会被提前闭合）
    if (pts.length >= 3) {
      const first = pts[0]
      if (Math.hypot(p.x - first.x, p.z - first.z) < 0.5) {
        closeDraft()
        return
      }
    }

    if (pts.length) {
      const last = pts[pts.length - 1]
      if (Math.hypot(p.x - last.x, p.z - last.z) < 0.01) return
    }

    if (m === 'draw-booth' && !options.insideVenueArea(p)) {
      options.toast('展台需绘制在场馆内部')
      return
    }

    options.draftPoints.value = [...pts, p]
  }

  /** 拖拽拉出的矩形：两个对角点已吸附到网格，直接生成四顶点轮廓并闭合 */
  function handleDrawRect(a: Pt, b: Pt) {
    const m = options.mode.value
    if (m !== 'draw-venue' && m !== 'draw-booth') return
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    const minZ = Math.min(a.z, b.z)
    const maxZ = Math.max(a.z, b.z)
    if (maxX - minX < 1 || maxZ - minZ < 1) {
      options.toast('矩形至少需要 1 × 1 m')
      return
    }
    options.draftPoints.value = [
      { x: minX, z: minZ },
      { x: maxX, z: minZ },
      { x: maxX, z: maxZ },
      { x: minX, z: maxZ },
    ]
    closeDraft()
  }

  function undoPoint() {
    options.draftPoints.value = options.draftPoints.value.slice(0, -1)
  }

  function cancelDraft() {
    options.mode.value = 'idle'
    options.draftPoints.value = []
  }

  function closeDraft() {
    const m = options.mode.value
    if (m !== 'draw-venue' && m !== 'draw-booth') return
    const pts = options.draftPoints.value

    if (pts.length < 3) {
      options.toast('至少需要 3 个顶点才能围成面积')
      return
    }
    if (!isSimplePolygon(pts)) {
      options.toast('轮廓存在自相交，请撤销后调整顶点')
      return
    }
    const area = polygonArea(pts)
    if (m === 'draw-booth' && area < 3) {
      options.toast('展台面积不能小于 3 m²（约 3 × 1m）')
      return
    }
    if (m === 'draw-venue' && area < 1) {
      options.toast('面积过小，请重新绘制')
      return
    }

    if (m === 'draw-booth') {
      const inner = options.venueInner()
      if (!inner || !polygonInsidePolygon(pts, inner)) {
        options.toast('展台轮廓需完全位于场馆内部')
        return
      }
      const clash = options.booths.value.find((b) =>
        options.overlaps(pts, b.points),
      )
      if (clash) {
        options.toast(`与「${clash.name}」重叠，请调整轮廓`)
        return
      }
      if (options.boothKind.value === 'openfloor') {
        addBooth(pts, OPEN_FLOOR_HEIGHT, 'openfloor')
        return
      }
      options.draftHeight.value = BOOTH_DEFAULT_HEIGHT[options.boothKind.value]
      options.mode.value = 'height-booth'
    } else {
      options.draftHeight.value = options.venue.value
        ? options.venue.value.height
        : 6
      options.mode.value = 'height-venue'
    }
    nextTick(() => {
      if (m === 'draw-booth' && options.venue.value) {
        options.getStage()?.fit(
          options.venue.value.points,
          options.venue.value.height,
        )
      } else {
        options.getStage()?.fit(pts, options.draftHeight.value)
      }
    })
  }

  function backToDraw() {
    if (options.mode.value === 'height-venue') options.mode.value = 'draw-venue'
    else if (options.mode.value === 'height-booth') {
      options.mode.value = 'draw-booth'
    }
    options.getStage()?.viewTop()
  }

  /** 生成展台：标准 / 脚手架走定高流程，光地直接按平台高度落位 */
  function addBooth(points: Pt[], height: number, kind: BoothKind) {
    const seq = options.nextBoothSeq()
    const booth: Booth = {
      id: `b${Date.now().toString(36)}-${seq}`,
      name: `展台 ${String(seq).padStart(2, '0')}`,
      points: points.map((p) => ({ ...p })),
      height,
      ...(kind === 'massing' ? {} : { kind }),
      ...(kind === 'scaffold' ? { canopy: true } : {}),
    }
    options.booths.value = [...options.booths.value, booth]
    options.skipRevealBoothId.value = booth.id
    options.selectedIds.value = [booth.id]
    options.focusAdd('booth')
    options.mode.value = 'idle'
    options.draftPoints.value = []
    const kindLabel =
      kind === 'scaffold' ? '脚手架' : kind === 'openfloor' ? '光地' : '标准'
    options.toast(
      `${booth.name} 已生成 · ${kindLabel} · ${polygonArea(booth.points).toFixed(1)} m²`,
    )
    // 用较高的俯角回看，保证馆内的展台不会被外墙挡住
    if (options.venue.value) {
      options.getStage()?.fit(
        options.venue.value.points,
        options.venue.value.height,
        2.6,
      )
    }
  }

  function copySelectedBooths() {
    if (options.renderOnly.value || options.mode.value !== 'idle') return
    options.pendingInfraCopy.value = null
    const sourceBooths = options.booths.value.filter((b) =>
      options.selectedIds.value.includes(b.id),
    )
    if (!sourceBooths.length) {
      options.toast('请先选中要复制的展台')
      return
    }

    // 家具和落地设施跟随展台一起复制；门窗依附场馆墙，不纳入复制
    const sourceInfras = options.infras.value.filter(
      (it) =>
        it.kind !== 'gate' &&
        it.kind !== 'window' &&
        sourceBooths.some((booth) => pointInPolygon(it, booth.points)),
    )
    const allPoints = sourceBooths.flatMap((booth) => booth.points)
    const bnd = boundsOf(allPoints)
    const center = {
      x: (bnd.minX + bnd.maxX) / 2,
      z: (bnd.minZ + bnd.maxZ) / 2,
    }
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

    pasteClipboard = {
      booths: clone(sourceBooths),
      infras: clone(sourceInfras),
      center,
    }
    options.selectedIds.value = []
    options.clearInfraSelection()
    options.mode.value = 'paste-booths'
    options.toast(
      `已复制 ${sourceBooths.length} 个展台${
        sourceInfras.length ? ` / ${sourceInfras.length} 个设施` : ''
      } · 点击放置，Esc 取消`,
    )
  }

  function copySelectedInfra() {
    if (options.renderOnly.value || options.mode.value !== 'idle') return
    const target = options.infras.value.find(
      (it) => it.id === options.selectedInfraId.value,
    )
    if (!target) return
    options.pendingInfraCopy.value = JSON.parse(
      JSON.stringify(target),
    ) as Infra
    pasteClipboard = null
    options.clearInfraSelection()
    options.selectedIds.value = []
    options.mode.value = PLACE_MODE[target.kind]
    options.toast(`已复制 ${target.name} · 点击放置，Esc 取消`)
  }

  function cancelBoothPaste() {
    pasteClipboard = null
    options.selectedIds.value = []
    options.mode.value = 'idle'
    options.toast('已取消复制')
  }

  /** 复制组点击落位；坐标是新组中心 */
  function placePastedBooths(target: Pt) {
    const clip = pasteClipboard
    if (!clip) return
    const dx = target.x - clip.center.x
    const dz = target.z - clip.center.z
    const inner = options.venueInner()
    const movedBooths = clip.booths.map((booth) => ({
      ...booth,
      points: booth.points.map((p) => ({ x: p.x + dx, z: p.z + dz })),
    }))

    for (const booth of movedBooths) {
      if (inner && !polygonInsidePolygon(booth.points, inner)) {
        options.toast('复制后的展台需完全位于场馆内部')
        return
      }
    }
    const clash = movedBooths.find((booth) =>
      options.booths.value.some((existing) =>
        options.overlaps(booth.points, existing.points),
      ),
    )
    if (clash) {
      options.toast(`复制位置与「${clash.name}」重叠，请换个位置`)
      return
    }

    const groupMap = new Map<string, string>()
    const nextBooths = movedBooths.map((booth) => {
      const seq = options.nextBoothSeq()
      const groupId = booth.groupId
        ? groupMap.get(booth.groupId) ??
          (() => {
            const id = options.nextGroupId()
            groupMap.set(booth.groupId!, id)
            return id
          })()
        : undefined
      return {
        ...booth,
        id: `b${Date.now().toString(36)}-${seq}`,
        ...(groupId ? { groupId } : { groupId: undefined }),
      }
    })
    const nextInfras = clip.infras.map((it) => {
      const seq = options.nextInfraSeq()
      return {
        ...it,
        id: `inf${Date.now().toString(36)}-${seq}`,
        x: it.x + dx,
        z: it.z + dz,
      }
    })

    options.booths.value = [...options.booths.value, ...nextBooths]
    options.infras.value = [...options.infras.value, ...nextInfras]
    options.selectedIds.value = nextBooths.map((booth) => booth.id)
    options.clearInfraSelection()
    pasteClipboard = null
    options.mode.value = 'idle'
    options.toast(
      `已复制 ${nextBooths.length} 个展台${
        nextInfras.length ? ` / ${nextInfras.length} 个设施` : ''
      }`,
    )
  }

  function confirmHeight() {
    const m = options.mode.value
    const pts = options.draftPoints.value
    if (pts.length < 3) return
    const h = options.clampHeight(options.draftHeight.value)

    if (m === 'height-venue') {
      const next: Venue = {
        points: pts.map((p) => ({ ...p })),
        height: h,
        ceiling: !options.venueNoTop.value,
      }
      const hadVenue = !!options.venue.value
      options.venue.value = next
      if (hadVenue) void options.applyLiveWeatherForVenue()

      const inner = insetPolygon(next.points, 0.4) ?? next.points
      const kept = options.booths.value.filter((b) =>
        polygonInsidePolygon(b.points, inner),
      )
      const dropped = options.booths.value.length - kept.length
      options.booths.value = kept
      options.selectedIds.value = options.selectedIds.value.filter((id) =>
        kept.some((b) => b.id === id),
      )

      // 出入口与窗户依附旧墙体，重绘场馆后需要重新放置
      options.infras.value = options.infras.value.filter(
        (it) => it.kind !== 'gate' && it.kind !== 'window',
      )
      options.cleanupFurniture()
      options.clearInfraSelection()

      options.mode.value = 'idle'
      options.draftPoints.value = []
      options.getStage()?.fit(next.points, h)
      options.toast(
        dropped > 0
          ? `场馆已更新，${dropped} 个展台超出范围被移除`
          : `场馆白膜已生成 · ${polygonArea(next.points).toFixed(1)} m²`,
      )
      return
    }

    if (m === 'height-booth') {
      addBooth(pts, h, options.boothKind.value)
    }
  }

  function getPasteClipboard(): BoothPasteClipboard | null {
    return pasteClipboard
  }

  return {
    getPasteClipboard,
    startVenueDraw,
    startBoothDraw,
    handlePlace,
    handleDrawRect,
    undoPoint,
    cancelDraft,
    closeDraft,
    backToDraw,
    addBooth,
    copySelectedBooths,
    copySelectedInfra,
    cancelBoothPaste,
    placePastedBooths,
    confirmHeight,
  }
}
