<script setup lang="ts">
import { computed, ref } from 'vue'
import WeatherIcon from './WeatherIcon.vue'
import type { LiveWeather } from '../core/amapWeather'
import { boothKindOf, BOOTH_KIND_LABELS } from '../core/booth'
import { polygonArea } from '../core/polygon'
import type { QualityLevel } from '../core/Stage'
import type { Booth, Infra, Underlay, Venue } from '../core/types'
import type { WeatherKind } from '../core/weather'

const props = defineProps<{
  venue: Venue | null
  venueName: string
  booths: Booth[]
  infras: Infra[]
  underlay: Underlay | null
  venueArea: number
  boothArea: number
  coverage: number
  quality: QualityLevel
  qualityLabel: string
  gridOn: boolean
  dimOn: boolean
  areaOn: boolean
  boothLabelsOn: boolean
  infraLabelsOn: boolean
  weather: WeatherKind
  weatherOn: boolean
  liveWeather: LiveWeather | null
  renderOnly: boolean
  canWalk: boolean
  selectedIds: string[]
  selectedInfraId: string | null
}>()

const emit = defineEmits<{
  (e: 'view-top'): void
  (e: 'view-iso'): void
  (e: 'fit-view'): void
  (e: 'toggle-grid'): void
  (e: 'toggle-dimensions'): void
  (e: 'toggle-areas'): void
  (e: 'toggle-booth-labels'): void
  (e: 'toggle-infra-labels'): void
  (e: 'toggle-underlay'): void
  (e: 'choose-quality', level: QualityLevel): void
  (e: 'select', id: string): void
  (e: 'select-infra', id: string): void
  (e: 'import'): void
  (e: 'export'): void
  (e: 'report'): void
  (e: 'clear-data'): void
  (e: 'open-weather'): void
  (e: 'open-help'): void
  (e: 'open-multiplayer'): void
  (e: 'toggle-walk'): void
}>()

type Tab = 'view' | 'tree' | 'info' | null
const tab = ref<Tab>('tree')
const expanded = ref(false)

const QUALITY_OPTIONS: { value: QualityLevel; label: string }[] = [
  { value: 'ultra', label: '极致' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

const venueSize = computed(() => {
  const v = props.venue
  if (!v) return '—'
  const xs = v.points.map((p) => p.x)
  const zs = v.points.map((p) => p.z)
  const w = Math.max(...xs) - Math.min(...xs)
  const d = Math.max(...zs) - Math.min(...zs)
  return `${w.toFixed(0)} × ${d.toFixed(0)} × ${v.height} m`
})

function fmt(n: number) {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

function areaOf(b: Booth) {
  return polygonArea(b.points)
}

const infraCount = computed(() => props.infras.length)

async function toggleFullscreen() {
  const el = document.documentElement
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen?.()
      expanded.value = true
    } else {
      await document.exitFullscreen?.()
      expanded.value = false
    }
  } catch {
    expanded.value = false
  }
}

function pick(t: Tab) {
  tab.value = tab.value === t ? null : t
}

/** 面板高度：拖动顶部把手调整，0 表示使用默认高度 */
const panelHeight = ref(0)

function onGrabDown(e: PointerEvent) {
  const panel = (e.currentTarget as HTMLElement).parentElement
  if (!panel) return
  const startY = e.clientY
  const startH = panel.getBoundingClientRect().height

  const move = (ev: PointerEvent) => {
    const next = startH + (startY - ev.clientY)
    const min = 200
    const max = Math.round(window.innerHeight * 0.78)
    panelHeight.value = Math.round(Math.min(max, Math.max(min, next)))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
</script>

<template>
  <div class="mv-root">
    <div class="mv-top">
      <div class="mv-title">
        <b>{{ venueName }}</b>
        <span>{{ booths.length }} 展台 · {{ fmt(venueArea) }} m²</span>
      </div>
      <button type="button" class="mv-icobtn" :class="{ on: expanded }" title="全屏" @click="toggleFullscreen">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 3.6H3.6V9M15 3.6h5.4V9M15 20.4h5.4V15M9 20.4H3.6V15" />
        </svg>
      </button>
    </div>

    <div class="mv-spacer" />

    <div
      v-if="tab"
      class="mv-panel"
      :class="{ resized: panelHeight > 0 }"
      :style="panelHeight ? { height: panelHeight + 'px' } : undefined"
    >
      <div class="mv-grab" title="拖动调整高度" @pointerdown="onGrabDown" />
      <div class="mv-panel-head">
        <b v-if="tab === 'view'">视图与显示</b>
        <b v-else-if="tab === 'tree'">场景结构</b>
        <b v-else>概览与数据</b>
        <span class="sp" />
        <span v-if="tab === 'tree'">{{ booths.length }} 展台 · {{ infraCount }} 设施</span>
        <span v-else-if="tab === 'view'">只读</span>
        <button type="button" class="mv-icobtn" style="width: 26px; height: 26px" @click="tab = null">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div class="mv-panel-body">
        <!-- 视图 -->
        <template v-if="tab === 'view'">
          <div class="mv-actions" style="margin-top: 0">
            <button type="button" class="mv-action" @click="emit('view-top')">
              <b>俯视</b><span>看整体布局</span>
            </button>
            <button type="button" class="mv-action" @click="emit('view-iso')">
              <b>轴测</b><span>默认观察角度</span>
            </button>
          </div>
          <div class="mv-actions">
            <button type="button" class="mv-action" @click="emit('fit-view')">
              <b>适配视图</b><span>框住整个场馆</span>
            </button>
            <button type="button" class="mv-action" @click="emit('open-weather')">
              <b>天气</b><span>{{ weatherOn ? '已启用' : '晴天' }}</span>
            </button>
          </div>

          <div class="mv-panel-head" style="height: 30px; padding: 8px 4px 0; border: 0; color: var(--ink-3)">
            显示
          </div>
          <button type="button" class="mv-switch" :class="{ on: boothLabelsOn }" @click="emit('toggle-booth-labels')">
            展台名称
            <span class="sp" />
            <span class="dot" />
          </button>
          <button type="button" class="mv-switch" :class="{ on: infraLabelsOn }" @click="emit('toggle-infra-labels')">
            基础设施名称
            <span class="sp" />
            <span class="dot" />
          </button>
          <button type="button" class="mv-switch" :class="{ on: areaOn }" @click="emit('toggle-areas')">
            展台面积
            <span class="sp" />
            <span class="dot" />
          </button>
          <button type="button" class="mv-switch" :class="{ on: dimOn }" @click="emit('toggle-dimensions')">
            尺寸刻度
            <span class="sp" />
            <span class="dot" />
          </button>
          <button type="button" class="mv-switch" :class="{ on: gridOn }" @click="emit('toggle-grid')">
            地面网格
            <span class="sp" />
            <span class="dot" />
          </button>
          <button
            type="button"
            class="mv-switch"
            :class="{ on: !!underlay?.visible }"
            :disabled="!underlay"
            @click="emit('toggle-underlay')"
          >
            底图
            <span class="sp" />
            <span class="dot" />
          </button>

          <div class="mv-panel-head" style="height: 30px; padding: 8px 4px 0; border: 0; color: var(--ink-3)">
            画质 · {{ qualityLabel }}
          </div>
          <div class="mv-actions" style="grid-template-columns: repeat(4, 1fr)">
            <button
              v-for="o in QUALITY_OPTIONS"
              :key="o.value"
              type="button"
              class="mv-action"
              :style="quality === o.value ? 'border-color:var(--accent);background:rgba(111,124,232,.14)' : ''"
              @click="emit('choose-quality', o.value)"
            >
              <b>{{ o.label }}</b>
            </button>
          </div>
        </template>

        <!-- 结构 -->
        <template v-else-if="tab === 'tree'">
          <div class="mv-metrics">
            <div><span>展台</span><b>{{ booths.length }}<i>个</i></b></div>
            <div><span>展出面积</span><b>{{ fmt(boothArea) }}<i>m²</i></b></div>
            <div><span>覆盖率</span><b>{{ coverage }}<i>%</i></b></div>
          </div>
          <div v-if="!booths.length" class="mv-tip">当前场景还没有展台。可以导入包含展台的 JSON 场景。</div>
          <button
            v-for="b in booths"
            :key="b.id"
            type="button"
            class="mv-row"
            :class="{ on: selectedIds.includes(b.id) }"
            @click="emit('select', b.id)"
          >
            <span class="sw" />
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ b.name }}</span>
            <span v-if="boothKindOf(b) !== 'massing'" class="tag">{{ BOOTH_KIND_LABELS[boothKindOf(b)] }}</span>
            <span class="num">{{ fmt(areaOf(b)) }} m²</span>
          </button>
          <div v-if="infras.length" class="mv-tip">另有 {{ infras.length }} 个基础设施（出入口、窗户、内墙与家具），在模型上点选可高亮。</div>
        </template>

        <!-- 信息 -->
        <template v-else>
          <div class="mv-metrics" style="margin-top: 0">
            <div><span>场馆面积</span><b>{{ fmt(venueArea) }}<i>m²</i></b></div>
            <div><span>展出面积</span><b>{{ fmt(boothArea) }}<i>m²</i></b></div>
            <div><span>覆盖率</span><b>{{ coverage }}<i>%</i></b></div>
          </div>

          <div class="mv-tip" style="padding: 0 4px 8px">尺寸 {{ venueSize }} · 只读查看</div>

          <button type="button" class="mv-row" @click="emit('toggle-walk')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="13" cy="4.6" r="1.8" />
              <path d="M11 8.4l-2 4.6 3 2 1 4.6M14 13.4l3-1.4M9 21l2-6" />
            </svg>
            进入漫游
            <span class="num">单人</span>
          </button>
          <button type="button" class="mv-row" :disabled="!venue" @click="emit('open-multiplayer')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="9" cy="8" r="2.6" />
              <path d="M3.4 19c0-3 2.5-5 5.6-5s5.6 2 5.6 5" />
              <path d="M16 5.6a2.6 2.6 0 010 5M17.4 14.6c2 .7 3.2 2.3 3.2 4.4" />
            </svg>
            多人漫游
            <span class="num">房间</span>
          </button>

          <button type="button" class="mv-row" @click="emit('open-weather')">
            <WeatherIcon :kind="weatherOn ? weather : 'clear'" :size="15" />
            天气与光照
            <span class="num">{{ weatherOn ? '已启用' : '晴天' }}</span>
          </button>

          <button type="button" class="mv-row" @click="emit('import')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 16.4V5.2M7.8 9.4L12 5.2l4.2 4.2M4.6 15.4v3.4a1.6 1.6 0 001.6 1.6h11.6a1.6 1.6 0 001.6-1.6v-3.4" />
            </svg>
            导入 JSON 场景
            <span class="num">替换当前</span>
          </button>

          <button type="button" class="mv-row danger" @click="emit('clear-data')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4.5 7h15M9.5 7V4.8h5V7M7 7l.8 12.2h8.4L17 7M10 10.5v5M14 10.5v5" />
            </svg>
            清空场景数据
            <span class="num">需确认</span>
          </button>

          <div class="mv-actions">
            <button type="button" class="mv-action" @click="emit('report')">
              <b>平面图</b><span>导出 PNG</span>
            </button>
            <button type="button" class="mv-action" @click="emit('export')">
              <b>导出场景</b><span>JSON</span>
            </button>
          </div>

          <div class="mv-actions">
            <button type="button" class="mv-action" @click="emit('open-help')">
              <b>使用说明</b><span>查看操作方式</span>
            </button>
            <button type="button" class="mv-action" @click="tab = null">
              <b>关闭面板</b><span>回到模型</span>
            </button>
          </div>

          <div class="mv-tip">
            移动端为只读查看：可以切换视图、查看结构与天气、导出平面图。编辑请在桌面端完成。
          </div>
        </template>
      </div>
    </div>

    <div class="mv-seg">
      <button type="button" :class="{ on: tab === 'view' }" @click="pick('view')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2.6 12S6.1 5.9 12 5.9 21.4 12 21.4 12 17.9 18.1 12 18.1 2.6 12 2.6 12z" />
          <circle cx="12" cy="12" r="2.7" />
        </svg>
        视图
      </button>
      <button type="button" :class="{ on: tab === 'tree' }" @click="pick('tree')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3.2l8.6 4.6L12 12.4 3.4 7.8z" />
          <path d="M3.4 12.4l8.6 4.6 8.6-4.6" />
          <path d="M3.4 16.9l8.6 4.6 8.6-4.6" />
        </svg>
        结构
      </button>
      <button type="button" :class="{ on: tab === 'info' }" @click="pick('info')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.6" />
          <path d="M12 10.6v6M12 7.4v.2" />
        </svg>
        信息
      </button>
    </div>
  </div>
</template>
