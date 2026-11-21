import {
  buildSceneFile,
  normalizeRules,
  normalizeUnderlay,
  readBooth,
  readInfra,
  readPoints,
  type SceneJson,
} from './sceneFile'
import type { Booth, Infra, Underlay, Venue } from './types'
import { WEATHER_PRESETS, type WeatherKind } from './weather'

export interface LoadedScene {
  sceneJson: SceneJson
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
  underlay: Underlay | null
  weather: WeatherKind
  weatherOn: boolean
  sunProgress: number
  venueName: string
  projectKey: string
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

/** 解析 IndexedDB / 服务端传输的 SceneJson，供多人页与分享页共用 */
export function parseSceneJson(raw: unknown): LoadedScene {
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
  const sunProgress = Number.isFinite(sunRaw) ? Math.min(1, Math.max(0, sunRaw)) : 0.5
  const venueName =
    typeof scene.venueName === 'string' && scene.venueName.trim()
      ? scene.venueName.trim()
      : '场馆白膜'
  const projectKey =
    typeof scene.projectKey === 'string' ? scene.projectKey.trim().slice(0, 32) : ''

  const sceneJson = buildSceneFile({
    projectKey,
    venue,
    venueName,
    weather,
    weatherOn,
    sunProgress,
    rules: normalizeRules(scene.rules),
    booths,
    infras,
    underlay,
    // 只读分享页不渲染家具组合预设
    furniturePresets: [],
  })

  return {
    sceneJson,
    venue,
    booths,
    infras,
    underlay,
    weather,
    weatherOn,
    sunProgress,
    venueName,
    projectKey,
  }
}
