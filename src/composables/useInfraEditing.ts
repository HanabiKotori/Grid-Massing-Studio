import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
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
import { fitGroupOffset } from '../core/furniturePreset'
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
  'meeting-table': 'place-meeting-table',
  'meeting-chair': 'place-meeting-chair',
  'reception-desk': 'place-reception-desk',
  'display-case': 'place-display-case',
  'display-screen': 'place-display-screen',
  plant: 'place-plant',
  shelf: 'place-shelf',
  'display-plinth': 'place-display-plinth',
  'display-column': 'place-display-column',
  'bar-table': 'place-bar-table',
  'bar-stool': 'place-bar-stool',
  'low-cabinet': 'place-low-cabinet',
  'brochure-stand': 'place-brochure-stand',
  lectern: 'place-lectern',
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
  if (m === 'place-meeting-table') return 'meeting-table'
  if (m === 'place-meeting-chair') return 'meeting-chair'
  if (m === 'place-reception-desk') return 'reception-desk'
  if (m === 'place-display-case') return 'display-case'
  if (m === 'place-display-screen') return 'display-screen'
  if (m === 'place-plant') return 'plant'
  if (m === 'place-shelf') return 'shelf'
  if (m === 'place-display-plinth') return 'display-plinth'
  if (m === 'place-display-column') return 'display-column'
  if (m === 'place-bar-table') return 'bar-table'
  if (m === 'place-bar-stool') return 'bar-stool'
  if (m === 'place-low-cabinet') return 'low-cabinet'
  if (m === 'place-brochure-stand') return 'brochure-stand'
  if (m === 'place-lectern') return 'lectern'
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

  /** 家具放置时锁定的展台（从结构树某个展台点「+」时设置） */
  const furnitureHostId = ref<string | null>(null)

  function beginInfraPlace(kind: InfraKind, hostBoothId?: string) {
    pendingInfraCopy.value = null
    furnitureHostId.value =
      isFurnitureKind(kind) && hostBoothId ? hostBoothId : null
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
    if (isFurnitureKind(kind)) {
      const hostList = furnitureHostId.value
        ? options.booths.value.filter((b) => b.id === furnitureHostId.value)
        : options.booths.value
      if (
        !furnitureInsideBooth(hostList, kind, spot.x, spot.z, dims.width, dims.depth, rotation)
      ) {
        options.toast(
          furnitureHostId.value
            ? '该家具只能放在所选展台内部'
            : '家具只能完整放置在展台内部',
        )
        return
      }
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
      ...(copied?.material ? { material: copied.material } : {}),
      ...(copied?.texture ? { texture: copied.texture } : {}),
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

  function updateInfraMaterial(
    id: string,
    patch: { material?: string | null; texture?: string | null },
  ) {
    options.infras.value = options.infras.value.map((it) => {
      if (it.id !== id) return it
      const next = { ...it }
      if ('material' in patch) {
        if (patch.material) next.material = patch.material
        else delete next.material
      }
      if ('texture' in patch) {
        if (patch.texture) next.texture = patch.texture
        else delete next.texture
      }
      return next
    })
  }

  function deleteInfra(id: string) {
    deleteInfraSelection([id])
  }

  /** 多选删除：家具组合可一次移除 */
  function deleteInfraSelection(ids: string[]) {
    const set = new Set(ids)
    const targets = options.infras.value.filter((it) => set.has(it.id))
    if (!targets.length) return
    options.infras.value = options.infras.value.filter((it) => !set.has(it.id))
    options.setInfraSelection(
      options.selectedInfraIds.value.filter((x) => !set.has(x)),
    )
    if (targets.length === 1) {
      options.toast(`已删除 ${targets[0].name}`)
    } else {
      const furniture = targets.filter((it) => isFurnitureKind(it.kind)).length
      options.toast(
        furniture === targets.length
          ? `已删除 ${targets.length} 件家具`
          : `已删除 ${targets.length} 个对象`,
      )
    }
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

  /** 方向键微调家具，步进 0.01m；只接受家具类型 */
  function nudgeInfra(id: string, dx: number, dz: number) {
    const target = options.infras.value.find((it) => it.id === id)
    if (!target || !isFurnitureKind(target.kind)) return
    const x = Math.round((target.x + dx) * 100) / 100
    const z = Math.round((target.z + dz) * 100) / 100
    if (x === target.x && z === target.z) return

    if (
      !furnitureInsideBooth(
        options.booths.value,
        target.kind,
        x,
        z,
        target.width,
        target.depth,
        target.rotation,
      )
    ) {
      options.toast('家具需完整位于展台内部')
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
      options.toast('该位置已被占用')
      return
    }
    options.infras.value = options.infras.value.map((it) =>
      it.id === id ? { ...it, x, z } : it,
    )
  }

  /** 多选方向键微调：整组同步平移，任何一件越界或压到对象就不动 */
  function nudgeInfraGroup(ids: string[], dx: number, dz: number) {
    const moving = new Set(ids)
    const items = options.infras.value.filter(
      (it) => moving.has(it.id) && isFurnitureKind(it.kind),
    )
    if (!items.length) return
    const moved = items.map((it) => ({
      ...it,
      x: Math.round((it.x + dx) * 100) / 100,
      z: Math.round((it.z + dz) * 100) / 100,
    }))
    for (const it of moved) {
      if (
        !furnitureInsideBooth(
          options.booths.value,
          it.kind,
          it.x,
          it.z,
          it.width,
          it.depth,
          it.rotation,
        )
      ) {
        options.toast('家具需完整位于展台内部')
        return
      }
    }
    for (const it of moved) {
      if (
        !infraSpotFree(
          options.infras.value,
          options.booths.value,
          it.x,
          it.z,
          it,
          moving,
        )
      ) {
        options.toast('该位置已被占用')
        return
      }
    }
    const map = new Map(moved.map((it) => [it.id, it]))
    options.infras.value = options.infras.value.map((it) => map.get(it.id) ?? it)
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
    const furniture = targets.filter((target) => {
      const it = options.infras.value.find((v) => v.id === target.id)
      return it ? isFurnitureKind(it.kind) : false
    }).length
    options.toast(
      furniture === targets.length
        ? `已整体移动 ${targets.length} 件家具`
        : `已整体移动 ${targets.length} 个设施`,
    )
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

  /**
   * 多选家具整体旋转 90°：绕组合中心转动每件的朝向与相对位置；
   * 旋转后若压到展台边界或其它对象，就在近旁自动平移整组避让。
   */
  function rotateInfraGroup(ids: string[], dir: 1 | -1) {
    const moving = new Set(ids)
    const items = options.infras.value.filter((it) => moving.has(it.id))
    if (!items.length) return
    if (items.length === 1) {
      rotateInfra(items[0].id, dir)
      return
    }
    if (
      items.some(
        (it) => it.kind === 'gate' || it.kind === 'window' || !isFurnitureKind(it.kind),
      )
    ) {
      options.toast('只有家具支持整组旋转')
      return
    }

    const turn = (dir * Math.PI) / 2
    const cx = items.reduce((sum, it) => sum + it.x, 0) / items.length
    const cz = items.reduce((sum, it) => sum + it.z, 0) / items.length
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    const rotated = items.map((it) => {
      const dx = it.x - cx
      const dz = it.z - cz
      return {
        ...it,
        x: cx + dx * cos + dz * sin,
        z: cz - dx * sin + dz * cos,
        rotation:
          (((it.rotation + turn) % (Math.PI * 2)) + Math.PI * 2) %
          (Math.PI * 2),
      }
    })

    const fit = fitGroupOffset(
      rotated,
      options.booths.value,
      options.infras.value,
      moving,
    )
    if (!fit) {
      options.toast('整体旋转后会超出展台或与其他对象重叠')
      return
    }
    const map = new Map(
      rotated.map((it) => [
        it.id,
        { ...it, x: it.x + fit.dx, z: it.z + fit.dz },
      ]),
    )
    options.infras.value = options.infras.value.map((it) => map.get(it.id) ?? it)
    options.toast(`已整体旋转 ${items.length} 件家具 90°`)
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
    deleteInfraSelection,
    updateInfraDims,
    updateInfraMaterial,
    moveInfra,
    moveInfraGroup,
    nudgeInfra,
    nudgeInfraGroup,
    rotateInfra,
    rotateInfraGroup,
    toggleGate,
    setGateOpenMode,
    changeInfraCount,
    cancelInfraPlacement,
  }
}
