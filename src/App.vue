<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ActionDock from './components/ActionDock.vue'
import AppTopBar from './components/AppTopBar.vue'
import ToastHost from './components/ToastHost.vue'
import ExportDialog from './components/ExportDialog.vue'
import CloudStorageDialog from './components/CloudStorageDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import HelpMobilePanel from './components/HelpMobilePanel.vue'
import HelpPanel from './components/HelpPanel.vue'
import Inspector from './components/Inspector.vue'
import CommentLayer from './review/CommentLayer.vue'
import ReviewPanel from './review/ReviewPanel.vue'
import ShareDialog from './review/ShareDialog.vue'
import { useReviewComments } from './review/useReviewComments'
import { useLiveShare } from './review/useLiveShare'
import { resolveAnchor } from './review/anchors'
import { shareApi, type ShareComment, type ShareMeta } from './core/shareApi'
import { pushMessage } from './core/messageCenter'
import { playCollabSound } from './core/notificationSound'
import './review/review.css'
import MobileViewer from './components/MobileViewer.vue'
import SceneTree from './components/SceneTree.vue'
import StatusBar from './components/StatusBar.vue'
import SunTimeline from './components/SunTimeline.vue'
import WalkMinimap from './components/WalkMinimap.vue'
import WalkOverlay from './components/WalkOverlay.vue'
import WeatherPanel from './components/WeatherPanel.vue'
import {
  insetPolygon,
  pointInPolygon,
  polygonArea,
  polygonInsidePolygon,
  polygonsOverlap,
} from './core/polygon'
import { Stage, type ReportLayers } from './core/Stage'
import {
  clearStoredProject,
  loadStoredProject,
  saveStoredProject,
} from './core/projectStore'
import sampleSceneJson from './data/sample-scene.json'
import { exportBoothList, type SceneJson } from './core/sceneFile'
import {
  useSceneHistory,
  type SceneChangeSet,
  type SceneSnapshot,
} from './composables/useSceneHistory'
import type { WeatherKind } from './core/weather'
import { useWeather } from './composables/useWeather'
import { useEditorShortcuts } from './composables/useEditorShortcuts'
import {
  hasRestorableScene,
  useScenePersistence,
} from './composables/useScenePersistence'
import { useCloudStorage } from './composables/useCloudStorage'
import { useStageSync } from './composables/useStageSync'
import { useUnderlay } from './composables/useUnderlay'
import { useInfraEditing } from './composables/useInfraEditing'
import { useFurniturePresets } from './composables/useFurniturePresets'
import { useBoothEditing } from './composables/useBoothEditing'
import { useSceneOperations } from './composables/useSceneOperations'
import { useEditorUi } from './composables/useEditorUi'
import {
  QUALITY_LABELS,
  useEditorState,
} from './composables/useEditorState'
import { boothKindForStyle } from './core/booth'
import { isFurnitureKind } from './core/infra'
import { exportInventoryXlsx } from './core/xlsxExport'
import { downloadPlanPdf as buildPlanPdf } from './core/planPdf'
import type { FurniturePreset } from './core/furniturePreset'
import type { Booth, BoothStyle, Pt, VenueRules } from './core/types'
import { DEFAULT_VENUE_RULES } from './core/types'
import { checkCompliance } from './core/compliance'

const {
  hostEl,
  venue,
  projectKey,
  resetProjectKey,
  venueName,
  editingVenueName,
  booths,
  infras,
  selectedInfraId,
  selectedInfraIds,
  skipRevealBoothId,
  skipRevealInfraId,
  addFocusSection,
  addFocusToken,
  mode,
  draftPoints,
  draftHeight,
  boothKind,
  boothStyle,
  selectedIds,
  gridOn,
  dimOn,
  underlay,
  northDeg,
  sunProgress,
  sunPlaying,
  quality,
  venueXray,
  boothLabelsOn,
  infraLabelsOn,
  furnitureLabelsOn,
  areaOn,
  venueNoTop,
  showHelp,
  showWeather,
  toolMenu,
  toolSubMenu,
  hover,
  rotateDeg,
  walkState,
  walkView,
  walkAuto,
  walkAutoSpeed,
  walkAutoLoop,
  walkTourInfo,
  walkUiHidden,
  presentationOn,
  walkPose,
  minimapExpanded,
  walkInteract,
  spaceNavActive,
  isMobile,
  mobilePanelOpen,
  toolsCollapsed,
  isPortrait,
  showRotateHint,
  renderOnly,
  appBooting,
  dockExpanded,
  qualityLabel,
  simTime,
  sunMinutes,
  sunPercent,
  sunIsDay,
  labelsOn,
  mobileDocked,
  venueArea,
  boothsArea,
  coverage,
  showWelcome,
  draftArea,
  isPlacing,
  rotateDisplay,
  rotateSnapped,
  gridWanted,
  focusAdd,
  toast,
  handleStageHover,
  dispose: disposeEditorState,
} = useEditorState()

const {
  weather,
  weatherOn,
  liveWeatherOn,
  liveWeather,
  particleDensities,
  weatherVisibility,
  setParticleDensity,
  setWeatherVisibility,
  previewParticleWeather,
  toggleWeatherEnabled,
  chooseWeather,
  toggleLiveWeather,
  applyLiveWeatherForVenue,
  setSuppressAutoWeather,
} = useWeather({
  getStage: () => stage,
  isMobile: () => isMobile.value,
  isRestoring: () => restoringProject.value,
  toast,
  onChoose: () => {
    // 面板保持打开，方便连续对比不同天气；关闭交给 × 或 Esc
    if (walkState.value === 'walk') stage?.resumeWalkFromUi()
  },
})

const LENS_WEATHER = new Set<WeatherKind>([
  'haze',
  'fog',
  'light-rain',
  'heavy-rain',
  'thunder',
  'light-snow',
  'heavy-snow',
  'dust',
])
const weatherLensOn = computed(
  () =>
    walkState.value === 'walk' &&
    walkView.value === 'first' &&
    !venue.value?.ceiling &&
    LENS_WEATHER.has(weather.value),
)
const importInput = ref<HTMLInputElement | null>(null)
/** 右侧属性面板正在查看的家具预设 */
const selectedPresetId = ref<string | null>(null)
watch(mobileDocked, (on) => {
  if (!on) dockExpanded.value = false
})

const router = useRouter()
let stage: Stage | null = null
/** 左侧结构树：供 L 快捷键触发“定位到选中对象” */
const sceneTreeRef = ref<{
  locateSelected: () => void | Promise<void>
} | null>(null)

let seq = 0
let infraSeq = 0
const restoringProject = ref(false)

function beginVenueRename() {
  editingVenueName.value = true
}

function finishVenueRename() {
  if (!editingVenueName.value) return
  venueName.value = venueName.value.trim() || '场馆白膜'
  editingVenueName.value = false
}

function cancelVenueRename() {
  venueName.value = venueName.value.trim() || '场馆白膜'
  editingVenueName.value = false
}

function resetSequences(boothCount: number, infraCount: number) {
  seq = Math.max(boothCount, 1)
  infraSeq = Math.max(infraCount, 1)
}

const {
  setInfraSelection,
  clearInfraSelection,
  handlePick,
  hasGroupInSelection,
  selectionIsOneGroup,
  mergeDialog,
  overlaps,
  cleanupFurniture,
  nextGroupId,
  deleteVenue,
  deleteBooth,
  deleteSelectedBooths,
  changeVenueHeight,
  changeBoothHeight,
  changeBoothKind,
  changeBoothStyle,
  setBoothCanopy,
  setBoothNoTop,
  setBoothMark,
  resizeBooth,
  rotateSelected,
  mergeSelected,
  applyMerge,
  unmergeSelected,
  moveBooth,
  rotateBooth,
} = useSceneOperations({
  venue,
  booths,
  infras,
  selectedIds,
  selectedInfraIds,
  selectedInfraId,
  skipRevealBoothId,
  skipRevealInfraId,
  mode,
  draftPoints,
  venueNoTop,
  toast,
  venueInner,
})

/** 规范校验参数：在场馆属性里编辑，随场景保存 */
const venueRules = ref<VenueRules>({ ...DEFAULT_VENUE_RULES })

/** 实时校验结果：场馆 / 展台 / 设施或参数变化时重算 */
const complianceIssues = computed(() =>
  checkCompliance(venue.value, booths.value, infras.value, venueRules.value),
)

function setVenueRule(key: keyof VenueRules, value: number | boolean) {
  if (key === 'enabled') {
    venueRules.value = { ...venueRules.value, enabled: !!value }
    return
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return
  const ranges: Record<Exclude<keyof VenueRules, 'enabled'>, [number, number]> = {
    minGap: [0, 5],
    maxBoothHeight: [1, 24],
    aisleWidth: [0, 12],
    minGateWidth: [0.6, 6],
    minGates: [0, 20],
  }
  const [min, max] = ranges[key as Exclude<keyof VenueRules, 'enabled'>]
  const next = key === 'minGates' ? Math.round(n) : Math.round(n * 10) / 10
  venueRules.value = {
    ...venueRules.value,
    [key]: Math.min(max, Math.max(min, next)),
  }
}

// ---------- 云端存储 ----------

const cloud = useCloudStorage()
const showCloudDialog = ref(false)
const cloudOverwrite = ref<{ resolve: (ok: boolean) => void } | null>(null)
const CLOUD_OVERWRITE_MESSAGE =
  '检测到本地 IndexedDB 中已有场景数据。是否用云端存档覆盖当前场景？选择「保留本地」会继续使用本地场景。'

function askCloudOverwrite(): Promise<boolean> {
  return new Promise((resolve) => {
    cloudOverwrite.value = { resolve }
  })
}

function confirmCloudOverwrite() {
  cloudOverwrite.value?.resolve(true)
  cloudOverwrite.value = null
}

function cancelCloudOverwrite() {
  cloudOverwrite.value?.resolve(false)
  cloudOverwrite.value = null
}

const cloudModeActive = computed(
  () => cloud.enabled && !!cloud.user.value && cloud.currentSlot.value !== null,
)

/** 登录时若已有未保存场景，先暂停自动保存，等待用户另存 / 覆盖 / 弃用 */
const cloudScenePending = ref(false)

const hasSceneContent = computed(
  () =>
    !!venue.value ||
    booths.value.length > 0 ||
    infras.value.length > 0 ||
    !!underlay.value,
)

/** 欢迎页入口文案：未登录时引导登录 */
const cloudWelcomeLabel = computed(() => (cloud.user.value ? '云端存储' : '登录云端'))

/** 云模式未就绪时的状态栏红色提示；空字符串表示正常保存 */
const cloudBlockedHint = computed(() => {
  if (!cloud.enabled) return ''
  if (!cloud.user.value) return '未保存 · 未登录'
  if (cloudScenePending.value) return '未保存 · 请选择存储位置'
  if (cloud.currentSlot.value === null) return '未保存 · 未选择位置'
  return ''
})

const {
  buildSceneJson,
  downloadScene,
  onImportFile,
  importSceneJson,
  applySceneJson,
  saveProjectNow,
  scheduleAutosave,
  restoreStoredProject,
  saveState,
  savedAt,
  dispose: disposeScenePersistence,
} = useScenePersistence({
  venue,
  projectKey,
  venueName,
  booths,
  infras,
  underlay,
  weather,
  weatherOn,
  sunProgress,
  rules: venueRules,
  liveWeatherOn,
  liveWeather,
  venueNoTop,
  selectedIds,
  draftPoints,
  mode,
  renderOnly,
  restoringProject,
  appBooting,
  clearInfraSelection,
  getPresets: () => presets.value,
  applyScenePresets: (raw) => setPresetsFromScene(raw),
  clearPresetSelection: () => {
    selectedPresetId.value = null
  },
  setSuppressAutoWeather,
  toast,
  getStage: () => stage,
  resetSequences,
  cloud: {
    enabled: cloud.enabled,
    // 有未处理场景时暂停自动保存，避免登录后直接覆盖云端存档
    ready: () => cloud.ready.value && !cloudScenePending.value,
    save: async (scene) => {
      const ok = await cloud.saveAutosave(scene)
      if (!ok) throw new Error(cloud.error.value || '云端保存失败')
    },
    fetch: () => cloud.fetchCurrentScene(),
    confirmOverwrite: () => askCloudOverwrite(),
  },
})

// ---------- 分享与评审评论 ----------

const rightTab = ref<'props' | 'review'>('props')
const showShareDialog = ref(false)
const shareExisting = ref<ShareMeta | null>(null)
const shareBusy = ref(false)
const shareError = ref('')
const selectedCommentId = ref<number | null>(null)

const reviewLoggedIn = computed(() => cloud.enabled && !!cloud.user.value)
const reviewAuthorName = computed(() => cloud.user.value?.username || '作者')
/** 没有场馆轮廓时不开放分享与评论 */
const canShareScene = computed(() => !!venue.value)

watch(canShareScene, (has) => {
  if (!has && rightTab.value === 'review') rightTab.value = 'props'
})

const liveShare = useLiveShare({
  scene: () => buildSceneJson(),
  share: shareExisting,
  enabled: computed(
    () =>
      reviewLoggedIn.value &&
      canShareScene.value &&
      !!shareExisting.value?.liveMode,
  ),
  onError: (message) => {
    shareError.value = message
  },
})

/** 当前云端存档对应的分享链接：评审只读取这条链接 */
const reviewShareToken = computed(() => shareExisting.value?.token ?? null)

const {
  comments: reviewComments,
  unread: reviewUnread,
  loading: reviewLoading,
  connected: reviewConnected,
  refresh: refreshReview,
  markSeen: markReviewSeen,
  resolve: resolveReview,
  reply: replyReview,
  remove: removeReview,
} = useReviewComments({
  shareToken: reviewShareToken,
  enabled: computed(() => reviewLoggedIn.value && canShareScene.value),
  onNewComment: (comment) => {
    if (comment.authorRole !== 'visitor') return
    const me = cloud.user.value
    const parent = comment.parentId
      ? reviewComments.value.find((item) => item.id === comment.parentId)
      : null
    // 服务端新数据带 replyToUserId；旧回复回退到根评论作者
    const replyToMe =
      !!me &&
      (comment.replyToUserId != null
        ? comment.replyToUserId === me.id
        : !!parent && (parent.authorUserId === me.id || parent.mine))
    playCollabSound('comment', 'editor')
    // 作者编辑器内，访客新增评论和回复都弹 B 类 Toast（评审面板打开也弹）
    pushMessage({
      scope: 'editor',
      type: 'collab',
      title: replyToMe
        ? `${comment.authorName} 回复了你的评论`
        : `${comment.authorName} 新增了评论`,
      text: replyToMe ? '点击查看并定位到你的评论' : '点击查看评审',
      dedupeKey: `review-${comment.id}`,
      action: {
        label: '查看',
        run: () =>
          openReviewFromToast(
            replyToMe ? comment.parentId ?? comment.id : comment.id,
          ),
      },
    })
  },
  onError: (message) => toast(message),
  isPanelOpen: () => rightTab.value === 'review',
})

let shareRestoreSeq = 0

/** 当前云端存档决定链接身份；清缓存和换设备都不会影响恢复 */
async function restoreShareLink() {
  const slot = cloud.currentSlot.value
  const seq = ++shareRestoreSeq
  shareExisting.value = null
  if (!slot || !reviewLoggedIn.value) return
  try {
    const meta = await shareApi.getStorageShare(slot)
    if (
      seq !== shareRestoreSeq ||
      cloud.currentSlot.value !== slot ||
      meta.revoked
    ) {
      return
    }
    shareExisting.value = meta
    liveShare.reset(buildSceneJson(), meta.revision)
    void refreshReview()
  } catch {
    // 404 表示当前存档还没有分享链接；其他错误留给打开分享弹窗时提示
  }
}

async function openShareDialog() {
  if (!canShareScene.value) {
    toast('请先创建场馆后再分享')
    return
  }
  if (!cloud.enabled) {
    toast('分享需要开启云端存储')
    return
  }
  if (!reviewLoggedIn.value) {
    openCloudDialog()
    return
  }
  if (cloud.currentSlot.value === null) {
    toast('请先将场景保存到云端存档')
    openCloudDialog()
    return
  }
  if (!shareExisting.value) {
    await restoreShareLink()
  }
  shareError.value = ''
  showShareDialog.value = true
  if (!shareExisting.value) return
  try {
    const meta = await shareApi.getShare(shareExisting.value.token)
    if (meta.revoked) {
      shareExisting.value = null
      shareError.value = '该分享链接已被撤销'
      return
    }
    shareExisting.value = meta
  } catch (err) {
    shareExisting.value = null
    shareError.value = err instanceof Error ? err.message : '读取分享链接失败'
  }
}

function shareUrl(): string {
  const share = shareExisting.value
  if (!share) return ''
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`
  return `${base}#/share/${share.token}`
}

async function copyShareLink() {
  const url = shareUrl()
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    try {
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
    } catch {
      // 剪贴板不可用时仍然提示，链接可在弹窗中手动复制
    }
  }
  toast('分享链接已复制')
}

async function publishShare(payload: {
  title: string
  liveMode: boolean
  allowComment: boolean
  allowDownload: boolean
}) {
  if (!reviewLoggedIn.value) {
    showShareDialog.value = false
    openCloudDialog()
    return
  }
  if (!canShareScene.value) {
    shareError.value = '请先创建场馆'
    return
  }
  const slot = cloud.currentSlot.value
  if (slot === null) {
    shareError.value = '请先将场景保存到云端存档'
    return
  }
  shareBusy.value = true
  shareError.value = ''
  try {
    const scene = buildSceneJson()
    const meta = await shareApi.saveStorageShare(slot, {
      title: payload.title,
      scene,
      liveMode: payload.liveMode,
      allowComment: payload.allowComment,
      allowDownload: payload.allowDownload,
    })
    shareExisting.value = meta
    liveShare.reset(scene, meta.revision)
    void refreshReview()
    await copyShareLink()
    showShareDialog.value = false
    toast('分享链接已发布')
  } catch (err) {
    shareError.value = err instanceof Error ? err.message : '发布分享链接失败'
  } finally {
    shareBusy.value = false
  }
}

async function updateShareSettings(payload: {
  title: string
  liveMode: boolean
  allowComment: boolean
  allowDownload: boolean
}) {
  const share = shareExisting.value
  if (!share) return
  const slot = share.storageSlot ?? cloud.currentSlot.value
  if (slot === null) {
    shareError.value = '该链接没有关联云端存档'
    return
  }
  shareBusy.value = true
  shareError.value = ''
  try {
    const meta = await shareApi.saveStorageShare(slot, {
      title: payload.title,
      liveMode: payload.liveMode,
      allowComment: payload.allowComment,
      allowDownload: payload.allowDownload,
    })
    shareExisting.value = meta
    if (meta.liveMode) liveShare.reset(buildSceneJson(), meta.revision)
    toast('分享设置已保存')
  } catch (err) {
    shareError.value = err instanceof Error ? err.message : '保存分享设置失败'
  } finally {
    shareBusy.value = false
  }
}

async function freezeShare() {
  const share = shareExisting.value
  if (!share) return
  shareBusy.value = true
  shareError.value = ''
  try {
    const scene = buildSceneJson()
    const meta = await shareApi.updateShare(share.token, { scene, liveMode: false })
    shareExisting.value = meta
    liveShare.reset(scene, meta.revision)
    toast('已冻结当前版本')
  } catch (err) {
    shareError.value = err instanceof Error ? err.message : '冻结版本失败'
  } finally {
    shareBusy.value = false
  }
}

async function revokeShare() {
  const share = shareExisting.value
  if (!share) return
  shareBusy.value = true
  shareError.value = ''
  try {
    await shareApi.revokeShare(share.token)
    shareExisting.value = null
    void refreshReview()
    showShareDialog.value = false
    toast('分享链接已删除')
  } catch (err) {
    shareError.value = err instanceof Error ? err.message : '撤销链接失败'
  } finally {
    shareBusy.value = false
  }
}

function toggleReview() {
  if (!canShareScene.value) {
    toast('请先创建场馆后再查看评审')
    return
  }
  rightTab.value = rightTab.value === 'review' ? 'props' : 'review'
  if (rightTab.value === 'review') markReviewSeen()
}

function reviewObjectLabel(comment: ShareComment): string {
  const resolved = resolveAnchor(comment.anchor, booths.value, infras.value)
  return resolved.valid ? `定位 ${resolved.label}` : '锚点失效'
}

function selectReviewComment(comment: ShareComment) {
  selectedCommentId.value = comment.id
}

function locateReviewComment(comment: ShareComment) {
  selectReviewComment(comment)
  const resolved = resolveAnchor(comment.anchor, booths.value, infras.value)
  if (!resolved.valid) {
    toast('该评论对应的对象已被删除')
    return
  }
  if (comment.anchor.object?.kind === 'booth') {
    handlePick(comment.anchor.object.id, false, 'booth')
    stage?.focusBooth(comment.anchor.object.id)
  } else if (comment.anchor.object?.kind === 'infra') {
    selectInfra(comment.anchor.object.id)
    stage?.focusInfra(comment.anchor.object.id)
  } else if (comment.anchor.camera) {
    stage?.applyCameraBookmark(comment.anchor.camera)
  }
}

function onReviewReply(payload: { comment: ShareComment; content: string }) {
  void replyReview(payload.comment, payload.content)
}

function onReviewResolve(comment: ShareComment) {
  void resolveReview(comment, !comment.resolvedAt)
}

function loginForShare() {
  showShareDialog.value = false
  openCloudDialog()
}

function openReviewFromToast(commentId?: number | null) {
  rightTab.value = 'review'
  if (commentId != null) selectedCommentId.value = commentId
  markReviewSeen()
}

function clampHeight(v: number): number {
  if (!Number.isFinite(v)) return 6
  const isVenue = mode.value === 'height-venue'
  return Math.round(Math.min(isVenue ? 24 : 8, Math.max(isVenue ? 2 : 1, v)))
}

/** 场馆内部可用区域（扣掉墙厚与安全距离） */
function venueInner(pad = 0.4): Pt[] | null {
  if (!venue.value) return null
  return insetPolygon(venue.value.points, pad) ?? venue.value.points
}

function insideVenueArea(p: Pt): boolean {
  const inner = venueInner()
  if (!inner) return false
  return pointInPolygon(p, inner)
}

const {
  viewTop,
  viewIso,
  fitView,
  toggleToolMenu,
  enterPresentation,
  exitPresentation,
  openHelp,
  runHelpQuickAction,
  openWeather,
  closeWeather,
  toggleBoothLabels,
  toggleInfraLabels,
  toggleFurnitureLabels,
  toggleNameSubmenu,
  toggleAreas,
  toggleGrid,
  toggleDimensions,
  toggleSunPlay,
  resetSunToNow,
  chooseQuality,
  onSunScrub,
  toggleWalk,
  onOrientationChange,
  cancelRotateHint,
  exitWalkFullscreen,
  applyVenueXray,
  toggleVenueXray,
  toggleVenueTop,
  dispose: disposeEditorUi,
} = useEditorUi({
  venue,
  mode,
  selectedIds,
  mobilePanelOpen,
  walkState,
  walkView,
  isMobile,
  isPortrait,
  showRotateHint,
  toolsCollapsed,
  toolMenu,
  toolSubMenu,
  showHelp,
  showWeather,
  presentationOn,
  gridOn,
  dimOn,
  areaOn,
  boothLabelsOn,
  infraLabelsOn,
  furnitureLabelsOn,
  quality,
  sunPlaying,
  sunProgress,
  venueXray,
  venueNoTop,
  getStage: () => stage,
  toast,
})

// ---------- 基础设施 ----------

const {
  pendingInfraCopy,
  beginInfraPlace,
  handlePlaceInfra,
  selectInfra,
  renameInfra,
  deleteInfra,
  deleteInfraSelection,
  updateInfraDims,
  updateInfraMaterial,
  moveInfra,
  moveInfraGroup,
  nudgeInfra,
  nudgeInfraGroup,
  rotateInfra,
  rotateInfraGroup,
  toggleGate,
  setGateOpenMode,
  changeInfraCount,
  cancelInfraPlacement,
} = useInfraEditing({
  infras,
  booths,
  venue,
  mode,
  draftPoints,
  selectedIds,
  selectedInfraIds,
  selectedInfraId,
  skipRevealInfraId,
  setInfraSelection,
  clearInfraSelection,
  focusAdd,
  toast,
  nextInfraSeq: () => {
    infraSeq += 1
    return infraSeq
  },
})

// ---------- 家具组合预设 ----------

const {
  presets,
  pendingPreset,
  savePresetFromSelection,
  removePreset,
  renamePreset,
  setPresetsFromScene,
  beginPresetPlace,
  placePresetAt,
  cancelPresetPlacement,
  copySelectedFurniture,
} = useFurniturePresets({
  infras,
  booths,
  mode,
  selectedIds,
  selectedInfraIds,
  setInfraSelection,
  clearInfraSelection,
  renderOnly,
  toast,
  nextInfraSeq: () => {
    infraSeq += 1
    return infraSeq
  },
})

/** 右侧属性面板当前查看的家具预设 */
const selectedPreset = computed(
  () => presets.value.find((p) => p.id === selectedPresetId.value) ?? null,
)

/** 左侧预设行 / 属性面板「布置」：选中预设并进入落位 */
function selectPresetFromPanel(preset: FurniturePreset) {
  if (mode.value === 'place-preset') cancelPresetPlacement()
  if (!renderOnly.value && mode.value !== 'idle') {
    beginPresetPlace(preset)
    return
  }
  selectedPresetId.value = preset.id
  selectedIds.value = []
  clearInfraSelection()
  if (!renderOnly.value) beginPresetPlace(preset)
}

watch(presets, (list) => {
  if (
    selectedPresetId.value &&
    !list.some((p) => p.id === selectedPresetId.value)
  ) {
    selectedPresetId.value = null
  }
})

/** 删除预设：如果正在布置它，先结束落位，避免留下幽灵 */
function deletePreset(id: string) {
  if (pendingPreset.value?.id === id) cancelPresetPlacement()
  removePreset(id)
}

// 进入绘制 / 放置其他对象时，离开预设详情
watch(mode, (m) => {
  if (m !== 'idle' && m !== 'place-preset') selectedPresetId.value = null
})

// 布置完成后新家具会被选中，此时右侧切回家具属性
watch(selectedInfraId, (id) => {
  if (id) selectedPresetId.value = null
})
watch(selectedIds, (ids) => {
  if (ids.length) selectedPresetId.value = null
})

/** 右键旋转：多选家具时整组旋转，否则只转单件 */
function rotateInfraOrSelection(id: string, dir: 1 | -1) {
  const ids = selectedInfraIds.value
  if (ids.length > 1 && ids.includes(id)) {
    const items = infras.value.filter((it) => ids.includes(it.id))
    const furnitureGroup =
      items.length === ids.length && items.every((it) => isFurnitureKind(it.kind))
    if (furnitureGroup) {
      rotateInfraGroup(ids, dir)
      return
    }
  }
  rotateInfra(id, dir)
}

/** Ctrl+C：多选家具整组复制并进入落位，单件沿用原有复制 */
function copyInfraOrSelection() {
  const ids = selectedInfraIds.value
  if (ids.length > 1) {
    const items = infras.value.filter((it) => ids.includes(it.id))
    const furnitureGroup =
      items.length === ids.length && items.every((it) => isFurnitureKind(it.kind))
    if (furnitureGroup) {
      copySelectedFurniture()
      return
    }
  }
  copySelectedInfra()
}

function deleteSelectedFurniture() {
  const ids = selectedInfraIds.value.length
    ? selectedInfraIds.value
    : selectedInfraId.value
      ? [selectedInfraId.value]
      : []
  if (ids.length) deleteInfraSelection(ids)
}

function nudgeSelectedFurniture(dx: number, dz: number) {
  const ids = selectedInfraIds.value.length
    ? selectedInfraIds.value
    : selectedInfraId.value
      ? [selectedInfraId.value]
      : []
  if (ids.length > 1) nudgeInfraGroup(ids, dx, dz)
  else if (ids.length === 1) nudgeInfra(ids[0], dx, dz)
}

/** Esc：家具组合落位与其他设施放置分别收尾 */
function cancelPlacing() {
  if (mode.value === 'place-preset') cancelPresetPlacement()
  else cancelInfraPlacement()
}

function selectInfraFromPanel(id: string, additive = false) {
  selectedPresetId.value = null
  if (additive) {
    handlePick(id, true, 'infra')
    return
  }
  selectInfra(id)
  stage?.focusInfra(id)
}

function selectBoothFromPanel(id: string, additive = false) {
  selectedPresetId.value = null
  handlePick(id, additive, 'booth')
  stage?.focusBooth(id)
}

/** 点击结构树里的场馆名：取消选中，镜头回到全景 */
function selectVenueNode() {
  selectedPresetId.value = null
  selectedIds.value = []
  clearInfraSelection()
  fitView()
}

/** 画布点选：离开预设详情，交给原来的选中逻辑 */
function handleStagePick(
  id: string | null,
  additive: boolean,
  kind?: 'booth' | 'infra',
) {
  selectedPresetId.value = null
  handlePick(id, additive, kind)
}

/** 结构树删除展台：走统一确认弹窗，避免误删连带家具与落地设施 */
function confirmDeleteBooth(id: string) {
  const target = booths.value.find((b) => b.id === id)
  const name = target?.name ?? '该展台'
  pendingConfirm.value = {
    kind: 'delete-booth',
    title: `删除展台 ${name}`,
    message: '展台内的家具和落地设施会一起移除，且不可撤销。确定删除？',
    confirmLabel: '删除',
    danger: true,
    payload: id,
  }
}

const {
  getPasteClipboard,
  startVenueDraw,
  startBoothDraw,
  handlePlace,
  handleDrawRect,
  undoPoint,
  cancelDraft,
  closeDraft,
  backToDraw,
  copySelectedBooths,
  copySelectedInfra,
  cancelBoothPaste,
  placePastedBooths,
  confirmHeight,
} = useBoothEditing({
  venue,
  booths,
  infras,
  mode,
  draftPoints,
  draftHeight,
  boothKind,
  boothStyle,
  venueNoTop,
  selectedIds,
  selectedInfraId,
  skipRevealBoothId,
  pendingInfraCopy,
  renderOnly,
  clearInfraSelection,
  clearHover: () => {
    hover.value = null
  },
  focusAdd,
  toast,
  getStage: () => stage,
  applyLiveWeatherForVenue,
  venueInner,
  insideVenueArea,
  clampHeight,
  overlaps,
  cleanupFurniture,
  nextGroupId,
  nextBoothSeq: () => {
    seq += 1
    return seq
  },
  nextInfraSeq: () => {
    infraSeq += 1
    return infraSeq
  },
})

/** 从模型库直接以某个模型开始绘制 */
function startBoothStyle(style: BoothStyle) {
  startBoothDraw(boothKindForStyle(style), style)
}

// ---------- 撤销 / 重做 ----------

function applyHistoryScene(snap: SceneSnapshot, changed: SceneChangeSet) {
  if (changed.venue) {
    venue.value = snap.venue
      ? {
          ...snap.venue,
          points: snap.venue.points.map((p) => ({ x: p.x, z: p.z })),
        }
      : null
  }
  if (changed.booths) {
    booths.value = snap.booths.map((b) => ({
      ...b,
      points: b.points.map((p) => ({ x: p.x, z: p.z })),
    }))
  }
  if (changed.infras) {
    infras.value = snap.infras.map((it) => ({ ...it }))
  }
  venueNoTop.value = snap.venue ? !snap.venue.ceiling : venueNoTop.value
  selectedIds.value = []
  clearInfraSelection()
  mode.value = 'idle'
  draftPoints.value = []
}

const {
  canUndo,
  canRedo,
  undo,
  redo,
  dispose: disposeHistory,
} = useSceneHistory({
  venue,
  booths,
  infras,
  renderOnly,
  applyScene: applyHistoryScene,
})

// IndexedDB 自动保存：名称、场景、底图、天气和太阳时间一起保留
watch(
  [venue, booths, infras, underlay, venueName, weather, weatherOn, presets],
  () => {
    scheduleAutosave()
    liveShare.schedulePush()
  },
)

// 链接跟随当前云端存档；启动完成、登录、切换存档时重新读取该存档自己的链接。
watch(
  [
    () => cloud.currentSlot.value,
    () => cloud.user.value?.id,
    appBooting,
  ],
  ([slot, userId, booting]) => {
    if (!slot || !userId) {
      shareExisting.value = null
      return
    }
    if (booting) return
    void restoreShareLink()
  },
  { immediate: true },
)

// 只有用户拖动时间轴时才落盘：播放推进不写盘，拖动结束 1.2s 后保存一次。
// 实时分享单独限频：拖动/暂停立即推，播放中最多 4 秒推一次，避免每帧 PATCH。
let lastSunPushAt = 0
watch(sunProgress, () => {
  if (sunScrubbing.value) {
    scheduleAutosave(1200)
    liveShare.schedulePush(500)
    return
  }
  const now = Date.now()
  if (now - lastSunPushAt < 4000) return
  lastSunPushAt = now
  liveShare.schedulePush(800)
})

// 暂停播放时补一次保存和同步，确保最后的时刻被记住
watch(sunPlaying, (on) => {
  if (on) return
  scheduleAutosave()
  liveShare.schedulePush(300)
})

// 预览 / 展示 / 漫游会一次性改变视口宽度：先用上一帧盖住，避免黑屏
watch(
  [renderOnly, presentationOn, () => walkState.value !== 'off'],
  () => stage?.captureResizeGhost(),
)

// ---------- JSON 导入 / 导出 ----------

/** 导出展位与家具清单：XLSX 内含 Logo 图片与家具汇总 */
async function downloadInventoryXlsx() {
  if (!booths.value.length) {
    toast('还没有展台可导出')
    return
  }
  try {
    const { boothCount, furnitureCount, fileName } = await exportInventoryXlsx({
      venueName: venueName.value,
      booths: booths.value,
      infras: infras.value,
    })
    toast(`已导出 ${boothCount} 个展台、${furnitureCount} 件家具 · ${fileName}`)
  } catch (err) {
    console.error(err)
    toast('导出清单失败，请重试')
  }
}

/** Ctrl / Cmd + S：立即保存，并按当前存储方式给出反馈 */
async function saveSceneManually() {
  if (renderOnly.value) {
    toast('只读模式已禁用保存')
    return
  }
  if (cloud.enabled && !cloud.ready.value) {
    // 未登录时直接打开登录框；已登录时打开位置选择面板
    openCloudDialog()
    toast(
      !cloud.user.value
        ? '请先登录云端存储'
        : cloudScenePending.value
          ? '请选择保存位置，或弃用当前场景'
          : '请先选择云端存储位置',
    )
    return
  }
  if (saveState.value === 'saving') {
    toast('正在保存…')
    return
  }
  await saveProjectNow()
  if (saveState.value === 'saved') {
    toast(
      cloudModeActive.value
        ? `已保存到云端位置 ${cloud.currentSlot.value ?? ''}`
        : '已保存到本地',
    )
  } else if (cloudModeActive.value) {
    toast('云端保存失败，已保存到本地兜底')
  } else {
    toast('保存失败，请稍后重试')
  }
}

/** 打开云端存储面板；配置关闭时给出明确提示 */
function openCloudDialog() {
  toolMenu.value = null
  if (!cloud.enabled) {
    toast('云端存储未启用：请在 .env 中设置 VITE_CLOUD_STORAGE_ENABLED=true 后重启')
    return
  }
  showCloudDialog.value = true
}

/** 登录成功：若已有未保存场景，先暂停自动保存并提示用户处理 */
function handleCloudLoginSuccess() {
  if (!hasSceneContent.value) return
  cloudScenePending.value = true
}

/** 弃用未保存场景：有云端存档则恢复，否则清空并取消自动保存目标 */
async function discardCloudScene() {
  const slot = cloud.currentSlot.value
  cloudScenePending.value = false
  if (slot !== null) {
    try {
      const detail = await cloud.fetchSlot(slot)
      showCloudDialog.value = false
      applySceneJson(detail.scene)
      savedAt.value = Date.now()
      saveState.value = 'saved'
      toast('已弃用当前场景，已恢复云端存档')
      return
    } catch (err) {
      console.warn('恢复云端存档失败', err)
    }
  }
  showCloudDialog.value = false
  deleteVenue()
  underlay.value = null
  venueName.value = '场馆白膜'
  cloud.setCurrentSlot(null)
  saveState.value = 'idle'
  toast('已弃用当前场景')
}

/** 手动保存当前场景到云端位置，并把它设为自动保存位置 */
async function saveSceneToCloud(slot: number) {
  await cloud.saveSlot(slot, venueName.value || '未命名场景', buildSceneJson())
  cloud.setCurrentSlot(slot)
  cloudScenePending.value = false
  // 手动保存不经过自动保存队列，这里同步状态栏
  savedAt.value = Date.now()
  saveState.value = 'saved'
  toast(`已保存到云端位置 ${slot}，自动保存已切换到此位置`)
}

/** 加载云端场景：本地已有数据时先询问是否覆盖 */
async function loadSceneFromCloud(slot: number) {
  const detail = await cloud.fetchSlot(slot)
  const local = await loadStoredProject()
  if (local && hasRestorableScene(local.scene)) {
    const overwrite = await askCloudOverwrite()
    if (!overwrite) {
      toast('已取消加载云端存档')
      return
    }
  }
  cloud.setCurrentSlot(slot)
  cloudScenePending.value = false
  applySceneJson(detail.scene)
  showCloudDialog.value = false
}

async function deleteSceneFromCloud(slot: number) {
  await cloud.removeSlot(slot)
  toast(`已删除云端位置 ${slot}`)
}

/** 阵列复制：沿 X 或 Z 方向按间距复制 N 个，保留展商、Logo、标记等属性 */
function arrayBooth(id: string, count: number, gap: number, axis: 'x' | 'z') {
  const src = booths.value.find((b) => b.id === id)
  if (!src) return
  const n = Math.min(20, Math.max(1, Math.round(count)))
  const d = Number.isFinite(gap) ? gap : 10
  if (d <= 0) {
    toast('阵列间距需要大于 0')
    return
  }

  const hall = venue.value
  const created: Booth[] = []
  for (let i = 1; i <= n; i++) {
    const points = src.points.map((p) => ({
      x: p.x + (axis === 'x' ? d * i : 0),
      z: p.z + (axis === 'z' ? d * i : 0),
    }))

    // 与已有展台相交（含源展台自身）：整体取消，避免出现压在一起的体量
    const hit = booths.value.find((b) => polygonsOverlap(b.points, points))
    if (hit) {
      toast(`第 ${i} 个位置与「${hit.name}」重叠，已取消阵列`)
      return
    }

    // 同批新位置之间也不能互相重叠
    const hitSelf = created.find((b) => polygonsOverlap(b.points, points))
    if (hitSelf) {
      toast(`第 ${i} 个位置与「${hitSelf.name}」重叠，请加大间距`)
      return
    }

    // 不能超出场馆轮廓
    if (hall && hall.points.length >= 3 && !polygonInsidePolygon(points, hall.points)) {
      toast(`第 ${i} 个位置超出场馆范围，已取消阵列`)
      return
    }

    created.push({
      ...src,
      id: `b${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${src.name}-${i + 1}`,
      points,
    })
  }
  booths.value = [...booths.value, ...created]
  toast(`已阵列复制 ${created.length} 个展台`)
}

/** 过道净宽标注：画布与导出共用同一套计算结果 */
const aisleOn = ref(false)

function toggleAisle() {
  aisleOn.value = !aisleOn.value
  stage?.setAisleVisible(aisleOn.value)
}

/** 导出弹窗：勾选内容后再决定输出 PNG 还是 PDF */
const showExportDialog = ref(false)
const exportBusy = ref(false)

/** 顶栏「汇报图」与场馆属性里的「平面图 PDF」都先打开弹窗 */
function openExportDialog() {
  if (!venue.value) {
    toast('请先绘制场馆')
    return
  }
  showExportDialog.value = true
}

/** 导出 A3 平面图纸 PDF（含图框、标题栏、图例、指北针与品牌标记） */
async function downloadPlanPdf(layers?: ReportLayers) {
  if (!venue.value) {
    toast('请先绘制场馆')
    return
  }
  const area = polygonArea(venue.value.points).toFixed(1)
  const imageDataUrl = await stage?.captureReportImage({
    title: venueName.value.trim() || '场馆白膜',
    subtitle: `${area} m² · ${booths.value.length} 个展台 · ${infras.value.length} 个设施`,
    stats: [
      { label: '场馆面积', value: `${area} m²` },
      { label: '展台覆盖率', value: `${coverage.value}%` },
      { label: '展台', value: `${booths.value.length}` },
    ],
    layers,
  })
  if (!imageDataUrl) {
    toast('平面图生成失败，请稍后重试')
    return
  }
  try {
    await buildPlanPdf({
      projectName: venueName.value.trim() || '场馆白膜',
      summary: `${area} m² · ${booths.value.length} 个展台 · 覆盖率 ${coverage.value}%`,
      issueCount: complianceIssues.value.length,
      imageDataUrl,
      fileName: `${(venueName.value || '场馆').replace(/[\\/:*?"<>|]/g, '_')}-平面图`,
    })
    toast('平面图 PDF 已生成')
  } catch {
    toast('PDF 生成失败，请稍后重试')
  }
}

async function downloadReportImage(layers?: ReportLayers) {
  if (!venue.value) {
    toast('请先绘制场馆')
    return
  }
  const dataUrl = await stage?.captureReportImage({
    title: venueName.value.trim() || '场馆白膜',
    subtitle: `${polygonArea(venue.value.points).toFixed(1)} m² · ${booths.value.length} 个展台 · ${infras.value.length} 个设施`,
    stats: [
      { label: '场馆面积', value: `${polygonArea(venue.value.points).toFixed(1)} m²` },
      { label: '展台覆盖率', value: `${coverage.value}%` },
      { label: '展台', value: `${booths.value.length}` },
    ],
    layers,
  })
  if (!dataUrl) {
    toast('平面图生成失败，请稍后重试')
    return
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  toast('平面图 PNG 已生成')
}

/** 弹窗里确认导出：按选中的图层生成，完成后关闭 */
async function runExport(kind: 'png' | 'pdf', layers: ReportLayers) {
  exportBusy.value = true
  try {
    if (kind === 'pdf') await downloadPlanPdf(layers)
    else await downloadReportImage(layers)
    showExportDialog.value = false
  } finally {
    exportBusy.value = false
  }
}

function triggerImport() {
  if (renderOnly.value) return
  importInput.value?.click()
}

// ---------- 纯渲染模式 ----------

function setRenderOnly(on: boolean) {
  renderOnly.value = on
  if (on) {
    if (mode.value !== 'idle') mode.value = 'idle'
    selectedIds.value = []
    clearInfraSelection()
    draftPoints.value = []
    if (walkState.value !== 'off') stage?.stopWalk()
  }
  stage?.setReadOnly(on || isMobile.value)
}

const selectedCount = computed(
  () => selectedIds.value.length + (selectedInfraId.value ? 1 : 0),
)

const selectedLabel = computed(() => {
  if (selectedIds.value.length === 1) {
    const b = booths.value.find((x) => x.id === selectedIds.value[0])
    if (b) return b.name
  }
  if (selectedInfraId.value) {
    const it = infras.value.find((x) => x.id === selectedInfraId.value)
    if (it) return it.name
  }
  return ''
})

/** 对外暴露的场景 API */
const gridMassingApi = {
  exportBooths: () => exportBoothList(booths.value),
  exportScene: () => buildSceneJson(),
  importScene: (input: string | SceneJson) =>
    typeof input === 'string' ? importSceneJson(input) : applySceneJson(input),
  setRenderMode: (on: boolean) => setRenderOnly(on),
}

// ---------- 底图 ----------

const {
  addUnderlay,
  toggleUnderlay,
  toggleUnderlayLock,
  setUnderlayOpacity,
  centerUnderlay,
  removeUnderlay,
  applyUnderlayChange,
} = useUnderlay({
  underlay,
  renderOnly,
  toast,
})

// ---------- 场景操作 ----------

function renameBooth(id: string, name: string) {
  const b = booths.value.find((x) => x.id === id)
  if (!b || b.name === name) return
  booths.value = booths.value.map((x) => (x.id === id ? { ...x, name } : x))
  toast(`已重命名为「${name}」`)
}

function setBoothExhibitor(id: string, value: string) {
  const b = booths.value.find((x) => x.id === id)
  if (!b) return
  const exhibitor = value.trim().slice(0, 60)
  if ((b.exhibitor ?? '') === exhibitor) return
  booths.value = booths.value.map((x) =>
    x.id === id ? { ...x, exhibitor: exhibitor || undefined } : x,
  )
  toast(exhibitor ? `展商名称：${exhibitor}` : '已清除展商名称')
}

function setBoothLogo(id: string, logo: string) {
  if (logo.length > 8_000_000) {
    toast('Logo 图片过大，请压缩后再试')
    return
  }
  booths.value = booths.value.map((b) => (b.id === id ? { ...b, logo } : b))
  toast('展台 Logo 已更新')
}

function removeBoothLogo(id: string) {
  booths.value = booths.value.map((b) => (b.id === id ? { ...b, logo: undefined } : b))
  toast('已移除展台 Logo')
}

// 移动端点击模型后自动弹出结构抽屉，并滚动到对应属性
watch([selectedIds, selectedInfraId], () => {
  if (!isMobile.value || renderOnly.value || walkState.value !== 'off') return
  mobilePanelOpen.value = selectedIds.value.length > 0 || !!selectedInfraId.value
})

function onDraftHeight(v: number) {
  draftHeight.value = clampHeight(v)
}

/** 载入内置示例：使用当前 IndexedDB 导出的 W1 场景 */
function loadSample() {
  if (renderOnly.value) return
  if (!applySceneJson(sampleSceneJson)) return

  selectedIds.value = []
  clearInfraSelection()
  mode.value = 'idle'
  draftPoints.value = []
  boothLabelsOn.value = false
  infraLabelsOn.value = false
  furnitureLabelsOn.value = false
  stage?.setLabelsVisible(false)
  toast(`W1 示例场景已载入 · ${booths.value.length} 个展台 / ${infras.value.length} 个设施`)
}

// ---------- 同步与生命周期 ----------

const { dispose: disposeStageSync } = useStageSync({
  venue,
  booths,
  infras,
  selectedIds,
  selectedInfraIds,
  draftPoints,
  draftHeight,
  mode,
  boothKind,
  walkState,
  walkPose,
  minimapExpanded,
  underlay,
  venueXray,
  gridWanted,
  gridOn,
  pendingInfraCopy,
  getPendingPreset: () => pendingPreset.value,
  getStage: () => stage,
  getPasteClipboard,
  applyVenueXray,
  applyLiveWeatherForVenue,
  clampHeight,
})

function toggleHelpShortcut() {
  toolMenu.value = null
  if (showWeather.value) closeWeather()
  showHelp.value = !showHelp.value
}

function closeHelpShortcut() {
  showHelp.value = false
}

function hasToolMenu() {
  return toolMenu.value !== null
}

function closeToolMenu() {
  toolMenu.value = null
}

function hasMergeDialog() {
  return mergeDialog.value !== null
}

function closeMergeDialog() {
  mergeDialog.value = null
}

type PendingConfirm = {
  kind: 'clear-data' | 'redraw-venue' | 'delete-booth' | 'cloud-logout'
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  /** 删除展台时携带目标 id */
  payload?: string
}
const pendingConfirm = ref<PendingConfirm | null>(null)

function requestClearData() {
  if (renderOnly.value) return
  toolMenu.value = null
  pendingConfirm.value = {
    kind: 'clear-data',
    title: '清空场景数据',
    message:
      '将清空场馆、展台、基础设施、家具和底图，并重置场馆名称。确定清空当前数据？',
    confirmLabel: '清空',
    danger: true,
  }
}

/** 退出云存储：确认后登出并清空当前场景，避免残留上一个账号的内容 */
function requestCloudLogout() {
  pendingConfirm.value = {
    kind: 'cloud-logout',
    title: '退出云存储',
    message:
      '退出登录会清空当前场景数据（场馆、展台、设施与底图），并删除浏览器的本地缓存。确定退出？',
    confirmLabel: '退出并清空',
    danger: true,
  }
}

function requestRedrawVenue() {
  if (renderOnly.value) return
  toolMenu.value = null
  if (!venue.value) {
    startVenueDraw()
    return
  }
  pendingConfirm.value = {
    kind: 'redraw-venue',
    title: '重绘场馆',
    message: '重绘会替换当前场馆轮廓，馆内展台不会自动删除。确定重新绘制？',
    confirmLabel: '重新绘制',
    danger: false,
  }
}

function closeConfirmDialog() {
  pendingConfirm.value = null
}

function confirmPendingAction() {
  const action = pendingConfirm.value
  pendingConfirm.value = null
  if (!action) return
  if (action.kind === 'cloud-logout') {
    cloud.logout()
    cloudScenePending.value = false
    deleteVenue()
    underlay.value = null
    venueName.value = '场馆白膜'
    showCloudDialog.value = false
    void clearStoredProject()
    toast('已退出云存储并清空当前场景')
    return
  }
  if (action.kind === 'redraw-venue') {
    startVenueDraw()
    return
  }
  if (action.kind === 'delete-booth') {
    if (action.payload) deleteBooth(action.payload)
    return
  }
  shareExisting.value = null
  deleteVenue()
  underlay.value = null
  venueName.value = '场馆白膜'
  resetProjectKey()
  toast('已清空场景数据')
}

/** 多人漫游在新页面运行；先落盘当前场景，避免跳转丢失最新编辑 */
async function openMultiplayer() {
  if (!venue.value) {
    toast('请先创建场馆')
    return
  }
  const snapshot = { version: 1, savedAt: Date.now(), scene: buildSceneJson() }
  try {
    // 云模式完全不用 IndexedDB，改为同一标签页的 sessionStorage 传递场景
    if (cloud.enabled) {
      sessionStorage.setItem('gms.multiplayer.scene', JSON.stringify(snapshot))
    } else {
      await saveStoredProject(snapshot)
    }
    await router.push({ name: 'multiplayer' })
  } catch (err) {
    console.error(err)
    toast('进入多人漫游失败：无法保存当前场景')
  }
}

const { onKey } = useEditorShortcuts({
  presentationOn,
  showHelp,
  showWeather,
  walkState,
  renderOnly,
  underlay,
  mode,
  isPlacing,
  selectedIds,
  selectedInfraId,
  toast,
  exitPresentation,
  closeWeather,
  openWeather,
  toggleHelp: toggleHelpShortcut,
  closeHelp: closeHelpShortcut,
  hasToolMenu,
  closeToolMenu,
  toggleWalk,
  toggleUnderlayLock,
  viewTop,
  viewIso,
  fitView,
  enterPresentation,
  hasMergeDialog,
  closeMergeDialog,
  cancelBoothPaste,
  cancelInfraPlacement: cancelPlacing,
  cancelDraft,
  backToDraw,
  confirmHeight,
  closeDraft,
  copySelectedBooths,
  copySelectedInfra: copyInfraOrSelection,
  undoPoint,
  undo,
  redo,
  deleteSelectedBooths,
  deleteSelectedFurniture,
  nudgeSelectedFurniture,
  toggleGrid,
  locateSelection: () => {
    void sceneTreeRef.value?.locateSelected()
  },
  openMultiplayer,
  saveProject: saveSceneManually,
})

onMounted(() => {
  if (!hostEl.value) return
  stage = new Stage(hostEl.value, {
    onPlace: handlePlace,
    onDrawRect: handleDrawRect,
    onUnderlayChange: applyUnderlayChange,
    onCloseDraft: closeDraft,
    onPick: handleStagePick,
    onHover: handleStageHover,
    onMoveBooth: moveBooth,
    onRotateBooth: rotateBooth,
    onRotateInfra: (id, dir) => rotateInfraOrSelection(id, dir),
    onRotateDrag: (deg) => (rotateDeg.value = deg),
    onSpaceNav: (on) => (spaceNavActive.value = on),
    onWalkView: (v) => (walkView.value = v),
    onWalkAuto: (on) => {
      walkAuto.value = on
      if (!on) {
        walkTourInfo.value = null
        walkUiHidden.value = false
      }
    },
    onWalkAutoFail: () =>
      toast('自动巡游：未找到可通行路线，请先在场馆内留出通道'),
    onWalkTourInfo: (info) => (walkTourInfo.value = info),
    onWalkUiHidden: (hidden) => (walkUiHidden.value = hidden),
    onWalkAutoSpeed: (v) => (walkAutoSpeed.value = Math.round(v * 10) / 10),
    onWalkAutoLoop: (v) => (walkAutoLoop.value = v),
    onWeatherShortcut: () => openWeather(),
    onHelp: () => openHelp(),
    onWalkState: (s) => {
      walkState.value = s
      if (s !== 'off') {
        mobilePanelOpen.value = false
        toolMenu.value = null
      }
      if (s === 'off') {
        walkAuto.value = false
        walkTourInfo.value = null
        walkUiHidden.value = false
        toolsCollapsed.value = false
        if (isMobile.value) void exitWalkFullscreen()
      }
      if (isMobile.value && s === 'walk') {
        toolsCollapsed.value = false
        if (isPortrait.value) showRotateHint.value = true
      }
    },
    onWalkInteract: (target) => (walkInteract.value = target),
    onMinimapHold: (on) => (minimapExpanded.value = on),
    onToggleGate: (id) => toggleGate(id),
    onPlaceInfra: (kind, spot) => handlePlaceInfra(kind, spot),
    onPlacePaste: (center) => placePastedBooths(center),
    onPlacePreset: (spot) => placePresetAt(spot),
    onMoveInfra: (id, x, z, rotation) => moveInfra(id, x, z, rotation),
    onMoveInfras: (targets) => moveInfraGroup(targets),
    onNorthAngle: (deg) => (northDeg.value = Math.round(deg * 10) / 10),
    onViewInfo: (info) => {
      viewCenter.value = { x: info.x, y: info.y, z: info.z }
      viewAzimuth.value = Math.round(info.azimuth * 10) / 10
    },
    onSunTime: (p) => (sunProgress.value = p),
    onQualityChange: (level, auto) => {
      quality.value = level
      if (auto) {
        toast(`帧率较低，已自动切换为${QUALITY_LABELS[level]}画质`)
      }
    },
  })
  stage.setMode('idle')
  stage.setSunSpeed(sunSpeed.value)
  // 与 UI 的播放状态保持一致（默认实时推进）
  stage.setSunPaused(!sunPlaying.value)
  stage.setWalkAutoSpeed(walkAutoSpeed.value)
  stage.setWalkAutoLoop(walkAutoLoop.value)
  stage.setSunProgress(sunProgress.value)
  stage.setWeather(weather.value)
  stage.setParticleDensities(particleDensities.value)
  stage.setWeatherVisibility(weatherVisibility.value / 100)
  stage.setGridVisible(gridOn.value)
  stage.setUnderlay(underlay.value)
  stage.setBoothLabelsVisible(boothLabelsOn.value)
  stage.setInfraLabelsVisible(infraLabelsOn.value)
  stage.setFurnitureLabelsVisible(furnitureLabelsOn.value)
  stage.setBoothAreasVisible(areaOn.value)
  stage.setAisleVisible(aisleOn.value)
  stage.setDimensionsVisible(dimOn.value)
  stage.setReadOnly(renderOnly.value || isMobile.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onOrientationChange)
  window.addEventListener('orientationchange', onOrientationChange)
  // 云存储模式先恢复登录状态，再决定从云端还是本地恢复场景
  void (async () => {
    await cloud.bootstrap()
    await restoreStoredProject()
    await restoreShareLink()
  })()

  // 演示 / 截图用：?sample=1 直接载入内置示例场景
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('sample') === '1') {
    setTimeout(() => {
      loadSample()
      setTimeout(() => fitView(), 400)
      setTimeout(() => fitView(), 1600)
    }, 600)
  }

  // 对外 API：导出展台 list / 场景，导入场景，切换纯渲染模式
  ;(window as unknown as { gridMassing?: typeof gridMassingApi }).gridMassing = gridMassingApi
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__stage = stage
    w.__app = {
      venue,
      venueName,
      booths,
      infras,
      selectedIds,
      selectedInfraId,
      mode,
      venueXray,
      venueNoTop,
      areaOn,
      sunProgress,
      sunSpeed,
      walkState,
      weather,
      weatherOn,
      underlay,
      quality,
    }
  }
})

function toggleWalkAuto() {
  stage?.toggleWalkAuto()
}

function changeWalkAutoSpeed(value: number) {
  const v = Math.min(2, Math.max(0.5, Math.round(value * 10) / 10))
  walkAutoSpeed.value = v
  stage?.setWalkAutoSpeed(v)
}

function changeWalkAutoLoop(value: boolean) {
  walkAutoLoop.value = value
  stage?.setWalkAutoLoop(value)
}

/** 时间轴推进倍率：1× 为实时，最高 100× */
const sunSpeed = ref(1)

/** 用户正在拖动时间轴：用于区分手动调整与自动推进，避免每格都触发保存 */
const sunScrubbing = ref(false)
let sunScrubTimer = 0

function handleSunScrub(ev: Event) {
  sunScrubbing.value = true
  window.clearTimeout(sunScrubTimer)
  sunScrubTimer = window.setTimeout(() => (sunScrubbing.value = false), 500)
  onSunScrub(ev)
}

function setSunSpeed(value: number) {
  sunSpeed.value = value
  stage?.setSunSpeed(value)
}

/** 时间轴刻度：点击直接跳到对应整点 */
function jumpSunHour(hour: number) {
  const progress = Math.min(1, Math.max(0, hour / 24))
  // 走过渡而不是瞬切，光照与天空会沿最短路径平滑过去
  stage?.transitionSunTo(progress, 760)
}

/** 状态栏坐标：优先显示选中对象在网格坐标系中的位置 */
const selectedPosition = computed<Pt | null>(() => {
  if (selectedInfraId.value) {
    const it = infras.value.find((x) => x.id === selectedInfraId.value)
    return it ? { x: it.x, z: it.z } : null
  }
  const ids = selectedIds.value
  if (!ids.length) return null
  const picked = booths.value.filter((b) => ids.includes(b.id) && b.points.length)
  if (!picked.length) return null
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const b of picked) {
    for (const p of b.points) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.z < minZ) minZ = p.z
      if (p.z > maxZ) maxZ = p.z
    }
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
})

/** 状态栏：画布中心世界坐标 + 相机方位角 */
const viewCenter = ref<{ x: number; y: number; z: number } | null>(null)
const viewAzimuth = ref(0)

function togglePresentation() {
  if (presentationOn.value) exitPresentation()
  else enterPresentation()
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onOrientationChange)
  window.removeEventListener('orientationchange', onOrientationChange)
  disposeEditorUi()
  disposeEditorState()
  disposeHistory()
  disposeScenePersistence()
  disposeStageSync()
  liveShare.dispose()
  const w = window as unknown as { gridMassing?: typeof gridMassingApi }
  if (w.gridMassing === gridMassingApi) delete w.gridMassing
  stage?.dispose()
  stage = null
})
</script>

<template>
  <div
    class="app wb"
    :class="{
      'quality-low': quality === 'low',
      'is-mobile': isMobile,
      mobile: isMobile,
      'is-walking': walkState !== 'off',
      'walk-ui-hidden': walkUiHidden,
      presenting: presentationOn,
      'render-only': renderOnly,
      }"
  >
  <div ref="hostEl" class="viewport">
    <CommentLayer
      :get-stage="() => stage"
      :comments="reviewComments"
      :booths="booths"
      :infras="infras"
      :active-id="selectedCommentId"
      :visible="!renderOnly && !isMobile && walkState === 'off' && !presentationOn && !showWelcome && canShareScene && mode === 'idle'"
      @select="selectReviewComment"
    />
  </div>

  <WalkMinimap
    v-if="walkState === 'walk' && !presentationOn"
    :venue="venue"
    :booths="booths"
    :infras="infras"
    :pose="walkPose"
    :mobile="isMobile"
    :expanded="minimapExpanded"
  />

    <Transition name="weather-fx">
      <div
        v-if="walkState === 'walk' && weather !== 'clear'"
        class="weather-fx"
        :class="[weather, walkView]"
        aria-hidden="true"
      >
        <div class="weather-atmos" />
        <div v-if="weatherLensOn" class="weather-lens" />
        <div v-if="weather === 'thunder'" class="weather-flash" />
      </div>
    </Transition>

    <AppTopBar
      v-if="!isMobile"
      :venue-name="venueName"
      :editing-venue-name="editingVenueName"
      :sim-time="simTime"
      :sun-is-day="sunIsDay"
      :live-weather="liveWeather"
      :weather-on="weatherOn"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :render-only="renderOnly"
      :has-venue="canShareScene"
      :presenting="presentationOn"
      :quality="quality"
      :quality-label="qualityLabel"
      :booth-labels-on="boothLabelsOn"
      :infra-labels-on="infraLabelsOn"
      :furniture-labels-on="furnitureLabelsOn"
      :dim-on="dimOn"
      :area-on="areaOn"
      :aisle-on="aisleOn"
      :grid-on="gridOn"
      :has-underlay="!!underlay"
      :underlay-visible="!!underlay?.visible"
      :weather-active="weatherOn && weather !== 'clear'"
      :walk-active="walkState !== 'off'"
      :tool-menu="toolMenu"
      :tool-sub-menu="toolSubMenu"
      :cloud-enabled="cloud.enabled"
      :review-unread="canShareScene ? reviewUnread : 0"
      :share-live="canShareScene && !!shareExisting?.liveMode"
      :share-viewers="canShareScene ? shareExisting?.viewerCount ?? 0 : 0"
      @update:venue-name="venueName = $event"
      @toggle-review="toggleReview"
      @open-share="openShareDialog"
      @begin-rename="beginVenueRename"
      @finish-rename="finishVenueRename"
      @cancel-rename="cancelVenueRename"
      @undo="undo"
      @redo="redo"
      @set-render="setRenderOnly"
      @report="openExportDialog"
      @export="downloadScene"
      @export-csv="downloadInventoryXlsx"
      @cloud-storage="openCloudDialog"
      @import="triggerImport"
      @clear-data="requestClearData"
      @open-weather="openWeather"
      @open-help="openHelp"
      @open-multiplayer="openMultiplayer"
      @toggle-walk="toggleWalk"
      @view-top="viewTop"
      @view-iso="viewIso"
      @fit-view="fitView"
      @presentation="togglePresentation"
      @choose-quality="chooseQuality"
      @toggle-menu="toggleToolMenu"
      @toggle-name-submenu="toggleNameSubmenu"
      @toggle-booth-labels="toggleBoothLabels"
      @toggle-infra-labels="toggleInfraLabels"
      @toggle-furniture-labels="toggleFurnitureLabels"
      @toggle-dimensions="toggleDimensions"
      @toggle-areas="toggleAreas"
      @toggle-aisle="toggleAisle"
      @toggle-grid="toggleGrid"
      @toggle-underlay="toggleUnderlay"
    />

    <SceneTree
      v-if="!isMobile"
      ref="sceneTreeRef"
      :venue="venue"
      :venue-name="venueName"
      :booths="booths"
      :infras="infras"
      :selected-ids="selectedIds"
      :selected-infra-id="selectedInfraId"
      :selected-infra-ids="selectedInfraIds"
      :presets="presets"
      :selected-preset-id="selectedPresetId"
      :venue-area="venueArea"
      :booth-area="boothsArea"
      :coverage="coverage"
      :render-only="renderOnly"
      @select="selectBoothFromPanel"
      @select-infra="selectInfraFromPanel"
      @select-venue="selectVenueNode"
      @draw-venue="startVenueDraw"
      @request-redraw="requestRedrawVenue"
      @draw-booth="startBoothDraw"
      @draw-booth-style="startBoothStyle"
      @add-infra="beginInfraPlace"
      @delete-booth="confirmDeleteBooth"
      @delete-infra="deleteInfra"
      @save-preset="savePresetFromSelection"
      @place-preset="selectPresetFromPanel"
      @delete-preset="deletePreset"
    />



    <input
      ref="importInput"
      type="file"
      accept="application/json,.json"
      class="hidden-file"
      @change="onImportFile"
    />

    <WalkOverlay
      :walk-state="walkState"
      :walk-view="walkView"
      :walk-interact="walkInteract"
      :is-mobile="isMobile"
      :space-nav-active="spaceNavActive"
      :show-rotate-hint="showRotateHint"
      :walk-auto="walkAuto"
      :walk-auto-speed="walkAutoSpeed"
      :walk-auto-loop="walkAutoLoop"
      :walk-tour-info="walkTourInfo"
      :walk-ui-hidden="walkUiHidden"
      :get-stage="() => stage"
      @toggle-auto="toggleWalkAuto"
      @update:speed="changeWalkAutoSpeed"
      @update:loop="changeWalkAutoLoop"
      @cancel-rotate="cancelRotateHint"
    />

    <div v-if="rotateDeg !== null" class="coord" :class="{ snap: rotateSnapped }">
      <div class="coord-item"><span>旋转</span><b>{{ rotateDisplay }}</b><i>°</i></div>
    </div>

    <aside v-if="!isMobile && !showWelcome" class="wb-right has-tabs">
      <div class="wb-right-tabs">
        <button
          type="button"
          :class="{ on: rightTab === 'props' }"
          @click="rightTab = 'props'"
        >
          属性
        </button>
        <button
          type="button"
          :class="{ on: rightTab === 'review' }"
          :disabled="!canShareScene"
          :title="canShareScene ? '评审评论' : '请先创建场馆'"
          @click="toggleReview"
        >
          评审
          <span v-if="reviewUnread" class="b">{{ reviewUnread > 99 ? '99+' : reviewUnread }}</span>
          <span v-if="reviewConnected" class="live-dot" />
        </button>
      </div>

      <ReviewPanel
        v-if="rightTab === 'review'"
        :comments="reviewComments"
        :selected-id="selectedCommentId"
        mode="owner"
        :logged-in="reviewLoggedIn"
        :auth-logged-in="reviewLoggedIn"
        :connected="reviewConnected"
        :loading="reviewLoading"
        :author-label="reviewAuthorName"
        :object-label="reviewObjectLabel"
        closable
        @select="selectReviewComment"
        @locate="locateReviewComment"
        @resolve="onReviewResolve"
        @reply="onReviewReply"
        @login="loginForShare"
        @register="loginForShare"
        @remove="removeReview"
        @refresh="refreshReview"
        @close="rightTab = 'props'"
      />

      <Inspector
        v-else
        :venue="venue"
      :venue-name="venueName"
      :booths="booths"
      :underlay="underlay"
      :mode="mode"
      :space-nav="spaceNavActive"
      :selected-ids="selectedIds"
      :venue-area="venueArea"
      :booth-area="boothsArea"
      :coverage="coverage"
      :skip-reveal-booth-id="skipRevealBoothId"
      :skip-reveal-infra-id="skipRevealInfraId"
      :focus-add-section="addFocusSection"
      :focus-add-token="addFocusToken"
      :rules="venueRules"
      :issues="complianceIssues"
      :preset="selectedPreset"
      :render-only="renderOnly"
      detail-only
      @rename-preset="renamePreset"
      @delete-preset="deletePreset"
      @place-preset="selectPresetFromPanel"
      @update-rule="setVenueRule"
      @array-booth="arrayBooth"
      @draw-venue="startVenueDraw"
      @draw-booth="startBoothDraw"
      @draw-booth-style="startBoothStyle"
      @underlay-file="addUnderlay"
      @center-underlay="centerUnderlay"
      @toggle-underlay-lock="toggleUnderlayLock"
      @remove-underlay="removeUnderlay"
      @underlay-opacity="setUnderlayOpacity"
      @booth-canopy="setBoothCanopy"
      @booth-top="setBoothNoTop"
      @delete-venue="deleteVenue"
      @delete-booth="deleteBooth"
      @select="selectBoothFromPanel"
      @venue-height="changeVenueHeight"
      @booth-height="changeBoothHeight"
      @booth-kind="changeBoothKind"
      @booth-style="changeBoothStyle"
      @booth-size="resizeBooth"
      @set-mark="setBoothMark"
      :xray="venueXray"
      :no-top="venueNoTop"
      @rename="renameBooth"
      @exhibitor="setBoothExhibitor"
      @logo="setBoothLogo"
      @remove-logo="removeBoothLogo"
      @logo-error="toast"
      @toggle-xray="toggleVenueXray"
      @toggle-top="toggleVenueTop"
      @rotate="rotateSelected"
      @merge="mergeSelected"
      @unmerge="unmergeSelected"
      :grouped="hasGroupInSelection"
      :single-group="selectionIsOneGroup"
      :infras="infras"
      :selected-infra-id="selectedInfraId"
      @add-infra="beginInfraPlace"
      @select-infra="selectInfraFromPanel"
      @clear-infra-selection="clearInfraSelection"
      @delete-infra="deleteInfra"
      @infra-size="updateInfraDims"
      @infra-material="updateInfraMaterial"
      @material-error="toast"
      @rotate-infra="rotateInfra"
      @toggle-gate="toggleGate"
      @gate-open-mode="setGateOpenMode"
      @infra-count="changeInfraCount"
      @rename-infra="renameInfra"
      />
    </aside>

    <div class="dock-wrap">
      <ActionDock
        v-if="!renderOnly && !isMobile && mode !== 'idle' && !isPlacing"
        :mode="mode"
        :points="draftPoints"
        :height="draftHeight"
        :area="draftArea"
        @undo="undoPoint"
        @cancel="cancelDraft"
        @close="closeDraft"
        @back="backToDraw"
        @confirm="confirmHeight"
        @height="onDraftHeight"
      />
    </div>

    <div v-if="appBooting" class="boot-mask" role="status" aria-live="polite">
      <div class="boot-card">
        <span class="boot-spinner" aria-hidden="true" />
        <div class="boot-copy">
          <b>正在加载场景</b>
          <span>正在读取本地保存的数据…</span>
        </div>
      </div>
    </div>

    <div
      v-if="showWelcome && !isMobile"
      class="welcome"
    >
      <h2>用面积图生成场馆白膜</h2>
      <p>在地面网格上依次点击顶点，或按住左键拖拽拉出矩形，输入高度即可生成白膜体量。</p>
      <ol class="steps">
        <li><i>1</i>绘制场馆轮廓（网格 1 格 = 1 米）</li>
        <li><i>2</i>输入净高，生成场馆白膜</li>
        <li><i>3</i>在馆内画出展台并设定高度</li>
      </ol>
      <div class="welcome-actions">
        <button class="btn primary" @click="startVenueDraw">开始绘制</button>
        <div class="welcome-sub">
          <button class="btn" @click="loadSample">载入示例</button>
          <button class="btn" @click="triggerImport">导入 JSON</button>
          <button v-if="cloud.enabled" class="btn" @click="openCloudDialog">
            {{ cloudWelcomeLabel }}
          </button>
          <button class="btn" @click="showHelp = true">帮助</button>
        </div>
      </div>
    </div>

    <div v-if="mergeDialog" class="modal-mask" @click.self="mergeDialog = null">
      <div class="modal">
        <h3>展台高度不一致</h3>
        <p>
          所选展台高度分别为
          {{ mergeDialog.heights.map((h) => h.toFixed(2) + ' m').join(' / ') }}。<br />
          可统一为「{{ mergeDialog.targetName }}」的 {{ mergeDialog.targetHeight.toFixed(2) }} m，也可以保留各自高度（模型仍会合并）。
        </p>
        <div class="modal-actions">
          <button class="btn ghost" @click="mergeDialog = null">取消</button>
          <button class="btn ghost" @click="applyMerge(false)">保留各自高度</button>
          <button class="btn primary" @click="applyMerge(true)">
            统一为 {{ mergeDialog.targetHeight.toFixed(2) }} m
          </button>
        </div>
      </div>
    </div>

    <Transition name="dialog">
      <ExportDialog
        v-if="showExportDialog"
        :busy="exportBusy"
        @cancel="showExportDialog = false"
        @export="runExport"
      />
    </Transition>

    <Transition name="dialog">
      <CloudStorageDialog
        v-if="showCloudDialog && cloud.enabled"
        :controller="cloud"
        :save-current="saveSceneToCloud"
        :load-slot="loadSceneFromCloud"
        :delete-slot="deleteSceneFromCloud"
        :pending-scene="cloudScenePending"
        @logout="requestCloudLogout"
        @notify="toast"
        @login-success="handleCloudLoginSuccess"
        @discard-scene="discardCloudScene"
        @close="showCloudDialog = false"
      />
    </Transition>

    <Transition name="dialog">
      <ConfirmDialog
        v-if="pendingConfirm"
        :title="pendingConfirm.title"
        :message="pendingConfirm.message"
        :confirm-label="pendingConfirm.confirmLabel"
        :danger="pendingConfirm.danger"
        @confirm="confirmPendingAction"
        @cancel="closeConfirmDialog"
      />
    </Transition>

    <Transition name="dialog">
      <ConfirmDialog
        v-if="cloudOverwrite"
        title="本地已有数据"
        :message="CLOUD_OVERWRITE_MESSAGE"
        confirm-label="覆盖并加载"
        cancel-label="保留本地"
        :danger="true"
        @confirm="confirmCloudOverwrite"
        @cancel="cancelCloudOverwrite"
      />
    </Transition>

    <ShareDialog
      :open="showShareDialog"
      :venue-name="venueName"
      :has-venue="canShareScene"
      :existing="shareExisting"
      :logged-in="reviewLoggedIn"
      :cloud-enabled="cloud.enabled"
      :busy="shareBusy"
      :error="shareError"
      @close="showShareDialog = false"
      @publish="publishShare"
      @update="updateShareSettings"
      @freeze="freezeShare"
      @revoke="revokeShare"
      @login="loginForShare"
    />

    <ToastHost scope="editor" kind="collab" placement="top-right" />
    <ToastHost scope="editor" kind="system" placement="top-center" />
    <ToastHost
      scope="editor"
      kind="action"
      placement="bottom-center"
      offset="calc(var(--wb-time, 44px) + var(--wb-status, 26px) + 14px)"
    />

    <Transition name="dialog">
      <WeatherPanel
        v-if="showWeather"
        :current="weather"
        :enabled="weatherOn"
        :densities="particleDensities"
        :visibility="weatherVisibility"
        :live-enabled="liveWeatherOn"
        @select="chooseWeather"
        @live-toggle="toggleLiveWeather"
        @density="setParticleDensity"
        @visibility="setWeatherVisibility"
        @preview-particle="previewParticleWeather"
        @toggle="toggleWeatherEnabled"
        @close="closeWeather()"
      />
    </Transition>

    <HelpMobilePanel
      v-if="showHelp && isMobile"
      :cloud-enabled="cloud.enabled"
      @close="showHelp = false"
    />
    <Transition name="dialog">
      <HelpPanel
        v-if="showHelp && !isMobile"
        :grid-on="gridOn"
        :labels-on="labelsOn"
        :areas-on="areaOn"
        :can-walk="!!venue && mode === 'idle'"
        :cloud-enabled="cloud.enabled"
        @quick="runHelpQuickAction"
        @close="showHelp = false"
      />
    </Transition>

    <SunTimeline
      v-if="!isMobile && !renderOnly"
      :sim-time="simTime"
      :sun-minutes="sunMinutes"
      :sun-percent="sunPercent"
      :sun-is-day="sunIsDay"
      :sun-playing="sunPlaying"
      :speed="sunSpeed"
      :weather="weather"
      :weather-on="weatherOn"
      :has-venue="!!venue"
      :presenting="presentationOn"
      @toggle-sun="toggleSunPlay"
      @reset-sun="resetSunToNow"
      @speed="setSunSpeed"
      @sun-scrub="handleSunScrub"
      @jump-hour="jumpSunHour"
      @open-weather="openWeather"
    />

    <StatusBar
      v-if="!isMobile && !renderOnly"
      :mode="mode"
      :object-count="booths.length + infras.length"
      :selected-count="selectedCount"
      :selected-label="selectedLabel"
      :hover="hover"
      :position="selectedPosition"
      :view-center="viewCenter"
      :view-azimuth="viewAzimuth"
      :grid-on="gridOn"
      :render-only="renderOnly"
      :walking="walkState !== 'off'"
      :space-nav="spaceNavActive"
      :save-state="saveState"
      :saved-at="savedAt"
      :storage-mode="cloudModeActive ? 'cloud' : 'local'"
      :cloud-hint="cloudBlockedHint"
    />

    <MobileViewer
      v-if="isMobile && walkState === 'off' && !presentationOn && !appBooting"
      :venue="venue"
      :venue-name="venueName"
      :booths="booths"
      :infras="infras"
      :underlay="underlay"
      :venue-area="venueArea"
      :booth-area="boothsArea"
      :coverage="coverage"
      :quality="quality"
      :quality-label="qualityLabel"
      :grid-on="gridOn"
      :dim-on="dimOn"
      :area-on="areaOn"
      :booth-labels-on="boothLabelsOn"
      :infra-labels-on="infraLabelsOn"
      :furniture-labels-on="furnitureLabelsOn"
      :weather="weather"
      :weather-on="weatherOn"
      :live-weather="liveWeather"
      :render-only="renderOnly"
      :can-walk="!!venue && mode === 'idle'"
      :selected-ids="selectedIds"
      :selected-infra-id="selectedInfraId"
      :cloud-enabled="cloud.enabled"
      @view-top="viewTop"
      @view-iso="viewIso"
      @fit-view="fitView"
      @toggle-grid="toggleGrid"
      @toggle-dimensions="toggleDimensions"
      @toggle-areas="toggleAreas"
      @toggle-booth-labels="toggleBoothLabels"
      @toggle-infra-labels="toggleInfraLabels"
      @toggle-furniture-labels="toggleFurnitureLabels"
      @toggle-underlay="toggleUnderlay"
      @choose-quality="chooseQuality"
      @select="selectBoothFromPanel"
      @select-infra="selectInfraFromPanel"
      @import="triggerImport"
      @export="downloadScene"
      @report="openExportDialog"
      @cloud-storage="openCloudDialog"
      @clear-data="requestClearData"
      @open-weather="openWeather"
      @open-help="openHelp"
      @open-multiplayer="openMultiplayer"
      @toggle-walk="toggleWalk"
    />

  </div>
</template>
