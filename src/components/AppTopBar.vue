<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppToolbar from './AppToolbar.vue'
import WeatherIcon from './WeatherIcon.vue'
import type { LiveWeather } from '../core/amapWeather'
import type { QualityLevel } from '../core/Stage'

type ToolMenu = 'view' | 'display' | 'quality' | 'data'

const props = defineProps<{
  venueName: string
  editingVenueName: boolean
  simTime: string
  sunIsDay: boolean
  liveWeather: LiveWeather | null
  weatherOn: boolean
  canUndo: boolean
  canRedo: boolean
  renderOnly: boolean
  hasVenue: boolean
  presenting: boolean
  quality: QualityLevel
  qualityLabel: string
  boothLabelsOn: boolean
  infraLabelsOn: boolean
  furnitureLabelsOn: boolean
  dimOn: boolean
  areaOn: boolean
  aisleOn?: boolean
  gridOn: boolean
  hasUnderlay: boolean
  underlayVisible: boolean
  weatherActive: boolean
  walkActive: boolean
  toolMenu: ToolMenu | null
  toolSubMenu: 'names' | null
}>()

const emit = defineEmits<{
  (e: 'update:venue-name', v: string): void
  (e: 'begin-rename'): void
  (e: 'finish-rename'): void
  (e: 'cancel-rename'): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'set-render', on: boolean): void
  (e: 'report'): void
  (e: 'export'): void
  (e: 'export-csv'): void
  (e: 'import'): void
  (e: 'clear-data'): void
  (e: 'open-weather'): void
  (e: 'open-help'): void
  (e: 'open-multiplayer'): void
  (e: 'toggle-walk'): void
  (e: 'view-top'): void
  (e: 'view-iso'): void
  (e: 'fit-view'): void
  (e: 'presentation'): void
  (e: 'choose-quality', level: QualityLevel): void
  (e: 'toggle-menu', menu: ToolMenu): void
  (e: 'toggle-name-submenu'): void
  (e: 'toggle-booth-labels'): void
  (e: 'toggle-infra-labels'): void
  (e: 'toggle-furniture-labels'): void
  (e: 'toggle-dimensions'): void
  (e: 'toggle-areas'): void
  (e: 'toggle-aisle'): void
  (e: 'toggle-grid'): void
  (e: 'toggle-underlay'): void
}>()

const nameDraft = ref('')
const nameEl = ref<HTMLInputElement | null>(null)

/** 顶栏时钟显示本机真实时间，与太阳时间轴解耦 */
const now = ref(new Date())
let clockTimer = 0
const weekText = '日一二三四五六'

const nowText = computed(() => {
  const d = now.value
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

const dateText = computed(() => {
  const d = now.value
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${weekText[d.getDay()]}`
})

onMounted(() => {
  clockTimer = window.setInterval(() => {
    now.value = new Date()
  }, 20000)
})

onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
})

function beginRename() {
  if (props.renderOnly) return
  nameDraft.value = props.venueName
  emit('begin-rename')
  nextTick(() => {
    nameEl.value?.focus()
    nameEl.value?.select()
  })
}

function commitName() {
  const v = nameDraft.value.trim()
  if (v) emit('update:venue-name', v)
  emit('finish-rename')
}

function cancelName() {
  emit('cancel-rename')
}
</script>

<template>
  <header class="wb-top">
    <div class="wb-brand">
      <span class="wb-logo">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.6l8.6 4.8v9.2L12 21.4l-8.6-4.8V7.4z" />
          <path d="M12 2.6v9.4M12 12l8.6-4.6M12 12L3.4 7.4" />
        </svg>
      </span>
      <span class="wb-name">场馆白膜</span>
    </div>

    <input
      v-if="editingVenueName"
      ref="nameEl"
      v-model="nameDraft"
      class="wb-venue-input"
      maxlength="24"
      @blur="commitName"
      @keydown.enter.prevent="commitName"
      @keydown.esc.prevent="cancelName"
    />
    <button v-else type="button" class="wb-venue" :title="renderOnly ? '预览模式' : '点击重命名场馆'" @click="beginRename">
      <span class="txt">{{ venueName }}</span>
      <span v-if="!renderOnly" class="caret" />
    </button>

    <span v-if="renderOnly" class="wb-badge"><b>只读</b></span>

    <span class="wb-sep" />

    <AppToolbar
      :is-mobile="false"
      :tools-collapsed="false"
      :tool-menu="toolMenu"
      :tool-sub-menu="toolSubMenu"
      :has-venue="hasVenue"
      :render-only="renderOnly"
      :quality="quality"
      :quality-label="qualityLabel"
      :booth-labels-on="boothLabelsOn"
      :infra-labels-on="infraLabelsOn"
      :furniture-labels-on="furnitureLabelsOn"
      :dim-on="dimOn"
      :area-on="areaOn"
      :aisle-on="aisleOn"
      :grid-on="gridOn"
      :has-underlay="hasUnderlay"
      :underlay-visible="underlayVisible"
      :weather-active="weatherActive"
      :walk-active="walkActive"
      @toggle-collapse="() => {}"
      @toggle-menu="(m) => emit('toggle-menu', m)"
      @toggle-name-submenu="emit('toggle-name-submenu')"
      @toggle-booth-labels="emit('toggle-booth-labels')"
      @toggle-infra-labels="emit('toggle-infra-labels')"
      @toggle-furniture-labels="emit('toggle-furniture-labels')"
      @toggle-dimensions="emit('toggle-dimensions')"
      @toggle-areas="emit('toggle-areas')"
      @toggle-aisle="emit('toggle-aisle')"
      @toggle-grid="emit('toggle-grid')"
      @toggle-underlay="emit('toggle-underlay')"
      @view-top="emit('view-top')"
      @view-iso="emit('view-iso')"
      @fit-view="emit('fit-view')"
      @presentation="emit('presentation')"
      @choose-quality="(l) => emit('choose-quality', l)"
      @report="emit('report')"
      @export="emit('export')"
      @export-csv="emit('export-csv')"
      @import="emit('import')"
      @clear-data="emit('clear-data')"
      @open-weather="emit('open-weather')"
      @open-help="emit('open-help')"
      @open-multiplayer="emit('open-multiplayer')"
      @toggle-walk="emit('toggle-walk')"
    />

    <span class="wb-sp" />

    <div class="wb-clock" :title="`本机时间 ${nowText} · ${dateText}`">
      <span>{{ nowText }}</span>
      <span v-if="liveWeather && weatherOn" class="wx">
        <WeatherIcon :kind="liveWeather.kind" :size="12" />
        {{ liveWeather.weather }} {{ liveWeather.temperature }}°
      </span>
      <span v-else class="wx">{{ dateText }}</span>
    </div>

    <button type="button" class="wb-iconbtn" :disabled="!canUndo" title="撤销 Ctrl+Z" @click="emit('undo')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 7 4 12l5 5" />
        <path d="M4 12h9a5 5 0 0 1 5 5v1" />
      </svg>
    </button>
    <button type="button" class="wb-iconbtn" :disabled="!canRedo" title="重做 Ctrl+Y" @click="emit('redo')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m15 7 5 5-5 5" />
        <path d="M20 12h-9a5 5 0 0 0-5 5v1" />
      </svg>
    </button>

    <span class="wb-sep" />

    <button type="button" class="wb-btn pri" @click="emit('export')">导出</button>
    <button
      type="button"
      class="wb-iconbtn"
      :class="{ on: presenting }"
      :disabled="!hasVenue"
      :title="presenting ? '退出展示模式 (Esc)' : '展示模式 (S)'"
      @click="emit('presentation')"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4.4" width="18" height="11.6" rx="1.6" />
        <path d="M12 16v3.4M8.8 19.4h6.4" />
        <path d="M10.5 8.3l4.2 2.1-4.2 2.1z" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <button
      type="button"
      class="wb-iconbtn"
      :class="{ on: renderOnly }"
      :title="renderOnly ? '退出预览' : '预览模式（隐藏编辑）'"
      @click="emit('set-render', !renderOnly)"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2.6 12S6.1 5.9 12 5.9 21.4 12 21.4 12 17.9 18.1 12 18.1 2.6 12 2.6 12z" />
        <circle cx="12" cy="12" r="2.7" />
      </svg>
    </button>
  </header>
</template>
