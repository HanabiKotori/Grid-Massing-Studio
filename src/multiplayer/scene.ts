import { loadStoredProject } from '../core/projectStore'
import {
  buildSceneFile,
  normalizeUnderlay,
  readBooth,
  readInfra,
  readPoints,
  type SceneJson,
} from '../core/sceneFile'
import type { Booth, Infra, Underlay, Venue } from '../core/types'
import { WEATHER_PRESETS, type WeatherKind } from '../core/weather'

export interface LoadedMultiplayerScene {
  sceneJson: SceneJson
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
  underlay: Underlay | null
  weather: WeatherKind
  sunProgress: number
  venueName: string
}

function normalizeWeather(value: unknown): WeatherKind {
  return typeof value === 'string' && value in WEATHER_PRESETS
    ? (value as WeatherKind)
    : 'clear'
}

function normalizeVenue(raw: unknown): Venue | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const points = readPoints(o.points)
  const height = Number(o.height)
  if (!points || !Number.isFinite(height) || height <= 0) return null
  return {
    points,
    height,
    ceiling: o.ceiling === true,
  }
}

/** 解析 IndexedDB / 服务端传输的 SceneJson */
export function parseMultiplayerScene(raw: unknown): LoadedMultiplayerScene {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new Error('场景数据损坏')
    }
  }
  if (!value || typeof value !== 'object') throw new Error('场景数据为空')
  const scene = value as Record<string, unknown>
  const venue = normalizeVenue(scene.venue)
  if (!venue) throw new Error('场景缺少场馆轮廓')

  const rawBooths = Array.isArray(scene.booths) ? scene.booths : []
  const booths = rawBooths
    .map((item, index) => readBooth(item, index))
    .filter((item): item is Booth => !!item)
  const rawInfras = Array.isArray(scene.infras) ? scene.infras : []
  const infras = rawInfras
    .map((item, index) => readInfra(item, index, venue.height))
    .filter((item): item is Infra => !!item)
  const underlay = normalizeUnderlay(scene.underlay)
  const weatherOn = scene.weatherOn !== false
  const weather = weatherOn ? normalizeWeather(scene.weather) : 'clear'
  const sunRaw = Number(scene.sunProgress)
  const sunProgress = Number.isFinite(sunRaw)
    ? Math.min(1, Math.max(0, sunRaw))
    : 0.5
  const venueName =
    typeof scene.venueName === 'string' && scene.venueName.trim()
      ? scene.venueName.trim()
      : '场馆白膜'

  const sceneJson = buildSceneFile({
    venue,
    venueName,
    weather,
    weatherOn,
    sunProgress,
    booths,
    infras,
    underlay,
  })

  return { sceneJson, venue, booths, infras, underlay, weather, sunProgress, venueName }
}

/** 房主读取当前 IndexedDB 中的场景 */
export async function loadCurrentMultiplayerScene(): Promise<LoadedMultiplayerScene> {
  const stored = await loadStoredProject()
  if (!stored || !stored.scene) {
    throw new Error('当前没有可用的场馆场景，请先在主页面创建或载入场景')
  }
  return parseMultiplayerScene(stored.scene)
}
