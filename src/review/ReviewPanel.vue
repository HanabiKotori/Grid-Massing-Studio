<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CommentAnchor, ShareComment } from '../core/shareApi'

const props = withDefaults(
  defineProps<{
    comments: ShareComment[]
    selectedId: number | null
    mode: 'owner' | 'visitor'
    loggedIn: boolean
    connected: boolean
    loading?: boolean
    unreadIds?: number[]
    pendingAnchor?: CommentAnchor | null
    pendingLabel?: string
    authorLabel?: string
    closable?: boolean
    /** 链接是否开放新评论 / 回复 / 解决；关闭后评论只读 */
    commentEnabled?: boolean
    /** 当前访问者是否已登录；未登录只读并展示登录门槛 */
    authLoggedIn?: boolean
    objectLabel?: (comment: ShareComment) => string
  }>(),
  {
    loading: false,
    unreadIds: () => [],
    pendingAnchor: null,
    pendingLabel: '',
    authorLabel: '',
    closable: false,
    commentEnabled: true,
    authLoggedIn: true,
    objectLabel: undefined,
  },
)

const emit = defineEmits<{
  (e: 'select', comment: ShareComment): void
  (e: 'reply', payload: { comment: ShareComment; content: string }): void
  (e: 'resolve', comment: ShareComment): void
  (e: 'remove', comment: ShareComment): void
  (e: 'locate', comment: ShareComment): void
  (e: 'send', content: string): void
  (e: 'cancel-pending'): void
  (e: 'request-anchor'): void
  (e: 'refresh'): void
  (e: 'login'): void
  (e: 'register'): void
  (e: 'close'): void
}>()

type Filter = 'all' | 'open' | 'mine'
const filter = ref<Filter>('all')
const draft = ref('')
const unreadSet = computed(() => new Set(props.unreadIds ?? []))
const collapsedThreads = ref<Set<number>>(new Set())
const pendingDeleteId = ref<number | null>(null)
let deleteConfirmTimer = 0

const sorted = computed(() =>
  props.comments
    .slice()
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
)

const rootComments = computed(() => {
  const ids = new Set(sorted.value.map((c) => c.id))
  return sorted.value.filter((c) => !c.parentId || !ids.has(c.parentId))
})

const repliesByParent = computed(() => {
  const map = new Map<number, ShareComment[]>()
  for (const comment of sorted.value) {
    if (!comment.parentId) continue
    const list = map.get(comment.parentId) ?? []
    list.push(comment)
    map.set(comment.parentId, list)
  }
  return map
})

function repliesOf(rootId: number): ShareComment[] {
  return repliesByParent.value.get(rootId) ?? []
}

function isThreadCollapsed(rootId: number): boolean {
  return collapsedThreads.value.has(rootId)
}

function toggleThread(rootId: number) {
  const next = new Set(collapsedThreads.value)
  if (next.has(rootId)) next.delete(rootId)
  else next.add(rootId)
  collapsedThreads.value = next
}

function onThreadEnter(el: Element) {
  const node = el as HTMLElement
  node.style.height = '0px'
  node.style.opacity = '0'
  requestAnimationFrame(() => {
    node.style.height = `${node.scrollHeight}px`
    node.style.opacity = '1'
  })
}

function onThreadAfterEnter(el: Element) {
  const node = el as HTMLElement
  node.style.height = ''
  node.style.opacity = ''
}

function onThreadLeave(el: Element) {
  const node = el as HTMLElement
  node.style.height = `${node.scrollHeight}px`
  node.style.opacity = '1'
  requestAnimationFrame(() => {
    node.style.height = '0px'
    node.style.opacity = '0'
  })
}

function onThreadAfterLeave(el: Element) {
  const node = el as HTMLElement
  node.style.height = ''
  node.style.opacity = ''
}

const filteredRoots = computed(() => {
  const roots = rootComments.value
  if (filter.value === 'open') return roots.filter((c) => !c.resolvedAt)
  if (filter.value === 'mine') {
    return roots.filter((c) => c.mine || (props.mode === 'owner' && c.authorRole === 'owner'))
  }
  return roots
})

const selectedComment = computed(
  () => props.comments.find((c) => c.id === props.selectedId) ?? null,
)

const counts = computed(() => ({
  all: rootComments.value.length,
  open: rootComments.value.filter((c) => !c.resolvedAt).length,
  mine: rootComments.value.filter(
    (c) => c.mine || (props.mode === 'owner' && c.authorRole === 'owner'),
  ).length,
}))

const placeholder = computed(() => {
  if (props.pendingAnchor) return `评论 @ ${props.pendingLabel || '画布位置'}…`
  if (selectedComment.value?.legacy) return '历史匿名评论不可回复'
  if (selectedComment.value) return `回复 ${selectedComment.value.authorName}…`
  if (props.mode === 'visitor') return '先在画布上点选位置，再输入评论…'
  return '选择一条评论后回复…'
})

const canSubmit = computed(
  () =>
    props.commentEnabled &&
    props.authLoggedIn &&
    !!draft.value.trim() &&
    (!!props.pendingAnchor ||
      (!!selectedComment.value && !selectedComment.value.legacy)),
)

function rootNumber(comment: ShareComment): number {
  const root = comment.parentId
    ? rootComments.value.find((c) => c.id === comment.parentId) ?? comment
    : comment
  return rootComments.value.findIndex((c) => c.id === root.id) + 1
}

function timeText(value: string): string {
  const t = +new Date(value)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function labelOf(comment: ShareComment): string {
  return props.objectLabel?.(comment) ?? '定位'
}

function canDelete(comment: ShareComment): boolean {
  if (!props.commentEnabled || !props.authLoggedIn) return false
  if (comment.legacy) return props.mode === 'owner'
  return props.mode === 'owner' || comment.mine
}

function clearDeleteConfirm() {
  window.clearTimeout(deleteConfirmTimer)
  deleteConfirmTimer = 0
  pendingDeleteId.value = null
}

function requestDelete(comment: ShareComment) {
  clearDeleteConfirm()
  pendingDeleteId.value = comment.id
  // 误触后不操作则自动复原，避免长时间停在确认态
  deleteConfirmTimer = window.setTimeout(() => {
    pendingDeleteId.value = null
    deleteConfirmTimer = 0
  }, 4000)
}

function confirmDelete(comment: ShareComment) {
  clearDeleteConfirm()
  emit('remove', comment)
}

function cancelDelete() {
  clearDeleteConfirm()
}

watch(
  () => props.comments,
  (list) => {
    if (
      pendingDeleteId.value !== null &&
      !list.some((comment) => comment.id === pendingDeleteId.value)
    ) {
      clearDeleteConfirm()
    }
  },
)

onBeforeUnmount(clearDeleteConfirm)

function canResolve(comment: ShareComment): boolean {
  if (!props.commentEnabled || !props.authLoggedIn) return false
  if (comment.legacy) return false
  return props.mode === 'owner' || comment.mine
}

function canReply(comment: ShareComment): boolean {
  if (!props.commentEnabled || !props.authLoggedIn) return false
  return !comment.legacy
}

function onComposerFocus() {
  if (!props.commentEnabled || !props.authLoggedIn) return
  if (selectedComment.value?.legacy) return
  if (props.mode === 'visitor' && !props.pendingAnchor && !selectedComment.value) {
    emit('request-anchor')
  }
}

function submit() {
  if (!props.commentEnabled || !props.authLoggedIn) return
  const text = draft.value.trim()
  if (!text) return
  if (props.pendingAnchor) {
    emit('send', text)
    draft.value = ''
    return
  }
  if (selectedComment.value && !selectedComment.value.legacy) {
    emit('reply', { comment: selectedComment.value, content: text })
    draft.value = ''
  }
}

function select(comment: ShareComment) {
  emit('select', comment)
}

watch(
  () => props.selectedId,
  () => {
    /* 保留草稿：切换评论时不清空输入框 */
  },
)
</script>

<template>
  <section class="review-panel">
    <header class="rp-head">
      <h3>评审评论</h3>
      <span class="rp-count">{{ counts.all }}</span>
      <span class="rp-live" :class="{ on: connected }">
        <i />
        {{ connected ? '实时' : loggedIn ? '重连中' : '未登录' }}
      </span>
      <span class="rp-sp" />
      <button
        v-if="mode === 'visitor' && commentEnabled && authLoggedIn"
        class="rp-new-btn"
        type="button"
        title="新增评论"
        @click="emit('request-anchor')"
      >
        ＋ 新增
      </button>
      <button class="rp-icon" type="button" title="刷新" @click="emit('refresh')">↻</button>
      <button
        v-if="closable"
        class="rp-icon"
        type="button"
        title="关闭"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <div class="rp-filters">
      <button
        type="button"
        class="rp-chip"
        :class="{ on: filter === 'all' }"
        @click="filter = 'all'"
      >
        全部 <b>{{ counts.all }}</b>
      </button>
      <button
        type="button"
        class="rp-chip"
        :class="{ on: filter === 'open' }"
        @click="filter = 'open'"
      >
        未解决 <b>{{ counts.open }}</b>
      </button>
      <button
        type="button"
        class="rp-chip"
        :class="{ on: filter === 'mine' }"
        :disabled="mode === 'visitor' && !authLoggedIn"
        :title="mode === 'visitor' && !authLoggedIn ? '登录后可查看我的评论' : ''"
        @click="filter = 'mine'"
      >
        我的 <b>{{ counts.mine }}</b>
      </button>
    </div>

    <div class="rp-scroll">
      <div v-if="!loggedIn && mode === 'owner'" class="rp-empty">
        登录云端存储后，分享链接里的评论会实时出现在这里。
      </div>
      <div v-else-if="loading && !comments.length" class="rp-empty">正在读取评论…</div>
      <div v-else-if="!filteredRoots.length" class="rp-empty">
        {{ mode === 'owner' ? '还没有评论。分享链接后，访客的评论会实时出现在这里。' : !commentEnabled ? '还没有评论。' : authLoggedIn ? '还没有评论，点击画布留下第一条。' : '还没有评论。登录后可发表第一条。' }}
      </div>
      <template v-else>
        <article
          v-for="root in filteredRoots"
          :key="root.id"
          class="rp-card"
          :class="{
            on: selectedId === root.id,
            resolved: !!root.resolvedAt,
            unread: unreadSet.has(root.id),
          }"
          @click="select(root)"
        >
          <div class="rp-card-head">
            <span class="rp-pin" :class="{ done: !!root.resolvedAt }">{{ rootNumber(root) }}</span>
            <b>{{ root.authorName }}</b>
            <span v-if="root.legacy" class="rp-legacy">历史匿名</span>
            <span v-else class="rp-role" :class="{ visitor: root.authorRole !== 'owner' }">
              {{ root.authorRole === 'owner' ? '作者' : '访客' }}
            </span>
            <span v-if="unreadSet.has(root.id)" class="rp-new">新</span>
            <span class="rp-time">{{ timeText(root.createdAt) }}</span>
          </div>
          <p class="rp-text">{{ root.content }}</p>
          <div class="rp-meta">
            <button type="button" @click.stop="emit('locate', root)">{{ labelOf(root) }}</button>
            <span class="rp-share">{{ root.shareTitle }}</span>
          </div>
          <div
            v-if="commentEnabled && authLoggedIn && (canResolve(root) || canReply(root) || canDelete(root))"
            class="rp-actions"
          >
            <button v-if="canResolve(root)" type="button" @click.stop="emit('resolve', root)">
              {{ root.resolvedAt ? '取消解决' : '解决' }}
            </button>
            <button v-if="canReply(root)" type="button" @click.stop="select(root)">回复</button>
            <template v-if="pendingDeleteId === root.id">
              <button
                type="button"
                class="danger confirm"
                @click.stop="confirmDelete(root)"
              >
                确认删除
              </button>
              <button type="button" @click.stop="cancelDelete">取消</button>
            </template>
            <button
              v-else-if="canDelete(root)"
              type="button"
              class="danger"
              title="删除后不可恢复"
              @click.stop="requestDelete(root)"
            >
              删除
            </button>
          </div>

          <button
            v-if="repliesOf(root.id).length"
            class="rp-thread-toggle"
            :class="{ collapsed: isThreadCollapsed(root.id) }"
            type="button"
            :aria-expanded="!isThreadCollapsed(root.id)"
            :aria-controls="`rp-thread-${root.id}`"
            @click.stop="toggleThread(root.id)"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            {{ isThreadCollapsed(root.id) ? `展开 ${repliesOf(root.id).length} 条回复` : '收起回复' }}
          </button>

          <Transition
            name="rp-thread"
            @enter="onThreadEnter"
            @after-enter="onThreadAfterEnter"
            @leave="onThreadLeave"
            @after-leave="onThreadAfterLeave"
          >
            <div
              v-if="!isThreadCollapsed(root.id) && repliesOf(root.id).length"
              :id="`rp-thread-${root.id}`"
              class="rp-replies"
            >
              <div
                v-for="reply in repliesOf(root.id)"
                :key="reply.id"
                class="rp-reply"
                :class="{ on: selectedId === reply.id }"
                role="button"
                tabindex="0"
                @click.stop="select(reply)"
                @keydown.enter.stop="select(reply)"
              >
                <div class="rp-card-head">
                  <b>{{ reply.authorName }}</b>
                  <span v-if="reply.legacy" class="rp-legacy">历史匿名</span>
                  <span v-else class="rp-role" :class="{ visitor: reply.authorRole !== 'owner' }">
                    {{ reply.authorRole === 'owner' ? '作者' : '访客' }}
                  </span>
                  <span v-if="reply.replyToName" class="rp-reply-to">
                    回复 @{{ reply.replyToName }}
                  </span>
                  <span class="rp-time">{{ timeText(reply.createdAt) }}</span>
                  <button
                    v-if="canReply(reply)"
                    class="rp-reply-action"
                    type="button"
                    @click.stop="select(reply)"
                  >
                    回复
                  </button>
                </div>
                <p class="rp-text">{{ reply.content }}</p>
                <div class="rp-reply-meta">
                  <button type="button" @click.stop="emit('locate', reply)">{{ labelOf(reply) }}</button>
                </div>
              </div>
            </div>
          </Transition>
        </article>
      </template>
    </div>

    <footer v-if="commentEnabled && authLoggedIn" class="rp-compose">
      <div v-if="pendingAnchor" class="rp-anchor">
        <span>@ {{ pendingLabel || '画布位置' }}</span>
        <button type="button" @click="emit('cancel-pending')">取消</button>
      </div>
      <div v-else-if="selectedComment?.legacy" class="rp-anchor">
        <span>历史匿名评论只读</span>
        <button type="button" @click="emit('select', selectedComment)">定位</button>
      </div>
      <div v-else-if="selectedComment" class="rp-anchor">
        <span>回复 {{ selectedComment.authorName }}</span>
        <button type="button" @click="emit('select', selectedComment)">定位</button>
      </div>
      <div v-else-if="mode === 'visitor'" class="rp-anchor rp-pick-row">
        <span>评论需要先选位置</span>
        <button type="button" @click="emit('request-anchor')">在画布上点选</button>
      </div>
      <div class="rp-box">
        <textarea
          v-model="draft"
          :placeholder="placeholder"
          :disabled="!!selectedComment?.legacy"
          maxlength="1000"
          @focus="onComposerFocus"
          @keydown.meta.enter.prevent="submit"
          @keydown.ctrl.enter.prevent="submit"
        />
      </div>
      <div class="rp-compose-foot">
        <span>{{ authorLabel || (mode === 'owner' ? '作者' : '登录用户') }}</span>
        <span class="rp-sp" />
        <span>⌘↵</span>
        <button class="rp-send" type="button" :disabled="!canSubmit" @click="submit">
          发送
        </button>
      </div>
    </footer>
    <footer v-else-if="commentEnabled" class="rp-compose rp-login-gate">
      <div class="rp-login-row">
        <span class="rp-login-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="10.5" width="14" height="9" rx="2" />
            <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
          </svg>
        </span>
        <div class="rp-login-copy">
          <b>登录后参与评论</b>
          <span>查看和定位无需登录；登录后可发表评论、回复和解决自己的评论。</span>
        </div>
      </div>
      <div class="rp-login-actions">
        <button class="rp-login-primary" type="button" @click="emit('login')">登录</button>
        <button class="rp-login-link" type="button" @click="emit('register')">注册新账号</button>
      </div>
    </footer>
    <footer v-else class="rp-compose rp-readonly">
      <span>该链接未开放新评论</span>
    </footer>
  </section>
</template>
