import { computed, ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { INFRA_LABELS, isFurnitureKind } from '../core/infra'
import {
  PRESET_LIMIT,
  PRESET_MAX_ITEMS,
  buildFurniturePreset,
  clonePreset,
  fitGroupOffset,
  loadStoredPresets,
  nextPresetName,
  parseFurniturePresets,
  presetFitRadius,
  presetItemsAt,
  storePresets,
  type FurniturePreset,
} from '../core/furniturePreset'
import { boothAtPoint } from '../core/infraGeometry'
import type { Booth, EditorMode, Infra, InfraKind } from '../core/types'

interface FurniturePresetOptions {
  infras: ShallowRef<Infra[]>
  booths: ShallowRef<Booth[]>
  mode: Ref<EditorMode>
  selectedIds: ShallowRef<string[]>
  selectedInfraIds: ShallowRef<string[]>
  setInfraSelection: (ids: string[]) => void
  clearInfraSelection: () => void
  renderOnly: Ref<boolean>
  toast: (text: string) => void
  nextInfraSeq: () => number
}

export function useFurniturePresets(options: FurniturePresetOptions) {
  /** 本地保存的组合预设：跨项目复用，与场景数据分开存储 */
  const presets = ref<FurniturePreset[]>(loadStoredPresets())
  /** 正在落位的组合（预设或临时组合复制） */
  const pendingPreset = shallowRef<FurniturePreset | null>(null)

  const selectedFurniture = computed(() => {
    const ids = new Set(options.selectedInfraIds.value)
    return options.infras.value.filter(
      (it) => ids.has(it.id) && isFurnitureKind(it.kind),
    )
  })

  function persist() {
    if (storePresets(presets.value)) return true
    options.toast('预设保存失败：本地存储空间不足')
    return false
  }

  /** 多选家具必须同属一个展台，避免跨台组合 */
  function sameHost(items: Infra[]): boolean {
    const hosts = new Set(
      items.map((it) => boothAtPoint(options.booths.value, it)?.id ?? ''),
    )
    return hosts.size === 1 && !hosts.has('')
  }

  function savePresetFromSelection() {
    if (options.renderOnly.value || options.mode.value !== 'idle') return
    const items = selectedFurniture.value
    if (items.length < 2) {
      options.toast('请先 Ctrl / Shift 多选至少 2 件家具')
      return
    }
    if (items.length > PRESET_MAX_ITEMS) {
      options.toast(`单个组合最多 ${PRESET_MAX_ITEMS} 件家具`)
      return
    }
    if (!sameHost(items)) {
      options.toast('只能把同一个展台内的家具保存为组合')
      return
    }
    const preset = buildFurniturePreset(items, nextPresetName(presets.value))
    if (!preset) return
    presets.value = [preset, ...presets.value].slice(0, PRESET_LIMIT)
    if (persist()) {
      options.toast(
        `已保存预设「${preset.name}」· ${preset.items.length} 件家具`,
      )
    }
  }

  function removePreset(id: string) {
    const target = presets.value.find((p) => p.id === id)
    if (!target) return
    presets.value = presets.value.filter((p) => p.id !== id)
    persist()
    options.toast(`已删除预设「${target.name}」`)
  }

  /** 重命名组合 */
  function renamePreset(id: string, name: string) {
    const target = presets.value.find((p) => p.id === id)
    if (!target) return
    const next = name.trim().slice(0, 24)
    if (!next || next === target.name) return
    presets.value = presets.value.map((p) =>
      p.id === id ? { ...p, name: next } : p,
    )
    persist()
  }

  /** 场景导入 / 恢复时整体替换预设；字段不合法时清空 */
  function setPresetsFromScene(raw: unknown) {
    if (!Array.isArray(raw)) return
    presets.value = parseFurniturePresets(raw) ?? []
    persist()
  }

  function beginPresetPlace(preset: FurniturePreset) {
    if (options.renderOnly.value) return
    if (!options.booths.value.length) {
      options.toast('请先绘制展台，家具只能布置在展台内部')
      return
    }
    if (options.mode.value !== 'idle') {
      options.toast('请先结束当前操作，再放置家具组合')
      return
    }
    pendingPreset.value = clonePreset(preset)
    options.selectedIds.value = []
    options.clearInfraSelection()
    options.mode.value = 'place-preset'
    options.toast(
      `点击展台内部放置「${preset.name}」· 右键旋转 90° · Esc 结束`,
    )
  }

  /** 组合整体落位：始终重算一次可行落点，必要时整组平移避开边界与既有对象 */
  function placePresetAt(spot: { x: number; z: number; rotation: number }) {
    const preset = pendingPreset.value
    if (!preset) return
    const base = presetItemsAt(preset, spot.x, spot.z, spot.rotation)
    const fit = fitGroupOffset(
      base,
      options.booths.value,
      options.infras.value,
      undefined,
      presetFitRadius(preset),
    )
    if (!fit) {
      options.toast('这里放不下该组合，请换一个展台或位置')
      return
    }
    const placed = base.map((it) => ({
      ...it,
      x: Math.round((it.x + fit.dx) * 1000) / 1000,
      z: Math.round((it.z + fit.dz) * 1000) / 1000,
    }))
    const counts = new Map<InfraKind, number>()
    for (const it of options.infras.value) {
      counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1)
    }
    const created: Infra[] = placed.map((it) => {
      const seq = options.nextInfraSeq()
      const n = (counts.get(it.kind) ?? 0) + 1
      counts.set(it.kind, n)
      return {
        id: `inf${Date.now().toString(36)}-${seq}`,
        kind: it.kind,
        name: `${INFRA_LABELS[it.kind]} ${String(n).padStart(2, '0')}`,
        x: it.x,
        z: it.z,
        rotation: it.rotation,
        width: it.width,
        depth: it.depth,
        height: it.height,
        ...(it.material ? { material: it.material } : {}),
        ...(it.texture ? { texture: it.texture } : {}),
      }
    })

    options.infras.value = [...options.infras.value, ...created]
    options.selectedIds.value = []
    options.setInfraSelection(created.map((it) => it.id))
    options.toast(`已放置「${preset.name}」· 点击继续放置，Esc 结束`)
  }

  function cancelPresetPlacement() {
    if (options.mode.value !== 'place-preset') return
    pendingPreset.value = null
    options.mode.value = 'idle'
    options.toast('已结束组合放置')
  }

  /** Ctrl+C 复制多选家具：复用预设落位流程，点击到任意展台 */
  function copySelectedFurniture() {
    if (options.renderOnly.value || options.mode.value !== 'idle') return
    const items = selectedFurniture.value
    if (items.length < 2) return
    if (!sameHost(items)) {
      options.toast('只能复制同一个展台内的家具组合')
      return
    }
    const preset = buildFurniturePreset(items, '组合复制')
    if (!preset) return
    preset.id = 'copy'
    pendingPreset.value = preset
    options.selectedIds.value = []
    options.clearInfraSelection()
    options.mode.value = 'place-preset'
    options.toast(
      `已复制 ${items.length} 件家具 · 点击展台内部放置，Esc 取消`,
    )
  }

  return {
    presets,
    pendingPreset,
    selectedFurniture,
    savePresetFromSelection,
    removePreset,
    renamePreset,
    setPresetsFromScene,
    beginPresetPlace,
    placePresetAt,
    cancelPresetPlacement,
    copySelectedFurniture,
  }
}
