<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
  type ShareMeta,
} from '../core/shareApi'
import type { Booth, Infra, Venue } from '../core/types'
import CommentLayer from '../review/CommentLayer.vue'
import ReviewPanel from '../review/ReviewPanel.vue'
import { authorName, authorToken, setAuthorName } from '../review/author'
import { makeAnchor, objectLabel, resolveAnchor } from '../review/anchors'
import { openShareStream, type StreamController, type StreamState } from '../review/realtime'
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
const toast = ref('')
const commentMode = ref(false)
const panelOpen = ref(false)
const activeCommentId = ref<number | null>(null)
const visitorName = ref(authorName())
const isMobile = ref(false)
const labelsOn = ref(false)

const areaText = computed(() =>
  venue.value
    ? `${Math.round(polygonArea(venue.value.points)).toLocaleString('zh-CN')} m²`
    : '场馆',
)

interface PendingAnchor {
  point: [number, number, number]
  object?: { kind: 'booth' | 'infra'; id: string }
  label: string
}

const pendingAnchor = ref<PendingAnchor | null>(null)

let stage: Stage | null = null
let stream: StreamController | null = null
let editTimer = 0
let toastTimer = 0

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

const statusLabel = computed(() => {
  if (!connected.value) return streamState.value === 'connecting' ? '连接中' : '重连中'
  return '实时'
})

const syncLabel = computed(() => syncText.value)

function showToast(text: string) {
  toast.value = text
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 3200)
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

  revision.value = rev
  syncText.value = '已同步 · 刚刚'

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
    if (event.comment.authorRole === 'owner') {
      showToast(`${event.comment.authorName} 更新了评论`)
    }
    return
  }
  if (event.type === 'comment.updated') {
    comments.value = mergeComment(comments.value, event.comment)
    return
  }
  if (event.type === 'comment.deleted') {
    const id = Number(event.id)
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
  stage.setGridVisible(true)
  stage.setDimensionsVisible(false)
  stage.setBoothAreasVisible(false)
  stage.setBoothLabelsVisible(labelsOn.value)
  stage.setInfraLabelsVisible(false)
  stage.setFurnitureLabelsVisible(false)
  stage.setSunPaused(true)
  stage.setReadOnly(true)
  stage.setInspectMode(false)
  stage.setScene(parsed.venue, parsed.booths, parsed.infras)
  stage.setUnderlay(parsed.underlay)
  stage.setWeather(parsed.weatherOn ? parsed.weather : 'clear')
  stage.setSunProgress(parsed.sunProgress)
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
    const list = await shareApi.listComments(token.value, authorToken())
    comments.value = list.comments
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
  if (!commentMode.value || !commentAllowed.value) return
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

function startComment() {
  if (!commentAllowed.value) {
    showToast('该链接未开放评论')
    return
  }
  if (commentMode.value) {
    commentMode.value = false
    stage?.setInspectMode(false)
    return
  }
  // 已选好的锚点不因再次进入评论模式而丢失；需要重选时直接点画布或点取消
  commentMode.value = true
  stage?.setInspectMode(true)
  if (!isMobile.value) panelOpen.value = true
  showToast('点击画布选择评论位置')
}

function requestAnchor() {
  if (!commentAllowed.value) {
    showToast('该链接未开放评论')
    return
  }
  commentMode.value = true
  stage?.setInspectMode(true)
  if (!isMobile.value) panelOpen.value = true
  showToast('点击画布选择评论位置')
}

function cancelPending() {
  pendingAnchor.value = null
  stage?.setInspectMode(false)
}

async function sendComment(content: string) {
  if (!commentAllowed.value) return
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
      authorName: visitorName.value,
      authorToken: authorToken(),
      clientId: `c${Date.now().toString(36)}`,
    })
    comments.value = mergeComment(comments.value, comment)
    pendingAnchor.value = null
    activeCommentId.value = comment.id
    showToast('评论已发送')
  } catch (err) {
    showToast(err instanceof Error ? err.message : '评论发送失败')
  }
}

async function replyTo(payload: { comment: ShareComment; content: string }) {
  if (!commentAllowed.value) return
  const { comment, content } = payload
  if (!token.value) return
  try {
    const { comment: next } = await shareApi.createComment(comment.shareToken, {
      content,
      anchor: comment.anchor,
      authorName: visitorName.value,
      authorToken: authorToken(),
      parentId: comment.parentId ?? comment.id,
      clientId: `c${Date.now().toString(36)}`,
    })
    comments.value = mergeComment(comments.value, next)
    showToast('回复已发送')
  } catch (err) {
    showToast(err instanceof Error ? err.message : '回复失败')
  }
}

async function resolveComment(comment: ShareComment) {
  if (!commentAllowed.value) return
  const before = comment
  comments.value = mergeComment(comments.value, {
    ...comment,
    resolvedAt: comment.resolvedAt ? null : new Date().toISOString(),
    resolvedBy: comment.resolvedAt ? '' : visitorName.value,
  })
  try {
    const { comment: next } = await shareApi.updateComment(
      comment.shareToken,
      comment.id,
      {
        resolved: !comment.resolvedAt,
        authorToken: authorToken(),
      },
    )
    comments.value = mergeComment(comments.value, next)
  } catch (err) {
    comments.value = mergeComment(comments.value, before)
    showToast(err instanceof Error ? err.message : '更新状态失败')
  }
}

async function removeComment(comment: ShareComment) {
  if (!commentAllowed.value) return
  const before = comments.value
  comments.value = comments.value.filter(
    (item) => item.id !== comment.id && item.parentId !== comment.id,
  )
  try {
    await shareApi.deleteComment(comment.shareToken, comment.id, authorToken())
    showToast('评论已删除')
  } catch (err) {
    comments.value = before
    showToast(err instanceof Error ? err.message : '删除失败')
  }
}

function selectComment(comment: ShareComment) {
  activeCommentId.value = comment.id
  const anchor = comment.anchor
  if (anchor.object?.kind === 'booth') stage?.focusBooth(anchor.object.id)
  else if (anchor.object?.kind === 'infra') stage?.focusInfra(anchor.object.id)
  else if (anchor.camera) stage?.applyCameraBookmark(anchor.camera)
}

function locateComment(comment: ShareComment) {
  selectComment(comment)
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

function toggleLabels() {
  labelsOn.value = !labelsOn.value
  stage?.setBoothLabelsVisible(labelsOn.value)
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

watch(visitorName, (value) => setAuthorName(value))

onMounted(() => {
  isMobile.value = window.matchMedia('(max-width: 900px)').matches
  void load()
})

onBeforeUnmount(() => {
  stream?.close()
  stream = null
  stage?.dispose()
  stage = null
  window.clearTimeout(editTimer)
  window.clearTimeout(toastTimer)
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
      <input
        v-model="visitorName"
        class="share-name"
        maxlength="24"
        title="匿名评论昵称"
        aria-label="匿名评论昵称"
      />
      <div class="share-views">
        <button type="button" @click="viewTop">俯视</button>
        <button type="button" @click="viewIso">轴测</button>
        <button type="button" @click="fitView">适配</button>
      </div>
      <button class="share-btn pri" type="button" @click="copyLink">复制链接</button>
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
          <span class="share-chip">{{ areaText }}</span>
          <span class="share-chip">{{ booths.length }} 个展台</span>
        </div>

        <div v-if="authorEditing && !loading" class="share-livepill">
          <span class="pulse" />
          <b>作者正在编辑</b>
          {{ editingLabel }}
        </div>

        <div v-if="toast" class="share-toast">{{ toast }}</div>

        <div v-if="!loading && !error" class="share-dock">
          <button type="button" @click="viewTop">俯视</button>
          <button type="button" @click="fitView">适配</button>
          <button type="button" :class="{ on: labelsOn }" @click="toggleLabels">标签</button>
          <span class="share-sep" style="height: 14px" />
          <button
            type="button"
            :class="{ on: commentMode }"
            :disabled="!commentAllowed"
            :title="commentAllowed ? '在画布上添加评论' : '该链接未开放评论'"
            @click="startComment"
          >
            评论
          </button>
        </div>

        <button v-if="!loading && !error" class="share-fab" type="button" @click="togglePanel">
          评论
        </button>

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
        mode="visitor"
        :logged-in="true"
        :connected="connected"
        :pending-anchor="pendingAnchor ? { point: pendingAnchor.point, object: pendingAnchor.object } : null"
        :pending-label="pendingAnchor?.label || ''"
        :author-label="visitorName"
        :closable="isMobile"
        :comment-enabled="commentAllowed"
        :object-label="objectLabelOf"
        @select="selectComment"
        @locate="locateComment"
        @send="sendComment"
        @reply="replyTo"
        @resolve="resolveComment"
        @remove="removeComment"
        @cancel-pending="cancelPending"
        @request-anchor="requestAnchor"
        @refresh="reloadScene"
        @close="panelOpen = false"
      />
    </div>
  </div>
</template>

<style>
.share-viewport {
  position: absolute;
  inset: 0;
}
</style>
