import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import {
  BOOTH_SKIRT,
  BOOTH_WALL,
  boothGapLength,
  buildBooth,
  buildInfra,
  buildMassing,
  buildOpenFloorBooth,
  buildScaffoldBooth,
  getBoothWallNormalMap,
  getScaffoldMetalNormalMap,
  getVenueWallNormalMap,
  setGateOpenAmount,
  type InfraOpening,
  type MassingOpening,
} from './build'
import { OPEN_FLOOR_HEIGHT, boothKindOf } from './booth'
import { groupColor } from './groupColor'
import {
  ELEVATOR_DEFAULT_COUNT,
  INFRA_DEFAULTS,
  WINDOW_SILL,
  isFurnitureKind,
} from './infra'
import { CloudShadow } from './CloudShadow'
import { SkyClouds } from './SkyClouds'
import { UNDERLAY_MIN_SIZE, clampUnderlaySpec } from './underlay'
import { WeatherSystem } from './WeatherSystem'
import {
  buildWalkTour,
  walkTourStopInfo,
  type WalkTourInfo,
  type WalkTourStop,
  type WalkTourPoint,
} from './walkTour'
import {
  WEATHER_PRESETS,
  type ParticleDensities,
  type WeatherKind,
} from './weather'
import {
  boundsOf,
  centroid,
  insetPolygon,
  pointInPolygon,
  polygonArea,
  signedArea,
  snapToGrid,
} from './polygon'
import type { Booth, BoothKind, BoothMark, Infra, InfraKind, Pt, Underlay, Venue } from './types'

export type StageMode = 'idle' | 'draw' | 'confirm'

/** 渲染质量：极致为实时灯光，其余档位按 GPU / 帧率自动降级 */
export type QualityLevel = 'ultra' | 'high' | 'medium' | 'low'

function detectGpuQuality(gpu: string): QualityLevel {
  const s = gpu.toLowerCase()
  if (/swiftshader|llvmpipe|software|basic render driver/.test(s)) return 'low'
  if (/mali|adreno|powervr|intel\(r\) hd|intel\(r\) uhd|intel iris/.test(s)) return 'medium'
  if (/android|iphone|ipad|mobile/.test(navigator.userAgent.toLowerCase())) return 'low'
  return 'high'
}

/** 第一人称状态：off 关闭 / pick 选起始点 / enter 视角过渡中 / walk 漫游中 */
export type WalkState = 'off' | 'pick' | 'enter' | 'walk'
export type WalkView = 'first' | 'third'

/** 多人漫游同步的本地状态，y 为脚底高度 */
export interface WalkNetState {
  x: number
  z: number
  y: number
  yaw: number
  pitch: number
  view: WalkView
  auto: boolean
}

export interface RemoteWalkPlayer {
  id: string
  nickname: string
  state: WalkNetState
}

interface RemoteAvatar {
  group: THREE.Group
  body: THREE.Mesh
  visor: THREE.Mesh
  labelEl: HTMLDivElement
  target: THREE.Vector3
  yaw: number
  yawTarget: number
  pitch: number
  pitchTarget: number
  nickname: string
  color: THREE.Color
}

export interface BoothPastePayload {
  booths: Booth[]
  infras: Infra[]
  center: Pt
}

export interface ReportImageOptions {
  title: string
  subtitle?: string
  stats?: { label: string; value: string }[]
  width?: number
  height?: number
}

export interface StageOptions {
  onPlace?: (p: Pt) => void
  onCloseDraft?: () => void
  /** 拖拽拉出矩形：参数为两个对角点（已吸附到 1 m 网格） */
  onDrawRect?: (a: Pt, b: Pt) => void
  onPick?: (id: string | null, additive: boolean, kind?: 'booth' | 'infra') => void
  onHover?: (p: Pt | null) => void
  onMoveBooth?: (id: string, dx: number, dz: number) => void
  onRotateBooth?: (id: string, deltaDeg: number) => void
  onRotateInfra?: (id: string, dir: 1 | -1) => void
  onRotateDrag?: (deg: number | null) => void
  /** 按住空格进入 / 退出纯视角浏览模式 */
  onSpaceNav?: (on: boolean) => void
  onWalkState?: (state: WalkState) => void
  onWalkView?: (view: WalkView) => void
  /** 自动巡游开关变化 */
  onWalkAuto?: (on: boolean) => void
  /** 无法生成巡游路线 */
  onWalkAutoFail?: () => void
  /** 自动巡游当前 / 下一站信息 */
  onWalkTourInfo?: (info: WalkTourInfo) => void
  /** 自动巡游时按 U 隐藏 / 恢复除巡游栏外的界面 */
  onWalkUiHidden?: (hidden: boolean) => void
  /** 是否允许自动巡游时按 U 清屏；多人房间关闭 */
  allowWalkUiHidden?: boolean
  /** 键盘调整巡游速度 / 循环时同步到界面 */
  onWalkAutoSpeed?: (speed: number) => void
  onWalkAutoLoop?: (loop: boolean) => void
  /** 漫游中按住 M 临时放大缩略地图 */
  onMinimapHold?: (expanded: boolean) => void
  onHelp?: () => void
  onPlaceInfra?: (
    kind: InfraKind,
    spot: { x: number; z: number; rotation: number; hostHeight?: number },
  ) => void
  /** 复制展台组后点击落位，参数为新组中心 */
  onPlacePaste?: (center: Pt) => void
  onMoveInfra?: (id: string, x: number, z: number, rotation: number) => void
  /** 相邻基础设施整体拖动后的落位 */
  onMoveInfras?: (targets: { id: string; x: number; z: number; rotation: number }[]) => void
  /** 世界北方向在屏幕上的角度：0 为向上，正值顺时针 */
  onNorthAngle?: (deg: number) => void
  /** 模拟时间进度：0 = 午夜，0.5 = 正午 */
  onSunTime?: (progress: number) => void
  /** 画质变化：auto 为 true 表示帧率过低自动降级 */
  onQualityChange?: (level: QualityLevel, auto: boolean) => void
  /** 漫游时准星对准的可交互出入口，null 表示没有目标 */
  onWalkInteract?: (target: { id: string; name: string; open: boolean } | null) => void
  /** 漫游时请求切换出入口开关 */
  onToggleGate?: (id: string) => void
  /** 漫游中 Alt+W 请求打开天气面板 */
  onWeatherShortcut?: () => void
  /** 漫游中按 Y 打开消息输入 */
  onMessageShortcut?: () => void
  /** 手动天气变化 */
  onWeatherChange?: (kind: WeatherKind) => void
  /** 底图被 Ctrl + 拖动 / 滚轮缩放后回传新的位置与尺寸 */
  onUnderlayChange?: (spec: Underlay) => void
}

const SNAP = 1
const EDGE_SNAP = 0.5
/** 出入口开合过渡时长（毫秒） */
const GATE_ANIM_MS = 460
const GRID_HALF = 80
/**
 * 底图离地高度：明显高于场馆地面板（0.012 m），又低于展台 0.15 m 台板。
 * 留出足够深度差，远距离 / 低角度下也不会被地面板遮挡。
 */
const UNDERLAY_Y = 0.09
/** Ctrl + 滚轮：一格滚轮 / 累计约 80px 缩放 1 m */
const UNDERLAY_WHEEL_NOTCH = 80
const ACCENT = 0x2f5fe0
/** 标记分组配色 */
const MARK_PALETTE: Record<BoothMark, { wall: number; floor: number }> = {
  red: { wall: 0xe05252, floor: 0xcf4747 },
  yellow: { wall: 0xe0b84c, floor: 0xd9b23c },
  gray: { wall: 0x969ca3, floor: 0xb9bdc2 },
}

function boothMark(b: Booth): BoothMark | null {
  return b.mark ?? (b.marked ? 'red' : null)
}

/** 去掉顶部的标准展台只剩低围挡，标注与选择框按围挡高度显示 */
function boothVisibleHeight(b: Booth): number {
  return b.noTop ? Math.min(b.height, BOOTH_SKIRT) : b.height
}

/** 动态太阳：按真实时间推进，24 小时一个昼夜循环 */
const DAY_SECONDS = 24 * 60 * 60

/** 当前本地时间在一天中的比例 */
function currentSunProgress(): number {
  const now = new Date()
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  return seconds / DAY_SECONDS
}
const SUN_WARM = new THREE.Color(0xffb37a)
const SUN_NOON = new THREE.Color(0xfff7ea)
const NIGHT_SKY = new THREE.Color(0x4d5f7a)
const DAY_SKY = new THREE.Color(0xffffff)
const NIGHT_GROUND = new THREE.Color(0x2f3a4a)
const DAY_GROUND = new THREE.Color(0xc9c4b8)
const NIGHT_FILL = new THREE.Color(0x5d708f)
const DAY_FILL = new THREE.Color(0xdce6ff)
// 每帧复用的临时颜色，避免 updateSun 产生额外 GC
const SKY_DAY_TMP = new THREE.Color()
const SKY_DAY_TO_TMP = new THREE.Color()
const SKY_NIGHT_TMP = new THREE.Color()
const SKY_NIGHT_TO_TMP = new THREE.Color()
const SKY_MIX_TMP = new THREE.Color()

interface WeatherEnvironment {
  skyDay: number
  skyNight: number
  fogNear: number
  fogFar: number
  sunScale: number
  fillScale: number
  hemiScale: number
}

function weatherEnvironmentOf(kind: WeatherKind): WeatherEnvironment {
  const preset = WEATHER_PRESETS[kind]
  return {
    skyDay: preset.skyDay,
    skyNight: preset.skyNight,
    fogNear: preset.fogNear,
    fogFar: preset.fogFar,
    sunScale: preset.sunScale,
    fillScale: preset.fillScale,
    hemiScale: preset.hemiScale,
  }
}

/** 平滑插值（0 → 1） */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 第一人称：人眼高度、行走/奔跑速度、重力与起跳速度 */
const EYE_HEIGHT = 1.62
const WALK_SPEED = 3.2
const RUN_SPEED = 6.8
const GRAVITY = 15
const JUMP_SPEED = 5.6
/** 与场馆墙体保持的安全距离（墙体厚 0.24m） */
const WALL_PAD = 0.5
const MOUSE_SENS = 0.0021
/** 自动巡游每个展台停留时长：留足看名称 / 展商 / 面积的时间 */
const WALK_TOUR_DWELL = 6000

interface DragState {
  id: string
  kind: 'move' | 'rotate'
  sx: number
  sy: number
  origin: Pt
  center: Pt
  dx: number
  dz: number
  angle: number
  targets: THREE.Object3D[]
  baseRotY: number
}

interface InfraDragItem {
  id: string
  spec: Infra
  group: THREE.Group
  x: number
  z: number
  rotation: number
}

/** 基础设施拖动：直接移动 mesh，释放后再回写数据；items 支持相邻多选整体拖动 */
interface InfraDragState {
  id: string
  spec: Infra
  group: THREE.Group
  sx: number
  sy: number
  /** 按下时的地面点，用于家具自由拖动 */
  origin: Pt
  x: number
  z: number
  rotation: number
  moved: boolean
  items: InfraDragItem[]
}

function disposeDeep(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat?.dispose()
  })
}

/** 合并组的外轮廓（仅当结果是单一多边形时有效） */
function unionOutline(polys: Pt[][]): Pt[] | null {
  if (!polys.length) return null
  const geoms: Polygon[] = polys.map((pts) => {
    const ring = pts.map((p) => [p.x, p.z] as [number, number])
    ring.push([pts[0].x, pts[0].z])
    return [ring]
  })
  let res: Polygon[]
  try {
    res = polygonClipping.union(geoms[0], ...geoms.slice(1))
  } catch {
    return null
  }
  if (!res || res.length !== 1) return null
  const ring = res[0][0]
  if (!ring || ring.length < 4) return null
  const out = ring.slice(0, -1).map(([x, z]) => ({ x, z }))
  return out.length >= 3 ? out : null
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    disposeDeep(child)
  }
}

function openingsSig(list: MassingOpening[]): string {
  return list
    .map(
      (o) =>
        `${o.x.toFixed(2)},${o.z.toFixed(2)},${o.width.toFixed(2)},${o.height.toFixed(2)},${(o.sill ?? 0).toFixed(2)}`,
    )
    .join('|')
}

interface SnapBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function snapBoxOfPoints(points: Pt[]): SnapBox {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  return { minX, maxX, minZ, maxZ }
}

function snapBoxOfInfra(infra: Infra): SnapBox {
  const ux = Math.cos(infra.rotation)
  const uz = -Math.sin(infra.rotation)
  const vx = Math.sin(infra.rotation)
  const vz = Math.cos(infra.rotation)
  const hw = infra.width / 2
  const hd = infra.depth / 2
  const corners = [
    { x: infra.x + ux * hw + vx * hd, z: infra.z + uz * hw + vz * hd },
    { x: infra.x + ux * hw - vx * hd, z: infra.z + uz * hw - vz * hd },
    { x: infra.x - ux * hw - vx * hd, z: infra.z - uz * hw - vz * hd },
    { x: infra.x - ux * hw + vx * hd, z: infra.z - uz * hw + vz * hd },
  ]
  return snapBoxOfPoints(corners)
}

function rangeGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.max(0, bMin - aMax, aMin - bMax)
}

/** 把移动盒的边缘吸附到附近目标盒的边缘，返回吸附后的位移与目标框 */
function snapEdgeDelta(
  moving: SnapBox,
  dx: number,
  dz: number,
  targets: SnapBox[],
  threshold: number,
): { dx: number; dz: number; target: SnapBox | null } {
  let bestX = 0
  let bestZ = 0
  let xTarget: SnapBox | null = null
  let zTarget: SnapBox | null = null
  let xBest = threshold + 0.0001
  let zBest = threshold + 0.0001

  const m = {
    minX: moving.minX + dx,
    maxX: moving.maxX + dx,
    minZ: moving.minZ + dz,
    maxZ: moving.maxZ + dz,
  }

  // 先处理 X 方向；另一轴需要足够接近，避免吸到远处对象
  for (const target of targets) {
    if (rangeGap(m.minZ, m.maxZ, target.minZ, target.maxZ) > threshold) continue
    const candidates = [target.minX - m.maxX, target.maxX - m.minX]
    for (const adjust of candidates) {
      const dist = Math.abs(adjust)
      if (dist < xBest) {
        xBest = dist
        bestX = adjust
        xTarget = target
      }
    }
  }
  m.minX += bestX
  m.maxX += bestX

  for (const target of targets) {
    if (rangeGap(m.minX, m.maxX, target.minX, target.maxX) > threshold) continue
    const candidates = [target.minZ - m.maxZ, target.maxZ - m.minZ]
    for (const adjust of candidates) {
      const dist = Math.abs(adjust)
      if (dist < zBest) {
        zBest = dist
        bestZ = adjust
        zTarget = target
      }
    }
  }

  return { dx: dx + bestX, dz: dz + bestZ, target: xTarget ?? zTarget }
}

/** 兼容纯 base64 与旧版 data URL 两种 Logo 存储 */
function boothLogoDataUrl(logo: string): string {
  return logo.startsWith('data:') ? logo : `data:image/png;base64,${logo}`
}

/** 展台正面标识：Logo 在左、名称在右，合成到一张透明画布 */
function boothSignTexture(b: Booth): { texture: THREE.CanvasTexture; aspect: number } | null {
  if (!b.logo) return null

  const fontSize = 64
  const font = `600 ${fontSize}px "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`
  const subFont = '500 34px "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
  const padding = 24
  const logoBox = 160
  const gap = 28
  const maxTextW = 900
  const exhibitor = b.exhibitor?.trim() ?? ''

  const measureCtx = document.createElement('canvas').getContext('2d')
  let textW = b.name.length * fontSize * 0.72
  if (measureCtx) {
    measureCtx.font = font
    textW = measureCtx.measureText(b.name).width
    if (exhibitor) {
      measureCtx.font = subFont
      textW = Math.max(textW, measureCtx.measureText(exhibitor).width)
    }
  }

  const width = Math.ceil(padding * 2 + logoBox + gap + Math.min(textW, maxTextW))
  const height = 224
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = font
  ctx.fillStyle = '#191b1f'
  ctx.fillText(
    b.name,
    padding + logoBox + gap,
    height / 2 + (exhibitor ? -22 : 2),
    maxTextW,
  )
  if (exhibitor) {
    ctx.font = subFont
    ctx.fillStyle = '#5f6875'
    ctx.fillText(exhibitor, padding + logoBox + gap, height / 2 + 30, maxTextW)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  const img = new Image()
  img.onload = () => {
    const scale = Math.min(logoBox / img.width, logoBox / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.drawImage(img, padding + (logoBox - dw) / 2, (height - dh) / 2, dw, dh)
    texture.needsUpdate = true
  }
  img.src = boothLogoDataUrl(b.logo)

  return { texture, aspect: width / height }
}

/**
 * 三维舞台：渲染、拾取、绘制预览与相机控制
 */
export class Stage {
  private host: HTMLElement
  private opts: StageOptions
  private renderer: THREE.WebGLRenderer
  private labelRenderer: CSS2DRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private keyLight: THREE.DirectionalLight
  private fillLight!: THREE.DirectionalLight
  private hemiLight!: THREE.HemisphereLight
  private moonLight!: THREE.DirectionalLight
  /** 太阳/昼夜进度：0 = 午夜，0.5 = 正午 */
  private sunProgress = currentSunProgress()
  private sunPaused = false
  private sunRadius = 160
  private lastSunMinute = -1
  private weather: WeatherKind = 'clear'
  /** 天气环境过渡：天空、雾和主光使用平滑插值，粒子仍即时切换 */
  private weatherFrom = weatherEnvironmentOf('clear')
  private weatherTo = weatherEnvironmentOf('clear')
  private weatherBlend = 1
  private weatherTransitionStart = 0
  /** 能见度倍率：1 为天气预设，0.1–2 由面板滑块控制 */
  private weatherVisibility = 1
  private weatherSystem!: WeatherSystem
  private cloudShadow!: CloudShadow
  private skyClouds!: SkyClouds
  private sunBaseIntensity = 0
  private sunDayFactor = 0
  /** 回到当前时间时的光照过渡 */
  private sunTransition: {
    from: number
    delta: number
    start: number
    duration: number
  } | null = null
  /** 夜晚展馆照明：无点光源，使用自发光灯泡 + 地面光池贴图 */
  private venueLightRoot = new THREE.Group()
  private venueBulbs: THREE.InstancedMesh | null = null
  private venuePool: THREE.Mesh | null = null
  /** 极致画质下的实时场馆聚光灯：只向下半球发光 */
  private venueSpotLights: THREE.SpotLight[] = []
  private venueBulbGeo = new THREE.SphereGeometry(0.12, 8, 6)
  private venueBulbMat = new THREE.MeshBasicMaterial({
    color: 0xffdca8,
    transparent: true,
    opacity: 0,
  })
  private ro: ResizeObserver
  private raf = 0
  private shadowUpdateAt = 0
  private lastCompassAt = 0
  private lastCompassDeg = Number.NaN
  private lastLabelAt = 0
  private lastLabelCamera = new THREE.Matrix4()
  private labelCameraReady = false
  private areaProbe = new THREE.Vector3()

  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private raycaster = new THREE.Raycaster()

  private gridGroup = new THREE.Group()
  private modelRoot = new THREE.Group()
  private previewRoot = new THREE.Group()
  private draftRoot = new THREE.Group()
  private draftContent = new THREE.Group()

  // 底图（参考图）：铺在地面上，支持 Ctrl + 拖动 / 滚轮缩放
  private underlayGroup = new THREE.Group()
  private underlayMesh: THREE.Mesh | null = null
  private underlayTexture: THREE.Texture | null = null
  private underlaySpec: Underlay | null = null
  private underlayImage = ''
  private underlayToken = 0
  private underlayWheelAcc = 0
  private underlayDrag: {
    startX: number
    startZ: number
    origin: Pt
  } | null = null

  private venue: Venue | null = null
  private venueGroup: THREE.Group | null = null
  private venueOpenings: MassingOpening[] = []
  private venueOpeningSig = ''

  // 渲染质量与低端 GPU 降级
  private quality: QualityLevel = 'high'
  private autoQuality = true
  private qualitySkip = 120
  private qualityFrames = 0
  private qualityTime = 0

  // 尺寸刻度与指北标
  private dimensionRoot = new THREE.Group()
  private dimensionLabels: CSS2DObject[] = []
  private dimensionVisible = false
  private dimLineMat = new THREE.LineBasicMaterial({
    color: 0x8b9099,
    transparent: true,
    opacity: 0.8,
  })

  // 指北罗盘角度计算
  private northForward = new THREE.Vector3()
  private lastNorthDeg = 0
  private boothGroups = new Map<string, THREE.Group>()
  private boothSpecs = new Map<string, Booth>()
  private boothLogoRoot = new THREE.Group()
  private boothLogos: { texture: THREE.Texture }[] = []
  private groupMeshes = new Map<string, THREE.Group>()
  private groupMembers = new Map<string, string[]>()
  private pickables: THREE.Object3D[] = []
  private previewGroup: THREE.Group | null = null
  private pasteGhost: THREE.Group | null = null
  private pasteCenter: Pt = { x: 0, z: 0 }
  private pasteTarget: Pt | null = null
  private pasteBaseBox: SnapBox | null = null
  private pasteTargets: SnapBox[] = []
  private snapGuide: THREE.Line | null = null
  private infraPlaceWidth = 1
  private infraPlaceDepth = 1
  private selectionBoxes = new Map<string, { helper: THREE.Box3Helper; base: THREE.Box3 }>()
  private labels: {
    obj: CSS2DObject
    line: THREE.Line
    base: THREE.Vector3
    height: number
  }[] = []
  private boothLabelsVisible = true
  private infraLabelsVisible = false
  private presentation = false
  private labelsBeforePresentation = { booth: true, infra: true }
  private areaLabels: CSS2DObject[] = []
  private areasVisible = false
  private selectedIds: string[] = []
  private drag: DragState | null = null
  private venueXray = false
  /** 摆放家具时，标准展台顶板 / 脚手架顶棚半透明 */
  private boothTopsXray = false

  // 基础设施
  private infras: Infra[] = []
  private infraGroups = new Map<string, THREE.Group>()
  /** 家具在展台台面上的落位高度 */
  private infraBaseYMap = new Map<string, number>()
  private infraPickables: THREE.Object3D[] = []
  private selectedInfraIds: string[] = []
  private infraBoxes = new Map<string, THREE.Box3Helper>()
  private gateAnims = new Map<
    string,
    { group: THREE.Group; start: number; from: number; to: number }
  >()
  private infraKind: InfraKind | null = null
  private infraPlaceRotation = 0
  private prevRightMouse: THREE.MOUSE | null | undefined
  private infraGhost: THREE.Group | null = null
  private infraSpot: {
    x: number
    z: number
    rotation: number
    hostHeight?: number
  } | null = null
  private infraDrag: InfraDragState | null = null
  private infraLabels: { obj: CSS2DObject; line: THREE.Line }[] = []

  // 第一人称出入口交互
  private walkForward = new THREE.Vector3()
  private walkInteractId: string | null = null
  private walkInteractKey = ''

  // 第一人称漫游
  private walkState: WalkState = 'off'
  private walkPos = new THREE.Vector3()
  private walkVelY = 0
  private walkYaw = 0
  private walkPitch = 0
  private walkOnGround = true
  private walkKeys = new Set<string>()
  private walkMove = { x: 0, z: 0 }
  private walkMoveBoost = 0
  private walkView: WalkView = 'first'
  // 自动巡游
  private walkAuto = false
  private walkAutoSpeed = 0.8
  private walkAutoLoop = true
  private walkUiHidden = false
  private remotePlayers = new Map<string, RemoteAvatar>()
  private walkTourInfoKey = ''
  private walkTour: {
    points: WalkTourPoint[]
    index: number
    waiting: boolean
    waitUntil: number
    lastStopIndex: number
  } | null = null
  private walkBody: THREE.Group | null = null
  private walkHead: THREE.Object3D | null = null
  private walkArmL: THREE.Object3D | null = null
  private walkArmR: THREE.Object3D | null = null
  private walkLegL: THREE.Object3D | null = null
  private walkLegR: THREE.Object3D | null = null
  private walkAnimPhase = 0
  private walkCameraRay = new THREE.Raycaster()
  /** 漫游中按住 Alt 临时释放鼠标，松开后重新锁定 */
  private walkAltReleased = false
  /** 天气面板打开时暂停移动并释放鼠标 */
  private walkUiPaused = false
  private walkHomePos = new THREE.Vector3()
  private walkHomeYaw = 0
  private walkHomePitch = 0
  private walkReturn: {
    fromPos: THREE.Vector3
    toPos: THREE.Vector3
    fromYaw: number
    toYaw: number
    fromPitch: number
    toPitch: number
    start: number
    duration: number
  } | null = null
  private isTouchDevice =
    new URLSearchParams(window.location.search).get('mobile') === '1' ||
    (window.matchMedia('(pointer: coarse)').matches &&
      window.matchMedia('(max-width: 900px)').matches) ||
    /android|iphone|ipad|mobile/i.test(navigator.userAgent)
  private walkSaved: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null
  private walkPrevFov: number | null = null
  private walkViewTransition: {
    fromPos: THREE.Vector3
    fromQuat: THREE.Quaternion
    start: number
    duration: number
  } | null = null
  private walkEnter: {
    t0: number
    dur: number
    fromPos: THREE.Vector3
    toPos: THREE.Vector3
    fromQuat: THREE.Quaternion
    toQuat: THREE.Quaternion
  } | null = null
  private walkInnerPts: Pt[] | null = null
  private lastFrame = 0

  private rubber: THREE.Line
  private rubberPos = new Float32Array(6)
  private snapRing: THREE.Group

  private mode: StageMode = 'idle'
  private readOnly = false
  private draftPoints: Pt[] = []
  private down: { x: number; y: number; t: number } | null = null
  /** 按住空格：进入纯视角导航，禁止选中 / 拖动模型 */
  private spaceNav = false
  /** 空格导航前的右键映射，松开后恢复 */
  private spacePrevRight: THREE.MOUSE | null | undefined
  /** 右键点击旋转候选：拖动超过阈值则视为平移 */
  private rightClick: {
    x: number
    y: number
    t: number
    infraId?: string
    boothId?: string
  } | null = null
  /** 绘制场馆 / 展台时启用左键拖拽拉矩形 */
  private rectEnabled = false
  private rectDrag: {
    start: Pt
    current: Pt
    sx: number
    sy: number
    active: boolean
  } | null = null
  private rectPreview: {
    group: THREE.Group
    fill: THREE.Mesh
    border: THREE.LineLoop
    label: CSS2DObject
  } | null = null
  private tween: {
    p0: THREE.Vector3
    p1: THREE.Vector3
    t0: THREE.Vector3
    t1: THREE.Vector3
    start: number
    dur: number
  } | null = null

  constructor(host: HTMLElement, opts: StageOptions = {}) {
    this.host = host
    this.opts = opts

    const w = host.clientWidth || window.innerWidth
    const h = host.clientHeight || window.innerHeight

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)

    // 诊断实际使用的 GPU，避免误用软件渲染
    const gl = this.renderer.getContext()
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info')
    const gpuName = debugExt
      ? gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER)
    if (/swiftshader|software|llvmpipe|basic render driver/i.test(String(gpuName))) {
      console.warn('[GPU] 当前为软件渲染，请在浏览器设置中开启硬件加速:', gpuName)
    } else {
      console.info('[GPU] 硬件加速已启用:', gpuName)
    }

    // 初始画质：URL 参数优先，否则按 GPU 型号预判，运行中再根据帧率自动降级
    const qualityParam = new URLSearchParams(window.location.search).get('quality')
    if (
      qualityParam === 'ultra' ||
      qualityParam === 'high' ||
      qualityParam === 'medium' ||
      qualityParam === 'low'
    ) {
      this.quality = qualityParam
      this.autoQuality = false
    } else {
      this.quality = detectGpuQuality(String(gpuName))
      this.autoQuality = this.quality !== 'low'
    }
    this.qualitySkip = 120

    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // 阴影贴图按低频手动刷新，避免每帧重绘整套静态场景
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.touchAction = 'none'
    this.renderer.domElement.style.outline = 'none'
    this.renderer.domElement.tabIndex = -1
    host.appendChild(this.renderer.domElement)

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(w, h)
    const labelDom = this.labelRenderer.domElement
    labelDom.style.position = 'absolute'
    labelDom.style.top = '0'
    labelDom.style.left = '0'
    labelDom.style.pointerEvents = 'none'
    labelDom.style.zIndex = '1'
    host.appendChild(labelDom)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xf1f0ec)
    this.scene.fog = new THREE.Fog(0xf1f0ec, 220, 620)

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000)
    this.camera.position.set(34, 28, 38)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 2
    this.controls.maxDistance = 320
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02
    this.controls.target.set(0, 2, 0)
    this.controls.update()

    // 光照：动态太阳主光（形成体块明暗面） + 天光补光
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc9c4b8, 0.8)
    this.scene.add(hemi)
    this.hemiLight = hemi

    const key = new THREE.DirectionalLight(0xfffcf5, 2.6)
    key.position.set(46, 66, 34)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.radius = 3
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.04
    this.scene.add(key, key.target)
    this.keyLight = key

    const fill = new THREE.DirectionalLight(0xe8eeff, 0.36)
    fill.position.set(-48, 26, -40)
    this.scene.add(fill)
    this.fillLight = fill

    const moon = new THREE.DirectionalLight(0x8fa6d8, 0)
    moon.position.set(-90, 120, 70)
    this.scene.add(moon, moon.target)
    this.moonLight = moon

    this.scene.add(this.venueLightRoot)
    this.updateSun()

    this.weatherSystem = new WeatherSystem()
    this.scene.add(this.weatherSystem.group)
    this.weatherSystem.setWeather(this.weather)

    this.cloudShadow = new CloudShadow()
    this.scene.add(this.cloudShadow.group)
    this.cloudShadow.setWeather(this.weather)

    this.skyClouds = new SkyClouds()
    this.scene.add(this.skyClouds.group)
    this.skyClouds.setWeather(this.weather)

    // 地面
    const groundGeo = new THREE.PlaneGeometry(3000, 3000)
    groundGeo.rotateX(-Math.PI / 2)
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ color: 0xe6e4dd, roughness: 1, metalness: 0 }),
    )
    ground.position.y = -0.03
    ground.receiveShadow = true
    this.scene.add(ground)

    this.buildGrid()
    this.scene.add(this.underlayGroup, this.gridGroup, this.modelRoot, this.previewRoot, this.draftRoot)
    this.modelRoot.add(this.boothLogoRoot)
    this.scene.add(this.dimensionRoot)
    this.draftRoot.add(this.draftContent)

    // 漫游玩家身体：第一人称低头可见，第三人称完整显示
    this.buildWalkBody()
    if (this.walkBody) this.scene.add(this.walkBody)

    // 橡皮筋线（始终位于草稿层）
    const rubberGeo = new THREE.BufferGeometry()
    rubberGeo.setAttribute('position', new THREE.BufferAttribute(this.rubberPos, 3))
    this.rubber = new THREE.Line(
      rubberGeo,
      new THREE.LineDashedMaterial({
        color: ACCENT,
        dashSize: 0.5,
        gapSize: 0.32,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      }),
    )
    this.rubber.frustumCulled = false
    this.rubber.renderOrder = 6
    this.rubber.visible = false
    this.draftRoot.add(this.rubber)

    this.snapRing = this.createSnapRing()
    this.snapRing.visible = false
    this.draftRoot.add(this.snapRing)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)

    this.camera.rotation.order = 'YXZ'
    this.applyQuality()
    this.opts.onQualityChange?.(this.quality, false)
    this.bindEvents()
    this.lastFrame = performance.now()
    this.loop()
  }

  // ---------- 构建 ----------

  private buildGrid() {
    const minor: number[] = []
    const major: number[] = []
    for (let i = -GRID_HALF; i <= GRID_HALF; i += 1) {
      const target = i % 10 === 0 ? major : minor
      target.push(i, 0, -GRID_HALF, i, 0, GRID_HALF)
      target.push(-GRID_HALF, 0, i, GRID_HALF, 0, i)
    }

    const mkLines = (arr: number[], color: number, opacity: number) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      return new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      )
    }

    this.gridGroup.add(mkLines(minor, 0xb3ad9d, 0.95))
    this.gridGroup.add(mkLines(major, 0x8c8676, 1))

    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-GRID_HALF, 0, -GRID_HALF),
        new THREE.Vector3(GRID_HALF, 0, -GRID_HALF),
        new THREE.Vector3(GRID_HALF, 0, GRID_HALF),
        new THREE.Vector3(-GRID_HALF, 0, GRID_HALF),
      ]),
      new THREE.LineBasicMaterial({ color: 0x9c968a, transparent: true, opacity: 0.5 }),
    )
    border.position.y = 0.002
    this.gridGroup.add(border)
  }

  private createSnapRing(): THREE.Group {
    const g = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 40), mat)
    ring.rotation.x = -Math.PI / 2
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), mat)
    dot.rotation.x = -Math.PI / 2
    g.add(ring, dot)
    g.position.y = 0.05
    g.renderOrder = 7
    return g
  }

  // ---------- 刻度与指北 ----------

  setDimensionsVisible(on: boolean) {
    this.dimensionVisible = on
    if (on) this.rebuildDimensions()
    else this.clearDimensions()
  }

  private clearDimensions() {
    for (const obj of this.dimensionLabels) {
      obj.element.remove()
      obj.removeFromParent()
    }
    this.dimensionLabels = []
    for (const child of [...this.dimensionRoot.children]) {
      this.dimensionRoot.remove(child)
      disposeDeep(child)
    }
  }

  /** 模型变化后刷新刻度（仅在开启时） */
  private refreshDimensions() {
    if (this.dimensionVisible) this.rebuildDimensions()
  }

  private rebuildDimensions() {
    this.clearDimensions()
    if (!this.dimensionVisible) return

    const venue = this.venue
    if (venue && venue.points.length >= 3) {
      const b = boundsOf(venue.points)
      this.addDimensionBox(b.minX, b.maxX, b.minZ, b.maxZ, venue.height, 1.4)
    }

    for (const booth of this.boothSpecs.values()) {
      if (booth.points.length < 3) continue
      const b = boundsOf(booth.points)
      this.addDimensionBox(b.minX, b.maxX, b.minZ, b.maxZ, booth.height, 0.55)
    }

    for (const it of this.infras) this.addInfraDimension(it)
  }

  /** AABB 尺寸标注：长、宽、高三条尺寸线与刻度 */
  private addDimensionBox(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    height: number,
    off: number,
  ) {
    const y = 0.06
    const t = 0.2
    const segs: THREE.Vector3[] = []
    const v = (x: number, yy: number, z: number) => new THREE.Vector3(x, yy, z)

    // 长（北侧外）
    const lineZ = minZ - off
    segs.push(v(minX, y, lineZ), v(maxX, y, lineZ))
    segs.push(v(minX, y, lineZ - t), v(minX, y, lineZ + t))
    segs.push(v(maxX, y, lineZ - t), v(maxX, y, lineZ + t))

    // 宽（东侧外）
    const lineX = maxX + off
    segs.push(v(lineX, y, minZ), v(lineX, y, maxZ))
    segs.push(v(lineX - t, y, minZ), v(lineX + t, y, minZ))
    segs.push(v(lineX - t, y, maxZ), v(lineX + t, y, maxZ))

    // 高（东北角外）
    segs.push(v(lineX, 0.02, lineZ), v(lineX, height, lineZ))
    segs.push(v(lineX - t, 0.02, lineZ), v(lineX + t, 0.02, lineZ))
    segs.push(v(lineX - t, height, lineZ), v(lineX + t, height, lineZ))

    this.addDimSegments(segs)
    this.addDimLabel(`L ${(maxX - minX).toFixed(1)} m`, (minX + maxX) / 2, 0.32, lineZ - 0.4)
    this.addDimLabel(`W ${(maxZ - minZ).toFixed(1)} m`, lineX + 0.5, 0.32, (minZ + maxZ) / 2)
    this.addDimLabel(`H ${height.toFixed(1)} m`, lineX + 0.5, height / 2, lineZ)
  }

  /** 基础设施按自身朝向标注（支持旋转） */
  private addInfraDimension(it: Infra) {
    if (isFurnitureKind(it.kind)) return
    const y = 0.06
    const t = 0.18
    const off = 0.5
    const hw = it.width / 2
    const hd = it.depth / 2
    // 局部 +X / +Z 的世界方向
    const ux = Math.cos(it.rotation)
    const uz = -Math.sin(it.rotation)
    const vx = Math.sin(it.rotation)
    const vz = Math.cos(it.rotation)
    const segs: THREE.Vector3[] = []
    const v = (x: number, yy: number, z: number) => new THREE.Vector3(x, yy, z)

    // 宽：沿局部 X，布置在局部 -Z 外侧
    const cw = { x: it.x - vx * (hd + off), z: it.z - vz * (hd + off) }
    const w1 = { x: cw.x - ux * hw, z: cw.z - uz * hw }
    const w2 = { x: cw.x + ux * hw, z: cw.z + uz * hw }
    segs.push(v(w1.x, y, w1.z), v(w2.x, y, w2.z))
    segs.push(v(w1.x - vx * t, y, w1.z - vz * t), v(w1.x + vx * t, y, w1.z + vz * t))
    segs.push(v(w2.x - vx * t, y, w2.z - vz * t), v(w2.x + vx * t, y, w2.z + vz * t))
    this.addDimLabel(`L ${it.width.toFixed(1)} m`, cw.x - vx * 0.4, 0.32, cw.z - vz * 0.4)

    // 深：沿局部 Z，布置在局部 +X 外侧（出入口只标宽度与高度）
    if (it.kind !== 'gate') {
      const cd = { x: it.x + ux * (hw + off), z: it.z + uz * (hw + off) }
      const d1 = { x: cd.x - vx * hd, z: cd.z - vz * hd }
      const d2 = { x: cd.x + vx * hd, z: cd.z + vz * hd }
      segs.push(v(d1.x, y, d1.z), v(d2.x, y, d2.z))
      segs.push(v(d1.x + ux * t, y, d1.z + uz * t), v(d1.x - ux * t, y, d1.z - uz * t))
      segs.push(v(d2.x + ux * t, y, d2.z + uz * t), v(d2.x - ux * t, y, d2.z - uz * t))
      this.addDimLabel(`W ${it.depth.toFixed(1)} m`, cd.x + ux * 0.4, 0.32, cd.z + uz * 0.4)
    }

    // 高：在宽线右端处
    segs.push(v(w2.x, 0.02, w2.z), v(w2.x, it.height, w2.z))
    segs.push(
      v(w2.x - vx * t, 0.02, w2.z - vz * t),
      v(w2.x + vx * t, 0.02, w2.z + vz * t),
    )
    segs.push(
      v(w2.x - vx * t, it.height, w2.z - vz * t),
      v(w2.x + vx * t, it.height, w2.z + vz * t),
    )
    this.addDimLabel(
      `H ${it.height.toFixed(1)} m`,
      w2.x + ux * 0.45,
      it.height / 2,
      w2.z + uz * 0.45,
    )

    this.addDimSegments(segs)
  }

  private addDimSegments(segs: THREE.Vector3[]) {
    if (!segs.length) return
    const geo = new THREE.BufferGeometry().setFromPoints(segs)
    const line = new THREE.LineSegments(geo, this.dimLineMat)
    line.renderOrder = 8
    this.dimensionRoot.add(line)
  }

  private addDimLabel(text: string, x: number, y: number, z: number) {
    const el = document.createElement('div')
    el.className = 'dim-label'
    el.textContent = text
    const obj = new CSS2DObject(el)
    obj.position.set(x, y, z)
    obj.center.set(0.5, 0.5)
    this.dimensionRoot.add(obj)
    this.dimensionLabels.push(obj)
  }

  /**
   * 指北罗盘角度：由相机水平朝向（方位角）决定，0 为向上，正值顺时针。
   * 只取水平分量，避免俯仰接近 ±90° 时方向投影剧烈跳变。
   */
  private northAngleDeg(): number {
    this.camera.getWorldDirection(this.northForward)
    const len = Math.hypot(this.northForward.x, this.northForward.z)
    if (len < 1e-4) return this.lastNorthDeg

    // heading：正北为 0，顺时针增加；罗盘指针指北，因此取反
    const heading = (Math.atan2(this.northForward.x, -this.northForward.z) * 180) / Math.PI
    this.lastNorthDeg = -heading
    return this.lastNorthDeg
  }

  // ---------- 数据 ----------

  setVenue(venue: Venue | null) {
    this.venue = venue
    this.venueOpenings = this.gateOpenings()
    this.venueOpeningSig = openingsSig(this.venueOpenings)
    this.rebuildVenue()
    this.refreshDimensions()
  }

  /** 批量同步整套场景，避免撤销/导入时场馆、灯光与设施被重复重建 */
  setScene(venue: Venue | null, booths: Booth[], infras: Infra[]) {
    this.venue = venue
    this.infras = infras
    this.venueOpenings = this.gateOpenings()
    this.venueOpeningSig = openingsSig(this.venueOpenings)
    this.rebuildVenue()
    // 先更新展台，家具才能按所在展台的台面高度落位
    this.setBooths(booths)
    this.setInfras(infras)
  }

  /** 场馆或门洞变化后重建墙体 */
  private rebuildVenue() {
    if (this.venueGroup) {
      this.modelRoot.remove(this.venueGroup)
      disposeDeep(this.venueGroup)
      this.venueGroup = null
    }

    const venue = this.venue
    if (!venue || venue.points.length < 3) {
      this.clearVenueLights()
      this.refreshPickables()
      return
    }

    const g = buildMassing(venue.points, {
      height: venue.height,
      thickness: 0.24,
      // 银灰金属 + 低饱和地面，参考大型无柱展馆的室内气质
      wallColor: 0xc9cdd2,
      floorColor: 0xdeddd8,
      edgeColor: 0x8d887b,
      wallRoughness: 0.56,
      wallMetalness: 0.16,
      wallNormalMap: getVenueWallNormalMap(),
      wallNormalScale: 0.42,
      ceiling: !!venue.ceiling,
      openings: this.venueOpenings,
    })
    g.name = 'venue'

    // 预先准备透明材质：切换半透明时只改 opacity，避免重新编译 shader
    const seenMats = new Set<THREE.Material>()
    g.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        if (!mat || seenMats.has(mat)) continue
        seenMats.add(mat)
        const sm = mat as THREE.MeshStandardMaterial
        if (sm.isMeshStandardMaterial) {
          sm.transparent = true
          sm.opacity = 1
          sm.depthWrite = true
          sm.side = THREE.DoubleSide
          sm.needsUpdate = true
        }
      }
    })

    // 地面轮廓线：半透明模式下用于清晰标定场馆范围
    const footprint = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        venue.points.map((p) => new THREE.Vector3(p.x, 0.03, p.z)),
      ),
      new THREE.LineBasicMaterial({ color: 0x3f4550, transparent: true, opacity: 0.5 }),
    )
    footprint.name = 'footprint'
    footprint.visible = false
    g.add(footprint)

    this.venueGroup = g
    this.modelRoot.add(g)
    this.fitShadow(venue.points, venue.height)
    this.buildVenueLights()
    this.applyVenueXray()
    this.refreshPickables()
  }

  private clearVenueLights() {
    for (const light of this.venueSpotLights) this.venueLightRoot.remove(light)
    this.venueSpotLights = []

    if (this.venueBulbs) {
      this.venueLightRoot.remove(this.venueBulbs)
      this.venueBulbs.dispose()
      this.venueBulbs = null
    }
    if (this.venuePool) {
      this.venueLightRoot.remove(this.venuePool)
      this.venuePool.geometry.dispose()
      const mat = this.venuePool.material as THREE.MeshBasicMaterial
      mat.map?.dispose()
      mat.dispose()
      this.venuePool = null
    }
  }

  /**
   * 场馆顶部灯位：
   * 常规画质使用自发光灯泡 + 烘焙地面光池；
   * 极致画质改用实时聚光灯（只向下半球发光），不生成烘焙光池。
   */
  private buildVenueLights() {
    this.clearVenueLights()
    const venue = this.venue
    if (!venue || venue.points.length < 3) return

    const ultra = this.quality === 'ultra'
    const b = boundsOf(venue.points)
    const inner = insetPolygon(venue.points, 1.2) ?? venue.points
    const y = Math.max(1.5, venue.height - 0.7)
    const positions: Pt[] = []

    if (ultra) {
      // 极致：用等距网格覆盖整馆，同时把实时灯数量控制在 24 盏以内
      const width = Math.max(1, b.maxX - b.minX)
      const depth = Math.max(1, b.maxZ - b.minZ)
      const target = 24
      const spacing = Math.max(2, Math.sqrt((width * depth) / target))
      for (let x = b.minX + spacing / 2; x < b.maxX; x += spacing) {
        for (let z = b.minZ + spacing / 2; z < b.maxZ; z += spacing) {
          if (!pointInPolygon({ x, z }, inner)) continue
          positions.push({ x, z })
        }
      }
      // 网格取整后可能超出目标，按分数步长均匀抽稀，避免只保留某一侧
      if (positions.length > target) {
        const step = positions.length / target
        const sampled: Pt[] = []
        for (let i = 0; i < target; i++) sampled.push(positions[Math.floor(i * step)])
        positions.length = 0
        positions.push(...sampled)
      }
    } else {
      const spacing = this.quality === 'low' ? 24 : this.quality === 'medium' ? 16 : 10
      const maxLights = this.quality === 'low' ? 10 : this.quality === 'medium' ? 24 : 120
      const startX = Math.ceil((b.minX + 1) / spacing) * spacing
      const startZ = Math.ceil((b.minZ + 1) / spacing) * spacing

      const addLight = (x: number, z: number) => {
        if (positions.length >= maxLights) return
        if (positions.some((p) => Math.hypot(p.x - x, p.z - z) < 0.6)) return
        positions.push({ x, z })
      }

      for (const p of venue.points) addLight(p.x, p.z)
      for (let x = startX; x <= b.maxX - 1; x += spacing) {
        for (let z = startZ; z <= b.maxZ - 1; z += spacing) {
          if (positions.length >= maxLights) break
          if (!pointInPolygon({ x, z }, inner)) continue
          addLight(x, z)
        }
      }
    }

    if (!positions.length) {
      // 极致模式至少保留一个实时灯位；其他画质维持原有逻辑
      if (!ultra) return
      const c = centroid(venue.points)
      positions.push(pointInPolygon(c, venue.points) ? c : inner[0])
    }

    // 自发光灯泡：一个 InstancedMesh，白天/夜晚只调 opacity
    const bulbs = new THREE.InstancedMesh(this.venueBulbGeo, this.venueBulbMat, positions.length)
    const matrix = new THREE.Matrix4()
    positions.forEach((p, i) => {
      matrix.makeTranslation(p.x, y, p.z)
      bulbs.setMatrixAt(i, matrix)
    })
    bulbs.instanceMatrix.needsUpdate = true
    bulbs.computeBoundingSphere()
    bulbs.name = 'venue-bulbs'
    this.venueLightRoot.add(bulbs)
    this.venueBulbs = bulbs

    // 极致画质：使用实时聚光灯，不生成烘焙光池
    if (ultra) {
      // 聚光灯与灯泡共用同一组馆内灯位；angle = 90° 表示只照下半球
      for (const p of positions) {
        const light = new THREE.SpotLight(0xffdca8, 0, 20, Math.PI / 2, 0.3, 1.6)
        light.position.set(p.x, y, p.z)
        light.target.position.set(0, -y, 0)
        light.add(light.target)
        light.castShadow = false
        this.venueLightRoot.add(light)
        this.venueSpotLights.push(light)
      }
      this.updateSun()
      return
    }

    // 地面光池：把灯位烘焙到一张 Canvas 贴图，1 个透明面片，无实时光源
    const width = Math.max(1, b.maxX - b.minX)
    const depth = Math.max(1, b.maxZ - b.minZ)
    const res = this.quality === 'low' ? 512 : 1024
    const canvas = document.createElement('canvas')
    canvas.width = res
    canvas.height = Math.max(1, Math.round((res * depth) / width))
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const sx = canvas.width / width
    const sy = canvas.height / depth
    const radius = 6 * Math.min(sx, sy)
    for (const p of positions) {
      const cx = (p.x - b.minX) * sx
      const cy = (p.z - b.minZ) * sy
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
      gradient.addColorStop(0, 'rgba(255, 220, 168, 0.95)')
      gradient.addColorStop(0.35, 'rgba(255, 205, 142, 0.42)')
      gradient.addColorStop(1, 'rgba(255, 188, 112, 0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false

    const shape = new THREE.Shape(venue.points.map((p) => new THREE.Vector2(p.x, -p.z)))
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(-Math.PI / 2)
    const posAttr = geo.attributes.position
    const uvAttr = geo.attributes.uv
    for (let i = 0; i < posAttr.count; i++) {
      uvAttr.setXY(
        i,
        (posAttr.getX(i) - b.minX) / width,
        (posAttr.getZ(i) - b.minZ) / depth,
      )
    }
    uvAttr.needsUpdate = true

    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const pool = new THREE.Mesh(geo, mat)
    pool.position.y = 0.02
    pool.name = 'venue-light-pool'
    pool.renderOrder = 2
    this.venueLightRoot.add(pool)
    this.venuePool = pool
    this.updateSun()
  }

  /** 出入口是否位于某段内墙上 */
  private gateOnWall(gate: Infra, wall: Infra): boolean {
    if (wall.kind !== 'wall') return false
    const ux = Math.cos(wall.rotation)
    const uz = -Math.sin(wall.rotation)
    const vx = Math.sin(wall.rotation)
    const vz = Math.cos(wall.rotation)
    const dx = gate.x - wall.x
    const dz = gate.z - wall.z
    const lx = dx * ux + dz * uz
    const lz = dx * vx + dz * vz
    return Math.abs(lz) <= wall.depth / 2 + 0.35 && Math.abs(lx) <= wall.width / 2
  }

  /** 内墙上的出入口开洞（相对墙中心的局部 X） */
  private wallOpenings(wall: Infra): InfraOpening[] {
    return this.infras
      .filter((it) => it.kind === 'gate' && this.gateOnWall(it, wall))
      .map((it) => {
        const ux = Math.cos(wall.rotation)
        const uz = -Math.sin(wall.rotation)
        return {
          u: (it.x - wall.x) * ux + (it.z - wall.z) * uz,
          width: it.width,
          height: it.height,
        }
      })
  }

  /** 两段设施是否在同一条墙线上并发生长度重叠 */
  private wallRunOverlap(
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

  /** 场馆外墙洞口：外墙出入口 + 未与出入口冲突的窗户；内墙出入口不参与 */
  private gateOpenings(): MassingOpening[] {
    const gates = this.infras
      .filter(
        (it) =>
          it.kind === 'gate' &&
          !this.infras.some((w) => w.kind === 'wall' && this.gateOnWall(it, w)),
      )
      .map((it) => ({ x: it.x, z: it.z, width: it.width, height: it.height }))
    const windows = this.infras
      .filter(
        (it) =>
          it.kind === 'window' &&
          !this.infras.some(
            (gate) => gate.kind === 'gate' && this.wallRunOverlap(it, gate),
          ),
      )
      .map((it) => ({
        x: it.x,
        z: it.z,
        width: it.width,
        height: it.height,
        sill: it.sill ?? WINDOW_SILL,
      }))
    return [...gates, ...windows]
  }

  /** 出入口位置/尺寸变化时重建墙体，避免重复重建 */
  private applyVenueOpenings() {
    const openings = this.gateOpenings()
    const sig = openingsSig(openings)
    if (sig === this.venueOpeningSig) return
    this.venueOpeningSig = sig
    this.venueOpenings = openings
    this.rebuildVenue()
  }

  /** 场馆是否半透明（绘制展台时开启，便于看清馆内） */
  setVenueXray(on: boolean) {
    if (this.venueXray === on) return
    this.venueXray = on
    this.applyVenueXray()
  }

  private applyVenueXray() {
    const group = this.venueGroup
    if (!group) return
    const on = this.venueXray
    // 漫游选点时即使未手动开启 X-Ray，也让有顶场馆的顶板半透明
    const pickCeiling = this.walkState === 'pick' && !!this.venue?.ceiling

    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (!mat || Array.isArray(mat)) return

      if (mesh.name === 'footprint') {
        mesh.visible = on
        return
      }

      if ((mat as THREE.LineBasicMaterial).isLineBasicMaterial) {
        const line = mat as THREE.LineBasicMaterial
        line.transparent = true
        line.opacity = on ? 0.5 : 0.5
        return
      }

      // 半透明时隐藏楼板，让地面网格在馆内可见，便于对齐展台
      if (mesh.name === 'floor') {
        mesh.visible = !on
        return
      }

      const ceiling = mesh.name === 'ceiling'
      const transparent = ceiling ? on || pickCeiling : on
      const m = mat as THREE.MeshStandardMaterial
      // transparent / side 已在构建时固定，切换时只改材质状态，避免重编译 shader
      m.opacity = transparent ? (ceiling ? 0.32 : 0.42) : 1
      m.depthWrite = !transparent
      // 半透明时不再投射硬阴影，避免把馆内压暗
      mesh.castShadow = !transparent
    })
  }

  private clearLabels() {
    for (const { obj, line } of this.labels) {
      obj.element.remove()
      obj.removeFromParent()
      line.removeFromParent()
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    this.labels = []
  }

  /** 同时控制展台和基础设施名称 */
  setLabelsVisible(visible: boolean) {
    this.setBoothLabelsVisible(visible)
    this.setInfraLabelsVisible(visible)
  }

  setBoothLabelsVisible(visible: boolean) {
    this.boothLabelsVisible = visible
    for (const { obj, line } of this.labels) {
      obj.visible = visible
      line.visible = visible
    }
  }

  setInfraLabelsVisible(visible: boolean) {
    this.infraLabelsVisible = visible
    for (const { obj, line } of this.infraLabels) {
      obj.visible = visible
      line.visible = visible
    }
  }

  private setLeaderLine(
    label: { line: THREE.Line; base: THREE.Vector3; height: number },
    points: [number, number, number][],
  ) {
    const attr = label.line.geometry.getAttribute('position') as THREE.BufferAttribute
    points.forEach(([x, y, z], index) => attr.setXYZ(index, x, y, z))
    attr.needsUpdate = true
    label.line.geometry.computeBoundingSphere()
  }

  /** 展示模式下把名称放到馆外，用折线引回展台 */
  private setPresentationLabels(on: boolean) {
    if (!this.labels.length) return
    const center = this.venue ? centroid(this.venue.points) : { x: 0, z: 0 }
    const roof = this.venue?.height ?? 6
    for (const label of this.labels) {
      const mat = label.line.material as THREE.LineBasicMaterial
      mat.color.setHex(on ? 0x59616d : 0x8b9099)
      mat.opacity = on ? 0.95 : 0.85
    }

    if (!on) {
      for (const label of this.labels) {
        const base = label.base
        const topY = label.height + 1.5
        label.obj.position.set(base.x, label.height + 1.62, base.z)
        this.setLeaderLine(label, [
          [base.x, label.height + 0.02, base.z],
          [base.x, topY, base.z],
          [base.x, topY, base.z],
          [base.x, topY, base.z],
        ])
      }
      return
    }

    if (!this.venue) {
      // 没有场馆时退化为向外抬高的直线标签
      this.labels.forEach((label, index) => {
        const base = label.base
        const labelY = Math.max(roof + 3, label.height + 3.2) + (index % 3) * 0.5
        label.obj.position.set(base.x, labelY, base.z)
        this.setLeaderLine(label, [
          [base.x, label.height + 0.02, base.z],
          [base.x, labelY - 0.1, base.z],
          [base.x, labelY - 0.1, base.z],
          [base.x, labelY - 0.1, base.z],
        ])
      })
      return
    }

    const b = boundsOf(this.venue.points)
    const width = b.maxX - b.minX
    const depth = b.maxZ - b.minZ
    const pad = Math.max(6, Math.max(width, depth) * 0.11)
    const minX = b.minX - pad
    const maxX = b.maxX + pad
    const minZ = b.minZ - pad
    const maxZ = b.maxZ + pad
    const rectW = maxX - minX
    const rectD = maxZ - minZ
    const perimeter = 2 * (rectW + rectD)
    const step = perimeter / Math.max(1, this.labels.length)

    // 按展台方位排序后沿馆外矩形等距分配，避免标签集中在同一条直线上
    const ordered = this.labels
      .map((label) => ({
        label,
        angle: Math.atan2(label.base.z - center.z, label.base.x - center.x),
      }))
      .sort((a, b) => a.angle - b.angle)

    ordered.forEach((entry, index) => {
      let distance = (index + 0.5) * step
      let labelX = minX
      let labelZ = minZ
      if (distance < rectW) {
        labelX = minX + distance
        labelZ = minZ
      } else if ((distance -= rectW) < rectD) {
        labelX = maxX
        labelZ = minZ + distance
      } else if ((distance -= rectD) < rectW) {
        labelX = maxX - distance
        labelZ = maxZ
      } else {
        distance -= rectW
        labelX = minX
        labelZ = maxZ - distance
      }

      const { label } = entry
      const base = label.base
      const labelY = Math.max(roof + 3.1, label.height + 3.2) + (index % 3) * 0.55
      const leaderY = Math.max(roof + 1.45, label.height + 1.15)
      label.obj.position.set(labelX, labelY, labelZ)
      this.setLeaderLine(label, [
        [base.x, label.height + 0.02, base.z],
        [base.x, leaderY, base.z],
        [labelX, leaderY, labelZ],
        [labelX, labelY - 0.1, labelZ],
      ])
    })
  }

  /** 展台面积标注开关 */
  setBoothAreasVisible(visible: boolean) {
    this.areasVisible = visible
    for (const obj of this.areaLabels) obj.visible = visible
    if (visible) this.updateAreaLabels()
  }

  private clearAreaLabels() {
    for (const obj of this.areaLabels) {
      obj.element.remove()
      obj.removeFromParent()
    }
    this.areaLabels = []
  }

  /** 面积标注贴在展台顶面朝向屏幕的右下角 */
  private addAreaLabel(parent: THREE.Object3D, booth: Booth) {
    const b = boundsOf(booth.points)
    const height = boothVisibleHeight(booth)
    const el = document.createElement('div')
    el.className = 'booth-area'
    el.textContent = `${Math.round(polygonArea(booth.points))} m²`

    const obj = new CSS2DObject(el)
    obj.position.set(b.maxX, height + 0.04, b.maxZ)
    obj.center.set(1, 1)
    obj.visible = this.areasVisible
    obj.userData.areaBounds = b
    obj.userData.areaHeight = height
    parent.add(obj)
    this.areaLabels.push(obj)
  }

  private updateAreaLabels() {
    if (!this.areasVisible || !this.areaLabels.length) return
    const v = this.areaProbe
    for (const obj of this.areaLabels) {
      const b = obj.userData.areaBounds as { minX: number; maxX: number; minZ: number; maxZ: number } | undefined
      const height = obj.userData.areaHeight as number | undefined
      if (!b || height === undefined) continue
      let bestX = b.maxX
      let bestZ = b.maxZ
      let bestScore = -Infinity
      for (let ci = 0; ci < 4; ci++) {
        const x = ci === 0 || ci === 3 ? b.minX : b.maxX
        const z = ci < 2 ? b.minZ : b.maxZ
        v.set(x, height + 0.04, z).project(this.camera)
        const score = v.x - v.y
        if (score > bestScore) {
          bestScore = score
          bestX = x
          bestZ = z
        }
      }
      obj.position.set(bestX, height + 0.04, bestZ)
    }
  }

  /** 展台名称标注：一条竖直线 + 名称气泡 */
  private addLabel(
    parent: THREE.Object3D,
    name: string,
    pts: Pt[],
    height: number,
    exhibitor?: string,
  ) {
    const c = centroid(pts)
    const el = document.createElement('div')
    el.className = 'booth-label'
    el.dataset.boothName = name
    el.dataset.exhibitor = exhibitor ?? ''
    if (exhibitor) {
      el.classList.add('has-exhibitor')
      const primary = document.createElement('span')
      primary.className = 'booth-label-name'
      primary.textContent = name
      const sub = document.createElement('span')
      sub.className = 'booth-label-exhibitor'
      sub.textContent = exhibitor
      el.append(primary, sub)
    } else {
      el.textContent = name
    }

    const obj = new CSS2DObject(el)
    obj.position.set(c.x, height + 1.62, c.z)
    obj.visible = this.boothLabelsVisible
    obj.center.set(0.5, 1)
    parent.add(obj)

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(c.x, height + 0.02, c.z),
        new THREE.Vector3(c.x, height + 1.5, c.z),
        new THREE.Vector3(c.x, height + 1.5, c.z),
        new THREE.Vector3(c.x, height + 1.5, c.z),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x8b9099,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      }),
    )
    line.name = 'label-leader'
    line.renderOrder = 6
    line.visible = this.boothLabelsVisible
    parent.add(line)

    this.labels.push({
      obj,
      line,
      base: new THREE.Vector3(c.x, height, c.z),
      height,
    })
  }

  setBooths(booths: Booth[]) {
    this.clearLabels()
    this.clearAreaLabels()
    this.clearBoothLogos()
    for (const [, g] of this.boothGroups) {
      this.modelRoot.remove(g)
      disposeDeep(g)
    }
    this.boothGroups.clear()
    for (const [, g] of this.groupMeshes) {
      this.modelRoot.remove(g)
      disposeDeep(g)
    }
    this.groupMeshes.clear()
    this.groupMembers.clear()
    this.boothSpecs.clear()
    for (const [, entry] of this.selectionBoxes) {
      this.scene.remove(entry.helper)
      disposeDeep(entry.helper)
    }
    this.selectionBoxes.clear()

    const groups = new Map<string, Booth[]>()
    for (const b of booths) {
      if (b.points.length < 3) continue
      this.boothSpecs.set(b.id, b)
      if (b.groupId) {
        const arr = groups.get(b.groupId) ?? []
        arr.push(b)
        groups.set(b.groupId, arr)
      }
    }

    // 未合并的展台单独渲染
    for (const b of booths) {
      if (!this.boothSpecs.has(b.id)) continue
      if (b.groupId && (groups.get(b.groupId)?.length ?? 0) >= 2) continue
      this.addBoothMesh(b)
    }

    // 合并组：仅模型合并，组内数据仍独立
    for (const [gid, list] of groups) {
      if (list.length < 2) continue
      const color = groupColor(gid)
      const groupMark = list.map(boothMark).find((m): m is BoothMark => m !== null) ?? null
      const palette = groupMark ? MARK_PALETTE[groupMark] : null
      const sameHeight = list.every((b) => Math.abs(b.height - list[0].height) < 1e-3)
      // 只有标准白膜支持轮廓合并；脚手架 / 光地保持各自形态
      const allMassing = list.every((b) => boothKindOf(b) === 'massing')
      const sameTop = list.every((b) => (b.noTop === true) === (list[0].noTop === true))
      const outline =
        sameHeight && allMassing && sameTop ? unionOutline(list.map((b) => b.points)) : null
      this.groupMembers.set(
        gid,
        list.map((b) => b.id),
      )
      if (outline) {
        const mesh = buildBooth(outline, {
          height: list[0].height,
          thickness: 0.1,
          wallColor: palette?.wall ?? 0xf4f0e6,
          floorColor: palette?.floor ?? 0xdcd7c8,
          edgeColor: color,
          noTop: list[0].noTop === true,
        })
        mesh.name = `group:${gid}`
        mesh.userData.groupId = gid
        this.groupMeshes.set(gid, mesh)
        this.modelRoot.add(mesh)
        for (const b of list) {
          this.addLabel(mesh, b.name, b.points, boothVisibleHeight(b), b.exhibitor)
          this.addAreaLabel(mesh, b)
        }
      } else {
        // 高度不一致时保持各自体量，用同一描边色标记
        for (const b of list) this.addBoothMesh(b, color, groupMark)
      }
    }

    this.refreshFurnitureBaseY()
    this.buildBoothLogos()
    this.refreshPickables()
    this.setSelected(this.selectedIds)
    this.refreshDimensions()
    if (this.boothTopsXray) this.applyBoothTopsXray()
  }

  /** 展台类型 / 高度变化后，让家具重新落在对应的台面上 */
  private refreshFurnitureBaseY() {
    for (const it of this.infras) {
      if (!isFurnitureKind(it.kind)) continue
      const baseY = this.infraBaseYOf(it)
      if (Math.abs((this.infraBaseYMap.get(it.id) ?? 0) - baseY) < 1e-4) continue
      this.infraBaseYMap.set(it.id, baseY)
      const group = this.infraGroups.get(it.id)
      if (group) group.position.y = baseY
    }
  }

  /** 家具摆放：顶面半透明，便于观察展台内部；其他模式恢复不透明 */
  setBoothTopsXray(on: boolean) {
    if (this.boothTopsXray === on) return
    this.boothTopsXray = on
    this.applyBoothTopsXray()
  }

  private applyBoothTopsXray() {
    const on = this.boothTopsXray
    const roots: THREE.Object3D[] = [
      ...this.boothGroups.values(),
      ...this.groupMeshes.values(),
    ]

    for (const root of roots) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        if (mesh.name !== 'top' && mesh.name !== 'scaffold-top') return

        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        if (!mat) return
        const m = mat as THREE.MeshStandardMaterial
        m.transparent = on
        m.opacity = on ? 0.3 : 1
        m.depthWrite = !on
        m.side = on ? THREE.DoubleSide : THREE.FrontSide
        m.needsUpdate = true

        if (mesh.userData.baseCastShadow === undefined) {
          mesh.userData.baseCastShadow = mesh.castShadow
        }
        mesh.castShadow = on ? false : (mesh.userData.baseCastShadow as boolean)
      })
    }
  }

  private addBoothMesh(b: Booth, edgeColor?: number, markOverride?: BoothMark | null) {
    const mark = markOverride !== undefined ? markOverride : boothMark(b)
    const palette = mark ? MARK_PALETTE[mark] : null
    const kind = boothKindOf(b)
    // 展台使用更强的拉丝金属法线；场馆仍使用更细腻的金属微法线
    const boothNormal = getBoothWallNormalMap()
    const common = {
      height: b.height,
      thickness: 0.1,
      wallColor: palette?.wall ?? 0xf4f0e6,
      floorColor: palette?.floor ?? 0xdcd7c8,
      edgeColor: edgeColor ?? 0x7f7a6c,
      wallNormalMap: boothNormal,
      wallNormalScale: 1.5,
      floorNormalMap: boothNormal,
      floorNormalScale: 1,
      ...(kind === 'scaffold'
        ? {
            wallRoughness: 0.65,
            wallMetalness: 0.1,
            metalNormalMap: getScaffoldMetalNormalMap(),
            metalNormalScale: 1.2,
            metalRoughness: 0.5,
            metalMetalness: 0.25,
          }
        : kind === 'openfloor'
          ? { wallRoughness: 0.8, wallMetalness: 0 }
          : { wallRoughness: 0.75, wallMetalness: 0.06 }),
    }
    const g =
      kind === 'scaffold'
        ? buildScaffoldBooth(b.points, { ...common, canopy: b.canopy !== false })
        : kind === 'openfloor'
          ? buildOpenFloorBooth(b.points, common)
          : buildBooth(b.points, { ...common, noTop: b.noTop === true })
    g.name = `booth:${b.id}`
    g.userData.boothId = b.id
    this.boothGroups.set(b.id, g)
    this.modelRoot.add(g)
    this.addLabel(g, b.name, b.points, boothVisibleHeight(b), b.exhibitor)
    this.addAreaLabel(g, b)
  }

  // ---------- 基础设施 ----------

  setInfras(infras: Infra[]) {
    // 记录旧门扇当前的动画姿态，快速连续开关时也能从中间状态继续
    const previousGateAmount = new Map<string, number>()
    for (const it of this.infras) {
      if (it.kind !== 'gate') continue
      const group = this.infraGroups.get(it.id)
      previousGateAmount.set(
        it.id,
        Number(group?.userData.gateOpenAmount ?? (it.open ? 1 : 0)),
      )
    }

    this.infras = infras
    this.gateAnims.clear()
    this.clearInfraLabels()
    for (const [, g] of this.infraGroups) {
      this.modelRoot.remove(g)
      disposeDeep(g)
    }
    this.infraGroups.clear()
    this.infraBaseYMap.clear()
    this.infraPickables = []

    for (const it of infras) {
      const baseY = this.infraBaseYOf(it)
      this.infraBaseYMap.set(it.id, baseY)
      const g = buildInfra(it, false, it.kind === 'wall' ? this.wallOpenings(it) : [])
      g.position.y = baseY
      if (it.kind === 'gate') {
        const from = previousGateAmount.get(it.id)
        const to = it.open ? 1 : 0
        if (from !== undefined && Math.abs(from - to) > 0.001) {
          setGateOpenAmount(g, from)
          this.gateAnims.set(it.id, {
            group: g,
            start: performance.now(),
            from,
            to,
          })
        }
      }
      this.addInfraLabel(g, it)
      this.infraGroups.set(it.id, g)
      this.modelRoot.add(g)
      this.infraPickables.push(g)
    }
    this.applyVenueOpenings()
    this.setSelectedInfras(this.selectedInfraIds)
    this.refreshDimensions()
  }

  /** 家具落在所在展台的台面上：脚手架 / 光地抬到板面，标准展台贴地 */
  private infraBaseYOf(it: Infra): number {
    if (!isFurnitureKind(it.kind)) return 0
    return this.furnitureBaseYAt(it.x, it.z)
  }

  private furnitureBaseYAt(x: number, z: number): number {
    for (const b of this.boothSpecs.values()) {
      if (b.points.length < 3) continue
      if (pointInPolygon({ x, z }, b.points)) {
        return boothKindOf(b) === 'massing' ? 0 : Math.min(OPEN_FLOOR_HEIGHT, b.height)
      }
    }
    return 0
  }

  private clearInfraLabels() {
    for (const { obj, line } of this.infraLabels) {
      obj.element.remove()
      obj.removeFromParent()
      line.removeFromParent()
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    this.infraLabels = []
  }

  /** 基础设施名称标签：挂在体块上，拖动时随之移动 */
  private addInfraLabel(group: THREE.Group, it: Infra) {
    // 家具尺寸小、数量多，名称只在右侧结构面板中显示
    if (isFurnitureKind(it.kind)) return

    const el = document.createElement('div')
    el.className = 'booth-label infra-label'
    el.textContent = it.name

    const labelBase =
      it.kind === 'window' ? (it.sill ?? WINDOW_SILL) + it.height : it.height
    const top = labelBase + 1.25
    const obj = new CSS2DObject(el)
    obj.position.set(0, top, 0)
    obj.center.set(0.5, 1)
    obj.visible = this.infraLabelsVisible
    group.add(obj)

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, labelBase + 0.03, 0),
        new THREE.Vector3(0, top - 0.1, 0),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x8b9099,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      }),
    )
    line.name = 'label-leader'
    line.visible = this.infraLabelsVisible
    line.renderOrder = 6
    group.add(line)

    this.infraLabels.push({ obj, line })
  }

  setSelectedInfra(id: string | null) {
    this.setSelectedInfras(id ? [id] : [])
  }

  setSelectedInfras(ids: string[]) {
    const next = [...new Set(ids)].filter((id) => this.infraGroups.has(id))
    this.selectedInfraIds = next

    for (const helper of this.infraBoxes.values()) {
      this.scene.remove(helper)
      disposeDeep(helper)
    }
    this.infraBoxes.clear()

    for (const id of next) {
      const group = this.infraGroups.get(id)
      if (!group) continue
      group.updateMatrixWorld(true)
      const helper = new THREE.Box3Helper(
        new THREE.Box3().setFromObject(group),
        ACCENT,
      )
      const mat = helper.material as THREE.LineBasicMaterial
      mat.transparent = true
      mat.opacity = 0.95
      mat.depthTest = false
      helper.renderOrder = 5
      this.infraBoxes.set(id, helper)
      this.scene.add(helper)
    }
  }

  private setInfraBoxesVisible(visible: boolean) {
    for (const helper of this.infraBoxes.values()) helper.visible = visible
  }

  /** 进入基础设施放置（预览跟随鼠标）；可传入复制源以保留尺寸和朝向 */
  startInfraPlace(kind: InfraKind, source?: Infra) {
    this.stopInfraPlace()
    this.setBoothTopsXray(isFurnitureKind(kind))
    this.infraKind = kind
    const base = INFRA_DEFAULTS[kind]
    this.infraPlaceWidth = source?.width ?? base.width
    this.infraPlaceDepth = source?.depth ?? base.depth
    const height =
      source?.height ??
      (kind === 'gate' && this.venue
        ? Math.min(base.height, Math.max(1, this.venue.height - 0.2))
        : kind === 'window' && this.venue
          ? Math.min(base.height, Math.max(1, this.venue.height - WINDOW_SILL - 0.2))
          : base.height)
    this.infraPlaceRotation = source?.rotation ?? 0
    // 放置期间右键用于旋转，禁用 OrbitControls 的右键平移
    this.prevRightMouse = this.controls.mouseButtons.RIGHT
    this.controls.mouseButtons.RIGHT = this.spaceNav ? THREE.MOUSE.PAN : undefined
    const ghost = buildInfra(
      {
        id: 'ghost',
        kind,
        name: '',
        x: 0,
        z: 0,
        rotation: this.infraPlaceRotation,
        width: source?.width ?? base.width,
        depth: source?.depth ?? base.depth,
        height,
        ...(kind === 'window' ? { sill: source?.sill ?? WINDOW_SILL } : {}),
        ...(kind === 'elevator'
          ? { count: source?.count ?? ELEVATOR_DEFAULT_COUNT }
          : {}),
        ...(kind === 'gate'
          ? {
              open: source?.open ?? false,
              openMode: source?.openMode ?? 'double',
            }
          : {}),
      },
      true,
    )
    ghost.visible = false
    this.infraGhost = ghost
    this.previewRoot.add(ghost)
    this.infraSpot = null
  }

  stopInfraPlace() {
    this.infraKind = null
    this.infraPlaceRotation = 0
    this.infraSpot = null
    this.updateSnapGuide(null)
    this.controls.mouseButtons.RIGHT = this.prevRightMouse ?? THREE.MOUSE.PAN
    this.prevRightMouse = undefined
    this.snapRing.visible = false
    this.rubber.visible = false
    if (this.infraGhost) {
      this.previewRoot.remove(this.infraGhost)
      disposeDeep(this.infraGhost)
      this.infraGhost = null
    }
    this.setBoothTopsXray(false)
  }

  /** 离点击点最近的墙段，出入口吸附到墙中心线；窗户只吸附场馆外墙 */
  private nearestWall(p: Pt, venueOnly = false): {
    x: number
    z: number
    rotation: number
    hostHeight?: number
  } | null {
    let best: { x: number; z: number; rotation: number; hostHeight?: number } | null = null
    let bestDist = Infinity

    const consider = (a: Pt, b: Pt, rotation: number, hostHeight?: number) => {
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len2 = dx * dx + dz * dz
      if (len2 < 1e-6) return
      const t = Math.max(0.04, Math.min(0.96, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
      const x = a.x + dx * t
      const z = a.z + dz * t
      const dist = Math.hypot(p.x - x, p.z - z)
      if (dist < bestDist) {
        bestDist = dist
        // 局部 +X 对齐墙段方向，门框厚度方向垂直于墙
        best = { x, z, rotation, hostHeight }
      }
    }

    const v = this.venue
    if (v && v.points.length >= 3) {
      const n = v.points.length
      for (let i = 0; i < n; i++) {
        const a = v.points[i]
        const b = v.points[(i + 1) % n]
        consider(a, b, Math.atan2(-(b.z - a.z), b.x - a.x), v.height)
      }
    }

    // 内墙：沿墙长方向的两端
    if (venueOnly) return best
    for (const it of this.infras) {
      if (it.kind !== 'wall') continue
      const ux = Math.cos(it.rotation)
      const uz = -Math.sin(it.rotation)
      const a = { x: it.x - ux * (it.width / 2), z: it.z - uz * (it.width / 2) }
      const b = { x: it.x + ux * (it.width / 2), z: it.z + uz * (it.width / 2) }
      consider(a, b, it.rotation, it.height)
    }

    return best
  }

  private updateInfraGhost(raw: Pt | null) {
    const ghost = this.infraGhost
    if (!ghost) return
    if (!raw) {
      ghost.visible = false
      this.infraSpot = null
      this.snapRing.visible = false
      this.updateSnapGuide(null)
      return
    }

    let spot: {
      x: number
      z: number
      rotation: number
      hostHeight?: number
    } | null = null
    let snapTarget: SnapBox | null = null
    if (this.infraKind === 'gate' || this.infraKind === 'window') {
      const wall = this.nearestWall(raw, this.infraKind === 'window')
      if (wall) {
        const snapped = this.snapWallItemEdge(
          wall.x,
          wall.z,
          wall.rotation,
          this.infraPlaceWidth,
          '__placement__',
        )
        spot = {
          x: snapped?.x ?? wall.x,
          z: snapped?.z ?? wall.z,
          rotation: wall.rotation,
          hostHeight: wall.hostHeight,
        }
        snapTarget = snapped ? snapBoxOfInfra(snapped.target) : null
      }
    } else if (this.infraKind && isFurnitureKind(this.infraKind)) {
      // 家具放置不吸附网格和边缘，仍由落位校验约束在展台内部
      spot = {
        x: raw.x,
        z: raw.z,
        rotation: this.infraPlaceRotation,
      }
    } else {
      const p = snapToGrid(raw, SNAP)
      if (Math.abs(p.x) <= GRID_HALF && Math.abs(p.z) <= GRID_HALF) {
        const baseBox = snapBoxOfInfra({
          id: '__placement__',
          kind: this.infraKind!,
          name: '',
          x: 0,
          z: 0,
          rotation: this.infraPlaceRotation,
          width: this.infraPlaceWidth,
          depth: this.infraPlaceDepth,
          height: 1,
        })
        const snapped = snapEdgeDelta(
          baseBox,
          p.x,
          p.z,
          this.infraSnapTargets('__placement__'),
          EDGE_SNAP,
        )
        spot = {
          x: snapped.dx,
          z: snapped.dz,
          rotation: this.infraPlaceRotation,
        }
        snapTarget = snapped.target
      }
    }

    if (!spot) {
      ghost.visible = false
      this.infraSpot = null
      this.snapRing.visible = false
      this.updateSnapGuide(null)
      return
    }

    this.updateSnapGuide(snapTarget)

    this.infraSpot = spot
    const placeKind = this.infraKind
    const baseY = placeKind && isFurnitureKind(placeKind) ? this.furnitureBaseYAt(spot.x, spot.z) : 0
    ghost.visible = true
    ghost.position.set(spot.x, baseY, spot.z)
    ghost.rotation.y = spot.rotation
    this.snapRing.visible = true
    this.snapRing.position.set(spot.x, 0.05, spot.z)
  }

  /** 放置时右键旋转 90°（出入口与窗户朝向由墙面决定） */
  private rotateInfraPlace() {
    if (!this.infraKind || this.infraKind === 'gate' || this.infraKind === 'window') return
    this.infraPlaceRotation =
      (this.infraPlaceRotation + Math.PI / 2) % (Math.PI * 2)
    if (this.infraSpot) this.infraSpot.rotation = this.infraPlaceRotation
    if (this.infraGhost) this.infraGhost.rotation.y = this.infraPlaceRotation
  }

  private onContextMenu = (e: Event) => {
    e.preventDefault()
  }

  private pickInfraAt(clientX: number, clientY: number): string | null {
    if (!this.infraPickables.length) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.infraPickables, true)
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object
      while (obj) {
        if (typeof obj.userData.infraId === 'string') return obj.userData.infraId
        obj = obj.parent
      }
    }
    return null
  }

  private clearBoothLogos() {
    for (const { texture } of this.boothLogos) texture.dispose()
    this.boothLogos = []
    clearGroup(this.boothLogoRoot)
  }

  private buildBoothLogos() {
    this.clearBoothLogos()
    for (const b of this.boothSpecs.values()) {
      if (!b.logo || b.points.length < 3) continue
      this.addBoothLogo(b)
    }
  }

  /**
   * Logo 展示：
   * 标准白膜沿每条边贴在围挡外表面，位于该边外观视角的左下角；
   * 脚手架 / 光地使用正面落地立牌。
   */
  private addBoothLogo(b: Booth) {
    const sign = boothSignTexture(b)
    if (!sign) return

    if (boothKindOf(b) === 'massing') {
      this.addMassingLogos(b, sign)
    } else {
      this.addStandingLogo(b, sign)
    }
    this.boothLogos.push({ texture: sign.texture })
  }

  /** 标准展台：沿轮廓每条边各放一个 Logo，均在该边的左下角 */
  private addMassingLogos(
    b: Booth,
    sign: { texture: THREE.CanvasTexture; aspect: number },
  ) {
    const pts = signedArea(b.points) >= 0 ? b.points : [...b.points].reverse()
    if (pts.length < 3) return

    const offset = BOOTH_WALL / 2 + 0.012

    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const c = pts[(i + 1) % pts.length]
      const dx = c.x - a.x
      const dz = c.z - a.z
      const len = Math.hypot(dx, dz)
      if (len < 0.7) continue

      const ux = dx / len
      const uz = dz / len
      // CCW 多边形的右侧法线即外法线
      const nx = uz
      const nz = -ux

      let planeH = Math.min(0.72, Math.max(0.24, Math.min(b.height * 0.45, len * 0.14)))
      let planeW = planeH * sign.aspect
      const maxW = Math.max(0.3, len - 0.4)
      if (planeW > maxW) {
        planeW = maxW
        planeH = planeW / sign.aspect
      }

      const margin = Math.max(0.12, Math.min(0.35, len * 0.03))
      const along = margin + planeW / 2
      // 从外观方向看，边的终点是左侧；沿边回退到左侧留边处
      const x = c.x - ux * along + nx * offset
      const z = c.z - uz * along + nz * offset
      const y = Math.max(0.1, planeH * 0.18) + planeH / 2

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(planeW, planeH),
        new THREE.MeshBasicMaterial({
          map: sign.texture,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      )
      mesh.name = 'booth-logo'
      mesh.position.set(x, y, z)
      mesh.rotation.y = Math.atan2(nx, nz)
      mesh.renderOrder = 4
      this.boothLogoRoot.add(mesh)
    }
  }

  /** 脚手架 / 光地：正面落地立牌 */
  private addStandingLogo(
    b: Booth,
    sign: { texture: THREE.CanvasTexture; aspect: number },
  ) {
    const bnd = boundsOf(b.points)
    const width = Math.max(0.5, bnd.maxX - bnd.minX)
    let planeH = Math.min(0.72, Math.max(0.28, Math.min(b.height * 0.45, width * 0.18)))
    let planeW = planeH * sign.aspect
    const maxW = Math.max(0.4, width * 0.9)
    if (planeW > maxW) {
      planeW = maxW
      planeH = planeW / sign.aspect
    }

    // 落地立牌：底板贴在展台前缘内侧，底部与脚手架 / 光地台面齐平
    const baseY = Math.min(OPEN_FLOOR_HEIGHT, b.height)
    const marginX = Math.max(0.2, width * 0.05)
    const x = bnd.minX + marginX + planeW / 2
    const z = bnd.maxZ - Math.max(0.14, Math.min(0.4, width * 0.04))
    const y = baseY + 0.04 + planeH / 2

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(planeW + 0.08, planeH + 0.08, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xf7f5ef, roughness: 0.9, metalness: 0 }),
    )
    back.name = 'booth-logo-board'
    back.position.set(x, y, z - 0.02)
    back.castShadow = true
    back.receiveShadow = true
    this.boothLogoRoot.add(back)

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({
        map: sign.texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    mesh.name = 'booth-logo'
    mesh.position.set(x, y, z + 0.012)
    mesh.renderOrder = 4
    this.boothLogoRoot.add(mesh)
  }

  private boothBox(b: Booth): THREE.Box3 {
    const bnd = boundsOf(b.points)
    return new THREE.Box3(
      new THREE.Vector3(bnd.minX, 0.02, bnd.minZ),
      new THREE.Vector3(bnd.maxX, boothVisibleHeight(b), bnd.maxZ),
    )
  }

  setSelected(ids: string[]) {
    this.selectedIds = ids
    for (const [id, entry] of [...this.selectionBoxes]) {
      if (!ids.includes(id)) {
        this.scene.remove(entry.helper)
        disposeDeep(entry.helper)
        this.selectionBoxes.delete(id)
      }
    }
    for (const id of ids) {
      if (this.selectionBoxes.has(id)) continue
      const spec = this.boothSpecs.get(id)
      if (!spec) continue
      const box = this.boothBox(spec)
      const helper = new THREE.Box3Helper(box, ACCENT)
      const mat = helper.material as THREE.LineBasicMaterial
      mat.transparent = true
      mat.opacity = 0.95
      mat.depthTest = false
      helper.renderOrder = 5
      this.selectionBoxes.set(id, { helper, base: box.clone() })
      this.scene.add(helper)
    }
  }

  private setBoxesVisible(ids: string[], visible: boolean) {
    for (const id of ids) {
      const entry = this.selectionBoxes.get(id)
      if (entry) entry.helper.visible = visible
    }
  }

  /** 同一合并组的成员一起变换 */
  /** 拖动时显示即将贴边的目标包围盒 */
  private updateSnapGuide(box: SnapBox | null) {
    if (!box) {
      if (this.snapGuide) this.snapGuide.visible = false
      return
    }
    if (!this.snapGuide) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(15), 3).setUsage(
          THREE.DynamicDrawUsage,
        ),
      )
      const material = new THREE.LineBasicMaterial({
        color: 0xf0b44c,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      })
      const line = new THREE.Line(geometry, material)
      line.name = 'edge-snap-guide'
      line.renderOrder = 8
      line.frustumCulled = false
      this.snapGuide = line
      this.scene.add(line)
    }
    const y = 0.08
    const points = [
      [box.minX, y, box.minZ],
      [box.maxX, y, box.minZ],
      [box.maxX, y, box.maxZ],
      [box.minX, y, box.maxZ],
      [box.minX, y, box.minZ],
    ]
    const attr = this.snapGuide.geometry.getAttribute('position') as THREE.BufferAttribute
    points.forEach(([x, yy, z], index) => attr.setXYZ(index, x, yy, z))
    attr.needsUpdate = true
    this.snapGuide.geometry.computeBoundingSphere()
    this.snapGuide.visible = true
  }

  /** 展台拖动时的吸附目标：其他展台与不在本组内的落地设施 */
  private boothSnapTargets(activeId: string): SnapBox[] {
    const ignore = new Set(this.dragIds(activeId))
    const activePoints: Pt[] = []
    for (const id of ignore) activePoints.push(...(this.boothSpecs.get(id)?.points ?? []))
    const targets: SnapBox[] = []
    for (const [id, booth] of this.boothSpecs) {
      if (ignore.has(id)) continue
      targets.push(snapBoxOfPoints(booth.points))
    }
    for (const infra of this.infras) {
      if (isFurnitureKind(infra.kind) || infra.kind === 'gate' || infra.kind === 'window') {
        continue
      }
      if (activePoints.length && pointInPolygon(infra, activePoints)) continue
      targets.push(snapBoxOfInfra(infra))
    }
    return targets
  }

  /** 设施拖动时的吸附目标：其他展台与设施 */
  private infraSnapTargets(activeId: string | Set<string>): SnapBox[] {
    const ignore =
      typeof activeId === 'string' ? new Set([activeId]) : activeId
    const targets: SnapBox[] = []
    for (const booth of this.boothSpecs.values()) {
      targets.push(snapBoxOfPoints(booth.points))
    }
    for (const infra of this.infras) {
      if (ignore.has(infra.id)) continue
      targets.push(snapBoxOfInfra(infra))
    }
    return targets
  }

  /** 展台复制待放置时：吸附到现有展台与外部落地设施 */
  private boothPasteSnapTargets(booths: Booth[]): SnapBox[] {
    const sourcePoints = booths.flatMap((booth) => booth.points)
    const targets: SnapBox[] = []
    for (const booth of this.boothSpecs.values()) {
      targets.push(snapBoxOfPoints(booth.points))
    }
    for (const infra of this.infras) {
      if (isFurnitureKind(infra.kind) || infra.kind === 'gate' || infra.kind === 'window') {
        continue
      }
      if (sourcePoints.length && pointInPolygon(infra, sourcePoints)) continue
      targets.push(snapBoxOfInfra(infra))
    }
    return targets
  }

  /** 门窗沿墙滑动时吸附到同墙线上的另一个门窗边缘 */
  private snapWallItemEdge(
    x: number,
    z: number,
    rotation: number,
    width: number,
    ignoreId: string,
  ): { x: number; z: number; target: Infra } | null {
    const ux = Math.cos(rotation)
    const uz = -Math.sin(rotation)
    const vx = Math.sin(rotation)
    const vz = Math.cos(rotation)
    let bestAbs = EDGE_SNAP + 0.0001
    let bestAdjust = 0
    let bestTarget: Infra | null = null

    for (const target of this.infras) {
      if (
        target.id === ignoreId ||
        (target.kind !== 'gate' && target.kind !== 'window')
      ) {
        continue
      }
      if (Math.abs(Math.sin(target.rotation - rotation)) > 0.2) continue
      const dx = target.x - x
      const dz = target.z - z
      const perp = dx * vx + dz * vz
      if (Math.abs(perp) > 0.6) continue
      const along = dx * ux + dz * uz
      const half = (width + target.width) / 2
      for (const adjust of [along - half, along + half]) {
        const dist = Math.abs(adjust)
        if (dist < bestAbs) {
          bestAbs = dist
          bestAdjust = adjust
          bestTarget = target
        }
      }
    }

    if (!bestTarget || Math.abs(bestAdjust) > EDGE_SNAP) return null
    return {
      x: x + ux * bestAdjust,
      z: z + uz * bestAdjust,
      target: bestTarget,
    }
  }

  private dragIds(id: string): string[] {
    const spec = this.boothSpecs.get(id)
    if (spec?.groupId) {
      const members = this.groupMembers.get(spec.groupId)
      if (members && members.length) return members
    }
    return [id]
  }

  private dragTargets(id: string): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    for (const bid of this.dragIds(id)) {
      const spec = this.boothSpecs.get(bid)
      const gid = spec?.groupId
      const mesh = gid ? this.groupMeshes.get(gid) : this.boothGroups.get(bid)
      if (mesh && !out.includes(mesh)) out.push(mesh)
    }
    return out
  }

  private dragCenter(id: string): Pt {
    const ids = this.dragIds(id)
    if (ids.length === 1) return centroid(this.boothSpecs.get(ids[0])!.points)
    const pts: Pt[] = []
    for (const bid of ids) pts.push(...(this.boothSpecs.get(bid)?.points ?? []))
    const bnd = boundsOf(pts)
    return { x: (bnd.minX + bnd.maxX) / 2, z: (bnd.minZ + bnd.maxZ) / 2 }
  }

  /**
   * 绘制场馆 / 展台时启用“拖拽拉矩形”。
   * 左键（触屏单指）留给拉框，相机旋转改用中键拖动，避免与拉框手势冲突。
   */
  setRectDrawEnabled(on: boolean) {
    if (this.rectEnabled === on) return
    this.rectEnabled = on
    if (on) {
      this.controls.mouseButtons.LEFT = null
      this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
      this.controls.touches.ONE = null
    } else {
      this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
      this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
      this.controls.touches.ONE = THREE.TOUCH.ROTATE
      this.cancelRectDrag()
    }
  }

  private cancelRectDrag() {
    this.rectDrag = null
    if (this.rectPreview) this.rectPreview.group.visible = false
  }

  private cancelUnderlayDrag() {
    if (!this.underlayDrag) return
    this.underlayDrag = null
    this.controls.enabled = true
    this.host.style.cursor = this.mode === 'draw' ? 'crosshair' : 'default'
  }

  private ensureRectPreview() {
    if (this.rectPreview) return this.rectPreview

    const group = new THREE.Group()
    group.visible = false

    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    const fill = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    fill.renderOrder = 2
    group.add(fill)

    const border = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: ACCENT,
        dashSize: 0.5,
        gapSize: 0.3,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    )
    border.renderOrder = 7
    group.add(border)

    const el = document.createElement('div')
    el.className = 'rect-size'
    const label = new CSS2DObject(el)
    label.center.set(0.5, 0.5)
    group.add(label)

    this.draftRoot.add(group)
    this.rectPreview = { group, fill, border, label }
    return this.rectPreview
  }

  private updateRectPreview(a: Pt, b: Pt) {
    const preview = this.ensureRectPreview()
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    const minZ = Math.min(a.z, b.z)
    const maxZ = Math.max(a.z, b.z)
    const w = Math.max(0.01, maxX - minX)
    const d = Math.max(0.01, maxZ - minZ)

    preview.group.position.set((minX + maxX) / 2, 0.05, (minZ + maxZ) / 2)
    preview.fill.scale.set(w, 1, d)
    preview.border.geometry.dispose()
    preview.border.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-w / 2, 0.004, -d / 2),
      new THREE.Vector3(w / 2, 0.004, -d / 2),
      new THREE.Vector3(w / 2, 0.004, d / 2),
      new THREE.Vector3(-w / 2, 0.004, d / 2),
    ])
    preview.border.computeLineDistances()
    preview.label.position.set(0, 0.02, 0)
    preview.label.element.textContent = `${Math.round(w)} × ${Math.round(d)} m · ${Math.round(w * d)} m²`
    preview.group.visible = true
  }

  setDraft(points: Pt[]) {
    this.draftPoints = points
    clearGroup(this.draftContent)

    const y = 0.04
    if (points.length >= 3) {
      const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)))
      const geo = new THREE.ShapeGeometry(shape)
      geo.rotateX(-Math.PI / 2)
      const fill = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: ACCENT,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      )
      fill.position.y = y
      fill.renderOrder = 2
      this.draftContent.add(fill)

      const first = points[0]
      const last = points[points.length - 1]
      const closeLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(last.x, y, last.z),
          new THREE.Vector3(first.x, y, first.z),
        ]),
        new THREE.LineDashedMaterial({
          color: ACCENT,
          dashSize: 0.42,
          gapSize: 0.3,
          transparent: true,
          opacity: 0.6,
        }),
      )
      closeLine.computeLineDistances()
      closeLine.renderOrder = 3
      this.draftContent.add(closeLine)
    }

    if (points.length >= 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, y, p.z))),
        new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 1 }),
      )
      line.renderOrder = 4
      this.draftContent.add(line)
    }

    const dotMat = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false })
    const firstMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    points.forEach((p, i) => {
      const isFirst = i === 0
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(isFirst ? 0.2 : 0.12, 18, 14),
        isFirst ? firstMat : dotMat,
      )
      dot.position.set(p.x, y + 0.04, p.z)
      dot.renderOrder = 8
      this.draftContent.add(dot)

      if (isFirst && points.length >= 3) {
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(0.42, 0.5, 40),
          new THREE.MeshBasicMaterial({
            color: ACCENT,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthTest: false,
          }),
        )
        halo.rotation.x = -Math.PI / 2
        halo.position.set(p.x, y, p.z)
        halo.renderOrder = 8
        this.draftContent.add(halo)
      }
    })

    if (!points.length) this.rubber.visible = false
  }

  setPreview(
    points: Pt[] | null,
    height = 3,
    kind: 'venue' | 'booth' = 'venue',
    boothKind: BoothKind = 'massing',
    canopy = true,
  ) {
    if (this.previewGroup) {
      this.previewRoot.remove(this.previewGroup)
      disposeDeep(this.previewGroup)
      this.previewGroup = null
    }
    if (!points || points.length < 3) return

    const h = kind === 'booth' && boothKind === 'openfloor' ? OPEN_FLOOR_HEIGHT : height
    const options = {
      height: h,
      thickness: kind === 'venue' ? 0.24 : 0.1,
      wallColor: 0xdbe4ff,
      floorColor: 0xc9d7ff,
      edgeColor: ACCENT,
      transparent: true,
      opacity: 0.45,
      edges: true,
    }

    this.previewGroup =
      kind === 'venue'
        ? buildMassing(points, options)
        : boothKind === 'scaffold'
          ? buildScaffoldBooth(points, { ...options, canopy })
          : boothKind === 'openfloor'
            ? buildOpenFloorBooth(points, options)
            : buildBooth(points, options)
    this.previewRoot.add(this.previewGroup)
  }

  /** 进入展台复制粘贴放置：显示半透明幽灵组并跟随鼠标 */
  startBoothPaste(payload: BoothPastePayload) {
    this.stopBoothPaste()
    if (!payload.booths.length && !payload.infras.length) return

    const root = new THREE.Group()
    root.name = 'booth-paste-ghost'
    const common = {
      thickness: 0.1,
      wallColor: 0xdbe4ff,
      floorColor: 0xc9d7ff,
      edgeColor: ACCENT,
      transparent: true,
      opacity: 0.42,
      edges: true,
    }

    for (const b of payload.booths) {
      const kind = boothKindOf(b)
      const group =
        kind === 'scaffold'
          ? buildScaffoldBooth(b.points, {
              ...common,
              height: b.height,
              canopy: b.canopy !== false,
            })
          : kind === 'openfloor'
            ? buildOpenFloorBooth(b.points, { ...common, height: b.height })
            : buildBooth(b.points, {
                ...common,
                height: b.height,
                noTop: b.noTop === true,
              })
      root.add(group)
    }

    for (const it of payload.infras) {
      if (it.kind === 'gate' || it.kind === 'window') continue
      const ghost = buildInfra(it, true)
      if (isFurnitureKind(it.kind)) {
        const host = payload.booths.find((b) => pointInPolygon(it, b.points))
        ghost.position.y =
          host && boothKindOf(host) !== 'massing'
            ? Math.min(OPEN_FLOOR_HEIGHT, host.height)
            : 0
      }
      root.add(ghost)
    }

    this.pasteCenter = { ...payload.center }
    this.pasteBaseBox = payload.booths.length
      ? snapBoxOfPoints(payload.booths.flatMap((booth) => booth.points))
      : null
    this.pasteTargets = this.boothPasteSnapTargets(payload.booths)
    this.pasteTarget = { x: payload.center.x + 4, z: payload.center.z + 4 }
    root.position.set(
      this.pasteTarget.x - this.pasteCenter.x,
      0,
      this.pasteTarget.z - this.pasteCenter.z,
    )
    this.previewRoot.add(root)
    this.pasteGhost = root
    this.snapRing.visible = true
    this.snapRing.position.set(this.pasteTarget.x, 0.05, this.pasteTarget.z)
    this.host.style.cursor = 'crosshair'
    this.opts.onHover?.(this.pasteTarget)
  }

  stopBoothPaste() {
    if (!this.pasteGhost) return
    this.previewRoot.remove(this.pasteGhost)
    disposeDeep(this.pasteGhost)
    this.pasteGhost = null
    this.pasteTarget = null
    this.pasteBaseBox = null
    this.pasteTargets = []
    this.snapRing.visible = false
    this.updateSnapGuide(null)
    this.opts.onHover?.(null)
  }

  private updateBoothPaste(raw: Pt) {
    if (!this.pasteGhost) return
    let target = snapToGrid(raw, SNAP)
    let snapTarget: SnapBox | null = null
    if (this.pasteBaseBox) {
      const baseDx = target.x - this.pasteCenter.x
      const baseDz = target.z - this.pasteCenter.z
      const snapped = snapEdgeDelta(
        this.pasteBaseBox,
        baseDx,
        baseDz,
        this.pasteTargets,
        EDGE_SNAP,
      )
      target = {
        x: this.pasteCenter.x + snapped.dx,
        z: this.pasteCenter.z + snapped.dz,
      }
      snapTarget = snapped.target
    }
    this.pasteTarget = target
    this.pasteGhost.position.set(
      target.x - this.pasteCenter.x,
      0,
      target.z - this.pasteCenter.z,
    )
    this.snapRing.visible = true
    this.snapRing.position.set(target.x, 0.05, target.z)
    this.updateSnapGuide(snapTarget)
    this.opts.onHover?.(target)
  }

  setMode(mode: StageMode) {
    this.mode = mode
    this.host.style.cursor = mode === 'draw' ? 'crosshair' : 'default'
    if (mode !== 'draw') {
      this.cancelRectDrag()
      this.cancelUnderlayDrag()
      this.snapRing.visible = false
      this.rubber.visible = false
      if (this.infraKind) this.stopInfraPlace()
      this.stopBoothPaste()
      this.opts.onHover?.(null)
    }
  }

  setGridVisible(visible: boolean) {
    this.gridGroup.visible = visible
  }

  /** 纯渲染模式：禁用拾取、拖动、绘制等编辑交互，保留相机操作 */
  setReadOnly(on: boolean) {
    this.readOnly = on
    this.host.style.cursor = 'default'
  }

  // ---------- 底图 ----------

  /** 同步底图：图片不变时只更新位置、尺寸与透明度，避免重复解码 */
  setUnderlay(spec: Underlay | null) {
    if (!spec) {
      this.underlaySpec = null
      this.clearUnderlay()
      return
    }
    const next = clampUnderlaySpec(spec)
    this.underlaySpec = next
    // 外部状态需要收敛时回传处理后的值，保证 App 与渲染一致
    if (
      next.width !== spec.width ||
      next.height !== spec.height ||
      next.x !== spec.x ||
      next.z !== spec.z ||
      next.opacity !== spec.opacity
    ) {
      this.opts.onUnderlayChange?.(next)
    }
    this.underlayGroup.visible = next.visible !== false
    if (next.image !== this.underlayImage) {
      this.underlayImage = next.image
      this.loadUnderlayTexture(next.image)
      return
    }
    this.applyUnderlay()
  }

  private applyUnderlay() {
    const spec = this.underlaySpec
    this.underlayGroup.visible = !!spec && spec.visible !== false
    if (!spec || !this.underlayMesh) return
    const mat = this.underlayMesh.material as THREE.MeshBasicMaterial
    mat.opacity = Math.min(1, Math.max(0, spec.opacity))
    this.underlayMesh.scale.set(
      Math.max(0.01, spec.width),
      1,
      Math.max(0.01, spec.height),
    )
    this.underlayMesh.position.set(spec.x, UNDERLAY_Y, spec.z)
  }

  private loadUnderlayTexture(src: string) {
    const token = ++this.underlayToken
    const loader = new THREE.TextureLoader()
    loader.load(
      src,
      (texture) => {
        if (token !== this.underlayToken) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
        this.replaceUnderlayTexture(texture)
        this.applyUnderlay()
      },
      undefined,
      () => {
        if (token === this.underlayToken) console.warn('[底图] 图片加载失败')
      },
    )
  }

  private replaceUnderlayTexture(texture: THREE.Texture) {
    if (this.underlayMesh) {
      this.underlayGroup.remove(this.underlayMesh)
      disposeDeep(this.underlayMesh)
      this.underlayMesh = null
    }
    this.underlayTexture?.dispose()
    this.underlayTexture = texture

    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'underlay'
    this.underlayGroup.add(mesh)
    this.underlayMesh = mesh
  }

  private clearUnderlay() {
    this.underlayToken += 1
    this.underlayImage = ''
    this.underlayGroup.visible = false
    this.cancelUnderlayDrag()
    if (this.underlayMesh) {
      this.underlayGroup.remove(this.underlayMesh)
      disposeDeep(this.underlayMesh)
      this.underlayMesh = null
    }
    this.underlayTexture?.dispose()
    this.underlayTexture = null
  }

  /** 尺寸 / 位置统一收敛（最小尺寸、1 m 取整）并回传给上层状态 */
  private emitUnderlay(next: Underlay) {
    const spec = clampUnderlaySpec(next)
    this.underlaySpec = spec
    this.applyUnderlay()
    this.opts.onUnderlayChange?.(spec)
  }

  /** Ctrl + 滚轮：每格缩放 1 m，以底图中心为基准 */
  private onUnderlayWheel = (e: WheelEvent) => {
    if (!e.ctrlKey || e.target !== this.renderer.domElement) return
    if (this.walkState !== 'off' || this.readOnly) return
    const spec = this.underlaySpec
    if (!spec || spec.visible === false) return
    e.preventDefault()
    e.stopPropagation()
    // 已锁定：拦截 Ctrl + 滚轮，避免误缩放底图（也不触发相机缩放）
    if (spec.locked === true) return

    // 一次鼠标滚轮事件固定 1 m；触控板的细碎滚动先累计再步进
    const unit =
      e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? this.host.clientHeight || 800 : 1
    const delta = e.deltaY * unit
    if (!delta) return
    let steps = 0
    if (Math.abs(delta) >= UNDERLAY_WHEEL_NOTCH) {
      steps = delta < 0 ? 1 : -1
      this.underlayWheelAcc = 0
    } else {
      this.underlayWheelAcc += delta
      while (this.underlayWheelAcc <= -UNDERLAY_WHEEL_NOTCH) {
        this.underlayWheelAcc += UNDERLAY_WHEEL_NOTCH
        steps += 1
      }
      while (this.underlayWheelAcc >= UNDERLAY_WHEEL_NOTCH) {
        this.underlayWheelAcc -= UNDERLAY_WHEEL_NOTCH
        steps -= 1
      }
    }
    if (!steps) return

    const size = Math.max(spec.width, spec.height)
    const current = Math.round(size)
    const nextSize = Math.max(UNDERLAY_MIN_SIZE, current + steps)
    if (nextSize === current) return
    const k = nextSize / size
    this.emitUnderlay({ ...spec, width: spec.width * k, height: spec.height * k })
  }

  private updateUnderlayDrag(e: PointerEvent) {
    const d = this.underlayDrag
    const spec = this.underlaySpec
    if (!d || !spec || spec.visible === false) return
    const p = this.groundPoint(e.clientX, e.clientY)
    if (!p) return
    // 位移按 1 m 网格取整，底图逐格移动，可拖出网格
    this.emitUnderlay({
      ...spec,
      x: d.startX + Math.round(p.x - d.origin.x),
      z: d.startZ + Math.round(p.z - d.origin.z),
    })
  }

  // ---------- 视角 ----------

  private fitShadow(points: Pt[], height: number) {
    const b = boundsOf(points)
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const halfW = (b.maxX - b.minX) / 2
    const halfD = (b.maxZ - b.minZ) / 2
    // 包围球半径 + 少量余量，阴影相机更贴合场景，提高阴影贴图密度
    const r = Math.max(8, Math.hypot(halfW, halfD) + 10)
    this.sunRadius = Math.max(120, r * 2.2)

    // 极致画质固定 4096；高画质按场景大小；中/低画质降低分辨率
    const baseMapSize = r > 42 ? 4096 : 2048
    const mapSize =
      this.quality === 'ultra'
        ? 4096
        : this.quality === 'high'
          ? baseMapSize
          : this.quality === 'medium'
            ? Math.min(baseMapSize, 2048)
            : Math.min(baseMapSize, 1024)
    if (this.keyLight.shadow.mapSize.x !== mapSize) {
      this.keyLight.shadow.mapSize.set(mapSize, mapSize)
      if (this.keyLight.shadow.map) {
        this.keyLight.shadow.map.dispose()
        this.keyLight.shadow.map = null
      }
    }

    const cam = this.keyLight.shadow.camera
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 1
    cam.far = Math.max(200, r * 8)
    cam.updateProjectionMatrix()
    this.keyLight.target.position.set(cx, height * 0.4, cz)
    this.keyLight.target.updateMatrixWorld()
    this.keyLight.position.set(cx + r * 0.78, r * 0.95 + height * 1.1, cz + r * 0.95)
  }

  private contentPoints(): { points: Pt[]; height: number } {
    if (this.venue) return { points: this.venue.points, height: this.venue.height }
    // 空白场景（开始绘制场馆）的默认取景：按视口短边给出足够大的绘制范围，
    // 同时把 1m 网格控制在约 7px 左右，避免开场时视野被放大到只能看到一小块场地
    const shortPx = Math.min(this.host.clientWidth || 1200, this.host.clientHeight || 800)
    const half = Math.min(60, Math.max(20, shortPx / 20))
    return {
      points: [
        { x: -half, z: -half },
        { x: half, z: -half },
        { x: half, z: half },
        { x: -half, z: half },
      ],
      height: 6,
    }
  }

  /** elevation 越大俯角越高，1.28 约 42°，2.6 约 61°（可看进馆内）；distanceScale 用于拉远取景 */
  fit(points?: Pt[], height?: number, elevation = 1.28, distanceScale = 1) {
    const src = points && points.length ? { points, height: height ?? 6 } : this.contentPoints()
    const b = boundsOf(src.points)
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const w = Math.max(b.maxX - b.minX, 2)
    const d = Math.max(b.maxZ - b.minZ, 2)
    const hh = src.height
    const size = Math.max(w, d, hh * 1.2)
    const vFov = (this.camera.fov * Math.PI) / 180
    // 竖屏时水平视角很窄，必须同时按横向 FOV 计算，否则场馆会被裁掉 / 像贴在镜头前
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)
    const baseDist =
      Math.max(
        (size * 1.28) / (2 * Math.tan(vFov / 2)),
        (size * 1.28) / (2 * Math.tan(hFov / 2)),
      ) +
      hh * 1.1
    const dist = baseDist * distanceScale
    const dir = new THREE.Vector3(1, elevation, 1.02).normalize()
    const target = new THREE.Vector3(cx, hh * 0.3, cz)
    this.animateCamera(target.clone().addScaledVector(dir, dist), target)
  }

  viewTop() {
    const src = this.contentPoints()
    const b = boundsOf(src.points)
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const w = Math.max(b.maxX - b.minX, 2)
    const d = Math.max(b.maxZ - b.minZ, 2)
    const vFov = (this.camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)
    // 1.35 的取景余量比原来的 1.9 更紧凑，移动端选点时不至于把场馆缩得太小
    const dist = Math.max(
      (d * 1.35) / (2 * Math.tan(vFov / 2)),
      (w * 1.35) / (2 * Math.tan(hFov / 2)),
      10,
    )
    this.animateCamera(new THREE.Vector3(cx, dist, cz + 0.01), new THREE.Vector3(cx, 0, cz))
  }

  viewIso() {
    // 只切换到等轴测方向，保持当前距离与观察目标；「适配」才重新框选模型
    const target = this.controls.target.clone()
    const dist = Math.max(2, this.camera.position.distanceTo(target))
    const dir = new THREE.Vector3(1, 1.28, 1.02).normalize()
    this.animateCamera(target.clone().addScaledVector(dir, dist), target)
  }

  /** 从结构列表选中展台时，将视角聚焦到该展台 */
  focusBooth(id: string) {
    const booth = this.boothSpecs.get(id)
    if (!booth) return
    this.fit(booth.points, booth.height, 1.15, 2)
  }

  /** 从结构列表选中基础设施时，将视角聚焦到该设施 */
  focusInfra(id: string) {
    const group = this.infraGroups.get(id)
    if (!group) return
    group.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(group)
    if (box.isEmpty()) return
    const points: Pt[] = [
      { x: box.min.x, z: box.min.z },
      { x: box.max.x, z: box.min.z },
      { x: box.max.x, z: box.max.z },
      { x: box.min.x, z: box.max.z },
    ]
    this.fit(points, Math.max(1, box.max.y - Math.max(0, box.min.y)), 1.15, 2)
  }

  private animateCamera(pos: THREE.Vector3, target: THREE.Vector3, dur = 760) {
    this.tween = {
      p0: this.camera.position.clone(),
      p1: pos.clone(),
      t0: this.controls.target.clone(),
      t1: target.clone(),
      start: performance.now(),
      dur,
    }
  }

  // ---------- 交互 ----------

  private bindEvents() {
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerleave', this.onPointerLeave)
    el.addEventListener('pointercancel', this.onPointerCancel)
    el.addEventListener('dblclick', this.onDblClick)
    el.addEventListener('contextmenu', this.onContextMenu)
    document.addEventListener('mousemove', this.onWalkMouseMove)
    document.addEventListener('mousedown', this.onWalkMouseDown)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    // 捕获阶段拦截，漫游时屏蔽页面全局快捷键
    window.addEventListener('keydown', this.onWalkKeyDown, true)
    window.addEventListener('keyup', this.onWalkKeyUp, true)
    window.addEventListener('keydown', this.onNavKeyDown)
    window.addEventListener('keyup', this.onNavKeyUp)
    window.addEventListener('blur', this.onWindowBlur)
    // 捕获阶段优先于 OrbitControls 的滚轮缩放，Ctrl + 滚轮用于缩放底图
    window.addEventListener('wheel', this.onUnderlayWheel, { capture: true, passive: false })
  }

  /** 空格：临时切换为纯视角导航（输入框内不拦截） */
  private onNavKeyDown = (e: KeyboardEvent) => {
    if ((e.code !== 'Space' && e.key !== ' ') || e.repeat) return
    if (this.walkState !== 'off' || this.spaceNav) return
    const el = e.target as HTMLElement | null
    if (
      el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable)
    ) {
      return
    }
    // 拖动进行中不打断当前手势，等下一次按下再进入导航模式
    if (this.drag || this.infraDrag) return

    e.preventDefault()
    this.spaceNav = true
    this.down = null
    // 空格 + 右键固定为平移，即使当前处于设施放置模式
    this.spacePrevRight = this.controls.mouseButtons.RIGHT
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
    this.host.style.cursor = 'grab'
    this.opts.onSpaceNav?.(true)
  }

  private restoreRightMouse() {
    // 设施放置模式需要右键旋转，恢复为 undefined；其他模式恢复平移
    this.controls.mouseButtons.RIGHT = this.infraKind
      ? undefined
      : (this.spacePrevRight ?? THREE.MOUSE.PAN)
    this.spacePrevRight = undefined
  }

  private onNavKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space' && e.key !== ' ') return
    if (!this.spaceNav) return
    this.spaceNav = false
    this.restoreRightMouse()
    this.host.style.cursor = this.mode === 'draw' ? 'crosshair' : 'default'
    this.opts.onSpaceNav?.(false)
  }

  private onWindowBlur = () => {
    this.walkAltReleased = false
    this.opts.onMinimapHold?.(false)
    this.cancelUnderlayDrag()
    if (!this.spaceNav) return
    this.spaceNav = false
    this.restoreRightMouse()
    this.host.style.cursor = this.mode === 'draw' ? 'crosshair' : 'default'
    this.opts.onSpaceNav?.(false)
  }

  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() }
    this.rightClick = null
    this.updateSnapGuide(null)
    // 让画布接管焦点，避免 Enter 误触面板按钮
    this.renderer.domElement.focus({ preventScroll: true })

    if (this.walkState !== 'off') return
    if (this.spaceNav) {
      // 空格导航：本次手势完全交给 OrbitControls，不选中、不拖动
      this.down = null
      this.host.style.cursor = 'grabbing'
      return
    }
    if (this.readOnly) return

    // 底图：Ctrl + 左键拖动；落在展台 / 设施上时仍保留 Ctrl 多选等原有交互
    if (
      e.button === 0 &&
      e.ctrlKey &&
      e.isPrimary &&
      this.underlaySpec &&
      this.underlaySpec.visible !== false &&
      !this.pickBoothAt(e.clientX, e.clientY) &&
      !this.pickInfraAt(e.clientX, e.clientY)
    ) {
      // 已锁定：吞掉 Ctrl + 左键，避免误移动底图或误触发绘制
      if (this.underlaySpec.locked === true) {
        this.down = null
        return
      }
      const p = this.groundPoint(e.clientX, e.clientY)
      if (p) {
        this.underlayDrag = {
          startX: this.underlaySpec.x,
          startZ: this.underlaySpec.z,
          origin: p,
        }
        this.controls.enabled = false
        this.host.style.cursor = 'grabbing'
        this.down = null
        return
      }
    }

    // 绘制场馆 / 展台：左键按下记录矩形起点，拖动超过阈值后切换为拉框
    if (this.rectEnabled && this.mode === 'draw' && e.button === 0) {
      if (!e.isPrimary) {
        // 第二根手指按下：放弃拉框，交给双指缩放 / 平移
        this.cancelRectDrag()
        this.down = null
        return
      }
      if (!this.infraKind && !this.pasteGhost) {
        const p = this.pickGround(e)
        if (p) {
          this.rectDrag = {
            start: p,
            current: p,
            sx: e.clientX,
            sy: e.clientY,
            active: false,
          }
        }
      }
    }

    // 放置基础设施时，右键旋转 90°
    if (this.mode === 'draw' && this.infraKind && e.button === 2) {
      e.preventDefault()
      this.rotateInfraPlace()
      return
    }

    // 空闲模式右键：记录候选对象，未拖动时在 pointerup 旋转
    if (this.mode === 'idle' && e.button === 2) {
      const infraId = this.pickInfraAt(e.clientX, e.clientY)
      if (infraId) {
        const spec = this.infras.find((it) => it.id === infraId)
        // 出入口沿墙吸附，不参与右键旋转
        if (spec && spec.kind !== 'gate' && spec.kind !== 'window') {
          this.rightClick = { x: e.clientX, y: e.clientY, t: performance.now(), infraId }
        }
        return
      }

      const boothId = this.pickBoothAt(e.clientX, e.clientY)
      if (boothId) {
        this.rightClick = { x: e.clientX, y: e.clientY, t: performance.now(), boothId }
      }
      return
    }

    // 浏览模式：按住对象即可拖动 / Alt 拖动旋转；Ctrl 点击留给多选
    if (this.mode !== 'idle' || e.button !== 0) return

    const infraId = this.pickInfraAt(e.clientX, e.clientY)
    if (infraId) {
      const additive = e.ctrlKey || e.metaKey || e.shiftKey
      const alreadySelected = this.selectedInfraIds.includes(infraId)
      if (additive || !alreadySelected) {
        this.opts.onPick?.(infraId, additive, 'infra')
      }
      if (additive) return

      const spec = this.infras.find((it) => it.id === infraId)
      const group = this.infraGroups.get(infraId)
      if (!spec || !group) return

      const ids =
        alreadySelected && this.selectedInfraIds.length > 1
          ? this.selectedInfraIds
          : [infraId]
      const items: InfraDragItem[] = []
      for (const id of ids) {
        const itemSpec = this.infras.find((it) => it.id === id)
        const itemGroup = this.infraGroups.get(id)
        if (!itemSpec || !itemGroup) continue
        // 门窗依附墙面，不参与整体拖动
        if (ids.length > 1 && (itemSpec.kind === 'gate' || itemSpec.kind === 'window')) {
          items.length = 0
          break
        }
        items.push({
          id,
          spec: itemSpec,
          group: itemGroup,
          x: itemSpec.x,
          z: itemSpec.z,
          rotation: itemSpec.rotation,
        })
      }
      if (!items.length) return

      this.infraDrag = {
        id: infraId,
        spec,
        group,
        sx: e.clientX,
        sy: e.clientY,
        origin: this.groundPoint(e.clientX, e.clientY) ?? { x: spec.x, z: spec.z },
        x: spec.x,
        z: spec.z,
        rotation: spec.rotation,
        moved: false,
        items,
      }
      this.controls.enabled = false
      this.host.style.cursor = 'grabbing'
      this.setInfraBoxesVisible(false)
      return
    }

    if (e.ctrlKey || e.metaKey || e.shiftKey) return
    const hit = this.pickBoothAt(e.clientX, e.clientY)
    if (!hit) return
    if (!this.selectedIds.includes(hit)) this.opts.onPick?.(hit, false, 'booth')
    const targets = this.dragTargets(hit)
    const origin = this.groundPoint(e.clientX, e.clientY)
    if (!targets.length || !origin) return

    this.drag = {
      id: hit,
      kind: e.altKey ? 'rotate' : 'move',
      sx: e.clientX,
      sy: e.clientY,
      origin,
      center: this.dragCenter(hit),
      dx: 0,
      dz: 0,
      angle: 0,
      targets,
      baseRotY: 0,
    }
    this.setBoxesVisible(this.dragIds(hit), false)
    this.controls.enabled = false
    this.host.style.cursor = e.altKey ? 'ew-resize' : 'grabbing'
  }

  private onPointerUp = (e: PointerEvent) => {
    const down = this.down
    this.down = null
    this.updateSnapGuide(null)

    // 右键单击（未拖动）旋转对象；右键拖动仍交给 OrbitControls 平移
    if (e.button === 2) {
      const rc = this.rightClick
      this.rightClick = null
      if (!rc || this.spaceNav || this.readOnly) return
      const dist = Math.hypot(e.clientX - rc.x, e.clientY - rc.y)
      if (dist > 6 || performance.now() - rc.t > 900) return
      if (rc.infraId) {
        this.opts.onRotateInfra?.(rc.infraId, 1)
      } else if (rc.boothId) {
        this.opts.onRotateBooth?.(rc.boothId, 90)
      }
      return
    }

    if (e.button !== 0) return

    if (this.walkState === 'pick') {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
        const p = this.groundPoint(e.clientX, e.clientY)
        if (p) this.enterWalk(p)
      }
      return
    }
    if (this.walkState === 'walk') return
    if (this.spaceNav) {
      this.host.style.cursor = 'grab'
      return
    }
    if (this.readOnly) return

    if (this.underlayDrag) {
      this.underlayDrag = null
      this.controls.enabled = true
      this.host.style.cursor = this.mode === 'draw' ? 'crosshair' : 'default'
      return
    }

    // 拉框结束：交给上层生成矩形轮廓；未拖动则继续按普通点击放点
    const rectDrag = this.rectDrag
    if (rectDrag) {
      this.rectDrag = null
      if (this.rectPreview) this.rectPreview.group.visible = false
      if (rectDrag.active) {
        this.opts.onDrawRect?.(rectDrag.start, rectDrag.current)
        this.host.style.cursor = 'crosshair'
        return
      }
    }

    const infraDrag = this.infraDrag
    if (infraDrag) {
      this.infraDrag = null
      this.controls.enabled = true
      this.host.style.cursor = 'default'
      for (const item of infraDrag.items) {
        item.group.position.set(
          item.spec.x,
          this.infraBaseYMap.get(item.spec.id) ?? 0,
          item.spec.z,
        )
        item.group.rotation.y = item.spec.rotation
      }
      this.setInfraBoxesVisible(true)
      if (infraDrag.moved) {
        if (infraDrag.items.length > 1) {
          this.opts.onMoveInfras?.(
            infraDrag.items.map((item) => ({
              id: item.id,
              x: item.x,
              z: item.z,
              rotation: item.rotation,
            })),
          )
        } else {
          const item = infraDrag.items[0]
          this.opts.onMoveInfra?.(
            infraDrag.id,
            item?.x ?? infraDrag.x,
            item?.z ?? infraDrag.z,
            item?.rotation ?? infraDrag.rotation,
          )
        }
      }
      return
    }

    const drag = this.drag
    if (drag) {
      this.drag = null
      this.controls.enabled = true
      this.host.style.cursor = 'default'
      const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4
      // 复位，等数据更新后重建（若校验失败则原样保留）
      for (const t of drag.targets) {
        t.position.set(0, 0, 0)
        t.rotation.y = 0
      }
      this.setBoxesVisible(this.dragIds(drag.id), true)
      this.opts.onRotateDrag?.(null)
      if (moved && drag.kind === 'move' && (drag.dx !== 0 || drag.dz !== 0)) {
        this.opts.onMoveBooth?.(drag.id, drag.dx, drag.dz)
      } else if (moved && drag.kind === 'rotate' && Math.abs(drag.angle) > 0.01) {
        this.opts.onRotateBooth?.(drag.id, (-drag.angle * 180) / Math.PI)
      }
      if (moved) return
    }

    if (!down) {
      this.host.style.cursor = this.mode === 'draw' ? 'crosshair' : 'default'
      return
    }
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y)
    if (dist > 6 || performance.now() - down.t > 900) return

    if (this.mode === 'draw') {
      if (this.pasteGhost) {
        if (this.pasteTarget) this.opts.onPlacePaste?.(this.pasteTarget)
        return
      }
      if (this.infraKind) {
        if (this.infraSpot) this.opts.onPlaceInfra?.(this.infraKind, this.infraSpot)
        return
      }
      const p = this.pickGround(e)
      if (p) this.opts.onPlace?.(p)
    } else if (this.mode === 'idle') {
      const additive = e.ctrlKey || e.metaKey || e.shiftKey
      const infraId = this.pickInfraAt(e.clientX, e.clientY)
      if (infraId) {
        this.opts.onPick?.(infraId, additive, 'infra')
        return
      }
      this.opts.onPick?.(this.pickBoothAt(e.clientX, e.clientY), additive, 'booth')
    }
  }

  /** 基础设施拖动：家具自由移动，其他设施网格吸附；出入口沿最近墙段滑动 */
  private updateInfraDrag(e: PointerEvent) {
    const d = this.infraDrag
    if (!d) return
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true
    if (!d.moved) return

    const p = this.groundPoint(e.clientX, e.clientY)
    if (!p) return

    if (d.spec.kind === 'gate' || d.spec.kind === 'window') {
      const wall = this.nearestWall(p, d.spec.kind === 'window')
      if (!wall) {
        this.updateSnapGuide(null)
        return
      }
      const snapped = this.snapWallItemEdge(
        wall.x,
        wall.z,
        wall.rotation,
        d.spec.width,
        d.id,
      )
      d.x = snapped?.x ?? wall.x
      d.z = snapped?.z ?? wall.z
      d.rotation = wall.rotation
      d.group.position.set(d.x, 0, d.z)
      d.group.rotation.y = wall.rotation
      const item = d.items[0]
      if (item) {
        item.x = d.x
        item.z = d.z
        item.rotation = d.rotation
      }
      this.updateSnapGuide(snapped ? snapBoxOfInfra(snapped.target) : null)
      return
    }

    // 家具不做网格或边缘吸附，按指针位移自由移动
    if (d.items.some((item) => isFurnitureKind(item.spec.kind))) {
      const dx = p.x - d.origin.x
      const dz = p.z - d.origin.z
      for (const item of d.items) {
        item.x = item.spec.x + dx
        item.z = item.spec.z + dz
        const baseY = isFurnitureKind(item.spec.kind)
          ? this.furnitureBaseYAt(item.x, item.z)
          : 0
        item.group.position.set(item.x, baseY, item.z)
      }
      d.x = d.spec.x + dx
      d.z = d.spec.z + dz
      this.updateSnapGuide(null)
      return
    }

    const snap = snapToGrid(p, SNAP)
    if (Math.abs(snap.x) > GRID_HALF || Math.abs(snap.z) > GRID_HALF) return
    const boxes = d.items.map((item) => snapBoxOfInfra(item.spec))
    const moving =
      boxes.length > 1
        ? {
            minX: Math.min(...boxes.map((box) => box.minX)),
            maxX: Math.max(...boxes.map((box) => box.maxX)),
            minZ: Math.min(...boxes.map((box) => box.minZ)),
            maxZ: Math.max(...boxes.map((box) => box.maxZ)),
          }
        : snapBoxOfInfra(d.spec)
    const ids = new Set(d.items.map((item) => item.id))
    const snapped = snapEdgeDelta(
      moving,
      snap.x - d.spec.x,
      snap.z - d.spec.z,
      this.infraSnapTargets(ids),
      EDGE_SNAP,
    )
    for (const item of d.items) {
      item.x = item.spec.x + snapped.dx
      item.z = item.spec.z + snapped.dz
      const baseY = isFurnitureKind(item.spec.kind)
        ? this.furnitureBaseYAt(item.x, item.z)
        : 0
      item.group.position.set(item.x, baseY, item.z)
    }
    d.x = d.spec.x + snapped.dx
    d.z = d.spec.z + snapped.dz
    this.updateSnapGuide(snapped.target)
  }

  private updateDrag(e: PointerEvent) {
    const d = this.drag
    if (!d) return
    const p = this.groundPoint(e.clientX, e.clientY)
    if (!p) return

    if (d.kind === 'move') {
      let dx = Math.round((p.x - d.origin.x) / SNAP) * SNAP
      let dz = Math.round((p.z - d.origin.z) / SNAP) * SNAP
      const booth = this.boothSpecs.get(d.id)
      if (booth) {
        const snapped = snapEdgeDelta(
          snapBoxOfPoints(booth.points),
          dx,
          dz,
          this.boothSnapTargets(d.id),
          EDGE_SNAP,
        )
        dx = snapped.dx
        dz = snapped.dz
        this.updateSnapGuide(snapped.target)
      } else {
        this.updateSnapGuide(null)
      }
      d.dx = dx
      d.dz = dz
      for (const t of d.targets) t.position.set(d.dx, 0, d.dz)
    } else {
      this.updateSnapGuide(null)
      const a0 = Math.atan2(d.origin.z - d.center.z, d.origin.x - d.center.x)
      const a1 = Math.atan2(p.z - d.center.z, p.x - d.center.x)
      let delta = a1 - a0
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      d.angle = delta
      // three 的 +Y 旋转在俯视图里是逆时针，指针角度是顺时针，取反
      let rot = -delta
      // 吸附到 0 / 90 / 180 / 270（7° 磁吸区）
      const QUARTER = Math.PI / 2
      const nearest = Math.round(rot / QUARTER) * QUARTER
      if (Math.abs(rot - nearest) < (7 * Math.PI) / 180) rot = nearest
      d.angle = -rot
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      const c = d.center
      // 绕面心旋转：T = C - R·C
      const tx = c.x - (cos * c.x + sin * c.z)
      const tz = c.z - (-sin * c.x + cos * c.z)
      for (const t of d.targets) {
        t.rotation.y = rot
        t.position.set(tx, 0, tz)
      }
      this.opts.onRotateDrag?.((rot * 180) / Math.PI)
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.walkState !== 'off') return
    if (this.spaceNav) {
      this.host.style.cursor = 'grab'
      return
    }
    if (this.readOnly) {
      this.host.style.cursor = 'default'
      return
    }
    if (this.underlayDrag) {
      this.host.style.cursor = 'grabbing'
      this.updateUnderlayDrag(e)
      return
    }
    if (this.infraDrag) {
      this.updateInfraDrag(e)
      return
    }
    if (this.drag) {
      this.updateDrag(e)
      return
    }
    if (this.rectDrag && this.mode === 'draw') {
      const rd = this.rectDrag
      if (!rd.active && Math.hypot(e.clientX - rd.sx, e.clientY - rd.sy) > 6) {
        rd.active = true
      }
      if (rd.active) {
        const p = this.pickGround(e)
        if (p) {
          rd.current = p
          this.updateRectPreview(rd.start, p)
          this.opts.onHover?.(p)
        }
        this.snapRing.visible = false
        this.rubber.visible = false
        return
      }
    }
    if (this.mode === 'idle') {
      if (this.pickInfraAt(e.clientX, e.clientY)) {
        this.host.style.cursor = 'pointer'
        return
      }
      const hit = this.pickBoothAt(e.clientX, e.clientY)
      this.host.style.cursor =
        hit && this.selectedIds.includes(hit) ? (e.altKey ? 'ew-resize' : 'grab') : 'default'
      return
    }
    if (this.mode !== 'draw') return
    if (this.pasteGhost) {
      const raw = this.groundPoint(e.clientX, e.clientY)
      if (raw) this.updateBoothPaste(raw)
      return
    }
    if (this.infraKind) {
      const raw = this.groundPoint(e.clientX, e.clientY)
      this.updateInfraGhost(raw)
      const free = isFurnitureKind(this.infraKind)
      this.opts.onHover?.(raw ? (free ? raw : snapToGrid(raw, SNAP)) : null)
      return
    }
    const p = this.pickGround(e)
    this.opts.onHover?.(p)
    if (!p) {
      this.snapRing.visible = false
      this.rubber.visible = false
      return
    }
    this.snapRing.visible = true
    this.snapRing.position.set(p.x, 0.05, p.z)

    const pts = this.draftPoints
    if (pts.length) {
      const last = pts[pts.length - 1]
      this.rubberPos[0] = last.x
      this.rubberPos[1] = 0.04
      this.rubberPos[2] = last.z
      this.rubberPos[3] = p.x
      this.rubberPos[4] = 0.04
      this.rubberPos[5] = p.z
      const geo = this.rubber.geometry as THREE.BufferGeometry
      ;(geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      this.rubber.computeLineDistances()
      this.rubber.visible = true
    }
  }

  private onPointerLeave = () => {
    if (this.walkState !== 'off') return
    this.snapRing.visible = false
    this.rubber.visible = false
    this.updateSnapGuide(null)
    this.opts.onHover?.(null)
  }

  private onPointerCancel = () => {
    this.down = null
    this.cancelRectDrag()
    this.cancelUnderlayDrag()
    this.snapRing.visible = false
    this.rubber.visible = false
    this.opts.onHover?.(null)
  }

  private onDblClick = (e: MouseEvent) => {
    e.preventDefault()
    if (this.walkState !== 'off') return
    if (this.spaceNav || this.readOnly) return
    if (this.mode === 'draw') this.opts.onCloseDraft?.()
  }

  /** 屏幕坐标 → 地面坐标（不吸附） */
  private groundPoint(clientX: number, clientY: number): Pt | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null
    return { x: hit.x, z: hit.z }
  }

  private pickGround(e: MouseEvent): Pt | null {
    const raw = this.groundPoint(e.clientX, e.clientY)
    if (!raw) return null
    const p = snapToGrid(raw, SNAP)
    if (Math.abs(p.x) > GRID_HALF || Math.abs(p.z) > GRID_HALF) return null
    return p
  }

  private pickBoothAt(clientX: number, clientY: number): string | null {
    if (!this.pickables.length) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.pickables, true)
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object
      while (obj) {
        if (typeof obj.userData.boothId === 'string') return obj.userData.boothId
        if (typeof obj.userData.groupId === 'string') {
          const members = this.groupMembers.get(obj.userData.groupId) ?? []
          const hit = { x: h.point.x, z: h.point.z }
          for (const id of members) {
            const spec = this.boothSpecs.get(id)
            if (spec && pointInPolygon(hit, spec.points)) return id
          }
          return members[0] ?? null
        }
        obj = obj.parent
      }
    }
    return null
  }

  private refreshPickables() {
    this.pickables = [...this.boothGroups.values(), ...this.groupMeshes.values()]
  }

  // ---------- 第一人称漫游 ----------

  /** 进入选点状态：点击地面即从该处开始漫游 */
  startWalkPick() {
    if (this.walkState !== 'off') return
    this.walkState = 'pick'
    this.tween = null
    this.walkViewTransition = null
    this.walkReturn = null
    this.walkAltReleased = false
    this.walkUiPaused = false
    if (this.walkBody) this.walkBody.visible = false
    this.controls.enabled = false
    this.host.style.cursor = 'crosshair'
    this.applyVenueXray()
    // 进入选点统一先切到俯视并框住场馆，再点击地面降落
    this.viewTop()
    this.opts.onWalkState?.('pick')
  }

  /** 自动巡游速度倍率：0.5–2 */
  setWalkAutoSpeed(speed: number) {
    this.walkAutoSpeed = Math.max(0.5, Math.min(2, speed))
    this.opts.onWalkAutoSpeed?.(this.walkAutoSpeed)
  }

  setWalkAutoLoop(loop: boolean) {
    this.walkAutoLoop = loop
    this.opts.onWalkAutoLoop?.(loop)
  }

  isWalkAuto() {
    return this.walkAuto
  }

  /** 自动巡游时隐藏 / 恢复除巡游栏外的界面 */
  setWalkUiHidden(hidden: boolean) {
    if (hidden && !this.walkAuto) return
    if (this.walkUiHidden === hidden) return
    this.walkUiHidden = hidden
    this.opts.onWalkUiHidden?.(hidden)
  }

  private currentWalkTourStop(): WalkTourStop | null {
    const tour = this.walkTour
    if (!tour || !tour.waiting) return null
    return tour.points[tour.index]?.stop ?? null
  }

  private nextWalkTourStop(): WalkTourStop | null {
    const tour = this.walkTour
    if (!tour) return null
    const from = tour.waiting ? tour.index + 1 : tour.index
    for (let i = from; i < tour.points.length; i++) {
      const stop = tour.points[i].stop
      if (stop) return stop
    }
    if (!this.walkAutoLoop) return null
    // 循环时下一站回到本轮的第一站
    for (let i = 0; i < tour.points.length; i++) {
      const stop = tour.points[i].stop
      if (stop) return stop
    }
    return null
  }

  private emitWalkTourInfo(force = false) {
    if (!this.walkAuto || !this.walkTour) {
      if (force || this.walkTourInfoKey) {
        this.walkTourInfoKey = ''
        this.opts.onWalkTourInfo?.({ current: null, next: null })
      }
      return
    }
    const current = this.currentWalkTourStop()
    const next = this.nextWalkTourStop()
    const key = `${current?.boothId ?? ''}|${next?.boothId ?? ''}|${current ? 1 : 0}`
    if (!force && key === this.walkTourInfoKey) return
    this.walkTourInfoKey = key
    this.opts.onWalkTourInfo?.({
      current: current ? walkTourStopInfo(current) : null,
      next: next ? walkTourStopInfo(next) : null,
    })
  }

  /** 开启 / 停止自动巡游；开启失败时返回 false */
  toggleWalkAuto(): boolean {
    if (this.walkState !== 'walk') return false
    if (this.walkAuto) {
      this.stopWalkAuto()
      return true
    }
    const venue = this.venue
    const inner = this.walkInnerPts
    if (!venue || !inner) {
      this.opts.onWalkAutoFail?.()
      return false
    }
    const route = buildWalkTour({
      venue,
      inner,
      booths: [...this.boothSpecs.values()],
      infras: this.infras,
      start: { x: this.walkPos.x, z: this.walkPos.z },
      gridHalf: GRID_HALF,
    })
    if (!route || route.points.length < 2) {
      this.opts.onWalkAutoFail?.()
      return false
    }
    this.walkTour = {
      points: route.points,
      index: 1,
      waiting: false,
      waitUntil: 0,
      lastStopIndex: route.lastStopIndex,
    }
    this.walkAuto = true
    this.setWalkUiHidden(false)
    this.walkKeys.clear()
    this.walkMove = { x: 0, z: 0 }
    this.walkMoveBoost = 0
    this.opts.onWalkAuto?.(true)
    this.emitWalkTourInfo(true)
    return true
  }

  stopWalkAuto() {
    if (!this.walkAuto) return
    this.walkAuto = false
    this.setWalkUiHidden(false)
    this.walkTour = null
    this.walkKeys.clear()
    this.opts.onWalkAuto?.(false)
    this.emitWalkTourInfo(true)
  }

  /** 退出漫游，或取消选点 */
  stopWalk() {
    if (this.walkState === 'walk' || this.walkState === 'enter') this.exitWalk()
    else if (this.walkState === 'pick') this.cancelWalkPick()
  }

  private cancelWalkPick() {
    if (this.walkState !== 'pick') return
    this.walkState = 'off'
    this.controls.enabled = true
    this.host.style.cursor = 'default'
    this.applyVenueXray()
    this.opts.onWalkState?.('off')
  }

  /** 选点：落在展台上则站上顶面，落在墙体上则移到最近的可行走点 */
  private spawnPoint(p: Pt): { x: number; z: number; ground: number } {
    for (const b of this.boothSpecs.values()) {
      if (b.points.length >= 3 && pointInPolygon(p, b.points)) {
        // 展台中间已挖空，落在轮廓内时站在展台内部地面
        return { x: p.x, z: p.z, ground: 0 }
      }
    }

    const v = this.venue
    if (!v) return { x: p.x, z: p.z, ground: 0 }

    const inner = insetPolygon(v.points, WALL_PAD) ?? v.points
    if (pointInPolygon(p, inner) || !pointInPolygon(p, v.points)) {
      return { x: p.x, z: p.z, ground: 0 }
    }

    let best = inner[0]
    let bestDist = Infinity
    for (const q of inner) {
      const d = Math.hypot(q.x - p.x, q.z - p.z)
      if (d < bestDist) {
        bestDist = d
        best = q
      }
    }
    return { x: best.x, z: best.z, ground: 0 }
  }

  /** 方块玩家身体：Minecraft 风格，第一人称隐藏头部，第三人称显示完整 */
  private buildWalkBody() {
    const root = new THREE.Group()
    root.name = 'walk-body'
    root.visible = false

    const torsoMat = new THREE.MeshStandardMaterial({
      color: 0x9aa6af,
      roughness: 0.82,
      metalness: 0.08,
      emissive: 0x2b343b,
      emissiveIntensity: 0.35,
    })
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0x6f7b84,
      roughness: 0.84,
      metalness: 0.06,
      emissive: 0x1f262c,
      emissiveIntensity: 0.35,
    })
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xc4cbd0,
      roughness: 0.78,
      metalness: 0.05,
      emissive: 0x394249,
      emissiveIntensity: 0.25,
    })
    const faceMat = new THREE.MeshBasicMaterial({ color: 0x26303a })

    const box = (
      parent: THREE.Object3D,
      mat: THREE.Material,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }

    // 躯干
    box(root, torsoMat, 0.52, 0.62, 0.3, 0, 1.03, 0)

    // 头部（第一人称隐藏）
    const head = new THREE.Group()
    head.position.set(0, 1.52, 0)
    root.add(head)
    box(head, headMat, 0.38, 0.38, 0.38, 0, 0, 0)
    const face = box(head, faceMat, 0.28, 0.16, 0.02, 0, -0.02, -0.2)
    face.castShadow = false

    // 手臂：绕肩部旋转
    const armL = new THREE.Group()
    armL.position.set(-0.35, 1.32, 0)
    root.add(armL)
    box(armL, limbMat, 0.18, 0.56, 0.22, 0, -0.28, 0)

    const armR = new THREE.Group()
    armR.position.set(0.35, 1.32, 0)
    root.add(armR)
    box(armR, limbMat, 0.18, 0.56, 0.22, 0, -0.28, 0)

    // 腿：绕髋部旋转
    const legL = new THREE.Group()
    legL.position.set(-0.14, 0.72, 0)
    root.add(legL)
    box(legL, limbMat, 0.22, 0.72, 0.24, 0, -0.36, 0)

    const legR = new THREE.Group()
    legR.position.set(0.14, 0.72, 0)
    root.add(legR)
    box(legR, limbMat, 0.22, 0.72, 0.24, 0, -0.36, 0)

    this.walkBody = root
    this.walkHead = head
    this.walkArmL = armL
    this.walkArmR = armR
    this.walkLegL = legL
    this.walkLegR = legR
  }

  /** 更新身体位置、朝向和简单步行摆动 */
  private updateWalkBody(dt: number, moving: boolean) {
    const body = this.walkBody
    if (!body) return

    const active = this.walkState === 'walk' || this.walkState === 'enter'
    body.visible = active
    if (!active) return

    const feet = this.walkPos.y - EYE_HEIGHT
    // 身体始终在脚下，摄像机保持在头部眼高，避免第一人称看起来像悬空俯视
    body.scale.setScalar(1)
    body.position.set(this.walkPos.x, feet, this.walkPos.z)
    body.rotation.y = this.walkYaw
    // 第一视角切到第三视角时，镜头从头部退出前先不显示头部，避免穿模
    if (this.walkHead) {
      this.walkHead.visible = this.walkView === 'third' && !this.walkViewTransition
    }

    if (moving) this.walkAnimPhase += dt * 9
    const swing = moving ? Math.sin(this.walkAnimPhase) * 0.55 : 0
    if (this.walkArmL) this.walkArmL.rotation.x = swing
    if (this.walkArmR) this.walkArmR.rotation.x = -swing
    if (this.walkLegL) this.walkLegL.rotation.x = -swing
    if (this.walkLegR) this.walkLegR.rotation.x = swing
  }

  /** 为天气面板释放鼠标并暂停漫游移动，但保留当前漫游位置 */
  suspendWalkForUi() {
    if (this.walkState !== 'walk') return
    this.walkUiPaused = true
    this.opts.onMinimapHold?.(false)
    this.walkKeys.clear()
    this.walkMove = { x: 0, z: 0 }
    this.walkMoveBoost = 0
    this.updateWalkBody(0, false)
    if (!this.isTouchDevice && document.pointerLockElement === this.renderer.domElement) {
      this.walkAltReleased = true
      document.exitPointerLock()
    }
  }

  /** 关闭天气面板后恢复漫游和鼠标锁定 */
  resumeWalkFromUi() {
    if (this.walkState !== 'walk') return
    this.walkUiPaused = false
    this.walkAltReleased = false
    if (!this.isTouchDevice) this.lockPointer()
  }

  setWalkView(view: WalkView) {
    if (this.walkView === view) return
    this.walkView = view
    if (this.walkState === 'walk') {
      // 记录当前机位，逐帧插值到新视角；目标机位会随角色移动 / 转向实时更新
      this.walkViewTransition = {
        fromPos: this.camera.position.clone(),
        fromQuat: this.camera.quaternion.clone(),
        start: performance.now(),
        duration: 320,
      }
      if (this.walkHead && view === 'first') this.walkHead.visible = false
    } else if (this.walkHead) {
      this.walkHead.visible = view === 'third'
    }
    this.opts.onWalkView?.(view)
  }

  toggleWalkView() {
    this.setWalkView(this.walkView === 'first' ? 'third' : 'first')
  }

  private enterWalk(p: Pt) {
    const spawn = this.spawnPoint(p)
    this.walkSaved = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
    }
    this.walkPrevFov = this.camera.fov
    this.camera.fov = 68
    this.camera.updateProjectionMatrix()
    this.walkViewTransition = null

    this.walkPos.set(spawn.x, spawn.ground + EYE_HEIGHT, spawn.z)
    this.walkVelY = 0
    this.walkOnGround = true
    this.walkKeys.clear()
    this.walkMove = { x: 0, z: 0 }
    this.walkMoveBoost = 0
    this.walkAltReleased = false
    this.walkUiPaused = false
    this.walkInnerPts = this.venue
      ? (insetPolygon(this.venue.points, WALL_PAD) ?? this.venue.points)
      : null

    // 初始朝向场馆中心，从外侧进入时不会背对场景
    const look = this.venue ? centroid(this.venue.points) : { x: 0, z: 0 }
    const dx = look.x - spawn.x
    const dz = look.z - spawn.z
    if (Math.hypot(dx, dz) > 0.6) {
      this.walkYaw = Math.atan2(-dx, -dz)
    } else {
      const dir = new THREE.Vector3()
      this.camera.getWorldDirection(dir)
      this.walkYaw = Math.atan2(-dir.x, -dir.z)
    }
    this.walkPitch = 0
    // 记录本次漫游的起点，R 键可平滑返回
    this.walkHomePos.copy(this.walkPos)
    this.walkHomeYaw = this.walkYaw
    this.walkHomePitch = this.walkPitch
    this.walkReturn = null

    // 从当前 orbit 视角平滑过渡到人眼或第三人称机位
    const thirdPose = this.walkView === 'third' ? this.getThirdPersonPose() : null
    let toQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.walkPitch, this.walkYaw, 0, 'YXZ'),
    )
    if (thirdPose) {
      const m = new THREE.Matrix4().lookAt(
        thirdPose.pos,
        thirdPose.aim,
        new THREE.Vector3(0, 1, 0),
      )
      toQuat = new THREE.Quaternion().setFromRotationMatrix(m)
    }

    this.walkEnter = {
      t0: performance.now(),
      dur: 760,
      fromPos: this.camera.position.clone(),
      toPos: thirdPose ? thirdPose.pos : this.walkPos.clone(),
      fromQuat: this.camera.quaternion.clone(),
      toQuat,
    }
    this.walkState = 'enter'
    this.applyVenueXray()
    this.updateWalkBody(0, false)
    this.controls.enabled = false
    this.host.style.cursor = 'default'
    this.opts.onWalkState?.('enter')
    // 移动端没有指针锁定，视角交给右侧虚拟摇杆
    if (!this.isTouchDevice) this.lockPointer()
  }

  private updateWalkEnter(now: number) {
    const e = this.walkEnter
    if (!e) {
      this.finishWalkEnter()
      return
    }

    const k = Math.min(1, (now - e.t0) / e.dur)
    const ease = 1 - Math.pow(1 - k, 3)
    this.camera.position.lerpVectors(e.fromPos, e.toPos, ease)
    this.camera.quaternion.slerpQuaternions(e.fromQuat, e.toQuat, ease)
    if (k >= 1) this.finishWalkEnter()
  }

  private finishWalkEnter() {
    this.walkEnter = null
    this.walkState = 'walk'
    this.updateWalkBody(0, false)
    this.applyWalkCamera()
    this.opts.onWalkState?.('walk')
  }

  private lockPointer() {
    const el = this.renderer.domElement
    try {
      void Promise.resolve(el.requestPointerLock()).catch(() => {
        /* 浏览器拒绝指针锁定时仍可漫游，只是不能转动视角 */
      })
    } catch {
      /* 忽略指针锁定失败 */
    }
  }

  private exitWalk(restore = true) {
    if (this.walkState === 'off') return
    this.stopWalkAuto()
    this.setWalkUiHidden(false)
    this.walkState = 'off'
    this.walkEnter = null
    this.walkViewTransition = null
    this.walkReturn = null
    this.walkAltReleased = false
    this.walkUiPaused = false
    this.applyVenueXray()
    this.opts.onMinimapHold?.(false)
    this.walkKeys.clear()
    this.walkMove = { x: 0, z: 0 }
    this.walkMoveBoost = 0
    if (this.walkBody) this.walkBody.visible = false
    this.clearWalkInteract()
    if (this.walkPrevFov !== null) {
      this.camera.fov = this.walkPrevFov
      this.camera.updateProjectionMatrix()
      this.walkPrevFov = null
    }
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    this.controls.enabled = true
    this.host.style.cursor = 'default'
    this.opts.onWalkState?.('off')
    if (restore && this.walkSaved) this.animateCamera(this.walkSaved.pos, this.walkSaved.target)
    this.walkSaved = null
  }

  private onPointerLockChange = () => {
    // Alt 主动释放鼠标时不退出漫游；其他指针锁丢失（如 Esc）仍退出
    if (
      (this.walkState === 'walk' || this.walkState === 'enter') &&
      document.pointerLockElement !== this.renderer.domElement
    ) {
      if (this.walkAltReleased) return
      this.exitWalk()
    }
  }

  private onWalkMouseMove = (e: MouseEvent) => {
    if (this.walkState !== 'walk' || this.walkAuto) return
    if (document.pointerLockElement !== this.renderer.domElement) return
    this.walkYaw -= e.movementX * MOUSE_SENS
    this.walkPitch -= e.movementY * MOUSE_SENS
    const lim = Math.PI / 2 - 0.05
    this.walkPitch = Math.max(-lim, Math.min(lim, this.walkPitch))
  }

  private onWalkKeyDown = (e: KeyboardEvent) => {
    // 隐藏界面时，任意按键只负责恢复界面，不触发其他操作
    if (
      this.walkState === 'walk' &&
      this.walkAuto &&
      this.walkUiHidden &&
      this.opts.allowWalkUiHidden !== false
    ) {
      e.preventDefault()
      e.stopPropagation()
      this.setWalkUiHidden(false)
      return
    }

    // 漫游中 F1 先退出漫游，再把帮助面板交给 App 打开
    if (e.key === 'F1') {
      if (this.walkState === 'off') return
      e.preventDefault()
      e.stopPropagation()
      this.exitWalk()
      this.opts.onHelp?.()
      return
    }

    if (this.walkState === 'enter') {
      e.stopPropagation()
      return
    }
    if (this.walkState === 'pick') {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.cancelWalkPick()
      }
      return
    }
    if (this.walkState !== 'walk') return

    // 天气面板打开时暂停漫游输入，让 W / Esc 交给页面处理
    if (this.walkUiPaused) return

    // 拦截页面级快捷键（删除、网格开关等）
    e.stopPropagation()
    const key = e.key.toLowerCase()

    // 自动巡游时按 U 隐藏界面
    if (
      this.walkAuto &&
      key === 'u' &&
      !e.repeat &&
      this.opts.allowWalkUiHidden !== false
    ) {
      e.preventDefault()
      this.setWalkUiHidden(true)
      return
    }

    // Y 打开消息输入
    if (key === 'y' && !e.repeat) {
      e.preventDefault()
      this.opts.onMessageShortcut?.()
      return
    }

    // E 切换自动巡游；[ / ] 调整速度；L 切换循环
    if (key === 'e' && !e.repeat) {
      e.preventDefault()
      this.toggleWalkAuto()
      return
    }
    if (key === '[' || key === ']') {
      e.preventDefault()
      this.setWalkAutoSpeed(this.walkAutoSpeed + (key === ']' ? 0.1 : -0.1))
      return
    }
    if (key === 'l' && !e.repeat) {
      e.preventDefault()
      this.setWalkAutoLoop(!this.walkAutoLoop)
      return
    }

    // 手动移动键立即接管自动巡游
    if (
      this.walkAuto &&
      ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(
        key,
      )
    ) {
      this.stopWalkAuto()
    }

    // 按住 M 放大并居中缩略地图
    if (key === 'm' && !e.repeat) {
      e.preventDefault()
      this.opts.onMinimapHold?.(true)
      return
    }

    // 漫游中 Alt+W 打开天气；单击 W 仍然只负责前进
    if (key === 'w' && e.altKey && !e.repeat) {
      e.preventDefault()
      this.opts.onWeatherShortcut?.()
      return
    }

    if (key === 'alt') {
      e.preventDefault()
      if (!this.isTouchDevice && document.pointerLockElement === this.renderer.domElement) {
        this.walkAltReleased = true
        document.exitPointerLock()
      }
      return
    }

    if (key === 'escape') {
      e.preventDefault()
      this.exitWalk()
      return
    }

    if (key === 'p') {
      e.preventDefault()
      this.exitWalk()
      return
    }

    if (key === 'v') {
      e.preventDefault()
      this.toggleWalkView()
      return
    }

    if (key === 'r') {
      e.preventDefault()
      this.returnWalkHome()
      return
    }

    if (key === ' ') {
      e.preventDefault()
      this.jumpWalk()
      return
    }

    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
      e.preventDefault()
    }
    this.walkKeys.add(key)
  }

  private onWalkKeyUp = (e: KeyboardEvent) => {
    if (this.walkState === 'enter') {
      e.stopPropagation()
      return
    }
    if (this.walkState !== 'walk') return
    if (this.walkUiPaused) return
    e.stopPropagation()
    const key = e.key.toLowerCase()
    if (key === 'm') {
      this.opts.onMinimapHold?.(false)
      return
    }
    if (key === 'alt') {
      if (!this.walkAltReleased) return
      this.walkAltReleased = false
      if (!this.isTouchDevice) this.lockPointer()
      return
    }
    this.walkKeys.delete(key)
  }

  /** 脚下支撑面高度：只有站在展台顶面时才以顶面为支撑，内部仍为地面 */
  private walkSupport(x: number, z: number, feetY: number): number {
    let y = 0
    for (const b of this.boothSpecs.values()) {
      if (b.points.length < 3) continue
      if (!pointInPolygon({ x, z }, b.points)) continue
      const kind = boothKindOf(b)
      // 光地 / 脚手架底部都有可直接踏上的微凸台面
      if (kind === 'openfloor' || kind === 'scaffold') {
        y = Math.max(y, Math.min(OPEN_FLOOR_HEIGHT, b.height))
        if (kind === 'openfloor') continue
      }
      // 无顶棚的脚手架展台没有可站立的顶面
      if (kind === 'scaffold' && b.canopy === false) continue
      if (feetY < b.height - 0.08) continue
      y = Math.max(y, b.height)
    }
    return y
  }

  /** 展台下部围挡碰撞：每面中间的 2m 缺口可进入，内部空心可站立 */
  private boothWallBlocked(b: Booth, x: number, z: number, feetY: number): boolean {
    if (feetY >= BOOTH_SKIRT - 0.05) return false
    const pts = b.points
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const c = pts[(i + 1) % pts.length]
      const dx = c.x - a.x
      const dz = c.z - a.z
      const len = Math.hypot(dx, dz)
      if (len < 0.05) continue
      const ux = dx / len
      const uz = dz / len
      const t = (x - a.x) * ux + (z - a.z) * uz
      if (t < 0 || t > len) continue
      const perp = Math.abs((x - a.x) * -uz + (z - a.z) * ux)
      if (perp > BOOTH_WALL / 2 + 0.24) continue
      const gap = boothGapLength(len)
      const gapStart = (len - gap) / 2
      const gapEnd = (len + gap) / 2
      if (t < gapStart - 0.05 || t > gapEnd + 0.05) return true
    }
    return false
  }

  /**
   * 水平移动是否受阻：网格边界、场馆墙体、高于当前脚部的展台侧面。
   * 跳起后脚部高于展台，即可跨上台面。
   */
  /** 世界坐标 → 基础设施局部坐标（绕 Y 轴旋转的逆变换） */
  private toInfraLocal(it: Infra, x: number, z: number): { x: number; z: number } {
    const cos = Math.cos(it.rotation)
    const sin = Math.sin(it.rotation)
    const dx = x - it.x
    const dz = z - it.z
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos }
  }

  private inInfraFootprint(it: Infra, x: number, z: number): boolean {
    const l = this.toInfraLocal(it, x, z)
    return Math.abs(l.x) <= it.width / 2 && Math.abs(l.z) <= it.depth / 2
  }

  /** 门洞范围放行，让第一人称可以穿过出入口 */
  private inGateOpening(x: number, z: number, feetY: number): boolean {
    for (const it of this.infras) {
      if (it.kind !== 'gate' || !it.open) continue
      if (feetY >= it.height - 0.05) continue
      const l = this.toInfraLocal(it, x, z)
      if (Math.abs(l.x) <= it.width / 2 - 0.1 && Math.abs(l.z) <= it.depth / 2 + 0.35) {
        return true
      }
    }
    return false
  }

  private walkBlocked(x: number, z: number, feetY: number): boolean {
    if (Math.abs(x) > GRID_HALF || Math.abs(z) > GRID_HALF) return true

    const v = this.venue
    const inner = this.walkInnerPts
    if (v && inner) {
      const inOuter = pointInPolygon({ x, z }, v.points)
      const inInner = pointInPolygon({ x, z }, inner)
      if (inOuter && !inInner && !this.inGateOpening(x, z, feetY)) return true
    }

    for (const b of this.boothSpecs.values()) {
      if (b.points.length < 3) continue
      // 只有标准白膜有下部围挡；脚手架与光地可直接穿行
      if (boothKindOf(b) !== 'massing') continue
      if (feetY >= b.height - 0.05) continue
      if (this.boothWallBlocked(b, x, z, feetY)) return true
    }

    for (const it of this.infras) {
      if (it.kind === 'gate') continue
      const baseY = this.infraBaseYMap.get(it.id) ?? 0
      if (feetY >= baseY + it.height - 0.05) continue
      if (it.kind === 'wall' && this.inWallOpening(it, x, z, feetY)) continue
      if (this.inInfraFootprint(it, x, z)) return true
    }
    return false
  }

  /** 内墙上打开的出入口门洞放行 */
  private inWallOpening(wall: Infra, x: number, z: number, feetY: number): boolean {
    for (const gate of this.infras) {
      if (gate.kind !== 'gate' || !gate.open) continue
      if (!this.gateOnWall(gate, wall)) continue
      if (feetY >= gate.height - 0.05) continue

      const ux = Math.cos(wall.rotation)
      const uz = -Math.sin(wall.rotation)
      const gu = (gate.x - wall.x) * ux + (gate.z - wall.z) * uz
      const l = this.toInfraLocal(wall, x, z)
      if (
        Math.abs(l.x - gu) <= gate.width / 2 - 0.1 &&
        Math.abs(l.z) <= wall.depth / 2 + 0.35
      ) {
        return true
      }
    }
    return false
  }

  /** 漫游时检测准星前方的出入口 */
  private updateWalkInteract() {
    if (this.walkState !== 'walk') return
    const cam = this.camera.position
    this.camera.getWorldDirection(this.walkForward)

    let bestId: string | null = null
    let bestName = ''
    let bestOpen = false
    let bestDist = Infinity

    for (const it of this.infras) {
      if (it.kind !== 'gate') continue
      const dx = it.x - cam.x
      const dy = it.height / 2 - cam.y
      const dz = it.z - cam.z
      const dist = Math.hypot(dx, dy, dz)
      if (dist < 0.35 || dist > 4.8) continue
      const dot =
        (dx * this.walkForward.x + dy * this.walkForward.y + dz * this.walkForward.z) / dist
      if (dot < 0.78) continue
      if (dist < bestDist) {
        bestDist = dist
        bestId = it.id
        bestName = it.name
        bestOpen = !!it.open
      }
    }

    const key = bestId ? `${bestId}:${bestOpen ? 1 : 0}` : ''
    this.walkInteractId = bestId
    if (key === this.walkInteractKey) return
    this.walkInteractKey = key
    this.opts.onWalkInteract?.(
      bestId ? { id: bestId, name: bestName, open: bestOpen } : null,
    )
  }

  private clearWalkInteract() {
    this.walkInteractId = null
    if (!this.walkInteractKey) return
    this.walkInteractKey = ''
    this.opts.onWalkInteract?.(null)
  }

  /** 漫游中左键切换最近出入口的开关 */
  private onWalkMouseDown = (e: MouseEvent) => {
    if (this.walkState !== 'walk' || this.walkUiPaused || e.button !== 0) return
    if (e.target !== this.renderer.domElement) return

    // Alt 释放鼠标后，点击画布也可以重新锁定（不依赖 keyup 的指针锁定权限）
    if (
      !this.isTouchDevice &&
      !this.walkAltReleased &&
      document.pointerLockElement !== this.renderer.domElement
    ) {
      this.lockPointer()
    }

    if (!this.walkInteractId) return
    e.preventDefault()
    this.opts.onToggleGate?.(this.walkInteractId)
  }

  private walkCameraObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = []
    if (this.venueGroup) objects.push(this.venueGroup)
    for (const g of this.boothGroups.values()) objects.push(g)
    for (const g of this.infraGroups.values()) objects.push(g)
    return objects
  }

  /** 第三人称摄像机位置：从角色后上方看向前方，并对墙体 / 展台做遮挡收缩 */
  private getThirdPersonPose(): { pos: THREE.Vector3; aim: THREE.Vector3 } {
    const feet = this.walkPos.y - EYE_HEIGHT
    const focus = new THREE.Vector3(this.walkPos.x, feet + 1.5, this.walkPos.z)
    const cosPitch = Math.cos(this.walkPitch)
    const dir = new THREE.Vector3(
      Math.sin(this.walkYaw) * cosPitch,
      -Math.sin(this.walkPitch),
      Math.cos(this.walkYaw) * cosPitch,
    )
    const forward = new THREE.Vector3(
      -Math.sin(this.walkYaw) * cosPitch,
      Math.sin(this.walkPitch),
      -Math.cos(this.walkYaw) * cosPitch,
    )
    const distance = 3.6
    let pos = focus.clone().addScaledVector(dir, distance)
    pos.y = Math.max(pos.y, feet + 0.35)

    const rayDir = pos.clone().sub(focus)
    const rayLen = rayDir.length()
    if (rayLen > 0.01) {
      this.walkCameraRay.set(focus, rayDir.normalize())
      this.walkCameraRay.far = rayLen
      const hit = this.walkCameraRay
        .intersectObjects(this.walkCameraObjects(), true)
        .find((h) => (h.object as THREE.Mesh).isMesh && h.distance > 0.05)
      if (hit) {
        // 不要让镜头缩进角色身体内部
        const d = Math.max(1.2, Math.min(distance, hit.distance - 0.25))
        pos = focus.clone().addScaledVector(dir, d)
        pos.y = Math.max(pos.y, feet + 0.35)
      }
    }

    // 镜头看向角色前方，身体落在画面下方，准星仍指向场景
    const aim = focus.clone().addScaledVector(forward, 12)
    return { pos, aim }
  }

  private walkCameraPose(): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    if (this.walkView === 'first') {
      return {
        pos: this.walkPos.clone(),
        quat: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(this.walkPitch, this.walkYaw, 0, 'YXZ'),
        ),
      }
    }

    const pose = this.getThirdPersonPose()
    const m = new THREE.Matrix4().lookAt(
      pose.pos,
      pose.aim,
      new THREE.Vector3(0, 1, 0),
    )
    return {
      pos: pose.pos,
      quat: new THREE.Quaternion().setFromRotationMatrix(m),
    }
  }

  private applyWalkCamera() {
    const transition = this.walkViewTransition
    if (transition && this.walkState === 'walk') {
      const target = this.walkCameraPose()
      const k = Math.min(1, (performance.now() - transition.start) / transition.duration)
      const ease = 1 - Math.pow(1 - k, 3)
      this.camera.position.lerpVectors(transition.fromPos, target.pos, ease)
      this.camera.quaternion.slerpQuaternions(transition.fromQuat, target.quat, ease)
      if (this.walkHead) {
        this.walkHead.visible = this.walkView === 'third' && k > 0.55
      }
      if (k >= 1) {
        this.walkViewTransition = null
        if (this.walkHead) this.walkHead.visible = this.walkView === 'third'
      }
      return
    }

    const pose = this.walkCameraPose()
    this.camera.position.copy(pose.pos)
    this.camera.quaternion.copy(pose.quat)
  }

  /** 移动端左摇杆：x 右正、z 前正，boost 为超出加速圈后的 0..1 加速量 */
  setWalkMove(x: number, z: number, boost = 0) {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    this.walkMove.x = clamp(x)
    this.walkMove.z = clamp(z)
    this.walkMoveBoost = clamp(boost)
    if (this.walkAuto && Math.hypot(x, z) > 0.12) this.stopWalkAuto()
  }

  /** 移动端右摇杆：传入屏幕像素增量 */
  lookWalk(dx: number, dy: number) {
    if (this.walkState !== 'walk' || this.walkAuto) return
    const sens = 0.0045
    this.walkYaw -= dx * sens
    this.walkPitch -= dy * sens
    const lim = Math.PI / 2 - 0.05
    this.walkPitch = Math.max(-lim, Math.min(lim, this.walkPitch))
  }

  /** 移动端跳跃按钮 */
  jumpWalk() {
    if (this.walkState !== 'walk' || !this.walkOnGround) return
    this.stopWalkAuto()
    this.walkOnGround = false
    this.walkVelY = JUMP_SPEED
  }

  /** 移动端 HUD 调用：平滑返回本次漫游起点 */
  returnToWalkStart() {
    this.returnWalkHome()
  }

  private returnWalkHome() {
    if (this.walkState !== 'walk' || this.walkReturn) return
    this.stopWalkAuto()
    this.walkKeys.clear()
    this.walkMove = { x: 0, z: 0 }
    this.walkMoveBoost = 0
    this.walkVelY = 0
    this.walkOnGround = true
    this.walkReturn = {
      fromPos: this.walkPos.clone(),
      toPos: this.walkHomePos.clone(),
      fromYaw: this.walkYaw,
      toYaw: this.walkHomeYaw,
      fromPitch: this.walkPitch,
      toPitch: this.walkHomePitch,
      start: performance.now(),
      duration: 700,
    }
  }

  private updateWalk(dt: number) {
    if (this.walkUiPaused) {
      this.updateWalkBody(0, false)
      this.applyWalkCamera()
      return
    }

    if (this.walkAuto && this.walkTour) {
      this.updateWalkAuto(dt)
      return
    }

    if (this.walkReturn) {
      const tr = this.walkReturn
      const k = Math.min(1, (performance.now() - tr.start) / tr.duration)
      const ease = 1 - Math.pow(1 - k, 3)
      this.walkPos.lerpVectors(tr.fromPos, tr.toPos, ease)
      let dy = tr.toYaw - tr.fromYaw
      dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
      this.walkYaw = tr.fromYaw + dy * ease
      this.walkPitch = tr.fromPitch + (tr.toPitch - tr.fromPitch) * ease
      this.walkVelY = 0
      this.walkOnGround = true
      if (k >= 1) this.walkReturn = null
      this.updateWalkBody(0, false)
      this.applyWalkCamera()
      return
    }

    let f = this.walkMove.z
    let s = this.walkMove.x
    if (this.walkKeys.has('w') || this.walkKeys.has('arrowup')) f += 1
    if (this.walkKeys.has('s') || this.walkKeys.has('arrowdown')) f -= 1
    if (this.walkKeys.has('d') || this.walkKeys.has('arrowright')) s += 1
    if (this.walkKeys.has('a') || this.walkKeys.has('arrowleft')) s -= 1
    f = Math.max(-1, Math.min(1, f))
    s = Math.max(-1, Math.min(1, s))

    const feet = this.walkPos.y - EYE_HEIGHT
    if (f || s) {
      const speed = this.walkKeys.has('shift')
        ? RUN_SPEED
        : WALK_SPEED + (RUN_SPEED - WALK_SPEED) * this.walkMoveBoost
      const step = (speed * dt) / Math.hypot(f, s)
      const sin = Math.sin(this.walkYaw)
      const cos = Math.cos(this.walkYaw)
      // 相机默认朝 -Z，yaw 为绕 Y 轴逆时针
      const dx = (-sin * f + cos * s) * step
      const dz = (-cos * f - sin * s) * step
      // 分轴推进：贴墙时可沿墙滑动，不会卡死
      if (!this.walkBlocked(this.walkPos.x + dx, this.walkPos.z, feet)) this.walkPos.x += dx
      if (!this.walkBlocked(this.walkPos.x, this.walkPos.z + dz, feet)) this.walkPos.z += dz
    }

    const support = this.walkSupport(this.walkPos.x, this.walkPos.z, feet)
    this.walkVelY -= GRAVITY * dt
    this.walkPos.y += this.walkVelY * dt

    if (this.walkPos.y <= support + EYE_HEIGHT) {
      this.walkPos.y = support + EYE_HEIGHT
      this.walkVelY = 0
      this.walkOnGround = true
    } else {
      this.walkOnGround = false
    }

    // 封顶场馆内不让人眼穿过顶板
    if (
      this.venue?.ceiling &&
      this.walkInnerPts &&
      pointInPolygon({ x: this.walkPos.x, z: this.walkPos.z }, this.walkInnerPts)
    ) {
      const maxY = Math.max(support + EYE_HEIGHT, this.venue.height - 0.12)
      if (this.walkPos.y > maxY) {
        this.walkPos.y = maxY
        this.walkVelY = Math.min(this.walkVelY, 0)
      }
    }

    this.updateWalkBody(dt, !!(f || s))
    this.applyWalkCamera()
  }

  private approach(current: number, target: number, maxStep: number) {
    const d = target - current
    return current + Math.max(-maxStep, Math.min(maxStep, d))
  }

  private approachAngle(current: number, target: number, maxStep: number) {
    let d = target - current
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
    return current + Math.max(-maxStep, Math.min(maxStep, d))
  }

  private updateWalkAuto(dt: number) {
    const tour = this.walkTour
    if (!tour) {
      this.stopWalkAuto()
      return
    }
    const now = performance.now()
    this.emitWalkTourInfo()

    // 单次巡游在最后一个展台停留结束后，或中途关闭循环时，不再走回程
    if (!this.walkAutoLoop && tour.index > tour.lastStopIndex) {
      this.stopWalkAuto()
      this.updateWalkBody(0, false)
      this.applyWalkCamera()
      return
    }

    if (tour.waiting) {
      const stop = tour.points[tour.index]?.stop
      if (stop) {
        const dx = stop.lookAt.x - this.walkPos.x
        const dz = stop.lookAt.z - this.walkPos.z
        const dist = Math.hypot(dx, dz)
        if (dist > 0.2) {
          const targetYaw = Math.atan2(-dx, -dz)
          this.walkYaw = this.approachAngle(this.walkYaw, targetYaw, dt * 3.2)
        }
        const eyeY = this.walkPos.y
        const targetPitch = Math.atan2(1.2 - eyeY, Math.max(0.6, dist))
        this.walkPitch = this.approach(this.walkPitch, targetPitch, dt * 2.4)
      }
      if (now >= tour.waitUntil) {
        tour.waiting = false
        if (!this.walkAutoLoop && tour.index >= tour.lastStopIndex) {
          this.stopWalkAuto()
          this.updateWalkBody(0, false)
          this.applyWalkCamera()
          return
        }
        tour.index++
        if (tour.index >= tour.points.length) {
          this.finishWalkTour()
          this.updateWalkBody(0, false)
          this.applyWalkCamera()
          return
        }
        this.emitWalkTourInfo()
      }
      this.updateWalkBody(0, false)
      this.applyWalkCamera()
      return
    }

    if (tour.index >= tour.points.length) {
      this.finishWalkTour()
      this.updateWalkBody(0, false)
      this.applyWalkCamera()
      return
    }

    const target = tour.points[tour.index]
    const dx = target.x - this.walkPos.x
    const dz = target.z - this.walkPos.z
    const dist = Math.hypot(dx, dz)

    if (dist < 0.12) {
      if (target.stop) {
        tour.waiting = true
        tour.waitUntil = now + WALK_TOUR_DWELL
        this.walkKeys.clear()
        this.emitWalkTourInfo(true)
      } else {
        tour.index++
      }
      this.updateWalkBody(0, false)
      this.applyWalkCamera()
      return
    }

    const speed = WALK_SPEED * 0.72 * this.walkAutoSpeed
    const step = Math.min(dist, speed * dt)
    const nx = this.walkPos.x + (dx / dist) * step
    const nz = this.walkPos.z + (dz / dist) * step
    const feet = this.walkPos.y - EYE_HEIGHT
    if (this.walkBlocked(nx, nz, feet)) {
      this.stopWalkAuto()
      this.updateWalkBody(0, false)
      this.applyWalkCamera()
      return
    }

    this.walkPos.x = nx
    this.walkPos.z = nz
    const support = this.walkSupport(nx, nz, feet)
    this.walkPos.y +=
      (support + EYE_HEIGHT - this.walkPos.y) * Math.min(1, dt * 10)
    this.walkVelY = 0
    this.walkOnGround = true

    const targetYaw = Math.atan2(-dx, -dz)
    this.walkYaw = this.approachAngle(this.walkYaw, targetYaw, dt * 4.2)
    this.walkPitch = this.approach(this.walkPitch, 0, dt * 2)

    this.updateWalkBody(dt, true)
    this.applyWalkCamera()
  }

  private finishWalkTour() {
    const tour = this.walkTour
    if (!tour) return
    if (this.walkAutoLoop && tour.points.length > 2) {
      tour.index = 1
      tour.waiting = false
      return
    }
    this.stopWalkAuto()
  }

  // ---------- 展示模式 ----------

  startPresentation() {
    if (this.presentation) return
    this.presentation = true
    this.labelsBeforePresentation = {
      booth: this.boothLabelsVisible,
      infra: this.infraLabelsVisible,
    }
    // 展示时只保留展台名称，基础设施名称隐藏
    this.setBoothLabelsVisible(true)
    this.setInfraLabelsVisible(false)
    this.setPresentationLabels(true)
    if (this.venue) this.fit(this.venue.points, this.venue.height)
    window.setTimeout(() => {
      if (!this.presentation) return
      this.controls.autoRotateSpeed = 0.32
      this.controls.autoRotate = true
    }, 850)
  }

  stopPresentation() {
    if (!this.presentation) return
    this.presentation = false
    this.controls.autoRotate = false
    this.setPresentationLabels(false)
    this.setBoothLabelsVisible(this.labelsBeforePresentation.booth)
    this.setInfraLabelsVisible(this.labelsBeforePresentation.infra)
  }

  /** 预加载汇报图所需的展台 Logo，避免导出时只画出空白底板 */
  private async loadReportLogos(): Promise<Map<string, HTMLImageElement>> {
    const entries = [...this.boothSpecs.values()].filter(
      (booth) => !!booth.logo && booth.points.length >= 3,
    )
    const images = new Map<string, HTMLImageElement>()
    await Promise.all(
      entries.map(async (booth) => {
        const img = new Image()
        img.decoding = 'async'
        let timer = 0
        await new Promise<void>((resolve) => {
          const done = () => {
            window.clearTimeout(timer)
            resolve()
          }
          img.onload = done
          img.onerror = done
          // 损坏或超大的图片不能阻塞整张汇报图
          timer = window.setTimeout(done, 2000)
          img.src = boothLogoDataUrl(booth.logo!)
        })
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          images.set(booth.id, img)
        }
      }),
    )
    return images
  }

  /** 生成一张高质量俯视汇报图，返回 data URL */
  async captureReportImage(options: ReportImageOptions): Promise<string | null> {
    if (!this.venue) return null
    const reportLogos = await this.loadReportLogos()
    const width = Math.max(1600, Math.min(3200, options.width ?? 2400))
    const height = Math.max(1000, Math.min(2200, options.height ?? 1500))
    const content = this.contentPoints()
    const b = boundsOf(content.points)
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const aspect = width / height
    const worldW = Math.max(2, b.maxX - b.minX) * 1.16 + 14
    const worldD = Math.max(2, b.maxZ - b.minZ) * 1.16 + 14
    let viewW = worldW
    let viewH = worldD
    if (viewW / viewH < aspect) viewW = viewH * aspect
    else viewH = viewW / aspect

    const camera = new THREE.OrthographicCamera(
      -viewW / 2,
      viewW / 2,
      viewH / 2,
      -viewH / 2,
      0.1,
      5000,
    )
    camera.position.set(cx, Math.max(120, this.venue.height * 10 + worldW), cz)
    camera.up.set(0, 0, -1)
    camera.lookAt(cx, 0, cz)
    camera.updateMatrixWorld()

    const gridWas = this.gridGroup.visible
    const dimWas = this.dimensionRoot.visible
    const backgroundWas = this.scene.background
    const fogWas = this.scene.fog
    const keyPosWas = this.keyLight.position.clone()
    const keyTargetWas = this.keyLight.target.position.clone()
    const keyIntensityWas = this.keyLight.intensity
    const fillIntensityWas = this.fillLight.intensity
    const hemiIntensityWas = this.hemiLight.intensity
    const moonIntensityWas = this.moonLight.intensity
    const weatherVisibleWas = this.weatherSystem.group.visible
    const cloudVisibleWas = this.cloudShadow.group.visible
    const skyCloudVisibleWas = this.skyClouds.group.visible
    this.gridGroup.visible = false
    // 刻度线在汇报图中改用更清晰的 2D 描边，避免 WebGL 细线过淡
    this.dimensionRoot.visible = false
    this.scene.background = new THREE.Color(0xf4f3ef)
    this.scene.fog = null
    this.weatherSystem.group.visible = false
    this.cloudShadow.group.visible = false
    this.skyClouds.group.visible = false
    this.keyLight.position.set(cx + 90, 180, cz + 120)
    this.keyLight.target.position.set(cx, 0, cz)
    this.keyLight.target.updateMatrixWorld()
    this.keyLight.intensity = 2.5
    this.fillLight.intensity = 0.65
    this.hemiLight.intensity = 1.05
    this.moonLight.intensity = 0
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    try {
      renderer.setPixelRatio(1)
      renderer.setSize(width, height, false)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.15
      renderer.shadowMap.enabled = this.renderer.shadowMap.enabled
      renderer.shadowMap.type = this.renderer.shadowMap.type
      renderer.shadowMap.autoUpdate = true
      renderer.render(this.scene, camera)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(renderer.domElement, 0, 0, width, height)
      this.drawReportOverlay(ctx, camera, width, height, options, reportLogos)
      return canvas.toDataURL('image/png')
    } catch (err) {
      console.warn('汇报图生成失败', err)
      return null
    } finally {
      this.gridGroup.visible = gridWas
      this.dimensionRoot.visible = dimWas
      this.scene.background = backgroundWas
      this.scene.fog = fogWas
      this.weatherSystem.group.visible = weatherVisibleWas
      this.cloudShadow.group.visible = cloudVisibleWas
      this.skyClouds.group.visible = skyCloudVisibleWas
      this.keyLight.position.copy(keyPosWas)
      this.keyLight.target.position.copy(keyTargetWas)
      this.keyLight.target.updateMatrixWorld()
      this.keyLight.intensity = keyIntensityWas
      this.fillLight.intensity = fillIntensityWas
      this.hemiLight.intensity = hemiIntensityWas
      this.moonLight.intensity = moonIntensityWas
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }

  private drawReportOverlay(
    ctx: CanvasRenderingContext2D,
    camera: THREE.OrthographicCamera,
    width: number,
    height: number,
    options: ReportImageOptions,
    logos: Map<string, HTMLImageElement>,
  ) {
    const v = new THREE.Vector3()
    const scale = width / 2400
    const project = (x: number, z: number) => {
      v.set(x, 0.05, z).project(camera)
      return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height }
    }
    const occupied: { x: number; y: number; w: number; h: number }[] = []
    const isFree = (x: number, y: number, w: number, h: number) => {
      if (x - w / 2 < 8 || x + w / 2 > width - 8 || y - h / 2 < 8 || y + h / 2 > height - 8) {
        return false
      }
      return !occupied.some(
        (box) =>
          x - w / 2 < box.x + box.w / 2 &&
          x + w / 2 > box.x - box.w / 2 &&
          y - h / 2 < box.y + box.h / 2 &&
          y + h / 2 > box.y - box.h / 2,
      )
    }
    const reserve = (x: number, y: number, w: number, h: number) => {
      occupied.push({ x, y, w, h })
    }

    // 2D 图纸描边，保证高分辨率汇报图即使有雾和云影也保持清晰
    if (this.venue) {
      ctx.beginPath()
      this.venue.points.forEach((p, i) => {
        const q = project(p.x, p.z)
        if (i === 0) ctx.moveTo(q.x, q.y)
        else ctx.lineTo(q.x, q.y)
      })
      ctx.closePath()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.24)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(35, 43, 54, 0.62)'
      ctx.lineWidth = Math.max(2, 2.5 * scale)
      ctx.stroke()
    }
    for (const booth of this.boothSpecs.values()) {
      if (booth.points.length < 3) continue
      ctx.beginPath()
      booth.points.forEach((p, i) => {
        const q = project(p.x, p.z)
        if (i === 0) ctx.moveTo(q.x, q.y)
        else ctx.lineTo(q.x, q.y)
      })
      ctx.closePath()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.24)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(48, 58, 70, 0.46)'
      ctx.lineWidth = Math.max(1, 1.3 * scale)
      ctx.stroke()
    }

    // 汇报图用 2D 重绘刻度线，保证比 WebGL 细线更清楚
    if (this.dimensionVisible) {
      this.dimensionRoot.updateMatrixWorld(true)
      ctx.save()
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(32, 39, 48, 0.94)'
      ctx.lineWidth = Math.max(2, 2.5 * scale)
      ctx.lineCap = 'round'
      this.dimensionRoot.traverse((obj) => {
        const line = obj as THREE.LineSegments
        if (!line.isLineSegments) return
        const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
        if (!pos) return
        for (let i = 0; i + 1 < pos.count; i += 2) {
          v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(line.matrixWorld).project(camera)
          const x1 = (v.x * 0.5 + 0.5) * width
          const y1 = (-v.y * 0.5 + 0.5) * height
          v.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1))
            .applyMatrix4(line.matrixWorld)
            .project(camera)
          const x2 = (v.x * 0.5 + 0.5) * width
          const y2 = (-v.y * 0.5 + 0.5) * height
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
        }
      })
      ctx.stroke()
      ctx.restore()
    }

    if (this.boothLabelsVisible) {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = `600 ${Math.round(20 * scale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
      for (const label of this.labels) {
        label.obj.getWorldPosition(v)
        v.project(camera)
        if (v.z < -1 || v.z > 1) continue
        const x = (v.x * 0.5 + 0.5) * width
        const y = (-v.y * 0.5 + 0.5) * height
        const el = label.obj.element
        const name = el.dataset.boothName || el.textContent || ''
        const exhibitor = el.dataset.exhibitor || ''
        if (!name && !exhibitor) continue
        ctx.font = `600 ${Math.round(20 * scale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
        const nameWidth = ctx.measureText(name).width
        ctx.font = `500 ${Math.round(13 * scale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
        const exhibitorWidth = exhibitor ? ctx.measureText(exhibitor).width : 0
        const padX = 8 * scale
        const boxW = Math.max(nameWidth, exhibitorWidth) + padX * 2
        const boxH = (exhibitor ? 46 : 28) * scale
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
        this.roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 5 * scale)
        ctx.fill()
        ctx.strokeStyle = 'rgba(35, 42, 52, 0.22)'
        ctx.lineWidth = Math.max(1, scale)
        this.roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 5 * scale)
        ctx.stroke()
        ctx.fillStyle = '#20252d'
        ctx.font = `600 ${Math.round(20 * scale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
        ctx.fillText(name, x - nameWidth / 2, y - (exhibitor ? 9 * scale : 0))
        if (exhibitor) {
          ctx.fillStyle = '#6e7784'
          ctx.font = `500 ${Math.round(13 * scale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
          ctx.fillText(exhibitor, x - exhibitorWidth / 2, y + 11 * scale)
        }
        reserve(x, y, boxW, boxH)
      }
    }

    // 面积标签：仅在显示菜单中打开时绘制
    if (this.areasVisible) {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = `600 ${Math.round(12 * scale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
      for (const obj of this.areaLabels) {
        if (!obj.visible) continue
        const text = obj.element.textContent || ''
        if (!text) continue
        obj.getWorldPosition(v)
        v.project(camera)
        if (v.z < -1 || v.z > 1) continue
        const x = (v.x * 0.5 + 0.5) * width
        const y = (-v.y * 0.5 + 0.5) * height
        const textWidth = ctx.measureText(text).width
        const boxW = textWidth + 12 * scale
        const boxH = 20 * scale
        ctx.fillStyle = 'rgba(25, 28, 34, 0.82)'
        this.roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 4 * scale)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.fillText(text, x - textWidth / 2, y)
        reserve(x, y, boxW, boxH)
      }
    }

    // 展台 Logo：绘制在俯视包围盒左下角，使用白底卡片保证可读
    for (const booth of this.boothSpecs.values()) {
      const img = logos.get(booth.id)
      if (!img || booth.points.length < 3) continue
      const projected = booth.points.map((p) => project(p.x, p.z))
      const minX = Math.min(...projected.map((p) => p.x))
      const maxX = Math.max(...projected.map((p) => p.x))
      const minY = Math.min(...projected.map((p) => p.y))
      const maxY = Math.max(...projected.map((p) => p.y))
      const bw = maxX - minX
      const bh = maxY - minY
      if (bw < 24 * scale || bh < 18 * scale) continue

      const inset = Math.max(3 * scale, Math.min(bw, bh) * 0.035)
      const pad = Math.max(3 * scale, 2.5 * scale)
      const maxCardW = Math.min(bw - inset * 2, 210 * scale)
      const maxCardH = Math.min(bh - inset * 2, 76 * scale)
      if (maxCardW < 30 * scale || maxCardH < 20 * scale) continue

      const innerMaxW = maxCardW - pad * 2
      const innerMaxH = maxCardH - pad * 2
      const ratio = img.naturalWidth / Math.max(1, img.naturalHeight)
      let logoH = innerMaxH
      let logoW = logoH * ratio
      if (logoW > innerMaxW) {
        logoW = innerMaxW
        logoH = logoW / ratio
      }
      if (logoW < 18 * scale || logoH < 10 * scale) continue

      const cardW = logoW + pad * 2
      const cardH = logoH + pad * 2
      const x = minX + inset
      const y = maxY - inset - cardH

      ctx.save()
      ctx.shadowColor = 'rgba(20, 28, 38, 0.22)'
      ctx.shadowBlur = 6 * scale
      ctx.shadowOffsetY = 2 * scale
      ctx.fillStyle = 'rgba(255, 255, 255, 0.97)'
      this.roundRect(ctx, x, y, cardW, cardH, 4 * scale)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.strokeStyle = 'rgba(35, 42, 52, 0.24)'
      ctx.lineWidth = Math.max(1, scale)
      this.roundRect(ctx, x, y, cardW, cardH, 4 * scale)
      ctx.stroke()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(
        img,
        x + (cardW - logoW) / 2,
        y + (cardH - logoH) / 2,
        logoW,
        logoH,
      )
      ctx.restore()
      reserve(x + cardW / 2, y + cardH / 2, cardW, cardH)
    }

    // 刻度标签：只绘制不重叠的数字，避免汇报图上数字互相遮挡
    if (this.dimensionVisible) {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = `600 ${Math.round(12 * scale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
      for (const obj of this.dimensionLabels) {
        if (!obj.visible) continue
        const text = obj.element.textContent || ''
        if (!text) continue
        obj.getWorldPosition(v)
        v.project(camera)
        if (v.z < -1 || v.z > 1) continue
        const x = (v.x * 0.5 + 0.5) * width
        const y = (-v.y * 0.5 + 0.5) * height
        const textWidth = ctx.measureText(text).width
        const boxW = textWidth + 12 * scale
        const boxH = 20 * scale
        if (!isFree(x, y, boxW, boxH)) continue
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
        this.roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 4 * scale)
        ctx.fill()
        ctx.strokeStyle = 'rgba(35, 42, 52, 0.28)'
        ctx.lineWidth = Math.max(1, scale)
        this.roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 4 * scale)
        ctx.stroke()
        ctx.fillStyle = '#39414c'
        ctx.fillText(text, x - textWidth / 2, y)
        reserve(x, y, boxW, boxH)
      }
    }

    const margin = 34 * scale
    const titleSize = 40 * scale
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `600 ${titleSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    const title = options.title || '场馆白膜'
    const subtitle = options.subtitle || ''
    const titleWidth = Math.max(
      ctx.measureText(title).width,
      subtitle ? ctx.measureText(subtitle).width : 0,
    )
    const cardW = Math.min(width - margin * 2, titleWidth + 52 * scale)
    const cardH = (subtitle ? 104 : 74) * scale
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    this.roundRect(ctx, margin, margin, cardW, cardH, 10 * scale)
    ctx.fill()
    ctx.strokeStyle = 'rgba(35, 42, 52, 0.14)'
    ctx.lineWidth = Math.max(1, scale)
    this.roundRect(ctx, margin, margin, cardW, cardH, 10 * scale)
    ctx.stroke()
    ctx.fillStyle = '#1c222b'
    ctx.fillText(title, margin + 20 * scale, margin + 17 * scale)
    if (subtitle) {
      ctx.font = `400 ${14 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.fillStyle = '#6e7784'
      ctx.fillText(subtitle, margin + 20 * scale, margin + 61 * scale)
    }

    const stats = options.stats ?? []
    if (stats.length) {
      ctx.font = `600 ${13 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`
      const statLine = stats.map((item) => `${item.label} ${item.value}`).join('    ')
      const statWidth = ctx.measureText(statLine).width
      const statX = width - margin - statWidth - 28 * scale
      const statY = height - margin - 22 * scale
      ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
      this.roundRect(ctx, statX - 14 * scale, statY - 10 * scale, statWidth + 28 * scale, 34 * scale, 7 * scale)
      ctx.fill()
      ctx.fillStyle = '#4d5662'
      ctx.textBaseline = 'middle'
      ctx.fillText(statLine, statX, statY + 7 * scale)
    }

    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.font = `500 ${11 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillStyle = 'rgba(32, 37, 45, 0.52)'
    ctx.fillText('Grid Massing Studio', width - margin, height - 18 * scale)
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    const radius = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + w, y, x + w, y + h, radius)
    ctx.arcTo(x + w, y + h, x, y + h, radius)
    ctx.arcTo(x, y + h, x, y, radius)
    ctx.arcTo(x, y, x + w, y, radius)
    ctx.closePath()
  }

  /** 漫游缩略图使用的位置与朝向 */
  getWalkPose(): { x: number; z: number; yaw: number } | null {
    if (this.walkState !== 'walk' && this.walkState !== 'enter') return null
    return { x: this.walkPos.x, z: this.walkPos.z, yaw: this.walkYaw }
  }

  /** 多人联机：从指定位置直接进入漫游 */
  enterWalkAt(p: Pt) {
    if (this.walkState !== 'off') return
    this.enterWalk(p)
  }

  /** 多人联机：在场馆内寻找一个可站立的出生点 */
  findWalkSpawn(seed = 0): Pt {
    const center = this.venue ? centroid(this.venue.points) : { x: 0, z: 0 }
    if (!this.walkBlocked(center.x, center.z, 0)) return center
    const start = ((Math.abs(seed) % 32) / 32) * Math.PI * 2
    for (let radius = 1.5; radius <= 40; radius += 1.5) {
      for (let i = 0; i < 32; i++) {
        const angle = start + (i / 32) * Math.PI * 2
        const p = {
          x: center.x + Math.cos(angle) * radius,
          z: center.z + Math.sin(angle) * radius,
        }
        if (!this.walkBlocked(p.x, p.z, 0)) return p
      }
    }
    return center
  }

  /** 多人联机：当前本地玩家状态 */
  getWalkNetState(): WalkNetState | null {
    if (this.walkState !== 'walk') return null
    return {
      x: this.walkPos.x,
      z: this.walkPos.z,
      y: Math.max(0, this.walkPos.y - EYE_HEIGHT),
      yaw: this.walkYaw,
      pitch: this.walkPitch,
      view: this.walkView,
      auto: this.walkAuto,
    }
  }

  /** 多人联机：同步远端玩家（由网络层按 10Hz 调用） */
  setRemotePlayers(players: RemoteWalkPlayer[]) {
    const seen = new Set<string>()
    for (const player of players) {
      seen.add(player.id)
      let avatar = this.remotePlayers.get(player.id)
      if (!avatar) {
        avatar = this.createRemoteAvatar(player.id, player.nickname)
        this.remotePlayers.set(player.id, avatar)
        avatar.group.position.set(
          player.state.x,
          Math.max(0, player.state.y),
          player.state.z,
        )
        avatar.target.copy(avatar.group.position)
        avatar.yaw = player.state.yaw
        avatar.yawTarget = player.state.yaw
        avatar.group.rotation.y = avatar.yaw
      }
      if (avatar.nickname !== player.nickname) {
        avatar.nickname = player.nickname
        avatar.labelEl.textContent = player.nickname
      }
      avatar.target.set(player.state.x, Math.max(0, player.state.y), player.state.z)
      avatar.yawTarget = player.state.yaw
      avatar.pitchTarget = player.state.pitch
    }
    for (const id of [...this.remotePlayers.keys()]) {
      if (!seen.has(id)) this.removeRemoteAvatar(id)
    }
  }

  clearRemotePlayers() {
    for (const id of [...this.remotePlayers.keys()]) this.removeRemoteAvatar(id)
  }

  private createRemoteAvatar(id: string, nickname: string): RemoteAvatar {
    let hash = 0
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
    const color = new THREE.Color().setHSL((Math.abs(hash) % 360) / 360, 0.55, 0.58)

    const group = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.9, 4, 8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.04 }),
    )
    body.position.y = 0.73
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.035
    group.add(ring)

    // 朝向指示：远端角色的“面罩”始终在本地 -Z 前方
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.1, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    )
    visor.position.set(0, 1.22, -0.27)
    group.add(visor)

    const labelEl = document.createElement('div')
    labelEl.className = 'mp-player-label'
    labelEl.textContent = nickname
    const label = new CSS2DObject(labelEl)
    label.position.set(0, 2.05, 0)
    group.add(label)

    group.userData.remotePlayerId = id
    this.scene.add(group)
    return {
      group,
      body,
      visor,
      labelEl,
      target: new THREE.Vector3(),
      yaw: 0,
      yawTarget: 0,
      pitch: 0,
      pitchTarget: 0,
      nickname,
      color,
    }
  }

  private removeRemoteAvatar(id: string) {
    const avatar = this.remotePlayers.get(id)
    if (!avatar) return
    this.remotePlayers.delete(id)
    this.scene.remove(avatar.group)
    avatar.labelEl.remove()
    avatar.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) material.dispose()
    })
  }

  private updateRemotePlayers(dt: number) {
    if (!this.remotePlayers.size) return
    const alpha = Math.min(1, dt * 12)
    for (const avatar of this.remotePlayers.values()) {
      avatar.group.position.lerp(avatar.target, alpha)
      let delta = avatar.yawTarget - avatar.yaw
      delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
      avatar.yaw += delta * alpha
      avatar.group.rotation.y = avatar.yaw
      avatar.pitch += (avatar.pitchTarget - avatar.pitch) * alpha
      avatar.visor.rotation.x = -avatar.pitch
    }
  }

  // ---------- 手动天气 ----------

  setWeather(kind: WeatherKind) {
    if (!WEATHER_PRESETS[kind]) return
    if (this.weather === kind) return
    this.weatherFrom = this.currentWeatherEnvironment()
    this.weatherTo = weatherEnvironmentOf(kind)
    this.weatherBlend = 0
    this.weatherTransitionStart = performance.now()
    this.weather = kind
    this.weatherSystem.setWeather(kind)
    this.cloudShadow.setWeather(kind)
    this.skyClouds.setWeather(kind)
    this.updateSun()
    this.opts.onWeatherChange?.(kind)
  }

  private currentWeatherEnvironment(): WeatherEnvironment {
    const a = this.weatherFrom
    const b = this.weatherTo
    const t = this.weatherBlend
    return {
      skyDay: a.skyDay + (b.skyDay - a.skyDay) * t,
      skyNight: a.skyNight + (b.skyNight - a.skyNight) * t,
      fogNear: a.fogNear + (b.fogNear - a.fogNear) * t,
      fogFar: a.fogFar + (b.fogFar - a.fogFar) * t,
      sunScale: a.sunScale + (b.sunScale - a.sunScale) * t,
      fillScale: a.fillScale + (b.fillScale - a.fillScale) * t,
      hemiScale: a.hemiScale + (b.hemiScale - a.hemiScale) * t,
    }
  }

  private advanceWeatherTransition(now = performance.now()): boolean {
    if (this.weatherBlend >= 1) return false
    const t = Math.min(1, (now - this.weatherTransitionStart) / 900)
    this.weatherBlend = t * t * (3 - 2 * t)
    return true
  }

  getWeather(): WeatherKind {
    return this.weather
  }

  setParticleDensities(densities: ParticleDensities) {
    this.weatherSystem.setDensities(densities)
  }

  setWeatherVisibility(scale: number) {
    this.weatherVisibility = Math.max(0.05, Math.min(2, scale))
    this.updateSun()
  }

  /** 只有封闭顶棚且人在馆内时，才隐藏室外降水，避免室内下雨 */
  private isUnderClosedVenue(): boolean {
    if (!this.venue?.ceiling) return false
    if (this.walkState !== 'walk' && this.walkState !== 'enter') return false
    return pointInPolygon({ x: this.walkPos.x, z: this.walkPos.z }, this.venue.points)
  }

  // ---------- 动态太阳 ----------

  /** 设置昼夜进度：0 = 午夜，0.25 = 日出，0.5 = 正午，0.75 = 日落 */
  setSunProgress(t: number) {
    if (!Number.isFinite(t)) return
    // 手动拖动时间轴时立即中止正在进行的回当前时间过渡
    this.sunTransition = null
    this.sunProgress = ((t % 1) + 1) % 1
    this.updateSun()
    this.lastSunMinute = Math.floor(this.sunProgress * 1440)
    this.opts.onSunTime?.(this.sunProgress)
  }

  /** 平滑过渡到指定时间；用于「回到当前时间」 */
  transitionSunTo(target: number, duration = 900) {
    if (!Number.isFinite(target)) return
    const to = ((target % 1) + 1) % 1
    let delta = to - this.sunProgress
    // 走 24 小时制中较短的路径
    if (delta > 0.5) delta -= 1
    else if (delta < -0.5) delta += 1

    if (duration <= 0 || Math.abs(delta) < 1e-5) {
      this.setSunProgress(to)
      return
    }

    this.sunTransition = {
      from: this.sunProgress,
      delta,
      start: performance.now(),
      duration,
    }
  }

  /** 暂停或继续太阳时间推进 */
  setSunPaused(on: boolean) {
    this.sunPaused = on
  }

  private advanceSun(dt: number) {
    // 过渡即使处于暂停状态也要完成，结束后保持原暂停 / 播放状态
    if (this.sunTransition) {
      const tr = this.sunTransition
      const t = Math.min(1, (performance.now() - tr.start) / tr.duration)
      const eased = t * t * (3 - 2 * t)
      this.sunProgress = ((tr.from + tr.delta * eased) % 1 + 1) % 1
      this.updateSun()
      this.lastSunMinute = Math.floor(this.sunProgress * 1440)
      this.opts.onSunTime?.(this.sunProgress)
      if (t >= 1) this.sunTransition = null
      return
    }

    if (this.sunPaused) return
    this.sunProgress = (this.sunProgress + dt / DAY_SECONDS) % 1
    this.updateSun()

    const minutes = Math.floor(this.sunProgress * 1440)
    if (minutes !== this.lastSunMinute) {
      this.lastSunMinute = minutes
      this.opts.onSunTime?.(this.sunProgress)
    }
  }

  /** 太阳沿东 → 南 → 西的轨迹运行，并驱动主光、补光、天光与阴影 */
  private updateSun() {
    const theta = (this.sunProgress - 0.25) * Math.PI * 2
    const height = Math.sin(theta)
    const horiz = Math.cos(theta)
    const dayFactor = smoothstep(-0.06, 0.22, height)
    const sunFactor = smoothstep(-0.04, 0.28, height)
    const noonFactor = smoothstep(0.05, 0.9, height)
    const nightFactor = 1 - dayFactor
    const target = this.keyLight.target.position
    const R = this.sunRadius
    const from = this.weatherFrom
    const to = this.weatherTo
    const mix = this.weatherBlend
    const sunScale = from.sunScale + (to.sunScale - from.sunScale) * mix
    const fillScale = from.fillScale + (to.fillScale - from.fillScale) * mix
    const hemiScale = from.hemiScale + (to.hemiScale - from.hemiScale) * mix

    // 太阳位置沿轨迹连续移动，日出/日落时强度与颜色平滑过渡
    const lift = Math.max(0.06, height)
    this.keyLight.position.set(
      target.x + horiz * R,
      target.y + lift * R,
      target.z + Math.sin(theta) * R,
    )
    this.keyLight.color.copy(SUN_WARM).lerp(SUN_NOON, noonFactor)
    this.sunDayFactor = dayFactor
    this.sunBaseIntensity = 2.55 * sunFactor * sunScale
    this.keyLight.intensity = this.sunBaseIntensity * (this.cloudShadow?.lightFactor ?? 1)

    // 夜晚月光从固定方向补光，避免太阳主光位置突跳
    this.moonLight.intensity = 0.65 * nightFactor * hemiScale

    this.fillLight.color.copy(NIGHT_FILL).lerp(DAY_FILL, dayFactor)
    this.fillLight.intensity = (0.18 + 0.18 * dayFactor) * fillScale

    this.hemiLight.color.copy(NIGHT_SKY).lerp(DAY_SKY, dayFactor)
    this.hemiLight.groundColor.copy(NIGHT_GROUND).lerp(DAY_GROUND, dayFactor)
    this.hemiLight.intensity = (0.5 + 0.32 * dayFactor) * hemiScale

    // 天气同时影响天空、雾颜色与能见距离（复用临时颜色，避免每帧分配）
    SKY_DAY_TMP.setHex(from.skyDay)
    SKY_DAY_TO_TMP.setHex(to.skyDay)
    SKY_DAY_TMP.lerp(SKY_DAY_TO_TMP, mix)
    SKY_NIGHT_TMP.setHex(from.skyNight)
    SKY_NIGHT_TO_TMP.setHex(to.skyNight)
    SKY_NIGHT_TMP.lerp(SKY_NIGHT_TO_TMP, mix)
    SKY_MIX_TMP.copy(SKY_DAY_TMP).lerp(SKY_NIGHT_TMP, nightFactor)
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(SKY_MIX_TMP)
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(SKY_MIX_TMP)
      const fogNear = from.fogNear + (to.fogNear - from.fogNear) * mix
      const fogFar = from.fogFar + (to.fogFar - from.fogFar) * mix
      this.scene.fog.near = Math.max(4, fogNear * this.weatherVisibility)
      this.scene.fog.far = Math.max(18, fogFar * this.weatherVisibility)
    }

    // 夜间照明：常规画质为灯泡 + 烘焙光池；极致画质为向下发光的实时聚光灯
    const lightsOn = nightFactor > 0.01
    this.venueBulbMat.opacity = 0.9 * nightFactor
    if (this.venueBulbs) this.venueBulbs.visible = lightsOn
    if (this.venuePool) {
      this.venuePool.visible = lightsOn
      ;(this.venuePool.material as THREE.MeshBasicMaterial).opacity = 0.55 * nightFactor
    }
    for (const light of this.venueSpotLights) {
      light.intensity = 18 * nightFactor
    }
  }

  // ---------- 画质 / 低端 GPU 降级 ----------

  /** 手动切换画质；会关闭自动降级 */
  setQuality(level: QualityLevel, auto = false) {
    if (this.quality === level) return
    this.quality = level
    this.autoQuality = false
    this.applyQuality()
    this.opts.onQualityChange?.(level, auto)
  }

  private applyQuality() {
    const ultra = this.quality === 'ultra'
    const maxRatio = ultra ? 3 : this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.5 : 2
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio))

    const w = this.host.clientWidth || window.innerWidth
    const h = this.host.clientHeight || window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()

    // 低画质关闭实时阴影
    const shadows = this.quality !== 'low'
    this.renderer.shadowMap.enabled = shadows
    this.keyLight.castShadow = shadows

    // 极致画质：更柔和的阴影 + 更高分辨率阴影贴图
    const shadowType = ultra ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
    if (this.renderer.shadowMap.type !== shadowType) {
      this.renderer.shadowMap.type = shadowType
    }
    // 场景存在时由 fitShadow 按场景尺寸设置阴影分辨率
    if (!this.venue) {
      const shadowSize = ultra ? 4096 : 2048
      if (this.keyLight.shadow.mapSize.x !== shadowSize) {
        this.keyLight.shadow.mapSize.set(shadowSize, shadowSize)
        this.keyLight.shadow.map?.dispose()
        this.keyLight.shadow.map = null
      }
    }
    this.renderer.shadowMap.needsUpdate = true

    if (this.venue) {
      this.fitShadow(this.venue.points, this.venue.height)
      this.buildVenueLights()
    }

    // 阴影 / 灯光数量变化后会生成新的 shader，这里统一触发一次重编译
    this.modelRoot.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material
      const list = Array.isArray(mat) ? mat : mat ? [mat] : []
      for (const m of list) m.needsUpdate = true
    })
  }

  /** 运行时帧率采样：低端 GPU 自动降级 */
  private sampleQuality(dt: number) {
    if (!this.autoQuality || document.hidden) return
    if (this.qualitySkip > 0) {
      this.qualitySkip--
      return
    }
    // 忽略切后台、加载等异常长帧
    if (dt <= 0 || dt > 0.2) return

    this.qualityFrames++
    this.qualityTime += dt
    if (this.qualityFrames < 90) return

    const avg = this.qualityTime / this.qualityFrames
    this.qualityFrames = 0
    this.qualityTime = 0

    if (avg > 0.026 && this.quality !== 'low') {
      const next: QualityLevel =
        this.quality === 'ultra' ? 'high' : this.quality === 'high' ? 'medium' : 'low'
      this.quality = next
      this.qualitySkip = 120
      this.applyQuality()
      this.opts.onQualityChange?.(next, true)
    } else {
      this.qualitySkip = 30
    }
  }

  // ---------- 循环 ----------

  private resize() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()

    // 移动端进入全屏 / 横屏后宽高比会变化，重新按新的横向视野取景
    if (this.walkState === 'pick' && this.isTouchDevice) this.viewTop()
  }

  private updateGateAnimations(now: number) {
    if (!this.gateAnims.size) return
    for (const [id, anim] of [...this.gateAnims]) {
      const k = Math.min(1, (now - anim.start) / GATE_ANIM_MS)
      // 平滑起止，接近真实门扇的加减速
      const eased = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      setGateOpenAmount(anim.group, anim.from + (anim.to - anim.from) * eased)
      if (k >= 1) this.gateAnims.delete(id)
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000))
    this.lastFrame = now
    this.updateGateAnimations(now)
    this.updateRemotePlayers(dt)

    if (this.walkState === 'enter') {
      this.updateWalkEnter(now)
    } else if (this.walkState === 'walk') {
      this.updateWalk(dt)
      this.updateWalkInteract()
    } else {
      if (this.tween) {
        const k = Math.min(1, (now - this.tween.start) / this.tween.dur)
        const e = 1 - Math.pow(1 - k, 3)
        this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e)
        this.controls.target.lerpVectors(this.tween.t0, this.tween.t1, e)
        if (k >= 1) this.tween = null
      }
      this.controls.update()
    }

    if (this.advanceWeatherTransition(now)) this.updateSun()
    this.advanceSun(dt)
    const indoor = this.isUnderClosedVenue()
    this.cloudShadow.update(dt, this.sunDayFactor, indoor)
    this.skyClouds.update(dt, this.sunDayFactor, this.camera.position.y)
    // 云层漂移与主光摆动使用同一层相位，避免云影和明暗变化不同步
    this.keyLight.intensity = this.sunBaseIntensity * this.cloudShadow.lightFactor

    const weatherFocus =
      this.walkState === 'walk' || this.walkState === 'enter'
        ? this.walkPos
        : this.controls.target
    this.weatherSystem.update(dt, weatherFocus, indoor)
    this.sampleQuality(dt)

    // 阴影变化很慢，低频刷新即可；避免静态场景每帧重绘整套阴影
    if (now - this.shadowUpdateAt >= 80) {
      this.renderer.shadowMap.needsUpdate = true
      this.shadowUpdateAt = now
    }

    this.camera.updateMatrixWorld()

    // 相机移动时标签跟随渲染，避免名称明显掉帧；静止时回退到 30 fps 省开销
    const cameraChanged =
      !this.labelCameraReady || !this.lastLabelCamera.equals(this.camera.matrixWorld)
    if (cameraChanged) {
      this.lastLabelCamera.copy(this.camera.matrixWorld)
      this.labelCameraReady = true
    }
    if (cameraChanged || now - this.lastLabelAt >= 33) {
      this.lastLabelAt = now
      this.updateAreaLabels()
      this.labelRenderer.render(this.scene, this.camera)
    }

    // 罗盘不需要每帧更新；20 fps 且角度变化足够时才写 Vue 状态
    if (now - this.lastCompassAt >= 50) {
      this.lastCompassAt = now
      const deg = this.northAngleDeg()
      if (!Number.isFinite(this.lastCompassDeg) || Math.abs(deg - this.lastCompassDeg) >= 0.15) {
        this.lastCompassDeg = deg
        this.opts.onNorthAngle?.(deg)
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerleave', this.onPointerLeave)
    el.removeEventListener('dblclick', this.onDblClick)
    el.removeEventListener('contextmenu', this.onContextMenu)
    document.removeEventListener('mousemove', this.onWalkMouseMove)
    document.removeEventListener('mousedown', this.onWalkMouseDown)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    window.removeEventListener('keydown', this.onWalkKeyDown, true)
    window.removeEventListener('keyup', this.onWalkKeyUp, true)
    window.removeEventListener('keydown', this.onNavKeyDown)
    window.removeEventListener('keyup', this.onNavKeyUp)
    window.removeEventListener('blur', this.onWindowBlur)
    window.removeEventListener('wheel', this.onUnderlayWheel, true)
    this.clearUnderlay()
    this.walkState = 'off'
    if (document.pointerLockElement === el) document.exitPointerLock()
    this.controls.dispose()
    this.clearLabels()
    this.clearInfraLabels()
    this.clearBoothLogos()
    this.clearDimensions()
    this.clearRemotePlayers()
    this.labelRenderer.domElement.remove()
    this.weatherSystem.dispose()
    this.cloudShadow.dispose()
    this.skyClouds.dispose()
    disposeDeep(this.scene)
    this.renderer.dispose()
    if (el.parentElement) el.parentElement.removeChild(el)
  }
}
