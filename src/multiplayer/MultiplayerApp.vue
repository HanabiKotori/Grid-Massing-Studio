<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
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
const roomGates = ref<Record<string, boolean>>({})
const inviteLink = ref('')
const roomList = ref<RoomSummary[]>([])
const roomListLoading = ref(false)
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

const isHost = computed(() => !!selfId.value && selfId.value === hostId.value)
const minimapPlayers = computed(() =>
  players.value
    .filter((player) => player.id !== selfId.value)
    .map((player) => ({
      id: player.id,
      nickname: player.nickname,
      x: player.state.x,
      z: player.state.z,
      color: colorFor(player.id),
    })),
)
const createSizeOptions = [2, 3, 4, 5, 6, 7, 8]
const homeUrl = new URL('./', window.location.href).href
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

function toast(text: string) {
  toastMsg.value = text
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMsg.value = ''
    toastTimer = null
  }, 2200)
}

/** 移动端进入漫游时与单人漫游一致：全屏并尝试锁定横屏 */
async function enterWalkFullscreen() {
  if (!isMobile.value) return
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    }
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
const weatherActive = computed(
  () => showWeatherPanel.value || roomWeather.value !== 'clear' || !weatherOn.value,
)

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

function colorFor(id: string): string {
  return `hsl(${hashString(id) % 360} 55% 58%)`
}

function buildInviteLink(code: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', code)
  return url.toString()
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
    window.location.assign(homeUrl)
  }, delay)
}

function stopStateTimer() {
  if (stateTimer !== null) {
    window.clearInterval(stateTimer)
    stateTimer = null
  }
}

function cleanupStage() {
  stopStateTimer()
  if (timeSyncTimer !== null) {
    window.clearTimeout(timeSyncTimer)
    timeSyncTimer = null
  }
  messageOpen.value = false
  messageDraft.value = ''
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
  hostId.value = room.hostId
  maxPlayers.value = room.maxPlayers
  players.value = room.players
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
  if (room.started && phase.value === 'room') void startGame()
}

function startRoom() {
  if (!isHost.value || busy.value) return
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
  void enterWalkFullscreen()
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
    })
    stage.value = nextStage
    nextStage.setMode('idle')
    nextStage.setScene(readyScene.venue, readyScene.booths, infras)
    nextStage.setUnderlay(readyScene.underlay)
    nextStage.setWeather(weatherOn.value ? roomWeather.value : 'clear')
    nextStage.setParticleDensities(particleDensities.value)
    nextStage.setWeatherVisibility(weatherVisibility.value / 100)
    nextStage.setSunProgress(sunProgress.value)
    nextStage.setSunPaused(!sunPlaying.value)
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
  paused.value = false
  if (isMobile.value) void enterWalkFullscreen()
  const current = stage.value
  if (!current) return
  current.enterWalkAt({ x: lastPose.value.x, z: lastPose.value.z })
}

function leaveGame() {
  if (leaving) return
  leaving = true
  stopStateTimer()
  send({ type: 'leave' })
  intentionalClose = true
  cleanupStage()
  window.setTimeout(() => {
    socket?.close()
    window.location.assign(homeUrl)
  }, 160)
}

function goHome() {
  if (phase.value !== 'lobby') {
    leaveGame()
    return
  }
  window.location.assign(homeUrl)
}

function handleRoomClosed(reason: string) {
  if (hostLeft.value) return
  hostLeft.value = true
  closeTitle.value = reason === 'host-left' ? '房主已退出' : '房间已关闭'
  closeMessage.value =
    reason === 'host-left'
      ? '房主已退出，房间自动解散。正在返回默认页面…'
      : '多人服务已关闭，正在返回默认页面…'
  intentionalClose = true
  cleanupStage()
  socket?.close()
  scheduleHome(2600)
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
      if (message.room.started) void startGame()
      break
    }
    case 'room':
      if (!roomCode.value) break
      applyRoomSnapshot(message)
      break
    case 'started':
      if (phase.value === 'room') void startGame()
      break
    case 'player-joined':
      if (!players.value.some((player) => player.id === message.player.id)) {
        updatePlayers([...players.value, message.player])
      }
      break
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
      roomListLoading.value = false
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

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteLink.value)
    status.value = '邀请链接已复制'
    toast('邀请链接已复制')
  } catch {
    const input = document.querySelector<HTMLInputElement>('.mp-invite input')
    input?.select()
    window.prompt('复制邀请链接', inviteLink.value)
  }
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

/** 消息输入框打开时优先消费 Esc，避免继续触发漫游退出 / 暂停 */
function onMessageKeyDown(event: KeyboardEvent) {
  if (!messageOpen.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  closeMessageInput()
}

onMounted(() => {
  const code = new URLSearchParams(window.location.search).get('room')
  if (code) {
    joinCode.value = code.trim().toUpperCase()
    autoJoining.value = true
    void joinGame(joinCode.value)
  }
  startRoomListPoll()
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('pointerlockchange', onPointerLockChange)
  window.addEventListener('keydown', onMessageKeyDown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.removeEventListener('pointerlockchange', onPointerLockChange)
  window.removeEventListener('keydown', onMessageKeyDown, true)
  stopStateTimer()
  if (listTimer !== null) window.clearTimeout(listTimer)
  if (redirectTimer !== null) window.clearTimeout(redirectTimer)
  if (toastTimer !== null) window.clearTimeout(toastTimer)
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
          <p class="mp-eyebrow">MULTIPLAYER WALKTHROUGH</p>
          <h1>一起在场馆里走一圈</h1>
          <p>
            房主使用当前浏览器 IndexedDB 中的场景创建房间，邀请朋友进入。
            只有漫游模式，不进入编辑；昵称暂时显示为连接 IP。
          </p>
        </section>

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

        <p v-if="error" class="mp-message mp-error">{{ error }}</p>
        <p v-if="status" class="mp-message mp-status">{{ status }}</p>
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
        </section>

        <section class="mp-card">
          <div class="mp-room-title">
            <h2>玩家</h2>
            <span>已加入 {{ players.length }} / {{ maxPlayers }} 人</span>
          </div>
          <ul class="mp-player-list">
            <li v-for="player in players" :key="player.id">
              <i :style="{ background: colorFor(player.id) }" />
              <span class="mp-player-name">{{ player.nickname }}</span>
              <em v-if="player.isHost">房主</em>
              <em v-if="player.id === selfId" class="me">你</em>
            </li>
          </ul>

          <p v-if="!isHost" class="mp-waiting">
            <span class="mp-spinner" />
            等待房主开始漫游…
          </p>

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
            <button type="button" class="mp-primary" :disabled="busy" @click="startRoom">
              {{ busy ? '正在准备…' : '开始漫游' }}
            </button>
            <p class="mp-note">开始后房间仍可加入新玩家，直到人数上限。</p>
          </template>

          <div v-if="!isHost" class="mp-room-weather">
            <div>
              <span>房间天气</span>
              <b>{{ weatherLabel }}</b>
            </div>
            <em>由房主设置</em>
          </div>

          <button type="button" class="mp-secondary mp-leave" @click="leaveGame">
            退出房间
          </button>
        </section>
      </main>
    </template>

    <template v-else>
      <div ref="stageHost" class="mp-stage" />

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
        <div class="mp-room-chip">
          <span>房间</span>
          <b>{{ roomCode }}</b>
          <i>{{ players.length }}/{{ maxPlayers }} 人</i>
        </div>
        <button type="button" class="mp-exit" @click="leaveGame">退出房间</button>
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
        点击画面锁定鼠标视角
      </div>

      <div v-if="paused && !hostLeft" class="mp-modal-backdrop">
        <div class="mp-modal">
          <p class="mp-eyebrow">PAUSED</p>
          <h2>已退出漫游</h2>
          <p>可以回到当前房间继续，或退出房间返回默认页面。</p>
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
