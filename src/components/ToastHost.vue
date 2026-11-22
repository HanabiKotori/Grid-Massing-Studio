<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  clearMessages,
  dismissMessage,
  messages,
  toastKindOf,
  typeLabel,
  type AppMessage,
  type MessageScope,
  type ToastKind,
} from '../core/messageCenter'
import { installNotificationAudioUnlock } from '../core/notificationSound'

const props = withDefaults(
  defineProps<{
    scope: MessageScope
    kind: ToastKind
    placement?: 'top-right' | 'top-center' | 'bottom-center'
    /** bottom-center 的距底距离，可传 CSS 表达式 */
    offset?: string
  }>(),
  {
    placement: 'top-right',
    offset: '',
  },
)

const visible = ref<AppMessage[]>([])
const timers = new Map<number, number>()

const scoped = computed(() =>
  messages.filter(
    (message) =>
      message.scope === props.scope && toastKindOf(message.type) === props.kind,
  ),
)

const hostStyle = computed(() =>
  props.offset ? { '--toast-offset': props.offset } : {},
)

function clearTimer(id: number) {
  const timer = timers.get(id)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timers.delete(id)
  }
}

function startTimer(message: AppMessage) {
  clearTimer(message.id)
  if (!message.duration) return
  const timer = window.setTimeout(() => {
    timers.delete(message.id)
    dismissMessage(message.id)
  }, message.duration)
  timers.set(message.id, timer)
}

function sync() {
  const current = scoped.value
  const currentIds = new Set(current.map((message) => message.id))
  for (const message of visible.value) {
    if (!currentIds.has(message.id)) clearTimer(message.id)
  }
  visible.value = visible.value.filter((message) => currentIds.has(message.id))

  const visibleIds = new Set(visible.value.map((message) => message.id))
  for (const message of current) {
    if (visible.value.length >= 3) break
    if (visibleIds.has(message.id)) continue
    visible.value.push(message)
    visibleIds.add(message.id)
    startTimer(message)
  }
}

watch(scoped, sync, { deep: true, immediate: true, flush: 'post' })

onMounted(installNotificationAudioUnlock)

function close(message: AppMessage) {
  clearTimer(message.id)
  dismissMessage(message.id)
}

function runAction(message: AppMessage) {
  const action = message.action
  close(message)
  action?.run()
}

onBeforeUnmount(() => {
  for (const timer of timers.values()) window.clearTimeout(timer)
  timers.clear()
  clearMessages(props.scope)
})
</script>

<template>
  <div
    class="toast-host"
    :class="[
      `scope-${scope}`,
      `kind-${kind}`,
      `placement-${placement}`,
    ]"
    :style="hostStyle"
    aria-live="polite"
    aria-atomic="false"
  >
    <TransitionGroup name="toast-item" tag="div" class="toast-stack">
      <article
        v-for="message in visible"
        :key="message.id"
        class="toast-item"
        :class="[message.type, `severity-${message.severity}`]"
        :role="message.type === 'block' ? 'alert' : 'status'"
      >
        <span class="toast-type" aria-hidden="true">{{ typeLabel(message.type) }}</span>
        <div class="toast-copy">
          <b>{{ message.title }}</b>
          <span v-if="message.text">{{ message.text }}</span>
        </div>
        <button
          v-if="message.action"
          class="toast-action"
          type="button"
          @click="runAction(message)"
        >
          {{ message.action.label }}
        </button>
        <button class="toast-close" type="button" aria-label="关闭提示" @click="close(message)">
          ×
        </button>
        <span
          v-if="message.duration"
          class="toast-progress"
          :style="{ animationDuration: `${message.duration}ms` }"
          aria-hidden="true"
        />
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  z-index: 320;
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: min(380px, calc(100vw - 28px));
  pointer-events: none;
}

.toast-host.kind-collab {
  width: min(340px, calc(100vw - 28px));
}

.placement-top-right {
  top: 58px;
  right: 14px;
  align-items: flex-end;
}

.placement-top-center {
  top: 58px;
  left: 50%;
  transform: translateX(-50%);
  align-items: center;
}

.placement-bottom-center {
  bottom: var(--toast-offset, 74px);
  left: 50%;
  transform: translateX(-50%);
  align-items: center;
}

.toast-host.scope-editor.kind-action {
  z-index: 320;
}

.toast-host.scope-editor.kind-collab,
.toast-host.scope-editor.kind-system {
  z-index: 70;
}

.toast-host.scope-share {
  z-index: 30;
}

/* 分享页桌面端右侧有 348px 评论栏，Toast 不压住评论内容 */
.toast-host.scope-share.placement-top-right {
  right: calc(348px + 14px);
}

.toast-host.scope-share.placement-bottom-center {
  left: calc((100% - 348px) / 2);
}

.toast-host.scope-multiplayer {
  z-index: 80;
}

.toast-host.scope-multiplayer.placement-top-center {
  top: 64px;
}

.toast-stack {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
}

.toast-item {
  --toast-accent: #8f98a8;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 9px 10px 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(14, 15, 18, 0.98);
  box-shadow: 0 18px 44px -24px rgba(0, 0, 0, 0.95);
  color: #ecedef;
  pointer-events: auto;
}

.toast-item::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--toast-accent);
}

.toast-item.collab {
  --toast-accent: #6f7ce8;
}

.toast-item.system {
  --toast-accent: #7fa7b8;
}

.toast-item.block,
.toast-item.severity-error {
  --toast-accent: #eb5757;
}

.toast-item.severity-success {
  --toast-accent: #5bbd8b;
}

.toast-type {
  width: 18px;
  height: 18px;
  flex: none;
  display: grid;
  place-items: center;
  margin-top: 1px;
  border: 1px solid color-mix(in srgb, var(--toast-accent) 38%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--toast-accent) 12%, transparent);
  color: var(--toast-accent);
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 8px;
  line-height: 1;
}

.toast-copy {
  min-width: 0;
  flex: 1;
  padding-top: 1px;
}

.toast-copy b {
  display: block;
  overflow: hidden;
  color: #ecedef;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-copy span {
  display: block;
  margin-top: 1px;
  overflow: hidden;
  color: #777c84;
  font-size: 9px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-action {
  flex: none;
  height: 21px;
  padding: 0 7px;
  border: 0;
  border-radius: 4px;
  background: rgba(111, 124, 232, 0.12);
  color: #a7b0ff;
  font: inherit;
  font-size: 9.5px;
  cursor: pointer;
}

.toast-action:hover {
  background: rgba(111, 124, 232, 0.2);
}

.toast-close {
  width: 18px;
  height: 18px;
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  color: #555a62;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.toast-close:hover {
  color: #ecedef;
}

.toast-progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--toast-accent);
  opacity: 0.9;
  transform-origin: left center;
  animation: toast-countdown linear forwards;
}

@keyframes toast-countdown {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.toast-item-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.toast-item-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.toast-item-move {
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.toast-item-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.985);
}

.toast-item-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.99);
}

@media (max-width: 900px) {
  .toast-host {
    width: calc(100vw - 24px);
  }

  .placement-top-right {
    top: 54px;
    right: 12px;
    left: 12px;
    align-items: stretch;
  }

  .toast-host.scope-share.placement-top-right {
    right: 12px;
  }

  .toast-host.scope-share.placement-bottom-center {
    left: 50%;
  }

  .placement-bottom-center {
    bottom: var(--toast-offset, 64px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-item-enter-active,
  .toast-item-leave-active,
  .toast-item-move {
    transition: none;
  }

  .toast-progress {
    animation: none;
    transform: scaleX(1);
    opacity: 0.35;
  }
}
</style>
