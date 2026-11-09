import type { Underlay } from './types'

/** 网格半径（米）：底图小于网格时完整落在 -80 ~ 80 内 */
const GRID_HALF = 80
/** 上传时的初始最长边（米），与网格同大；之后可以继续放大 */
export const UNDERLAY_INITIAL_SIZE = GRID_HALF * 2
/** 底图最长边下限（米），避免缩到不可见 */
export const UNDERLAY_MIN_SIZE = 2
/** 默认不透明度 */
export const UNDERLAY_DEFAULT_OPACITY = 0.68

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

/**
 * 收敛底图数据：
 * - 最长边不小于 2 m，按比例缩放，不改变图片宽高比；不限制最大尺寸；
 * - 位置按 1 m 取整，但不限制在网格内，可以拖出网格；
 * - 不透明度限制在 0–1。
 */
export function clampUnderlaySpec(spec: Underlay): Underlay {
  if (!(spec.width > 0) || !(spec.height > 0)) return spec

  const maxSide = Math.max(spec.width, spec.height)
  const k = maxSide < UNDERLAY_MIN_SIZE ? UNDERLAY_MIN_SIZE / maxSide : 1

  return {
    ...spec,
    x: Math.round(spec.x),
    z: Math.round(spec.z),
    width: spec.width * k,
    height: spec.height * k,
    opacity: clamp01(spec.opacity),
  }
}
