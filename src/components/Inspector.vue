<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { BOOTH_KIND_LABELS, boothKindOf } from '../core/booth'
import type { FurniturePreset } from '../core/furniturePreset'
import { groupCss } from '../core/groupColor'
import {
  ELEVATOR_DEFAULT_COUNT,
  GATE_OPEN_MODE_LABELS,
  GATE_OPEN_MODES,
  INFRA_LABELS,
  INFRA_LIMITS,
  WINDOW_SILL,
  gateOpenModeOf,
  isFurnitureKind,
} from '../core/infra'
import {
  materialPresetById,
  materialPresetsFor,
  materialPreviewUrl,
  readMaterialImage,
  type MaterialPreset,
} from '../core/materials'
import { boundsOf, perimeter, pointInPolygon, polygonArea } from '../core/polygon'
import type {
  Booth,
  BoothKind,
  BoothMark,
  EditorMode,
  GateOpenMode,
  Infra,
  InfraKind,
  Underlay,
  Venue,
  VenueRules,
} from '../core/types'
import type { ComplianceIssue } from '../core/compliance'

const props = defineProps<{
  venue: Venue | null
  /** 数据里的场馆名称，作为属性面板的对象标题 */
  venueName?: string
  booths: Booth[]
  infras: Infra[]
  underlay: Underlay | null
  selectedInfraId: string | null
  /** 当前查看的家具预设：显示组合信息，家具属性只读 */
  preset?: FurniturePreset | null
  /** 只读预览：预设也不允许改名 / 删除 */
  renderOnly?: boolean
  mode: EditorMode
  /** 按住空格时的纯视角浏览状态 */
  spaceNav?: boolean
  selectedIds: string[]
  venueArea: number
  boothArea: number
  coverage: number
  grouped: boolean
  singleGroup: boolean
  xray: boolean
  noTop: boolean
  mobileOpen?: boolean
  /** 刚新增的对象不自动滚动，保持新增入口可见 */
  skipRevealBoothId?: string | null
  skipRevealInfraId?: string | null
  focusAddSection?: 'booth' | 'infra' | 'furniture' | null
  focusAddToken?: number
  /** 属性模式：只显示当前选中对象的详情，不重复左侧的场景列表 */
  detailOnly?: boolean
  /** 规范校验参数与实时结果 */
  rules: VenueRules
  issues: ComplianceIssue[]
}>()

/** 三个结构卡片的展开状态 */
const venueOpen = ref(true)
const boothOpen = ref(true)
const infraOpen = ref(true)
const materialUploadingId = ref<string | null>(null)

/** 阵列复制参数：数量与间距（米） */
const arrayCount = ref(2)
const arrayGap = ref(10)

function clampInt(e: Event, min: number, max: number) {
  const v = Math.round(Number((e.target as HTMLInputElement).value))
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min
}

function clampNum(e: Event, min: number, max: number) {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min
}

const emit = defineEmits<{
  (e: 'draw-venue'): void
  (e: 'draw-booth', kind: BoothKind): void
  (e: 'booth-canopy', id: string, on: boolean): void
  (e: 'booth-top', id: string, noTop: boolean): void
  (e: 'delete-venue'): void
  (e: 'delete-booth', id: string): void
  (e: 'select', id: string | null, additive: boolean): void
  (e: 'venue-height', value: number): void
  (e: 'booth-height', id: string, value: number): void
  (e: 'booth-kind', id: string, kind: BoothKind): void
  (e: 'booth-size', id: string, patch: { width?: number; depth?: number }): void
  (e: 'set-mark', id: string, mark: BoothMark | null): void
  (e: 'update-rule', key: keyof VenueRules, value: number | boolean): void
  (e: 'array-booth', id: string, count: number, gap: number, axis: 'x' | 'z'): void
  (e: 'rotate', dir: 1 | -1): void
  (e: 'merge'): void
  (e: 'unmerge'): void
  (e: 'toggle-xray'): void
  (e: 'toggle-top'): void
  (e: 'rename', id: string, name: string): void
  (e: 'exhibitor', id: string, value: string): void
  (e: 'add-infra', kind: InfraKind): void
  (e: 'select-infra', id: string): void
  (e: 'delete-infra', id: string): void
  (
    e: 'infra-size',
    id: string,
    patch: { width?: number; depth?: number; height?: number; sill?: number },
  ): void
  (e: 'rotate-infra', id: string, dir: 1 | -1): void
  (e: 'toggle-gate', id: string): void
  (e: 'gate-open-mode', id: string, mode: GateOpenMode): void
  (e: 'clear-infra-selection'): void
  (e: 'infra-count', id: string, delta: number): void
  (e: 'rename-infra', id: string, name: string): void
  (e: 'logo', id: string, dataUrl: string): void
  (e: 'remove-logo', id: string): void
  (e: 'logo-error', message: string): void
  (
    e: 'infra-material',
    id: string,
    patch: { material?: string | null; texture?: string | null },
  ): void
  (e: 'material-error', message: string): void
  (e: 'rename-preset', id: string, name: string): void
  (e: 'delete-preset', id: string): void
  (e: 'place-preset', preset: FurniturePreset): void
  (e: 'underlay-file', file: File): void
  (e: 'center-underlay'): void
  (e: 'toggle-underlay-lock'): void
  (e: 'remove-underlay'): void
  (e: 'underlay-opacity', value: number): void
}>()

const fmt = (n: number) => n.toFixed(1)

const stateLabel = computed(() => {
  if (props.spaceNav) return '浏览模式'
  switch (props.mode) {
    case 'draw-venue':
      return '绘制场馆'
    case 'height-venue':
      return '场馆高度'
    case 'draw-booth':
      return '绘制展台'
    case 'height-booth':
      return '展台高度'
    default:
      return '编辑模式'
  }
})

const venueSlider = computed(() => props.venue?.height ?? 6)
const venuePerimeter = computed(() => (props.venue ? perimeter(props.venue.points) : 0))
const activeId = computed(() => props.selectedIds[props.selectedIds.length - 1] ?? null)
const canEdit = computed(() => props.mode === 'idle')

/** 属性模式下列表只保留选中项，避免与左侧结构树重复 */
const detailBooths = computed(() =>
  props.detailOnly
    ? props.booths.filter((b) => props.selectedIds.includes(b.id))
    : props.booths,
)

watch(
  () => [props.detailOnly, props.selectedIds.length, props.selectedInfraId],
  () => {
    if (!props.detailOnly) return
    const hasBooth = props.selectedIds.length > 0
    const hasInfra = !!props.selectedInfraId
    venueOpen.value = !hasBooth && !hasInfra
    boothOpen.value = hasBooth
    infraOpen.value = hasInfra
  },
  { immediate: true },
)

/** 属性模式下设施列表同样只保留选中项 */
const detailInfraRows = computed(() =>
  props.detailOnly
    ? infraRows.value.filter((r) => r.item && r.item.id === props.selectedInfraId)
    : infraRows.value,
)

const MARK_OPTIONS: { value: BoothMark; label: string }[] = [
  { value: 'red', label: '红色标记' },
  { value: 'yellow', label: '黄色标记' },
  { value: 'gray', label: '灰色标记' },
]

function markColor(b: Booth): BoothMark | null {
  return b.mark ?? (b.marked ? 'red' : null)
}

function fillStyle(v: number, min: number, max: number): any {
  const pct = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))
  return { '--fill': `${pct}%` }
}

const underlayInput = ref<HTMLInputElement | null>(null)
const underlayOpacity = computed(() => Math.round((props.underlay?.opacity ?? 0.7) * 100))
const underlayVisible = computed(() => !!props.underlay?.visible)

function pickUnderlay() {
  underlayInput.value?.click()
}

function onUnderlayFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('underlay-file', file)
}

function onUnderlayOpacity(e: Event) {
  emit('underlay-opacity', Number((e.target as HTMLInputElement).value))
}

function onVenueHeight(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v)) emit('venue-height', Math.round(v))
}

function onBoothHeight(id: string, min: number, max: number, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v)) {
    emit('booth-height', id, Math.round(Math.min(max, Math.max(min, v))))
  }
}

/** 规范数值输入：交给父层收敛范围 */
function onRuleNum(key: keyof VenueRules, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v)) emit('update-rule', key, v)
}

function onSelect(id: string, e: MouseEvent) {
  emit('select', id, e.ctrlKey || e.metaKey || e.shiftKey)
}

const areaOf = (b: Booth) => polygonArea(b.points)

/** 展台包围盒尺寸（米，整数显示） */
function boothSize(b: Booth): { width: number; depth: number } {
  const bnd = boundsOf(b.points)
  return {
    width: Math.max(1, Math.round(bnd.maxX - bnd.minX)),
    depth: Math.max(1, Math.round(bnd.maxZ - bnd.minZ)),
  }
}

function onExhibitorChange(id: string, e: Event) {
  emit('exhibitor', id, (e.target as HTMLInputElement).value)
}

function onBoothSize(id: string, key: 'width' | 'depth', e: Event) {
  const input = e.target as HTMLInputElement
  const v = parseFloat(input.value)
  if (!Number.isFinite(v)) {
    const b = props.booths.find((x) => x.id === id)
    if (b) input.value = String(boothSize(b)[key])
    return
  }

  const patch: { width?: number; depth?: number } = {}
  patch[key] = Math.round(v)
  emit('booth-size', id, patch)

  // 校验失败时数据不会变化，需要把输入框同步回实际尺寸
  nextTick(() => {
    const b = props.booths.find((x) => x.id === id)
    if (b) input.value = String(boothSize(b)[key])
  })
}

const panelEl = ref<HTMLElement | null>(null)

/** 选中项变化时，展开对应卡片并一次性定位到对应条目，避免平滑滚动与展开动画互相拉扯 */
function scrollToItem(selector: string, wait = 0) {
  nextTick(() => {
    const run = () => {
      const panel = panelEl.value
      const el = panel?.querySelector<HTMLElement>(selector)
      if (!panel || !el || el.closest('.card.collapsed')) return

      const panelRect = panel.getBoundingClientRect()
      const itemRect = el.getBoundingClientRect()
      const itemTop = panel.scrollTop + itemRect.top - panelRect.top
      const target = itemTop - (panel.clientHeight - itemRect.height) / 2
      const max = Math.max(0, panel.scrollHeight - panel.clientHeight)
      panel.scrollTop = Math.max(0, Math.min(max, target))
    }
    if (wait > 0) window.setTimeout(run, wait)
    else window.requestAnimationFrame(run)
  })
}

let revealRequest = 0

/** 卡片收起时，等展开动画完成后再滚动，避免展开和滚动同时发生 */
function revealItem(openRef: { value: boolean }, selector: string) {
  const request = ++revealRequest

  if (openRef.value) {
    scrollToItem(selector)
    return
  }

  openRef.value = true
  nextTick(() => {
    const item = panelEl.value?.querySelector<HTMLElement>(selector)
    const body = item?.closest('.card')?.querySelector<HTMLElement>('.card-body')
    if (!body) {
      if (request === revealRequest) scrollToItem(selector, 320)
      return
    }

    let finished = false
    let fallback = 0
    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(fallback)
      body.removeEventListener('transitionend', onEnd)
      // 展开完成后再滚动，留一帧让布局稳定
      window.setTimeout(() => {
        if (request === revealRequest) scrollToItem(selector)
      }, 80)
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === body && event.propertyName === 'grid-template-rows') finish()
    }

    body.addEventListener('transitionend', onEnd)
    fallback = window.setTimeout(finish, 420)
  })
}

function revealBooth(id: string) {
  revealItem(boothOpen, `[data-booth-id="${CSS.escape(id)}"]`)
}

function revealInfra(id: string) {
  revealItem(infraOpen, `[data-infra-id="${CSS.escape(id)}"]`)
}

/** 新增后把对应新增按钮滚回可见区域，确保可以连续添加 */
function scrollAddIntoView(section: 'booth' | 'infra' | 'furniture') {
  const panel = panelEl.value
  const el = panel?.querySelector<HTMLElement>(`[data-add-section="${section}"]`)
  if (!panel || !el) return
  const panelRect = panel.getBoundingClientRect()
  const rect = el.getBoundingClientRect()
  const margin = 8
  if (rect.top < panelRect.top + margin) {
    panel.scrollTop += rect.top - panelRect.top - margin
  } else if (rect.bottom > panelRect.bottom - margin) {
    panel.scrollTop += rect.bottom - panelRect.bottom + margin
  }
}

watch(
  () => props.selectedInfraId,
  async (id) => {
    if (!id) return
    const target = props.infras.find((it) => it.id === id)
    if (target) ensureInfraGroupsOpen(target)
    if (id === props.skipRevealInfraId) return
    await nextTick()
    revealInfra(id)
  },
)

watch(
  () => props.selectedIds,
  (ids) => {
    const id = ids[ids.length - 1]
    if (id && id !== props.skipRevealBoothId) revealBooth(id)
  },
)

watch(
  () => props.focusAddToken,
  () => {
    const section = props.focusAddSection
    if (!section) return
    const wasOpen = section === 'booth' ? boothOpen.value : infraOpen.value
    if (section === 'booth') boothOpen.value = true
    else infraOpen.value = true
    nextTick(() => {
      requestAnimationFrame(() => scrollAddIntoView(section))
      if (!wasOpen) window.setTimeout(() => scrollAddIntoView(section), 340)
    })
  },
)

// 移动端抽屉从隐藏切到显示后，重新展开并滚动到当前选中的模型
watch(
  () => props.mobileOpen,
  (open) => {
    if (!open) return
    const infraId = props.selectedInfraId
    if (infraId) {
      const target = props.infras.find((it) => it.id === infraId)
      if (target) ensureInfraGroupsOpen(target)
      if (infraId !== props.skipRevealInfraId) {
        nextTick(() => revealInfra(infraId))
      }
      return
    }
    const id = props.selectedIds[props.selectedIds.length - 1]
    if (id && id !== props.skipRevealBoothId) revealBooth(id)
  },
)

const kindShort: Record<InfraKind, string> = {
  stairs: '梯',
  restroom: '卫',
  gate: '门',
  window: '窗',
  elevator: '电',
  wall: '墙',
  chair: '椅',
  armchair: '扶',
  sofa: '沙',
  'table-round': '圆',
  'table-square': '方',
  'meeting-table': '谈',
  'meeting-chair': '座',
  'reception-desk': '接',
  'display-case': '柜',
  'display-screen': '屏',
  plant: '植',
  shelf: '架',
  'display-plinth': '台',
  'display-column': '柱',
  'bar-table': '吧',
  'bar-stool': '椅',
  'low-cabinet': '柜',
  'brochure-stand': '资',
  lectern: '讲',
}

const BOOTH_KINDS: BoothKind[] = ['massing', 'scaffold', 'openfloor']
const BASIC_INFRA_ORDER: InfraKind[] = [
  'stairs',
  'restroom',
  'gate',
  'window',
  'elevator',
  'wall',
]
const FURNITURE_ORDER: InfraKind[] = [
  'meeting-table',
  'meeting-chair',
  'reception-desk',
  'display-case',
  'display-screen',
  'plant',
  'shelf',
  'display-plinth',
  'display-column',
  'bar-table',
  'bar-stool',
  'low-cabinet',
  'brochure-stand',
  'lectern',
  'chair',
  'armchair',
  'sofa',
  'table-round',
  'table-square',
]

interface InfraRow {
  type: 'group' | 'item'
  key: string
  depth: number
  label?: string
  badge?: string
  count?: number
  open?: boolean
  item?: Infra
}

/** 默认全部展开；只记录被用户收起的分组 */
const closedInfraGroups = ref<Set<string>>(new Set())

function isInfraGroupOpen(key: string) {
  return !closedInfraGroups.value.has(key)
}

function infraGroupKeysOf(it: Infra): string[] {
  if (!isFurnitureKind(it.kind)) return [`kind:${it.kind}`]
  const host = props.booths.find(
    (booth) => booth.points.length >= 3 && pointInPolygon(it, booth.points),
  )
  const boothKey = `booth:${host?.id ?? '__orphan__'}`
  return [boothKey, `${boothKey}:${it.kind}`]
}

function toggleInfraGroup(key: string) {
  const closing = !closedInfraGroups.value.has(key)
  if (closing) {
    const selected = props.infras.find((it) => it.id === props.selectedInfraId)
    if (selected && infraGroupKeysOf(selected).includes(key)) {
      emit('clear-infra-selection')
    }
  }
  const next = new Set(closedInfraGroups.value)
  if (closing) next.add(key)
  else next.delete(key)
  closedInfraGroups.value = next
}

function ensureInfraGroupsOpen(it: Infra) {
  const keys = infraGroupKeysOf(it)
  if (!keys.some((key) => closedInfraGroups.value.has(key))) return
  const next = new Set(closedInfraGroups.value)
  for (const key of keys) next.delete(key)
  closedInfraGroups.value = next
}

/** 基础设施按类型；家具先按所在展台，再按家具类型 */
const infraRows = computed<InfraRow[]>(() => {
  const rows: InfraRow[] = []
  const nonFurniture = props.infras.filter((it) => !isFurnitureKind(it.kind))

  for (const kind of BASIC_INFRA_ORDER) {
    const items = nonFurniture.filter((it) => it.kind === kind)
    if (!items.length) continue
    const key = `kind:${kind}`
    const open = isInfraGroupOpen(key)
    rows.push({
      type: 'group',
      key,
      depth: 0,
      label: INFRA_LABELS[kind],
      badge: kindShort[kind],
      count: items.length,
      open,
    })
    if (!open) continue
    for (const item of items) {
      rows.push({ type: 'item', key: `item:${item.id}`, depth: 1, item })
    }
  }

  const furniture = props.infras.filter((it) => isFurnitureKind(it.kind))
  if (!furniture.length) return rows

  const byBooth = new Map<string, Infra[]>()
  for (const it of furniture) {
    const host = props.booths.find(
      (booth) => booth.points.length >= 3 && pointInPolygon(it, booth.points),
    )
    const key = host?.id ?? '__orphan__'
    const list = byBooth.get(key) ?? []
    list.push(it)
    byBooth.set(key, list)
  }

  const booths = [
    ...props.booths,
    ...(byBooth.has('__orphan__')
      ? [{ id: '__orphan__', name: '未归开展台', points: [], height: 0 } as Booth]
      : []),
  ]
  for (const booth of booths) {
    const items = byBooth.get(booth.id)
    if (!items?.length) continue
    const boothKey = `booth:${booth.id}`
    const boothOpen = isInfraGroupOpen(boothKey)
    rows.push({
      type: 'group',
      key: boothKey,
      depth: 0,
      label: booth.name,
      badge: booth.id === '__orphan__' ? '?' : '展',
      count: items.length,
      open: boothOpen,
    })
    if (!boothOpen) continue

    for (const kind of FURNITURE_ORDER) {
      const typed = items.filter((it) => it.kind === kind)
      if (!typed.length) continue
      const typeKey = `${boothKey}:${kind}`
      const typeOpen = isInfraGroupOpen(typeKey)
      rows.push({
        type: 'group',
        key: typeKey,
        depth: 1,
        label: INFRA_LABELS[kind],
        badge: kindShort[kind],
        count: typed.length,
        open: typeOpen,
      })
      if (!typeOpen) continue
      for (const item of typed) {
        rows.push({ type: 'item', key: `item:${item.id}`, depth: 2, item })
      }
    }
  }
  return rows
})

const kindLabel = (b: Booth) => BOOTH_KIND_LABELS[boothKindOf(b)]
const heightText = (b: Booth) => (b.height < 1 ? b.height.toFixed(2) : b.height.toFixed(1))

interface SizeField {
  key: 'width' | 'depth' | 'height' | 'sill'
  label: string
  min: number
  max: number
  value: number
  step?: number
}

function fieldsOf(it: Infra): SizeField[] {
  const lim = INFRA_LIMITS[it.kind]
  const currentSill = it.kind === 'window' ? (it.sill ?? WINDOW_SILL) : 0
  const maxH =
    (it.kind === 'gate' || it.kind === 'window') && props.venue
      ? Math.min(
          lim.height[1],
          Math.max(
            lim.height[0],
            Math.floor(props.venue.height - currentSill - 0.15),
          ),
        )
      : lim.height[1]

  if (isFurnitureKind(it.kind)) {
    // 椅子尺寸固定；桌、柜、屏与绿植只调整长宽，高度由类型决定
    if (
      it.kind === 'chair' ||
      it.kind === 'armchair' ||
      it.kind === 'meeting-chair' ||
      it.kind === 'bar-stool'
    ) {
      return []
    }
    return [
      { key: 'width', label: '长', min: lim.width[0], max: lim.width[1], value: it.width },
      { key: 'depth', label: '宽', min: lim.depth[0], max: lim.depth[1], value: it.depth },
    ]
  }

  if (it.kind === 'gate') {
    return [
      {
        key: 'width',
        label: '宽度',
        min: lim.width[0],
        max: lim.width[1],
        value: it.width,
        step: 0.5,
      },
      {
        key: 'height',
        label: '高度',
        min: lim.height[0],
        max: maxH,
        value: it.height,
        step: 0.5,
      },
    ]
  }

  if (it.kind === 'window') {
    const maxSill = Math.max(
      0.2,
      Math.floor(((props.venue?.height ?? 6) - it.height - 0.15) * 10) / 10,
    )
    return [
      { key: 'width', label: '宽度', min: lim.width[0], max: lim.width[1], value: it.width },
      { key: 'height', label: '高度', min: lim.height[0], max: maxH, value: it.height },
      {
        key: 'sill',
        label: '离地',
        min: 0.2,
        max: maxSill,
        value: currentSill,
        step: 0.1,
      },
    ]
  }

  if (it.kind === 'wall') {
    return [
      { key: 'width', label: '长', min: lim.width[0], max: lim.width[1], value: it.width },
      { key: 'height', label: '高度', min: lim.height[0], max: maxH, value: it.height },
    ]
  }

  if (it.kind === 'restroom' || it.kind === 'elevator') {
    return [
      { key: 'width', label: '长', min: lim.width[0], max: lim.width[1], value: it.width },
      { key: 'depth', label: '宽', min: lim.depth[0], max: lim.depth[1], value: it.depth },
      { key: 'height', label: '高度', min: lim.height[0], max: maxH, value: it.height },
    ]
  }

  return [
    { key: 'width', label: '梯宽', min: lim.width[0], max: lim.width[1], value: it.width },
    { key: 'depth', label: '进深', min: lim.depth[0], max: lim.depth[1], value: it.depth },
    { key: 'height', label: '高度', min: lim.height[0], max: maxH, value: it.height },
  ]
}

function dimsText(it: Infra): string {
  if (it.kind === 'gate') {
    return `宽 ${it.width.toFixed(1)} · 高 ${it.height.toFixed(1)} m · ${GATE_OPEN_MODE_LABELS[gateOpenModeOf(it)]} · ${it.open ? '已打开' : '已关闭'}`
  }
  if (it.kind === 'window') {
    return `宽 ${it.width.toFixed(1)} · 高 ${it.height.toFixed(1)} m · 离地 ${(it.sill ?? WINDOW_SILL).toFixed(1)} m`
  }
  if (it.kind === 'wall') {
    return `长 ${it.width.toFixed(1)} · 高 ${it.height.toFixed(1)} m`
  }
  let text = `${it.width.toFixed(1)} × ${it.depth.toFixed(1)} m · 高 ${it.height.toFixed(1)} m`
  if (it.kind === 'elevator') text += ` · ${it.count ?? ELEVATOR_DEFAULT_COUNT} 部`
  return text
}

function onSizeChange(id: string, key: SizeField['key'], e: Event) {
  const input = e.target as HTMLInputElement
  const v = parseFloat(input.value)
  if (!Number.isFinite(v)) return
  const step = Number(input.step) || 1
  const snapped = Math.round(v / step) * step
  const patch: { width?: number; depth?: number; height?: number; sill?: number } = {}
  patch[key] = Number(snapped.toFixed(2))
  emit('infra-size', id, patch)
}

function materialScope(kind: InfraKind): 'furniture' | 'wall' | null {
  if (kind === 'wall') return 'wall'
  return isFurnitureKind(kind) ? 'furniture' : null
}

function materialPresetsOf(kind: InfraKind): MaterialPreset[] {
  const scope = materialScope(kind)
  return scope ? materialPresetsFor(scope, kind) : []
}

function materialLabel(it: Infra): string {
  if (it.texture) return '自定义贴图'
  return materialPresetById(it.material)?.label ?? '默认'
}

function materialSwatchStyle(preset: MaterialPreset) {
  const url = materialPreviewUrl(preset)
  return url
    ? {
        backgroundColor: preset.swatch,
        backgroundImage: `url("${url}")`,
        // 彩色预设是「贴图 × 色板」，色板叠在贴图上才能看出真实的木色 / 布色
        backgroundBlendMode: 'multiply',
      }
    : { backgroundColor: preset.swatch }
}

function selectInfraMaterial(it: Infra, materialId: string | null) {
  emit('infra-material', it.id, {
    material: materialId,
    texture: null,
  })
}

async function onInfraMaterialFile(it: Infra, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  materialUploadingId.value = it.id
  try {
    const texture = await readMaterialImage(file)
    emit('infra-material', it.id, {
      material: null,
      texture,
    })
  } catch (err) {
    emit(
      'material-error',
      err instanceof Error ? err.message : '材质贴图处理失败',
    )
  } finally {
    materialUploadingId.value = null
  }
}

const editingId = ref<string | null>(null)
const draftName = ref('')
let nameEl: HTMLInputElement | null = null

function bindNameInput(el: unknown) {
  if (el) nameEl = el as HTMLInputElement
}

function startEdit(b: Booth) {
  emit('select', b.id, false)
  editingId.value = b.id
  draftName.value = b.name
  nextTick(() => {
    nameEl?.focus()
    nameEl?.select()
  })
}

function commitEdit() {
  const id = editingId.value
  if (!id) return
  const name = draftName.value.trim()
  editingId.value = null
  if (name) emit('rename', id, name)
}

function cancelEdit() {
  editingId.value = null
}

// 基础设施重命名
const editingInfraId = ref<string | null>(null)
const infraNameDraft = ref('')
let infraNameEl: HTMLInputElement | null = null

function bindInfraNameInput(el: unknown) {
  if (el) infraNameEl = el as HTMLInputElement
}

function startInfraEdit(it: Infra) {
  emit('select-infra', it.id)
  editingInfraId.value = it.id
  infraNameDraft.value = it.name
  nextTick(() => {
    infraNameEl?.focus()
    infraNameEl?.select()
  })
}

function commitInfraEdit() {
  const id = editingInfraId.value
  if (!id) return
  const name = infraNameDraft.value.trim()
  editingInfraId.value = null
  if (name) emit('rename-infra', id, name)
}

function cancelInfraEdit() {
  editingInfraId.value = null
}

// 家具预设：只改组合名称，组合内家具属性只读
const presetNameDraft = ref('')
watch(
  () => [props.preset?.id, props.preset?.name] as const,
  () => {
    presetNameDraft.value = props.preset?.name ?? ''
  },
  { immediate: true },
)

function commitPresetName() {
  const preset = props.preset
  if (!preset) return
  const name = presetNameDraft.value.trim().slice(0, 24)
  if (!name) {
    presetNameDraft.value = preset.name
    return
  }
  presetNameDraft.value = name
  if (name !== preset.name) emit('rename-preset', preset.id, name)
}

function presetItemMaterialLabel(id?: string) {
  if (!id) return '默认材质'
  return materialPresetById(id)?.label ?? id
}

function onLogoChange(id: string, e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (file.type !== 'image/png') {
    emit('logo-error', '请选择 PNG 格式的图片')
    return
  }
  if (file.size > 4 * 1024 * 1024) {
    emit('logo-error', 'Logo 图片不能超过 4MB')
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result !== 'string') return
    // 仅保留 base64 内容，去掉 data:image/png;base64, 前缀
    const base64 = reader.result.split(',')[1] ?? ''
    if (base64) emit('logo', id, base64)
  }
  reader.readAsDataURL(file)
}
</script>

<template>
  <aside ref="panelEl" class="panel ap" :class="{ 'detail-only': detailOnly }">
    <div class="panel-head">
      <span class="eyebrow">属性</span>
      <span class="state-badge" :class="{ live: mode !== 'idle' || spaceNav }">
        {{ stateLabel }}
      </span>
    </div>

    <section v-if="preset" class="card preset-card">
      <div class="card-head">
        <span class="swatch solid" />
        <h2>家具预设</h2>
        <span class="count">{{ preset.items.length }} 件</span>
        <span class="spacer" />
        <span class="count">
          {{ preset.width.toFixed(1) }} × {{ preset.depth.toFixed(1) }} m
        </span>
      </div>
      <div class="card-body">
        <div class="card-body-inner">
          <label class="preset-name-row">
            <span>名称</span>
            <input
              v-model="presetNameDraft"
              class="name-input"
              maxlength="24"
              :disabled="renderOnly"
              @blur="commitPresetName"
              @keydown.enter.prevent="commitPresetName"
              @keydown.esc.prevent="presetNameDraft = preset.name"
            />
          </label>
          <p class="row-hint">
            这里只显示组合内的家具信息，单件家具属性不可编辑；布置到展台后可在场景中调整。
          </p>
          <ul class="preset-item-list">
            <li v-for="(item, i) in preset.items" :key="i" class="preset-item">
              <span class="idx">{{ kindShort[item.kind] }}</span>
              <div class="meta">
                <div class="name-line">
                  <b class="name">{{ INFRA_LABELS[item.kind] }}</b>
                  <span class="preset-item-size">
                    {{ item.width.toFixed(2) }} × {{ item.depth.toFixed(2) }} ×
                    {{ item.height.toFixed(2) }} m
                  </span>
                </div>
                <div class="preset-item-meta">
                  {{ presetItemMaterialLabel(item.material) }} · 相对 x
                  {{ item.x.toFixed(2) }} / z {{ item.z.toFixed(2) }} ·
                  {{ Math.round((item.rotation * 180) / Math.PI) }}°
                </div>
              </div>
            </li>
          </ul>
          <div class="preset-card-actions">
            <button
              type="button"
              class="btn sm"
              :disabled="renderOnly"
              @click="emit('place-preset', preset)"
            >
              布置到展台
            </button>
            <button
              v-if="!renderOnly"
              type="button"
              class="btn sm danger"
              @click="emit('delete-preset', preset.id)"
            >
              删除预设
            </button>
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="!preset && (!detailOnly || (!selectedIds.length && !selectedInfraId))"
      class="stats"
    >
      <div><span>场馆面积</span><b>{{ fmt(venueArea) }} m²</b></div>
      <div><span>展台覆盖率</span><b>{{ coverage }}%</b></div>
    </div>

    <div
      v-if="!preset && detailOnly && !selectedIds.length && !selectedInfraId"
      class="detail-title"
    >
      {{ venueName || '场馆' }}
    </div>

    <section
      v-if="!preset && (!detailOnly || (!selectedIds.length && !selectedInfraId))"
      class="card"
      :class="{ collapsed: !venueOpen }"
    >
      <div class="card-head" @click="venueOpen = !venueOpen">
        <span class="swatch solid" />
        <h2>场馆</h2>
        <span class="spacer" />
        <button
          v-if="venue"
          class="icon-btn"
          title="删除场馆"
          @click.stop="emit('delete-venue')"
        >
          ×
        </button>
        <button
          class="collapse-btn"
          type="button"
          :aria-expanded="venueOpen"
          :aria-label="venueOpen ? '收起场馆' : '展开场馆'"
          :title="venueOpen ? '收起' : '展开'"
          @click.stop="venueOpen = !venueOpen"
        >
          <span class="collapse-icon" :class="{ open: venueOpen }" />
        </button>
      </div>

      <div class="card-body" :class="{ collapsed: !venueOpen }">
        <div
          class="card-body-inner"
          :inert="!venueOpen || undefined"
          :aria-hidden="!venueOpen || undefined"
        >
          <template v-if="venue">
        <div class="sec-title">面积</div>
        <div class="kv"><span>占地面积</span><b>{{ fmt(venueArea) }}<em>m²</em></b></div>
        <div class="kv"><span>轮廓周长</span><b>{{ fmt(venuePerimeter) }}<em>m</em></b></div>
        <div class="kv"><span>轮廓顶点</span><b>{{ venue.points.length }}</b></div>
        <div class="sec-title">体量</div>
        <label class="field">
          <div class="field-label"><span>净高</span><b>{{ venue.height }} m</b></div>
          <input
            type="range"
            min="2"
            max="24"
            step="1"
            :value="venueSlider"
            :style="fillStyle(venueSlider, 2, 24)"
            @input="onVenueHeight"
          />
        </label>
        <div class="switch-row">
          <span>半透明</span>
          <button
            class="switch"
            :class="{ on: xray }"
            role="switch"
            :aria-checked="xray"
            title="半透明查看馆内"
            @click="emit('toggle-xray')"
          />
        </div>
        <div class="switch-row">
          <span>去掉顶部</span>
          <button
            class="switch"
            :class="{ on: noTop }"
            role="switch"
            :aria-checked="noTop"
            title="去掉顶部，便于俯视"
            @click="emit('toggle-top')"
          />
        </div>

        <div class="sec-title">规范</div>
        <div class="switch-row">
          <span>启用校验</span>
          <span class="switch-state">{{ rules.enabled ? '已开启' : '已关闭' }}</span>
          <button
            class="switch"
            :class="{ on: rules.enabled }"
            role="switch"
            :aria-checked="rules.enabled"
            title="按下方参数检查排布是否合规"
            @click="emit('update-rule', 'enabled', !rules.enabled)"
          />
        </div>
        <label class="infra-field">
          <span>最小净距</span>
          <input
            type="number"
            min="0"
            max="5"
            step="0.1"
            :value="rules.minGap"
            :disabled="!rules.enabled"
            @change="onRuleNum('minGap', $event)"
          />
          <i>m</i>
        </label>
        <label class="infra-field">
          <span>展台限高</span>
          <input
            type="number"
            min="1"
            max="24"
            step="0.5"
            :value="rules.maxBoothHeight"
            :disabled="!rules.enabled"
            @change="onRuleNum('maxBoothHeight', $event)"
          />
          <i>m</i>
        </label>
        <label class="infra-field">
          <span>主通道</span>
          <input
            type="number"
            min="0"
            max="12"
            step="0.5"
            :value="rules.aisleWidth"
            :disabled="!rules.enabled"
            @change="onRuleNum('aisleWidth', $event)"
          />
          <i>m</i>
        </label>
        <label class="infra-field">
          <span>出入口净宽</span>
          <input
            type="number"
            min="0.6"
            max="6"
            step="0.1"
            :value="rules.minGateWidth"
            :disabled="!rules.enabled"
            @change="onRuleNum('minGateWidth', $event)"
          />
          <i>m</i>
        </label>
        <label class="infra-field">
          <span>出入口数量</span>
          <input
            type="number"
            min="0"
            max="20"
            step="1"
            :value="rules.minGates"
            :disabled="!rules.enabled"
            @change="onRuleNum('minGates', $event)"
          />
          <i>个</i>
        </label>

        <template v-if="rules.enabled">
          <div v-if="issues.length" class="rule-issues">
            <p v-for="(it, i) in issues" :key="i" :class="it.level">{{ it.message }}</p>
          </div>
          <p v-else class="rule-ok">符合当前规范</p>
        </template>


      </template>

      <div v-else class="empty">
        <p>还未绘制场地面积</p>
        <button class="btn primary w-full" @click="emit('draw-venue')">绘制场地面积</button>
      </div>

      <div class="sec-title">参考底图</div>
      <div class="underlay-block">
        <div class="underlay-head">
          <span class="underlay-title">底图</span>
          <span class="underlay-name">{{ underlay?.name || '未上传' }}</span>
          <button
            v-if="underlay"
            class="mini underlay-lock"
            :class="{ on: underlay.locked }"
            :title="underlay.locked ? '解锁底图，恢复 Ctrl + 拖动 / 滚轮 (Alt+L)' : '锁定底图位置和缩放，避免误操作 (Alt+L)'"
            @click="emit('toggle-underlay-lock')"
          >
            {{ underlay.locked ? '已锁定' : '锁定' }}
          </button>
        </div>
        <div class="underlay-actions">
          <button
            class="mini"
            :disabled="underlay?.locked"
            :title="underlay?.locked ? '底图已锁定，请先解锁' : ''"
            @click="pickUnderlay"
          >
            {{ underlay ? '更换图片' : '上传图片' }}
          </button>
          <button
            v-if="underlay"
            class="mini"
            :disabled="underlay.locked"
            :title="underlay.locked ? '底图已锁定，请先解锁' : '将底图移回网格中心，尺寸保持不变'"
            @click="emit('center-underlay')"
          >
            居中
          </button>
          <button
            v-if="underlay"
            class="mini"
            :disabled="underlay.locked"
            :title="underlay.locked ? '底图已锁定，请先解锁' : ''"
            @click="emit('remove-underlay')"
          >
            移除
          </button>
        </div>
        <input
          ref="underlayInput"
          type="file"
          accept="image/jpeg,image/jpg,image/png"
          hidden
          @change="onUnderlayFileChange"
        />
        <label class="field underlay-opacity" :class="{ disabled: !underlayVisible }">
          <div class="field-label">
            <span>底图不透明度</span>
            <b>{{ underlayOpacity }}%</b>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            :value="underlayOpacity"
            :style="fillStyle(underlayOpacity, 0, 100)"
            :disabled="!underlayVisible"
            @input="onUnderlayOpacity"
          />
        </label>
        <p class="underlay-tip">
          Ctrl + 滚轮逐格缩放（每次 1 m）· Ctrl + 左键逐格拖动<br />
          底图尺寸和位置都不受网格限制，可以放大并拖出网格；拖丢后点「居中」找回。锁定后 Ctrl 拖动 / 滚轮、更换 / 居中 / 移除均禁用。
        </p>
      </div>
        </div>
      </div>
    </section>

    <section v-if="!detailOnly || selectedIds.length" class="card" :class="{ collapsed: !boothOpen }">
      <div class="card-head" @click="boothOpen = !boothOpen">
        <span class="swatch" />
        <h2>展台</h2>
        <span class="count">{{ String(booths.length).padStart(2, '0') }}</span>
        <span class="spacer" />
        <span class="count">{{ fmt(boothArea) }} m²</span>
        <button
          class="collapse-btn"
          type="button"
          :aria-expanded="boothOpen"
          :aria-label="boothOpen ? '收起展台' : '展开展台'"
          :title="boothOpen ? '收起' : '展开'"
          @click.stop="boothOpen = !boothOpen"
        >
          <span class="collapse-icon" :class="{ open: boothOpen }" />
        </button>
      </div>

      <div class="card-body" :class="{ collapsed: !boothOpen }">
        <div
          class="card-body-inner"
          :inert="!boothOpen || undefined"
          :aria-hidden="!boothOpen || undefined"
        >
          <div v-if="selectedIds.length >= 2" class="merge-bar">
        <span v-if="singleGroup">合并组 · {{ selectedIds.length }} 个展台</span>
        <span v-else>已选 {{ selectedIds.length }} 个</span>
        <div class="merge-actions">
          <button v-if="grouped" class="btn ghost sm" @click="emit('unmerge')">取消合并</button>
          <button v-if="!singleGroup" class="btn primary sm" @click="emit('merge')">合并展台</button>
        </div>
      </div>

      <ul v-if="detailBooths.length" class="list">
        <li
          v-for="(b, i) in detailBooths"
          :key="b.id"
          :data-booth-id="b.id"
          :class="{
            active: b.id === activeId,
            multi: selectedIds.includes(b.id),
            marked: markColor(b) !== null,
            'mark-red': markColor(b) === 'red',
            'mark-yellow': markColor(b) === 'yellow',
            'mark-gray': markColor(b) === 'gray',
          }"
        >
          <div class="row" @click="onSelect(b.id, $event)">
            <span class="idx">{{ i + 1 }}</span>
            <div class="meta">
              <div class="name-line">
                <input
                  v-if="editingId === b.id"
                  :ref="bindNameInput"
                  v-model="draftName"
                  class="name-input"
                  maxlength="24"
                  @click.stop
                  @blur="commitEdit"
                  @keydown.enter.prevent="commitEdit"
                  @keydown.esc.prevent="cancelEdit"
                />
                <template v-else>
                  <b class="name">
                    <span
                      v-if="b.groupId"
                      class="gdot"
                      :style="{ background: groupCss(b.groupId) }"
                      :title="`已合并：${b.groupId}`"
                    />{{ b.name }}
                  </b>
                  <button
                    type="button"
                    class="name-edit"
                    title="重命名"
                    @click.stop="startEdit(b)"
                  >
                    ✎
                  </button>
                </template>
              </div>
              <span v-if="b.exhibitor" class="exhibitor-line">{{ b.exhibitor }}</span>
              <span>
                {{ fmt(areaOf(b)) }} m² · 高 {{ heightText(b) }} m
                <em v-if="boothKindOf(b) !== 'massing'" class="kind-tag">{{ kindLabel(b) }}</em>
              </span>
            </div>
            <button class="icon-btn" title="删除展台" @click.stop="emit('delete-booth', b.id)">
              ×
            </button>
          </div>

          <template v-if="b.id === activeId && venue && canEdit">
            <div class="sec-title">几何</div>
            <div class="row-kind">
              <span>类型</span>
              <div class="kind-switch">
                <button
                  v-for="k in BOOTH_KINDS"
                  :key="k"
                  type="button"
                  class="mini"
                  :class="{ on: boothKindOf(b) === k }"
                  @click.stop="emit('booth-kind', b.id, k)"
                >
                  {{ BOOTH_KIND_LABELS[k] }}
                </button>
              </div>

            </div>
            <div class="row-size">
              <label class="infra-field">
                <span>长</span>
                <input
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  :value="boothSize(b).width"
                  @change="onBoothSize(b.id, 'width', $event)"
                />
                <i>m</i>
              </label>
              <label class="infra-field">
                <span>宽</span>
                <input
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  :value="boothSize(b).depth"
                  @change="onBoothSize(b.id, 'depth', $event)"
                />
                <i>m</i>
              </label>
            </div>
            <div v-if="boothKindOf(b) !== 'openfloor'" class="row-edit">
              <span class="row-lab">高度</span>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                :value="b.height"
                :style="fillStyle(b.height, 1, 8)"
                @input="onBoothHeight(b.id, 1, 8, $event)"
              />
              <span class="edit-val">{{ heightText(b) }} m</span>
            </div>
            <div v-else class="row-edit">
              <span class="row-lab">高度</span>
              <span class="edit-val">光地平台 {{ heightText(b) }} m</span>
            </div>
            <div v-if="boothKindOf(b) === 'massing'" class="switch-row">
              <span>顶板</span>
              <button
                type="button"
                class="switch"
                :class="{ on: b.noTop !== true }"
                role="switch"
                :aria-checked="b.noTop !== true"
                aria-label="顶板"
                :title="b.noTop ? '恢复顶板与立柱' : '去掉顶板与立柱'"
                @click.stop="emit('booth-top', b.id, b.noTop !== true)"
              />
              <span class="switch-state">{{ b.noTop ? '已去除' : '保留' }}</span>
            </div>
            <div v-else-if="boothKindOf(b) === 'scaffold'" class="switch-row">
              <span>顶棚</span>
              <button
                type="button"
                class="switch"
                :class="{ on: b.canopy !== false }"
                role="switch"
                :aria-checked="b.canopy !== false"
                aria-label="顶棚"
                :title="b.canopy !== false ? '关闭顶棚' : '开启顶棚'"
                @click.stop="emit('booth-canopy', b.id, b.canopy === false)"
              />
              <span class="switch-state">{{ b.canopy !== false ? '开启' : '关闭' }}</span>
            </div>
            <div class="row-tools">
              <span class="row-lab">旋转</span>
              <button class="mini" title="逆时针旋转 90°" @click.stop="emit('rotate', -1)">↺ 90°</button>
              <button class="mini" title="顺时针旋转 90°" @click.stop="emit('rotate', 1)">↻ 90°</button>
            </div>
            <div class="row-tools">
              <span class="row-lab">阵列</span>
              <input
                class="mini-num"
                type="number"
                min="1"
                max="20"
                step="1"
                :value="arrayCount"
                title="复制数量"
                @change="arrayCount = clampInt($event, 1, 20)"
              />
              <input
                class="mini-num"
                type="number"
                min="0.5"
                max="50"
                step="0.5"
                :value="arrayGap"
                title="间距（米）"
                @change="arrayGap = clampNum($event, 0.5, 50)"
              />
              <button class="mini" title="沿 X 轴阵列复制" @click.stop="emit('array-booth', b.id, arrayCount, arrayGap, 'x')">→</button>
              <button class="mini" title="沿 Z 轴阵列复制" @click.stop="emit('array-booth', b.id, arrayCount, arrayGap, 'z')">↓</button>
            </div>
            <div class="sec-title">外观</div>
            <label class="infra-field exhibitor-field">
              <span>展商</span>
              <input
                type="text"
                maxlength="60"
                placeholder="可选"
                :value="b.exhibitor ?? ''"
                @click.stop
                @change="onExhibitorChange(b.id, $event)"
              />
            </label>
            <div class="row-logo">
              <span class="row-lab">Logo</span>
              <label class="mini logo-upload">
                {{ b.logo ? '更换' : '上传' }}
                <input type="file" accept="image/png" @change="onLogoChange(b.id, $event)" />
              </label>
              <button v-if="b.logo" class="mini" @click.stop="emit('remove-logo', b.id)">
                移除
              </button>
            </div>
            <div class="sec-title">标记</div>
            <div class="row-mark">
              <span class="mark-label">标记</span>
              <button
                v-for="m in MARK_OPTIONS"
                :key="m.value"
                type="button"
                class="mark-swatch"
                :class="[m.value, { on: markColor(b) === m.value }]"
                :title="m.label"
                :aria-pressed="markColor(b) === m.value"
                @click.stop="
                  emit('set-mark', b.id, markColor(b) === m.value ? null : m.value)
                "
              />
              <span class="mini-hint">红 / 黄 / 灰分组</span>
            </div>
            <p class="row-hint">拖动可移动，Alt + 拖动旋转，Ctrl + C 复制。</p>
          </template>
        </li>
      </ul>

      <p v-else class="empty-line">在馆内画出展台轮廓并设置高度，即可生成展台白膜。</p>

      <div v-if="!detailOnly" class="booth-add" data-add-section="booth">
        <button
          class="btn sm"
          :class="{ primary: !!venue && !booths.length }"
          :disabled="!venue || mode !== 'idle'"
          @click="emit('draw-booth', 'massing')"
        >
          + 标准
        </button>
        <button
          class="btn sm"
          :disabled="!venue || mode !== 'idle'"
          @click="emit('draw-booth', 'scaffold')"
        >
          + 脚手架
        </button>
        <button
          class="btn sm"
          :disabled="!venue || mode !== 'idle'"
          @click="emit('draw-booth', 'openfloor')"
        >
          + 光地
        </button>
      </div>
      <p v-if="!venue" class="empty-line" style="margin-bottom: 0">先创建场馆后才能添加展台</p>
      <p v-else class="booth-kind-hint">
        脚手架 / 光地底部均为 15cm 微凸台板；脚手架上部架空、可选顶棚。
      </p>
        </div>
      </div>
    </section>

    <section v-if="!detailOnly || selectedInfraId" class="card" :class="{ collapsed: !infraOpen }">
      <div class="card-head" @click="infraOpen = !infraOpen">
        <span class="swatch infra" />
        <h2>基础设施</h2>
        <span class="count">{{ String(infras.length).padStart(2, '0') }}</span>
        <span class="spacer" />
        <button
          class="collapse-btn"
          type="button"
          :aria-expanded="infraOpen"
          :aria-label="infraOpen ? '收起基础设施' : '展开基础设施'"
          :title="infraOpen ? '收起' : '展开'"
          @click.stop="infraOpen = !infraOpen"
        >
          <span class="collapse-icon" :class="{ open: infraOpen }" />
        </button>
      </div>

      <div class="card-body" :class="{ collapsed: !infraOpen }">
        <div
          class="card-body-inner"
          :inert="!infraOpen || undefined"
          :aria-hidden="!infraOpen || undefined"
        >
          <div v-if="!detailOnly" class="infra-add" data-add-section="infra">
        <button class="btn sm" :disabled="mode !== 'idle'" @click="emit('add-infra', 'stairs')">
          + 楼梯
        </button>
        <button class="btn sm" :disabled="mode !== 'idle'" @click="emit('add-infra', 'restroom')">
          + 洗手间
        </button>
        <button class="btn sm" :disabled="mode !== 'idle'" @click="emit('add-infra', 'elevator')">
          + 电梯间
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !venue"
          @click="emit('add-infra', 'gate')"
        >
          + 出入口
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !venue"
          @click="emit('add-infra', 'window')"
        >
          + 窗户
        </button>
        <button class="btn sm" :disabled="mode !== 'idle'" @click="emit('add-infra', 'wall')">
          + 墙面
        </button>
      </div>

      <p class="infra-subhead">家具 · 仅限展台内部</p>
      <div v-if="!detailOnly" class="infra-add" data-add-section="furniture">
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'chair')"
        >
          + 圆座椅
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'armchair')"
        >
          + 扶手椅
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'sofa')"
        >
          + 沙发
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'table-round')"
        >
          + 圆茶几
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'table-square')"
        >
          + 方茶几
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'meeting-table')"
        >
          + 洽谈桌
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'meeting-chair')"
        >
          + 洽谈椅
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'reception-desk')"
        >
          + 接待台
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'display-case')"
        >
          + 展柜
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'display-screen')"
        >
          + 显示屏
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'plant')"
        >
          + 绿植
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'shelf')"
        >
          + 层架
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'display-plinth')"
        >
          + 样品台
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'display-column')"
        >
          + 样品柱
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'bar-table')"
        >
          + 吧桌
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'bar-stool')"
        >
          + 吧椅
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'low-cabinet')"
        >
          + 矮柜
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'brochure-stand')"
        >
          + 资料架
        </button>
        <button
          class="btn sm"
          :disabled="mode !== 'idle' || !booths.length"
          @click="emit('add-infra', 'lectern')"
        >
          + 讲台
        </button>
      </div>
      <p v-if="!booths.length" class="empty-line" style="margin-top: 0">
        先添加展台才能摆放家具
      </p>

      <ul v-if="infras.length" class="list infra-tree">
        <template v-for="row in detailInfraRows" :key="row.key">
          <li
            v-if="row.type === 'group'"
            class="infra-group-li"
            :class="{ 'infra-subgroup-li': row.depth === 1 }"
          >
            <button
              type="button"
              class="infra-group-head"
              :class="{ open: row.open }"
              :aria-expanded="row.open"
              @click="toggleInfraGroup(row.key)"
            >
              <span class="infra-group-badge">{{ row.badge }}</span>
              <span class="infra-group-label">{{ row.label }}</span>
              <span class="infra-group-count">{{ row.count }}</span>
              <span class="infra-caret" />
            </button>
          </li>
          <li
            v-else-if="row.item"
            class="infra-item-li"
            :data-infra-id="row.item.id"
            :class="{
              active: row.item.id === selectedInfraId,
              'infra-item-depth-2': row.depth === 2,
            }"
          >
            <template v-for="it in [row.item]" :key="row.item.id">
              <div class="row" @click="emit('select-infra', it.id)">
                <span class="idx">{{ kindShort[it.kind] }}</span>
                <div class="meta">
                  <div class="name-line">
                    <input
                      v-if="editingInfraId === it.id"
                      :ref="bindInfraNameInput"
                      v-model="infraNameDraft"
                      class="name-input"
                      maxlength="24"
                      @click.stop
                      @blur="commitInfraEdit"
                      @keydown.enter.prevent="commitInfraEdit"
                      @keydown.esc.prevent="cancelInfraEdit"
                    />
                    <template v-else>
                      <b class="name">{{ it.name }}</b>
                      <button
                        type="button"
                        class="name-edit"
                        title="重命名"
                        @click.stop="startInfraEdit(it)"
                      >
                        ✎
                      </button>
                    </template>
                  </div>
                  <span>{{ dimsText(it) }}</span>
                </div>
                <button class="icon-btn" title="删除" @click.stop="emit('delete-infra', it.id)">×</button>
              </div>
              <div v-if="it.id === selectedInfraId" class="infra-edit">
                <div class="sec-title">几何</div>
                <div v-if="it.kind === 'gate'" class="row-kind infra-mode-row">
                  <span>开启</span>
                  <div class="kind-switch">
                    <button
                      v-for="mode in GATE_OPEN_MODES"
                      :key="mode"
                      type="button"
                      class="mini"
                      :class="{ on: gateOpenModeOf(it) === mode }"
                      @click.stop="emit('gate-open-mode', it.id, mode)"
                    >
                      {{ GATE_OPEN_MODE_LABELS[mode] }}
                    </button>
                  </div>
                </div>
                <p
                  v-if="
                    it.kind === 'chair' ||
                    it.kind === 'armchair' ||
                    it.kind === 'meeting-chair' ||
                    it.kind === 'bar-stool'
                  "
                  class="infra-fixed"
                >
                  固定尺寸 {{ it.width.toFixed(1) }} × {{ it.depth.toFixed(1) }} ×
                  {{ it.height.toFixed(1) }} m
                  <template v-if="it.kind === 'armchair'"> · 座高 0.5 m</template>
                  <template v-if="it.kind === 'meeting-chair'"> · 座高 0.45 m</template>
                  <template v-if="it.kind === 'bar-stool'"> · 座高 0.75 m</template>
                </p>
                <label v-for="f in fieldsOf(it)" :key="f.key" class="infra-field">
                  <span>{{ f.label }}</span>
                  <input
                    type="number"
                    :min="f.min"
                    :max="Number.isFinite(f.max) ? f.max : undefined"
                    :step="f.step ?? 1"
                    :value="f.step && f.step < 1 ? f.value.toFixed(1) : Math.round(f.value)"
                    @change="onSizeChange(it.id, f.key, $event)"
                  />
                  <i>m</i>
                </label>

                <div v-if="materialScope(it.kind)" class="sec-title">材质</div>
                <div v-if="materialScope(it.kind)" class="infra-material">
                  <div class="infra-material-head">
                    <span>材质</span>
                    <em>{{ materialLabel(it) }}</em>
                  </div>
                  <div class="material-grid">
                    <button
                      type="button"
                      class="material-swatch default"
                      :class="{ on: !it.material && !it.texture }"
                      title="默认材质"
                      @click.stop="selectInfraMaterial(it, null)"
                    >
                      默认
                    </button>
                    <button
                      v-for="preset in materialPresetsOf(it.kind)"
                      :key="preset.id"
                      type="button"
                      class="material-swatch"
                      :class="{
                        on: it.material === preset.id && !it.texture,
                      }"
                      :style="materialSwatchStyle(preset)"
                      :title="preset.label"
                      :aria-label="preset.label"
                      @click.stop="selectInfraMaterial(it, preset.id)"
                    />
                    <button
                      v-if="it.texture"
                      type="button"
                      class="material-swatch custom on"
                      :style="{ backgroundImage: `url(${it.texture})` }"
                      title="自定义贴图"
                      @click.stop
                    />
                  </div>
                  <div class="infra-material-actions">
                    <label
                      class="mini material-upload"
                      :class="{ disabled: materialUploadingId === it.id }"
                    >
                      {{
                        materialUploadingId === it.id
                          ? '处理中…'
                          : '上传自定义贴图'
                      }}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        @change="onInfraMaterialFile(it, $event)"
                      />
                    </label>
                    <button
                      v-if="it.texture"
                      type="button"
                      class="mini"
                      @click.stop="selectInfraMaterial(it, null)"
                    >
                      清除贴图
                    </button>
                  </div>
                </div>

                <div class="sec-title">变换</div>
                <div class="infra-tools">
                  <template v-if="it.kind !== 'gate' && it.kind !== 'window'">
                    <button class="mini" title="逆时针旋转 90°" @click.stop="emit('rotate-infra', it.id, -1)">
                      ↺ 90°
                    </button>
                    <button class="mini" title="顺时针旋转 90°" @click.stop="emit('rotate-infra', it.id, 1)">
                      ↻ 90°
                    </button>
                  </template>

                  <button
                    v-else-if="it.kind === 'gate'"
                    class="mini door-toggle"
                    :class="{ on: it.open }"
                    @click.stop="emit('toggle-gate', it.id)"
                  >
                    {{ it.open ? '关闭出入口' : '打开出入口' }}
                  </button>
                  <span v-else class="mini-hint">窗户朝向由外墙决定</span>

                  <template v-if="it.kind === 'elevator'">
                    <span class="infra-count-label">电梯</span>
                    <button class="mini" @click.stop="emit('infra-count', it.id, -1)">−</button>
                    <b class="infra-count-val">{{ it.count ?? 2 }}</b>
                    <button class="mini" @click.stop="emit('infra-count', it.id, 1)">+</button>
                  </template>
                </div>
              </div>
            </template>
          </li>
        </template>
      </ul>

      <p v-else class="empty-line">
        添加半截楼梯、洗手间、内墙，或在展台内部摆放家具。
      </p>
        </div>
      </div>
    </section>

    <p class="hint-box">
      左键拖拽旋转视角 / 滚轮缩放 / 右键拖动或空格+右键拖动平移 /
      右键单击旋转展台或设施（出入口除外）/ 空格+左键拖拽仅旋转视角；
      Ctrl(⌘) 点选可多选展台，Delete 删除，绘制时 Esc 取消。
    </p>
  </aside>
</template>
