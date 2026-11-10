export type WeatherKind =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'overcast'
  | 'haze'
  | 'fog'
  | 'light-rain'
  | 'heavy-rain'
  | 'thunder'
  | 'light-snow'
  | 'heavy-snow'
  | 'dust'
  | 'wind'

/** 雨 / 雪 / 沙尘的独立浓度倍率，0–1 */
export interface ParticleDensities {
  rain: number
  snow: number
  dust: number
}

export const DEFAULT_PARTICLE_DENSITIES: ParticleDensities = {
  rain: 1,
  snow: 1,
  dust: 1,
}

export interface WeatherOption {
  kind: WeatherKind
  label: string
  description: string
}

export interface WeatherPreset {
  skyDay: number
  skyNight: number
  fogNear: number
  fogFar: number
  sunScale: number
  fillScale: number
  hemiScale: number
  /** 降水强度 0–1，0 表示无 */
  rain: number
  snow: number
  dust: number
  /** 是否出现雷电闪光 */
  lightning: boolean
  /** 风力 0–1，影响雨雪偏移和沙尘 */
  wind: number
}

export const WEATHER_OPTIONS: WeatherOption[] = [
  { kind: 'clear', label: '晴', description: '天空通透，光照充足' },
  { kind: 'partly', label: '少云', description: '少量云层，光线柔和' },
  { kind: 'cloudy', label: '多云', description: '云量增加，阳光变弱' },
  { kind: 'overcast', label: '阴', description: '厚云遮日，环境偏灰' },
  { kind: 'haze', label: '霾', description: '低能见度，空气浑浊' },
  { kind: 'fog', label: '雾', description: '近处发白，远处隐没' },
  { kind: 'light-rain', label: '小雨', description: '细雨，地面微湿感' },
  { kind: 'heavy-rain', label: '大雨', description: '密集雨幕，天空压暗' },
  { kind: 'thunder', label: '雷阵雨', description: '强降雨并伴随闪电' },
  { kind: 'light-snow', label: '小雪', description: '稀疏雪花缓慢飘落' },
  { kind: 'heavy-snow', label: '大雪', description: '密集降雪，能见度降低' },
  { kind: 'dust', label: '沙尘', description: '扬沙与浮尘，天空偏黄' },
  { kind: 'wind', label: '大风', description: '强风、扬尘与快速漂移' },
]

export const WEATHER_LABELS: Record<WeatherKind, string> = WEATHER_OPTIONS.reduce(
  (acc, item) => {
    acc[item.kind] = item.label
    return acc
  },
  {} as Record<WeatherKind, string>,
)

export const WEATHER_PRESETS: Record<WeatherKind, WeatherPreset> = {
  clear: {
    skyDay: 0x6fbcee,
    skyNight: 0x172136,
    fogNear: 220,
    fogFar: 620,
    sunScale: 1,
    fillScale: 1,
    hemiScale: 1,
    rain: 0,
    snow: 0,
    dust: 0,
    lightning: false,
    wind: 0.08,
  },
  partly: {
    skyDay: 0x82c1e6,
    skyNight: 0x1b2740,
    fogNear: 200,
    fogFar: 600,
    sunScale: 0.88,
    fillScale: 0.96,
    hemiScale: 0.96,
    rain: 0,
    snow: 0,
    dust: 0,
    lightning: false,
    wind: 0.15,
  },
  cloudy: {
    skyDay: 0x9abdd6,
    skyNight: 0x242d3b,
    fogNear: 180,
    fogFar: 540,
    sunScale: 0.62,
    fillScale: 0.9,
    hemiScale: 0.9,
    rain: 0,
    snow: 0,
    dust: 0,
    lightning: false,
    wind: 0.22,
  },
  overcast: {
    skyDay: 0xc5cbd0,
    skyNight: 0x2b323b,
    fogNear: 150,
    fogFar: 450,
    sunScale: 0.32,
    fillScale: 0.82,
    hemiScale: 0.8,
    rain: 0,
    snow: 0,
    dust: 0,
    lightning: false,
    wind: 0.3,
  },
  haze: {
    skyDay: 0xd7d1c2,
    skyNight: 0x302f2b,
    fogNear: 80,
    fogFar: 360,
    sunScale: 0.52,
    fillScale: 0.84,
    hemiScale: 0.78,
    rain: 0,
    snow: 0,
    dust: 0.12,
    lightning: false,
    wind: 0.12,
  },
  fog: {
    skyDay: 0xd9d9d4,
    skyNight: 0x2b3032,
    fogNear: 38,
    fogFar: 250,
    sunScale: 0.38,
    fillScale: 0.96,
    hemiScale: 0.9,
    rain: 0,
    snow: 0,
    dust: 0,
    lightning: false,
    wind: 0.04,
  },
  'light-rain': {
    skyDay: 0xb8c2c9,
    skyNight: 0x202a34,
    fogNear: 100,
    fogFar: 340,
    sunScale: 0.42,
    fillScale: 0.86,
    hemiScale: 0.82,
    rain: 0.35,
    snow: 0,
    dust: 0,
    lightning: false,
    wind: 0.26,
  },
  'heavy-rain': {
    skyDay: 0x8f9ca7,
    skyNight: 0x18202a,
    fogNear: 62,
    fogFar: 220,
    sunScale: 0.18,
    fillScale: 0.72,
    hemiScale: 0.72,
    rain: 1,
    snow: 0,
    dust: 0,
    lightning: false,
    wind: 0.44,
  },
  thunder: {
    skyDay: 0x75818c,
    skyNight: 0x121821,
    fogNear: 52,
    fogFar: 200,
    sunScale: 0.12,
    fillScale: 0.66,
    hemiScale: 0.68,
    rain: 0.9,
    snow: 0,
    dust: 0,
    lightning: true,
    wind: 0.62,
  },
  'light-snow': {
    skyDay: 0xcdd5dc,
    skyNight: 0x253245,
    fogNear: 72,
    fogFar: 280,
    sunScale: 0.38,
    fillScale: 0.94,
    hemiScale: 0.88,
    rain: 0,
    snow: 0.38,
    dust: 0,
    lightning: false,
    wind: 0.18,
  },
  'heavy-snow': {
    skyDay: 0xb5c1cc,
    skyNight: 0x202c3c,
    fogNear: 42,
    fogFar: 190,
    sunScale: 0.2,
    fillScale: 0.84,
    hemiScale: 0.78,
    rain: 0,
    snow: 1,
    dust: 0,
    lightning: false,
    wind: 0.34,
  },
  dust: {
    skyDay: 0xcbb992,
    skyNight: 0x2f2a22,
    fogNear: 42,
    fogFar: 240,
    sunScale: 0.38,
    fillScale: 0.78,
    hemiScale: 0.74,
    rain: 0,
    snow: 0,
    dust: 0.85,
    lightning: false,
    wind: 0.65,
  },
  wind: {
    skyDay: 0xd5dce1,
    skyNight: 0x222e3c,
    fogNear: 170,
    fogFar: 580,
    sunScale: 0.7,
    fillScale: 0.94,
    hemiScale: 0.92,
    rain: 0,
    snow: 0,
    dust: 0.16,
    lightning: false,
    wind: 1,
  },
}
