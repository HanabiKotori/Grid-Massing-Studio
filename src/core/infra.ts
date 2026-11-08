import type { InfraKind } from './types'

export interface InfraDims {
  width: number
  depth: number
  height: number
}

export const INFRA_LABELS: Record<InfraKind, string> = {
  stairs: '楼梯',
  restroom: '洗手间',
  gate: '出入口',
  elevator: '电梯间',
  wall: '墙面',
  chair: '圆座椅',
  armchair: '扶手椅',
  sofa: '沙发',
  'table-round': '圆茶几',
  'table-square': '方茶几',
}

/** 放置时的默认尺寸（米） */
export const INFRA_DEFAULTS: Record<InfraKind, InfraDims> = {
  stairs: { width: 2, depth: 4, height: 3 },
  restroom: { width: 2, depth: 2, height: 3 },
  gate: { width: 3, depth: 0.5, height: 3 },
  elevator: { width: 4, depth: 3, height: 3 },
  wall: { width: 6, depth: 0.2, height: 4 },
  chair: { width: 0.6, depth: 0.6, height: 0.5 },
  armchair: { width: 1, depth: 1, height: 1 },
  sofa: { width: 2, depth: 1, height: 1.2 },
  'table-round': { width: 1, depth: 1, height: 1 },
  'table-square': { width: 1, depth: 1, height: 0.5 },
}

/** 可调尺寸范围：[最小, 最大]，宽深高均以 1m 为基本单位 */
export const INFRA_LIMITS: Record<
  InfraKind,
  { width: [number, number]; depth: [number, number]; height: [number, number] }
> = {
  stairs: { width: [1, 8], depth: [2, 12], height: [1, 8] },
  restroom: { width: [1, 8], depth: [1, 8], height: [2, 6] },
  gate: { width: [1, 12], depth: [0.3, 0.8], height: [1, 8] },
  elevator: { width: [2, 12], depth: [2, 8], height: [2, 8] },
  wall: { width: [1, 24], depth: [0.1, 0.5], height: [1, 8] },
  chair: { width: [0.6, 0.6], depth: [0.6, 0.6], height: [0.5, 0.5] },
  armchair: { width: [1, 1], depth: [1, 1], height: [1, 1] },
  sofa: { width: [1, 6], depth: [0.6, 2], height: [1.2, 1.2] },
  'table-round': { width: [0.6, 3], depth: [0.6, 3], height: [1, 1] },
  'table-square': { width: [0.6, 3], depth: [0.6, 3], height: [0.5, 0.5] },
}

/** 电梯数量范围与默认值 */
export const ELEVATOR_COUNT: [number, number] = [1, 6]
export const ELEVATOR_DEFAULT_COUNT = 2

const FURNITURE_KINDS = new Set<InfraKind>([
  'chair',
  'armchair',
  'sofa',
  'table-round',
  'table-square',
])

/** 家具类设施：只能摆放在展台内部，高度固定 */
export function isFurnitureKind(kind: InfraKind): boolean {
  return FURNITURE_KINDS.has(kind)
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

/** 出入口高度受场馆净高约束；深度固定为跨墙厚度 */
export function clampInfraDims(
  kind: InfraKind,
  dims: InfraDims,
  venueHeight?: number,
): InfraDims {
  const lim = INFRA_LIMITS[kind]
  const maxH =
    kind === 'gate' && venueHeight
      ? Math.min(lim.height[1], Math.max(lim.height[0], venueHeight - 0.15))
      : lim.height[1]

  // 家具高度由类型固定，长宽可调
  if (isFurnitureKind(kind)) {
    return {
      width: clamp(dims.width, lim.width[0], lim.width[1]),
      depth: clamp(dims.depth, lim.depth[0], lim.depth[1]),
      height: INFRA_DEFAULTS[kind].height,
    }
  }

  return {
    width: clamp(dims.width, lim.width[0], lim.width[1]),
    depth:
      kind === 'gate'
        ? INFRA_DEFAULTS.gate.depth
        : kind === 'wall'
          ? INFRA_DEFAULTS.wall.depth
          : clamp(dims.depth, lim.depth[0], lim.depth[1]),
    height: clamp(dims.height, lim.height[0], maxH),
  }
}
