<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import type { Stage, WalkState, WalkView } from '../core/Stage'
import type { WalkTourInfo, WalkTourStopInfo } from '../core/walkTour'
import { useMobileWalkControls } from '../composables/useMobileWalkControls'

const props = defineProps<{
  walkState: WalkState
  walkView: WalkView
  walkInteract: { id: string; name: string; open: boolean } | null
  isMobile: boolean
  spaceNavActive: boolean
  showRotateHint: boolean
  walkAuto: boolean
  walkAutoSpeed: number
  walkAutoLoop: boolean
  walkTourInfo: WalkTourInfo | null
  getStage: () => Stage | null
}>()

const emit = defineEmits<{
  (e: 'cancel-rotate'): void
  (e: 'toggle-auto'): void
  (e: 'update:speed', value: number): void
  (e: 'update:loop', value: boolean): void
}>()

const speedText = computed(
  () => (Math.round(props.walkAutoSpeed * 10) / 10).toFixed(1),
)

const tourCurrent = computed(() => props.walkTourInfo?.current ?? null)
const tourNext = computed(() => props.walkTourInfo?.next ?? null)

function logoUrl(logo?: string): string {
  if (!logo) return ''
  return logo.startsWith('data:') ? logo : `data:image/png;base64,${logo}`
}

function areaText(area: number): string {
  return `${Math.max(0, Math.round(area))} m²`
}

function nextSub(info: WalkTourStopInfo): string {
  return info.exhibitor?.trim() || areaText(info.area)
}

function changeSpeed(delta: number) {
  emit('update:speed', Math.min(2, Math.max(0.5, props.walkAutoSpeed + delta)))
}

function toggleLoop() {
  emit('update:loop', !props.walkAutoLoop)
}

const {
  moveKnob,
  moveBoost,
  lookKnob,
  onMoveStickDown,
  onLookStickDown,
  jumpMobileWalk,
  returnMobileWalk,
  exitMobileWalk,
  dispose,
} = useMobileWalkControls({ getStage: () => props.getStage() })

function toggleView() {
  props.getStage()?.toggleWalkView()
}

onBeforeUnmount(dispose)
</script>

<template>
  <div
    v-if="spaceNavActive && !isMobile"
    class="walk-tip space-nav-tip"
  >
    <b>浏览模式</b>
    <span>左键旋转视角 · 右键平移 · 松开空格恢复编辑</span>
  </div>

  <div v-if="walkState === 'pick'" class="walk-tip">
    <b>点击地面选择起始位置</b>
    <span>Esc 或再次点击「漫游」取消</span>
  </div>

  <div v-if="walkState === 'walk'" class="walk-cross" :class="walkView" />
  <div v-if="walkState === 'walk' && walkInteract" class="walk-interact">
    <kbd>左键</kbd>
    <span>
      {{ walkInteract.open ? '关闭' : '打开' }}「{{ walkInteract.name }}」
    </span>
  </div>

  <div v-if="walkState === 'walk' && isMobile && !walkAuto" class="walk-sticks">
    <div class="look-zone" @pointerdown="onLookStickDown" />
    <div class="walk-stick left">
      <span>移动</span>
      <div
        ref="moveStickEl"
        class="stick-base"
        :class="{ boost: moveBoost > 0.05 }"
        @pointerdown="onMoveStickDown"
      >
        <div
          class="stick-knob"
          :style="{
            transform: `translate(${moveKnob.x * 30}px, ${moveKnob.y * 30}px)`,
          }"
        />
      </div>
    </div>
    <div class="walk-stick right">
      <span>视角</span>
      <div class="stick-base">
        <div
          class="stick-knob"
          :style="{
            transform: `translate(${lookKnob.x * 26}px, ${lookKnob.y * 26}px)`,
          }"
        />
      </div>
    </div>
  </div>

  <div v-if="walkState === 'walk' && isMobile" class="walk-mobile-actions">
    <button
      type="button"
      class="walk-action"
      @pointerdown.stop.prevent="toggleView"
    >
      {{ walkView === 'first' ? '第三人称' : '第一人称' }}
    </button>
    <button
      type="button"
      class="walk-action"
      @pointerdown.stop.prevent="returnMobileWalk"
    >
      回到起点
    </button>
    <button
      type="button"
      class="walk-action"
      @pointerdown.stop.prevent="jumpMobileWalk"
    >
      跳跃
    </button>
    <button
      type="button"
      class="walk-action"
      @pointerdown.stop.prevent="exitMobileWalk"
    >
      退出
    </button>
  </div>

  <div v-if="showRotateHint" class="rotate-hint">
    <div class="rotate-card">
      <div class="rotate-icon">
        <svg
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        >
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M10.5 5h3" />
        </svg>
      </div>
      <b>请将手机横过来</b>
      <span>
        {{ walkState !== 'off' ? '横屏后继续漫游' : '横屏后自动进入漫游' }}
      </span>
      <button
        class="rotate-cancel"
        @pointerdown.stop
        @click.stop="emit('cancel-rotate')"
      >
        {{ walkState !== 'off' ? '退出漫游' : '取消' }}
      </button>
    </div>
  </div>

  <div
    v-if="walkState === 'walk' && walkAuto && (tourCurrent || tourNext)"
    class="walk-tour-info"
  >
    <div v-if="tourCurrent" class="walk-tour-card current">
      <div v-if="tourCurrent.logo" class="walk-tour-logo">
        <img :src="logoUrl(tourCurrent.logo)" alt="" />
      </div>
      <div class="walk-tour-body">
        <span class="walk-tour-kicker">正在参观</span>
        <div class="walk-tour-title">
          <b>{{ tourCurrent.name }}</b>
          <em>{{ tourCurrent.kindLabel }}</em>
        </div>
        <span class="walk-tour-exhibitor">
          {{ tourCurrent.exhibitor || '展商信息未填写' }}
        </span>
        <span class="walk-tour-area">{{ areaText(tourCurrent.area) }}</span>
      </div>
    </div>

    <div v-if="tourNext" class="walk-tour-card next">
      <span class="walk-tour-kicker">下一站</span>
      <div class="walk-tour-next-main">
        <b>{{ tourNext.name }}</b>
        <span>{{ nextSub(tourNext) }}</span>
      </div>
    </div>
    <div v-else-if="tourCurrent" class="walk-tour-card next empty">
      <span class="walk-tour-kicker">下一站</span>
      <span>巡游即将结束</span>
    </div>
  </div>

  <div
    v-if="walkState === 'walk' && (isMobile || walkAuto)"
    class="walk-auto"
    :class="{ active: walkAuto }"
  >
    <template v-if="isMobile">
      <button
        type="button"
        class="walk-action"
        @pointerdown.stop.prevent="emit('toggle-auto')"
      >
        {{ walkAuto ? '接管' : '自动巡游' }}
      </button>
      <button
        type="button"
        class="walk-mini"
        @pointerdown.stop.prevent="changeSpeed(-0.1)"
      >
        −
      </button>
      <span class="walk-speed">{{ speedText }}×</span>
      <button
        type="button"
        class="walk-mini"
        @pointerdown.stop.prevent="changeSpeed(0.1)"
      >
        ＋
      </button>
      <button
        type="button"
        class="walk-mini walk-loop"
        @pointerdown.stop.prevent="toggleLoop"
      >
        {{ walkAutoLoop ? '循环' : '单次' }}
      </button>
    </template>
    <template v-else>
      <b>自动巡游</b>
      <span>{{ tourCurrent ? '参观中' : '行进中' }}</span>
      <span>速度 {{ speedText }}×</span>
      <span><kbd>[</kbd><kbd>]</kbd> 调速</span>
      <span><kbd>L</kbd> {{ walkAutoLoop ? '循环' : '单次' }}</span>
      <span><kbd>E</kbd> 停止</span>
      <button
        v-if="walkAuto"
        type="button"
        class="walk-takeover"
        title="停止自动巡游，恢复手动移动"
        @click="emit('toggle-auto')"
      >
        接管
      </button>
    </template>
  </div>

  <!-- 巡游时隐藏普通操作提示，只保留上方巡游栏，避免两组提示重复 -->
  <div v-if="walkState === 'walk' && !walkAuto" class="walk-hud">
    <b>{{ walkView === 'first' ? '第一人称预览' : '第三人称预览' }}</b>
    <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span>
    <span><kbd>Shift</kbd> 加速</span>
    <span><kbd>空格</kbd> 跳跃</span>
    <span><kbd>Alt</kbd> 释放鼠标</span>
    <span><kbd>R</kbd> 回到起点</span>
    <span><kbd>M</kbd> 按住放大地图</span>
    <span><kbd>V</kbd> 切换视角</span>
    <span v-if="!walkAuto"><kbd>E</kbd> 自动巡游</span>
    <span v-else><kbd>E</kbd> 停止巡游</span>
    <span><kbd>Alt</kbd>+<kbd>W</kbd> 天气</span>
    <span><kbd>Esc</kbd> 退出</span>
  </div>
</template>
