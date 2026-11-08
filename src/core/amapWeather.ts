import type { WeatherKind } from './weather'

export const DEFAULT_WEATHER_CITY = '贵阳'

export interface LiveWeather {
  province: string
  city: string
  adcode: string
  weather: string
  temperature: number
  winddirection: string
  windpower: string
  humidity: number
  reporttime: string
  kind: WeatherKind
}

interface AmapLive {
  province?: unknown
  city?: unknown
  adcode?: unknown
  weather?: unknown
  temperature?: unknown
  winddirection?: unknown
  windpower?: unknown
  humidity?: unknown
  reporttime?: unknown
}

const API_BASE = 'https://restapi.amap.com/v3/weather/weatherInfo'
const CACHE_TTL = 5 * 60 * 1000
const cache = new Map<string, { at: number; data: LiveWeather }>()

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 将高德天气现象文本映射到当前场景可表达的效果 */
export function mapAmapWeather(value: string): WeatherKind {
  const weather = value.replace(/\s+/g, '')

  if (/雷|冰雹/.test(weather)) return 'thunder'
  if (/雨夹雪|冻雨|雨雪/.test(weather)) return 'light-snow'
  if (/暴雨|大雨|中雨|极端降雨|强阵雨/.test(weather)) return 'heavy-rain'
  if (/雪/.test(weather)) return /暴雪|大雪|中雪/.test(weather) ? 'heavy-snow' : 'light-snow'
  if (/雾/.test(weather)) return 'fog'
  if (/霾/.test(weather)) return 'haze'
  if (/沙尘|浮尘|扬沙/.test(weather)) return 'dust'
  if (/大风|飓风|风暴|狂风|烈风|疾风|强风|劲风/.test(weather)) return 'wind'
  if (/雨/.test(weather)) {
    return /小雨|毛毛|阵雨|雨$/.test(weather) ? 'light-rain' : 'heavy-rain'
  }
  if (/阴/.test(weather)) return 'overcast'
  if (/多云/.test(weather)) return 'cloudy'
  if (/少云|晴间多云/.test(weather)) return 'partly'
  if (/晴/.test(weather)) return 'clear'
  return 'clear'
}

export async function fetchAmapWeather(
  city = DEFAULT_WEATHER_CITY,
  force = false,
): Promise<LiveWeather> {
  const key = (import.meta.env.VITE_AMAP_KEY as string | undefined)?.trim()
  if (!key) throw new Error('未配置高德 Key，请设置 VITE_AMAP_KEY')

  const target = city.trim() || DEFAULT_WEATHER_CITY
  const cached = cache.get(target)
  if (!force && cached && Date.now() - cached.at < CACHE_TTL) return cached.data

  const url = new URL(API_BASE)
  url.searchParams.set('key', key)
  url.searchParams.set('city', target)
  url.searchParams.set('extensions', 'base')

  let payload: {
    status?: string
    info?: string
    lives?: AmapLive[]
  }
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`天气接口请求失败（${res.status}）`)
    payload = await res.json()
  } catch (err) {
    if (err instanceof Error && err.message.includes('天气接口')) throw err
    throw new Error('无法连接高德天气接口')
  }

  if (payload.status !== '1') {
    throw new Error(payload.info && payload.info !== 'OK' ? payload.info : '高德天气查询失败')
  }

  const live = payload.lives?.[0]
  if (!live) throw new Error('该城市暂无实时天气数据')

  const weather = text(live.weather) || '未知'
  const data: LiveWeather = {
    province: text(live.province),
    city: text(live.city) || target,
    adcode: text(live.adcode),
    weather,
    temperature: num(live.temperature),
    winddirection: text(live.winddirection),
    windpower: text(live.windpower),
    humidity: num(live.humidity),
    reporttime: text(live.reporttime),
    kind: mapAmapWeather(weather),
  }
  cache.set(target, { at: Date.now(), data })
  return data
}
