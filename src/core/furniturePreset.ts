import { clampInfraDims, isFurnitureKind } from './infra'
import {
  boothAtPoint,
  furnitureInsidePolygon,
  infraAabb,
  obbOverlap,
} from './infraGeometry'
import type { Booth, Infra, InfraKind } from './types'

/** 预设中的单件家具：坐标相对组合外框中心 */
export interface PresetItem {
  kind: InfraKind
  x: number
  z: number
  rotation: number
  width: number
  depth: number
  height: number
  /** 材质预设 id，小体积字符串，随预设保存 */
  material?: string
  /** 自定义贴图 data URL：只在本次会话的组合复制中保留，落盘时丢弃 */
  texture?: string
}

/** 多选家具保存下来的组合 */
export interface FurniturePreset {
  id: string
  name: string
  items: PresetItem[]
  /** 保存时组合外框的宽 / 深（米） */
  width: number
  depth: number
  createdAt: number
}

/** 单个组合最多的家具件数 */
export const PRESET_MAX_ITEMS = 30
/** 本地最多保存的组合数量，超出后最旧的被移除 */
export const PRESET_LIMIT = 40

const STORAGE_KEY = 'gms.furniture-presets.v1'

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

function normAngle(a: number): number {
  return (((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
}

/** 由一组家具生成组合预设；少于 2 件或含非家具时返回 null */
export function buildFurniturePreset(
  items: Infra[],
  name: string,
): FurniturePreset | null {
  const list = items.filter((it) => isFurnitureKind(it.kind))
  if (list.length < 2) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const it of list) {
    const b = infraAabb(it)
    minX = Math.min(minX, b.minX)
    maxX = Math.max(maxX, b.maxX)
    minZ = Math.min(minZ, b.minZ)
    maxZ = Math.max(maxZ, b.maxZ)
  }
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2

  return {
    id: `preset-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name,
    items: list.map((it) => ({
      kind: it.kind,
      x: round3(it.x - cx),
      z: round3(it.z - cz),
      rotation: it.rotation,
      width: it.width,
      depth: it.depth,
      height: it.height,
      ...(it.material ? { material: it.material } : {}),
      ...(it.texture ? { texture: it.texture } : {}),
    })),
    width: round3(maxX - minX),
    depth: round3(maxZ - minZ),
    createdAt: Date.now(),
  }
}

/** 组合摆到 (cx, cz) 并整体旋转 rotation 后，每件家具的绝对位置 */
export function presetItemsAt(
  preset: FurniturePreset,
  cx: number,
  cz: number,
  rotation: number,
): PresetItem[] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return preset.items.map((item) => ({
    ...item,
    x: round3(cx + item.x * cos + item.z * sin),
    z: round3(cz - item.x * sin + item.z * cos),
    rotation: normAngle(item.rotation + rotation),
  }))
}

export interface GroupSpot {
  dx: number
  dz: number
}

/** 一组家具是否都完整落在同一个展台内，且不与既有对象穿模 */
export function groupPlacementOk(
  items: Pick<PresetItem, 'kind' | 'x' | 'z' | 'rotation' | 'width' | 'depth'>[],
  booths: Booth[],
  infras: Infra[],
  ignoreIds: Set<string>,
): boolean {
  if (!items.length) return false
  const host = boothAtPoint(booths, items[0])
  if (!host || host.points.length < 3) return false

  for (const it of items) {
    if (
      !furnitureInsidePolygon(
        host.points,
        it.x,
        it.z,
        it.width,
        it.depth,
        it.rotation,
      )
    ) {
      return false
    }
    const owner = boothAtPoint(booths, it)
    if (!owner || owner.id !== host.id) return false

    for (const other of infras) {
      if (ignoreIds.has(other.id)) continue
      // 门窗依附墙面，家具体块不会与它们相交
      if (other.kind === 'gate' || other.kind === 'window') continue
      if (
        obbOverlap(
          it.x,
          it.z,
          it.width,
          it.depth,
          it.rotation,
          other.x,
          other.z,
          other.width,
          other.depth,
          other.rotation,
        )
      ) {
        return false
      }
    }
  }
  return true
}

/**
 * 为整组家具找一个可行落点：
 * 原位可用时返回 { dx: 0, dz: 0 }，否则以 0.2 m 步长由近到远搜索平移量。
 * 返回的是相对当前坐标的平移量，找不到返回 null。
 */
export function fitGroupOffset(
  items: Pick<PresetItem, 'kind' | 'x' | 'z' | 'rotation' | 'width' | 'depth'>[],
  booths: Booth[],
  infras: Infra[],
  ignoreIds: Set<string> = new Set(),
  maxRadius = 2.4,
): GroupSpot | null {
  if (!items.length) return null
  if (groupPlacementOk(items, booths, infras, ignoreIds)) return { dx: 0, dz: 0 }

  const step = 0.2
  const rings = Math.max(1, Math.ceil(maxRadius / step))
  const tryOffset = (dx: number, dz: number): GroupSpot | null => {
    const ox = round3(dx)
    const oz = round3(dz)
    const moved = items.map((it) => ({
      ...it,
      x: round3(it.x + ox),
      z: round3(it.z + oz),
    }))
    return groupPlacementOk(moved, booths, infras, ignoreIds)
      ? { dx: ox, dz: oz }
      : null
  }

  for (let r = 1; r <= rings; r += 1) {
    const d = r * step
    const candidates: GroupSpot[] = []
    for (let i = -r; i <= r; i += 1) {
      candidates.push({ dx: i * step, dz: -d })
      candidates.push({ dx: i * step, dz: d })
    }
    for (let j = -r + 1; j <= r - 1; j += 1) {
      candidates.push({ dx: -d, dz: j * step })
      candidates.push({ dx: d, dz: j * step })
    }
    // 同一圈里优先沿单一轴平移，避免整组无谓地斜向跳动
    candidates.sort(
      (a, b) =>
        Math.hypot(a.dx, a.dz) - Math.hypot(b.dx, b.dz) ||
        Math.abs(a.dx) + Math.abs(a.dz) - (Math.abs(b.dx) + Math.abs(b.dz)),
    )
    for (const c of candidates) {
      const hit = tryOffset(c.dx, c.dz)
      if (hit) return hit
    }
  }
  return null
}

/**
 * 组合落位时的最大自动避让距离：按组合尺寸放大，
 * 既能在贴边 / 压到家具时自动挪开，又不会跳到无关位置。
 */
export function presetFitRadius(preset: FurniturePreset): number {
  const size = Math.max(preset.width, preset.depth)
  return Math.min(2.4, Math.max(0.6, size / 2 + 0.4))
}

/** 组合名称：按已有名称递增，避免重名 */
export function nextPresetName(list: FurniturePreset[]): string {
  let max = 0
  for (const p of list) {
    const m = /^组合\s*(\d+)$/.exec(p.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `组合 ${String(max + 1).padStart(2, '0')}`
}

/** 深拷贝，避免预设与场景对象共享引用 */
export function clonePreset(preset: FurniturePreset): FurniturePreset {
  return JSON.parse(JSON.stringify(preset)) as FurniturePreset
}

function readItem(raw: unknown): PresetItem | null {
  if (!raw || typeof raw !== 'object') return null
  const it = raw as Record<string, unknown>
  const kind = it.kind
  if (typeof kind !== 'string' || !isFurnitureKind(kind as InfraKind)) return null
  const nums = ['x', 'z', 'rotation', 'width', 'depth', 'height'] as const
  const values: Record<string, number> = {}
  for (const key of nums) {
    const v = Number(it[key])
    if (!Number.isFinite(v)) return null
    values[key] = v
  }
  const material = typeof it.material === 'string' ? it.material : undefined
  // 场景 JSON 里可能带自定义贴图；本地存储写入时会剔除
  const texture =
    typeof it.texture === 'string' && it.texture.startsWith('data:image/')
      ? it.texture
      : undefined
  const dims = clampInfraDims(kind as InfraKind, {
    width: values.width,
    depth: values.depth,
    height: values.height,
  })
  return {
    kind: kind as InfraKind,
    x: values.x,
    z: values.z,
    rotation: values.rotation,
    width: dims.width,
    depth: dims.depth,
    height: dims.height,
    ...(material ? { material } : {}),
    ...(texture ? { texture } : {}),
  }
}

/** 规范化单个预设；结构不合法的返回 null */
function readPreset(raw: unknown, index: number): FurniturePreset | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.items)) return null
  const items = obj.items
    .map(readItem)
    .filter((it): it is PresetItem => it !== null)
  if (items.length < 2) return null
  const width = Number(obj.width)
  const depth = Number(obj.depth)
  return {
    id:
      typeof obj.id === 'string' && obj.id
        ? obj.id
        : `preset-${index}-${Date.now().toString(36)}`,
    name:
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name.trim().slice(0, 24)
        : `组合 ${String(index + 1).padStart(2, '0')}`,
    items: items.slice(0, PRESET_MAX_ITEMS),
    width: Number.isFinite(width) && width > 0 ? width : 1,
    depth: Number.isFinite(depth) && depth > 0 ? depth : 1,
    createdAt: Number.isFinite(Number(obj.createdAt))
      ? Number(obj.createdAt)
      : Date.now(),
  }
}

/** 读取本地保存的家具预设；结构不合法的条目直接丢弃 */
export function loadStoredPresets(): FurniturePreset[] {
  if (typeof window === 'undefined') return []
  try {
    const text = window.localStorage.getItem(STORAGE_KEY)
    if (!text) return []
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []
    const list: FurniturePreset[] = []
    for (const raw of parsed) {
      const preset = readPreset(raw, list.length)
      if (preset) list.push(preset)
    }
    return list.slice(0, PRESET_LIMIT)
  } catch {
    return []
  }
}

/**
 * 解析导入的家具预设：
 * 兼容预设数组或带 presets 字段的对象；无效条目会跳过。
 */
export function parseFurniturePresets(input: unknown): FurniturePreset[] | null {
  const source = Array.isArray(input)
    ? input
    : input &&
        typeof input === 'object' &&
        Array.isArray((input as { presets?: unknown }).presets)
      ? ((input as { presets: unknown[] }).presets)
      : null
  if (!source) return null

  const list: FurniturePreset[] = []
  const used = new Set<string>()
  for (const raw of source) {
    const preset = readPreset(raw, list.length)
    if (!preset) continue
    if (used.has(preset.id)) {
      preset.id = `preset-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`
    }
    used.add(preset.id)
    list.push(preset)
    if (list.length >= PRESET_LIMIT) break
  }
  return list.length ? list : null
}

/** 写入本地；自定义贴图过大，落盘前统一丢弃 */
export function storePresets(list: FurniturePreset[]): boolean {
  if (typeof window === 'undefined') return false
  try {
    const payload = list.slice(0, PRESET_LIMIT).map((p) => ({
      ...p,
      items: p.items.map(({ texture: _texture, ...rest }) => rest),
    }))
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}


