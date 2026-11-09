import { OPEN_FLOOR_HEIGHT, boothKindOf } from './booth'
import {
  ELEVATOR_COUNT,
  ELEVATOR_DEFAULT_COUNT,
  INFRA_DEFAULTS,
  INFRA_LABELS,
  WINDOW_SILL,
  clampInfraDims,
} from './infra'
import { UNDERLAY_DEFAULT_OPACITY, clampUnderlaySpec } from './underlay'
import type {
  Booth,
  BoothKind,
  BoothMark,
  GateOpenMode,
  Infra,
  InfraKind,
  Pt,
  Underlay,
  Venue,
} from './types'
import type { WeatherKind } from './weather'

export interface SceneJson {
  version?: number
  venueName?: string
  weather?: WeatherKind
  weatherOn?: boolean
  sunProgress?: number
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
  underlay?: Underlay | null
}

export interface SceneFileInput {
  venue: Venue | null
  venueName: string
  weather: WeatherKind
  weatherOn: boolean
  sunProgress: number
  booths: Booth[]
  infras: Infra[]
  underlay: Underlay | null
}

const INFRA_KIND_SET = new Set<InfraKind>([
  'stairs',
  'restroom',
  'gate',
  'window',
  'elevator',
  'wall',
  'chair',
  'armchair',
  'sofa',
  'table-round',
  'table-square',
])

export function cloneData(
  data?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!data) return undefined
  try {
    const copy: unknown = JSON.parse(JSON.stringify(data))
    return copy && typeof copy === 'object' && !Array.isArray(copy)
      ? (copy as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** 导出时把 Logo 统一存成纯 base64 */
export function normalizeLogo(logo?: string): string | undefined {
  if (!logo) return undefined
  const value = logo.trim()
  if (!value) return undefined
  return value.startsWith('data:') ? value.split(',')[1] || undefined : value
}

export function readPoints(value: unknown): Pt[] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const pts: Pt[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const p = raw as { x?: unknown; z?: unknown }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null
    pts.push({ x: Number(p.x), z: Number(p.z) })
  }
  return pts
}

export function readBooth(raw: unknown, index: number): Booth | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const points = readPoints(r.points)
  if (!points) return null

  const kind: BoothKind =
    r.kind === 'scaffold' || r.kind === 'openfloor' || r.kind === 'massing'
      ? r.kind
      : 'massing'
  const rawHeight = Number(r.height)
  const height = kind === 'openfloor' ? OPEN_FLOOR_HEIGHT : rawHeight
  if (!Number.isFinite(height)) return null
  const canopy = kind === 'scaffold' ? r.canopy !== false : undefined
  const noTop = kind === 'massing' && r.noTop === true ? true : undefined

  const name =
    typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `展台 ${index + 1}`
  const id =
    typeof r.id === 'string' && r.id.trim()
      ? r.id.trim()
      : `imp-${Date.now().toString(36)}-${index}`
  const groupId = typeof r.groupId === 'string' && r.groupId ? r.groupId : undefined
  const exhibitor =
    typeof r.exhibitor === 'string' && r.exhibitor.trim()
      ? r.exhibitor.trim().slice(0, 60)
      : undefined
  const logo = typeof r.logo === 'string' ? normalizeLogo(r.logo) : undefined
  const data =
    r.data && typeof r.data === 'object' && !Array.isArray(r.data)
      ? cloneData(r.data as Record<string, unknown>)
      : undefined

  const mark: BoothMark | undefined =
    r.mark === 'red' || r.mark === 'yellow' || r.mark === 'gray'
      ? r.mark
      : r.marked
        ? 'red'
        : undefined

  return {
    id,
    name,
    points,
    height: kind === 'openfloor' ? OPEN_FLOOR_HEIGHT : Math.min(8, Math.max(0.4, height)),
    ...(kind === 'massing' ? {} : { kind }),
    ...(canopy !== undefined ? { canopy } : {}),
    ...(noTop ? { noTop } : {}),
    ...(groupId ? { groupId } : {}),
    ...(exhibitor ? { exhibitor } : {}),
    ...(logo ? { logo } : {}),
    ...(data ? { data } : {}),
    ...(mark ? { mark } : {}),
  }
}

export function readInfra(
  raw: unknown,
  index: number,
  venueHeight?: number,
): Infra | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = r.kind
  if (typeof kind !== 'string' || !INFRA_KIND_SET.has(kind as InfraKind)) return null
  const kindTyped = kind as InfraKind

  const x = Number(r.x)
  const z = Number(r.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null

  const base = INFRA_DEFAULTS[kindTyped]
  const width = Number(r.width)
  const depth = Number(r.depth)
  const height = Number(r.height)
  const dims = clampInfraDims(
    kindTyped,
    {
      width: Number.isFinite(width) ? width : base.width,
      depth: Number.isFinite(depth) ? depth : base.depth,
      height: Number.isFinite(height) ? height : base.height,
    },
    venueHeight,
  )
  let windowSill = WINDOW_SILL
  let windowHeight = dims.height
  if (kindTyped === 'window') {
    const rawSill = Number(r.sill)
    const sill = Number.isFinite(rawSill) ? rawSill : WINDOW_SILL
    const maxSill = Math.max(0.2, (venueHeight ?? 6) - dims.height - 0.15)
    windowSill = Math.min(maxSill, Math.max(0.2, sill))
    windowHeight = Math.min(
      dims.height,
      Math.max(1, (venueHeight ?? 6) - windowSill - 0.15),
    )
  }

  const rotation = Number(r.rotation)
  const name =
    typeof r.name === 'string' && r.name.trim()
      ? r.name.trim()
      : `${INFRA_LABELS[kindTyped]} ${index + 1}`
  const id =
    typeof r.id === 'string' && r.id.trim()
      ? r.id.trim()
      : `imp-inf-${Date.now().toString(36)}-${index}`

  const gateMode: GateOpenMode =
    r.openMode === 'side' || r.openMode === 'up' ? r.openMode : 'double'
  return {
    id,
    kind: kindTyped,
    name,
    x,
    z,
    rotation: Number.isFinite(rotation) ? rotation : 0,
    ...dims,
    ...(kindTyped === 'window'
      ? { height: windowHeight, sill: Math.round(windowSill * 10) / 10 }
      : {}),
    ...(kindTyped === 'gate'
      ? { depth: 0.5, open: !!r.open, openMode: gateMode }
      : {}),
    ...(kindTyped === 'elevator'
      ? {
          count: Math.min(
            ELEVATOR_COUNT[1],
            Math.max(
              ELEVATOR_COUNT[0],
              Math.round(Number(r.count) || ELEVATOR_DEFAULT_COUNT),
            ),
          ),
        }
      : {}),
  }
}

/** 展台 list 导出（深拷贝，logo 为纯 base64） */
export function exportBoothList(booths: Booth[]): Booth[] {
  return booths.map((b) => ({
    id: b.id,
    name: b.name,
    points: b.points.map((p) => ({ x: p.x, z: p.z })),
    height: b.height,
    ...(b.kind ? { kind: b.kind } : {}),
    ...(boothKindOf(b) === 'scaffold' ? { canopy: b.canopy !== false } : {}),
    ...(boothKindOf(b) === 'massing' && b.noTop ? { noTop: true } : {}),
    ...(b.groupId ? { groupId: b.groupId } : {}),
    ...(b.exhibitor ? { exhibitor: b.exhibitor } : {}),
    ...(b.logo ? { logo: normalizeLogo(b.logo) } : {}),
    ...(b.data ? { data: cloneData(b.data) } : {}),
    ...(b.mark ? { mark: b.mark } : b.marked ? { mark: 'red' as BoothMark } : {}),
  }))
}

export function buildSceneFile(input: SceneFileInput): SceneJson {
  const v = input.venue
  return {
    version: 1,
    venueName: input.venueName.trim() || '场馆白膜',
    weather: input.weather,
    weatherOn: input.weatherOn,
    sunProgress: input.sunProgress,
    venue: v
      ? {
          points: v.points.map((p) => ({ x: p.x, z: p.z })),
          height: v.height,
          ceiling: !!v.ceiling,
        }
      : null,
    booths: exportBoothList(input.booths),
    infras: input.infras.map((it) => ({ ...it })),
    underlay: input.underlay ? { ...input.underlay } : null,
  }
}

/** 导入 JSON 时收敛底图数据，超出网格的按比例缩放并居中约束 */
export function normalizeUnderlay(raw: unknown): Underlay | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const image = typeof o.image === 'string' ? o.image : ''
  if (!/^data:image\/(png|jpe?g);base64,/i.test(image)) return null

  const number = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const width = number(o.width, 0)
  const height = number(o.height, 0)
  if (width <= 0 || height <= 0) return null

  return clampUnderlaySpec({
    image,
    name:
      typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 60) : '底图',
    x: number(o.x, 0),
    z: number(o.z, 0),
    width,
    height,
    opacity: number(o.opacity, UNDERLAY_DEFAULT_OPACITY),
    visible: o.visible !== false,
    locked: o.locked === true,
  })
}
