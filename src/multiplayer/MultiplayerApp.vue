<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppToolbar from '../components/AppToolbar.vue'
import SceneStatus from '../components/SceneStatus.vue'
import WalkMinimap from '../components/WalkMinimap.vue'
import WalkOverlay from '../components/WalkOverlay.vue'
import WeatherPanel from '../components/WeatherPanel.vue'
import type { LiveWeather } from '../core/amapWeather'
import {
  Stage,
  type QualityLevel,
  type WalkState,
  type WalkView,
} from '../core/Stage'
import type { WalkTourInfo } from '../core/walkTour'
import {
  WEATHER_OPTIONS,
  type ParticleDensities,
  type WeatherKind,
} from '../core/weather'
import { useWeather } from '../composables/useWeather'
import {
  createMultiplayerSocket,
  multiplayerWebSocketUrl,
  type RoomPlayer,
  type RoomSnapshot,
  type RoomSummary,
  type ServerMessage,
} from './net'
import {
  loadCurrentMultiplayerScene,
  parseMultiplayerScene,
  type LoadedMultiplayerScene,
} from './scene'

type Phase = 'lobby' | 'room' | 'game'
type ToolMenu = 'view' | 'display' | 'quality' | 'data'

const phase = ref<Phase>('lobby')
const createSize = ref(4)
const joinCode = ref('')
const autoJoining = ref(false)
const busy = ref(false)
const error = ref('')
const status = ref('')

const roomCode = ref('')
const selfId = ref('')
const hostId = ref('')
const maxPlayers = ref(4)
const players = ref<RoomPlayer[]>([])
const roomStarted = ref(false)
const profileName = ref('')
const profileColor = ref('#4f7cff')
const showPlayerList = ref(false)
const roomGates = ref<Record<string, boolean>>({})
const inviteLink = ref('')
const roomList = ref<RoomSummary[]>([])
const roomListLoading = ref(false)
const onlineCount = ref(0)
const showWeatherPanel = ref(false)

const scene = shallowRef<LoadedMultiplayerScene | null>(null)
const stage = shallowRef<Stage | null>(null)
const stageHost = ref<HTMLElement | null>(null)
const walkState = ref<WalkState>('off')
const walkView = ref<WalkView>('first')
const walkAuto = ref(false)
const walkAutoSpeed = ref(0.8)
const walkAutoLoop = ref(true)
const walkTourInfo = ref<WalkTourInfo | null>(null)
const walkUiHidden = ref(false)
const paused = ref(false)
const pointerLocked = ref(false)
const interact = ref<{ id: string; name: string; open: boolean } | null>(null)
const walkPose = ref<{ x: number; z: number; yaw: number } | null>(null)
const minimapExpanded = ref(false)
const northDeg = ref(0)
const sunProgress = ref(0.5)
const sunPlaying = ref(true)
const hostLeft = ref(false)
const closeTitle = ref('房主已退出')
const closeMessage = ref('房间已解散，正在返回默认页面…')
const toastMsg = ref('')
const lastPose = ref({ x: 0, z: 0 })
const messageOpen = ref(false)
const messageDraft = ref('')
const messageInput = ref<HTMLInputElement | null>(null)
const chatMessages = ref<
  { key: string; nickname: string; text: string; serverTime: number }[]
>([])
let chatSeq = 0
const chatTimers = new Map<string, number>()

const quality = ref<QualityLevel>('high')
const toolMenu = ref<ToolMenu | null>(null)
const toolSubMenu = ref<'names' | null>(null)
const toolsCollapsed = ref(false)
const boothLabelsOn = ref(false)
const infraLabelsOn = ref(false)
const dimOn = ref(false)
const areaOn = ref(false)
const gridOn = ref(false)
const underlayVisible = ref(true)

const isMobile = ref(
  new URLSearchParams(window.location.search).get('mobile') === '1' ||
    window.matchMedia('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
)
const isPortrait = ref(window.innerHeight > window.innerWidth)
const fullscreenActive = ref(!!document.fullscreenElement)
const fullscreenIssue = ref<'' | 'unsupported' | 'failed'>('')
const orientationPromptDismissed = ref(false)

const route = useRoute()
const router = useRouter()
const isHost = computed(() => !!selfId.value && selfId.value === hostId.value)
const showOrientationPrompt = computed(
  () =>
    isMobile.value &&
    phase.value === 'game' &&
    !paused.value &&
    !hostLeft.value &&
    !messageOpen.value &&
    !showWeatherPanel.value &&
    !orientationPromptDismissed.value &&
    ((isPortrait.value && walkState.value === 'off') ||
      (!isPortrait.value && !!fullscreenIssue.value && !fullscreenActive.value)),
)
const orientationTitle = computed(() =>
  isPortrait.value ? '请将手机横过来' : '未能自动进入全屏',
)
const orientationText = computed(() => {
  if (fullscreenIssue.value === 'unsupported') {
    return isPortrait.value
      ? '当前浏览器不支持全屏 API，请横屏操作以获得完整视野。'
      : '当前浏览器不支持全屏 API，请保持横屏并继续漫游。'
  }
  if (fullscreenIssue.value === 'failed') {
    return '浏览器未允许自动进入全屏，请横屏操作，或点击下方按钮手动重试。'
  }
  return isPortrait.value
    ? '横屏可获得更完整的漫游视野；也可以点击全屏由浏览器尝试自动横屏。'
    : '点击全屏可隐藏浏览器地址栏，获得更完整的漫游视野。'
})
const minimapPlayers = computed(() =>
  players.value
    .filter((player) => player.id !== selfId.value)
    .map((player) => ({
      id: player.id,
      nickname: player.nickname,
      x: player.state.x,
      z: player.state.z,
      color: playerColorOf(player),
    })),
)
const createSizeOptions = [2, 3, 4, 5, 6, 7, 8]
const serverLabel = (() => {
  try {
    return new URL(multiplayerWebSocketUrl()).host
  } catch {
    return multiplayerWebSocketUrl()
  }
})()

const QUALITY_LABELS: Record<QualityLevel, string> = {
  ultra: '极致',
  high: '高',
  medium: '中',
  low: '低',
}
const qualityLabel = computed(() => QUALITY_LABELS[quality.value])

function currentSunProgress(): number {
  const now = new Date()
  return (now.getHours() * 60 + now.getMinutes()) / 1440
}

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

const hasUnderlay = computed(() => !!scene.value?.underlay)

let socket: WebSocket | null = null
let socketPromise: Promise<WebSocket> | null = null
let stateTimer: number | null = null
let listTimer: number | null = null
let timeSyncTimer: number | null = null
let lastTimeSyncAt = 0
let redirectTimer: number | null = null
let toastTimer: number | null = null
let intentionalClose = false
let leaving = false
let pendingHostScene: LoadedMultiplayerScene | null = null
let redirecting = false
let startAttempted = false
let fullscreenAttempted = false
let portraitExitTimer: number | null = null

function toast(text: string) {
  toastMsg.value = text
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMsg.value = ''
    toastTimer = null
  }, 2200)
}

function clearPortraitExitTimer() {
  if (portraitExitTimer !== null) {
    window.clearTimeout(portraitExitTimer)
    portraitExitTimer = null
  }
}

/** 全屏 / 方向锁定会短暂触发竖屏尺寸，等方向稳定后再决定是否退出 */
function schedulePortraitExitCheck(delay = 320) {
  clearPortraitExitTimer()
  portraitExitTimer = window.setTimeout(() => {
    portraitExitTimer = null
    if (isPortrait.value) exitWalkForPortrait()
  }, delay)
}

function syncViewport() {
  isPortrait.value = window.innerHeight > window.innerWidth
  if (isPortrait.value) schedulePortraitExitCheck()
  else clearPortraitExitTimer()
}

function syncFullscreenState() {
  fullscreenActive.value = !!document.fullscreenElement
}

function notifyFullscreenIssue() {
  if (!isMobile.value) return
  if (fullscreenIssue.value === 'unsupported') {
    toast('浏览器不支持全屏，请横屏操作')
  } else if (fullscreenIssue.value === 'failed') {
    toast('无法自动进入全屏，请横屏操作或手动重试')
  }
}

/**
 * 移动端进入漫游时尝试全屏并锁定横屏。
 * 来自服务器消息的调用没有用户手势，浏览器可能拒绝；失败后由横屏弹窗提供手动重试。
 */
async function enterWalkFullscreen(): Promise<boolean> {
  if (!isMobile.value) return false
  fullscreenIssue.value = ''
  syncFullscreenState()
  const root = document.documentElement as HTMLElement & {
    requestFullscreen?: () => Promise<void>
  }
  const supported =
    !!document.fullscreenElement ||
    (document.fullscreenEnabled !== false &&
      typeof root.requestFullscreen === 'function')
  if (!supported) {
    fullscreenIssue.value = 'unsupported'
    notifyFullscreenIssue()
    return false
  }

  try {
    if (!document.fullscreenElement) {
      await root.requestFullscreen?.()
    }
    syncFullscreenState()
  } catch {
    fullscreenIssue.value = 'failed'
    notifyFullscreenIssue()
    return false
  }

  try {
    const orientation = window.screen.orientation as
      | (ScreenOrientation & {
          lock?: (orientation: string) => Promise<void>
        })
      | undefined
    if (orientation?.lock) await orientation.lock('landscape')
  } catch {
    // 方向锁定失败时仍可进入全屏，随后用横屏提示引导
  }
  window.setTimeout(() => {
    syncViewport()
    syncFullscreenState()
  }, 300)
  return true
}

async function retryWalkFullscreen() {
  const entered = await enterWalkFullscreen()
  if (entered && !isPortrait.value) {
    toast(fullscreenActive.value ? '已进入全屏' : '已尝试进入横屏')
  }
}

async function exitWalkFullscreen() {
  if (!isMobile.value) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
  } catch {
    /* ignore */
  } finally {
    syncFullscreenState()
    syncViewport()
  }
}

function onFullscreenChange() {
  syncFullscreenState()
}

/**
 * 复用主应用的天气设置：天气、粒子密度、能见度都由房主控制。
 * 这里只把状态同步到房间，不启用主应用的“场馆生成后自动查询实时天气”。
 */
const {
  weather: roomWeather,
  weatherOn,
  liveWeatherOn,
  particleDensities,
  weatherVisibility,
  setParticleDensity,
  setWeatherVisibility,
  previewParticleWeather,
  toggleWeatherEnabled,
  chooseWeather,
  toggleLiveWeather,
} = useWeather({
  getStage: () => stage.value,
  isMobile: () => isMobile.value,
  isRestoring: () => true,
  toast,
  onChoose: () => closeWeather(),
})

const weatherLabel = computed(
  () => WEATHER_OPTIONS.find((item) => item.kind === roomWeather.value)?.label ?? '晴',
)
const activeWeather = computed<WeatherKind>(() =>
  weatherOn.value ? roomWeather.value : 'clear',
)
const weatherActive = computed(
  () => showWeatherPanel.value || activeWeather.value !== 'clear',
)

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
    !scene.value?.venue?.ceiling &&
    LENS_WEATHER.has(activeWeather.value),
)

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

function colorFor(id: string): string {
  return `hsl(${hashString(id) % 360} 55% 58%)`
}

function playerColorOf(player: RoomPlayer): string {
  return /^#[0-9a-f]{6}$/i.test(player.color || '')
    ? player.color
    : colorFor(player.id)
}

function buildInviteLink(code: string): string {
  const href = router.resolve({
    name: 'multiplayer',
    query: { room: code },
  }).href
  // 使用当前页面地址解析，子目录部署时保留部署路径
  return new URL(href, window.location.href).toString()
}

function send(payload: Record<string, unknown>) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(payload))
}

function scheduleHome(delay = 2600) {
  if (redirecting) return
  redirecting = true
  if (redirectTimer !== null) window.clearTimeout(redirectTimer)
  redirectTimer = window.setTimeout(() => {
    void router.push({ name: 'editor' })
  }, delay)
}

function stopStateTimer() {
  if (stateTimer !== null) {
    window.clearInterval(stateTimer)
    stateTimer = null
  }
}

function cleanupStage() {
  clearPortraitExitTimer()
  stopStateTimer()
  if (timeSyncTimer !== null) {
    window.clearTimeout(timeSyncTimer)
    timeSyncTimer = null
  }
  if (redirectTimer !== null) {
    window.clearTimeout(redirectTimer)
    redirectTimer = null
  }
  messageOpen.value = false
  messageDraft.value = ''
  showPlayerList.value = false
  for (const timer of chatTimers.values()) window.clearTimeout(timer)
  chatTimers.clear()
  chatMessages.value = []
  void exitWalkFullscreen()
  if (stage.value) {
    stage.value.dispose()
    stage.value = null
  }
  walkState.value = 'off'
  walkAuto.value = false
  walkTourInfo.value = null
  walkPose.value = null
  minimapExpanded.value = false
  interact.value = null
  showWeatherPanel.value = false
}

function ensureSocket(): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  if (socketPromise) return socketPromise
  socketPromise = new Promise<WebSocket>((resolve, reject) => {
    let settled = false
    let ws: WebSocket
    try {
      ws = createMultiplayerSocket()
    } catch (err) {
      socketPromise = null
      reject(err)
      return
    }
    socket = ws
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      socketPromise = null
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      reject(new Error('连接多人服务超时，请检查 .env 中的服务地址'))
    }, 8000)

    const succeed = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      socketPromise = null
      resolve(ws)
    }
    const fail = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      socketPromise = null
      reject(new Error('无法连接多人服务，请确认 Node 服务已启动'))
    }

    ws.addEventListener('open', succeed)
    ws.addEventListener('message', onSocketMessage)
    ws.addEventListener('close', onSocketClose)
    ws.addEventListener('error', () => {
      if (ws.readyState !== WebSocket.OPEN) fail()
    })
  })
  return socketPromise
}

async function createGame() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    const loaded = await loadCurrentMultiplayerScene()
    pendingHostScene = loaded
    roomWeather.value = loaded.weather
    sunProgress.value = loaded.sunProgress
    underlayVisible.value = loaded.underlay?.visible !== false
    const ws = await ensureSocket()
    ws.send(
      JSON.stringify({
        type: 'create',
        maxPlayers: createSize.value,
        scene: loaded.sceneJson,
        weather: loaded.weather,
        weatherOn: weatherOn.value,
        weatherDensities: particleDensities.value,
        weatherVisibility: weatherVisibility.value,
        sunProgress: loaded.sunProgress,
        sunPlaying: sunPlaying.value,
      }),
    )
  } catch (err) {
    busy.value = false
    pendingHostScene = null
    error.value = err instanceof Error ? err.message : '创建房间失败'
  }
}

async function joinGame(codeValue?: string) {
  if (busy.value) return
  const code = String(codeValue ?? joinCode.value).trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    autoJoining.value = false
    error.value = '请输入 6 位房间号'
    return
  }
  joinCode.value = code
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    const ws = await ensureSocket()
    ws.send(JSON.stringify({ type: 'join', code }))
  } catch (err) {
    busy.value = false
    autoJoining.value = false
    error.value = err instanceof Error ? err.message : '加入房间失败'
  }
}

function adoptRoom(room: RoomSnapshot, code: string, self: string) {
  roomCode.value = code
  selfId.value = self
  startAttempted = false
  roomStarted.value = room.started
  hostId.value = room.hostId
  maxPlayers.value = room.maxPlayers
  players.value = room.players
  const me = room.players.find((player) => player.id === self)
  if (me) {
    profileName.value = me.nickname
    profileColor.value = playerColorOf(me)
  }
  applyWeatherSettings(
    room.weather,
    room.weatherOn,
    room.weatherDensities,
    room.weatherVisibility,
  )
  sunProgress.value = room.sunProgress
  sunPlaying.value = room.sunPlaying
  underlayVisible.value = scene.value?.underlay?.visible !== false
  roomGates.value = { ...room.gates }
  inviteLink.value = buildInviteLink(code)
}

function applyWeatherSettings(
  weather: WeatherKind,
  enabled: boolean,
  densities: ParticleDensities,
  visibility: number,
) {
  const nextWeather = enabled ? weather : 'clear'
  roomWeather.value = nextWeather
  weatherOn.value = enabled
  particleDensities.value = { ...densities }
  weatherVisibility.value = visibility
  const currentStage = stage.value
  if (!currentStage) return
  currentStage.setWeather(nextWeather)
  currentStage.setParticleDensities(densities)
  currentStage.setWeatherVisibility(visibility / 100)
}

function syncWeatherSettings() {
  if (!isHost.value) return
  send({
    type: 'weather',
    weather: roomWeather.value,
    weatherOn: weatherOn.value,
    weatherDensities: particleDensities.value,
    weatherVisibility: weatherVisibility.value,
  })
}

function sendTimeNow() {
  if (!isHost.value || phase.value !== 'game') return
  if (timeSyncTimer !== null) {
    window.clearTimeout(timeSyncTimer)
    timeSyncTimer = null
  }
  lastTimeSyncAt = performance.now()
  send({
    type: 'time',
    sunProgress: sunProgress.value,
    sunPlaying: sunPlaying.value,
  })
}

/** 时间自动前进时低频同步；暂停 / 拖动 / 重置时立即或短间隔同步 */
function queueTimeSync(interval = 120, urgent = false) {
  if (!isHost.value || phase.value !== 'game') return
  const wait = interval - (performance.now() - lastTimeSyncAt)
  if (wait <= 0) {
    sendTimeNow()
    return
  }
  if (timeSyncTimer !== null) {
    if (!urgent) return
    window.clearTimeout(timeSyncTimer)
    timeSyncTimer = null
  }
  timeSyncTimer = window.setTimeout(() => {
    timeSyncTimer = null
    sendTimeNow()
  }, wait)
}

function applyTime(progress: number, playing: boolean) {
  const next = Math.max(0, Math.min(1, progress))
  sunProgress.value = next
  sunPlaying.value = playing
  const currentStage = stage.value
  if (!currentStage) return
  currentStage.setSunProgress(next)
  currentStage.setSunPaused(!playing)
}

function applyGates(gates: Record<string, boolean>) {
  roomGates.value = { ...gates }
  const current = scene.value
  if (!current) return
  let changed = false
  const infras = current.infras.map((infra) => {
    if (infra.kind !== 'gate') return infra
    const open = gates[infra.id]
    if (open === undefined || infra.open === open) return infra
    changed = true
    return { ...infra, open }
  })
  if (!changed) return
  scene.value = { ...current, infras }
  stage.value?.setInfras(infras)
}

function syncRemotePlayers() {
  if (!stage.value) return
  stage.value.setRemotePlayers(
    players.value
      .filter((player) => player.id !== selfId.value)
      .map((player) => ({
        id: player.id,
        nickname: player.nickname,
        color: playerColorOf(player),
        state: player.state,
      })),
  )
}

function updatePlayers(incoming: RoomPlayer[]) {
  const before = new Map(players.value.map((player) => [player.id, player]))
  const incomingIds = new Set(incoming.map((player) => player.id))
  if (before.size > 0) {
    for (const player of incoming) {
      if (player.id === selfId.value || before.has(player.id)) continue
      toast(`${player.nickname} 加入了房间`)
    }
    for (const player of before.values()) {
      if (player.id === selfId.value || incomingIds.has(player.id)) continue
      toast(`${player.nickname} 退出了房间`)
    }
  }
  players.value = incoming
}

function applyRoomSnapshot(room: RoomSnapshot) {
  hostId.value = room.hostId
  maxPlayers.value = room.maxPlayers
  roomStarted.value = room.started
  updatePlayers(room.players)
  // 游戏内时间由房主通过 time 消息实时同步，避免 10 Hz 快照反复覆盖
  if (phase.value !== 'game') {
    sunProgress.value = room.sunProgress
    sunPlaying.value = room.sunPlaying
  }
  applyGates(room.gates)
  if (!isHost.value) {
    applyWeatherSettings(
      room.weather,
      room.weatherOn,
      room.weatherDensities,
      room.weatherVisibility,
    )
  }
  if (phase.value === 'game') syncRemotePlayers()
  // 房主由自己的开始操作进入；客人留在房间页等待点击「开始漫游」
  if (
    room.started &&
    phase.value === 'room' &&
    isHost.value &&
    !startAttempted
  ) {
    void startGame()
  }
}

function enterRoomWalk() {
  if (!roomStarted.value || phase.value !== 'room' || busy.value) return
  void startGame()
}

function kickPlayer(player: RoomPlayer) {
  if (!isHost.value || player.id === selfId.value || player.isHost) return
  send({ type: 'kick', id: player.id })
}

function saveProfile() {
  if (!selfId.value) return
  const current = players.value.find((player) => player.id === selfId.value)
  const nickname = profileName.value.trim().slice(0, 20)
  if (!nickname) {
    profileName.value = current?.nickname || ''
    toast('玩家名称不能为空')
    return
  }
  const color = /^#[0-9a-f]{6}$/i.test(profileColor.value)
    ? profileColor.value
    : '#4f7cff'
  profileName.value = nickname
  profileColor.value = color
  send({ type: 'profile', nickname, color })
}

function startRoom() {
  if (!isHost.value || busy.value || roomStarted.value) return
  // 房主点击「开始漫游」仍持有用户手势，优先在这里请求全屏
  fullscreenAttempted = true
  void enterWalkFullscreen()
  busy.value = true
  send({ type: 'start' })
}

async function startGame() {
  if (phase.value === 'game' || startAttempted) return
  if (!scene.value) {
    error.value = '房间场景尚未准备好'
    return
  }
  startAttempted = true
  orientationPromptDismissed.value = false
  if (!fullscreenAttempted) {
    // 客人由服务器 started 消息触发，没有用户手势；失败后显示横屏 / 全屏提示
    fullscreenAttempted = true
    void enterWalkFullscreen()
  }
  const current = scene.value
  const infras = current.infras.map((infra) => {
    if (infra.kind !== 'gate') return infra
    const open = roomGates.value[infra.id]
    return open === undefined ? infra : { ...infra, open }
  })
  const readyScene: LoadedMultiplayerScene = { ...current, infras }
  scene.value = readyScene
  phase.value = 'game'
  paused.value = false
  busy.value = false
  await nextTick()
  if (!stageHost.value) {
    phase.value = 'room'
    error.value = '三维视图初始化失败'
    return
  }

  // Stage 构造时会先按本地当前时间初始化太阳并可能回传 onSunTime；
  // 必须先保存房间时间，构造完成后再用该值覆盖，否则晚到客人会变成本地时间。
  const initialSunProgress = sunProgress.value
  const initialSunPlaying = sunPlaying.value

  try {
    const nextStage = new Stage(stageHost.value, {
      onWalkState: (state) => {
        walkState.value = state
        if (state === 'off') {
          if (isMobile.value) void exitWalkFullscreen()
          if (!leaving && !hostLeft.value) paused.value = true
        }
        if (state === 'walk') paused.value = false
      },
      onWalkView: (view) => {
        walkView.value = view
      },
      onWalkAuto: (on) => {
        walkAuto.value = on
        if (!on) walkTourInfo.value = null
      },
      onWalkAutoSpeed: (value) => {
        walkAutoSpeed.value = Math.round(value * 10) / 10
      },
      onWalkAutoLoop: (value) => {
        walkAutoLoop.value = value
      },
      onWalkTourInfo: (info) => {
        walkTourInfo.value = info
      },
      onMinimapHold: (on) => {
        minimapExpanded.value = on
      },
      onNorthAngle: (deg) => {
        northDeg.value = Math.round(deg * 10) / 10
      },
      onSunTime: (value) => {
        sunProgress.value = value
        queueTimeSync(1000)
      },
      onWeatherShortcut: () => openWeather(),
      onMessageShortcut: () => openMessageInput(),
      allowWalkUiHidden: false,
      onWalkInteract: (target) => {
        interact.value = target
      },
      onToggleGate: (id) => {
        toggleGate(id)
      },
      onRemoteInteract: (event) => {
        if (phase.value !== 'game') return
        send({ type: 'interact', ...event })
      },
    })
    stage.value = nextStage
    nextStage.setMode('idle')
    nextStage.setScene(readyScene.venue, readyScene.booths, infras)
    nextStage.setUnderlay(readyScene.underlay)
    nextStage.setWeather(weatherOn.value ? roomWeather.value : 'clear')
    nextStage.setParticleDensities(particleDensities.value)
    nextStage.setWeatherVisibility(weatherVisibility.value / 100)
    nextStage.setSunPaused(!initialSunPlaying)
    nextStage.setSunProgress(initialSunProgress)
    nextStage.setWalkAutoSpeed(walkAutoSpeed.value)
    nextStage.setWalkAutoLoop(walkAutoLoop.value)
    nextStage.setBoothLabelsVisible(boothLabelsOn.value)
    nextStage.setInfraLabelsVisible(infraLabelsOn.value)
    nextStage.setGridVisible(gridOn.value)
    nextStage.setDimensionsVisible(dimOn.value)
    nextStage.setBoothAreasVisible(areaOn.value)
    nextStage.setReadOnly(true)
    nextStage.setRemotePlayers(
      players.value
        .filter((player) => player.id !== selfId.value)
        .map((player) => ({
          id: player.id,
          nickname: player.nickname,
          state: player.state,
        })),
    )

    const seed = hashString(selfId.value) % 32
    const spawn = nextStage.findWalkSpawn(seed)
    lastPose.value = { x: spawn.x, z: spawn.z }
    nextStage.enterWalkAt(spawn)
    // 等全屏与方向锁定完成后再确认是否真的处于竖屏
    if (isMobile.value) schedulePortraitExitCheck(500)
    startStateTimer()
  } catch (err) {
    console.error(err)
    cleanupStage()
    phase.value = 'room'
    error.value = err instanceof Error ? err.message : '进入漫游失败'
  }
}

function startStateTimer() {
  stopStateTimer()
  stateTimer = window.setInterval(() => {
    const currentStage = stage.value
    if (!currentStage) return
    walkPose.value = currentStage.getWalkPose()
    const state = currentStage.getWalkNetState()
    if (!state) return
    lastPose.value = { x: state.x, z: state.z }
    send({ type: 'state', state })
  }, 100)
}

function toggleGate(id: string) {
  const current = scene.value
  if (!current || phase.value !== 'game') return
  const target = current.infras.find((infra) => infra.id === id)
  if (!target || target.kind !== 'gate') return
  const open = !target.open
  const infras = current.infras.map((infra) =>
    infra.id === id ? { ...infra, open } : infra,
  )
  scene.value = { ...current, infras }
  roomGates.value = { ...roomGates.value, [id]: open }
  stage.value?.setInfras(infras)
  send({ type: 'gate', id, open })
}

function pushChat(nickname: string, text: string, serverTime: number) {
  const key = `${serverTime}-${chatSeq++}`
  chatMessages.value = [
    ...chatMessages.value,
    { key, nickname, text, serverTime },
  ].slice(-5)
  const timer = window.setTimeout(() => {
    chatMessages.value = chatMessages.value.filter((item) => item.key !== key)
    chatTimers.delete(key)
  }, 8000)
  chatTimers.set(key, timer)
}

function openMessageInput() {
  if (messageOpen.value || phase.value !== 'game' || paused.value || hostLeft.value) return
  messageOpen.value = true
  stage.value?.suspendWalkForUi()
  void nextTick(() => messageInput.value?.focus())
}

function closeMessageInput() {
  if (!messageOpen.value) return
  messageOpen.value = false
  messageDraft.value = ''
  // 延后一帧恢复漫游，避免同一次 Esc / Enter 继续触发 Stage 的漫游快捷键
  window.setTimeout(() => {
    if (!messageOpen.value) stage.value?.resumeWalkFromUi()
  }, 0)
}

function sendChatMessage() {
  const text = messageDraft.value.trim().slice(0, 200)
  if (!text) return
  send({ type: 'message', text })
  closeMessageInput()
}

function openWeather() {
  if (!isHost.value) {
    toast('只有房主可以修改天气')
    return
  }
  showWeatherPanel.value = true
  stage.value?.suspendWalkForUi()
}

function closeWeather() {
  showWeatherPanel.value = false
  stage.value?.resumeWalkFromUi()
}

function onWeatherSelect(kind: WeatherKind) {
  chooseWeather(kind)
  syncWeatherSettings()
}

function onWeatherToggle(enabled: boolean) {
  toggleWeatherEnabled(enabled)
  syncWeatherSettings()
}

function onWeatherDensity(kind: keyof ParticleDensities, percent: number) {
  setParticleDensity(kind, percent)
  syncWeatherSettings()
}

function onWeatherVisibility(percent: number) {
  setWeatherVisibility(percent)
  syncWeatherSettings()
}

function onPreviewParticle(kind: keyof ParticleDensities) {
  previewParticleWeather(kind)
  syncWeatherSettings()
}

function onLiveToggle(enabled: boolean, live?: LiveWeather) {
  toggleLiveWeather(enabled, live)
  syncWeatherSettings()
}

function toggleSun() {
  sunPlaying.value = !sunPlaying.value
  stage.value?.setSunPaused(!sunPlaying.value)
  sendTimeNow()
}

function resetSun() {
  const progress = currentSunProgress()
  sunProgress.value = progress
  stage.value?.transitionSunTo(progress, 900)
  sendTimeNow()
}

function onSunScrub(event: Event) {
  const minutes = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(minutes)) return
  sunProgress.value = minutes / 1440
  stage.value?.setSunProgress(sunProgress.value)
  queueTimeSync(80, true)
}

function toggleToolsCollapse() {
  toolsCollapsed.value = !toolsCollapsed.value
}

function toggleToolMenu(menu: ToolMenu) {
  if (menu !== 'display' && menu !== 'quality') return
  toolMenu.value = toolMenu.value === menu ? null : menu
  toolSubMenu.value = null
}

function toggleNameSubmenu() {
  toolSubMenu.value = toolSubMenu.value === 'names' ? null : 'names'
}

function toggleBoothLabels() {
  boothLabelsOn.value = !boothLabelsOn.value
  stage.value?.setBoothLabelsVisible(boothLabelsOn.value)
}

function toggleInfraLabels() {
  infraLabelsOn.value = !infraLabelsOn.value
  stage.value?.setInfraLabelsVisible(infraLabelsOn.value)
}

function toggleDimensions() {
  dimOn.value = !dimOn.value
  stage.value?.setDimensionsVisible(dimOn.value)
}

function toggleAreas() {
  areaOn.value = !areaOn.value
  stage.value?.setBoothAreasVisible(areaOn.value)
}

function toggleGridVisible() {
  gridOn.value = !gridOn.value
  stage.value?.setGridVisible(gridOn.value)
}

function toggleUnderlayVisible() {
  const current = scene.value
  if (!current?.underlay) return
  underlayVisible.value = !underlayVisible.value
  const underlay = { ...current.underlay, visible: underlayVisible.value }
  scene.value = { ...current, underlay }
  stage.value?.setUnderlay(underlay)
}

function chooseQuality(level: QualityLevel) {
  quality.value = level
  stage.value?.setQuality(level)
  toolMenu.value = null
  toast(`画质已切换为${QUALITY_LABELS[level]}`)
}

function toggleWalkAuto() {
  stage.value?.toggleWalkAuto()
}

function updateWalkAutoSpeed(value: number) {
  const next = Math.min(2, Math.max(0.5, Math.round(value * 10) / 10))
  walkAutoSpeed.value = next
  stage.value?.setWalkAutoSpeed(next)
}

function updateWalkAutoLoop(value: boolean) {
  walkAutoLoop.value = value
  stage.value?.setWalkAutoLoop(value)
}

function resumeWalk() {
  if (isMobile.value && isPortrait.value) {
    toast('请先将手机横过来')
    return
  }
  paused.value = false
  // 已从竖屏中断恢复，不再重复弹出全屏失败提示
  orientationPromptDismissed.value = true
  if (isMobile.value) void enterWalkFullscreen()
  const current = stage.value
  if (!current) return
  current.enterWalkAt({ x: lastPose.value.x, z: lastPose.value.z })
}

/** 移动端漫游不支持竖屏：检测到竖屏立即退出漫游 */
function exitWalkForPortrait() {
  if (
    !isMobile.value ||
    !isPortrait.value ||
    phase.value !== 'game' ||
    walkState.value === 'off'
  ) {
    return
  }
  stage.value?.stopWalk()
  paused.value = true
}

/** 退出房间后回到大厅，保留 WebSocket 连接供房间列表与再次创建使用 */
function resetToLobby(notice = '已退出房间，可重新创建或加入房间') {
  if (redirectTimer !== null) {
    window.clearTimeout(redirectTimer)
    redirectTimer = null
  }
  redirecting = false
  leaving = false
  startAttempted = false
  pendingHostScene = null
  scene.value = null
  phase.value = 'lobby'
  roomStarted.value = false
  showPlayerList.value = false
  profileName.value = ''
  profileColor.value = '#4f7cff'
  roomCode.value = ''
  selfId.value = ''
  hostId.value = ''
  maxPlayers.value = 4
  players.value = []
  roomGates.value = {}
  inviteLink.value = ''
  joinCode.value = ''
  autoJoining.value = false
  busy.value = false
  error.value = ''
  status.value = notice
  hostLeft.value = false
  closeTitle.value = '房主已退出'
  closeMessage.value = '房间已解散，正在返回多人大厅…'
  paused.value = false
  walkUiHidden.value = false
  fullscreenAttempted = false
  fullscreenIssue.value = ''
  orientationPromptDismissed.value = false
  clearPortraitExitTimer()
  toolMenu.value = null
  toolsCollapsed.value = false
  underlayVisible.value = true
  lastPose.value = { x: 0, z: 0 }

  // 刷新后不应再自动加入旧房间
  if (route.query.room !== undefined) {
    const query = { ...route.query }
    delete query.room
    void router.replace({ name: 'multiplayer', query })
  }
  void requestRoomList()
}

function leaveGame() {
  if (leaving) return
  leaving = true
  stopStateTimer()
  send({ type: 'leave' })
  cleanupStage()
  resetToLobby()
}

function goHome() {
  if (phase.value !== 'lobby') {
    leaveGame()
  }
  void router.push({ name: 'editor' })
}

function handleRoomClosed(reason: string) {
  if (hostLeft.value) return
  const notice =
    reason === 'host-left'
      ? '房主已退出，已返回多人大厅'
      : '房间已关闭，已返回多人大厅'
  // 保留连接，清理房间状态后直接回到多人大厅
  cleanupStage()
  resetToLobby(notice)
}

function handleKicked(message: string) {
  if (hostLeft.value) return
  cleanupStage()
  resetToLobby(message || '你已被房主移出房间')
}

function onSocketClose() {
  if (intentionalClose || leaving || hostLeft.value) return
  if (phase.value === 'room' || phase.value === 'game') {
    closeTitle.value = '连接已断开'
    closeMessage.value = '与多人服务的连接已断开，正在返回默认页面…'
    hostLeft.value = true
    cleanupStage()
    scheduleHome(2600)
  } else if (busy.value) {
    busy.value = false
    autoJoining.value = false
    error.value = '与多人服务的连接已断开'
  }
  socket = null
  socketPromise = null
}

function handleMessage(message: ServerMessage) {
  switch (message.type) {
    case 'created': {
      scene.value = pendingHostScene
      if (!scene.value) {
        busy.value = false
        error.value = '当前场景无法发送'
        return
      }
      adoptRoom(message.room, message.code, message.selfId)
      pendingHostScene = null
      phase.value = 'room'
      busy.value = false
      autoJoining.value = false
      break
    }
    case 'joined': {
      try {
        scene.value = parseMultiplayerScene(message.scene)
      } catch (err) {
        busy.value = false
        autoJoining.value = false
        error.value = err instanceof Error ? err.message : '房主场景无法加载'
        send({ type: 'leave' })
        return
      }
      adoptRoom(message.room, message.code, message.selfId)
      phase.value = 'room'
      busy.value = false
      autoJoining.value = false
      // 邀请进入后停留在房间页，由客人点击「开始漫游」再创建 Stage
      break
    }
    case 'room':
      if (!roomCode.value) break
      applyRoomSnapshot(message)
      break
    case 'started':
      roomStarted.value = true
      if (isHost.value && phase.value === 'room') void startGame()
      break
    case 'interaction': {
      if (message.targetId !== selfId.value) break
      const current = stage.value
      if (message.action === 'drag-start') {
        current?.setInteractionLocked(true)
        break
      }
      if (message.action === 'drag-end') {
        current?.setInteractionLocked(false)
        break
      }
      if (typeof message.x === 'number' && typeof message.z === 'number') {
        current?.applyExternalWalkPosition(message.x, message.z)
      }
      if (message.action === 'knockback') {
        current?.setInteractionLocked(false)
        current?.shakeWalkCamera(1)
      }
      break
    }
    case 'player-joined':
      if (!players.value.some((player) => player.id === message.player.id)) {
        updatePlayers([...players.value, message.player])
      }
      break
    case 'player-updated': {
      const updated = players.value.map((player) =>
        player.id === message.player.id ? message.player : player,
      )
      updatePlayers(updated)
      if (phase.value === 'game') syncRemotePlayers()
      break
    }
    case 'player-left':
      updatePlayers(players.value.filter((player) => player.id !== message.id))
      break
    case 'gate':
      applyGates({ ...roomGates.value, [message.id]: message.open })
      break
    case 'weather':
      applyWeatherSettings(
        message.weather,
        message.weatherOn ?? weatherOn.value,
        message.weatherDensities ?? particleDensities.value,
        message.weatherVisibility ?? weatherVisibility.value,
      )
      break
    case 'time':
      if (!isHost.value) applyTime(message.sunProgress, message.sunPlaying)
      break
    case 'message':
      pushChat(message.nickname, message.text, message.serverTime)
      break
    case 'room-list':
      roomList.value = message.rooms
      onlineCount.value = Number.isFinite(message.online) ? message.online : 0
      roomListLoading.value = false
      break
    case 'kicked':
      handleKicked(message.message)
      break
    case 'room-closed':
      handleRoomClosed(message.reason)
      break
    case 'join-error':
      busy.value = false
      autoJoining.value = false
      error.value = message.message
      break
    case 'create-error':
      busy.value = false
      pendingHostScene = null
      error.value = message.message
      break
    case 'error':
      busy.value = false
      error.value = message.message
      toast(message.message)
      break
    default:
      break
  }
}

function onSocketMessage(event: MessageEvent) {
  let message: ServerMessage
  try {
    message = JSON.parse(String(event.data)) as ServerMessage
  } catch {
    return
  }
  if (message && typeof message === 'object' && 'type' in message) {
    handleMessage(message)
  }
}

/** 非安全上下文或无剪贴板权限时，用临时文本框直接复制 */
function copyTextFallback(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.left = '-9999px'
  field.style.top = '0'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.focus()
  field.select()
  field.setSelectionRange(0, text.length)
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  field.remove()
  return copied
}

async function copyInvite() {
  const link = inviteLink.value
  if (!link) return

  let copied = false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(link)
      copied = true
    } catch {
      copied = false
    }
  }
  if (!copied) copied = copyTextFallback(link)

  if (copied) {
    status.value = '邀请链接已复制'
    toast('邀请链接已复制')
    return
  }

  // 不弹 alert / prompt，只选中输入框并提示手动复制
  const input = document.querySelector<HTMLInputElement>('.mp-invite input')
  input?.focus()
  input?.select()
  status.value = '复制失败，请长按邀请链接手动复制'
  toast('复制失败，请手动复制链接')
}

async function requestRoomList() {
  if (phase.value !== 'lobby') return
  roomListLoading.value = true
  try {
    const ws = await ensureSocket()
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'list' }))
  } catch {
    roomListLoading.value = false
  }
}

function startRoomListPoll() {
  if (listTimer !== null) window.clearTimeout(listTimer)
  const tick = () => {
    void requestRoomList()
    listTimer = window.setTimeout(tick, 4000)
  }
  tick()
}

function onBeforeUnload() {
  intentionalClose = true
  try {
    socket?.close()
  } catch {
    /* ignore */
  }
}

function onPointerLockChange() {
  pointerLocked.value = !!document.pointerLockElement
}

function openPlayerList() {
  if (
    phase.value !== 'game' ||
    paused.value ||
    hostLeft.value ||
    messageOpen.value ||
    showWeatherPanel.value ||
    showPlayerList.value
  ) {
    return
  }
  showPlayerList.value = true
  // 释放鼠标并暂停漫游输入，方便点击踢出
  stage.value?.suspendWalkForUi()
}

function closePlayerList() {
  if (!showPlayerList.value) return
  showPlayerList.value = false
  stage.value?.resumeWalkFromUi()
}

function onPlayerListKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && showPlayerList.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closePlayerList()
    return
  }
  if (event.key !== 'Tab') return
  if (
    phase.value !== 'game' ||
    paused.value ||
    hostLeft.value ||
    messageOpen.value ||
    showWeatherPanel.value
  ) {
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
  if (showPlayerList.value) closePlayerList()
  else openPlayerList()
}

function onWindowBlur() {
  if (showPlayerList.value) {
    showPlayerList.value = false
    stage.value?.resumeWalkFromUi()
  }
}

/** 消息输入框打开时优先消费 Esc，避免继续触发漫游退出 / 暂停 */
function onMessageKeyDown(event: KeyboardEvent) {
  if (!messageOpen.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  closeMessageInput()
}

onMounted(() => {
  const rawCode = route.query.room
  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode
  if (code) {
    joinCode.value = code.trim().toUpperCase()
    autoJoining.value = true
    void joinGame(joinCode.value)
  }
  startRoomListPoll()
  syncViewport()
  syncFullscreenState()
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('resize', syncViewport)
  window.addEventListener('orientationchange', syncViewport)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('pointerlockchange', onPointerLockChange)
  window.addEventListener('keydown', onMessageKeyDown, true)
  window.addEventListener('keydown', onPlayerListKeyDown, true)
  window.addEventListener('blur', onWindowBlur)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('resize', syncViewport)
  window.removeEventListener('orientationchange', syncViewport)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('pointerlockchange', onPointerLockChange)
  window.removeEventListener('keydown', onMessageKeyDown, true)
  window.removeEventListener('keydown', onPlayerListKeyDown, true)
  window.removeEventListener('blur', onWindowBlur)
  stopStateTimer()
  if (listTimer !== null) window.clearTimeout(listTimer)
  if (redirectTimer !== null) window.clearTimeout(redirectTimer)
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  clearPortraitExitTimer()
  intentionalClose = true
  cleanupStage()
  try {
    socket?.close()
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <div
    class="mp-page"
    :class="{
      'mp-playing': phase === 'game',
      'is-mobile': isMobile,
      'is-walking': phase === 'game' && walkState !== 'off',
      'mp-host': isHost,
      'mp-guest': !isHost,
    }"
  >
    <template v-if="phase !== 'game'">
      <header class="mp-topbar">
        <button type="button" class="mp-back" @click="goHome">← 返回</button>
        <div class="mp-brand">
          <span>Grid Massing Studio</span>
          <b>多人漫游</b>
        </div>
        <span class="mp-server">{{ serverLabel }}</span>
      </header>

      <main v-if="phase === 'lobby'" class="mp-lobby">
        <section class="mp-hero">
          <div class="mp-hero-top">
            <p class="mp-eyebrow">MULTIPLAYER WALKTHROUGH</p>
            <span class="mp-online-badge" aria-live="polite">
              <i aria-hidden="true" />
              {{ onlineCount }} 人在线
            </span>
          </div>
          <h1>一起在场馆里走一圈</h1>
          <p>
            房主使用当前浏览器 IndexedDB 中的场景创建房间，邀请朋友进入。
            只有漫游模式，不进入编辑；昵称和模型颜色可在房间内修改。
          </p>
        </section>

        <div
          v-if="error || status"
          class="mp-alert-stack"
          role="status"
          aria-live="polite"
        >
          <p v-if="error" class="mp-message mp-error">{{ error }}</p>
          <p v-if="status" class="mp-message mp-status">{{ status }}</p>
        </div>

        <section v-if="autoJoining" class="mp-card mp-connecting">
          <span class="mp-spinner" />
          <h2>正在加入房间 {{ joinCode }}</h2>
          <p>正在验证房间人数与房主场景…</p>
        </section>

        <div v-else class="mp-grid">
          <section class="mp-card">
            <div class="mp-card-kicker">HOST</div>
            <h2>创建房间</h2>
            <p>使用你当前浏览器中的场馆场景，生成邀请链接。</p>
            <label class="mp-field">
              <span>房间人数</span>
              <select v-model.number="createSize">
                <option v-for="size in createSizeOptions" :key="size" :value="size">
                  {{ size }} 人
                </option>
              </select>
            </label>
            <button
              type="button"
              class="mp-primary"
              :disabled="busy"
              @click="createGame"
            >
              {{ busy ? '正在创建…' : '创建并获取邀请链接' }}
            </button>
            <p class="mp-note">创建后先进入等待房间，复制链接给朋友，再由你开始漫游。</p>
          </section>

          <section class="mp-card">
            <div class="mp-card-kicker">GUEST</div>
            <h2>加入房间</h2>
            <p>输入房主分享的 6 位房间号，或直接打开邀请链接。</p>
            <label class="mp-field">
              <span>房间号</span>
              <input
                v-model="joinCode"
                maxlength="6"
                autocomplete="off"
                placeholder="例如 A7K2Q9"
                @keyup.enter="joinGame()"
              />
            </label>
            <button
              type="button"
              class="mp-primary"
              :disabled="busy || !joinCode.trim()"
              @click="joinGame()"
            >
              {{ busy ? '正在加入…' : '加入房间' }}
            </button>
            <p class="mp-note">满员房间会被拒绝加入；房主退出后房间自动解散。</p>
          </section>
        </div>

        <section v-if="!autoJoining" class="mp-card mp-room-list-card">
          <div class="mp-room-list-head">
            <div>
              <div class="mp-card-kicker">ONLINE ROOMS</div>
              <h2>在线房间</h2>
            </div>
            <button
              type="button"
              class="mp-room-refresh"
              :disabled="roomListLoading"
              @click="requestRoomList"
            >
              {{ roomListLoading ? '刷新中…' : '刷新' }}
            </button>
          </div>
          <p v-if="!roomList.length" class="mp-room-list-empty">
            暂无在线房间，创建一个房间邀请朋友吧。
          </p>
          <ul v-else class="mp-room-list">
            <li v-for="room in roomList" :key="room.code">
              <b>{{ room.code }}</b>
              <span>{{ room.players }} / {{ room.maxPlayers }} 人在线</span>
              <em>{{ room.started ? '漫游中' : '等待中' }}</em>
              <button
                type="button"
                class="mp-room-join"
                :disabled="busy || room.players >= room.maxPlayers"
                @click="joinGame(room.code)"
              >
                {{ room.players >= room.maxPlayers ? '已满' : '加入' }}
              </button>
            </li>
          </ul>
        </section>

      </main>

      <main v-else class="mp-room">
        <section class="mp-card mp-room-head">
          <div class="mp-card-kicker">ROOM CODE</div>
          <h1>{{ roomCode }}</h1>
          <p>把下面的链接发给朋友，打开后会自动加入。</p>
          <div class="mp-invite">
            <input :value="inviteLink" readonly @focus="($event.target as HTMLInputElement).select()" />
            <button type="button" class="mp-primary" @click="copyInvite">复制邀请链接</button>
          </div>
          <p v-if="error" class="mp-message mp-error">{{ error }}</p>
          <p v-if="status" class="mp-message mp-status">{{ status }}</p>
        </section>

        <section class="mp-card">
          <div class="mp-room-title">
            <h2>玩家</h2>
            <span>已加入 {{ players.length }} / {{ maxPlayers }} 人</span>
          </div>
          <ul class="mp-player-list">
            <li v-for="player in players" :key="player.id">
              <i :style="{ background: playerColorOf(player) }" />
              <span class="mp-player-name">{{ player.nickname }}</span>
              <em v-if="player.isHost">房主</em>
              <em v-if="player.id === selfId" class="me">你</em>
              <button
                v-if="isHost && player.id !== selfId"
                type="button"
                class="mp-kick"
                @click="kickPlayer(player)"
              >
                踢出
              </button>
            </li>
          </ul>

          <div class="mp-profile-editor">
            <div class="mp-profile-head">
              <b>我的资料</b>
              <span>只能修改自己的名称和颜色</span>
            </div>
            <label class="mp-profile-field">
              <span>名称</span>
              <input
                v-model="profileName"
                maxlength="20"
                autocomplete="off"
                @change="saveProfile"
                @keydown.enter.prevent="saveProfile"
              />
            </label>
            <label class="mp-profile-field">
              <span>颜色</span>
              <span class="mp-color-field">
                <i :style="{ background: profileColor }" />
                <input
                  v-model="profileColor"
                  type="color"
                  @change="saveProfile"
                />
              </span>
            </label>
          </div>

          <template v-if="!isHost">
            <p v-if="!roomStarted" class="mp-waiting">
              <span class="mp-spinner" />
              等待房主开始漫游…
            </p>
            <p v-else class="mp-ready">房主已开始漫游，可以进入</p>
            <div class="mp-room-weather">
              <div>
                <span>房间天气</span>
                <b>{{ weatherLabel }}</b>
              </div>
              <em>由房主设置</em>
            </div>
            <button
              type="button"
              class="mp-primary"
              :disabled="!roomStarted || busy"
              @click="enterRoomWalk"
            >
              {{ roomStarted ? '开始漫游' : '准备中' }}
            </button>
            <p v-if="!roomStarted" class="mp-note">
              房主开始漫游后，这里会解锁「开始漫游」。
            </p>
          </template>

          <template v-else>
            <div class="mp-room-weather">
              <div>
                <span>房间天气</span>
                <b>{{ weatherLabel }}</b>
              </div>
              <button type="button" class="mp-secondary" @click="openWeather">
                天气设置
              </button>
            </div>
            <button
              type="button"
              class="mp-primary"
              :disabled="busy || roomStarted"
              @click="startRoom"
            >
              {{ roomStarted ? '漫游已开始' : busy ? '正在准备…' : '开始漫游' }}
            </button>
            <p class="mp-note">开始后客人会在房间页点击「开始漫游」进入。</p>
          </template>

          <button type="button" class="mp-secondary mp-leave" @click="leaveGame">
            退出房间
          </button>
        </section>
      </main>
    </template>

    <template v-else>
      <div ref="stageHost" class="mp-stage" />

      <Transition name="weather-fx">
        <div
          v-if="walkState === 'walk' && activeWeather !== 'clear'"
          class="weather-fx"
          :class="[activeWeather, walkView]"
          aria-hidden="true"
        >
          <div class="weather-atmos" />
          <div v-if="weatherLensOn" class="weather-lens" />
          <div v-if="activeWeather === 'thunder'" class="weather-flash" />
        </div>
      </Transition>

      <div
        v-if="showOrientationPrompt"
        class="mp-modal-backdrop mp-orientation-backdrop"
      >
        <div class="mp-modal mp-orientation-card">
          <div class="mp-orientation-icon" aria-hidden="true">
            <svg
              width="54"
              height="54"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
              <path d="M10.5 5h3" />
              <path d="M3.5 8.5a9 9 0 0 1 2.2-3.2" />
              <path d="M3.5 8.5V5.7M3.5 8.5h2.8" />
            </svg>
          </div>
          <p class="mp-eyebrow">MOBILE VIEW</p>
          <h2>{{ orientationTitle }}</h2>
          <p>{{ orientationText }}</p>
          <div class="mp-modal-actions">
            <button
              v-if="fullscreenIssue !== 'unsupported'"
              type="button"
              class="mp-primary"
              @click="retryWalkFullscreen"
            >
              {{ fullscreenIssue ? '重试全屏' : '全屏并横屏' }}
            </button>
            <button
              type="button"
              class="mp-secondary"
              @click="orientationPromptDismissed = true"
            >
              继续漫游
            </button>
          </div>
        </div>
      </div>

      <SceneStatus
        v-if="scene"
        :venue-name="scene.venueName"
        :editing-venue-name="false"
        :sim-time="simTime"
        :sun-is-day="sunIsDay"
        :sun-playing="sunPlaying"
        :sun-minutes="sunMinutes"
        :sun-percent="sunPercent"
        :live-weather="null"
        :weather-on="false"
        :is-mobile="isMobile"
        :walk-state="walkState"
        :render-only="true"
        :can-undo="false"
        :can-redo="false"
        :north-deg="northDeg"
        multiplayer
        :show-clock="isHost"
        @toggle-sun="toggleSun"
        @reset-sun="resetSun"
        @sun-scrub="onSunScrub"
        @set-render="() => {}"
        @undo="() => {}"
        @redo="() => {}"
      />

      <WalkMinimap
        v-if="scene"
        :venue="scene.venue"
        :booths="scene.booths"
        :infras="scene.infras"
        :pose="walkPose"
        :mobile="isMobile"
        :expanded="minimapExpanded"
        :players="minimapPlayers"
        @collapse="minimapExpanded = false"
      />

      <AppToolbar
        :is-mobile="isMobile"
        :tools-collapsed="toolsCollapsed"
        :tool-menu="toolMenu"
        :tool-sub-menu="toolSubMenu"
        :has-venue="true"
        :render-only="false"
        :quality="quality"
        :quality-label="qualityLabel"
        :booth-labels-on="boothLabelsOn"
        :infra-labels-on="infraLabelsOn"
        :dim-on="dimOn"
        :area-on="areaOn"
        :grid-on="gridOn"
        :has-underlay="hasUnderlay"
        :underlay-visible="underlayVisible"
        :weather-active="weatherActive"
        :walk-active="true"
        :weather-disabled="!isHost"
        multiplayer
        @toggle-collapse="toggleToolsCollapse"
        @toggle-menu="toggleToolMenu"
        @toggle-name-submenu="toggleNameSubmenu"
        @toggle-booth-labels="toggleBoothLabels"
        @toggle-infra-labels="toggleInfraLabels"
        @toggle-dimensions="toggleDimensions"
        @toggle-areas="toggleAreas"
        @toggle-grid="toggleGridVisible"
        @toggle-underlay="toggleUnderlayVisible"
        @view-top="() => {}"
        @view-iso="() => {}"
        @fit-view="() => {}"
        @presentation="() => {}"
        @choose-quality="chooseQuality"
        @report="() => {}"
        @export="() => {}"
        @import="() => {}"
        @open-weather="openWeather"
        @open-help="() => {}"
        @open-multiplayer="() => {}"
        @toggle-walk="() => {}"
      />

      <WalkOverlay
        :walk-state="walkState"
        :walk-view="walkView"
        :walk-interact="interact"
        :is-mobile="isMobile"
        :space-nav-active="false"
        :show-rotate-hint="false"
        :walk-auto="walkAuto"
        :walk-auto-speed="walkAutoSpeed"
        :walk-auto-loop="walkAutoLoop"
        :walk-tour-info="walkTourInfo"
        :walk-ui-hidden="walkUiHidden"
        :show-clean-shortcut="false"
        :hide-weather-shortcut="!isHost"
        :message-enabled="true"
        :get-stage="() => stage"
        @cancel-rotate="() => {}"
        @toggle-auto="toggleWalkAuto"
        @update:speed="updateWalkAutoSpeed"
        @update:loop="updateWalkAutoLoop"
        @open-message="openMessageInput"
      />

      <div class="mp-game-top">
        <div
          class="mp-room-chip"
          role="button"
          tabindex="0"
          title="查看房间玩家"
          @click.stop="openPlayerList"
          @keydown.enter.prevent.stop="openPlayerList"
        >
          <span>房间</span>
          <b>{{ roomCode }}</b>
          <i>{{ players.length }}/{{ maxPlayers }} 人</i>
        </div>
        <button type="button" class="mp-exit" @click="leaveGame">退出房间</button>
      </div>

      <div
        v-if="showPlayerList && !paused && !hostLeft"
        class="mp-tab-overlay"
        role="dialog"
        aria-label="房间玩家列表"
        @pointerdown.self="closePlayerList"
      >
        <div class="mp-tab-card">
          <button
            type="button"
            class="mp-tab-close"
            aria-label="关闭玩家列表"
            @click="closePlayerList"
          >
            ×
          </button>
          <p class="mp-eyebrow">PLAYERS</p>
          <h2>房间玩家</h2>
          <ul class="mp-tab-player-list">
            <li v-for="player in players" :key="player.id">
              <i :style="{ background: playerColorOf(player) }" />
              <span>{{ player.nickname }}</span>
              <em v-if="player.isHost">房主</em>
              <em v-if="player.id === selfId" class="me">你</em>
              <button
                v-if="isHost && player.id !== selfId"
                type="button"
                class="mp-kick"
                @click="kickPlayer(player)"
              >
                踢出
              </button>
            </li>
          </ul>
          <p class="mp-tab-hint">
            {{ isMobile ? '点击右上角或背景关闭' : '按 Tab / Esc 或点击右上角关闭' }}
          </p>
        </div>
      </div>

      <div v-if="chatMessages.length && !messageOpen" class="mp-chat-feed">
        <div v-for="item in chatMessages" :key="item.key" class="mp-chat-item">
          <b>{{ item.nickname }}</b>
          <span>{{ item.text }}</span>
        </div>
      </div>

      <div
        v-if="!isMobile && !pointerLocked && !paused && !hostLeft && !messageOpen"
        class="mp-lock-hint"
      >
        点击画面锁定鼠标视角 · 左键击退 / 右键按住拖动 1m 内玩家
      </div>

      <div v-if="paused && !hostLeft" class="mp-modal-backdrop">
        <div class="mp-modal">
          <p class="mp-eyebrow">PAUSED</p>
          <h2>{{ isMobile && isPortrait ? '请将手机横过来' : '已退出漫游' }}</h2>
          <p v-if="isMobile && isPortrait">
            移动端漫游不支持竖屏，已退出漫游状态。请横屏后点击「继续漫游」。
          </p>
          <p v-else>可以回到当前房间继续，或退出房间返回房间创建界面。</p>
          <div class="mp-modal-actions">
            <button type="button" class="mp-primary" @click="resumeWalk">继续漫游</button>
            <button type="button" class="mp-secondary" @click="leaveGame">退出房间</button>
          </div>
        </div>
      </div>

      <div v-if="hostLeft" class="mp-modal-backdrop">
        <div class="mp-modal">
          <p class="mp-eyebrow">ROOM CLOSED</p>
          <h2>{{ closeTitle }}</h2>
          <p>{{ closeMessage }}</p>
          <div class="mp-modal-progress"><span /></div>
        </div>
      </div>
    </template>

    <div
      v-if="messageOpen"
      class="mp-message-layer"
      @pointerdown.self="closeMessageInput"
    >
      <form class="mp-message-box" @submit.prevent="sendChatMessage">
        <div class="mp-message-head">
          <b>房间消息</b>
          <span>Enter 发送 · Esc 关闭</span>
        </div>
        <div class="mp-message-input-row">
          <input
            ref="messageInput"
            v-model="messageDraft"
            type="text"
            maxlength="200"
            autocomplete="off"
            placeholder="输入消息，最多 200 字"
            @keydown.esc.stop.prevent="closeMessageInput"
          />
          <em>{{ messageDraft.length }}/200</em>
        </div>
        <div class="mp-message-actions">
          <button type="button" class="mp-secondary" @click="closeMessageInput">
            取消
          </button>
          <button type="submit" class="mp-primary" :disabled="!messageDraft.trim()">
            发送
          </button>
        </div>
      </form>
    </div>

    <WeatherPanel
      v-if="showWeatherPanel && isHost && roomWeather"
      :current="roomWeather"
      :enabled="weatherOn"
      :live-enabled="liveWeatherOn"
      :densities="particleDensities"
      :visibility="weatherVisibility"
      @select="onWeatherSelect"
      @live-toggle="onLiveToggle"
      @density="onWeatherDensity"
      @visibility="onWeatherVisibility"
      @preview-particle="onPreviewParticle"
      @toggle="onWeatherToggle"
      @close="closeWeather"
    />

    <div v-if="toastMsg" class="mp-toast">{{ toastMsg }}</div>
  </div>
</template>

<style src="./multiplayer.css"></style>
