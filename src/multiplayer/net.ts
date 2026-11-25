import type { WalkNetState } from '../core/Stage'
import type { SceneJson } from '../core/sceneFile'
import type { ParticleDensities, WeatherKind } from '../core/weather'

export interface RoomPlayer {
  id: string
  accountId?: number
  nickname: string
  color: string
  isHost: boolean
  state: WalkNetState
}

export interface RoomAccount {
  id: number
  username: string
}

export interface RoomSnapshot {
  type: 'room'
  code: string
  hostId: string
  started: boolean
  maxPlayers: number
  weather: WeatherKind
  weatherOn: boolean
  weatherDensities: ParticleDensities
  weatherVisibility: number
  sunProgress: number
  sunPlaying: boolean
  gates: Record<string, boolean>
  players: RoomPlayer[]
  serverTime: number
}

export interface RoomSummary {
  code: string
  players: number
  maxPlayers: number
  started: boolean
}

export type InteractionAction =
  | 'knockback'
  | 'drag-start'
  | 'drag-move'
  | 'drag-end'

export type ServerMessage =
  | {
      type: 'interaction'
      action: InteractionAction
      fromId: string
      targetId: string
      x?: number
      z?: number
    }
  | {
      type: 'created'
      code: string
      selfId: string
      nickname: string
      account?: RoomAccount
      room: RoomSnapshot
    }
  | {
      type: 'joined'
      code: string
      selfId: string
      nickname: string
      account?: RoomAccount
      scene: SceneJson
      room: RoomSnapshot
    }
  | { type: 'player-joined'; player: RoomPlayer }
  | { type: 'player-updated'; player: RoomPlayer }
  | { type: 'player-left'; id: string; nickname?: string; reason?: string }
  | { type: 'started'; serverTime: number }
  | { type: 'gate'; id: string; open: boolean }
  | {
      type: 'weather'
      weather: WeatherKind
      weatherOn?: boolean
      weatherDensities?: ParticleDensities
      weatherVisibility?: number
    }
  | { type: 'time'; sunProgress: number; sunPlaying: boolean }
  | {
      type: 'message'
      id: string
      nickname: string
      text: string
      serverTime: number
    }
  | RoomSnapshot
  | { type: 'room-list'; rooms: RoomSummary[]; online: number }
  | { type: 'kicked'; message: string }
  | { type: 'room-closed'; reason: string }
  | { type: 'join-error'; reason: string; message: string }
  | { type: 'create-error'; message: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number }

/**
 * 多人服务已并入 dataService：使用同源 /ws，ticket 是登录后换取的一次性票。
 * 本地由 vite.config.ts 的 /ws 代理转发，生产由 nginx 转发。
 */
export function multiplayerWebSocketUrl(ticket: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const query = new URLSearchParams({ ticket })
  return `${protocol}//${window.location.host}/ws?${query.toString()}`
}

export function createMultiplayerSocket(ticket: string): WebSocket {
  return new WebSocket(multiplayerWebSocketUrl(ticket))
}

export interface ClientCreateMessage {
  type: 'create'
  maxPlayers: number
  scene: SceneJson
  weather: WeatherKind
  weatherOn: boolean
  weatherDensities: ParticleDensities
  weatherVisibility: number
  sunProgress: number
  sunPlaying: boolean
}

export interface ClientJoinMessage {
  type: 'join'
  code: string
}

export interface ClientStateMessage {
  type: 'state'
  state: WalkNetState
}

export interface ClientProfileMessage {
  type: 'profile'
  /** 服务端固定使用登录账号名，昵称字段保留仅为兼容旧客户端 */
  nickname?: string
  color: string
}

export interface ClientInteractionMessage {
  type: 'interact'
  action: InteractionAction
  targetId: string
  x?: number
  z?: number
}

export interface ClientGateMessage {
  type: 'gate'
  id: string
  open: boolean
}

export interface ClientWeatherMessage {
  type: 'weather'
  weather: WeatherKind
  weatherOn: boolean
  weatherDensities: ParticleDensities
  weatherVisibility: number
}

export interface ClientListMessage {
  type: 'list'
}

export interface ClientChatMessage {
  type: 'message'
  text: string
}

export interface ClientKickMessage {
  type: 'kick'
  id: string
}
