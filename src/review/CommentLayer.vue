<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Stage } from '../core/Stage'
import type { CommentAnchor, ShareComment } from '../core/shareApi'
import type { Booth, Infra } from '../core/types'
import { resolveAnchor } from './anchors'

interface PendingAnchor {
  point: [number, number, number]
  object?: { kind: 'booth' | 'infra'; id: string }
}

const props = withDefaults(
  defineProps<{
    getStage: () => Stage | null
    comments: ShareComment[]
    booths: Booth[]
    infras: Infra[]
    activeId?: number | null
    visible?: boolean
    pending?: PendingAnchor | null
  }>(),
  {
    activeId: null,
    visible: true,
    pending: null,
  },
)

const emit = defineEmits<{
  (e: 'select', comment: ShareComment): void
}>()

const pinEls = new Map<number, HTMLElement>()
const pendingEl = ref<HTMLElement | null>(null)
let frame = 0

const pins = computed(() => {
  const ids = new Set(props.comments.map((c) => c.id))
  const roots = props.comments
    .filter((c) => !c.parentId || !ids.has(c.parentId))
    .slice()
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
  return roots.map((comment, index) => ({
    id: comment.id,
    n: index + 1,
    comment,
    anchor: comment.anchor,
    resolved: !!comment.resolvedAt,
  }))
})

function setPinEl(id: number, el: Element | unknown | null) {
  if (!el) {
    pinEls.delete(id)
    return
  }
  pinEls.set(id, el as HTMLElement)
}

function place(el: HTMLElement | null, x: number, y: number, z: number) {
  const stage = props.getStage()
  if (!el || !stage) return false
  const p = stage.worldToScreen(x, y, z)
  el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`
  el.style.display = p.visible ? 'grid' : 'none'
  return p.visible
}

function tick() {
  frame = requestAnimationFrame(tick)
  if (!props.visible) return
  for (const pin of pins.value) {
    const el = pinEls.get(pin.id)
    if (!el) continue
    const a = resolveAnchor(pin.anchor as CommentAnchor, props.booths, props.infras)
    el.classList.toggle('invalid', !a.valid)
    el.classList.toggle('resolved', pin.resolved)
    place(el, a.x, a.y, a.z)
  }
  if (pendingEl.value && props.pending) {
    const point = props.pending.point
    place(pendingEl.value, point[0], point[1], point[2])
  }
}

onMounted(() => {
  frame = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      for (const el of pinEls.values()) el.style.display = 'none'
      if (pendingEl.value) pendingEl.value.style.display = 'none'
    }
  },
)
</script>

<template>
  <div v-show="visible" class="review-pins">
    <button
      v-for="pin in pins"
      :key="pin.id"
      :ref="(el) => setPinEl(pin.id, el)"
      type="button"
      class="review-pin"
      :class="{ active: activeId === pin.id }"
      :title="pin.comment.content"
      @click.stop="emit('select', pin.comment)"
    >
      {{ pin.n }}
    </button>
    <button
      v-if="pending"
      ref="pendingEl"
      type="button"
      class="review-pin pending"
      title="待放置的评论"
    >
      +
    </button>
  </div>
</template>
