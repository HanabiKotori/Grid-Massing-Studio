import { shallowRef, type Ref, type ShallowRef } from 'vue'
import {
  ELEVATOR_COUNT,
  ELEVATOR_DEFAULT_COUNT,
  GATE_OPEN_MODE_LABELS,
  INFRA_DEFAULTS,
  INFRA_LABELS,
  WINDOW_SILL,
  clampInfraDims,
  gateOpenModeOf,
  isFurnitureKind,
  type InfraDims,
} from '../core/infra'
import {
  furnitureInsideBooth,
  gateWindowConflict,
  infraSpotFree,
  windowGateConflict,
} from '../core/infraGeometry'
import type {
  Booth,
  EditorMode,
  GateOpenMode,
  Infra,
  InfraKind,
  Pt,
  Venue,
} from '../core/types'

export const PLACE_MODE: Record<InfraKind, EditorMode> = {
  stairs: 'place-stairs',
  restroom: 'place-restroom',
  gate: 'place-gate',
  window: 'place-window',
  elevator: 'place-elevator',
  wall: 'place-wall',
  chair: 'place-chair',
  armchair: 'place-armchair',
  sofa: 'place-sofa',
  'table-round': 'place-table-round',
  'table-square': 'place-table-square',
}

export function kindOfPlaceMode(m: EditorMode): InfraKind | null {
  if (m === 'place-stairs') return 'stairs'
  if (m === 'place-restroom') return 'restroom'
  if (m === 'place-gate') return 'gate'
  if (m === 'place-window') return 'window'
  if (m === 'place-elevator') return 'elevator'
  if (m === 'place-wall') return 'wall'
  if (m === 'place-chair') return 'chair'
  if (m === 'place-armchair') return 'armchair'
  if (m === 'place-sofa') return 'sofa'
  if (m === 'place-table-round') return 'table-round'
  if (m === 'place-table-square') return 'table-square'
  return null
}

interface InfraEditingOptions {
  infras: ShallowRef<Infra[]>
  booths: ShallowRef<Booth[]>
  venue: ShallowRef<Venue | null>
  mode: Ref<EditorMode>
  draftPoints: ShallowRef<Pt[]>
  selectedIds: ShallowRef<string[]>
  selectedInfraIds: ShallowRef<string[]>
  selectedInfraId: Ref<string | null>
  skipRevealInfraId: Ref<string | null>
  setInfraSelection: (ids: string[]) => void
  clearInfraSelection: () => void
  focusAdd: (section: 'infra' | 'furniture') => void
  toast: (text: string) => void
  nextInfraSeq: () => number
}

export function useInfraEditing(options: InfraEditingOptions) {
  const pendingInfraCopy = shallowRef<Infra | null>(null)

  function nextInfraName(kind: InfraKind): string {
    const n = options.infras.value.filter((it) => it.kind === kind).length + 1
    return `${INFRA_LABELS[kind]} ${String(n).padStart(2, '0')}`
  }

  function beginInfraPlace(kind: InfraKind) {
    pendingInfraCopy.value = null
    if ((kind === 'gate' || kind === 'window') && !options.venue.value) {
      options.toast('请先绘制场馆')
      return
    }
    if (isFurnitureKind(kind) && !options.booths.value.length) {
      options.toast('请先绘制展台，家具只能放在展台内部')
      return
    }
    if (options.mode.value !== 'idle') return
    options.selectedIds.value = []
    options.clearInfraSelection()
    options.draftPoints.value = []
    options.mode.value = PLACE_MODE[kind]
    options.toast(
      kind === 'gate'
        ? '移动到场馆墙体或墙面上，点击放置出入口'
        : kind === 'window'
          ? '移动到场馆外墙上，点击放置窗户'
          : isFurnitureKind(kind)
            ? `点击展台内部放置${INFRA_LABELS[kind]} · 右键旋转 90°`
            : `点击地面放置${INFRA_LABELS[kind]} · 右键旋转 90°`,
    )
  }

  function handlePlaceInfra(
    kind: InfraKind,
    spot: { x: number; z: number; rotation: number; hostHeight?: number },
  ) {
    if ((kind === 'gate' || kind === 'window') && !options.venue.value) {
      options.toast('请先绘制场馆')
      options.mode.value = 'idle'
      return
    }

    const hostHeight =
      kind === 'gate' || kind === 'window'
        ? (spot.hostHeight ?? options.venue.value?.height)
        : options.venue.value?.height
    const copied =
      pendingInfraCopy.value?.kind === kind ? pendingInfraCopy.value : null
    const dims = clampInfraDims(
      kind,
      copied
        ? { width: copied.width, depth: copied.depth, height: copied.height }
        : INFRA_DEFAULTS[kind],
      hostHeight,
    )
    const rotation = spot.rotation
    if (
      kind === 'window' &&
      gateWindowConflict(options.infras.value, spot.x, spot.z, dims.width, rotation)
    ) {
      options.toast('这里已有出入口，不能安装窗户')
      return
    }
    if (
      kind === 'gate' &&
      windowGateConflict(options.infras.value, spot.x, spot.z, dims.width, rotation)
    ) {
      options.toast('这里已有窗户，不能安装出入口')
      return
    }
    if (
      isFurnitureKind(kind) &&
      !furnitureInsideBooth(
        options.booths.value,
        kind,
        spot.x,
        spot.z,
        dims.width,
        dims.depth,
        rotation,
      )
    ) {
      options.toast('家具只能完整放置在展台内部')
      return
    }
    if (
      kind !== 'gate' &&
      !infraSpotFree(
        options.infras.value,
        options.booths.value,
        spot.x,
        spot.z,
        { kind, width: dims.width, depth: dims.depth, rotation },
      )
    ) {
      options.toast('该位置已被占用，请换个位置')
      return
    }

    const seq = options.nextInfraSeq()
    const item: Infra = {
      id: `inf${Date.now().toString(36)}-${seq}`,
      kind,
      name: nextInfraName(kind),
      x: spot.x,
      z: spot.z,
      rotation,
      width: dims.width,
      depth: dims.depth,
      height: dims.height,
      ...(kind === 'window'
        ? { sill: copied?.sill ?? WINDOW_SILL }
        : {}),
      ...(kind === 'gate'
        ? {
            open: copied?.open ?? false,
            openMode: copied?.openMode ?? 'double',
          }
        : {}),
      ...(kind === 'elevator'
        ? { count: copied?.count ?? ELEVATOR_DEFAULT_COUNT }
        : {}),
    }

    pendingInfraCopy.value = null
    options.infras.value = [...options.infras.value, item]
    options.selectedIds.value = []
    options.skipRevealInfraId.value = item.id
    options.setInfraSelection([item.id])
    options.focusAdd(isFurnitureKind(kind) ? 'furniture' : 'infra')
    options.mode.value = 'idle'
    options.toast(
      copied
        ? `已复制 ${copied.name} · 高 ${item.height.toFixed(1)} m`
        : `${item.name} 已添加 · 高 ${item.height.toFixed(1)} m`,
    )
  }

  function selectInfra(id: string) {
    options.skipRevealInfraId.value = null
    options.selectedIds.value = []
    options.setInfraSelection([id])
  }

  function renameInfra(id: string, name: string) {
    const target = options.infras.value.find((it) => it.id === id)
    if (!target || target.name === name) return
    options.infras.value = options.infras.value.map((it) =>
      it.id === id ? { ...it, name } : it,
    )
    options.toast(`已重命名为「${name}」`)
  }

  function deleteInfra(id: string) {
    const target = options.infras.value.find((it) => it.id === id)
    options.infras.value = options.infras.value.filter((it) => it.id !== id)
    options.setInfraSelection(
      options.selectedInfraIds.value.filter((x) => x !== id),
    )
    options.toast(target ? `已删除 ${target.name}` : '已删除基础设施')
  }

  function updateInfraDims(
    id: string,
    patch: Partial<InfraDims> & { sill?: number },
  ) {
    options.infras.value = options.infras.value.map((it) => {
      if (it.id !== id) return it
      const dims = clampInfraDims(
        it.kind,
        { width: it.width, depth: it.depth, height: it.height, ...patch },
        options.venue.value?.height,
      )
      let next = { ...it, ...dims }
      if (it.kind === 'window') {
        const venueHeight = options.venue.value?.height ?? 6
        const currentSill = it.sill ?? WINDOW_SILL
        const maxSill = Math.max(0.2, venueHeight - next.height - 0.15)
        const sill =
          patch.sill === undefined
            ? currentSill
            : Math.min(maxSill, Math.max(0.2, patch.sill))
        const maxHeight = Math.max(1, venueHeight - sill - 0.15)
        next = {
          ...next,
          sill: Math.round(sill * 10) / 10,
          height: Math.min(next.height, maxHeight),
        }
      }
      if (isFurnitureKind(it.kind)) {
        if (
          !furnitureInsideBooth(
            options.booths.value,
            it.kind,
            next.x,
            next.z,
            next.width,
            next.depth,
            next.rotation,
          )
        ) {
          options.toast('调整尺寸后会超出展台范围')
          return it
        }
        if (
          !infraSpotFree(
            options.infras.value,
            options.booths.value,
            next.x,
            next.z,
            next,
            id,
          )
        ) {
          options.toast('调整尺寸后会与其他对象重叠')
          return it
        }
      }
      if (it.kind === 'window') {
        if (
          gateWindowConflict(
            options.infras.value,
            next.x,
            next.z,
            next.width,
            next.rotation,
            id,
          )
        ) {
          options.toast('调整尺寸后会碰到出入口')
          return it
        }
        if (
          !infraSpotFree(
            options.infras.value,
            options.booths.value,
            next.x,
            next.z,
            next,
            id,
          )
        ) {
          options.toast('调整尺寸后会与其他对象重叠')
          return it
        }
      }
      if (
        it.kind === 'gate' &&
        windowGateConflict(
          options.infras.value,
          next.x,
          next.z,
          next.width,
          next.rotation,
          id,
        )
      ) {
        options.toast('调整尺寸后会碰到窗户')
        return it
      }
      return next
    })
  }

  /** 拖动释放：校验后写回位置；出入口由墙体吸附决定朝向 */
  function moveInfra(id: string, x: number, z: number, rotation: number) {
    const target = options.infras.value.find((it) => it.id === id)
    if (!target) return
    if (
      isFurnitureKind(target.kind) &&
      !furnitureInsideBooth(
        options.booths.value,
        target.kind,
        x,
        z,
        target.width,
        target.depth,
        rotation,
      )
    ) {
      options.toast('家具需完整位于展台内部，已恢复原位')
      return
    }
    if (
      target.kind === 'window' &&
      gateWindowConflict(
        options.infras.value,
        x,
        z,
        target.width,
        rotation,
        id,
      )
    ) {
      options.toast('这里已有出入口，已恢复原位')
      return
    }
    if (
      target.kind === 'gate' &&
      windowGateConflict(
        options.infras.value,
        x,
        z,
        target.width,
        rotation,
        id,
      )
    ) {
      options.toast('这里已有窗户，已恢复原位')
      return
    }
    if (
      !infraSpotFree(
        options.infras.value,
        options.booths.value,
        x,
        z,
        target,
        id,
      )
    ) {
      options.toast('该位置已被占用，已恢复原位')
      return
    }
    options.infras.value = options.infras.value.map((it) =>
      it.id === id ? { ...it, x, z, rotation } : it,
    )
    options.toast(`${target.name} 已移动`)
  }

  /** 相邻多选整体拖动：全部通过校验后一次性写回 */
  function moveInfraGroup(
    targets: { id: string; x: number; z: number; rotation: number }[],
  ) {
    if (targets.length < 2) return
    const targetMap = new Map(targets.map((target) => [target.id, target]))
    const moving = new Set(targets.map((target) => target.id))
    const next: Infra[] = []

    for (const item of options.infras.value) {
      const target = targetMap.get(item.id)
      if (!target) {
        next.push(item)
        continue
      }
      if (
        isFurnitureKind(item.kind) &&
        !furnitureInsideBooth(
          options.booths.value,
          item.kind,
          target.x,
          target.z,
          item.width,
          item.depth,
          target.rotation,
        )
      ) {
        options.toast(`${item.name} 会超出展台范围，已恢复原位`)
        return
      }
      if (
        !infraSpotFree(
          options.infras.value,
          options.booths.value,
          target.x,
          target.z,
          { ...item, rotation: target.rotation },
          moving,
        )
      ) {
        options.toast('整体移动后会与其他对象重叠，已恢复原位')
        return
      }
      next.push({
        ...item,
        x: target.x,
        z: target.z,
        rotation: target.rotation,
      })
    }

    options.infras.value = next
    options.toast(`已整体移动 ${targets.length} 个设施`)
  }

  function rotateInfra(id: string, dir: 1 | -1) {
    const target = options.infras.value.find((it) => it.id === id)
    if (!target || target.kind === 'gate' || target.kind === 'window') return

    const turn = (dir * Math.PI) / 2
    const rotation =
      (((target.rotation + turn) % (Math.PI * 2)) + Math.PI * 2) %
      (Math.PI * 2)
    if (
      isFurnitureKind(target.kind) &&
      !furnitureInsideBooth(
        options.booths.value,
        target.kind,
        target.x,
        target.z,
        target.width,
        target.depth,
        rotation,
      )
    ) {
      options.toast('旋转后会超出展台范围')
      return
    }
    if (
      !infraSpotFree(
        options.infras.value,
        options.booths.value,
        target.x,
        target.z,
        { ...target, rotation },
        id,
      )
    ) {
      options.toast('旋转后会与现有对象重叠')
      return
    }
    options.infras.value = options.infras.value.map((it) =>
      it.id === id ? { ...it, rotation } : it,
    )
    options.toast(`${target.name} 已旋转 90°`)
  }

  function toggleGate(id: string) {
    const target = options.infras.value.find((it) => it.id === id)
    if (!target || target.kind !== 'gate') return
    options.infras.value = options.infras.value.map((it) =>
      it.id === id ? { ...it, open: !it.open } : it,
    )
    options.toast(`${target.name} 已${target.open ? '关闭' : '打开'}`)
  }

  function setGateOpenMode(id: string, mode: GateOpenMode) {
    const target = options.infras.value.find((it) => it.id === id)
    if (!target || target.kind !== 'gate' || gateOpenModeOf(target) === mode) {
      return
    }
    options.infras.value = options.infras.value.map((it) =>
      it.id === id ? { ...it, openMode: mode } : it,
    )
    options.toast(
      `${target.name} 开启方式：${GATE_OPEN_MODE_LABELS[mode]}`,
    )
  }

  function changeInfraCount(id: string, delta: number) {
    options.infras.value = options.infras.value.map((it) => {
      if (it.id !== id || it.kind !== 'elevator') return it
      const base = it.count ?? ELEVATOR_DEFAULT_COUNT
      const count = Math.min(
        ELEVATOR_COUNT[1],
        Math.max(ELEVATOR_COUNT[0], base + delta),
      )
      return { ...it, count }
    })
  }

  function cancelInfraPlacement() {
    const wasCopy = !!pendingInfraCopy.value
    pendingInfraCopy.value = null
    options.mode.value = 'idle'
    if (wasCopy) options.toast('已取消复制')
  }

  return {
    pendingInfraCopy,
    beginInfraPlace,
    handlePlaceInfra,
    selectInfra,
    renameInfra,
    deleteInfra,
    updateInfraDims,
    moveInfra,
    moveInfraGroup,
    rotateInfra,
    toggleGate,
    setGateOpenMode,
    changeInfraCount,
    cancelInfraPlacement,
  }
}
