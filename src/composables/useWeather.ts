import { ref } from 'vue'
import {
  DEFAULT_WEATHER_CITY,
  fetchAmapWeather,
  type LiveWeather,
} from '../core/amapWeather'
import type { Stage } from '../core/Stage'
import {
  DEFAULT_PARTICLE_DENSITIES,
  WEATHER_LABELS,
  type ParticleDensities,
  type WeatherKind,
} from '../core/weather'

interface WeatherOptions {
  getStage: () => Stage | null
  isMobile: () => boolean
  isRestoring: () => boolean
  toast: (text: string) => void
  /** 选择手动天气后关闭天气面板并恢复漫游操作 */
  onChoose: () => void
}

function loadParticleDensities(): ParticleDensities {
  try {
    const raw = localStorage.getItem('grid-weather-density')
    if (!raw) return { ...DEFAULT_PARTICLE_DENSITIES }
    const parsed = JSON.parse(raw) as Partial<ParticleDensities>
    const clamp = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
    return {
      rain: clamp(parsed.rain),
      snow: clamp(parsed.snow),
      dust: clamp(parsed.dust),
    }
  } catch {
    return { ...DEFAULT_PARTICLE_DENSITIES }
  }
}

function loadWeatherVisibility(): number {
  const raw = localStorage.getItem('grid-weather-visibility')
  if (raw === null) return 100
  const stored = Number(raw)
  return Number.isFinite(stored) ? Math.max(0, Math.min(200, stored)) : 100
}

export function useWeather(options: WeatherOptions) {
  const weather = ref<WeatherKind>('clear')
  const weatherOn = ref(true)
  const liveWeatherOn = ref(false)
  const liveWeather = ref<LiveWeather | null>(null)
  const particleDensities = ref<ParticleDensities>(loadParticleDensities())
  const weatherVisibility = ref(loadWeatherVisibility())
  let suppressAutoWeather = false

  function setParticleDensity(kind: keyof ParticleDensities, percent: number) {
    const value = Math.max(0, Math.min(1, percent / 100))
    particleDensities.value = { ...particleDensities.value, [kind]: value }
    options.getStage()?.setParticleDensities(particleDensities.value)
    localStorage.setItem(
      'grid-weather-density',
      JSON.stringify(particleDensities.value),
    )
  }

  function setWeatherVisibility(percent: number) {
    const value = Math.max(0, Math.min(200, percent))
    weatherVisibility.value = value
    options.getStage()?.setWeatherVisibility(value / 100)
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
    options.getStage()?.setWeather(weather.value)
  }

  function toggleWeatherEnabled(on: boolean) {
    weatherOn.value = on
    if (!on) {
      liveWeatherOn.value = false
      liveWeather.value = null
      if (weather.value !== 'clear') {
        weather.value = 'clear'
        options.getStage()?.setWeather('clear')
      }
    }
  }

  function chooseWeather(kind: WeatherKind) {
    weatherOn.value = true
    liveWeatherOn.value = false
    liveWeather.value = null
    weather.value = kind
    options.getStage()?.setWeather(kind)
    options.onChoose()
    options.toast(`天气：${WEATHER_LABELS[kind]}`)
  }

  function toggleLiveWeather(on: boolean, live?: LiveWeather) {
    liveWeatherOn.value = on
    if (!on) {
      liveWeather.value = null
      if (weatherOn.value) {
        weather.value = 'clear'
        options.getStage()?.setWeather('clear')
      }
      return
    }
    if (!live) return
    weatherOn.value = true
    liveWeather.value = live
    weather.value = live.kind
    options.getStage()?.setWeather(live.kind)
  }

  /** 场馆生成后自动拉取上次查询城市的实时天气并应用 */
  async function applyLiveWeatherForVenue() {
    if (
      options.isMobile() ||
      !weatherOn.value ||
      suppressAutoWeather ||
      options.isRestoring()
    ) {
      return
    }
    const city = localStorage.getItem('grid-weather-city') || DEFAULT_WEATHER_CITY
    try {
      const live = await fetchAmapWeather(city)
      weatherOn.value = true
      liveWeatherOn.value = true
      liveWeather.value = live
      weather.value = live.kind
      options.getStage()?.setWeather(live.kind)
    } catch (err) {
      // 没有网络或 Key 未配置时保留当前天气，不影响场馆生成
      console.warn('实时天气获取失败', err)
    }
  }

  function setSuppressAutoWeather(on: boolean) {
    suppressAutoWeather = on
  }

  return {
    weather,
    weatherOn,
    liveWeatherOn,
    liveWeather,
    particleDensities,
    weatherVisibility,
    setParticleDensity,
    setWeatherVisibility,
    previewParticleWeather,
    toggleWeatherEnabled,
    chooseWeather,
    toggleLiveWeather,
    applyLiveWeatherForVenue,
    setSuppressAutoWeather,
  }
}
