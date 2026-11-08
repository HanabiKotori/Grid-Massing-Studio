<script setup lang="ts">
import type { WeatherKind } from '../core/weather'

withDefaults(
  defineProps<{
    kind: WeatherKind
    size?: number
  }>(),
  { size: 16 },
)
</script>

<template>
  <svg
    class="weather-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g v-if="kind === 'clear'">
      <circle cx="12" cy="12" r="3.8" fill="currentColor" stroke="none" />
      <path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </g>

    <g v-else-if="kind === 'partly'">
      <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
      <path d="M8 2.8v1.4M2.8 8h1.4M4.3 4.3l1 1M11.7 4.3l-1 1" />
      <path d="M8 18h10.3a3.3 3.3 0 0 0 .2-6.6 5 5 0 0 0-9.4-1.1A3.6 3.6 0 0 0 8 18Z" />
    </g>

    <g v-else-if="kind === 'cloudy'">
      <path d="M4 14.3h8.3a2.8 2.8 0 0 0 .2-5.6 4.1 4.1 0 0 0-7.7-.9A3 3 0 0 0 4 14.3Z" opacity="0.55" />
      <path d="M7.3 19h10.2a3.2 3.2 0 0 0 .2-6.4 4.9 4.9 0 0 0-9.2-1.1A3.5 3.5 0 0 0 7.3 19Z" />
    </g>

    <g v-else-if="kind === 'overcast'">
      <path d="M3.5 12.8h8.8a2.9 2.9 0 0 0 .1-5.8 4.2 4.2 0 0 0-7.9-.9 3.1 3.1 0 0 0-1 6.7Z" opacity="0.6" />
      <path d="M7.3 19.3h10.2a3.2 3.2 0 0 0 .2-6.4 4.9 4.9 0 0 0-9.2-1.1 3.5 3.5 0 0 0-1.2 7.5Z" fill="currentColor" fill-opacity="0.08" />
    </g>

    <g v-else-if="kind === 'haze'">
      <path d="M6.7 14.8h9.6a3 3 0 0 0 .2-6 4.7 4.7 0 0 0-8.9-1 3.4 3.4 0 0 0-.9 7Z" opacity="0.65" />
      <path d="M4 18h13M7 21h10" opacity="0.75" />
    </g>

    <g v-else-if="kind === 'fog'">
      <path d="M6.7 13.8h9.6a3 3 0 0 0 .2-6 4.7 4.7 0 0 0-8.9-1 3.4 3.4 0 0 0-.9 7Z" opacity="0.55" />
      <path d="M3.5 16.8h13M7 19.8h13.5M4.5 22h12" />
    </g>

    <g v-else-if="kind === 'light-rain'">
      <path d="M6.7 14h9.6a3 3 0 0 0 .2-6 4.7 4.7 0 0 0-8.9-1 3.4 3.4 0 0 0-.9 7Z" />
      <path d="M8.5 17.2 7.6 20M14.8 17.2l-.9 2.8" />
    </g>

    <g v-else-if="kind === 'heavy-rain'">
      <path d="M6.7 13.3h9.6a3 3 0 0 0 .2-6 4.7 4.7 0 0 0-8.9-1 3.4 3.4 0 0 0-.9 7Z" />
      <path d="M6.7 16.3 5.8 20M10.5 16.3 9.6 21M14.4 16.3l-.9 4.7M18.1 16.3l-.9 3.5" />
    </g>

    <g v-else-if="kind === 'thunder'">
      <path d="M6.7 13.3h9.6a3 3 0 0 0 .2-6 4.7 4.7 0 0 0-8.9-1 3.4 3.4 0 0 0-.9 7Z" />
      <path d="m12.7 14.8-2.6 4h3l-1.6 4.2 4.2-5.5h-3l1.5-2.7Z" fill="currentColor" stroke="none" />
    </g>

    <g v-else-if="kind === 'light-snow'">
      <path d="M6.7 13.5h9.6a3 3 0 0 0 .2-6 4.7 4.7 0 0 0-8.9-1 3.4 3.4 0 0 0-.9 7Z" />
      <path d="M8.3 17v4M6.6 18l3.4 2M10 18l-3.4 2M15.7 17v4M14 18l3.4 2M17.4 18l-3.4 2" opacity="0.8" />
    </g>

    <g v-else-if="kind === 'heavy-snow'">
      <path d="M6.7 12.8h9.6a3 3 0 0 0 .2-6 4.7 4.7 0 0 0-8.9-1 3.4 3.4 0 0 0-.9 7Z" />
      <circle cx="7.2" cy="17.4" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16.8" cy="17.2" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.7" cy="22" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.3" cy="22" r="1.2" fill="currentColor" stroke="none" />
    </g>

    <g v-else-if="kind === 'dust'">
      <path d="M3 8.5h10.3a2.8 2.8 0 1 0-2.5-4M3 13h15.2a2.6 2.6 0 1 1-2.3 3.7M3 17.5h8.2" />
      <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="20" cy="15" r="1" fill="currentColor" stroke="none" opacity="0.5" />
    </g>

    <g v-else-if="kind === 'wind'">
      <path d="M3 7.5h10.4a2.9 2.9 0 1 0-2.7-4M3 12.5h15.5a2.8 2.8 0 1 1-2.6 4M3 17.5h7.5" />
    </g>
  </svg>
</template>

<style scoped>
.weather-icon {
  display: block;
  flex: none;
  overflow: visible;
}
</style>
