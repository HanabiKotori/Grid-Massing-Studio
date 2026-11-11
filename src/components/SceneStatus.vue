<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LiveWeather } from '../core/amapWeather'
import type { WalkState } from '../core/Stage'
import WeatherIcon from './WeatherIcon.vue'

const props = withDefaults(
  defineProps<{
    venueName: string
    editingVenueName: boolean
    simTime: string
    sunIsDay: boolean
    sunPlaying: boolean
    sunMinutes: number
    sunPercent: string
    liveWeather: LiveWeather | null
    weatherOn: boolean
    isMobile: boolean
    walkState: WalkState
    renderOnly: boolean
    canUndo: boolean
    canRedo: boolean
    northDeg: number
    /** 多人房间：隐藏品牌、编辑 / 预览切换与实时天气，只保留时间 / 罗盘 */
    multiplayer?: boolean
    /** 是否显示模拟时间；多人房间仅房主显示 */
    showClock?: boolean
  }>(),
  {
    // 单人页面不传该 prop，Boolean 缺省会被 Vue 转成 false，这里显式恢复显示
    showClock: true,
  },
)

const emit = defineEmits<{
  (e: 'update:venue-name', value: string): void
  (e: 'begin-rename'): void
  (e: 'finish-rename'): void
  (e: 'cancel-rename'): void
  (e: 'toggle-sun'): void
  (e: 'reset-sun'): void
  (e: 'sun-scrub', event: Event): void
  (e: 'set-render', on: boolean): void
  (e: 'undo'): void
  (e: 'redo'): void
}>()

const nameInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.editingVenueName,
  (editing) => {
    if (!editing) return
    nextTick(() => {
      nameInput.value?.focus()
      nameInput.value?.select()
    })
  },
)
</script>

<template>
  <header v-if="!multiplayer" class="brand">
    <div class="brand-mark">
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      >
        <path d="M12 3 21 7.5v9L12 21 3 16.5v-9z" />
        <path d="M3 7.5 12 12l9-4.5M12 12v9" />
      </svg>
    </div>
    <div>
      <h1>
        <input
          v-if="editingVenueName"
          ref="nameInput"
          :value="venueName"
          class="brand-name-input"
          maxlength="24"
          aria-label="场馆名称"
          @input="emit('update:venue-name', ($event.target as HTMLInputElement).value)"
          @blur="emit('finish-rename')"
          @keydown.enter.prevent.stop="emit('finish-rename')"
          @keydown.esc.prevent.stop="emit('cancel-rename')"
        />
        <button
          v-else
          type="button"
          class="brand-name"
          title="点击重命名场馆"
          @click="emit('begin-rename')"
        >
          {{ venueName }}
        </button>
      </h1>
      <p>Grid Massing Studio</p>
    </div>
  </header>

  <div
    v-if="showClock !== false"
    class="sim-clock"
    :class="{ night: !sunIsDay }"
    title="模拟时间"
  >
    <div class="sim-clock-head">
      <svg
        v-if="sunIsDay"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path
          d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
      <svg
        v-else
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z"
          fill="currentColor"
        />
      </svg>
      <b>{{ simTime }}</b>
      <button
        class="sim-play"
        :title="sunPlaying ? '暂停时间' : '播放时间'"
        @click="emit('toggle-sun')"
      >
        <svg
          v-if="sunPlaying"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="7" y="5" width="3.5" height="14" rx="1" />
          <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
        </svg>
        <svg
          v-else
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </button>
      <button
        class="sim-now"
        title="回到当前时间"
        aria-label="回到当前时间"
        @click="emit('reset-sun')"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
          <path d="M20.5 4.5V10H15" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      </button>
    </div>
    <div class="sim-track">
      <span>0:00</span>
      <input
        class="sim-range"
        type="range"
        min="0"
        max="1439"
        step="1"
        :value="sunMinutes"
        :style="{ '--fill': sunPercent }"
        @input="emit('sun-scrub', $event)"
      />
      <span>23:59</span>
    </div>
  </div>

  <div
    v-if="!multiplayer && !isMobile && liveWeather && weatherOn"
    class="sim-weather"
    :title="`${liveWeather.city} · ${liveWeather.weather} ${liveWeather.temperature}°C · 湿度 ${liveWeather.humidity}%`"
  >
    <div class="sim-weather-main">
      <WeatherIcon :kind="liveWeather.kind" :size="13" />
      <b>{{ liveWeather.weather }}</b>
    </div>
    <span>{{ liveWeather.temperature }}°C</span>
  </div>

  <div
    v-if="!multiplayer && (!isMobile || walkState === 'off')"
    class="mode-switch"
  >
    <button
      class="mode-btn"
      :class="{ on: !renderOnly }"
      @click="emit('set-render', false)"
    >
      编辑
    </button>
    <button
      class="mode-btn"
      :class="{ on: renderOnly }"
      @click="emit('set-render', true)"
    >
      预览
    </button>
    <span class="mode-divider" />
    <button
      class="mode-icon"
      :disabled="!canUndo"
      title="撤销 Ctrl+Z"
      @click="emit('undo')"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M9 7 4 12l5 5" />
        <path d="M4 12h9a5 5 0 0 1 5 5v1" />
      </svg>
    </button>
    <button
      class="mode-icon"
      :disabled="!canRedo"
      title="重做 Ctrl+Y"
      @click="emit('redo')"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m15 7 5 5-5 5" />
        <path d="M20 12h-9a5 5 0 0 0-5 5v1" />
      </svg>
    </button>
  </div>

  <div class="compass" title="指北罗盘 · N 指向北方">
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <line
        v-for="i in 12"
        :key="i"
        x1="32"
        y1="5"
        x2="32"
        :y2="i % 3 === 0 ? 10 : 7.5"
        :class="i % 3 === 0 ? 'compass-tick-major' : 'compass-tick'"
        :transform="`rotate(${i * 30} 32 32)`"
      />
      <g :transform="`rotate(${northDeg} 32 32)`">
        <path class="compass-north" d="M32 15 L36.5 32 L32 29 L27.5 32 Z" />
        <path class="compass-south" d="M32 49 L27.5 32 L32 35 L36.5 32 Z" />
        <text class="compass-n" x="32" y="10" text-anchor="middle">N</text>
      </g>
    </svg>
  </div>
</template>
