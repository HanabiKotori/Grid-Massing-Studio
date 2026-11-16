<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const cancelButton = ref<HTMLButtonElement | null>(null)

/** 弹层打开期间拦截全局快捷键，只保留 Esc 取消 */
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    emit('cancel')
    return
  }
  event.stopImmediatePropagation()
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown, true)
  void nextTick(() => cancelButton.value?.focus())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown, true)
})
</script>

<template>
  <div class="modal-mask confirm-mask" @click.self="emit('cancel')">
    <div class="modal confirm-dialog" role="dialog" aria-modal="true" :aria-label="title">
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      <div class="modal-actions">
        <button ref="cancelButton" type="button" class="btn ghost" @click="emit('cancel')">
          {{ cancelLabel || '取消' }}
        </button>
        <button
          type="button"
          class="btn"
          :class="danger ? 'danger' : 'primary'"
          @click="emit('confirm')"
        >
          {{ confirmLabel || '确定' }}
        </button>
      </div>
    </div>
  </div>
</template>
