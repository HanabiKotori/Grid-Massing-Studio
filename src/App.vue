<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ActionDock from './components/ActionDock.vue'
import HelpMobilePanel from './components/HelpMobilePanel.vue'
import HelpPanel from './components/HelpPanel.vue'
import Inspector from './components/Inspector.vue'
import WalkMinimap from './components/WalkMinimap.vue'
import WeatherIcon from './components/WeatherIcon.vue'
import WeatherPanel from './components/WeatherPanel.vue'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import {
  boundsOf,
  centroid,
  insetPolygon,
  isSimplePolygon,
  pointInPolygon,
  polygonArea,
  polygonInsidePolygon,
} from './core/polygon'
import {
  BOOTH_DEFAULT_HEIGHT,
  OPEN_FLOOR_HEIGHT,
  boothKindOf,
} from './core/booth'
import {
  ELEVATOR_COUNT,
  ELEVATOR_DEFAULT_COUNT,
  INFRA_DEFAULTS,
  INFRA_LABELS,
  WINDOW_SILL,
  clampInfraDims,
  isFurnitureKind,
  type InfraDims,
} from './core/infra'
import {
  DEFAULT_WEATHER_CITY,
  fetchAmapWeather,
  type LiveWeather,
} from './core/amapWeather'
import { Stage, type QualityLevel, type WalkState, type WalkView } from './core/Stage'
import { loadStoredProject, saveStoredProject } from './core/projectStore'
import sampleSceneJson from './data/sample-scene.json'
import {
  DEFAULT_PARTICLE_DENSITIES,
  WEATHER_LABELS,
  type ParticleDensities,
  type WeatherKind,
} from './core/weather'
import type {
  Booth,
  BoothKind,
  BoothMark,
  EditorMode,
  Infra,
  InfraKind,
  Pt,
  Venue,
} from './core/types'

const hostEl = ref<HTMLDivElement | null>(null)
const venue = ref<Venue | null>(null)
const venueName = ref('场馆白膜')
const editingVenueName = ref(false)
const venueNameInput = ref<HTMLInputElement | null>(null)
const booths = ref<Booth[]>([])
const infras = ref<Infra[]>([])
const selectedInfraId = ref<string | null>(null)
const selectedInfraIds = ref<string[]>([])
const mode = ref<EditorMode>('idle')
const draftPoints = ref<Pt[]>([])
const draftHeight = ref(6)
/** 正在绘制的展台类型 */
const boothKind = ref<BoothKind>('massing')
const selectedIds = ref<string[]>([])
interface BoothPasteClipboard {
  booths: Booth[]
  infras: Infra[]
  center: Pt
}
let pasteClipboard: BoothPasteClipboard | null = null
let pendingInfraCopy: Infra | null = null
const gridOn = ref(true)
const dimOn = ref(false)
const northDeg = ref(0)
/** 当前本地时间在一天中的比例 */
function currentSunProgress(): number {
  const now = new Date()
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  return seconds / 86400
}

const sunProgress = ref(currentSunProgress())
const sunPlaying = ref(true)
const quality = ref<QualityLevel>('high')
const QUALITY_LABELS: Record<QualityLevel, string> = {
  ultra: '极致',
  high: '高',
  medium: '中',
  low: '低',
}
const QUALITY_OPTIONS: { value: QualityLevel; label: string }[] = [
  { value: 'ultra', label: '极致' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]
const qualityLabel = computed(() => QUALITY_LABELS[quality.value])
const simTime = computed(() => {
  const total = Math.floor(sunProgress.value * 1440) % 1440
  const h = String(Math.floor(total / 60)).padStart(2, '0')
  const m = String(total % 60).padStart(2, '0')
  return `${h}:${m}`
})
const sunMinutes = computed(() => Math.floor(sunProgress.value * 1440) % 1440)
const sunPercent = computed(() => `${((sunProgress.value % 1) * 100).toFixed(2)}%`)
const sunIsDay = computed(
  () => Math.sin((sunProgress.value - 0.25) * Math.PI * 2) > 0,
)
const venueXray = ref(false)
const boothLabelsOn = ref(true)
const infraLabelsOn = ref(false)
const labelsOn = computed(() => boothLabelsOn.value && infraLabelsOn.value)
const areaOn = ref(false)
const venueNoTop = ref(true)
const toastMsg = ref('')
const showHelp = ref(false)
const showWeather = ref(false)
type ToolMenu = 'view' | 'display' | 'quality' | 'data'
const toolMenu = ref<ToolMenu | null>(null)
const toolSubMenu = ref<'names' | null>(null)
const weather = ref<WeatherKind>('clear')
const weatherOn = ref(true)
const liveWeatherOn = ref(false)
const liveWeather = ref<LiveWeather | null>(null)
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

function loadParticleDensities(): ParticleDensities {
  try {
    const raw = localStorage.getItem('grid-weather-density')
    if (!raw) return { ...DEFAULT_PARTICLE_DENSITIES }
    const parsed = JSON.parse(raw) as Partial<ParticleDensities>
    const clamp = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
    return { rain: clamp(parsed.rain), snow: clamp(parsed.snow), dust: clamp(parsed.dust) }
  } catch {
    return { ...DEFAULT_PARTICLE_DENSITIES }
  }
}

const particleDensities = ref<ParticleDensities>(loadParticleDensities())

function setParticleDensity(kind: keyof ParticleDensities, percent: number) {
  const value = Math.max(0, Math.min(1, percent / 100))
  particleDensities.value = { ...particleDensities.value, [kind]: value }
  stage?.setParticleDensities(particleDensities.value)
  localStorage.setItem('grid-weather-density', JSON.stringify(particleDensities.value))
}

function loadWeatherVisibility(): number {
  const raw = localStorage.getItem('grid-weather-visibility')
  if (raw === null) return 100
  const stored = Number(raw)
  return Number.isFinite(stored) ? Math.max(0, Math.min(200, stored)) : 100
}

const weatherVisibility = ref(loadWeatherVisibility())

function setWeatherVisibility(percent: number) {
  const value = Math.max(0, Math.min(200, percent))
  weatherVisibility.value = value
  stage?.setWeatherVisibility(value / 100)
  localStorage.setItem('grid-weather-visibility', String(value))
}

/** 当前天气没有对应粒子时，用最轻的同类天气即时预览滑块效果 */
function previewParticleWeather(kind: keyof ParticleDensities) {
  const preview: Record<keyof ParticleDensities, WeatherKind> = {
    rain: 'light-rain',
    snow: 'light-snow',
    dust: 'dust',
  }
  weatherOn.value = true
  weather.value = preview[kind]
  stage?.setWeather(weather.value)
}
const hover = ref<Pt | null>(null)
const rotateDeg = ref<number | null>(null)
const walkState = ref<WalkState>('off')
const walkView = ref<WalkView>('first')
const presentationOn = ref(false)
const walkPose = ref<{ x: number; z: number; yaw: number } | null>(null)
const minimapExpanded = ref(false)
let walkPoseTimer = 0
const weatherLensOn = computed(
  () =>
    walkState.value === 'walk' &&
    walkView.value === 'first' &&
    !venue.value?.ceiling &&
    LENS_WEATHER.has(weather.value),
)
const walkInteract = ref<{ id: string; name: string; open: boolean } | null>(null)
/** 按住空格：仅浏览视角，右侧状态同步显示 */
const spaceNavActive = ref(false)
const isMobile = ref(
  new URLSearchParams(window.location.search).get('mobile') === '1' ||
    (window.matchMedia('(pointer: coarse)').matches &&
      window.matchMedia('(max-width: 900px)').matches) ||
    /android|iphone|ipad|mobile/i.test(navigator.userAgent),
)
const moveStickEl = ref<HTMLElement | null>(null)
const moveKnob = reactive({ x: 0, y: 0 })
const moveBoost = ref(0)
const lookKnob = reactive({ x: 0, y: 0 })
const mobilePanelOpen = ref(false)
const toolsCollapsed = ref(false)
const isPortrait = ref(window.innerHeight > window.innerWidth)
const showRotateHint = ref(false)
let rotatePending = false
let movePointerId: number | null = null
let lookPointerId: number | null = null
let lookLastX = 0
let lookLastY = 0
const renderOnly = ref(new URLSearchParams(window.location.search).get('render') === '1')
const importInput = ref<HTMLInputElement | null>(null)
const dockExpanded = ref(false)
const mobileDocked = computed(
  () =>
    isMobile.value &&
    isPortrait.value &&
    walkState.value === 'off' &&
    !renderOnly.value,
)
watch(mobileDocked, (on) => {
  if (!on) dockExpanded.value = false
})

interface SceneJson {
  version?: number
  venueName?: string
  weather?: WeatherKind
  weatherOn?: boolean
  sunProgress?: number
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
}

let stage: Stage | null = null
let toastTimer = 0
let seq = 0
let infraSeq = 0
let autosaveTimer = 0
let autosaveReady = false
let restoringProject = false
let importedDuringRestore = false
let suppressAutoWeather = false

const venueArea = computed(() => (venue.value ? polygonArea(venue.value.points) : 0))
const boothsArea = computed(() => booths.value.reduce((sum, b) => sum + polygonArea(b.points), 0))
const coverage = computed(() =>
  venueArea.value ? Math.round((boothsArea.value / venueArea.value) * 100) : 0,
)
const showWelcome = computed(
  () => !venue.value && mode.value === 'idle' && !renderOnly.value,
)
const draftArea = computed(() => (draftPoints.value.length >= 3 ? polygonArea(draftPoints.value) : 0))
const isDrawing = computed(() => mode.value === 'draw-venue' || mode.value === 'draw-booth')
const isPlacing = computed(
  () => mode.value.startsWith('place-') || mode.value === 'paste-booths',
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
const gridWanted = computed(() => mode.value !== 'idle' || !venue.value || venueXray.value)
const segmentLength = computed(() => {
  const pts = draftPoints.value
  if (!hover.value || !pts.length) return 0
  const last = pts[pts.length - 1]
  return Math.hypot(hover.value.x - last.x, hover.value.z - last.z)
})

function toast(text: string) {
  toastMsg.value = text
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toastMsg.value = ''), 2800)
}

function beginVenueRename() {
  editingVenueName.value = true
  nextTick(() => {
    venueNameInput.value?.focus()
    venueNameInput.value?.select()
  })
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

async function saveProjectNow() {
  if (renderOnly.value) return
  try {
    await saveStoredProject({
      version: 1,
      savedAt: Date.now(),
      scene: buildSceneJson(),
    })
  } catch (err) {
    console.warn('自动保存失败', err)
  }
}

function scheduleAutosave() {
  if (!autosaveReady || restoringProject || renderOnly.value) return
  window.clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => void saveProjectNow(), 500)
}

async function restoreStoredProject() {
  if (renderOnly.value) {
    autosaveReady = true
    return
  }
  try {
    const saved = await loadStoredProject()
    if (!saved || importedDuringRestore) {
      autosaveReady = true
      return
    }
    restoringProject = true
    const restored = applySceneJson(saved.scene)
    restoringProject = false
    autosaveReady = true
    if (restored) toast('已恢复上次自动保存的场景')
  } catch (err) {
    autosaveReady = true
    console.warn('读取自动保存失败', err)
  }
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

// ---------- 绘制流程 ----------

function startVenueDraw() {
  mode.value = 'draw-venue'
  draftPoints.value = []
  selectedIds.value = []
  stage?.viewTop()
}

function startBoothDraw(kind: BoothKind = 'massing') {
  if (!venue.value) {
    toast('请先绘制场馆')
    return
  }
  boothKind.value = kind
  mode.value = 'draw-booth'
  draftPoints.value = []
  selectedIds.value = []
  stage?.viewTop()
  if (kind === 'openfloor') toast('光地展台无需设置高度，闭合轮廓后直接生成')
}

function handlePlace(p: Pt) {
  const m = mode.value
  if (m !== 'draw-venue' && m !== 'draw-booth') return

  const pts = draftPoints.value

  // 点到起点附近 => 闭合（阈值须小于 1 格，否则 1×1 这类小展台会被提前闭合）
  if (pts.length >= 3) {
    const first = pts[0]
    if (Math.hypot(p.x - first.x, p.z - first.z) < 0.5) {
      closeDraft()
      return
    }
  }

  if (pts.length) {
    const last = pts[pts.length - 1]
    if (Math.hypot(p.x - last.x, p.z - last.z) < 0.01) return
  }

  if (m === 'draw-booth' && !insideVenueArea(p)) {
    toast('展台需绘制在场馆内部')
    return
  }

  draftPoints.value = [...pts, p]
}

function undoPoint() {
  draftPoints.value = draftPoints.value.slice(0, -1)
}

function cancelDraft() {
  mode.value = 'idle'
  draftPoints.value = []
}

function closeDraft() {
  const m = mode.value
  if (m !== 'draw-venue' && m !== 'draw-booth') return
  const pts = draftPoints.value

  if (pts.length < 3) {
    toast('至少需要 3 个顶点才能围成面积')
    return
  }
  if (!isSimplePolygon(pts)) {
    toast('轮廓存在自相交，请撤销后调整顶点')
    return
  }
  const area = polygonArea(pts)
  if (m === 'draw-booth' && area < 3) {
    toast('展台面积不能小于 3 m²（约 3 × 1m）')
    return
  }
  if (m === 'draw-venue' && area < 1) {
    toast('面积过小，请重新绘制')
    return
  }

  if (m === 'draw-booth') {
    const inner = venueInner()
    if (!inner || !polygonInsidePolygon(pts, inner)) {
      toast('展台轮廓需完全位于场馆内部')
      return
    }
    const clash = booths.value.find((b) => overlaps(pts, b.points))
    if (clash) {
      toast(`与「${clash.name}」重叠，请调整轮廓`)
      return
    }
    if (boothKind.value === 'openfloor') {
      addBooth(pts, OPEN_FLOOR_HEIGHT, 'openfloor')
      return
    }
    draftHeight.value = BOOTH_DEFAULT_HEIGHT[boothKind.value]
    mode.value = 'height-booth'
  } else {
    draftHeight.value = venue.value ? venue.value.height : 6
    mode.value = 'height-venue'
  }
  nextTick(() => {
    if (m === 'draw-booth' && venue.value) stage?.fit(venue.value.points, venue.value.height)
    else stage?.fit(pts, draftHeight.value)
  })
}

function backToDraw() {
  if (mode.value === 'height-venue') mode.value = 'draw-venue'
  else if (mode.value === 'height-booth') mode.value = 'draw-booth'
  stage?.viewTop()
}

/** 生成展台：标准 / 脚手架走定高流程，光地直接按平台高度落位 */
function addBooth(points: Pt[], height: number, kind: BoothKind) {
  seq += 1
  const booth: Booth = {
    id: `b${Date.now().toString(36)}-${seq}`,
    name: `展台 ${String(seq).padStart(2, '0')}`,
    points: points.map((p) => ({ ...p })),
    height,
    ...(kind === 'massing' ? {} : { kind }),
    ...(kind === 'scaffold' ? { canopy: true } : {}),
  }
  booths.value = [...booths.value, booth]
  selectedIds.value = [booth.id]
  mode.value = 'idle'
  draftPoints.value = []
  const kindLabel = kind === 'scaffold' ? '脚手架' : kind === 'openfloor' ? '光地' : '标准'
  toast(`${booth.name} 已生成 · ${kindLabel} · ${polygonArea(booth.points).toFixed(1)} m²`)
  // 用较高的俯角回看，保证馆内的展台不会被外墙挡住
  if (venue.value) stage?.fit(venue.value.points, venue.value.height, 2.6)
}

function copySelectedBooths() {
  if (renderOnly.value || mode.value !== 'idle') return
  pendingInfraCopy = null
  const sourceBooths = booths.value.filter((b) => selectedIds.value.includes(b.id))
  if (!sourceBooths.length) {
    toast('请先选中要复制的展台')
    return
  }

  // 家具和落地设施跟随展台一起复制；门窗依附场馆墙，不纳入复制
  const sourceInfras = infras.value.filter(
    (it) =>
      it.kind !== 'gate' &&
      it.kind !== 'window' &&
      sourceBooths.some((booth) => pointInPolygon(it, booth.points)),
  )
  const allPoints = sourceBooths.flatMap((booth) => booth.points)
  const bnd = boundsOf(allPoints)
  const center = {
    x: (bnd.minX + bnd.maxX) / 2,
    z: (bnd.minZ + bnd.maxZ) / 2,
  }
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  pasteClipboard = {
    booths: clone(sourceBooths),
    infras: clone(sourceInfras),
    center,
  }
  selectedIds.value = []
  clearInfraSelection()
  mode.value = 'paste-booths'
  toast(
    `已复制 ${sourceBooths.length} 个展台${sourceInfras.length ? ` / ${sourceInfras.length} 个设施` : ''} · 点击放置，Esc 取消`,
  )
}

function copySelectedInfra() {
  if (renderOnly.value || mode.value !== 'idle') return
  const target = infras.value.find((it) => it.id === selectedInfraId.value)
  if (!target) return
  pendingInfraCopy = JSON.parse(JSON.stringify(target)) as Infra
  pasteClipboard = null
  clearInfraSelection()
  selectedIds.value = []
  mode.value = PLACE_MODE[target.kind]
  toast(`已复制 ${target.name} · 点击放置，Esc 取消`)
}

function cancelBoothPaste() {
  pasteClipboard = null
  selectedIds.value = []
  mode.value = 'idle'
  toast('已取消复制')
}

/** 复制组点击落位；坐标是新组中心 */
function placePastedBooths(target: Pt) {
  const clip = pasteClipboard
  if (!clip) return
  const dx = target.x - clip.center.x
  const dz = target.z - clip.center.z
  const inner = venueInner()
  const movedBooths = clip.booths.map((booth) => ({
    ...booth,
    points: booth.points.map((p) => ({ x: p.x + dx, z: p.z + dz })),
  }))

  for (const booth of movedBooths) {
    if (inner && !polygonInsidePolygon(booth.points, inner)) {
      toast('复制后的展台需完全位于场馆内部')
      return
    }
  }
  const clash = movedBooths.find((booth) =>
    booths.value.some((existing) => overlaps(booth.points, existing.points)),
  )
  if (clash) {
    toast(`复制位置与「${clash.name}」重叠，请换个位置`)
    return
  }

  const groupMap = new Map<string, string>()
  const nextBooths = movedBooths.map((booth) => {
    seq += 1
    const groupId = booth.groupId
      ? groupMap.get(booth.groupId) ??
        (() => {
          const id = nextGroupId()
          groupMap.set(booth.groupId!, id)
          return id
        })()
      : undefined
    return {
      ...booth,
      id: `b${Date.now().toString(36)}-${seq}`,
      ...(groupId ? { groupId } : { groupId: undefined }),
    }
  })
  const nextInfras = clip.infras.map((it) => {
    infraSeq += 1
    return {
      ...it,
      id: `inf${Date.now().toString(36)}-${infraSeq}`,
      x: it.x + dx,
      z: it.z + dz,
    }
  })

  booths.value = [...booths.value, ...nextBooths]
  infras.value = [...infras.value, ...nextInfras]
  selectedIds.value = nextBooths.map((booth) => booth.id)
  clearInfraSelection()
  pasteClipboard = null
  mode.value = 'idle'
  toast(
    `已复制 ${nextBooths.length} 个展台${nextInfras.length ? ` / ${nextInfras.length} 个设施` : ''}`,
  )
}

function confirmHeight() {
  const m = mode.value
  const pts = draftPoints.value
  if (pts.length < 3) return
  const h = clampHeight(draftHeight.value)

  if (m === 'height-venue') {
    const next: Venue = { points: pts.map((p) => ({ ...p })), height: h, ceiling: !venueNoTop.value }
    const hadVenue = !!venue.value
    venue.value = next
    if (hadVenue) void applyLiveWeatherForVenue()

    const inner = insetPolygon(next.points, 0.4) ?? next.points
    const kept = booths.value.filter((b) => polygonInsidePolygon(b.points, inner))
    const dropped = booths.value.length - kept.length
    booths.value = kept
    selectedIds.value = selectedIds.value.filter((id) => kept.some((b) => b.id === id))

    // 出入口与窗户依附旧墙体，重绘场馆后需要重新放置
    infras.value = infras.value.filter(
      (it) => it.kind !== 'gate' && it.kind !== 'window',
    )
    cleanupFurniture()
    clearInfraSelection()

    mode.value = 'idle'
    draftPoints.value = []
    stage?.fit(next.points, h)
    toast(
      dropped > 0
        ? `场馆已更新，${dropped} 个展台超出范围被移除`
        : `场馆白膜已生成 · ${polygonArea(next.points).toFixed(1)} m²`,
    )
    return
  }

  if (m === 'height-booth') {
    addBooth(pts, h, boothKind.value)
  }
}

// ---------- 基础设施 ----------

const PLACE_MODE: Record<InfraKind, EditorMode> = {
  stairs: 'place-stairs',
  restroom: 'place-restroom',
  gate: 'place-gate',
  window: 'place-window',
  elevator: 'place-elevator',
  wall: 'place-wall',
  chair: 'place-chair',
  armchair: 'place-armchair',
  sofa: 'place-sofa',
  'table-round': 'place-table-round',
  'table-square': 'place-table-square',
}

function kindOfPlaceMode(m: EditorMode): InfraKind | null {
  if (m === 'place-stairs') return 'stairs'
  if (m === 'place-restroom') return 'restroom'
  if (m === 'place-gate') return 'gate'
  if (m === 'place-window') return 'window'
  if (m === 'place-elevator') return 'elevator'
  if (m === 'place-wall') return 'wall'
  if (m === 'place-chair') return 'chair'
  if (m === 'place-armchair') return 'armchair'
  if (m === 'place-sofa') return 'sofa'
  if (m === 'place-table-round') return 'table-round'
  if (m === 'place-table-square') return 'table-square'
  return null
}

function beginInfraPlace(kind: InfraKind) {
  pendingInfraCopy = null
  if ((kind === 'gate' || kind === 'window') && !venue.value) {
    toast('请先绘制场馆')
    return
  }
  if (isFurnitureKind(kind) && !booths.value.length) {
    toast('请先绘制展台，家具只能放在展台内部')
    return
  }
  if (mode.value !== 'idle') return
  selectedIds.value = []
  clearInfraSelection()
  draftPoints.value = []
  mode.value = PLACE_MODE[kind]
  toast(
    kind === 'gate'
      ? '移动到场馆墙体或墙面上，点击放置出入口'
      : kind === 'window'
        ? '移动到场馆外墙上，点击放置窗户'
        : isFurnitureKind(kind)
          ? `点击展台内部放置${INFRA_LABELS[kind]} · 右键旋转 90°`
          : `点击地面放置${INFRA_LABELS[kind]} · 右键旋转 90°`,
  )
}

function nextInfraName(kind: InfraKind): string {
  const n = infras.value.filter((it) => it.kind === kind).length + 1
  return `${INFRA_LABELS[kind]} ${String(n).padStart(2, '0')}`
}

/** 旋转后的矩形角点（Three 的 Y 轴旋转约定） */
function infraCorners(
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation: number,
): Pt[] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const hw = width / 2
  const hd = depth / 2
  return [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ].map((c) => ({ x: x + c.x * cos + c.z * sin, z: z - c.x * sin + c.z * cos }))
}

/** 两个旋转矩形是否相交（分离轴定理） */
function obbOverlap(
  ax: number,
  az: number,
  aw: number,
  ad: number,
  arot: number,
  bx: number,
  bz: number,
  bw: number,
  bd: number,
  brot: number,
): boolean {
  const axes = [
    { x: Math.cos(arot), z: -Math.sin(arot) },
    { x: Math.sin(arot), z: Math.cos(arot) },
    { x: Math.cos(brot), z: -Math.sin(brot) },
    { x: Math.sin(brot), z: Math.cos(brot) },
  ]
  const dx = bx - ax
  const dz = bz - az

  for (const axis of axes) {
    const ra =
      Math.abs(axis.x * Math.cos(arot) - axis.z * Math.sin(arot)) * (aw / 2) +
      Math.abs(axis.x * Math.sin(arot) + axis.z * Math.cos(arot)) * (ad / 2)
    const rb =
      Math.abs(axis.x * Math.cos(brot) - axis.z * Math.sin(brot)) * (bw / 2) +
      Math.abs(axis.x * Math.sin(brot) + axis.z * Math.cos(brot)) * (bd / 2)
    if (Math.abs(axis.x * dx + axis.z * dz) > ra + rb - 0.02) return false
  }
  return true
}

/** 点所在的展台 */
function boothAtPoint(p: Pt): Booth | null {
  for (const b of booths.value) {
    if (b.points.length >= 3 && pointInPolygon(p, b.points)) return b
  }
  return null
}

/** 家具是否完整落在指定轮廓内（中心与四个角点都需在馆内） */
function furnitureInsidePolygon(
  points: Pt[],
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation: number,
): boolean {
  const samples = [{ x, z }, ...infraCorners(x, z, width, depth, rotation)]
  return samples.every((p) => pointInPolygon(p, points))
}

/** 家具是否完整落在同一个展台内部 */
function furnitureInsideBooth(
  kind: InfraKind,
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation: number,
): boolean {
  if (!isFurnitureKind(kind)) return true
  const host = boothAtPoint({ x, z })
  return host ? furnitureInsidePolygon(host.points, x, z, width, depth, rotation) : false
}

/** 判断两个贴墙设施是否在同一条墙线上并发生长度重叠 */
function wallRunOverlap(
  a: { x: number; z: number; width: number; rotation: number },
  b: { x: number; z: number; width: number; rotation: number },
): boolean {
  if (Math.abs(Math.sin(a.rotation - b.rotation)) > 0.2) return false
  const ux = Math.cos(a.rotation)
  const uz = -Math.sin(a.rotation)
  const vx = Math.sin(a.rotation)
  const vz = Math.cos(a.rotation)
  const dx = b.x - a.x
  const dz = b.z - a.z
  const along = dx * ux + dz * uz
  const perp = dx * vx + dz * vz
  return Math.abs(perp) <= 0.6 && Math.abs(along) < (a.width + b.width) / 2 - 0.02
}

function gateWindowConflict(
  x: number,
  z: number,
  width: number,
  rotation: number,
  ignoreId?: string,
): boolean {
  const candidate = { x, z, width, rotation }
  return infras.value.some(
    (it) =>
      it.id !== ignoreId &&
      it.kind === 'gate' &&
      wallRunOverlap(candidate, it),
  )
}

function windowGateConflict(
  x: number,
  z: number,
  width: number,
  rotation: number,
  ignoreId?: string,
): boolean {
  const candidate = { x, z, width, rotation }
  return infras.value.some(
    (it) =>
      it.id !== ignoreId &&
      it.kind === 'window' &&
      wallRunOverlap(candidate, it),
  )
}

/** 基础设施旋转后的轴对齐包围盒 */
function infraAabb(it: Pick<Infra, 'x' | 'z' | 'width' | 'depth' | 'rotation'>) {
  const points = [
    { x: it.x, z: it.z },
    ...infraCorners(it.x, it.z, it.width, it.depth, it.rotation),
  ]
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  }
}

function intervalGap(aMin: number, aMax: number, bMin: number, bMax: number) {
  return Math.max(0, bMin - aMax, aMin - bMax)
}

/** 两个设施是否贴边相邻；多选时至少要与已选组内一个设施接触 */
function infraTouching(
  a: Pick<Infra, 'x' | 'z' | 'width' | 'depth' | 'rotation'>,
  b: Pick<Infra, 'x' | 'z' | 'width' | 'depth' | 'rotation'>,
): boolean {
  const A = infraAabb(a)
  const B = infraAabb(b)
  return (
    intervalGap(A.minX, A.maxX, B.minX, B.maxX) <= 0.08 &&
    intervalGap(A.minZ, A.maxZ, B.minZ, B.maxZ) <= 0.08
  )
}

/** 多选设施是否通过贴边关系连成一整组 */
function infraIdsConnected(ids: string[]): boolean {
  if (ids.length < 2) return true
  const set = new Set(ids)
  const byId = new Map(infras.value.map((it) => [it.id, it]))
  const start = byId.get(ids[0])
  if (!start) return false
  const visited = new Set<string>([start.id])
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()!
    for (const id of set) {
      if (visited.has(id)) continue
      const other = byId.get(id)
      if (!other || !infraTouching(current, other)) continue
      visited.add(id)
      queue.push(other)
    }
  }
  return visited.size === ids.length
}

/** 设施落地时不与展台、其他设施重叠；gate 由墙体吸附单独处理 */
function infraSpotFree(
  x: number,
  z: number,
  spec: Pick<Infra, 'kind' | 'width' | 'depth' | 'rotation'>,
  ignoreId?: string | Set<string>,
): boolean {
  if (spec.kind === 'gate') return true
  const ignoreIds =
    typeof ignoreId === 'string' ? new Set([ignoreId]) : ignoreId

  const furniture = isFurnitureKind(spec.kind)
  const cos = Math.cos(spec.rotation)
  const sin = Math.sin(spec.rotation)
  // 贴边接触时允许 1.5 cm 的边界误差，但不允许真实重叠
  const edgeEps = 0.015
  const boothSamples = [
    { x, z },
    ...infraCorners(
      x,
      z,
      Math.max(0.02, spec.width - edgeEps * 2),
      Math.max(0.02, spec.depth - edgeEps * 2),
      spec.rotation,
    ),
  ]

  // 家具本就位于展台内部，跳过与展台的互斥检查
  if (!furniture) {
    for (const b of booths.value) {
      if (boothSamples.some((p) => pointInPolygon(p, b.points))) return false
      // 展台顶点落在设施内部（设施覆盖展台的情况）
      for (const p of b.points) {
        const dx = p.x - x
        const dz = p.z - z
        const lx = dx * cos - dz * sin
        const lz = dx * sin + dz * cos
        if (
          Math.abs(lx) <= Math.max(0, spec.width / 2 - edgeEps) &&
          Math.abs(lz) <= Math.max(0, spec.depth / 2 - edgeEps)
        ) {
          return false
        }
      }
    }
  }

  for (const it of infras.value) {
    if (ignoreIds?.has(it.id) || it.kind === 'gate') continue
    // 墙面之间允许连接/交叉
    if (spec.kind === 'wall' && it.kind === 'wall') continue
    if (
      obbOverlap(
        x,
        z,
        spec.width,
        spec.depth,
        spec.rotation,
        it.x,
        it.z,
        it.width,
        it.depth,
        it.rotation,
      )
    ) {
      return false
    }
  }
  return true
}

function handlePlaceInfra(
  kind: InfraKind,
  spot: { x: number; z: number; rotation: number; hostHeight?: number },
) {
  if ((kind === 'gate' || kind === 'window') && !venue.value) {
    toast('请先绘制场馆')
    mode.value = 'idle'
    return
  }

  const hostHeight =
    kind === 'gate' || kind === 'window'
      ? (spot.hostHeight ?? venue.value?.height)
      : venue.value?.height
  const copied = pendingInfraCopy?.kind === kind ? pendingInfraCopy : null
  const dims = clampInfraDims(
    kind,
    copied
      ? { width: copied.width, depth: copied.depth, height: copied.height }
      : INFRA_DEFAULTS[kind],
    hostHeight,
  )
  const rotation = spot.rotation
  if (kind === 'window' && gateWindowConflict(spot.x, spot.z, dims.width, rotation)) {
    toast('这里已有出入口，不能安装窗户')
    return
  }
  if (kind === 'gate' && windowGateConflict(spot.x, spot.z, dims.width, rotation)) {
    toast('这里已有窗户，不能安装出入口')
    return
  }
  if (
    isFurnitureKind(kind) &&
    !furnitureInsideBooth(kind, spot.x, spot.z, dims.width, dims.depth, rotation)
  ) {
    toast('家具只能完整放置在展台内部')
    return
  }
  if (
    kind !== 'gate' &&
    !infraSpotFree(spot.x, spot.z, { kind, width: dims.width, depth: dims.depth, rotation })
  ) {
    toast('该位置已被占用，请换个位置')
    return
  }

  infraSeq += 1
  const item: Infra = {
    id: `inf${Date.now().toString(36)}-${infraSeq}`,
    kind,
    name: nextInfraName(kind),
    x: spot.x,
    z: spot.z,
    rotation,
    width: dims.width,
    depth: dims.depth,
    height: dims.height,
    ...(kind === 'window'
      ? { sill: copied?.sill ?? WINDOW_SILL }
      : {}),
    ...(kind === 'gate' ? { open: copied?.open ?? false } : {}),
    ...(kind === 'elevator'
      ? { count: copied?.count ?? ELEVATOR_DEFAULT_COUNT }
      : {}),
  }

  pendingInfraCopy = null
  infras.value = [...infras.value, item]
  selectedIds.value = []
  setInfraSelection([item.id])
  mode.value = 'idle'
  toast(
    copied
      ? `已复制 ${copied.name} · 高 ${item.height.toFixed(1)} m`
      : `${item.name} 已添加 · 高 ${item.height.toFixed(1)} m`,
  )
}

function selectInfra(id: string) {
  selectedIds.value = []
  setInfraSelection([id])
}

function selectInfraFromPanel(id: string) {
  selectInfra(id)
  stage?.focusInfra(id)
}

function selectBoothFromPanel(id: string, additive = false) {
  handlePick(id, additive, 'booth')
  stage?.focusBooth(id)
}

function renameInfra(id: string, name: string) {
  const target = infras.value.find((it) => it.id === id)
  if (!target || target.name === name) return
  infras.value = infras.value.map((it) => (it.id === id ? { ...it, name } : it))
  toast(`已重命名为「${name}」`)
}

function deleteInfra(id: string) {
  const target = infras.value.find((it) => it.id === id)
  infras.value = infras.value.filter((it) => it.id !== id)
  setInfraSelection(selectedInfraIds.value.filter((x) => x !== id))
  toast(target ? `已删除 ${target.name}` : '已删除基础设施')
}

function updateInfraDims(id: string, patch: Partial<InfraDims> & { sill?: number }) {
  infras.value = infras.value.map((it) => {
    if (it.id !== id) return it
    const dims = clampInfraDims(
      it.kind,
      { width: it.width, depth: it.depth, height: it.height, ...patch },
      venue.value?.height,
    )
    let next = { ...it, ...dims }
    if (it.kind === 'window') {
      const venueHeight = venue.value?.height ?? 6
      const currentSill = it.sill ?? WINDOW_SILL
      const maxSill = Math.max(0.2, venueHeight - next.height - 0.15)
      const sill =
        patch.sill === undefined
          ? currentSill
          : Math.min(maxSill, Math.max(0.2, patch.sill))
      const maxHeight = Math.max(1, venueHeight - sill - 0.15)
      next = {
        ...next,
        sill: Math.round(sill * 10) / 10,
        height: Math.min(next.height, maxHeight),
      }
    }
    if (isFurnitureKind(it.kind)) {
      if (
        !furnitureInsideBooth(
          it.kind,
          next.x,
          next.z,
          next.width,
          next.depth,
          next.rotation,
        )
      ) {
        toast('调整尺寸后会超出展台范围')
        return it
      }
      if (!infraSpotFree(next.x, next.z, next, id)) {
        toast('调整尺寸后会与其他对象重叠')
        return it
      }
    }
    if (it.kind === 'window') {
      if (gateWindowConflict(next.x, next.z, next.width, next.rotation, id)) {
        toast('调整尺寸后会碰到出入口')
        return it
      }
      if (!infraSpotFree(next.x, next.z, next, id)) {
        toast('调整尺寸后会与其他对象重叠')
        return it
      }
    }
    if (it.kind === 'gate' && windowGateConflict(next.x, next.z, next.width, next.rotation, id)) {
      toast('调整尺寸后会碰到窗户')
      return it
    }
    return next
  })
}

/** 拖动释放：校验后写回位置；出入口由墙体吸附决定朝向 */
function moveInfra(id: string, x: number, z: number, rotation: number) {
  const target = infras.value.find((it) => it.id === id)
  if (!target) return
  if (
    isFurnitureKind(target.kind) &&
    !furnitureInsideBooth(target.kind, x, z, target.width, target.depth, rotation)
  ) {
    toast('家具需完整位于展台内部，已恢复原位')
    return
  }
  if (target.kind === 'window' && gateWindowConflict(x, z, target.width, rotation, id)) {
    toast('这里已有出入口，已恢复原位')
    return
  }
  if (target.kind === 'gate' && windowGateConflict(x, z, target.width, rotation, id)) {
    toast('这里已有窗户，已恢复原位')
    return
  }
  if (!infraSpotFree(x, z, target, id)) {
    toast('该位置已被占用，已恢复原位')
    return
  }
  infras.value = infras.value.map((it) => (it.id === id ? { ...it, x, z, rotation } : it))
  toast(`${target.name} 已移动`)
}

/** 相邻多选整体拖动：全部通过校验后一次性写回 */
function moveInfraGroup(
  targets: { id: string; x: number; z: number; rotation: number }[],
) {
  if (targets.length < 2) return
  const targetMap = new Map(targets.map((target) => [target.id, target]))
  const moving = new Set(targets.map((target) => target.id))
  const next: Infra[] = []

  for (const item of infras.value) {
    const target = targetMap.get(item.id)
    if (!target) {
      next.push(item)
      continue
    }
    if (
      isFurnitureKind(item.kind) &&
      !furnitureInsideBooth(
        item.kind,
        target.x,
        target.z,
        item.width,
        item.depth,
        target.rotation,
      )
    ) {
      toast(`${item.name} 会超出展台范围，已恢复原位`)
      return
    }
    if (!infraSpotFree(
      target.x,
      target.z,
      { ...item, rotation: target.rotation },
      moving,
    )) {
      toast('整体移动后会与其他对象重叠，已恢复原位')
      return
    }
    next.push({
      ...item,
      x: target.x,
      z: target.z,
      rotation: target.rotation,
    })
  }

  infras.value = next
  toast(`已整体移动 ${targets.length} 个设施`)
}

function rotateInfra(id: string, dir: 1 | -1) {
  const target = infras.value.find((it) => it.id === id)
  if (!target || target.kind === 'gate' || target.kind === 'window') return

  const turn = (dir * Math.PI) / 2
  const rotation = (((target.rotation + turn) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  if (
    isFurnitureKind(target.kind) &&
    !furnitureInsideBooth(
      target.kind,
      target.x,
      target.z,
      target.width,
      target.depth,
      rotation,
    )
  ) {
    toast('旋转后会超出展台范围')
    return
  }
  if (!infraSpotFree(target.x, target.z, { ...target, rotation }, id)) {
    toast('旋转后会与现有对象重叠')
    return
  }
  infras.value = infras.value.map((it) => (it.id === id ? { ...it, rotation } : it))
  toast(`${target.name} 已旋转 90°`)
}

function toggleGate(id: string) {
  const target = infras.value.find((it) => it.id === id)
  if (!target || target.kind !== 'gate') return
  infras.value = infras.value.map((it) => (it.id === id ? { ...it, open: !it.open } : it))
  toast(`${target.name} 已${target.open ? '关闭' : '打开'}`)
}

function changeInfraCount(id: string, delta: number) {
  infras.value = infras.value.map((it) => {
    if (it.id !== id || it.kind !== 'elevator') return it
    const base = it.count ?? ELEVATOR_DEFAULT_COUNT
    const count = Math.min(ELEVATOR_COUNT[1], Math.max(ELEVATOR_COUNT[0], base + delta))
    return { ...it, count }
  })
}

// ---------- 撤销 / 重做 ----------

interface SceneSnapshot {
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
}

const undoStack = ref<SceneSnapshot[]>([])
const redoStack = ref<SceneSnapshot[]>([])
const pendingChange = ref(false)
let historyTimer = 0
let applyingHistory = false

const canUndo = computed(
  () => !renderOnly.value && (undoStack.value.length > 1 || pendingChange.value),
)
const canRedo = computed(() => !renderOnly.value && redoStack.value.length > 0)

function snapshotScene(): SceneSnapshot {
  return {
    venue: venue.value
      ? {
          ...venue.value,
          points: venue.value.points.map((p) => ({ x: p.x, z: p.z })),
        }
      : null,
    booths: booths.value.map((b) => ({
      ...b,
      points: b.points.map((p) => ({ x: p.x, z: p.z })),
    })),
    infras: infras.value.map((it) => ({ ...it })),
  }
}

function commitHistory() {
  if (!pendingChange.value) return
  pendingChange.value = false
  undoStack.value.push(snapshotScene())
  if (undoStack.value.length > 60) undoStack.value.shift()
  redoStack.value = []
}

function sameVenue(a: Venue | null, b: Venue | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.height !== b.height || !!a.ceiling !== !!b.ceiling) return false
  if (a.points.length !== b.points.length) return false
  return a.points.every((p, i) => p.x === b.points[i].x && p.z === b.points[i].z)
}

function sameBooths(a: Booth[], b: Booth[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.height !== y.height ||
      x.kind !== y.kind ||
      x.canopy !== y.canopy ||
      x.noTop !== y.noTop ||
      x.groupId !== y.groupId ||
      x.mark !== y.mark ||
      x.marked !== y.marked ||
      x.logo !== y.logo ||
      x.data !== y.data
    ) {
      return false
    }
    return (
      x.points.length === y.points.length &&
      x.points.every((p, j) => p.x === y.points[j].x && p.z === y.points[j].z)
    )
  })
}

function sameInfras(a: Infra[], b: Infra[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    return (
      x.id === y.id &&
      x.kind === y.kind &&
      x.name === y.name &&
      x.x === y.x &&
      x.z === y.z &&
      x.rotation === y.rotation &&
      x.width === y.width &&
      x.depth === y.depth &&
      x.height === y.height &&
      (x.open ?? false) === (y.open ?? false) &&
      (x.count ?? 0) === (y.count ?? 0)
    )
  })
}

function applySnapshot(snap: SceneSnapshot) {
  const venueChanged = !sameVenue(venue.value, snap.venue)
  const boothsChanged = !sameBooths(booths.value, snap.booths)
  const infrasChanged = !sameInfras(infras.value, snap.infras)
  const changedCount = Number(venueChanged) + Number(boothsChanged) + Number(infrasChanged)

  applyingHistory = true
  if (venueChanged) {
    venue.value = snap.venue
      ? {
          ...snap.venue,
          points: snap.venue.points.map((p) => ({ x: p.x, z: p.z })),
        }
      : null
  }
  if (boothsChanged) {
    booths.value = snap.booths.map((b) => ({
      ...b,
      points: b.points.map((p) => ({ x: p.x, z: p.z })),
    }))
  }
  if (infrasChanged) {
    infras.value = snap.infras.map((it) => ({ ...it }))
  }
  venueNoTop.value = snap.venue ? !snap.venue.ceiling : venueNoTop.value
  selectedIds.value = []
  clearInfraSelection()
  mode.value = 'idle'
  draftPoints.value = []

  nextTick(() => {
    if (stage && changedCount > 0) {
      // 只重建真正变化的图层，避免一次撤销触发全场多次重建
      if (changedCount > 1) stage.setScene(venue.value, booths.value, infras.value)
      else if (venueChanged) stage.setVenue(venue.value)
      else if (boothsChanged) stage.setBooths(booths.value)
      else if (infrasChanged) stage.setInfras(infras.value)
    }
    applyingHistory = false
  })
}

function undo() {
  if (renderOnly.value) return
  window.clearTimeout(historyTimer)

  if (pendingChange.value) {
    // 尚有未合并的修改：当前状态作为重做目标，恢复到上一次提交
    pendingChange.value = false
    redoStack.value.push(snapshotScene())
    applySnapshot(undoStack.value[undoStack.value.length - 1] ?? snapshotScene())
    return
  }

  if (undoStack.value.length <= 1) return
  const current = undoStack.value.pop()!
  redoStack.value.push(current)
  applySnapshot(undoStack.value[undoStack.value.length - 1])
}

function redo() {
  if (renderOnly.value) return
  window.clearTimeout(historyTimer)
  if (pendingChange.value) commitHistory()
  if (!redoStack.value.length) return
  const next = redoStack.value.pop()!
  undoStack.value.push(next)
  applySnapshot(next)
}

undoStack.value = [snapshotScene()]

watch(
  [venue, booths, infras],
  () => {
    if (applyingHistory) return
    pendingChange.value = true
    window.clearTimeout(historyTimer)
    historyTimer = window.setTimeout(commitHistory, 260)
  },
  { deep: true },
)

// IndexedDB 自动保存：名称、场景、天气和太阳时间一起保留
watch(
  [venue, booths, infras, venueName, weather, weatherOn, sunProgress],
  () => scheduleAutosave(),
  { deep: true },
)

// ---------- JSON 导入 / 导出 ----------

const INFRA_KIND_SET = new Set<InfraKind>([
  'stairs',
  'restroom',
  'gate',
  'window',
  'elevator',
  'wall',
  'chair',
  'armchair',
  'sofa',
  'table-round',
  'table-square',
])

function cloneData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined
  try {
    const copy: unknown = JSON.parse(JSON.stringify(data))
    return copy && typeof copy === 'object' && !Array.isArray(copy)
      ? (copy as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function normalizeLogo(logo?: string): string | undefined {
  if (!logo) return undefined
  const value = logo.trim()
  if (!value) return undefined
  return value.startsWith('data:') ? value.split(',')[1] || undefined : value
}

function readPoints(value: unknown): Pt[] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const pts: Pt[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const p = raw as { x?: unknown; z?: unknown }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null
    pts.push({ x: Number(p.x), z: Number(p.z) })
  }
  return pts
}

function readBooth(raw: unknown, index: number): Booth | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const points = readPoints(r.points)
  if (!points) return null

  const kind: BoothKind =
    r.kind === 'scaffold' || r.kind === 'openfloor' || r.kind === 'massing'
      ? r.kind
      : 'massing'
  const rawHeight = Number(r.height)
  const height = kind === 'openfloor' ? OPEN_FLOOR_HEIGHT : rawHeight
  if (!Number.isFinite(height)) return null
  const canopy = kind === 'scaffold' ? r.canopy !== false : undefined
  const noTop = kind === 'massing' && r.noTop === true ? true : undefined

  const name =
    typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `展台 ${index + 1}`
  const id =
    typeof r.id === 'string' && r.id.trim()
      ? r.id.trim()
      : `imp-${Date.now().toString(36)}-${index}`
  const groupId = typeof r.groupId === 'string' && r.groupId ? r.groupId : undefined
  const exhibitor =
    typeof r.exhibitor === 'string' && r.exhibitor.trim()
      ? r.exhibitor.trim().slice(0, 60)
      : undefined
  const logo = typeof r.logo === 'string' ? normalizeLogo(r.logo) : undefined
  const data =
    r.data && typeof r.data === 'object' && !Array.isArray(r.data)
      ? cloneData(r.data as Record<string, unknown>)
      : undefined

  const mark: BoothMark | undefined =
    r.mark === 'red' || r.mark === 'yellow' || r.mark === 'gray'
      ? r.mark
      : r.marked
        ? 'red'
        : undefined

  return {
    id,
    name,
    points,
    height: kind === 'openfloor' ? OPEN_FLOOR_HEIGHT : Math.min(8, Math.max(0.4, height)),
    ...(kind === 'massing' ? {} : { kind }),
    ...(canopy !== undefined ? { canopy } : {}),
    ...(noTop ? { noTop } : {}),
    ...(groupId ? { groupId } : {}),
    ...(exhibitor ? { exhibitor } : {}),
    ...(logo ? { logo } : {}),
    ...(data ? { data } : {}),
    ...(mark ? { mark } : {}),
  }
}

function readInfra(raw: unknown, index: number, venueHeight?: number): Infra | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = r.kind
  if (typeof kind !== 'string' || !INFRA_KIND_SET.has(kind as InfraKind)) return null
  const kindTyped = kind as InfraKind

  const x = Number(r.x)
  const z = Number(r.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null

  const base = INFRA_DEFAULTS[kindTyped]
  const width = Number(r.width)
  const depth = Number(r.depth)
  const height = Number(r.height)
  const dims = clampInfraDims(
    kindTyped,
    {
      width: Number.isFinite(width) ? width : base.width,
      depth: Number.isFinite(depth) ? depth : base.depth,
      height: Number.isFinite(height) ? height : base.height,
    },
    venueHeight,
  )
  let windowSill = WINDOW_SILL
  let windowHeight = dims.height
  if (kindTyped === 'window') {
    const rawSill = Number(r.sill)
    const sill = Number.isFinite(rawSill) ? rawSill : WINDOW_SILL
    const maxSill = Math.max(0.2, (venueHeight ?? 6) - dims.height - 0.15)
    windowSill = Math.min(maxSill, Math.max(0.2, sill))
    windowHeight = Math.min(
      dims.height,
      Math.max(1, (venueHeight ?? 6) - windowSill - 0.15),
    )
  }

  const rotation = Number(r.rotation)
  const name =
    typeof r.name === 'string' && r.name.trim()
      ? r.name.trim()
      : `${INFRA_LABELS[kindTyped]} ${index + 1}`
  const id =
    typeof r.id === 'string' && r.id.trim()
      ? r.id.trim()
      : `imp-inf-${Date.now().toString(36)}-${index}`

  return {
    id,
    kind: kindTyped,
    name,
    x,
    z,
    rotation: Number.isFinite(rotation) ? rotation : 0,
    ...dims,
    ...(kindTyped === 'window'
      ? { height: windowHeight, sill: Math.round(windowSill * 10) / 10 }
      : {}),
    ...(kindTyped === 'gate' ? { depth: 0.5, open: !!r.open } : {}),
    ...(kindTyped === 'elevator'
      ? {
          count: Math.min(
            ELEVATOR_COUNT[1],
            Math.max(
              ELEVATOR_COUNT[0],
              Math.round(Number(r.count) || ELEVATOR_DEFAULT_COUNT),
            ),
          ),
        }
      : {}),
  }
}

/** 展台 list 导出（深拷贝，logo 为纯 base64） */
function exportBoothList(): Booth[] {
  return booths.value.map((b) => ({
    id: b.id,
    name: b.name,
    points: b.points.map((p) => ({ x: p.x, z: p.z })),
    height: b.height,
    ...(b.kind ? { kind: b.kind } : {}),
    ...(boothKindOf(b) === 'scaffold' ? { canopy: b.canopy !== false } : {}),
    ...(boothKindOf(b) === 'massing' && b.noTop ? { noTop: true } : {}),
    ...(b.groupId ? { groupId: b.groupId } : {}),
    ...(b.exhibitor ? { exhibitor: b.exhibitor } : {}),
    ...(b.logo ? { logo: normalizeLogo(b.logo) } : {}),
    ...(b.data ? { data: cloneData(b.data) } : {}),
    ...(b.mark ? { mark: b.mark } : b.marked ? { mark: 'red' as BoothMark } : {}),
  }))
}

function buildSceneJson(): SceneJson {
  const v = venue.value
  return {
    version: 1,
    venueName: venueName.value.trim() || '场馆白膜',
    weather: weather.value,
    weatherOn: weatherOn.value,
    sunProgress: sunProgress.value,
    venue: v
      ? {
          points: v.points.map((p) => ({ x: p.x, z: p.z })),
          height: v.height,
          ceiling: !!v.ceiling,
        }
      : null,
    booths: exportBoothList(),
    infras: infras.value.map((it) => ({ ...it })),
  }
}

function downloadScene() {
  const blob = new Blob([JSON.stringify(buildSceneJson(), null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `grid-massing-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast('场景 JSON 已导出')
}

async function downloadReportImage() {
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
  })
  if (!dataUrl) {
    toast('汇报图生成失败，请稍后重试')
    return
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  toast('高质量俯视汇报图已生成')
}

function triggerImport() {
  if (renderOnly.value) return
  importInput.value?.click()
}

function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') importSceneJson(reader.result)
  }
  reader.readAsText(file)
}

function importSceneJson(text: string): boolean {
  if (renderOnly.value) {
    toast('只读模式已禁用编辑功能')
    return false
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    toast('JSON 解析失败，请检查文件格式')
    return false
  }
  return applySceneJson(parsed)
}

function applySceneJson(input: unknown): boolean {
  if (renderOnly.value) {
    toast('只读模式已禁用编辑功能')
    return false
  }
  if (!input || typeof input !== 'object') {
    toast('JSON 格式不正确')
    return false
  }

  const obj = input as Partial<SceneJson>
  if (!restoringProject) importedDuringRestore = true

  const nextName =
    typeof obj.venueName === 'string' && obj.venueName.trim()
      ? obj.venueName.trim().slice(0, 24)
      : '场馆白膜'
  const nextWeather =
    typeof obj.weather === 'string' && obj.weather in WEATHER_LABELS
      ? (obj.weather as WeatherKind)
      : null

  let nextVenue: Venue | null = null
  if (obj.venue && typeof obj.venue === 'object') {
    const v = obj.venue as unknown as Record<string, unknown>
    const points = readPoints(v.points)
    const height = Number(v.height)
    if (points && Number.isFinite(height)) {
      nextVenue = {
        points,
        height: Math.min(24, Math.max(2, height)),
        ceiling: !!v.ceiling,
      }
    }
  }

  const nextBooths: Booth[] = []
  const usedBoothIds = new Set<string>()
  const rawBooths = Array.isArray(obj.booths) ? obj.booths : []
  rawBooths.forEach((raw, i) => {
    const b = readBooth(raw, i)
    if (!b) return
    let nextId = b.id
    while (usedBoothIds.has(nextId)) {
      nextId = `imp-${Date.now().toString(36)}-${i}-${usedBoothIds.size}`
    }
    b.id = nextId
    usedBoothIds.add(nextId)
    nextBooths.push(b)
  })

  const nextInfras: Infra[] = []
  const usedInfraIds = new Set<string>()
  const rawInfras = Array.isArray(obj.infras) ? obj.infras : []
  rawInfras.forEach((raw, i) => {
    const it = readInfra(raw, i, nextVenue?.height)
    if (!it) return
    let nextId = it.id
    while (usedInfraIds.has(nextId)) {
      nextId = `imp-inf-${Date.now().toString(36)}-${i}-${usedInfraIds.size}`
    }
    it.id = nextId
    usedInfraIds.add(nextId)
    nextInfras.push(it)
  })

  // 家具必须完整位于某个展台内部，导入时丢弃不合法项
  const validInfras = nextInfras.filter((it) => {
    if (!isFurnitureKind(it.kind)) return true
    const host = nextBooths.find((b) => pointInPolygon(it, b.points))
    return (
      !!host &&
      furnitureInsidePolygon(host.points, it.x, it.z, it.width, it.depth, it.rotation)
    )
  })

  venueName.value = nextName
  venue.value = nextVenue
  venueNoTop.value = nextVenue ? !nextVenue.ceiling : venueNoTop.value
  booths.value = nextBooths
  infras.value = validInfras
  selectedIds.value = []
  clearInfraSelection()
  mode.value = 'idle'
  draftPoints.value = []
  seq = Math.max(nextBooths.length, 1)
  infraSeq = Math.max(validInfras.length, 1)

  const nextWeatherOn = obj.weatherOn !== false
  if (nextWeather) {
    suppressAutoWeather = true
    weatherOn.value = nextWeatherOn
    weather.value = nextWeatherOn ? nextWeather : 'clear'
    liveWeatherOn.value = false
    liveWeather.value = null
    stage?.setWeather(weather.value)
    nextTick(() => {
      suppressAutoWeather = false
    })
  }
  if (typeof obj.sunProgress === 'number' && Number.isFinite(obj.sunProgress)) {
    sunProgress.value = Math.max(0, Math.min(1, obj.sunProgress))
    stage?.setSunProgress(sunProgress.value)
  }

  nextTick(() => {
    if (nextVenue) stage?.fit(nextVenue.points, nextVenue.height)
    else stage?.fit()
  })
  if (!restoringProject) window.setTimeout(() => void saveProjectNow(), 0)
  toast(`已导入场景 · ${nextBooths.length} 个展台 / ${validInfras.length} 个设施`)
  return true
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
  stage?.setReadOnly(on)
}

/** 对外暴露的场景 API */
const gridMassingApi = {
  exportBooths: () => exportBoothList(),
  exportScene: () => buildSceneJson(),
  importScene: (input: string | SceneJson) =>
    typeof input === 'string' ? importSceneJson(input) : applySceneJson(input),
  setRenderMode: (on: boolean) => setRenderOnly(on),
}

// ---------- 场景操作 ----------

function deleteVenue() {
  venue.value = null
  booths.value = []
  infras.value = []
  selectedIds.value = []
  clearInfraSelection()
  draftPoints.value = []
  mode.value = 'idle'
  toast('已清空场馆、展台与基础设施')
}

/** 移除已经不在任何展台内的家具 */
function cleanupFurniture() {
  if (!infras.value.some((it) => isFurnitureKind(it.kind))) return
  infras.value = infras.value.filter(
    (it) => !isFurnitureKind(it.kind) || boothAtPoint(it) !== null,
  )
}

function deleteBooth(id: string) {
  const target = booths.value.find((b) => b.id === id)
  booths.value = cleanupGroups(booths.value.filter((b) => b.id !== id))
  cleanupFurniture()
  selectedIds.value = selectedIds.value.filter((x) => x !== id)
  toast(target ? `已删除 ${target.name}` : '已删除展台')
}

function deleteSelectedBooths() {
  if (!selectedIds.value.length) return
  const n = selectedIds.value.length
  booths.value = cleanupGroups(booths.value.filter((b) => !selectedIds.value.includes(b.id)))
  cleanupFurniture()
  selectedIds.value = []
  toast(n > 1 ? `已删除 ${n} 个展台` : '已删除展台')
}

function changeVenueHeight(v: number) {
  if (!venue.value) return
  venue.value = {
    ...venue.value,
    height: Math.round(Math.min(24, Math.max(2, v))),
    ceiling: !venueNoTop.value,
  }
}

function changeBoothHeight(id: string, v: number) {
  booths.value = booths.value.map((b) => {
    if (b.id !== id) return b
    // 光地展台是固定高度的台板，不参与高度调整
    if (boothKindOf(b) === 'openfloor') return b
    return { ...b, height: Math.round(Math.min(8, Math.max(1, v))) }
  })
}

function setBoothCanopy(id: string, on: boolean) {
  const target = booths.value.find((b) => b.id === id)
  if (!target || boothKindOf(target) !== 'scaffold') return
  booths.value = booths.value.map((b) => (b.id === id ? { ...b, canopy: on } : b))
  toast(`${target.name} 顶棚已${on ? '开启' : '关闭'}`)
}

/** 标准展台去掉顶部时，顶板与立柱一起隐藏，仅保留底部围挡 */
function setBoothNoTop(id: string, noTop: boolean) {
  const target = booths.value.find((b) => b.id === id)
  if (!target || boothKindOf(target) !== 'massing') return
  booths.value = booths.value.map((b) =>
    b.id === id ? { ...b, noTop: noTop || undefined } : b,
  )
  toast(`${target.name} ${noTop ? '顶板与立柱已去除' : '顶板与立柱已恢复'}`)
}

function setBoothMark(id: string, mark: BoothMark | null) {
  const target = booths.value.find((b) => b.id === id)
  if (!target) return
  booths.value = booths.value.map((b) =>
    b.id === id ? { ...b, mark: mark ?? undefined, marked: undefined } : b,
  )
  const label = mark === 'red' ? '红色' : mark === 'yellow' ? '黄色' : mark === 'gray' ? '灰色' : ''
  toast(mark ? `已将「${target.name}」标记为${label}` : `已取消「${target.name}」的标记`)
}

/** 按包围盒长宽等比缩放展台轮廓，中心保持不动 */
function resizeBooth(id: string, patch: { width?: number; depth?: number }) {
  const target = booths.value.find((b) => b.id === id)
  if (!target || target.points.length < 3) return

  const bnd = boundsOf(target.points)
  const curW = Math.max(0.1, bnd.maxX - bnd.minX)
  const curD = Math.max(0.1, bnd.maxZ - bnd.minZ)
  const width = Math.round(Math.min(120, Math.max(1, patch.width ?? curW)))
  const depth = Math.round(Math.min(120, Math.max(1, patch.depth ?? curD)))
  if (width === Math.round(curW) && depth === Math.round(curD)) return

  const cx = (bnd.minX + bnd.maxX) / 2
  const cz = (bnd.minZ + bnd.maxZ) / 2
  const sx = width / curW
  const sz = depth / curD
  const points = target.points.map((p) => ({
    x: cx + (p.x - cx) * sx,
    z: cz + (p.z - cz) * sz,
  }))
  if (polygonArea(points) < 3) {
    toast('展台面积不能小于 3 m²（约 3 × 1m）')
    return
  }

  const inner = venueInner()
  if (inner && !polygonInsidePolygon(points, inner)) {
    toast('展台需完全位于场馆内部')
    return
  }

  const clash = booths.value.find(
    (b) =>
      b.id !== id &&
      !(target.groupId && b.groupId === target.groupId) &&
      overlaps(points, b.points),
  )
  if (clash) {
    toast(`与「${clash.name}」重叠，无法调整尺寸`)
    return
  }

  // 展台内的家具跟着轮廓一起缩放，避免缩台后家具悬空
  const nextFurniture = new Map<string, Pt>()
  for (const it of infras.value) {
    if (!isFurnitureKind(it.kind) || !pointInPolygon(it, target.points)) continue
    const nx = cx + (it.x - cx) * sx
    const nz = cz + (it.z - cz) * sz
    if (!furnitureInsidePolygon(points, nx, nz, it.width, it.depth, it.rotation)) {
      toast(`「${it.name}」会超出调整后的展台`)
      return
    }
    nextFurniture.set(it.id, { x: nx, z: nz })
  }

  booths.value = booths.value.map((b) => (b.id === id ? { ...b, points } : b))
  if (nextFurniture.size) {
    infras.value = infras.value.map((it) => {
      const p = nextFurniture.get(it.id)
      return p ? { ...it, x: p.x, z: p.z } : it
    })
  }
  toast(`${target.name} 尺寸已调整为 ${width} × ${depth} m`)
}

const activeBoothId = computed(() => selectedIds.value[selectedIds.value.length - 1] ?? null)

function rotatePointsAround(pts: Pt[], center: Pt, deg: number): Pt[] {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return pts.map((p) => {
    const dx = p.x - center.x
    const dz = p.z - center.z
    return { x: center.x + dx * cos + dz * sin, z: center.z - dx * sin + dz * cos }
  })
}

function toPoly(pts: Pt[]): Polygon {
  const ring = pts.map((p) => [p.x, p.z] as [number, number])
  ring.push([pts[0].x, pts[0].z])
  return [ring]
}

function ringArea(ring: [number, number][]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** 用相交面积判断重叠，允许展台贴边拼接 */
function overlaps(pts: Pt[], other: Pt[]): boolean {
  try {
    const res = polygonClipping.intersection(toPoly(pts), toPoly(other))
    let area = 0
    for (const poly of res) for (const ring of poly) area += Math.abs(ringArea(ring))
    return area > 0.02
  } catch {
    return true
  }
}

/** 展台候选位置是否合法，返回错误文案（ignore 为一起变换、无需互检的展台） */
function boothError(pts: Pt[], ignore: string[] = []): string | null {
  const inner = venueInner()
  if (!inner) return '请先绘制场馆'
  if (!polygonInsidePolygon(pts, inner)) return '展台需位于场馆内部'
  const clash = booths.value.find((b) => !ignore.includes(b.id) && overlaps(pts, b.points))
  return clash ? `与「${clash.name}」重叠` : null
}

function rotateSelected(dir: 1 | -1) {
  const id = activeBoothId.value
  if (id) rotateBooth(id, dir * 90)
}

const mergeDialog = ref<null | {
  ids: string[]
  heights: number[]
  targetId: string
  targetName: string
  targetHeight: number
}>(null)

let groupSeq = 0

function nextGroupId() {
  groupSeq += 1
  return `g${groupSeq}`
}

/** 合并组轮廓（用于相邻性校验） */
function groupUnion(list: Booth[]): Polygon[] | null {
  if (list.length < 2) return null
  try {
    const res = polygonClipping.union(toPoly(list[0].points), ...list.slice(1).map((b) => toPoly(b.points)))
    return res.length === 1 ? res : null
  } catch {
    return null
  }
}

function mergeSelected() {
  const list = booths.value.filter((b) => selectedIds.value.includes(b.id))
  if (list.length < 2) return
  if (!groupUnion(list)) {
    toast('展台需要相互贴合才能合并')
    return
  }

  const active = booths.value.find((b) => b.id === activeBoothId.value) ?? list[list.length - 1]
  const heights = list.map((b) => Number(b.height.toFixed(2)))
  const unique = new Set(heights)

  if (unique.size > 1) {
    mergeDialog.value = {
      ids: list.map((b) => b.id),
      heights,
      targetId: active.id,
      targetName: active.name,
      targetHeight: active.height,
    }
    return
  }
  applyMerge(false)
}

function applyMerge(unify: boolean) {
  const d = mergeDialog.value
  const ids = d ? d.ids : booths.value.filter((b) => selectedIds.value.includes(b.id)).map((b) => b.id)
  if (ids.length < 2) {
    mergeDialog.value = null
    return
  }

  // 复用已有分组，否则新建（同一合并组合用同一标记色）
  const existing = booths.value.find((b) => ids.includes(b.id) && b.groupId)?.groupId
  const gid = existing ?? nextGroupId()
  const set = new Set(ids)
  const targetHeight = d?.targetHeight

  booths.value = booths.value.map((b) => {
    if (!set.has(b.id)) return b
    return { ...b, groupId: gid, height: unify && targetHeight !== undefined ? targetHeight : b.height }
  })
  selectedIds.value = [...ids]
  mergeDialog.value = null
  toast(
    unify && targetHeight !== undefined
      ? `已合并 ${ids.length} 个展台 · 高度统一为 ${targetHeight.toFixed(2)} m`
      : `已合并 ${ids.length} 个展台（仅合并模型，结构保持独立）`,
  )
}

function unmergeSelected() {
  const set = new Set(selectedIds.value)
  booths.value = booths.value.map((b) => (set.has(b.id) && b.groupId ? { ...b, groupId: undefined } : b))
  toast('已取消合并')
}

const hasGroupInSelection = computed(() =>
  booths.value.some((b) => selectedIds.value.includes(b.id) && !!b.groupId),
)

function cleanupGroups(list: Booth[]): Booth[] {
  const counts = new Map<string, number>()
  for (const b of list) {
    if (b.groupId) counts.set(b.groupId, (counts.get(b.groupId) ?? 0) + 1)
  }
  return list.map((b) => (b.groupId && (counts.get(b.groupId) ?? 0) < 2 ? { ...b, groupId: undefined } : b))
}

/** 同组成员 id（含自身） */
function groupIdsOf(id: string): string[] {
  const spec = booths.value.find((b) => b.id === id)
  if (spec?.groupId) {
    const members = booths.value.filter((b) => b.groupId === spec.groupId).map((b) => b.id)
    if (members.length > 1) return members
  }
  return [id]
}

function transformPoints(ids: string[], fn: (pts: Pt[], id: string) => Pt[]): boolean {
  const next = booths.value.map((b) => (ids.includes(b.id) ? { ...b, points: fn(b.points, b.id) } : b))
  for (const b of next) {
    if (!ids.includes(b.id)) continue
    const err = boothError(b.points, ids)
    if (err) {
      toast(`无法变换：${err}`)
      return false
    }
  }
  booths.value = next
  return true
}

/** 展台内的家具（用于随展台一起移动 / 旋转） */
function furnitureInBooths(list: Booth[]): Infra[] {
  if (!list.length) return []
  return infras.value.filter(
    (it) => isFurnitureKind(it.kind) && list.some((b) => pointInPolygon(it, b.points)),
  )
}

function moveBooth(id: string, dx: number, dz: number) {
  const ids = groupIdsOf(id)
  const members = booths.value.filter((b) => ids.includes(b.id))
  const furniture = furnitureInBooths(members)
  if (!transformPoints(ids, (pts) => pts.map((p) => ({ x: p.x + dx, z: p.z + dz })))) return
  if (!furniture.length) return
  const moved = new Set(furniture.map((it) => it.id))
  infras.value = infras.value.map((it) =>
    moved.has(it.id) ? { ...it, x: it.x + dx, z: it.z + dz } : it,
  )
}

function rotateBooth(id: string, deg: number) {
  const ids = groupIdsOf(id)
  const members = booths.value.filter((b) => ids.includes(b.id))
  const all: Pt[] = []
  for (const b of members) all.push(...b.points)
  let center: Pt
  if (ids.length === 1) {
    center = centroid(all)
  } else {
    const bnd = boundsOf(all)
    center = { x: (bnd.minX + bnd.maxX) / 2, z: (bnd.minZ + bnd.maxZ) / 2 }
  }

  const furniture = furnitureInBooths(members)
  if (!transformPoints(ids, (pts) => rotatePointsAround(pts, center, deg))) return
  if (!furniture.length) return

  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const moved = new Set(furniture.map((it) => it.id))
  infras.value = infras.value.map((it) => {
    if (!moved.has(it.id)) return it
    const dx = it.x - center.x
    const dz = it.z - center.z
    const rotation = (((it.rotation + rad) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    return {
      ...it,
      x: center.x + dx * cos + dz * sin,
      z: center.z - dx * sin + dz * cos,
      rotation,
    }
  })
}

function setInfraSelection(ids: string[]) {
  let valid = [...new Set(ids)].filter((id) =>
    infras.value.some((it) => it.id === id),
  )
  // 删除或取消中间设施后若剩余对象断开，只保留最后选中的一个
  if (valid.length > 1 && !infraIdsConnected(valid)) {
    valid = [valid[valid.length - 1]]
  }
  selectedInfraIds.value = valid
  selectedInfraId.value = valid[valid.length - 1] ?? null
}

function clearInfraSelection() {
  selectedInfraIds.value = []
  selectedInfraId.value = null
}

function handlePick(id: string | null, additive = false, kind: 'booth' | 'infra' = 'booth') {
  if (kind === 'infra') {
    selectedIds.value = []
    if (!id) {
      if (!additive) clearInfraSelection()
      return
    }
    const target = infras.value.find((it) => it.id === id)
    if (!target) return
    const current = selectedInfraIds.value
    if (additive) {
      if (current.includes(id)) {
        setInfraSelection(current.filter((x) => x !== id))
        return
      }
      const wallItem =
        target.kind === 'gate' ||
        target.kind === 'window' ||
        current.some((x) => {
          const it = infras.value.find((v) => v.id === x)
          return it?.kind === 'gate' || it?.kind === 'window'
        })
      if (current.length && wallItem) {
        toast('门窗只能单独选择')
        return
      }
      const touches = current.some((x) => {
        const it = infras.value.find((v) => v.id === x)
        return it ? infraTouching(target, it) : false
      })
      if (current.length && !touches) {
        toast('多选的设施必须相互挨着')
        return
      }
      setInfraSelection([...current, id])
      return
    }
    if (current.includes(id)) {
      selectedInfraId.value = id
      return
    }
    setInfraSelection([id])
    return
  }

  clearInfraSelection()
  if (!id) {
    if (!additive) selectedIds.value = []
    return
  }
  if (additive) {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id]
    return
  }
  // 选中合并组中的任一成员时，右侧同步选中整组数据（点击的那个作为主选中）
  const group = groupIdsOf(id)
  selectedIds.value = [...group.filter((x) => x !== id), id]
}

/** 当前选中恰好是某个合并组的全部成员 */
const selectionIsOneGroup = computed(() => {
  const list = booths.value.filter((b) => selectedIds.value.includes(b.id))
  if (list.length < 2) return false
  const gid = list[0].groupId
  if (!gid || list.some((b) => b.groupId !== gid)) return false
  return booths.value.filter((b) => b.groupId === gid).length === list.length
})

function toggleBoothLabels() {
  boothLabelsOn.value = !boothLabelsOn.value
  stage?.setBoothLabelsVisible(boothLabelsOn.value)
}

function toggleInfraLabels() {
  infraLabelsOn.value = !infraLabelsOn.value
  stage?.setInfraLabelsVisible(infraLabelsOn.value)
}

/** 帮助快捷入口同时控制两类名称 */
function toggleLabels() {
  const on = !(boothLabelsOn.value && infraLabelsOn.value)
  boothLabelsOn.value = on
  infraLabelsOn.value = on
  stage?.setBoothLabelsVisible(on)
  stage?.setInfraLabelsVisible(on)
}

function toggleNameSubmenu() {
  if (toolMenu.value !== 'display') return
  toolSubMenu.value = toolSubMenu.value === 'names' ? null : 'names'
}

function toggleAreas() {
  areaOn.value = !areaOn.value
  stage?.setBoothAreasVisible(areaOn.value)
}

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

function toggleToolMenu(menu: ToolMenu) {
  toolMenu.value = toolMenu.value === menu ? null : menu
  toolSubMenu.value = null
}

function runTool(action: () => void) {
  action()
  toolMenu.value = null
}

function enterPresentation() {
  if (!venue.value) {
    toast('请先绘制场馆')
    return
  }
  toolMenu.value = null
  showWeather.value = false
  showHelp.value = false
  if (walkState.value !== 'off') stage?.stopWalk()
  presentationOn.value = true
  stage?.startPresentation()
}

function exitPresentation() {
  if (!presentationOn.value) return
  presentationOn.value = false
  stage?.stopPresentation()
}

function openHelp() {
  toolMenu.value = null
  showWeather.value = false
  showHelp.value = true
}

type HelpQuickAction = 'fit' | 'grid' | 'labels' | 'areas' | 'weather' | 'walk'

function runHelpQuickAction(action: HelpQuickAction) {
  showHelp.value = false
  if (action === 'fit') {
    fitView()
    return
  }
  if (action === 'grid') {
    toggleGrid()
    return
  }
  if (action === 'labels') {
    toggleLabels()
    return
  }
  if (action === 'areas') {
    toggleAreas()
    return
  }
  if (action === 'weather') {
    openWeather()
    return
  }
  if (action === 'walk') {
    if (!venue.value) {
      toast('请先绘制场馆')
      return
    }
    toggleWalk()
  }
}

function openWeather() {
  toolMenu.value = null
  if (walkState.value === 'walk' && !showWeather.value) stage?.suspendWalkForUi()
  showWeather.value = true
}

function closeWeather() {
  showWeather.value = false
  if (walkState.value === 'walk') stage?.resumeWalkFromUi()
}

function toggleWeatherEnabled(on: boolean) {
  weatherOn.value = on
  if (!on) {
    liveWeatherOn.value = false
    liveWeather.value = null
    if (weather.value !== 'clear') {
      weather.value = 'clear'
      stage?.setWeather('clear')
    }
  }
}

function chooseWeather(kind: WeatherKind) {
  weatherOn.value = true
  liveWeatherOn.value = false
  liveWeather.value = null
  weather.value = kind
  stage?.setWeather(kind)
  showWeather.value = false
  if (walkState.value === 'walk') stage?.resumeWalkFromUi()
  toast(`天气：${WEATHER_LABELS[kind]}`)
}

function toggleLiveWeather(on: boolean, live?: LiveWeather) {
  liveWeatherOn.value = on
  if (!on) {
    liveWeather.value = null
    if (weatherOn.value) {
      weather.value = 'clear'
      stage?.setWeather('clear')
    }
    return
  }
  if (!live) return
  weatherOn.value = true
  liveWeather.value = live
  weather.value = live.kind
  stage?.setWeather(live.kind)
}

/** 场馆生成后自动拉取贵阳 / 上次查询城市的实时天气并应用 */
async function applyLiveWeatherForVenue() {
  // 移动端默认不自动开启实时天气；导入 / 恢复场景时保留文件内天气
  if (isMobile.value || !weatherOn.value || suppressAutoWeather || restoringProject) return
  const city = localStorage.getItem('grid-weather-city') || DEFAULT_WEATHER_CITY
  try {
    const live = await fetchAmapWeather(city)
    weatherOn.value = true
    liveWeatherOn.value = true
    liveWeather.value = live
    weather.value = live.kind
    stage?.setWeather(live.kind)
  } catch (err) {
    // 没有网络或 Key 未配置时保留当前天气，不影响场馆生成
    console.warn('实时天气获取失败', err)
  }
}

function toggleGrid() {
  gridOn.value = !gridOn.value
  stage?.setGridVisible(gridOn.value)
}

function toggleDimensions() {
  dimOn.value = !dimOn.value
  stage?.setDimensionsVisible(dimOn.value)
}

function toggleSunPlay() {
  sunPlaying.value = !sunPlaying.value
  stage?.setSunPaused(!sunPlaying.value)
}

/** 一键把模拟时间平滑拉回当前真实时间；保持播放 / 暂停状态 */
function resetSunToNow() {
  const p = currentSunProgress()
  if (stage) {
    stage.transitionSunTo(p, 900)
  } else {
    sunProgress.value = p
  }
  toast('已回到当前时间')
}

function chooseQuality(level: QualityLevel) {
  quality.value = level
  stage?.setQuality(level)
  toast(`画质已切换为${QUALITY_LABELS[level]}`)
}

function onSunScrub(e: Event) {
  const minutes = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(minutes)) return
  const progress = minutes / 1440
  sunProgress.value = progress
  stage?.setSunProgress(progress)
}

function startWalkPick() {
  if (!venue.value) {
    toast('请先绘制场馆')
    return
  }
  selectedIds.value = []
  mobilePanelOpen.value = false
  stage?.startWalkPick()
}

function toggleWalkView() {
  stage?.toggleWalkView()
}

/** 第一人称漫游：移动端竖屏先提示旋转，横屏后再选点 */
function toggleWalk() {
  if (walkState.value !== 'off') {
    stage?.stopWalk()
    return
  }
  if (!venue.value) {
    toast('请先绘制场馆')
    return
  }
  if (mode.value !== 'idle') {
    toast('请先完成当前编辑')
    return
  }
  if (isMobile.value) void requestWalkFullscreen()
  if (isMobile.value && isPortrait.value) {
    rotatePending = true
    showRotateHint.value = true
    return
  }
  startWalkPick()
}

function onOrientationChange() {
  isPortrait.value = window.innerHeight > window.innerWidth
  if (!isPortrait.value && showRotateHint.value) {
    showRotateHint.value = false
    if (rotatePending) {
      rotatePending = false
      startWalkPick()
      toast('已横屏，点击地面选择起点')
    }
  } else if (isPortrait.value && walkState.value === 'walk') {
    showRotateHint.value = true
  }
}

function cancelRotateHint() {
  rotatePending = false
  showRotateHint.value = false
  if (walkState.value !== 'off') stage?.stopWalk()
  else void exitWalkFullscreen()
}

async function requestWalkFullscreen() {
  if (!isMobile.value) return
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
    const orientation = window.screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>
    }
    if (orientation?.lock) await orientation.lock('landscape')
  } catch {
    /* 浏览器不支持全屏 / 方向锁定时静默降级 */
  }
}

async function exitWalkFullscreen() {
  if (!isMobile.value) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
  } catch {
    /* ignore */
  }
}

// 移动端点击模型后自动弹出结构抽屉，并滚动到对应属性
watch(
  [selectedIds, selectedInfraId],
  () => {
    if (!isMobile.value || renderOnly.value || walkState.value !== 'off') return
    mobilePanelOpen.value = selectedIds.value.length > 0 || !!selectedInfraId.value
  },
  { deep: true },
)

function onDraftHeight(v: number) {
  draftHeight.value = clampHeight(v)
}

function stickRadius(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    radius: Math.max(1, rect.width / 2 - 24),
    baseRadius: rect.width / 2,
  }
}

function updateMoveStick(e: PointerEvent) {
  const el = moveStickEl.value
  if (!el) return
  const { cx, cy, radius, baseRadius } = stickRadius(el)
  const rawX = e.clientX - cx
  const rawY = e.clientY - cy
  const len = Math.hypot(rawX, rawY)
  const clamped = Math.min(len, radius)
  const dx = len > 0 ? (rawX / len) * clamped : 0
  const dy = len > 0 ? (rawY / len) * clamped : 0
  moveKnob.x = dx / radius
  moveKnob.y = dy / radius

  // 超出第二个加速圈后逐渐提升到奔跑速度
  const boostStart = baseRadius * 1.3
  const boostEnd = baseRadius * 1.65
  moveBoost.value =
    len <= boostStart ? 0 : Math.min(1, (len - boostStart) / (boostEnd - boostStart))

  stage?.setWalkMove(moveKnob.x, -moveKnob.y, moveBoost.value)
}

function onMoveStickDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (movePointerId !== null) return
  movePointerId = e.pointerId
  updateMoveStick(e)
  // 在 window 上跟踪，不使用 pointer capture，避免抢占其他手指的按钮点击
  window.addEventListener('pointermove', onMoveStickMove)
  window.addEventListener('pointerup', onMoveStickUp)
  window.addEventListener('pointercancel', onMoveStickUp)
}

function onMoveStickMove(e: PointerEvent) {
  if (movePointerId !== e.pointerId) return
  e.preventDefault()
  updateMoveStick(e)
}

function onMoveStickUp(e: PointerEvent) {
  if (movePointerId !== e.pointerId) return
  movePointerId = null
  moveKnob.x = 0
  moveKnob.y = 0
  moveBoost.value = 0
  stage?.setWalkMove(0, 0, 0)
  window.removeEventListener('pointermove', onMoveStickMove)
  window.removeEventListener('pointerup', onMoveStickUp)
  window.removeEventListener('pointercancel', onMoveStickUp)
}

function onLookStickDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (lookPointerId !== null) return
  lookPointerId = e.pointerId
  lookLastX = e.clientX
  lookLastY = e.clientY
  lookKnob.x = 0
  lookKnob.y = 0
  window.addEventListener('pointermove', onLookStickMove)
  window.addEventListener('pointerup', onLookStickUp)
  window.addEventListener('pointercancel', onLookStickUp)
}

function onLookStickMove(e: PointerEvent) {
  if (lookPointerId !== e.pointerId) return
  e.preventDefault()
  const dx = e.clientX - lookLastX
  const dy = e.clientY - lookLastY
  lookLastX = e.clientX
  lookLastY = e.clientY
  stage?.lookWalk(dx, dy)
  lookKnob.x = Math.max(-1, Math.min(1, lookKnob.x + dx / 36))
  lookKnob.y = Math.max(-1, Math.min(1, lookKnob.y + dy / 36))
}

function onLookStickUp(e: PointerEvent) {
  if (lookPointerId !== e.pointerId) return
  lookPointerId = null
  lookKnob.x = 0
  lookKnob.y = 0
  window.removeEventListener('pointermove', onLookStickMove)
  window.removeEventListener('pointerup', onLookStickUp)
  window.removeEventListener('pointercancel', onLookStickUp)
}

function jumpMobileWalk() {
  stage?.jumpWalk()
}

function returnMobileWalk() {
  stage?.returnToWalkStart()
}

function exitMobileWalk() {
  stage?.stopWalk()
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
  stage?.setLabelsVisible(false)
  toast(`W1 示例场景已载入 · ${booths.value.length} 个展台 / ${infras.value.length} 个设施`)
}

// ---------- 同步与生命周期 ----------

function applyVenueXray() {
  if (!stage) return
  const boothMode = mode.value === 'draw-booth' || mode.value === 'height-booth'
  stage.setVenueXray(venueXray.value || boothMode)
}

function toggleVenueXray() {
  venueXray.value = !venueXray.value
  applyVenueXray()
}

function toggleVenueTop() {
  venueNoTop.value = !venueNoTop.value
  if (venue.value) venue.value = { ...venue.value, ceiling: !venueNoTop.value }
}

function syncPreview() {
  if (!stage) return
  const m = mode.value
  if (m === 'height-venue' || m === 'height-booth') {
    stage.setPreview(
      draftPoints.value,
      clampHeight(draftHeight.value),
      m === 'height-venue' ? 'venue' : 'booth',
      boothKind.value,
      true,
    )
  } else {
    stage.setPreview(null)
  }
}

function syncMode() {
  if (!stage) return
  const m = mode.value
  const placeKind = kindOfPlaceMode(m)
  if (!placeKind && m !== 'paste-booths') pendingInfraCopy = null
  if (!placeKind) stage.stopInfraPlace()
  if (m !== 'idle' && walkState.value !== 'off') stage.stopWalk()
  if (m === 'paste-booths') {
    if (!pasteClipboard) {
      mode.value = 'idle'
      return
    }
    stage.setMode('draw')
    stage.startBoothPaste(pasteClipboard)
  } else if (placeKind) {
    stage.setMode('draw')
    stage.startInfraPlace(
      placeKind,
      pendingInfraCopy?.kind === placeKind ? pendingInfraCopy : undefined,
    )
  } else if (m === 'draw-venue' || m === 'draw-booth') stage.setMode('draw')
  else if (m === 'height-venue' || m === 'height-booth') stage.setMode('confirm')
  else stage.setMode('idle')
  // 绘制展台时自动半透明；浏览时由用户开关决定
  applyVenueXray()
  syncPreview()
}

watch(
  [venue, booths, infras],
  ([v, b, i], [pv, pb, pi]) => {
    if (applyingHistory) return
    const venueChanged = v !== pv
    const boothsChanged = b !== pb
    const infrasChanged = i !== pi
    const changedCount = Number(venueChanged) + Number(boothsChanged) + Number(infrasChanged)
    if (changedCount > 1) stage?.setScene(v, b, i)
    else if (venueChanged) stage?.setVenue(v)
    else if (boothsChanged) stage?.setBooths(b)
    else if (infrasChanged) stage?.setInfras(i)
  },
  { deep: true },
)
// 首次生成 / 载入场馆后自动应用实时天气；高度调整不重复覆盖
watch(venue, (next, prev) => {
  if (next && !prev) void applyLiveWeatherForVenue()
})

watch(walkState, (state) => {
  window.clearInterval(walkPoseTimer)
  if (state === 'walk') {
    const tick = () => {
      walkPose.value = stage?.getWalkPose() ?? null
    }
    tick()
    walkPoseTimer = window.setInterval(tick, 100)
  } else {
    walkPose.value = null
    minimapExpanded.value = false
  }
})
watch(
  selectedInfraIds,
  (ids) => stage?.setSelectedInfras(ids),
  { deep: true },
)
watch(draftPoints, (v) => stage?.setDraft(v), { deep: true })
watch(selectedIds, (ids) => stage?.setSelected(ids), { deep: true })
watch(mode, syncMode)
watch(draftHeight, syncPreview)
watch(venueXray, () => applyVenueXray())
watch(gridWanted, (on) => {
  gridOn.value = on
  stage?.setGridVisible(on)
})

function onKey(e: KeyboardEvent) {
  if (presentationOn.value) {
    if (e.key === 'Escape') {
      e.preventDefault()
      exitPresentation()
    }
    return
  }

  // F1 在任何模式下都能打开 / 关闭帮助
  if (e.key === 'F1') {
    e.preventDefault()
    toolMenu.value = null
    if (showWeather.value) closeWeather()
    showHelp.value = !showHelp.value
    return
  }

  // 帮助打开时只响应关闭，不触发编辑快捷键
  if (showHelp.value) {
    if (e.key === 'Escape') {
      e.preventDefault()
      showHelp.value = false
    }
    return
  }

  // 天气面板打开时只响应关闭；关闭后默认回到晴天
  if (showWeather.value) {
    const closeKey =
      e.key === 'Escape' ||
      (!e.ctrlKey && !e.metaKey && e.altKey && e.key.toLowerCase() === 'w')
    if (closeKey) {
      e.preventDefault()
      closeWeather()
    }
    return
  }

  // Esc 优先关闭工具栏二级菜单
  if (e.key === 'Escape' && toolMenu.value) {
    e.preventDefault()
    toolMenu.value = null
    return
  }

  const el = e.target as HTMLElement | null
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')

  // P：进入 / 退出漫游，预览模式下也可用
  if (
    !typing &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    e.key.toLowerCase() === 'p'
  ) {
    e.preventDefault()
    toggleWalk()
    return
  }

  // Alt+W：编辑 / 预览模式打开天气面板；漫游中由 Stage 处理
  if (
    !typing &&
    !e.ctrlKey &&
    !e.metaKey &&
    e.altKey &&
    e.key.toLowerCase() === 'w' &&
    walkState.value === 'off'
  ) {
    e.preventDefault()
    openWeather()
    return
  }

  // 视角快捷键：T 俯视 / I 轴测 / F 适配，预览模式下也可用
  if (
    !typing &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    walkState.value === 'off'
  ) {
    const viewKey = e.key.toLowerCase()
    if (viewKey === 't') {
      e.preventDefault()
      toolMenu.value = null
      viewTop()
      return
    }
    if (viewKey === 'i') {
      e.preventDefault()
      toolMenu.value = null
      viewIso()
      return
    }
    if (viewKey === 'f') {
      e.preventDefault()
      toolMenu.value = null
      fitView()
      return
    }
    if (viewKey === 's') {
      e.preventDefault()
      toolMenu.value = null
      enterPresentation()
      return
    }
  }

  // 纯渲染模式禁用其他编辑快捷键
  if (renderOnly.value) return

  if (e.key === 'Escape') {
    if (mergeDialog.value) {
      mergeDialog.value = null
      return
    }
    if (mode.value === 'paste-booths') {
      cancelBoothPaste()
      return
    }
    if (isPlacing.value) {
      const wasCopy = !!pendingInfraCopy
      pendingInfraCopy = null
      mode.value = 'idle'
      if (wasCopy) toast('已取消复制')
    } else if (mode.value === 'draw-venue' || mode.value === 'draw-booth') cancelDraft()
    else if (mode.value === 'height-venue' || mode.value === 'height-booth') backToDraw()
    else selectedIds.value = []
    if (typing) (el as HTMLInputElement).blur()
    return
  }

  if (typing) {
    if (e.key === 'Enter' && (mode.value === 'height-venue' || mode.value === 'height-booth')) {
      e.preventDefault()
      confirmHeight()
      ;(el as HTMLInputElement).blur()
    }
    return
  }

  if (e.key === 'Enter') {
    if (mode.value === 'draw-venue' || mode.value === 'draw-booth') closeDraft()
    else if (mode.value === 'height-venue' || mode.value === 'height-booth') confirmHeight()
    return
  }

  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
    const key = e.key.toLowerCase()
    if (key === 'c' && !e.shiftKey) {
      if (selectedIds.value.length) {
        e.preventDefault()
        copySelectedBooths()
      } else if (selectedInfraId.value) {
        e.preventDefault()
        copySelectedInfra()
      }
      return
    }
    if (key === 'z') {
      e.preventDefault()
      if (mode.value === 'draw-venue' || mode.value === 'draw-booth') {
        undoPoint()
      } else if (e.shiftKey) {
        redo()
      } else {
        undo()
      }
      return
    }
    if (key === 'y') {
      e.preventDefault()
      redo()
      return
    }
  }

  if (e.key === 'Backspace' && (mode.value === 'draw-venue' || mode.value === 'draw-booth')) {
    e.preventDefault()
    undoPoint()
    return
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && mode.value === 'idle') {
    if (selectedIds.value.length) {
      e.preventDefault()
      deleteSelectedBooths()
      return
    }
    if (selectedInfraId.value) {
      e.preventDefault()
      deleteInfra(selectedInfraId.value)
      return
    }
  }

  if (e.key.toLowerCase() === 'g') toggleGrid()
}

onMounted(() => {
  if (!hostEl.value) return
  stage = new Stage(hostEl.value, {
    onPlace: handlePlace,
    onCloseDraft: closeDraft,
    onPick: handlePick,
    onHover: (p) => (hover.value = p),
    onMoveBooth: moveBooth,
    onRotateBooth: rotateBooth,
    onRotateInfra: (id, dir) => rotateInfra(id, dir),
    onRotateDrag: (deg) => (rotateDeg.value = deg),
    onSpaceNav: (on) => (spaceNavActive.value = on),
    onWalkView: (v) => (walkView.value = v),
    onWeatherShortcut: () => openWeather(),
    onHelp: () => openHelp(),
    onWalkState: (s) => {
      walkState.value = s
      if (s !== 'off') {
        mobilePanelOpen.value = false
        toolMenu.value = null
      }
      if (s === 'off') {
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
    onMoveInfra: (id, x, z, rotation) => moveInfra(id, x, z, rotation),
    onMoveInfras: (targets) => moveInfraGroup(targets),
    onNorthAngle: (deg) => (northDeg.value = Math.round(deg * 10) / 10),
    onSunTime: (p) => (sunProgress.value = p),
    onQualityChange: (level, auto) => {
      quality.value = level
      if (auto) {
        toast(`帧率较低，已自动切换为${QUALITY_LABELS[level]}画质`)
      }
    },
  })
  stage.setMode('idle')
  stage.setSunProgress(sunProgress.value)
  stage.setWeather(weather.value)
  stage.setParticleDensities(particleDensities.value)
  stage.setWeatherVisibility(weatherVisibility.value / 100)
  stage.setGridVisible(gridOn.value)
  stage.setBoothLabelsVisible(boothLabelsOn.value)
  stage.setInfraLabelsVisible(infraLabelsOn.value)
  stage.setBoothAreasVisible(areaOn.value)
  stage.setDimensionsVisible(dimOn.value)
  stage.setReadOnly(renderOnly.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onOrientationChange)
  window.addEventListener('orientationchange', onOrientationChange)
  void restoreStoredProject()

  // 对外 API：导出展台 list / 场景，导入场景，切换纯渲染模式
  ;(window as unknown as { gridMassing?: typeof gridMassingApi }).gridMassing = gridMassingApi
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__stage = stage
    w.__app = {
      venue,
      booths,
      infras,
      selectedIds,
      selectedInfraId,
      mode,
      venueXray,
      venueNoTop,
      areaOn,
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onOrientationChange)
  window.removeEventListener('orientationchange', onOrientationChange)
  window.removeEventListener('pointermove', onMoveStickMove)
  window.removeEventListener('pointerup', onMoveStickUp)
  window.removeEventListener('pointercancel', onMoveStickUp)
  window.removeEventListener('pointermove', onLookStickMove)
  window.removeEventListener('pointerup', onLookStickUp)
  window.removeEventListener('pointercancel', onLookStickUp)
  window.clearTimeout(toastTimer)
  window.clearTimeout(historyTimer)
  window.clearTimeout(autosaveTimer)
  window.clearInterval(walkPoseTimer)
  const w = window as unknown as { gridMassing?: typeof gridMassingApi }
  if (w.gridMassing === gridMassingApi) delete w.gridMassing
  stage?.dispose()
  stage = null
})
</script>

<template>
  <div
    class="app"
    :class="{
      'quality-low': quality === 'low',
      'is-mobile': isMobile,
      'is-walking': walkState !== 'off',
      presenting: presentationOn,
    }"
  >
  <div ref="hostEl" class="viewport" />

  <WalkMinimap
    v-if="walkState === 'walk' && !presentationOn"
    :venue="venue"
    :booths="booths"
    :infras="infras"
    :pose="walkPose"
    :mobile="isMobile"
    :expanded="minimapExpanded"
  />

  <button
    v-if="presentationOn"
    type="button"
    class="presentation-exit"
    @click="exitPresentation"
  >
    退出展示 · Esc
  </button>

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

    <header class="brand">
      <div class="brand-mark">
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        >
          <path d="M12 3 21 7.5v9L12 21 3 16.5v-9z" />
          <path d="M3 7.5 12 12l9-4.5M12 12v9" />
        </svg>
      </div>
      <div>
        <h1>
          <input
            v-if="editingVenueName"
            ref="venueNameInput"
            v-model="venueName"
            class="brand-name-input"
            maxlength="24"
            aria-label="场馆名称"
            @blur="finishVenueRename"
            @keydown.enter.prevent.stop="finishVenueRename"
            @keydown.esc.prevent.stop="cancelVenueRename"
          />
          <button
            v-else
            type="button"
            class="brand-name"
            title="点击重命名场馆"
            @click="beginVenueRename"
          >
            {{ venueName }}
          </button>
        </h1>
        <p>Grid Massing Studio</p>
      </div>
    </header>

    <div class="sim-clock" :class="{ night: !sunIsDay }" title="模拟时间">
      <div class="sim-clock-head">
        <svg v-if="sunIsDay" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <path
            d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" fill="currentColor" />
        </svg>
        <b>{{ simTime }}</b>
        <button
          class="sim-play"
          :title="sunPlaying ? '暂停时间' : '播放时间'"
          @click="toggleSunPlay"
        >
          <svg
            v-if="sunPlaying"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="7" y="5" width="3.5" height="14" rx="1" />
            <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </button>
        <button class="sim-now" title="回到当前时间" aria-label="回到当前时间" @click="resetSunToNow">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
            <path d="M20.5 4.5V10H15" />
            <path d="M12 7.5V12l3 1.8" />
          </svg>
        </button>
      </div>
      <div class="sim-track">
        <span>0:00</span>
        <input
          class="sim-range"
          type="range"
          min="0"
          max="1439"
          step="1"
          :value="sunMinutes"
          :style="{ '--fill': sunPercent }"
          @input="onSunScrub"
        />
        <span>23:59</span>
      </div>
    </div>

    <div
      v-if="!isMobile && liveWeather && weatherOn"
      class="sim-weather"
      :title="`${liveWeather.city} · ${liveWeather.weather} ${liveWeather.temperature}°C · 湿度 ${liveWeather.humidity}%`"
    >
      <div class="sim-weather-main">
        <WeatherIcon :kind="liveWeather.kind" :size="13" />
        <b>{{ liveWeather.weather }}</b>
      </div>
      <span>{{ liveWeather.temperature }}°C</span>
    </div>

    <div class="view-tools" :class="{ collapsed: toolsCollapsed }">
      <button
        v-if="isMobile"
        type="button"
        class="tool-collapse"
        :class="{ collapsed: toolsCollapsed }"
        :aria-expanded="!toolsCollapsed"
        :aria-label="toolsCollapsed ? '展开工具栏' : '收起工具栏'"
        :title="toolsCollapsed ? '展开工具栏' : '收起工具栏'"
        @click="toolsCollapsed = !toolsCollapsed; toolMenu = null"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m14 7-5 5 5 5" />
        </svg>
      </button>

      <div class="tool-main">
        <div class="tool-group">
          <button
            class="tool-btn tool-parent"
            :class="{ on: toolMenu === 'view' }"
            aria-haspopup="menu"
            :aria-expanded="toolMenu === 'view'"
            @click.stop="toggleToolMenu('view')"
          >
            视角<span class="tool-caret" />
          </button>
          <div v-if="!isMobile && toolMenu === 'view'" class="tool-menu" role="menu">
            <button
              class="tool-btn"
              role="menuitem"
              title="俯视 (T)"
              aria-keyshortcuts="T"
              @click="runTool(viewTop)"
            >
              俯视<kbd class="tool-menu-key">T</kbd>
            </button>
            <button
              class="tool-btn"
              role="menuitem"
              title="轴测 (I)"
              aria-keyshortcuts="I"
              @click="runTool(viewIso)"
            >
              轴测<kbd class="tool-menu-key">I</kbd>
            </button>
            <button
              class="tool-btn"
              role="menuitem"
              title="适配 (F)"
              aria-keyshortcuts="F"
              @click="runTool(fitView)"
            >
              适配<kbd class="tool-menu-key">F</kbd>
            </button>
            <button
              class="tool-btn"
              role="menuitem"
              :disabled="!venue"
              title="展示模式 (S)"
              aria-keyshortcuts="S"
              @click="runTool(enterPresentation)"
            >
              展示模式<kbd class="tool-menu-key">S</kbd>
            </button>
          </div>
        </div>

        <div class="tool-group">
          <button
            class="tool-btn tool-parent"
            :class="{ on: toolMenu === 'display' }"
            aria-haspopup="menu"
            :aria-expanded="toolMenu === 'display'"
            @click.stop="toggleToolMenu('display')"
          >
            显示<span class="tool-caret" />
          </button>
          <div v-if="!isMobile && toolMenu === 'display'" class="tool-menu" role="menu">
            <div class="tool-subgroup">
              <button
                class="tool-btn tool-parent tool-parent-sub"
                :class="{ on: toolSubMenu === 'names' }"
                role="menuitem"
                aria-haspopup="menu"
                :aria-expanded="toolSubMenu === 'names'"
                @click.stop="toggleNameSubmenu"
              >
                名称<span class="tool-caret" />
              </button>
              <div
                v-if="toolSubMenu === 'names'"
                class="tool-menu tool-menu-nested"
                role="menu"
              >
                <button
                  class="tool-btn"
                  :class="{ on: boothLabelsOn }"
                  role="menuitemcheckbox"
                  :aria-checked="boothLabelsOn"
                  @click.stop="toggleBoothLabels"
                >
                  展台
                </button>
                <button
                  class="tool-btn"
                  :class="{ on: infraLabelsOn }"
                  role="menuitemcheckbox"
                  :aria-checked="infraLabelsOn"
                  @click.stop="toggleInfraLabels"
                >
                  基础设施
                </button>
              </div>
            </div>
            <button
              class="tool-btn"
              :class="{ on: dimOn }"
              role="menuitem"
              @click="runTool(toggleDimensions)"
            >
              刻度
            </button>
            <button
              class="tool-btn"
              :class="{ on: areaOn }"
              role="menuitem"
              @click="runTool(toggleAreas)"
            >
              面积
            </button>
            <button
              class="tool-btn"
              :class="{ on: gridOn }"
              role="menuitem"
              @click="runTool(toggleGrid)"
            >
              网格
            </button>
          </div>
        </div>

        <div class="tool-group">
          <button
            class="tool-btn tool-parent"
            :class="{ on: toolMenu === 'quality' }"
            :title="`画质 · ${qualityLabel}`"
            aria-haspopup="menu"
            :aria-expanded="toolMenu === 'quality'"
            @click.stop="toggleToolMenu('quality')"
          >
            画质<span class="tool-caret" />
          </button>
          <div
            v-if="!isMobile && toolMenu === 'quality'"
            class="tool-menu"
            role="menu"
          >
            <button
              v-for="option in QUALITY_OPTIONS"
              :key="option.value"
              class="tool-btn"
              :class="{ on: quality === option.value }"
              role="menuitem"
              :aria-checked="quality === option.value"
              @click="runTool(() => chooseQuality(option.value))"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="tool-group">
          <button
            class="tool-btn tool-parent"
            :class="{ on: toolMenu === 'data' }"
            aria-haspopup="menu"
            :aria-expanded="toolMenu === 'data'"
            @click.stop="toggleToolMenu('data')"
          >
            数据<span class="tool-caret" />
          </button>
          <div v-if="!isMobile && toolMenu === 'data'" class="tool-menu" role="menu">
            <button class="tool-btn" role="menuitem" @click="runTool(downloadReportImage)">
              汇报图
            </button>
            <button class="tool-btn" role="menuitem" @click="runTool(downloadScene)">导出</button>
            <button
              v-if="!renderOnly"
              class="tool-btn"
              role="menuitem"
              @click="runTool(triggerImport)"
            >
              导入
            </button>
          </div>
        </div>

        <button
          class="tool-btn tool-with-key"
          :class="{ on: weatherOn && weather !== 'clear' }"
          title="天气面板 (Alt+W)"
          @click="runTool(openWeather)"
        >
          <span>天气</span>
          <kbd v-if="!isMobile" class="tool-key wide">Alt+W</kbd>
        </button>
        <button class="tool-btn tool-with-key" title="帮助 (F1)" @click="openHelp">
          <span>帮助</span>
          <kbd v-if="!isMobile" class="tool-key">F1</kbd>
        </button>
        <button
          class="tool-btn tool-with-key"
          :class="{ on: walkState !== 'off' }"
          :disabled="!venue"
          :title="venue ? '漫游 (P)' : '请先绘制场馆'"
          @click="runTool(toggleWalk)"
        >
          <span>漫游</span>
          <kbd v-if="!isMobile" class="tool-key">P</kbd>
        </button>
      </div>

      <div
        v-if="isMobile && toolMenu"
        :key="toolMenu"
        class="tool-mobile-sub"
        role="menu"
      >
        <template v-if="toolMenu === 'view'">
          <button class="tool-btn" role="menuitem" @click="runTool(viewTop)">俯视</button>
          <button class="tool-btn" role="menuitem" @click="runTool(viewIso)">轴测</button>
          <button class="tool-btn" role="menuitem" @click="runTool(fitView)">适配</button>
          <button
            class="tool-btn"
            role="menuitem"
            :disabled="!venue"
            @click="runTool(enterPresentation)"
          >
            展示模式
          </button>
        </template>
        <template v-else-if="toolMenu === 'display'">
          <button
            class="tool-btn tool-parent tool-parent-sub"
            :class="{ on: toolSubMenu === 'names' }"
            role="menuitem"
            aria-haspopup="menu"
            :aria-expanded="toolSubMenu === 'names'"
            @click.stop="toggleNameSubmenu"
          >
            名称<span class="tool-caret" />
          </button>
          <div
            v-if="toolSubMenu === 'names'"
            class="tool-mobile-sub3"
            role="menu"
          >
            <button
              class="tool-btn"
              :class="{ on: boothLabelsOn }"
              role="menuitemcheckbox"
              :aria-checked="boothLabelsOn"
              @click.stop="toggleBoothLabels"
            >
              展台
            </button>
            <button
              class="tool-btn"
              :class="{ on: infraLabelsOn }"
              role="menuitemcheckbox"
              :aria-checked="infraLabelsOn"
              @click.stop="toggleInfraLabels"
            >
              基础设施
            </button>
          </div>
          <button
            class="tool-btn"
            :class="{ on: dimOn }"
            role="menuitem"
            @click="runTool(toggleDimensions)"
          >
            刻度
          </button>
          <button
            class="tool-btn"
            :class="{ on: areaOn }"
            role="menuitem"
            @click="runTool(toggleAreas)"
          >
            面积
          </button>
          <button
            class="tool-btn"
            :class="{ on: gridOn }"
            role="menuitem"
            @click="runTool(toggleGrid)"
          >
            网格
          </button>
        </template>
        <template v-else-if="toolMenu === 'quality'">
          <button
            v-for="option in QUALITY_OPTIONS"
            :key="option.value"
            class="tool-btn"
            :class="{ on: quality === option.value }"
            role="menuitem"
            @click="runTool(() => chooseQuality(option.value))"
          >
            {{ option.label }}
          </button>
        </template>
        <template v-else-if="toolMenu === 'data'">
          <button class="tool-btn" role="menuitem" @click="runTool(downloadReportImage)">
            汇报图
          </button>
          <button class="tool-btn" role="menuitem" @click="runTool(downloadScene)">导出</button>
          <button
            v-if="!renderOnly"
            class="tool-btn"
            role="menuitem"
            @click="runTool(triggerImport)"
          >
            导入
          </button>
        </template>
      </div>
    </div>

    <div v-if="!isMobile || walkState === 'off'" class="mode-switch">
      <button class="mode-btn" :class="{ on: !renderOnly }" @click="setRenderOnly(false)">
        编辑
      </button>
      <button class="mode-btn" :class="{ on: renderOnly }" @click="setRenderOnly(true)">
        预览
      </button>
      <span class="mode-divider" />
      <button class="mode-icon" :disabled="!canUndo" title="撤销 Ctrl+Z" @click="undo">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 7 4 12l5 5" />
          <path d="M4 12h9a5 5 0 0 1 5 5v1" />
        </svg>
      </button>
      <button class="mode-icon" :disabled="!canRedo" title="重做 Ctrl+Y" @click="redo">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m15 7 5 5-5 5" />
          <path d="M20 12h-9a5 5 0 0 0-5 5v1" />
        </svg>
      </button>
    </div>

    <input
      ref="importInput"
      type="file"
      accept="application/json,.json"
      class="hidden-file"
      @change="onImportFile"
    />

    <div class="compass" title="指北罗盘 · N 指向北方">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <line
          v-for="i in 12"
          :key="i"
          x1="32"
          y1="5"
          x2="32"
          :y2="i % 3 === 0 ? 10 : 7.5"
          :class="i % 3 === 0 ? 'compass-tick-major' : 'compass-tick'"
          :transform="`rotate(${i * 30} 32 32)`"
        />
        <g :transform="`rotate(${northDeg} 32 32)`">
          <path class="compass-north" d="M32 15 L36.5 32 L32 29 L27.5 32 Z" />
          <path class="compass-south" d="M32 49 L27.5 32 L32 35 L36.5 32 Z" />
          <text class="compass-n" x="32" y="10" text-anchor="middle">N</text>
        </g>
      </svg>
    </div>

    <div v-if="spaceNavActive && !isMobile" class="walk-tip space-nav-tip">
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
      <span>{{ walkInteract.open ? '关闭' : '打开' }}「{{ walkInteract.name }}」</span>
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
        @pointerdown.stop.prevent="toggleWalkView"
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
        <span>{{ walkState !== 'off' ? '横屏后继续漫游' : '横屏后自动进入漫游' }}</span>
        <button class="rotate-cancel" @pointerdown.stop @click.stop="cancelRotateHint">
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

    <div v-if="rotateDeg !== null" class="coord" :class="{ snap: rotateSnapped }">
      <div class="coord-item"><span>旋转</span><b>{{ rotateDisplay }}</b><i>°</i></div>
    </div>

    <div v-if="isDrawing" class="coord">
      <div class="coord-item"><span>X</span><b>{{ hover ? hover.x.toFixed(0) : '—' }}</b><i>m</i></div>
      <div class="coord-item"><span>Z</span><b>{{ hover ? hover.z.toFixed(0) : '—' }}</b><i>m</i></div>
      <div class="sep" />
      <div class="coord-item"><span>边长</span><b>{{ segmentLength ? segmentLength.toFixed(1) : '—' }}</b><i>m</i></div>
    </div>

    <div v-if="gridOn" class="legend"><i />网格 1 格 = 1 米</div>

    <Transition name="panel-slide" :css="!isMobile">
      <div
        v-if="!renderOnly && !showWelcome"
        class="panel-dock"
        :class="{ docked: mobileDocked, expanded: mobileDocked && dockExpanded }"
      >
      <Inspector
        :class="{ 'mobile-open': mobilePanelOpen }"
      :mobile-open="mobilePanelOpen"
      :venue="venue"
      :booths="booths"
      :mode="mode"
      :space-nav="spaceNavActive"
      :selected-ids="selectedIds"
      :venue-area="venueArea"
      :booth-area="boothsArea"
      :coverage="coverage"
      @draw-venue="startVenueDraw"
      @draw-booth="startBoothDraw"
      @booth-canopy="setBoothCanopy"
      @booth-top="setBoothNoTop"
      @delete-venue="deleteVenue"
      @delete-booth="deleteBooth"
      @select="selectBoothFromPanel"
      @venue-height="changeVenueHeight"
      @booth-height="changeBoothHeight"
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
      @delete-infra="deleteInfra"
      @infra-size="updateInfraDims"
      @rotate-infra="rotateInfra"
      @toggle-gate="toggleGate"
      @infra-count="changeInfraCount"
      @rename-infra="renameInfra"
      />
      </div>
    </Transition>

    <button
      v-if="mobileDocked && !showWelcome"
      type="button"
      class="dock-toggle"
      :class="{ expanded: dockExpanded }"
      :aria-expanded="dockExpanded"
      :aria-label="dockExpanded ? '收起结构' : '展开结构'"
      :title="dockExpanded ? '收起结构' : '展开结构'"
      @pointerdown.stop
      @click="dockExpanded = !dockExpanded"
    >
      <svg
        v-if="dockExpanded"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
      <svg
        v-else
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>

    <div class="dock-wrap">
      <ActionDock
        v-if="!renderOnly && mode !== 'idle' && !isPlacing"
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

    <div
      v-if="showWelcome"
      class="welcome"
      :class="{ 'dock-open': mobileDocked && dockExpanded }"
    >
      <h2>用面积图生成场馆白膜</h2>
      <p>在地面网格上依次点击顶点，画出场地平面，输入高度即可生成白膜体量。</p>
      <ol class="steps">
        <li><i>1</i>绘制场馆轮廓（网格 1 格 = 1 米）</li>
        <li><i>2</i>输入净高，生成场馆白膜</li>
        <li><i>3</i>在馆内画出展台并设定高度</li>
      </ol>
      <div class="welcome-actions">
        <button class="btn primary" @click="startVenueDraw">开始绘制</button>
        <button class="btn" @click="loadSample">载入示例</button>
        <button class="btn" @click="showHelp = true">帮助</button>
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
          <button class="btn" @click="applyMerge(false)">保留各自高度</button>
          <button class="btn primary" @click="applyMerge(true)">
            统一为 {{ mergeDialog.targetHeight.toFixed(2) }} m
          </button>
        </div>
      </div>
    </div>

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

    <HelpMobilePanel v-if="showHelp && isMobile" @close="showHelp = false" />
    <HelpPanel
      v-else-if="showHelp"
      :grid-on="gridOn"
      :labels-on="labelsOn"
      :areas-on="areaOn"
      :can-walk="!!venue && mode === 'idle'"
      @quick="runHelpQuickAction"
      @close="showHelp = false"
    />

    <transition name="toast">
      <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
    </transition>
  </div>
</template>
