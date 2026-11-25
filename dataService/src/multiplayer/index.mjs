import crypto from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { config } from '../config.mjs'
import { consumeTicket } from './tickets.mjs'

const MAX_ROOM_SIZE = config.multiplayer.maxRoomSize
const TICK_HZ = config.multiplayer.tickHz
const MAX_SCENE_MB = config.maxSceneMb
const ALLOWED_ORIGINS = config.allowedOrigins
const WEATHERS = new Set([
  'clear',
  'partly',
  'cloudy',
  'overcast',
  'haze',
  'fog',
  'light-rain',
  'heavy-rain',
  'thunder',
  'light-snow',
  'heavy-snow',
  'dust',
  'wind',
])

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const HEARTBEAT_MS = 30000
const DEFAULT_DENSITIES = { rain: 1, snow: 1, dust: 1 }
const DEFAULT_VISIBILITY = 100
const PLAYER_COLORS = [
  '#4f7cff',
  '#e05c5c',
  '#23a06b',
  '#d18a2c',
  '#8c5cf0',
  '#1f9bb5',
  '#d95f9a',
  '#6f8f3a',
]

function playerColor(index) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length]
}

function nextPlayerColor(room) {
  const used = new Set([...room.players.values()].map((player) => player.color))
  return (
    PLAYER_COLORS.find((color) => !used.has(color)) ||
    playerColor(room.players.size)
  )
}

function sanitizeNickname(value, fallback) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 20)
  return text || fallback
}

function sanitizeColor(value, fallback) {
  const text = String(value || '').trim()
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback
}

/** @type {Map<string, Room>} */
const rooms = new Map()
/** 当前仍连接的多人页面客户端，用于大厅在线人数 */
const clients = new Set()

function makeId() {
  return crypto.randomUUID()
}

function makeRoomCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)]
    }
    if (!rooms.has(code)) return code
  }
  throw new Error('无法生成房间号')
}

function normalizeRoomCode(value) {
  return String(value || '').trim().toUpperCase()
}

function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

// 朝向不做范围截断，只归一化到 [-π, π]，避免长时间旋转后远端模型停转
function normalizeAngle(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return ((n + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
}

function sanitizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {}
  return {
    x: clampNumber(state.x, -10000, 10000),
    z: clampNumber(state.z, -10000, 10000),
    y: clampNumber(state.y, -50, 500),
    yaw: normalizeAngle(state.yaw),
    pitch: clampNumber(state.pitch, -Math.PI, Math.PI),
    view: state.view === 'third' ? 'third' : 'first',
    auto: state.auto === true,
  }
}

function sanitizeWeather(value, fallback = 'clear') {
  return WEATHERS.has(value) ? value : fallback
}

function sanitizeDensities(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    rain: clampNumber(value.rain, 0, 1, DEFAULT_DENSITIES.rain),
    snow: clampNumber(value.snow, 0, 1, DEFAULT_DENSITIES.snow),
    dust: clampNumber(value.dust, 0, 1, DEFAULT_DENSITIES.dust),
  }
}

function sanitizeVisibility(value, fallback = DEFAULT_VISIBILITY) {
  return clampNumber(value, 0, 200, fallback)
}

function extractGates(scene) {
  const gates = {}
  if (!Array.isArray(scene?.infras)) return gates
  for (const infra of scene.infras) {
    if (!infra || infra.kind !== 'gate' || typeof infra.id !== 'string') continue
    gates[infra.id] = infra.open === true
  }
  return gates
}

function validScene(scene) {
  if (!scene || typeof scene !== 'object') return false
  const points = scene.venue?.points
  return Array.isArray(points) && points.length >= 3
}

function snapshot(room) {
  return {
    type: 'room',
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    maxPlayers: room.maxPlayers,
    weather: room.weather,
    weatherOn: room.weatherOn,
    weatherDensities: room.weatherDensities,
    weatherVisibility: room.weatherVisibility,
    sunProgress: room.sunProgress,
    sunPlaying: room.sunPlaying,
    gates: room.gates,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      accountId: player.accountId,
      nickname: player.nickname,
      color: player.color,
      isHost: player.isHost,
      state: player.state,
    })),
    serverTime: Date.now(),
  }
}

function send(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return
  try {
    ws.send(JSON.stringify(payload))
  } catch (err) {
    console.warn('[send]', err instanceof Error ? err.message : err)
  }
}

function broadcast(room, payload, exceptId = null) {
  for (const player of room.players.values()) {
    if (exceptId && player.id === exceptId) continue
    send(player.ws, payload)
  }
}

function createRoom(ws, client, message) {
  if (client.roomCode) {
    send(ws, { type: 'error', message: '已经在房间中' })
    return
  }
  if (!validScene(message.scene)) {
    send(ws, { type: 'create-error', message: '当前没有可用的场馆场景，请先返回创建场馆' })
    return
  }

  const maxPlayers = Math.max(
    2,
    Math.min(MAX_ROOM_SIZE, Math.round(Number(message.maxPlayers) || 4)),
  )
  const code = makeRoomCode()
  const scene = message.scene
  const room = {
    code,
    hostId: client.id,
    maxPlayers,
    scene,
    weather: sanitizeWeather(message.weather ?? scene.weather),
    weatherOn: message.weatherOn !== false,
    weatherDensities: sanitizeDensities(message.weatherDensities),
    weatherVisibility: sanitizeVisibility(message.weatherVisibility),
    sunProgress: clampNumber(message.sunProgress ?? scene.sunProgress, 0, 1, 0.5),
    sunPlaying: message.sunPlaying !== false,
    gates: extractGates(scene),
    started: false,
    createdAt: Date.now(),
    players: new Map(),
    /** targetId -> actorId：被拖拽的玩家与操作者 */
    drag: new Map(),
  }

  const player = {
    id: client.id,
    accountId: client.accountId,
    ws,
    nickname: sanitizeNickname(client.nickname, client.nickname),
    color: playerColor(0),
    isHost: true,
    state: sanitizeState(null),
  }
  room.players.set(player.id, player)
  client.roomCode = code
  client.isHost = true
  rooms.set(code, room)

  send(ws, {
    type: 'created',
    code,
    selfId: client.id,
    nickname: player.nickname,
    account: { id: client.accountId, username: player.nickname },
    room: snapshot(room),
  })
  console.info(`[room] ${code} 创建，房主 ${client.nickname}，上限 ${maxPlayers}`)
}

function joinRoom(ws, client, message) {
  if (client.roomCode) {
    send(ws, { type: 'join-error', reason: 'already-in-room', message: '已经在房间中' })
    return
  }
  const code = normalizeRoomCode(message.code)
  const room = rooms.get(code)
  if (!room) {
    send(ws, { type: 'join-error', reason: 'not-found', message: '房间不存在或已解散' })
    return
  }
  if (room.players.size >= room.maxPlayers) {
    send(ws, {
      type: 'join-error',
      reason: 'full',
      message: `房间已满（${room.players.size}/${room.maxPlayers}）`,
    })
    return
  }

  const player = {
    id: client.id,
    accountId: client.accountId,
    ws,
    nickname: sanitizeNickname(client.nickname, client.nickname),
    color: nextPlayerColor(room),
    isHost: false,
    state: sanitizeState(null),
  }
  room.players.set(player.id, player)
  client.roomCode = code
  client.isHost = false

  send(ws, {
    type: 'joined',
    code,
    selfId: client.id,
    nickname: player.nickname,
    account: { id: client.accountId, username: player.nickname },
    scene: room.scene,
    room: snapshot(room),
  })
  broadcast(
    room,
    {
      type: 'player-joined',
      player: {
        id: player.id,
        accountId: player.accountId,
        nickname: player.nickname,
        color: player.color,
        isHost: false,
        state: player.state,
      },
    },
    player.id,
  )
  console.info(`[room] ${code} 加入 ${client.nickname}，${room.players.size}/${room.maxPlayers}`)
}

function startRoom(ws, client) {
  const room = rooms.get(client.roomCode)
  if (!room) {
    send(ws, { type: 'error', message: '房间不存在' })
    return
  }
  if (room.hostId !== client.id) {
    send(ws, { type: 'error', message: '只有房主可以开始漫游' })
    return
  }
  if (room.started) return
  room.started = true
  broadcast(room, { type: 'started', serverTime: Date.now() })
  console.info(`[room] ${room.code} 开始漫游`)
}

function sendRoomNotice(room, text) {
  broadcast(room, {
    type: 'message',
    id: 'system',
    nickname: '系统',
    text,
    serverTime: Date.now(),
  })
}

function clearPlayerDrag(room, playerId) {
  for (const [targetId, actorId] of [...room.drag.entries()]) {
    if (targetId !== playerId && actorId !== playerId) continue
    room.drag.delete(targetId)
    broadcast(room, {
      type: 'interaction',
      action: 'drag-end',
      fromId: actorId,
      targetId,
    })
  }
}

function handleInteraction(ws, client, message) {
  const room = rooms.get(client.roomCode)
  if (!room) return
  const actor = room.players.get(client.id)
  const target = room.players.get(message.targetId)
  if (!actor || !target || target.id === actor.id) return
  const action = message.action
  if (!['knockback', 'drag-start', 'drag-move', 'drag-end'].includes(action)) {
    return
  }

  // 触发互动要求双方在 1m 内；服务端留少量延迟容差
  if (action === 'knockback' || action === 'drag-start') {
    const distance = Math.hypot(
      actor.state.x - target.state.x,
      actor.state.z - target.state.z,
    )
    if (distance > 1.3) return
  }

  if (action === 'knockback') {
    const x = clampNumber(message.x, -10000, 10000, target.state.x)
    const z = clampNumber(message.z, -10000, 10000, target.state.z)
    target.state.x = x
    target.state.z = z
    // 击退会打断该目标正在进行的拖拽
    if (room.drag.has(target.id)) {
      const previousActor = room.drag.get(target.id)
      room.drag.delete(target.id)
      broadcast(room, {
        type: 'interaction',
        action: 'drag-end',
        fromId: previousActor,
        targetId: target.id,
      })
    }
    broadcast(room, {
      type: 'interaction',
      action,
      fromId: actor.id,
      targetId: target.id,
      x,
      z,
    })
    sendRoomNotice(room, `${actor.nickname} 击退了 ${target.nickname}`)
    return
  }

  if (action === 'drag-start') {
    const currentActor = room.drag.get(target.id)
    if (currentActor && currentActor !== actor.id) return
    for (const [draggedTarget, draggingActor] of room.drag) {
      if (draggingActor === actor.id && draggedTarget !== target.id) {
        return
      }
    }
    room.drag.set(target.id, actor.id)
    broadcast(room, {
      type: 'interaction',
      action,
      fromId: actor.id,
      targetId: target.id,
    })
    sendRoomNotice(room, `${actor.nickname} 开始拖拽 ${target.nickname}`)
    return
  }

  if (room.drag.get(target.id) !== actor.id) return

  if (action === 'drag-move') {
    target.state.x = clampNumber(message.x, -10000, 10000, target.state.x)
    target.state.z = clampNumber(message.z, -10000, 10000, target.state.z)
    broadcast(room, {
      type: 'interaction',
      action,
      fromId: actor.id,
      targetId: target.id,
      x: target.state.x,
      z: target.state.z,
    })
    return
  }

  room.drag.delete(target.id)
  broadcast(room, {
    type: 'interaction',
    action,
    fromId: actor.id,
    targetId: target.id,
  })
  sendRoomNotice(room, `${actor.nickname} 松开了 ${target.nickname}`)
}

function setPlayerProfile(ws, client, message) {
  const room = rooms.get(client.roomCode)
  const player = room?.players.get(client.id)
  if (!room || !player) return
  // 昵称固定为登录账号名，房间内只允许修改模型颜色
  const color = sanitizeColor(message.color, player.color)
  if (color === player.color) return
  player.color = color
  broadcast(room, {
    type: 'player-updated',
    player: {
      id: player.id,
      accountId: player.accountId,
      nickname: player.nickname,
      color: player.color,
      isHost: player.isHost,
      state: player.state,
    },
  })
}

function setGate(ws, client, message) {
  const room = rooms.get(client.roomCode)
  if (!room) return
  const id = typeof message.id === 'string' ? message.id : ''
  if (!id || !(id in room.gates)) return
  room.gates[id] = message.open === true
  broadcast(room, { type: 'gate', id, open: room.gates[id] })
}

function setWeather(ws, client, message) {
  const room = rooms.get(client.roomCode)
  if (!room) return
  if (room.hostId !== client.id) return
  const weather = sanitizeWeather(message.weather, room.weather)
  const weatherOn =
    typeof message.weatherOn === 'boolean' ? message.weatherOn : room.weatherOn
  const weatherDensities = sanitizeDensities(
    message.weatherDensities ?? room.weatherDensities,
  )
  const weatherVisibility = sanitizeVisibility(
    message.weatherVisibility,
    room.weatherVisibility,
  )
  if (
    weather === room.weather &&
    weatherOn === room.weatherOn &&
    weatherVisibility === room.weatherVisibility &&
    weatherDensities.rain === room.weatherDensities.rain &&
    weatherDensities.snow === room.weatherDensities.snow &&
    weatherDensities.dust === room.weatherDensities.dust
  ) {
    return
  }
  room.weather = weather
  room.weatherOn = weatherOn
  room.weatherDensities = weatherDensities
  room.weatherVisibility = weatherVisibility
  broadcast(room, {
    type: 'weather',
    weather,
    weatherOn,
    weatherDensities,
    weatherVisibility,
  })
}

function sanitizeChatText(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 200)
}

function sendChatMessage(ws, client, message) {
  const room = rooms.get(client.roomCode)
  if (!room) return
  const player = room.players.get(client.id)
  if (!player) return
  const text = sanitizeChatText(message.text)
  if (!text) return
  broadcast(room, {
    type: 'message',
    id: player.id,
    nickname: player.nickname,
    text,
    serverTime: Date.now(),
  })
}

function setTime(ws, client, message) {
  const room = rooms.get(client.roomCode)
  if (!room) return
  if (room.hostId !== client.id) return
  room.sunProgress = clampNumber(message.sunProgress, 0, 1, room.sunProgress)
  room.sunPlaying = message.sunPlaying !== false
  broadcast(
    room,
    {
      type: 'time',
      sunProgress: room.sunProgress,
      sunPlaying: room.sunPlaying,
    },
    client.id,
  )
}

function kickPlayer(ws, client, message) {
  const room = rooms.get(client.roomCode)
  if (!room || room.hostId !== client.id) return
  const target = room.players.get(String(message.id || ''))
  if (!target || target.id === client.id || target.isHost) return

  clearPlayerDrag(room, target.id)
  room.players.delete(target.id)
  const targetClient = target.ws?.client
  if (targetClient) {
    targetClient.roomCode = null
    targetClient.isHost = false
  }
  send(target.ws, {
    type: 'kicked',
    message: '你已被房主移出房间',
  })
  broadcast(room, {
    type: 'player-left',
    id: target.id,
    nickname: target.nickname,
    reason: 'kicked',
  })
  console.info(
    `[room] ${room.code} 房主移出 ${target.nickname}，${room.players.size}/${room.maxPlayers}`,
  )
}

function leaveRoom(ws, client, reason = 'leave') {
  const room = rooms.get(client.roomCode)
  if (!room) return
  const player = room.players.get(client.id)
  client.roomCode = null
  client.isHost = false
  if (!player) return

  // 拖拽中退出时解除目标锁定
  clearPlayerDrag(room, player.id)

  if (player.isHost) {
    rooms.delete(room.code)
    // 房主退出时解除所有客人的房间绑定，让客人可在大厅继续创建 / 加入
    for (const member of room.players.values()) {
      const memberClient = member.ws?.client
      if (!memberClient || memberClient.id === player.id) continue
      memberClient.roomCode = null
      memberClient.isHost = false
    }
    broadcast(room, { type: 'room-closed', reason: 'host-left' }, player.id)
    room.players.clear()
    console.info(`[room] ${room.code} 房主退出，房间解散`)
    return
  }

  room.players.delete(player.id)
  broadcast(room, {
    type: 'player-left',
    id: player.id,
    nickname: player.nickname,
    reason,
  })
  console.info(`[room] ${room.code} 离开 ${player.nickname}，${room.players.size}/${room.maxPlayers}`)
}

function roomSummaries() {
  return [...rooms.values()]
    .map((room) => ({
      code: room.code,
      players: room.players.size,
      maxPlayers: room.maxPlayers,
      started: room.started,
      createdAt: room.createdAt,
    }))
    .sort((a, b) => a.createdAt - b.createdAt)
}

function listRooms(ws) {
  send(ws, {
    type: 'room-list',
    rooms: roomSummaries(),
    online: clients.size,
  })
}

function onMessage(ws, client, message) {
  switch (message.type) {
    case 'create':
      createRoom(ws, client, message)
      break
    case 'join':
      joinRoom(ws, client, message)
      break
    case 'start':
      startRoom(ws, client)
      break
    case 'state': {
      const room = rooms.get(client.roomCode)
      const player = room?.players.get(client.id)
      if (player) {
        const next = sanitizeState(message.state)
        // 被拖拽期间位置由操作者驱动，忽略目标自己的位移输入
        if (room.drag?.has(client.id)) {
          next.x = player.state.x
          next.z = player.state.z
        }
        player.state = next
      }
      break
    }
    case 'interact':
      handleInteraction(ws, client, message)
      break
    case 'profile':
      setPlayerProfile(ws, client, message)
      break
    case 'gate':
      setGate(ws, client, message)
      break
    case 'weather':
      setWeather(ws, client, message)
      break
    case 'time':
      setTime(ws, client, message)
      break
    case 'message':
      sendChatMessage(ws, client, message)
      break
    case 'kick':
      kickPlayer(ws, client, message)
      break
    case 'leave':
      leaveRoom(ws, client, 'leave')
      break
    case 'list':
      listRooms(ws)
      break
    case 'ping':
      send(ws, { type: 'pong', t: Date.now() })
      break
    default:
      break
  }
}

/** 返回 HTTP 拒绝响应，WebSocket 升级不会进入连接事件 */
function rejectUpgrade(socket, status, message) {
  const body = `${message}\n`
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  )
  socket.destroy()
}

/**
 * 把多人房间 WebSocket 挂到 dataService 的 HTTP server 上。
 * 浏览器必须先通过 /api/multiplayer/ticket 换取一次性票，
 * /ws?ticket=... 升级成功后才允许 create / join / list。
 */
export function registerMultiplayer(server, options = {}) {
  if (!config.multiplayer.enabled) {
    return { close() {} }
  }

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_SCENE_MB * 1024 * 1024,
  })

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      try {
        ws.ping()
      } catch {
        ws.terminate()
      }
    }
  }, HEARTBEAT_MS)

  const tickMs = 1000 / TICK_HZ
  const tick = setInterval(() => {
    for (const room of rooms.values()) {
      const payload = snapshot(room)
      for (const player of room.players.values()) send(player.ws, payload)
    }
  }, tickMs)

  const onUpgrade = (req, socket, head) => {
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request')
      return
    }
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }

    const origin = req.headers.origin
    const originOk =
      typeof options.originAllowed === 'function'
        ? options.originAllowed(origin)
        : !ALLOWED_ORIGINS.length || !origin || ALLOWED_ORIGINS.includes(origin)
    if (!originOk) {
      rejectUpgrade(socket, 403, 'Origin not allowed')
      return
    }

    const user = consumeTicket(url.searchParams.get('ticket'))
    if (!user) {
      rejectUpgrade(socket, 401, 'Login required')
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user)
    })
  }

  server.on('upgrade', onUpgrade)

  wss.on('connection', (ws, req, user) => {
    ws.isAlive = true
    const client = {
      id: makeId(),
      ws,
      accountId: user.id,
      nickname: sanitizeNickname(user.username, '登录用户'),
      roomCode: null,
      isHost: false,
    }
    ws.client = client
    clients.add(client)

    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('message', (data) => {
      let message
      try {
        message = JSON.parse(data.toString())
      } catch {
        return
      }
      if (!message || typeof message !== 'object') return
      onMessage(ws, client, message)
    })

    ws.on('close', () => {
      clients.delete(client)
      leaveRoom(ws, client, 'disconnect')
    })

    ws.on('error', (err) => {
      console.warn('[ws]', err instanceof Error ? err.message : err)
    })
  })

  return {
    async close() {
      clearInterval(heartbeat)
      clearInterval(tick)
      for (const room of rooms.values()) {
        broadcast(room, { type: 'room-closed', reason: 'server-shutdown' })
      }
      server.off('upgrade', onUpgrade)
      for (const ws of wss.clients) ws.terminate()
      await new Promise((resolve) => wss.close(resolve))
    },
  }
}