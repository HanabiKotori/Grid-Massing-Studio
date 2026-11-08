import type { Booth, BoothKind } from './types'

/** 展台类型名称 */
export const BOOTH_KIND_LABELS: Record<BoothKind, string> = {
  massing: '标准',
  scaffold: '脚手架',
  openfloor: '光地',
}

/** 光地展台平台高度（米）：仅微微凸起于地面 */
export const OPEN_FLOOR_HEIGHT = 0.15

/** 新建展台时的默认高度 */
export const BOOTH_DEFAULT_HEIGHT: Record<BoothKind, number> = {
  massing: 2,
  scaffold: 4,
  openfloor: OPEN_FLOOR_HEIGHT,
}

export function boothKindOf(b: Booth): BoothKind {
  return b.kind ?? 'massing'
}

export function isOpenFloor(b: Booth): boolean {
  return boothKindOf(b) === 'openfloor'
}
