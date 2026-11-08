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
    <div
      class="weather-mask"
      :class="{ previewing: !!previewSlider }"
      @click.self="onMaskClick"
    >
      <section
        class="weather-panel"
        :class="{ previewing: !!previewSlider }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weather-title"
      >
        <header class="weather-head">
          <div>
            <p>环境 · 高德实时</p>
            <h2 id="weather-title">天气</h2>
          </div>
          <div class="weather-head-actions">
            <div class="weather-toggle">
              <span>天气效果</span>
              <button
                type="button"
                class="weather-switch"
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
              class="weather-close"
              type="button"
              aria-label="关闭天气选择"
              @click="emit('close')"
            >
              ×
            </button>
          </div>
        </header>

        <div class="weather-body">
          <div class="weather-settings">
            <p v-if="!enabled" class="weather-off-tip">
              天气效果已关闭，当前为晴天。开启开关或选择任意天气即可恢复。
            </p>

        <section class="weather-live" aria-live="polite">
          <div class="weather-live-head">
            <b>实时天气</b>
            <span>高德天气</span>
          </div>

          <form class="weather-city-form" @submit.prevent="loadLive(true)">
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

          <p v-if="error" class="weather-live-error">{{ error }}</p>
          <div v-else-if="live" class="weather-live-info">
            <div class="weather-live-main">
              <b>
                <WeatherIcon :kind="live.kind" :size="15" />
                {{ live.city }} · {{ live.weather }}
              </b>
              <strong>{{ live.temperature }}°C</strong>
            </div>
            <p>
              {{ live.winddirection }}风 {{ live.windpower }} · 湿度 {{ live.humidity }}%
            </p>
            <p class="weather-live-time">
              {{ live.reporttime }} · 映射为「{{ WEATHER_LABELS[live.kind] }}」
            </p>
            <div class="weather-live-toggle">
              <div>
                <b>使用实时天气</b>
                <span>{{ liveEnabled ? '已开启，查询城市后自动同步' : '开启后使用高德实时天气' }}</span>
              </div>
              <button
                type="button"
                class="weather-switch"
                role="switch"
                :aria-checked="liveEnabled"
                :aria-label="liveEnabled ? '关闭实时天气' : '开启实时天气'"
                :disabled="!live"
                @click="toggleLive"
              >
                <i />
              </button>
            </div>
          </div>
          <p v-else-if="loading" class="weather-live-loading">正在查询 {{ city }} 实时天气…</p>
        </section>

        <section class="weather-density">
          <div class="weather-density-head">
            <b>粒子与能见度</b>
            <span>拖动实时调整</span>
          </div>
          <p class="weather-density-status">{{ particleStatus }}</p>
          <label
            v-for="row in densityRows"
            :key="row.key"
            class="weather-density-row"
            :class="{ 'is-previewing': previewSlider === row.key }"
          >
            <span>{{ row.label }}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              :value="densityPercent(row.key)"
              :style="{ '--fill': `${densityPercent(row.key)}%` }"
              @pointerdown="beginParticlePreview(row.key)"
              @input="onDensity(row.key, $event)"
            />
            <b>{{ densityPercent(row.key) }}%</b>
            <button
              v-if="!hasParticles(row.key)"
              type="button"
              class="weather-density-preview"
              :title="`预览${row.label}粒子`"
              @click="emit('preview-particle', row.key)"
            >
              预览
            </button>
            <span v-else />
          </label>

          <div
            class="weather-visibility-row"
            :class="{ 'is-previewing': previewSlider === 'visibility' }"
          >
            <span>能见度</span>
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              :value="visibility"
              :style="{ '--fill': `${visibility / 2}%` }"
              @pointerdown="startSliderPreview('visibility')"
              @input="onVisibility($event)"
            />
            <b>≈{{ visibilityMeters }}m</b>
          </div>
        </section>
          </div>

          <div class="weather-grid">
          <button
            v-for="item in WEATHER_OPTIONS"
            :key="item.kind"
            type="button"
            class="weather-option"
            :class="{ active: current === item.kind }"
            @click="emit('select', item.kind)"
          >
            <b>
              <WeatherIcon :kind="item.kind" :size="16" />
              {{ item.label }}
            </b>
            <span>{{ item.description }}</span>
          </button>
          </div>
        </div>

        <footer class="weather-foot">
          实时天气来自高德，开启后会映射到最接近的场景预设；也可以直接选择手动天气。封闭场馆内不会出现降水。
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.weather-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: grid;
  place-items: center;
  padding: 20px;
  background-color: rgba(18, 20, 24, 0.4);
  backdrop-filter: blur(4px);
  transition:
    background-color 0.24s ease,
    backdrop-filter 0.24s ease;
}

.weather-mask.previewing {
  background-color: transparent;
  backdrop-filter: none;
}

.weather-panel.previewing {
  background-color: transparent;
  border-color: transparent;
  box-shadow: none;
}

.weather-head,
.weather-foot,
.weather-off-tip,
.weather-live,
.weather-density-head,
.weather-density-status,
.weather-grid,
.weather-density-preview,
.weather-density-row,
.weather-visibility-row {
  transition: opacity 0.2s ease;
}

.weather-panel.previewing .weather-head,
.weather-panel.previewing .weather-foot,
.weather-panel.previewing .weather-off-tip,
.weather-panel.previewing .weather-live,
.weather-panel.previewing .weather-density-head,
.weather-panel.previewing .weather-density-status,
.weather-panel.previewing .weather-grid,
.weather-panel.previewing .weather-density-preview,
.weather-panel.previewing .weather-density-row:not(.is-previewing),
.weather-panel.previewing .weather-visibility-row:not(.is-previewing) {
  opacity: 0;
  pointer-events: none;
}

.weather-panel.previewing .weather-settings {
  border-right-color: transparent;
}

.weather-panel.previewing .weather-density {
  border-color: transparent;
  background-color: transparent;
}

.weather-settings,
.weather-density {
  transition:
    border-color 0.24s ease,
    background-color 0.24s ease;
}

.weather-density-row.is-previewing,
.weather-visibility-row.is-previewing {
  position: relative;
  z-index: 2;
}

.weather-density-row.is-previewing::before,
.weather-visibility-row.is-previewing::before {
  content: '';
  position: absolute;
  inset: -7px -9px;
  z-index: -1;
  border-radius: 10px;
  background: rgba(24, 27, 33, 0.88);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(12px);
}

.weather-panel.previewing .weather-density-row.is-previewing > span,
.weather-panel.previewing .weather-density-row.is-previewing > b,
.weather-panel.previewing .weather-visibility-row.is-previewing > span,
.weather-panel.previewing .weather-visibility-row.is-previewing > b {
  color: rgba(255, 255, 255, 0.92);
}

.weather-panel {
  width: min(940px, 100%);
  max-height: min(780px, calc(100vh - 24px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 28px 70px -26px rgba(20, 22, 28, 0.55);
  animation: weather-in 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
  transition:
    background-color 0.24s ease,
    border-color 0.24s ease,
    box-shadow 0.24s ease;
}

.weather-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 17px;
  border-bottom: 1px solid var(--line);
}

.weather-head p {
  margin: 0 0 2px;
  color: var(--ink-3);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.weather-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.weather-head-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
}

.weather-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-2);
  font-size: 10.5px;
}

.weather-switch {
  position: relative;
  width: 34px;
  height: 20px;
  padding: 0;
  flex: none;
  border-radius: 20px;
  background: #d8d4ca;
  transition: background 0.18s ease;
}

.weather-switch i {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(20, 22, 28, 0.25);
  transition: transform 0.18s ease;
}

.weather-switch[aria-checked='true'] {
  background: var(--accent);
}

.weather-switch[aria-checked='true'] i {
  transform: translateX(14px);
}

.weather-off-tip {
  flex: none;
  margin: 10px 14px 0;
  padding: 8px 10px;
  border: 1px solid #eadfbf;
  border-radius: 8px;
  background: #fff9ea;
  color: #80662b;
  font-size: 10.5px;
  line-height: 1.55;
}

.weather-close {
  width: 32px;
  height: 32px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--ink-2);
  font-size: 21px;
  line-height: 1;
}

.weather-close:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.weather-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 350px) minmax(0, 1fr);
}

.weather-settings {
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 14px;
  border-right: 1px solid var(--line);
}

.weather-live {
  flex: none;
  margin: 12px 14px 0;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: linear-gradient(135deg, #f7f9fc, #fbfaf7);
}

.weather-live-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.weather-live-head b {
  font-size: 12px;
  font-weight: 600;
}

.weather-live-head span {
  color: var(--ink-3);
  font-size: 9.5px;
}

.weather-city-form {
  display: flex;
  gap: 6px;
}

.weather-city-form input {
  min-width: 0;
  flex: 1;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  color: var(--ink);
  font-size: 11.5px;
}

.weather-city-form input:focus {
  border-color: var(--accent);
  outline: none;
}

.weather-city-form button {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  color: var(--ink-2);
  font-size: 11px;
  white-space: nowrap;
}

.weather-city-form button:disabled {
  opacity: 0.55;
}

.weather-live-info {
  margin-top: 8px;
}

.weather-live-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.weather-live-main b {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
}

.weather-live-main b .weather-icon {
  color: var(--accent-ink);
}

.weather-live-main strong {
  color: var(--accent-ink);
  font-size: 19px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.weather-live-info p {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 10.5px;
  line-height: 1.5;
}

.weather-live-info .weather-live-time {
  color: var(--ink-3);
}

.weather-live-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.weather-live-toggle > div {
  min-width: 0;
}

.weather-live-toggle b {
  display: block;
  font-size: 10.5px;
  font-weight: 600;
}

.weather-live-toggle span {
  display: block;
  margin-top: 2px;
  color: var(--ink-3);
  font-size: 9.5px;
  line-height: 1.4;
}

.weather-switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.weather-live-error,
.weather-live-loading {
  margin: 8px 0 0;
  color: var(--ink-3);
  font-size: 10.5px;
  line-height: 1.5;
}

.weather-live-error {
  color: #a74730;
}

.weather-density {
  flex: none;
  margin: 10px 14px 0;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fbfaf7;
}

.weather-density-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}

.weather-density-head b {
  font-size: 11.5px;
  font-weight: 600;
}

.weather-density-head span {
  color: var(--ink-3);
  font-size: 9.5px;
}

.weather-density-status {
  margin: 0 0 6px;
  color: var(--ink-3);
  font-size: 9.5px;
  line-height: 1.5;
}

.weather-density-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 38px 34px;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.weather-density-row > span {
  color: var(--ink-2);
  font-size: 10.5px;
}

.weather-density-row input {
  width: 100%;
  height: 18px;
  margin: 0;
}

.weather-density-row > b {
  color: var(--ink-2);
  font-size: 10px;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.weather-density-preview {
  height: 22px;
  padding: 0 5px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: #fff;
  color: var(--ink-2);
  font-size: 9px;
}

.weather-density-preview:hover {
  border-color: var(--accent);
  color: var(--accent-ink);
}

.weather-visibility-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 58px;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.weather-visibility-row > span {
  color: var(--ink-2);
  font-size: 10.5px;
}

.weather-visibility-row input {
  width: 100%;
  height: 18px;
  margin: 0;
}

.weather-visibility-row > b {
  color: var(--ink-2);
  font-size: 10px;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.weather-grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 14px 14px;
}

.weather-option {
  min-height: 70px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fbfaf7;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.weather-option:hover {
  border-color: var(--line-strong);
  background: var(--surface-2);
}

.weather-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.weather-option b {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.weather-option b .weather-icon {
  color: var(--ink-3);
}

.weather-option.active b .weather-icon {
  color: var(--accent-ink);
}

.weather-option span {
  color: var(--ink-3);
  font-size: 10.5px;
  line-height: 1.45;
}

.weather-option.active span {
  color: var(--accent-ink);
  opacity: 0.72;
}

.weather-foot {
  flex: none;
  padding: 11px 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-3);
  font-size: 10.5px;
  line-height: 1.6;
}

@keyframes weather-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 820px), (max-height: 560px) {
  .weather-mask {
    padding: 10px;
  }

  .weather-panel {
    width: 100%;
    max-height: calc(100dvh - 20px);
    border-radius: 14px;
  }

  .weather-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
    scrollbar-width: thin;
    scrollbar-color: rgba(118, 122, 130, 0.42) transparent;
  }

  .weather-body::-webkit-scrollbar {
    width: 5px;
  }

  .weather-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .weather-body::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(118, 122, 130, 0.42);
  }

  .weather-settings {
    padding-bottom: 14px;
    flex: none;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .weather-grid {
    flex: none;
    overflow: visible;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    margin: 14px 14px;
    padding: 0;
  }

  .weather-option {
    min-height: 64px;
  }
}
</style>
