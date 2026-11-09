<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { BOOTH_KIND_LABELS, boothKindOf } from '../core/booth'
import { groupCss } from '../core/groupColor'
import {
  ELEVATOR_DEFAULT_COUNT,
  INFRA_LIMITS,
  WINDOW_SILL,
  isFurnitureKind,
} from '../core/infra'
import { boundsOf, perimeter, polygonArea } from '../core/polygon'
import type {
  Booth,
  BoothKind,
  BoothMark,
  EditorMode,
  Infra,
  InfraKind,
  Underlay,
  Venue,
} from '../core/types'

const props = defineProps<{
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
  underlay: Underlay | null
  selectedInfraId: string | null
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
}>()

/** 三个结构卡片的展开状态 */
const venueOpen = ref(true)
const boothOpen = ref(true)
const infraOpen = ref(true)

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
  (e: 'booth-size', id: string, patch: { width?: number; depth?: number }): void
  (e: 'set-mark', id: string, mark: BoothMark | null): void
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
  (e: 'infra-count', id: string, delta: number): void
  (e: 'rename-infra', id: string, name: string): void
  (e: 'logo', id: string, dataUrl: string): void
  (e: 'remove-logo', id: string): void
  (e: 'logo-error', message: string): void
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

watch(
  () => props.selectedInfraId,
  (id) => {
    if (id) revealInfra(id)
  },
)

watch(
  () => props.selectedIds,
  (ids) => {
    const id = ids[ids.length - 1]
    if (id) revealBooth(id)
  },
)

// 移动端抽屉从隐藏切到显示后，重新展开并滚动到当前选中的模型
watch(
  () => props.mobileOpen,
  (open) => {
    if (!open) return
    const infraId = props.selectedInfraId
    if (infraId) {
      revealInfra(infraId)
      return
    }
    const id = props.selectedIds[props.selectedIds.length - 1]
    if (id) revealBooth(id)
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
}

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
    // 椅子尺寸固定；沙发与茶几只调整长宽，高度由类型决定
    if (it.kind === 'chair' || it.kind === 'armchair') return []
    return [
      { key: 'width', label: '长', min: lim.width[0], max: lim.width[1], value: it.width },
      { key: 'depth', label: '宽', min: lim.depth[0], max: lim.depth[1], value: it.depth },
    ]
  }

  if (it.kind === 'gate') {
    return [
      { key: 'width', label: '宽度', min: lim.width[0], max: lim.width[1], value: it.width },
      { key: 'height', label: '高度', min: lim.height[0], max: maxH, value: it.height },
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
    return `宽 ${it.width.toFixed(1)} · 高 ${it.height.toFixed(1)} m · ${it.open ? '已打开' : '已关闭'}`
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
  const v = parseFloat((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  const patch: { width?: number; depth?: number; height?: number; sill?: number } = {}
  patch[key] = key === 'sill' ? Math.round(v * 10) / 10 : Math.round(v)
  emit('infra-size', id, patch)
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
  <aside ref="panelEl" class="panel">
    <div class="panel-head">
      <span class="eyebrow">场景结构</span>
      <span class="state-badge" :class="{ live: mode !== 'idle' || spaceNav }">
        {{ stateLabel }}
      </span>
    </div>

    <div class="stats">
      <div><span>场馆面积</span><b>{{ fmt(venueArea) }} m²</b></div>
      <div><span>展台覆盖率</span><b>{{ coverage }}%</b></div>
    </div>

    <section class="card" :class="{ collapsed: !venueOpen }">
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
        <div class="kv"><span>占地面积</span><b>{{ fmt(venueArea) }}<em>m²</em></b></div>
        <div class="kv"><span>轮廓周长</span><b>{{ fmt(venuePerimeter) }}<em>m</em></b></div>
        <div class="kv"><span>轮廓顶点</span><b>{{ venue.points.length }}</b></div>
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
        <div class="venue-view">
          <button class="vtoggle" :class="{ on: xray }" @click="emit('toggle-xray')">半透明</button>
          <button class="vtoggle" :class="{ on: noTop }" @click="emit('toggle-top')">去掉顶部</button>
        </div>
        <button class="btn w-full" style="margin-top: 8px" @click="emit('draw-venue')">
          重新绘制场馆
        </button>
      </template>

      <div v-else class="empty">
        <p>还未绘制场地面积</p>
        <button class="btn primary w-full" @click="emit('draw-venue')">绘制场地面积</button>
      </div>

      <div class="underlay-block">
        <div class="underlay-head">
          <span class="underlay-title">底图</span>
          <span class="underlay-name">{{ underlay?.name || '未上传' }}</span>
          <button
            v-if="underlay"
            class="mini underlay-lock"
            :class="{ on: underlay.locked }"
            :title="underlay.locked ? '解锁底图，恢复 Ctrl + 拖动 / 滚轮' : '锁定底图位置和缩放，避免误操作'"
            @click="emit('toggle-underlay-lock')"
          >
            {{ underlay.locked ? '已锁定' : '锁定' }}
          </button>
        </div>
        <div class="underlay-actions">
          <button class="mini" @click="pickUnderlay">
            {{ underlay ? '更换图片' : '上传图片' }}
          </button>
          <button
            v-if="underlay"
            class="mini"
            title="将底图移回网格中心，尺寸保持不变"
            @click="emit('center-underlay')"
          >
            居中
          </button>
          <button v-if="underlay" class="mini" @click="emit('remove-underlay')">
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
          底图尺寸和位置都不受网格限制，可以放大并拖出网格；拖丢后点「居中」找回。锁定后 Ctrl 拖动 / 滚轮对底图无效。
        </p>
      </div>
        </div>
      </div>
    </section>

    <section class="card" :class="{ collapsed: !boothOpen }">
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

      <ul v-if="booths.length" class="list">
        <li
          v-for="(b, i) in booths"
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
            <div class="row-size">
              <label class="infra-field exhibitor-field">
                <span>展商</span>
                <input
                  type="text"
                  maxlength="60"
                  placeholder="可选，输入展商名称"
                  :value="b.exhibitor ?? ''"
                  @click.stop
                  @change="onExhibitorChange(b.id, $event)"
                />
              </label>
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
              <span class="edit-val">光地平台 · 高 {{ heightText(b) }} m</span>
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
              <button class="mini" title="逆时针旋转 90°" @click.stop="emit('rotate', -1)">↺ 90°</button>
              <button class="mini" title="顺时针旋转 90°" @click.stop="emit('rotate', 1)">↻ 90°</button>
              <span class="mini-hint">拖动可移动 · Alt+拖动旋转</span>
            </div>
            <div class="row-logo">
              <label class="mini logo-upload">
                {{ b.logo ? '更换 Logo' : '上传 Logo' }}
                <input type="file" accept="image/png" @change="onLogoChange(b.id, $event)" />
              </label>
              <button v-if="b.logo" class="mini" @click.stop="emit('remove-logo', b.id)">
                移除 Logo
              </button>
              <span class="mini-hint">PNG · 正面左下角</span>
            </div>
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
          </template>
        </li>
      </ul>

      <p v-else class="empty-line">在馆内画出展台轮廓并设置高度，即可生成展台白膜。</p>

      <div class="booth-add">
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

    <section class="card" :class="{ collapsed: !infraOpen }">
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
          <div class="infra-add">
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
      <div class="infra-add">
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
      </div>
      <p v-if="!booths.length" class="empty-line" style="margin-top: 0">
        先添加展台才能摆放家具
      </p>

      <ul v-if="infras.length" class="list">
        <li
          v-for="it in infras"
          :key="it.id"
          :data-infra-id="it.id"
          :class="{ active: it.id === selectedInfraId }"
        >
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
            <p v-if="it.kind === 'chair' || it.kind === 'armchair'" class="infra-fixed">
              固定尺寸 {{ it.width.toFixed(1) }} × {{ it.depth.toFixed(1) }} ×
              {{ it.height.toFixed(1) }} m
              <template v-if="it.kind === 'armchair'"> · 座高 0.5 m</template>
            </p>
            <label v-for="f in fieldsOf(it)" :key="f.key" class="infra-field">
              <span>{{ f.label }}</span>
              <input
                type="number"
                :min="f.min"
                :max="f.max"
                :step="f.step ?? 1"
                :value="f.step && f.step < 1 ? f.value.toFixed(1) : Math.round(f.value)"
                @change="onSizeChange(it.id, f.key, $event)"
              />
              <i>m</i>
            </label>

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
        </li>
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
