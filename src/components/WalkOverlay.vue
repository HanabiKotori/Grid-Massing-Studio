<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import type { Stage, WalkState, WalkView } from '../core/Stage'
import { useMobileWalkControls } from '../composables/useMobileWalkControls'

const props = defineProps<{
  walkState: WalkState
  walkView: WalkView
  walkInteract: { id: string; name: string; open: boolean } | null
  isMobile: boolean
  spaceNavActive: boolean
  showRotateHint: boolean
  getStage: () => Stage | null
}>()

const emit = defineEmits<{
  (e: 'cancel-rotate'): void
}>()

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

  <div v-if="walkState === 'walk' && isMobile" class="walk-sticks">
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

  <div v-if="walkState === 'walk'" class="walk-hud">
    <b>{{ walkView === 'first' ? '第一人称预览' : '第三人称预览' }}</b>
    <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span>
    <span><kbd>Shift</kbd> 加速</span>
    <span><kbd>空格</kbd> 跳跃</span>
    <span><kbd>Alt</kbd> 释放鼠标</span>
    <span><kbd>R</kbd> 回到起点</span>
    <span><kbd>M</kbd> 按住放大地图</span>
    <span><kbd>V</kbd> 切换视角</span>
    <span><kbd>Alt</kbd>+<kbd>W</kbd> 天气</span>
    <span><kbd>Esc</kbd> 退出</span>
  </div>
</template>
