import type { Booth, BoothKind, BoothStyle } from './types'

/** 展台类型名称 */
export const BOOTH_KIND_LABELS: Record<BoothKind, string> = {
  massing: '标准',
  scaffold: '脚手架',
  openfloor: '光地',
}

/** 模型库顺序：双层不在本轮范围 */
export const BOOTH_STYLES: BoothStyle[] = [
  'standard',
  'octanorm',
  'peninsula',
  'island',
  'portal',
  'platform',
  'truss',
  'scaffold',
]

export const BOOTH_STYLE_LABELS: Record<BoothStyle, string> = {
  standard: '标准白膜',
  octanorm: '标摊升级',
  peninsula: '半岛展台',
  island: '岛型展台',
  portal: '门头展台',
  platform: '光地台地',
  truss: '桁架吊顶',
  scaffold: '脚手架',
}

/** 光地展台平台高度（米）：仅微微凸起于地面 */
export const OPEN_FLOOR_HEIGHT = 0.15

/** 新建展台时的默认高度 */
export const BOOTH_DEFAULT_HEIGHT: Record<BoothKind, number> = {
  massing: 2,
  scaffold: 4,
  openfloor: OPEN_FLOOR_HEIGHT,
}

/** 每种模型的推荐高度 */
export const BOOTH_STYLE_DEFAULT_HEIGHT: Record<BoothStyle, number> = {
  standard: 2,
  octanorm: 3,
  peninsula: 2,
  island: 3,
  portal: 4,
  platform: OPEN_FLOOR_HEIGHT,
  truss: 4,
  scaffold: 4,
}

export function boothKindOf(b: Booth): BoothKind {
  return b.kind ?? 'massing'
}

/** 旧数据没有 style 时，按 kind 映射到默认模型 */
export function boothStyleOf(b: Booth): BoothStyle {
  if (b.style && BOOTH_STYLES.includes(b.style)) return b.style
  const kind = boothKindOf(b)
  return kind === 'scaffold' ? 'scaffold' : kind === 'openfloor' ? 'platform' : 'standard'
}

/** 模型对应的渲染家族 */
export function boothKindForStyle(style: BoothStyle): BoothKind {
  if (style === 'scaffold') return 'scaffold'
  if (style === 'platform') return 'openfloor'
  return 'massing'
}

export function isOpenFloor(b: Booth): boolean {
  return boothKindOf(b) === 'openfloor' || boothStyleOf(b) === 'platform'
}
