import { computed, ref, shallowRef } from 'vue'
import type { QualityLevel, WalkState, WalkView } from '../core/Stage'
import type { WalkTourInfo } from '../core/walkTour'
import { polygonArea } from '../core/polygon'
import type {
  Booth,
  BoothKind,
  EditorMode,
  Infra,
  Pt,
  Underlay,
  Venue,
} from '../core/types'

function currentSunProgress(): number {
  const now = new Date()
  const seconds =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  return seconds / 86400
}

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  ultra: '极致',
  high: '高',
  medium: '中',
  low: '低',
}

export function useEditorState() {
  const hostEl = ref<HTMLDivElement | null>(null)
  // 场景数据始终整体替换，不原地修改；shallowRef 避免为大量嵌套对象创建深度代理
  const venue = shallowRef<Venue | null>(null)
  const venueName = ref('场馆白膜')
  const editingVenueName = ref(false)
  const booths = shallowRef<Booth[]>([])
  const infras = shallowRef<Infra[]>([])
  const selectedInfraId = ref<string | null>(null)
  const selectedInfraIds = shallowRef<string[]>([])
  /** 刚新增的对象不自动滚动右侧面板，避免离开新增按钮 */
  const skipRevealBoothId = ref<string | null>(null)
  const skipRevealInfraId = ref<string | null>(null)
  const addFocusSection = ref<'booth' | 'infra' | 'furniture' | null>(null)
  const addFocusToken = ref(0)
  const mode = ref<EditorMode>('idle')
  const draftPoints = shallowRef<Pt[]>([])
  const draftHeight = ref(6)
  /** 正在绘制的展台类型 */
  const boothKind = ref<BoothKind>('massing')
  const selectedIds = shallowRef<string[]>([])
  const gridOn = ref(true)
  const dimOn = ref(false)
  const underlay = shallowRef<Underlay | null>(null)
  const northDeg = ref(0)
  const sunProgress = ref(currentSunProgress())
  const sunPlaying = ref(true)
  const quality = ref<QualityLevel>('high')
  const venueXray = ref(false)
  const boothLabelsOn = ref(true)
  const infraLabelsOn = ref(false)
  const areaOn = ref(false)
  const venueNoTop = ref(true)
  const toastMsg = ref('')
  const showHelp = ref(false)
  const showWeather = ref(false)
  const toolMenu = ref<'view' | 'display' | 'quality' | 'data' | null>(null)
  const toolSubMenu = ref<'names' | null>(null)
  const hover = ref<Pt | null>(null)
  const rotateDeg = ref<number | null>(null)
  const walkState = ref<WalkState>('off')
  const walkView = ref<WalkView>('first')
  const walkAuto = ref(false)
  const walkAutoSpeed = ref(0.8)
  const walkAutoLoop = ref(true)
  const walkTourInfo = ref<WalkTourInfo | null>(null)
  const walkUiHidden = ref(false)
  const presentationOn = ref(false)
  const walkPose = ref<{ x: number; z: number; yaw: number } | null>(null)
  const minimapExpanded = ref(false)
  const walkInteract = ref<{
    id: string
    name: string
    open: boolean
  } | null>(null)
  /** 按住空格：仅浏览视角，右侧状态同步显示 */
  const spaceNavActive = ref(false)
  const isMobile = ref(
    new URLSearchParams(window.location.search).get('mobile') === '1' ||
      (window.matchMedia('(pointer: coarse)').matches &&
        window.matchMedia('(max-width: 900px)').matches) ||
      /android|iphone|ipad|mobile/i.test(navigator.userAgent),
  )
  const mobilePanelOpen = ref(false)
  const toolsCollapsed = ref(false)
  const isPortrait = ref(window.innerHeight > window.innerWidth)
  const showRotateHint = ref(false)
  const renderOnly = ref(
    new URLSearchParams(window.location.search).get('render') === '1',
  )
  /** 初次加载：查询 / 恢复 IndexedDB 期间隐藏欢迎弹窗与编辑面板 */
  const appBooting = ref(true)
  const dockExpanded = ref(false)

  let toastTimer = 0

  const qualityLabel = computed(() => QUALITY_LABELS[quality.value])
  const simTime = computed(() => {
    const total = Math.floor(sunProgress.value * 1440) % 1440
    const h = String(Math.floor(total / 60)).padStart(2, '0')
    const m = String(total % 60).padStart(2, '0')
    return `${h}:${m}`
  })
  const sunMinutes = computed(
    () => Math.floor(sunProgress.value * 1440) % 1440,
  )
  const sunPercent = computed(
    () => `${((sunProgress.value % 1) * 100).toFixed(2)}%`,
  )
  const sunIsDay = computed(
    () => Math.sin((sunProgress.value - 0.25) * Math.PI * 2) > 0,
  )
  const labelsOn = computed(
    () => boothLabelsOn.value && infraLabelsOn.value,
  )
  const mobileDocked = computed(
    () =>
      isMobile.value &&
      isPortrait.value &&
      walkState.value === 'off' &&
      !renderOnly.value,
  )
  const venueArea = computed(() =>
    venue.value ? polygonArea(venue.value.points) : 0,
  )
  const boothsArea = computed(() =>
    booths.value.reduce((sum, b) => sum + polygonArea(b.points), 0),
  )
  const coverage = computed(() =>
    venueArea.value
      ? Math.round((boothsArea.value / venueArea.value) * 100)
      : 0,
  )
  const showWelcome = computed(
    () =>
      !appBooting.value &&
      !venue.value &&
      mode.value === 'idle' &&
      !renderOnly.value,
  )
  const draftArea = computed(() =>
    draftPoints.value.length >= 3
      ? polygonArea(draftPoints.value)
      : 0,
  )
  const isDrawing = computed(
    () => mode.value === 'draw-venue' || mode.value === 'draw-booth',
  )
  const isPlacing = computed(
    () =>
      mode.value.startsWith('place-') || mode.value === 'paste-booths',
  )
  const rotateDisplay = computed(() => {
    if (rotateDeg.value === null) return ''
    const d = ((rotateDeg.value % 360) + 360) % 360
    return String(Math.round(d) % 360)
  })
  const rotateSnapped = computed(() => {
    if (rotateDeg.value === null) return false
    const r = ((rotateDeg.value % 90) + 90) % 90
    return r < 0.01 || r > 89.99
  })
  /** 网格只在绘制/定高时出现；浏览已完成场景时隐藏，保持画面干净 */
  const gridWanted = computed(
    () => mode.value !== 'idle' || !venue.value,
  )
  const segmentLength = computed(() => {
    const pts = draftPoints.value
    if (!hover.value || !pts.length) return 0
    const last = pts[pts.length - 1]
    return Math.hypot(hover.value.x - last.x, hover.value.z - last.z)
  })

  function focusAdd(section: 'booth' | 'infra' | 'furniture') {
    addFocusSection.value = section
    addFocusToken.value++
  }

  function toast(text: string) {
    toastMsg.value = text
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => (toastMsg.value = ''), 2800)
  }

  /** 只有绘制时才需要坐标提示，避免浏览 / 拖拽时每个 pointermove 都触发渲染 */
  function handleStageHover(p: Pt | null) {
    if (!isDrawing.value) return
    if (!p) {
      if (hover.value) hover.value = null
      return
    }
    const prev = hover.value
    if (prev && prev.x === p.x && prev.z === p.z) return
    hover.value = p
  }

  function dispose() {
    window.clearTimeout(toastTimer)
  }

  return {
    hostEl,
    venue,
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
    areaOn,
    venueNoTop,
    toastMsg,
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
    isDrawing,
    isPlacing,
    rotateDisplay,
    rotateSnapped,
    gridWanted,
    segmentLength,
    focusAdd,
    toast,
    handleStageHover,
    dispose,
  }
}
