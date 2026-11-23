<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'
import { Stage } from '../core/Stage'
import { polygonArea } from '../core/polygon'
import { parseSceneJson } from '../core/sceneParse'
import { applyScenePatch } from '../core/sceneDiff'
import type { SceneJson } from '../core/sceneFile'
import {
  shareApi,
  type CommentAnchor,
  type ReviewEvent,
  type ShareComment,
  type ShareCommentEvent,
  type ShareCommentEventReply,
  type ShareMeta,
} from '../core/shareApi'
import type { Booth, Infra, Venue } from '../core/types'
import { CloudStorageError, type AuthResponse } from '../core/cloudStorage'
import { pushMessage, type MessageSeverity } from '../core/messageCenter'
import { playCollabSound } from '../core/notificationSound'
import ToastHost from '../components/ToastHost.vue'
import CommentLayer from '../review/CommentLayer.vue'
import ReviewPanel from '../review/ReviewPanel.vue'
import { makeAnchor, objectLabel, resolveAnchor } from '../review/anchors'
import { openShareStream, type StreamController, type StreamState } from '../review/realtime'
import ShareLoginDialog from './ShareLoginDialog.vue'
import { useShareAuth } from './useShareAuth'
import '../review/review.css'
import './share.css'

const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))

const hostEl = ref<HTMLDivElement | null>(null)
const meta = ref<ShareMeta | null>(null)
const scene = shallowRef<SceneJson | null>(null)
const venue = shallowRef<Venue | null>(null)
const booths = shallowRef<Booth[]>([])
const infras = shallowRef<Infra[]>([])

const comments = shallowRef<ShareComment[]>([])
const loading = ref(true)
const error = ref('')
const connected = ref(false)
const streamState = ref<StreamState>('connecting')
const viewerCount = ref(0)
const revision = ref(0)
const syncText = ref('正在连接…')
const authorEditing = ref(false)
const editingLabel = ref('')
const commentMode = ref(false)
const panelOpen = ref(false)
const activeCommentId = ref<number | null>(null)
const isMobile = ref(false)
const unreadCount = ref(0)
const unreadIds = ref<number[]>([])

type DisplayKey =
  | 'boothLabels'
  | 'infraLabels'
  | 'furnitureLabels'
  | 'dimensions'
  | 'areas'
  | 'aisle'
  | 'grid'

const displayItems: { key: DisplayKey; label: string }[] = [
  { key: 'boothLabels', label: '展台名称' },
  { key: 'infraLabels', label: '基础设施名称' },
  { key: 'furnitureLabels', label: '家具名称' },
  { key: 'dimensions', label: '刻度' },
  { key: 'areas', label: '面积' },
  { key: 'aisle', label: '过道' },
  { key: 'grid', label: '网格' },
]

const display = reactive<Record<DisplayKey, boolean>>({
  boothLabels: false,
  infraLabels: false,
  furnitureLabels: false,
  dimensions: false,
  areas: false,
  aisle: false,
  grid: true,
})
const displayOpen = ref(false)

const {
  user: currentUser,
  bootstrap: bootstrapAuth,
  accept: acceptAuth,
  logout: logoutAuth,
} = useShareAuth()
const loginOpen = ref(false)
const loginMode = ref<'login' | 'register'>('login')
const loginIntent = ref(false)

const areaText = computed(() =>
  venue.value
    ? `${Math.round(polygonArea(venue.value.points)).toLocaleString('zh-CN')} m²`
    : '场馆',
)

const timeLabel = computed(() => {
  const progress = scene.value?.sunProgress
  const total = Math.floor((Number.isFinite(progress) ? Number(progress) : 0.5) * 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})

interface PendingAnchor {
  point: [number, number, number]
  object?: { kind: 'booth' | 'infra'; id: string }
  label: string
}

const pendingAnchor = ref<PendingAnchor | null>(null)

let stage: Stage | null = null
let stream: StreamController | null = null
let editTimer = 0

const pendingForLayer = computed(() =>
  pendingAnchor.value
    ? { point: pendingAnchor.value.point, object: pendingAnchor.value.object }
    : null,
)

const link = computed(() => {
  if (!meta.value) return ''
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`
  return `${base}#/share/${meta.value.token}`
})

const commentAllowed = computed(() => meta.value?.allowComment !== false)

watch(commentAllowed, (allowed) => {
  if (allowed) return
  commentMode.value = false
  pendingAnchor.value = null
  stage?.setInspectMode(false)
})

function resetCommentUnread() {
  unreadCount.value = 0
  unreadIds.value = []
}

async function refreshShareMeta() {
  if (!token.value) return
  try {
    const info = await shareApi.getShare(token.value)
    meta.value = info
    viewerCount.value = info.viewerCount
  } catch {
    // 网络失败时保留旧状态，评论动作仍由 ensureCommentAllowed / 服务端兜底
  }
}

function onVisibilityChange() {
  if (document.hidden) return
  void refreshShareMeta()
  if (!isMobile.value || panelOpen.value) resetCommentUnread()
}

function onWindowFocus() {
  void refreshShareMeta()
}

/** 评论动作前重新确认 allowComment，避免页面长时间打开后仍持有旧设置 */
async function ensureCommentAllowed(): Promise<boolean> {
  if (!token.value) return false
  try {
    const info = await shareApi.getShare(token.value)
    meta.value = info
    viewerCount.value = info.viewerCount
  } catch {
    return commentAllowed.value
  }
  if (!commentAllowed.value) {
    showToast('该链接未开放评论')
    return false
  }
  return true
}

watch(panelOpen, (open) => {
  if (!open) return
  displayOpen.value = false
  resetCommentUnread()
})

const statusLabel = computed(() => {
  if (!connected.value) return streamState.value === 'connecting' ? '连接中' : '重连中'
  return '实时'
})

const syncLabel = computed(() => syncText.value)

function showToast(text: string, severity: MessageSeverity = 'info') {
  pushMessage({
    scope: 'share',
    type: 'action',
    severity,
    title: text,
  })
}

function showCollab(
  title: string,
  text: string,
  commentId: number,
  actionId = commentId,
) {
  pushMessage({
    scope: 'share',
    type: 'collab',
    title,
    text,
    dedupeKey: `share-comment-${commentId}`,
    action: {
      label: '查看',
      run: () => {
        panelOpen.value = true
        activeCommentId.value = actionId
      },
    },
  })
}

/** 作者解决 / 取消解决 / 删除评论：给评论作者的 B 类通知 */
function showCommentAction(
  title: string,
  severity: MessageSeverity,
  commentId: number,
  actionId?: number,
) {
  pushMessage({
    scope: 'share',
    type: 'collab',
    severity,
    title,
    dedupeKey: `share-comment-action-${commentId}`,
    ...(actionId === undefined
      ? {}
      : {
          text: '点击查看评论',
          action: {
            label: '查看',
            run: () => {
              panelOpen.value = true
              activeCommentId.value = actionId
            },
          },
        }),
  })
}

function openLogin(mode: 'login' | 'register' = 'login', intentForComment = false) {
  loginMode.value = mode
  loginIntent.value = intentForComment
  loginOpen.value = true
}

async function loadComments() {
  if (!token.value) return
  const list = await shareApi.listComments(token.value)
  comments.value = list.comments
}

async function handleLoginSuccess(result: AuthResponse) {
  acceptAuth(result)
  loginOpen.value = false
  const intent = loginIntent.value
  loginIntent.value = false
  try {
    await loadComments()
  } catch (err) {
    showToast(err instanceof Error ? err.message : '评论刷新失败')
  }
  showToast(`已登录：${result.user.username}`)
  if (intent) requestAnchor()
}

async function logout() {
  logoutAuth()
  commentMode.value = false
  pendingAnchor.value = null
  stage?.setInspectMode(false)
  activeCommentId.value = null
  try {
    await loadComments()
  } catch {
    // 退出后即使评论刷新失败也保留当前画面
  }
  showToast('已退出登录')
}

function handleAuthExpired(err: unknown): boolean {
  if (!(err instanceof CloudStorageError) || err.status !== 401) return false
  logoutAuth()
  commentMode.value = false
  stage?.setInspectMode(false)
  showToast('登录已过期，请重新登录')
  openLogin('login', true)
  return true
}

function setAuthorEditing(label: string) {
  editingLabel.value = label
  authorEditing.value = true
  window.clearTimeout(editTimer)
  editTimer = window.setTimeout(() => (authorEditing.value = false), 2600)
}

function mergeComment(list: ShareComment[], next: ShareComment): ShareComment[] {
  const index = list.findIndex((item) => item.id === next.id)
  if (index < 0) {
    return [...list, next].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
  }
  const copy = list.slice()
  copy[index] = { ...next, mine: next.mine || copy[index].mine }
  return copy
}

function withEventReply(
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

function withoutEventReply(
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

function objectLabelOf(comment: ShareComment): string {
  const resolved = resolveAnchor(comment.anchor, booths.value, infras.value)
  return resolved.valid ? `定位 ${resolved.label}` : '锚点失效'
}

function applyFullScene(raw: unknown, rev: number) {
  const parsed = parseSceneJson(raw)
  scene.value = parsed.sceneJson
  venue.value = parsed.venue
  booths.value = parsed.booths
  infras.value = parsed.infras
  revision.value = rev
  if (!stage) return
  stage.setScene(parsed.venue, parsed.booths, parsed.infras)
  stage.setUnderlay(parsed.underlay)
  stage.setWeather(parsed.weatherOn ? parsed.weather : 'clear')
  stage.setSunProgress(parsed.sunProgress)
  applyDisplay()
}

function applyPatch(patch: Parameters<typeof applyScenePatch>[1], rev: number) {
  const current = scene.value
  if (!current) return
  const next = applyScenePatch(current, patch)
  scene.value = next

  if (patch.venue !== undefined) {
    venue.value = next.venue
    stage?.setVenue(next.venue)
  }
  if (patch.booths) {
    booths.value = next.booths
    stage?.setBooths(next.booths)
  }
  if (patch.infras) {
    infras.value = next.infras
    stage?.setInfras(next.infras)
  }
  if (patch.underlay !== undefined) {
    stage?.setUnderlay(next.underlay ?? null)
  }
  if (patch.weather !== undefined) {
    stage?.setWeather(next.weatherOn === false ? 'clear' : next.weather ?? 'clear')
  }
  if (patch.sunProgress !== undefined) {
    stage?.setSunProgress(patch.sunProgress)
  }

  // 场景增量重建标签后，保持当前查看者的显示开关
  if (
    patch.venue !== undefined ||
    patch.booths !== undefined ||
    patch.infras !== undefined ||
    patch.underlay !== undefined
  ) {
    applyDisplay()
  }
  revision.value = rev
  syncText.value = '已同步 · 刚刚'

  // 时间自动推进只更新时间，不冒充“作者正在编辑模型”
  const modelChanged =
    patch.venue !== undefined ||
    patch.underlay !== undefined ||
    patch.booths !== undefined ||
    patch.infras !== undefined ||
    patch.weather !== undefined ||
    patch.weatherOn !== undefined ||
    patch.rules !== undefined
  if (!modelChanged) return

  const label =
    patch.venue !== undefined
      ? '场馆'
      : patch.booths?.upsert?.[0]?.name ||
        patch.infras?.upsert?.[0]?.name ||
        '场景'
  setAuthorEditing(label)
}

async function reloadScene() {
  if (!token.value) return
  try {
    const data = await shareApi.getShareScene(token.value)
    applyFullScene(data.scene, data.revision)
    syncText.value = '已同步 · 刚刚'
  } catch (err) {
    showToast(err instanceof Error ? err.message : '场景刷新失败')
  }
}

async function catchUp() {
  try {
    const data = await shareApi.getLiveSince(token.value, revision.value)
    if (data.scene) applyFullScene(data.scene, data.revision)
    revision.value = data.revision
  } catch {
    // 下一次事件或手动刷新会重试
  }
}

function handleStreamEvent(event: ReviewEvent) {
  if (event.type === 'hello') {
    connected.value = true
    syncText.value = '已同步'
    if (typeof event.viewerCount === 'number') viewerCount.value = event.viewerCount
    if (typeof event.revision === 'number' && event.revision > revision.value) {
      void catchUp()
    }
    return
  }
  if (event.type === 'presence') {
    viewerCount.value = event.count
    return
  }
  if (event.type === 'scene.patch') {
    applyPatch(event.patch, event.revision)
    return
  }
  if (event.type === 'scene.reset') {
    void reloadScene()
    showToast('作者更新了分享版本')
    return
  }
  if (event.type === 'share.updated') {
    meta.value = event.share
    viewerCount.value = event.share.viewerCount
    return
  }
  if (event.type === 'comment.created') {
    comments.value = mergeComment(comments.value, event.comment)
    const mine =
      !!currentUser.value &&
      event.comment.authorUserId === currentUser.value.id
    if (!mine) {
      const parent = event.comment.parentId
        ? comments.value.find(
            (item) => item.id === Number(event.comment.parentId),
          )
        : null
      // 直接回复当前访客：即使评论面板打开，也必须提醒。
      // replyToUserId 是新数据；旧回复没有该字段时才回退到根评论作者。
      const replyToMe =
        !!currentUser.value &&
        (event.comment.replyToUserId != null
          ? event.comment.replyToUserId === currentUser.value.id
          : !!parent &&
            (parent.authorUserId === currentUser.value.id || parent.mine))
      // 只对“直接回复当前访客”发声；作者回复其他用户、普通新评论静音
      if (replyToMe) playCollabSound('reply', 'share')
      const commentsVisible =
        !document.hidden && (!isMobile.value || panelOpen.value)
      if (replyToMe || !commentsVisible) {
        const actionId = replyToMe && parent ? parent.id : Number(event.comment.id)
        if (!commentsVisible) {
          unreadCount.value += 1
          if (!unreadIds.value.includes(actionId)) {
            unreadIds.value = [...unreadIds.value, actionId]
          }
        }
        const isOwner = event.comment.authorRole === 'owner'
        const title = replyToMe
          ? isOwner
            ? '作者回复了你的评论'
            : `${event.comment.authorName} 回复了你的评论`
          : isOwner
            ? event.comment.parentId
              ? '作者回复了评论'
              : '作者发表了新评论'
            : `${event.comment.authorName} 新增了评论`
        showCollab(
          title,
          event.comment.content.slice(0, 48),
          Number(event.comment.id),
          actionId,
        )
      }
    }
    return
  }
  if (event.type === 'comment.updated') {
    const before = comments.value.find((item) => item.id === event.comment.id)
    comments.value = mergeComment(comments.value, event.comment)
    const me = currentUser.value
    if (
      me &&
      event.actorRole === 'owner' &&
      event.actorUserId !== me.id &&
      before?.authorUserId === me.id &&
      Boolean(before?.resolvedAt) !== Boolean(event.comment.resolvedAt)
    ) {
      showCommentAction(
        event.comment.resolvedAt
          ? '作者将你的评论标记为已解决'
          : '作者取消了你的评论解决状态',
        event.comment.resolvedAt ? 'success' : 'info',
        event.comment.id,
        event.comment.id,
      )
      playCollabSound('reply', 'share', true)
    }
    return
  }
  if (event.type === 'comment.event.replied') {
    const commentId = Number(event.commentId)
    const eventId = Number(event.eventId)
    const comment = comments.value.find((item) => item.id === commentId)
    comments.value = withEventReply(
      comments.value,
      commentId,
      eventId,
      event.reply,
    )
    const me = currentUser.value
    if (!me || event.reply.actorUserId === me.id) return
    const targetMe =
      event.eventActorUserId === me.id ||
      (!!comment && comment.authorUserId === me.id)
    if (!targetMe) return
    const visible = !document.hidden && (!isMobile.value || panelOpen.value)
    if (!visible) {
      unreadCount.value += 1
      if (!unreadIds.value.includes(commentId)) {
        unreadIds.value = [...unreadIds.value, commentId]
      }
    }
    playCollabSound('reply', 'share')
    pushMessage({
      scope: 'share',
      type: 'collab',
      title:
        event.eventActorUserId === me.id
          ? `${event.reply.actorName} 回复了你的解决记录`
          : `${event.reply.actorName} 回复了你评论的解决记录`,
      text: event.reply.content.slice(0, 48),
      dedupeKey: `share-event-${eventId}-${event.reply.id}`,
      action: {
        label: '查看',
        run: () => {
          panelOpen.value = true
          activeCommentId.value = commentId
        },
      },
    })
    return
  }
  if (event.type === 'comment.event.reply.deleted') {
    const commentId = Number(event.commentId)
    const eventId = Number(event.eventId)
    comments.value = withoutEventReply(
      comments.value,
      commentId,
      eventId,
      Number(event.reply.id),
    )
    const me = currentUser.value
    if (
      me &&
      event.actorUserId !== me.id &&
      event.replyAuthorUserId === me.id
    ) {
      pushMessage({
        scope: 'share',
        type: 'collab',
        severity: 'error',
        title: '作者删除了你的状态回复',
        dedupeKey: `share-event-del-${eventId}-${event.reply.id}`,
      })
      playCollabSound('danger', 'share', true)
    }
    return
  }
  if (event.type === 'comment.deleted') {
    const id = Number(event.id)
    const target = comments.value.find((item) => item.id === id)
    const children = comments.value.filter((item) => item.parentId === id)
    const me = currentUser.value
    const affected =
      !!me &&
      [target, ...children].some(
        (item) => item?.authorUserId === me.id,
      )
    if (
      me &&
      event.actorRole === 'owner' &&
      event.actorUserId !== me.id &&
      affected
    ) {
      showCommentAction(
        target?.parentId
          ? '作者删除了你的评论'
          : children.length
            ? '作者删除了包含你回复的评论线程'
            : '作者删除了你的评论',
        'error',
        id,
      )
      playCollabSound('danger', 'share', true)
    }
    comments.value = comments.value.filter(
      (item) => item.id !== id && item.parentId !== id,
    )
    return
  }
  if (event.type === 'revoked') {
    error.value = '分享链接已被撤销'
    stream?.close()
  }
}

function connectStream() {
  stream?.close()
  stream = null
  if (!token.value || error.value) return
  stream = openShareStream(token.value, {
    onEvent: handleStreamEvent,
    onState: (state) => {
      streamState.value = state
      connected.value = state === 'live'
      if (state === 'error') syncText.value = '重连中…'
      else if (state === 'live') syncText.value = '已同步'
    },
  })
}

function initStage(parsed: ReturnType<typeof parseSceneJson>) {
  if (!hostEl.value) return
  stage = new Stage(hostEl.value, {
    onSceneClick: (hit) => handleSceneClick(hit),
  })
  stage.setMode('idle')
  stage.setQuality('high')
  stage.setSunPaused(true)
  stage.setReadOnly(true)
  stage.setInspectMode(false)
  stage.setScene(parsed.venue, parsed.booths, parsed.infras)
  stage.setUnderlay(parsed.underlay)
  stage.setWeather(parsed.weatherOn ? parsed.weather : 'clear')
  stage.setSunProgress(parsed.sunProgress)
  applyDisplay()
  if (parsed.venue) stage.fit(parsed.venue.points, parsed.venue.height)
  window.setTimeout(() => {
    if (parsed.venue) stage?.fit(parsed.venue.points, parsed.venue.height)
  }, 180)
}

async function load() {
  if (!token.value) {
    error.value = '缺少分享链接标识'
    loading.value = false
    return
  }
  try {
    await bootstrapAuth()
    const info = await shareApi.getShare(token.value)
    meta.value = info
    viewerCount.value = info.viewerCount
    document.title = `${info.title || '场馆白膜'} · 场馆白膜`
    if (info.revoked) {
      error.value = '该分享链接已被撤销'
      loading.value = false
      return
    }
    const data = await shareApi.getShareScene(token.value)
    revision.value = data.revision
    const parsed = parseSceneJson(data.scene)
    scene.value = parsed.sceneJson
    venue.value = parsed.venue
    booths.value = parsed.booths
    infras.value = parsed.infras
    await nextTick()
    initStage(parsed)
    await loadComments()
    loading.value = false
    connectStream()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '分享场景加载失败'
    loading.value = false
  }
}

function handleSceneClick(hit: {
  point: { x: number; z: number }
  y: number
  boothId?: string
  infraId?: string
}) {
  if (!commentMode.value || !commentAllowed.value || !currentUser.value) return
  const object = hit.infraId
    ? ({ kind: 'infra', id: hit.infraId } as const)
    : hit.boothId
      ? ({ kind: 'booth', id: hit.boothId } as const)
      : undefined
  pendingAnchor.value = {
    point: [hit.point.x, hit.y, hit.point.z],
    ...(object ? { object } : {}),
    label: object ? objectLabel(object, booths.value, infras.value) : '场馆',
  }
  commentMode.value = false
  stage?.setInspectMode(false)
  if (isMobile.value) panelOpen.value = true
  showToast('已选择位置，输入评论后发送')
}

async function startComment() {
  if (!commentAllowed.value) {
    showToast('该链接未开放评论')
    return
  }
  if (!currentUser.value) {
    openLogin('login', true)
    return
  }
  if (commentMode.value) {
    commentMode.value = false
    stage?.setInspectMode(false)
    return
  }
  if (!(await ensureCommentAllowed())) return
  // 已选好的锚点不因再次进入评论模式而丢失；需要重选时直接点画布或点取消
  commentMode.value = true
  stage?.setInspectMode(true)
  if (!isMobile.value) panelOpen.value = true
  showToast('点击画布选择评论位置')
}

async function requestAnchor() {
  if (!commentAllowed.value) {
    showToast('该链接未开放评论')
    return
  }
  if (!currentUser.value) {
    openLogin('login', true)
    return
  }
  if (!(await ensureCommentAllowed())) return
  // 新增评论：清掉当前回复 / 已选锚点，移动端先收起面板再点画布
  pendingAnchor.value = null
  activeCommentId.value = null
  commentMode.value = true
  stage?.setInspectMode(true)
  panelOpen.value = !isMobile.value
  showToast('点击画布选择评论位置')
}

function cancelPending() {
  pendingAnchor.value = null
  stage?.setInspectMode(false)
}

async function sendComment(content: string) {
  if (!commentAllowed.value) return
  if (!currentUser.value) {
    openLogin('login', true)
    return
  }
  if (!(await ensureCommentAllowed())) return
  const pending = pendingAnchor.value
  if (!pending || !token.value) return
  try {
    const anchor: CommentAnchor = makeAnchor(
      pending.point,
      pending.object,
      booths.value,
      infras.value,
    )
    const camera = stage?.getCameraBookmark()
    if (camera) anchor.camera = camera
    const { comment } = await shareApi.createComment(token.value, {
      content,
      anchor,
      clientId: `c${Date.now().toString(36)}`,
    })
    comments.value = mergeComment(comments.value, comment)
    pendingAnchor.value = null
    // 发送后回到“可新增”状态，避免输入区一直锁在回复模式
    activeCommentId.value = null
    showToast('评论已发送')
  } catch (err) {
    if (handleAuthExpired(err)) return
    showToast(err instanceof Error ? err.message : '评论发送失败')
  }
}

async function replyTo(payload: { comment: ShareComment; content: string }) {
  if (!commentAllowed.value) return
  if (!currentUser.value) {
    openLogin('login', true)
    return
  }
  if (!(await ensureCommentAllowed())) return
  const { comment, content } = payload
  if (comment.legacy) {
    showToast('历史匿名评论不可回复')
    return
  }
  if (!token.value) return
  try {
    const { comment: next } = await shareApi.createComment(comment.shareToken, {
      content,
      anchor: comment.anchor,
      parentId: comment.parentId ?? comment.id,
      replyToId: comment.id,
      clientId: `c${Date.now().toString(36)}`,
    })
    comments.value = mergeComment(comments.value, next)
    showToast('回复已发送')
  } catch (err) {
    if (handleAuthExpired(err)) return
    showToast(err instanceof Error ? err.message : '回复失败')
  }
}

async function replyEvent(payload: {
  comment: ShareComment
  event: ShareCommentEvent
  content: string
}) {
  const { comment, event, content } = payload
  if (!commentAllowed.value) return
  if (!currentUser.value) {
    openLogin('login', true)
    return
  }
  if (!(await ensureCommentAllowed())) return
  const text = content.trim()
  if (!text) return
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
    comments.value = withEventReply(
      comments.value,
      comment.id,
      event.id,
      reply,
    )
    showToast('状态回复已发送')
  } catch (err) {
    if (handleAuthExpired(err)) return
    showToast(err instanceof Error ? err.message : '状态回复失败')
  }
}

async function removeEventReply(payload: {
  comment: ShareComment
  event: ShareCommentEvent
  reply: ShareCommentEventReply
}) {
  if (!commentAllowed.value) return
  if (!currentUser.value) return
  const before = comments.value
  comments.value = withoutEventReply(
    comments.value,
    payload.comment.id,
    payload.event.id,
    payload.reply.id,
  )
  try {
    await shareApi.deleteEventReply(
      payload.comment.shareToken,
      payload.comment.id,
      payload.event.id,
      payload.reply.id,
    )
  } catch (err) {
    comments.value = before
    if (handleAuthExpired(err)) return
    showToast(err instanceof Error ? err.message : '删除状态回复失败')
  }
}

async function resolveComment(comment: ShareComment) {
  if (!commentAllowed.value) return
  if (!currentUser.value) {
    openLogin('login', true)
    return
  }
  if (comment.legacy) {
    showToast('历史匿名评论只读')
    return
  }
  const before = comment
  comments.value = mergeComment(comments.value, {
    ...comment,
    resolvedAt: comment.resolvedAt ? null : new Date().toISOString(),
    resolvedBy: comment.resolvedAt ? '' : currentUser.value.username,
  })
  try {
    const { comment: next } = await shareApi.updateComment(
      comment.shareToken,
      comment.id,
      { resolved: !comment.resolvedAt },
    )
    comments.value = mergeComment(comments.value, next)
  } catch (err) {
    comments.value = mergeComment(comments.value, before)
    if (handleAuthExpired(err)) return
    showToast(err instanceof Error ? err.message : '更新状态失败')
  }
}

async function removeComment(comment: ShareComment) {
  if (!commentAllowed.value) return
  if (!currentUser.value) {
    openLogin('login', true)
    return
  }
  const before = comments.value
  comments.value = comments.value.filter(
    (item) => item.id !== comment.id && item.parentId !== comment.id,
  )
  try {
    await shareApi.deleteComment(comment.shareToken, comment.id)
    showToast('评论已删除')
  } catch (err) {
    comments.value = before
    if (handleAuthExpired(err)) return
    showToast(err instanceof Error ? err.message : '删除失败')
  }
}

function selectComment(comment: ShareComment) {
  activeCommentId.value = comment.id
}

function locateComment(comment: ShareComment) {
  selectComment(comment)
  const anchor = comment.anchor
  if (anchor.object?.kind === 'booth') stage?.focusBooth(anchor.object.id)
  else if (anchor.object?.kind === 'infra') stage?.focusInfra(anchor.object.id)
  else if (anchor.camera) stage?.applyCameraBookmark(anchor.camera)
}

async function copyLink() {
  if (!link.value) return
  try {
    await navigator.clipboard.writeText(link.value)
  } catch {
    const input = document.createElement('input')
    input.value = link.value
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  showToast('链接已复制')
}

function applyDisplay() {
  const s = stage
  if (!s) return
  s.setBoothLabelsVisible(display.boothLabels)
  s.setInfraLabelsVisible(display.infraLabels)
  s.setFurnitureLabelsVisible(display.furnitureLabels)
  s.setDimensionsVisible(display.dimensions)
  s.setBoothAreasVisible(display.areas)
  s.setAisleVisible(display.aisle)
  s.setGridVisible(display.grid)
}

function toggleDisplay(key: DisplayKey) {
  display[key] = !display[key]
  applyDisplay()
}

function viewTop() {
  stage?.viewTop()
}

function viewIso() {
  stage?.viewIso()
}

function fitView() {
  if (venue.value) stage?.fit(venue.value.points, venue.value.height)
  else stage?.fit()
}

function togglePanel() {
  panelOpen.value = !panelOpen.value
}

function backToEditor() {
  window.location.hash = '#/'
}

onMounted(() => {
  isMobile.value = window.matchMedia('(max-width: 900px)').matches
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onWindowFocus)
  void load()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('focus', onWindowFocus)
  stream?.close()
  stream = null
  stage?.dispose()
  stage = null
  window.clearTimeout(editTimer)
})
</script>

<template>
  <div class="share-app">
    <header class="share-top">
      <div class="share-brand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <path d="M12 2.6l8.6 4.8v9.2L12 21.4l-8.6-4.8V7.4z" />
          <path d="M12 2.6v9.4M12 12l8.6-4.6M12 12L3.4 7.4" />
        </svg>
        <span>场馆白膜</span>
      </div>
      <span class="share-sep" />
      <div class="share-title">
        {{ meta?.title || '场馆白膜' }}
        <span class="share-ro">只读</span>
      </div>
      <span class="share-sp" />
      <span class="share-live" :class="{ on: connected }">
        <i />
        {{ statusLabel }}<template v-if="viewerCount"> · {{ viewerCount }} 人</template>
      </span>
      <span class="share-sync">{{ syncLabel }}</span>
      <template v-if="currentUser">
        <span class="share-account">
          <span class="share-avatar">{{ currentUser.username.slice(0, 1).toUpperCase() }}</span>
          <span class="share-account-name">{{ currentUser.username }}</span>
        </span>
        <button class="share-textbtn" type="button" @click="logout">退出</button>
      </template>
      <button v-else class="share-btn pri" type="button" @click="openLogin('login')">
        登录
      </button>
      <div class="share-views">
        <button type="button" @click="viewTop">俯视</button>
        <button type="button" @click="viewIso">轴测</button>
        <button type="button" @click="fitView">适配</button>
      </div>
      <button class="share-btn" type="button" @click="copyLink">复制链接</button>
    </header>

    <div class="share-body">
      <div class="share-canvas">
        <div ref="hostEl" class="share-viewport" />

        <CommentLayer
          :get-stage="() => stage"
          :comments="comments"
          :booths="booths"
          :infras="infras"
          :active-id="activeCommentId"
          :visible="!loading && !error"
          :pending="pendingForLayer"
          @select="selectComment"
        />

        <div v-if="!loading && !error" class="share-hud">
          <span class="share-chip"><b>只读</b></span>
          <span v-if="!commentAllowed" class="share-chip">评论已关闭</span>
          <span class="share-chip">{{ areaText }}</span>
          <span class="share-chip">{{ booths.length }} 个展台</span>
          <span class="share-chip" title="场景时间">{{ timeLabel }}</span>
        </div>

        <div v-if="authorEditing && !loading" class="share-livepill">
          <span class="pulse" />
          <b>作者正在编辑</b>
          {{ editingLabel }}
        </div>

        <div v-if="!loading && !error" class="share-dock">
          <button type="button" @click="viewTop">俯视</button>
          <button type="button" @click="fitView">适配</button>
          <button type="button" :class="{ on: displayOpen }" @click="displayOpen = !displayOpen">
            显示
          </button>
          <span class="share-sep" style="height: 14px" />
          <button
            type="button"
            :class="{ on: commentMode }"
            :disabled="!commentAllowed"
            :title="commentAllowed ? '在画布上添加评论' : '该链接未开放评论'"
            @click="startComment"
          >
            评论
            <span v-if="unreadCount" class="share-unread-badge">{{ unreadCount }}</span>
          </button>
        </div>

        <button
          v-if="!loading && !error"
          class="share-display-fab"
          type="button"
          :class="{ on: displayOpen }"
          @click="displayOpen = !displayOpen"
        >
          显示
        </button>

        <button v-if="!loading && !error" class="share-fab" type="button" @click="togglePanel">
          评论
          <span v-if="unreadCount" class="share-unread-badge">{{ unreadCount }}</span>
        </button>

        <div
          v-if="displayOpen && !loading && !error"
          class="share-display-mask"
          @click="displayOpen = false"
        />
        <div v-if="displayOpen && !loading && !error" class="share-display-pop" @click.stop>
          <div class="share-display-head">
            <b>显示</b>
            <button type="button" title="关闭" @click="displayOpen = false">×</button>
          </div>
          <button
            v-for="item in displayItems"
            :key="item.key"
            class="share-display-row"
            :class="{ on: display[item.key] }"
            type="button"
            :aria-pressed="display[item.key]"
            @click="toggleDisplay(item.key)"
          >
            <span>{{ item.label }}</span>
            <i aria-hidden="true" />
          </button>
        </div>

        <div v-if="loading" class="share-loading">
          <div>
            <b>正在加载分享场景</b>
            <span>读取最新场景与评论…</span>
          </div>
        </div>

        <div v-if="error && !loading" class="share-error">
          <div>
            <b>{{ error }}</b>
            <span>该链接可能已被作者撤销，或服务暂时不可用。</span>
            <button class="share-btn" type="button" @click="backToEditor">
              返回编辑器
            </button>
          </div>
        </div>
      </div>

      <ReviewPanel
        v-if="!loading && !error"
        class="share-review"
        :class="{ open: panelOpen }"
        :comments="comments"
        :selected-id="activeCommentId"
        :unread-ids="unreadIds"
        mode="visitor"
        :logged-in="true"
        :auth-logged-in="!!currentUser"
        :connected="connected"
        :pending-anchor="pendingAnchor ? { point: pendingAnchor.point, object: pendingAnchor.object } : null"
        :pending-label="pendingAnchor?.label || ''"
        :author-label="currentUser?.username || ''"
        :current-user-id="currentUser?.id ?? null"
        :closable="isMobile"
        :comment-enabled="commentAllowed"
        :object-label="objectLabelOf"
        @select="selectComment"
        @locate="locateComment"
        @send="sendComment"
        @reply="replyTo"
        @event-reply="replyEvent"
        @remove-event-reply="removeEventReply"
        @resolve="resolveComment"
        @remove="removeComment"
        @cancel-pending="cancelPending"
        @request-anchor="requestAnchor"
        @refresh="reloadScene"
        @login="openLogin('login', true)"
        @register="openLogin('register', true)"
        @close="panelOpen = false"
      />
    </div>

    <ToastHost scope="share" kind="collab" placement="top-right" />
    <ToastHost scope="share" kind="system" placement="top-center" />
    <ToastHost
      scope="share"
      kind="action"
      placement="bottom-center"
      offset="64px"
    />

    <ShareLoginDialog
      :open="loginOpen"
      :initial-mode="loginMode"
      @close="loginOpen = false"
      @success="handleLoginSuccess"
    />
  </div>
</template>

<style>
.share-viewport {
  position: absolute;
  inset: 0;
}
</style>
