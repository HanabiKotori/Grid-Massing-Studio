import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type Ref,
} from 'vue'
import {
  shareApi,
  type ReviewEvent,
  type ShareComment,
  type ShareCommentEvent,
  type ShareCommentEventReply,
} from '../core/shareApi'
import {
  openShareStream,
  type StreamController,
  type StreamState,
} from './realtime'

interface Options {
  /** 当前云端存档对应的分享链接；评审只看这条链接的评论 */
  shareToken: Ref<string | null>
  /** 需要登录、有场景且当前存档已有分享链接 */
  enabled: Ref<boolean>
  onNewComment?: (comment: ShareComment) => void
  onCommentUpdated?: (
    comment: ShareComment,
    before: ShareComment | null,
    activity?: ShareCommentEvent,
  ) => void
  onCommentDeleted?: (
    removed: ShareComment | null,
    actorUserId?: number,
    actorRole?: 'owner' | 'visitor',
  ) => void
  onEventReply?: (
    comment: ShareComment,
    event: ShareCommentEvent,
    reply: ShareCommentEventReply,
  ) => void
  onEventReplyDeleted?: (
    comment: ShareComment,
    event: ShareCommentEvent,
    reply: ShareCommentEventReply,
    actorUserId?: number,
  ) => void
  onError?: (message: string) => void
  isPanelOpen?: () => boolean
}

const SEEN_PREFIX = 'gms.review.seen.'

function mergeComment(list: ShareComment[], next: ShareComment): ShareComment[] {
  const index = list.findIndex((item) => item.id === next.id)
  if (index < 0) {
    return [...list, next].sort(
      (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
    )
  }
  const copy = list.slice()
  copy[index] = { ...next, mine: next.mine || copy[index].mine }
  return copy
}

function updateEventReply(
  list: ShareComment[],
  commentId: number,
  eventId: number,
  reply: ShareCommentEventReply,
): ShareComment[] {
  return list.map((comment) => {
    if (comment.id !== commentId) return comment
    return {
      ...comment,
      events: (comment.events ?? []).map((event) => {
        if (event.id !== eventId) return event
        const index = event.replies.findIndex((item) => item.id === reply.id)
        const replies =
          index < 0
            ? [...event.replies, reply]
            : event.replies.map((item) =>
                item.id === reply.id ? { ...item, ...reply } : item,
              )
        return { ...event, replies, replyCount: replies.length }
      }),
    }
  })
}

function deleteEventReply(
  list: ShareComment[],
  commentId: number,
  eventId: number,
  replyId: number,
): ShareComment[] {
  return list.map((comment) => {
    if (comment.id !== commentId) return comment
    return {
      ...comment,
      events: (comment.events ?? []).map((event) => {
        if (event.id !== eventId) return event
        const replies = event.replies.filter((item) => item.id !== replyId)
        return { ...event, replies, replyCount: replies.length }
      }),
    }
  })
}

function readSeen(key: string): number {
  try {
    const raw = localStorage.getItem(SEEN_PREFIX + key)
    return raw ? Number(raw) || 0 : 0
  } catch {
    return 0
  }
}

function writeSeen(key: string, at: number) {
  try {
    localStorage.setItem(SEEN_PREFIX + key, String(at))
  } catch {
    // 忽略隐私模式下的存储异常
  }
}

export function useReviewComments(options: Options) {
  const comments = shallowRef<ShareComment[]>([])
  const unread = ref(0)
  const loading = ref(false)
  const error = ref('')
  const connected = ref(false)
  const streamState = ref<StreamState>('connecting')

  let stream: StreamController | null = null
  let streamKey = ''
  let seenAt = 0
  let lastKey = ''

  const unresolved = computed(
    () => comments.value.filter((c) => !c.resolvedAt).length,
  )

  function tokenNow(): string {
    return options.shareToken.value || ''
  }

  function applyUnread(list: ShareComment[]) {
    if (!seenAt) {
      seenAt = Date.now()
      writeSeen(lastKey, seenAt)
      unread.value = 0
      return
    }
    unread.value = list.filter(
      (c) => c.authorRole === 'visitor' && +new Date(c.createdAt) > seenAt,
    ).length
  }

  function markSeen() {
    unread.value = 0
    seenAt = Date.now()
    if (lastKey) writeSeen(lastKey, seenAt)
  }

  async function refresh() {
    const token = tokenNow()
    if (!options.enabled.value || !token) {
      comments.value = []
      unread.value = 0
      loading.value = false
      error.value = ''
      closeStream()
      return
    }
    if (lastKey !== token) {
      lastKey = token
      seenAt = readSeen(token)
    }
    loading.value = true
    error.value = ''
    try {
      const data = await shareApi.getComments(token)
      if (token !== tokenNow()) return
      comments.value = data.comments
      applyUnread(data.comments)
      connectStream()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '读取评审评论失败'
      options.onError?.(error.value)
    } finally {
      loading.value = false
    }
  }

  function handleEvent(event: ReviewEvent) {
    if (event.type === 'hello') {
      connected.value = true
      return
    }
    if (event.type === 'comment.created') {
      const comment = event.comment
      comments.value = mergeComment(comments.value, comment)
      if (comment.authorRole === 'visitor' && !options.isPanelOpen?.()) {
        unread.value += 1
      }
      options.onNewComment?.(comment)
      return
    }
    if (event.type === 'comment.updated') {
      const comment = event.comment as ShareComment
      const before =
        comments.value.find((item) => item.id === comment.id) ?? null
      comments.value = mergeComment(comments.value, comment)
      options.onCommentUpdated?.(comment, before, event.activity)
      return
    }
    if (event.type === 'comment.deleted') {
      const id = Number(event.id)
      const removed =
        comments.value.find((item) => item.id === id) ?? null
      comments.value = comments.value.filter(
        (item) => item.id !== id && item.parentId !== id,
      )
      options.onCommentDeleted?.(
        removed,
        event.actorUserId,
        event.actorRole,
      )
      return
    }
    if (event.type === 'comment.event.replied') {
      const commentId = Number(event.commentId)
      const eventId = Number(event.eventId)
      const comment = comments.value.find((item) => item.id === commentId)
      if (!comment) return
      comments.value = updateEventReply(
        comments.value,
        commentId,
        eventId,
        event.reply,
      )
      const activity = (comment.events ?? []).find((item) => item.id === eventId)
      if (activity) options.onEventReply?.(comment, activity, event.reply)
      return
    }
    if (event.type === 'comment.event.reply.deleted') {
      const commentId = Number(event.commentId)
      const eventId = Number(event.eventId)
      const comment = comments.value.find((item) => item.id === commentId)
      if (!comment) return
      comments.value = deleteEventReply(
        comments.value,
        commentId,
        eventId,
        Number(event.reply.id),
      )
      const activity = (comment.events ?? []).find((item) => item.id === eventId)
      if (activity) {
        options.onEventReplyDeleted?.(
          comment,
          activity,
          event.reply,
          event.actorUserId,
        )
      }
      return
    }
    if (event.type === 'revoked') {
      connected.value = false
      closeStream()
    }
  }

  function connectStream() {
    const token = tokenNow()
    if (!options.enabled.value || !token) {
      closeStream()
      return
    }
    if (stream && streamKey === token) return
    stream?.close()
    stream = null
    streamKey = token
    stream = openShareStream(token, {
      onEvent: handleEvent,
      onState: (state) => {
        streamState.value = state
        connected.value = state === 'live'
      },
    })
  }

  function closeStream() {
    stream?.close()
    stream = null
    streamKey = ''
    connected.value = false
  }

  async function resolve(comment: ShareComment, resolved: boolean) {
    const before = comment
    comments.value = mergeComment(comments.value, {
      ...comment,
      resolvedAt: resolved ? new Date().toISOString() : null,
      resolvedBy: resolved ? '作者' : '',
    })
    try {
      const { comment: next } = await shareApi.updateComment(
        comment.shareToken,
        comment.id,
        { resolved },
      )
      comments.value = mergeComment(comments.value, next)
    } catch (err) {
      comments.value = mergeComment(comments.value, before)
      options.onError?.(err instanceof Error ? err.message : '更新评论状态失败')
    }
  }

  async function reply(comment: ShareComment, content: string) {
    const text = content.trim()
    if (!text) return null
    try {
      const { comment: next } = await shareApi.createComment(comment.shareToken, {
        content: text,
        anchor: comment.anchor,
        parentId: comment.parentId ?? comment.id,
        replyToId: comment.id,
        clientId: `c${Date.now().toString(36)}`,
      })
      comments.value = mergeComment(comments.value, next)
      return next
    } catch (err) {
      options.onError?.(err instanceof Error ? err.message : '回复失败')
      return null
    }
  }

  async function remove(comment: ShareComment) {
    const before = comments.value
    comments.value = comments.value.filter(
      (item) => item.id !== comment.id && item.parentId !== comment.id,
    )
    try {
      await shareApi.deleteComment(comment.shareToken, comment.id)
    } catch (err) {
      comments.value = before
      options.onError?.(err instanceof Error ? err.message : '删除评论失败')
    }
  }

  async function replyEvent(
    comment: ShareComment,
    event: ShareCommentEvent,
    content: string,
  ) {
    const text = content.trim()
    if (!text) return null
    try {
      const { reply } = await shareApi.createEventReply(
        comment.shareToken,
        comment.id,
        event.id,
        {
          content: text,
          clientId: `e${Date.now().toString(36)}`,
        },
      )
      comments.value = updateEventReply(
        comments.value,
        comment.id,
        event.id,
        reply,
      )
      return reply
    } catch (err) {
      options.onError?.(err instanceof Error ? err.message : '回复状态记录失败')
      return null
    }
  }

  async function removeEventReply(
    comment: ShareComment,
    event: ShareCommentEvent,
    reply: ShareCommentEventReply,
  ) {
    const before = comments.value
    comments.value = deleteEventReply(
      comments.value,
      comment.id,
      event.id,
      reply.id,
    )
    try {
      await shareApi.deleteEventReply(
        comment.shareToken,
        comment.id,
        event.id,
        reply.id,
      )
    } catch (err) {
      comments.value = before
      options.onError?.(err instanceof Error ? err.message : '删除状态回复失败')
    }
  }

  watch(
    [() => options.shareToken.value, () => options.enabled.value],
    () => {
      closeStream()
      void refresh()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    closeStream()
  })

  return {
    comments,
    unread,
    unresolved,
    loading,
    error,
    connected,
    streamState,
    refresh,
    markSeen,
    resolve,
    reply,
    remove,
    replyEvent,
    removeEventReply,
  }
}
