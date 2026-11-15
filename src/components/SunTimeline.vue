<script setup lang="ts">
import WeatherIcon from './WeatherIcon.vue'
import type { WeatherKind } from '../core/weather'

const props = defineProps<{
  simTime: string
  sunMinutes: number
  sunPercent: string
  sunIsDay: boolean
  sunPlaying: boolean
  weather: WeatherKind
  weatherOn: boolean
  hasVenue: boolean
  presenting?: boolean
  /** 时间推进倍率，1× 为实时 */
  speed: number
}>()

const emit = defineEmits<{
  (e: 'toggle-sun'): void
  (e: 'reset-sun'): void
  (e: 'sun-scrub', ev: Event): void
  (e: 'open-weather'): void
  (e: 'presentation'): void
  (e: 'jump-hour', hour: number): void
  (e: 'speed', value: number): void
}>()

const HOURS = Array.from({ length: 25 }, (_, i) => i)
const LEGEND = [6, 12, 18, 24]
/** 倍率档位：1× 到 100× */
const SPEEDS = [1, 2, 5, 10, 20, 50, 100]

function stepSpeed(dir: 1 | -1) {
  const i = SPEEDS.indexOf(props.speed)
  const from = i < 0 ? 0 : i
  const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, from + dir))]
  if (next !== props.speed) emit('speed', next)
}

/** 手动输入倍率：限制在 1–100，空值回落到当前值 */
function commitSpeed(event: Event) {
  const input = event.target as HTMLInputElement
  const raw = Math.round(Number(input.value))
  const next = Number.isFinite(raw) ? Math.min(100, Math.max(1, raw)) : props.speed
  input.value = String(next)
  if (next !== props.speed) emit('speed', next)
}

function blurTarget(event: Event) {
  ;(event.target as HTMLInputElement).blur()
}
</script>

<template>
  <footer class="wb-timeline">
    <button
      type="button"
      class="wb-tl-play"
      :title="sunPlaying ? '暂停太阳时间' : '播放太阳时间'"
      @click="emit('toggle-sun')"
    >
      <svg v-if="sunPlaying" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="7" y="5" width="3.4" height="14" rx="1" />
        <rect x="13.6" y="5" width="3.4" height="14" rx="1" />
      </svg>
      <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8.2 5.6l10 6.4-10 6.4z" />
      </svg>
    </button>

    <div class="wb-tl-speed" :title="`时间推进倍率 ${speed}×（1× 为实时）`">
      <button
        type="button"
        class="wb-tl-step"
        :disabled="speed <= 1"
        aria-label="降低倍率"
        @click="stepSpeed(-1)"
      >
        −
      </button>
      <input
        class="wb-tl-speed-val"
        type="number"
        min="1"
        max="100"
        step="1"
        :value="speed"
        aria-label="时间推进倍率"
        @change="commitSpeed"
        @keydown.enter.prevent="blurTarget"
      />
      <span class="wb-tl-x">×</span>
      <button
        type="button"
        class="wb-tl-step"
        :disabled="speed >= 100"
        aria-label="提高倍率"
        @click="stepSpeed(1)"
      >
        +
      </button>
    </div>

    <span class="wb-tl-time">{{ simTime }}</span>

    <div class="wb-tl-track">
      <div class="wb-tl-band" />
      <div class="wb-tl-marks">
        <i v-for="h in HOURS" :key="h" :class="{ major: h % 6 === 0 }" />
      </div>
      <input
        type="range"
        min="0"
        max="1439"
        step="1"
        :value="sunMinutes"
        :style="{ '--fill': sunPercent }"
        aria-label="太阳时间"
        @input="emit('sun-scrub', $event)"
      />
    </div>

    <div class="wb-tl-legend">
      <button
        v-for="h in LEGEND"
        :key="h"
        type="button"
        :title="`跳转到 ${h}:00`"
        @click="emit('jump-hour', h)"
      >
        {{ String(h).padStart(2, '0') }}
      </button>
    </div>

    <button
      type="button"
      class="wb-tl-wx"
      :class="{ on: weatherOn && weather !== 'clear' }"
      title="天气面板 Alt+W"
      @click="emit('open-weather')"
    >
      <WeatherIcon :kind="weatherOn ? weather : 'clear'" :size="14" />
      {{ weatherOn ? (weather === 'clear' ? '晴天' : '天气') : '晴天' }}
    </button>

    <button type="button" class="wb-tl-wx" title="回到当前时间" @click="emit('reset-sun')">
      现在
    </button>

    <button
      type="button"
      class="wb-tl-wx"
      :class="{ on: presenting }"
      :disabled="!hasVenue"
      :title="presenting ? '退出展示模式 (Esc)' : '展示模式 (S)'"
      @click="emit('presentation')"
    >
      {{ presenting ? '退出展示' : '展示模式' }}
    </button>
  </footer>
</template>
