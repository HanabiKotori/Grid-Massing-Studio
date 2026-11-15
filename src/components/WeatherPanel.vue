<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import WeatherIcon from './WeatherIcon.vue'
import {
  DEFAULT_WEATHER_CITY,
  fetchAmapWeather,
  type LiveWeather,
} from '../core/amapWeather'
import {
  WEATHER_LABELS,
  WEATHER_OPTIONS,
  WEATHER_PRESETS,
  type ParticleDensities,
  type WeatherKind,
} from '../core/weather'

const props = defineProps<{
  current: WeatherKind
  enabled: boolean
  liveEnabled: boolean
  densities: ParticleDensities
  visibility: number
}>()

const emit = defineEmits<{
  (e: 'select', kind: WeatherKind): void
  (e: 'live-toggle', enabled: boolean, live?: LiveWeather): void
  (e: 'density', kind: keyof ParticleDensities, percent: number): void
  (e: 'visibility', percent: number): void
  (e: 'preview-particle', kind: keyof ParticleDensities): void
  (e: 'toggle', enabled: boolean): void
  (e: 'close'): void
}>()

const densityRows: { key: keyof ParticleDensities; label: string }[] = [
  { key: 'rain', label: '雨' },
  { key: 'snow', label: '雪' },
  { key: 'dust', label: '沙尘' },
]

type SliderKind = keyof ParticleDensities | 'visibility'
const previewSlider = ref<SliderKind | null>(null)
let suppressMaskClick = false

function startSliderPreview(kind: SliderKind) {
  previewSlider.value = kind
  suppressMaskClick = true
}

function endSliderPreview() {
  if (!previewSlider.value) return
  previewSlider.value = null
  window.setTimeout(() => {
    suppressMaskClick = false
  }, 0)
}

function beginParticlePreview(kind: keyof ParticleDensities) {
  startSliderPreview(kind)
  maybePreviewParticle(kind)
}

function onMaskClick() {
  if (!previewSlider.value && !suppressMaskClick) emit('close')
}

function hasParticles(kind: keyof ParticleDensities): boolean {
  return props.enabled && WEATHER_PRESETS[props.current][kind] > 0
}

const particleStatus = computed(() => {
  if (!props.enabled) return '天气效果已关闭；开启后拖动粒子浓度才会生效。'
  const active = densityRows.filter((row) => hasParticles(row.key)).map((row) => row.label)
  if (!active.length) {
    return `当前天气「${WEATHER_LABELS[props.current]}」没有雨 / 雪 / 沙尘粒子，可点「预览」后再拖动。`
  }
  return `当前${active.join(' / ')}粒子生效中，拖动会即时更新。`
})

function densityPercent(kind: keyof ParticleDensities): number {
  return Math.round(props.densities[kind] * 100)
}

function onDensity(kind: keyof ParticleDensities, event: Event) {
  emit('density', kind, Number((event.target as HTMLInputElement).value))
}

/** 开始拖动时，如果当前天气没有这类粒子，自动切到最轻的同类天气做即时预览 */
function maybePreviewParticle(kind: keyof ParticleDensities) {
  if (props.enabled && !hasParticles(kind)) emit('preview-particle', kind)
}

const visibilityMeters = computed(() =>
  Math.round(
    WEATHER_PRESETS[props.current].fogFar * Math.max(0.05, props.visibility / 100),
  ),
)

function onVisibility(event: Event) {
  emit('visibility', Number((event.target as HTMLInputElement).value))
}

const closeEl = ref<HTMLButtonElement | null>(null)
const city = ref(localStorage.getItem('grid-weather-city') || DEFAULT_WEATHER_CITY)
const live = ref<LiveWeather | null>(null)
const loading = ref(false)
const error = ref('')

async function loadLive(force = false) {
  const target = city.value.trim()
  if (!target) city.value = DEFAULT_WEATHER_CITY
  loading.value = true
  error.value = ''
  try {
    const data = await fetchAmapWeather(city.value || DEFAULT_WEATHER_CITY, force)
    live.value = data
    localStorage.setItem('grid-weather-city', city.value)
    if (props.liveEnabled) emit('live-toggle', true, data)
  } catch (err) {
    live.value = null
    error.value = err instanceof Error ? err.message : '实时天气查询失败'
  } finally {
    loading.value = false
  }
}

function toggleLive() {
  if (live.value) emit('live-toggle', !props.liveEnabled, live.value)
}

onMounted(() => {
  closeEl.value?.focus()
  void loadLive()
  window.addEventListener('pointerup', endSliderPreview)
  window.addEventListener('pointercancel', endSliderPreview)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerup', endSliderPreview)
  window.removeEventListener('pointercancel', endSliderPreview)
})
</script>

<template>
  <Teleport to="body">
    <div class="wm" :class="{ previewing: !!previewSlider }" @click.self="onMaskClick">
      <section
        class="wp"
        :class="{ previewing: !!previewSlider }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weather-title"
      >
        <header class="wp-head">
          <div class="wp-title">
            <p class="wp-eb">环境 · 高德实时</p>
            <h2 id="weather-title">天气</h2>
          </div>
          <div class="wp-ha">
            <div class="wp-toggle">
              <span>天气效果</span>
              <button
                type="button"
                class="sw"
                :class="{ on: enabled }"
                role="switch"
                :aria-checked="enabled"
                :aria-label="enabled ? '关闭天气效果' : '开启天气效果'"
                @click="emit('toggle', !enabled)"
              >
                <i />
              </button>
            </div>
            <button
              ref="closeEl"
              class="wp-x"
              type="button"
              aria-label="关闭天气面板"
              @click="emit('close')"
            >
              ×
            </button>
          </div>
        </header>

        <div class="wp-body">
          <!-- 实时天气 -->
          <section class="wp-live">
            <div class="sec">实时天气<span class="r">高德天气</span></div>
            <form class="wp-city" @submit.prevent="loadLive(true)">
              <input
                v-model="city"
                type="text"
                aria-label="天气城市"
                placeholder="城市名或 adcode，如 贵阳 / 520100"
                maxlength="20"
              />
              <button type="submit" :disabled="loading">
                {{ loading ? '查询中' : '查询' }}
              </button>
            </form>

            <p v-if="error" class="wp-error">{{ error }}</p>
            <div v-else-if="live" class="wp-live-info">
              <div class="wp-live-main">
                <b>
                  <WeatherIcon :kind="live.kind" :size="15" />
                  {{ live.city }} · {{ live.weather }}
                </b>
                <strong>{{ live.temperature }}°C</strong>
              </div>
              <p class="wp-meta">
                {{ live.winddirection }}风 {{ live.windpower }} · 湿度 {{ live.humidity }}%
              </p>
              <p class="wp-time">
                {{ live.reporttime }} · 映射为「{{ WEATHER_LABELS[live.kind] }}」
              </p>
            </div>
            <p v-else-if="loading" class="wp-loading">正在查询 {{ city }} 实时天气…</p>

            <div class="wp-live-sw">
              <div class="txt">
                <b>使用实时天气</b>
                <span>{{ liveEnabled ? '查询城市后自动同步' : '开启后使用高德实时天气' }}</span>
              </div>
              <button
                type="button"
                class="sw"
                :class="{ on: liveEnabled }"
                role="switch"
                :aria-checked="liveEnabled"
                :aria-label="liveEnabled ? '关闭实时天气' : '开启实时天气'"
                :disabled="!live"
                @click="toggleLive"
              >
                <i />
              </button>
            </div>
          </section>

          <!-- 天气列表 -->
          <section class="wp-list">
            <div class="sec">天气类型<span class="r">{{ WEATHER_OPTIONS.length }} 种</span></div>
            <div class="wp-rows">
              <button
                v-for="item in WEATHER_OPTIONS"
                :key="item.kind"
                type="button"
                class="wrow"
                :class="{ on: current === item.kind }"
                :aria-pressed="current === item.kind"
                @click="emit('select', item.kind)"
              >
                <b>
                  <WeatherIcon :kind="item.kind" :size="16" />
                  {{ item.label }}
                </b>
                <span>{{ item.description }}</span>
              </button>
            </div>
          </section>

          <!-- 粒子与能见度 -->
          <section class="wp-density">
            <div class="sec">粒子与能见度<span class="r">拖动实时调整</span></div>
            <p class="wp-status">{{ particleStatus }}</p>

            <label
              v-for="row in densityRows"
              :key="row.key"
              class="wp-sld"
              :class="{ 'is-previewing': previewSlider === row.key }"
            >
              <span class="lab">{{ row.label }}</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                :value="densityPercent(row.key)"
                :style="{ '--fill': densityPercent(row.key) + '%' }"
                @pointerdown="beginParticlePreview(row.key)"
                @input="onDensity(row.key, $event)"
              />
              <b>{{ densityPercent(row.key) }}%</b>
              <button
                v-if="!hasParticles(row.key)"
                type="button"
                class="wp-preview"
                :title="`预览${row.label}粒子`"
                @click="emit('preview-particle', row.key)"
              >
                预览
              </button>
              <span v-else class="wp-preview-ghost" />
            </label>

            <div class="wp-sld" :class="{ 'is-previewing': previewSlider === 'visibility' }">
              <span class="lab">能见度</span>
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                :value="visibility"
                :style="{ '--fill': visibility / 2 + '%' }"
                @pointerdown="startSliderPreview('visibility')"
                @input="onVisibility($event)"
              />
              <b>≈{{ visibilityMeters }}m</b>
            </div>
          </section>
        </div>

        <footer class="wp-foot">
          实时天气来自高德，开启后会映射到最接近的场景预设；也可以直接选择手动天气。封闭场馆内不会出现降水。
        </footer>

        <div class="wp-done-wrap">
          <button type="button" class="wp-done" @click="emit('close')">完成</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* ---------- 遮罩 ---------- */
.wm {
  --mono: ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
  position: fixed;
  inset: 0;
  z-index: 85;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 5, 6, 0.66);
  backdrop-filter: blur(3px);
}

/* ---------- 面板 ---------- */
.wp {
  width: min(790px, 100%);
  max-height: min(90vh, 620px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: #0b0c0e;
  box-shadow: 0 40px 90px -30px #000;
  color: #b6bac1;
}

/* ---------- 头部 ---------- */
.wp-head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.wp-eb {
  margin: 0 0 3px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #5f636a;
}

.wp-title h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #ecedef;
}

.wp-ha {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.wp-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: #8b8f96;
}

.wp-x {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: none;
  color: #8b8f96;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.wp-x:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #ecedef;
}

/* ---------- 开关 ---------- */
.sw {
  position: relative;
  flex: none;
  width: 30px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: #2a2c33;
  cursor: pointer;
  transition: background 0.16s ease;
}

.sw i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #8b8f96;
  transition: transform 0.16s ease, background 0.16s ease;
}

.sw.on {
  background: #6f7ce8;
}

.sw.on i {
  transform: translateX(14px);
  background: #fff;
}

.sw:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ---------- 主体：左列表 / 右参数 ---------- */
.wp-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 306px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas:
    'list live'
    'list density';
  overflow: hidden;
}

.wp-live {
  grid-area: live;
  min-height: 0;
  padding: 10px 18px 2px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.wp-list {
  grid-area: list;
  min-height: 0;
  padding: 10px 12px 12px;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
  overflow-y: auto;
  scrollbar-width: thin;
}

.wp-density {
  grid-area: density;
  min-height: 0;
  padding: 2px 18px 14px;
  overflow-y: auto;
  scrollbar-width: thin;
}

/* ---------- 分节标题 ---------- */
.sec {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 26px;
  margin-top: 4px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #5f636a;
}

.sec::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.07);
}

.sec .r {
  margin-left: auto;
  font-family: inherit;
  font-size: 9.5px;
  letter-spacing: 0;
  text-transform: none;
  color: #454950;
}

/* ---------- 实时天气 ---------- */
.wp-city {
  display: flex;
  gap: 6px;
  margin: 6px 0 10px;
}

.wp-city input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 5px;
  background: #0e0f12;
  color: #ecedef;
  font-family: inherit;
  font-size: 11.5px;
}

.wp-city input::placeholder {
  color: #454950;
}

.wp-city input:focus {
  outline: none;
  border-color: rgba(111, 124, 232, 0.65);
}

.wp-city button {
  flex: none;
  height: 28px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 5px;
  background: #16171b;
  color: #b6bac1;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.wp-city button:hover {
  border-color: rgba(255, 255, 255, 0.18);
  color: #ecedef;
}

.wp-city button:disabled {
  opacity: 0.5;
  cursor: default;
}

.wp-live-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.wp-live-main b {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #ecedef;
}

.wp-live-main strong {
  margin-left: auto;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #ecedef;
}

.wp-meta {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: #6a6e75;
}

.wp-time {
  margin: 1px 0 0;
  font-family: var(--mono);
  font-size: 9.5px;
  color: #454950;
}

.wp-error {
  margin: 6px 0 0;
  font-size: 10.5px;
  color: #c98059;
}

.wp-loading {
  margin: 6px 0 0;
  font-size: 10.5px;
  color: #6a6e75;
}

.wp-live-sw {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.wp-live-sw .txt {
  min-width: 0;
}

.wp-live-sw b {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: #b6bac1;
}

.wp-live-sw span {
  display: block;
  margin-top: 1px;
  font-size: 9.5px;
  color: #454950;
}

.wp-live-sw .sw {
  margin-left: auto;
}

/* ---------- 天气列表（MA 选中样式：紫字 + 右侧圆点） ---------- */
.wp-rows {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 2px;
}

.wrow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: #b6bac1;
  font-family: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.wrow:hover {
  background: rgba(255, 255, 255, 0.045);
  color: #ecedef;
}

.wrow b {
  flex: none;
  width: 62px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 500;
  color: inherit;
}

.wrow span {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: #5f636a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wrow.on {
  color: #ecedef;
}

.wrow.on b {
  color: #cdd3ff;
}

.wrow.on::after {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6f7ce8;
}

/* ---------- 粒子与能见度 ---------- */
.wp-status {
  margin: 2px 0 6px;
  font-size: 9.5px;
  line-height: 1.5;
  color: #454950;
}

.wp-sld {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 30px;
}

.wp-sld .lab {
  flex: none;
  width: 36px;
  font-size: 10.5px;
  color: #8b8f96;
}

.wp-sld input[type='range'] {
  flex: 1;
  min-width: 0;
  height: 3px;
  border-radius: 2px;
  appearance: none;
  -webkit-appearance: none;
  background: linear-gradient(
    90deg,
    #6f7ce8 0 var(--fill, 50%),
    rgba(255, 255, 255, 0.1) var(--fill, 50%) 100%
  );
  cursor: pointer;
}

.wp-sld input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #dfe2e6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.wp-sld input[type='range']::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 0;
  border-radius: 50%;
  background: #dfe2e6;
}

.wp-sld > b {
  flex: none;
  min-width: 40px;
  text-align: right;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 400;
  color: #b6bac1;
}

.wp-preview {
  flex: none;
  height: 20px;
  padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  background: none;
  color: #8b8f96;
  font-family: inherit;
  font-size: 9.5px;
  cursor: pointer;
}

.wp-preview:hover {
  border-color: rgba(255, 255, 255, 0.2);
  color: #ecedef;
}

.wp-preview-ghost {
  flex: none;
  width: 33px;
}

/* ---------- 页脚 ---------- */
.wp-foot {
  flex: 0 0 auto;
  padding: 9px 18px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 10.5px;
  line-height: 1.55;
  color: #5f636a;
}

.wp-done-wrap {
  display: none;
  flex: 0 0 auto;
  padding: 10px 16px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.wp-done {
  width: 100%;
  height: 44px;
  border: 0;
  border-radius: 9px;
  background: #6f7ce8;
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

/* ---------- 拖动预览 ---------- */
.wm.previewing {
  background: transparent;
  backdrop-filter: none;
}

.wp.previewing {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

.wp.previewing .wp-head,
.wp.previewing .wp-live,
.wp.previewing .wp-list,
.wp.previewing .wp-density .sec,
.wp.previewing .wp-status,
.wp.previewing .wp-foot,
.wp.previewing .wp-done-wrap,
.wp.previewing .wp-sld:not(.is-previewing) {
  opacity: 0;
  pointer-events: none;
}

.wp.previewing .wp-sld.is-previewing {
  position: relative;
  z-index: 2;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(16, 17, 19, 0.92);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(10px);
}

/* ---------- 移动端：MA 全屏列表 ---------- */
@media (max-width: 820px) {
  .wm {
    padding: 0;
    background: #0b0c0e;
    backdrop-filter: none;
  }

  .wp {
    width: 100%;
    height: 100%;
    max-height: 100%;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .wp-head {
    padding: 16px 16px 12px;
  }

  .wp-title h2 {
    font-size: 17px;
  }

  .wp-ha {
    gap: 14px;
  }

  .wp-toggle {
    font-size: 12.5px;
    color: #b6bac1;
  }

  .sw {
    width: 34px;
    height: 18px;
  }

  .sw i {
    width: 14px;
    height: 14px;
  }

  .sw.on i {
    transform: translateX(16px);
  }

  .wp-body {
    display: block;
    padding: 0 16px;
    overflow-y: auto;
  }

  .wp-live,
  .wp-list,
  .wp-density {
    padding: 0;
    border: 0;
    overflow: visible;
  }

  .sec {
    height: 30px;
    margin-top: 6px;
  }

  .wp-city {
    margin: 8px 0 10px;
  }

  .wp-city input {
    height: 40px;
    padding: 0 11px;
    border-radius: 8px;
    font-size: 13px;
  }

  .wp-city button {
    height: 40px;
    padding: 0 15px;
    border-radius: 8px;
    font-size: 12.5px;
  }

  .wp-live-main b {
    font-size: 13px;
  }

  .wp-live-main strong {
    font-size: 30px;
  }

  .wp-meta {
    font-size: 11px;
  }

  .wp-time {
    font-size: 10px;
  }

  .wp-live-sw {
    margin-top: 12px;
    padding-top: 12px;
    min-height: 42px;
  }

  .wp-live-sw b {
    font-size: 12.5px;
  }

  .wp-live-sw span {
    font-size: 10px;
  }

  /* MA 列表：46px 行高、底部分隔线 */
  .wp-rows {
    gap: 0;
    margin-top: 2px;
  }

  .wrow {
    height: 46px;
    padding: 0 2px;
    border-radius: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 12.5px;
  }

  .wrow:last-child {
    border-bottom: 0;
  }

  .wrow:hover {
    background: none;
  }

  .wrow b {
    width: 72px;
    gap: 8px;
  }

  .wrow span {
    font-size: 10.5px;
  }

  .wrow.on::after {
    width: 7px;
    height: 7px;
  }

  .wp-status {
    font-size: 10.5px;
  }

  .wp-sld {
    height: 38px;
    gap: 10px;
  }

  .wp-sld .lab {
    width: 40px;
    font-size: 11.5px;
  }

  .wp-sld input[type='range'] {
    height: 4px;
  }

  .wp-sld input[type='range']::-webkit-slider-thumb {
    width: 14px;
    height: 14px;
  }

  .wp-sld > b {
    min-width: 44px;
    font-size: 10.5px;
  }

  .wp-preview {
    height: 24px;
    padding: 0 8px;
    font-size: 10px;
  }

  .wp-preview-ghost {
    width: 37px;
  }

  .wp-density {
    padding-bottom: 20px;
  }

  .wp-foot {
    padding: 10px 16px 12px;
    font-size: 10.5px;
  }

  .wp-done-wrap {
    display: block;
  }
}
</style>
