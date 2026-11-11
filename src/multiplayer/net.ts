import type { WalkNetState } from '../core/Stage'
import type { SceneJson } from '../core/sceneFile'
import type { ParticleDensities, WeatherKind } from '../core/weather'

export interface RoomPlayer {
  id: string
  nickname: string
  color: string
  isHost: boolean
  state: WalkNetState
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
      room: RoomSnapshot
    }
  | {
      type: 'joined'
      code: string
      selfId: string
      nickname: string
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
  | { type: 'room-closed'; reason: string }
  | { type: 'join-error'; reason: string; message: string }
  | { type: 'create-error'; message: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number }

export function multiplayerWebSocketUrl(): string {
  const configured = String(import.meta.env.VITE_MULTIPLAYER_WS_URL || '').trim()
  if (configured) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname}:3010`
}

export function createMultiplayerSocket(): WebSocket {
  return new WebSocket(multiplayerWebSocketUrl())
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
  nickname: string
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
