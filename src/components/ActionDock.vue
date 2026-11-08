<script setup lang="ts">
import { computed } from 'vue'
import type { EditorMode, Pt } from '../core/types'

const props = defineProps<{
  mode: EditorMode
  points: Pt[]
  height: number
  area: number
}>()

const emit = defineEmits<{
  (e: 'undo'): void
  (e: 'cancel'): void
  (e: 'close'): void
  (e: 'back'): void
  (e: 'confirm'): void
  (e: 'height', value: number): void
}>()

const drawing = computed(() => props.mode === 'draw-venue' || props.mode === 'draw-booth')
const isVenue = computed(() => props.mode === 'draw-venue' || props.mode === 'height-venue')
const title = computed(() => (isVenue.value ? '场馆轮廓' : '展台轮廓'))
const minH = computed(() => (isVenue.value ? 2 : 1))
const maxH = computed(() => (isVenue.value ? 24 : 8))
const presets = computed(() => (isVenue.value ? [4, 6, 8, 12, 16] : [1, 2, 3, 4, 5]))
const fmt = (n: number) => n.toFixed(1)

const fillStyle = computed((): any => {
  const pct = Math.max(
    0,
    Math.min(100, ((props.height - minH.value) / (maxH.value - minH.value)) * 100),
  )
  return { '--fill': `${pct}%` }
})

function onRange(e: Event) {
  emit('height', Math.round(Number((e.target as HTMLInputElement).value)))
}

function onNumber(e: Event) {
  const v = Math.round(parseFloat((e.target as HTMLInputElement).value))
  if (Number.isFinite(v) && v > 0) emit('height', v)
}
</script>

<template>
  <div class="dock">
    <template v-if="drawing">
      <div class="dock-head">
        <span class="pill"><i />绘制中</span>
        <b>{{ title }}</b>
        <span class="dock-sub">{{ points.length }} 个顶点 · {{ fmt(area) }} m²</span>
      </div>
      <p class="dock-hint">
        <span v-if="!isVenue" class="hint-flag">场馆已半透明</span>
        在网格交点上单击放点，点击起点或双击 / 按 Enter 闭合轮廓；按住左键拖拽可旋转视角。
      </p>
      <div class="dock-actions">
        <button class="btn ghost" :disabled="!points.length" @click="emit('undo')">撤销上一点</button>
        <button class="btn ghost" @click="emit('cancel')">取消</button>
        <button class="btn primary" :disabled="points.length < 3" @click="emit('close')">
          闭合轮廓
        </button>
      </div>
    </template>

    <template v-else>
      <div class="dock-head">
        <span class="pill amber"><i />确认高度</span>
        <b>{{ title }}</b>
        <span class="dock-sub">{{ points.length }} 个顶点 · {{ fmt(area) }} m²</span>
      </div>

      <div class="height-row">
        <div class="slider-wrap">
          <input
            type="range"
            :min="minH"
            :max="maxH"
            step="1"
            :value="height"
            :style="fillStyle"
            @input="onRange"
          />
          <div class="height-scale"><span>{{ minH }} m</span><span>{{ maxH }} m</span></div>
        </div>
        <div class="num-box">
          <input
            type="number"
            :min="minH"
            :max="maxH"
            step="1"
            :value="height"
            @input="onNumber"
            @keydown.enter="emit('confirm')"
          />
          <span>m</span>
        </div>
      </div>

      <div class="dock-actions">
        <div class="presets">
          <button
            v-for="p in presets"
            :key="p"
            class="chip"
            :class="{ on: Math.abs(height - p) < 0.05 }"
            @click="emit('height', p)"
          >
            {{ p }}m
          </button>
        </div>
        <button class="btn ghost" @click="emit('back')">返回修改轮廓</button>
        <button class="btn primary" @click="emit('confirm')">
          生成{{ isVenue ? '场馆' : '展台' }}白膜
        </button>
      </div>
    </template>
  </div>
</template>
