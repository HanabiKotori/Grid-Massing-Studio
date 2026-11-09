/** 平面坐标点（单位：米），x 为东西向，z 为南北向 */
export interface Pt {
  x: number
  z: number
}

/** 场馆体量 */
export interface Venue {
  points: Pt[]
  height: number
  /** 是否封闭顶部（默认敞开，便于查看内部） */
  ceiling?: boolean
}

/** 底图：铺在场馆地面上的参考图片，随场景保存 */
export interface Underlay {
  /** 图片 data URL（jpg / png） */
  image: string
  /** 原始文件名，仅用于界面显示 */
  name: string
  /** 中心点（米） */
  x: number
  z: number
  /** 世界尺寸（米），宽高比与图片一致；不限制最大尺寸，位置也不受网格限制 */
  width: number
  height: number
  /** 不透明度 0–1 */
  opacity: number
  /** 是否显示 */
  visible: boolean
  /** 锁定后禁用 Ctrl + 拖动 / Ctrl + 滚轮，避免误操作 */
  locked?: boolean
}

/** 展台标记分组颜色 */
export type BoothMark = 'red' | 'yellow' | 'gray'

/** 展台模型类型：标准白膜 / 脚手架 / 光地 */
export type BoothKind = 'massing' | 'scaffold' | 'openfloor'

/** 展台体量 */
export interface Booth {
  id: string
  name: string
  /** 展商名称：可选，随场景保存并显示在模型标签与汇报图中 */
  exhibitor?: string
  points: Pt[]
  height: number
  /** 模型类型，缺省为标准白膜 */
  kind?: BoothKind
  /** 脚手架展台是否带顶棚（默认 true） */
  canopy?: boolean
  /** 标准展台去掉顶部（同时去掉立柱，仅保留下部围挡） */
  noTop?: boolean
  /** 合并组：仅用于模型合并与着色，结构数据仍各自独立 */
  groupId?: string
  /** 展台正面 Logo（PNG base64，不含 data URL 前缀） */
  logo?: string
  /** 扩展数据：用于存储外部 id 等业务字段，随 JSON 原样导入导出 */
  data?: Record<string, unknown>
  /** 标记分组颜色 */
  mark?: BoothMark
  /** 兼容旧数据：true 等价于红色标记 */
  marked?: boolean
}

/** 出入口开启方式：侧开 / 对开 / 上卷（底部向上收进门楣） */
export type GateOpenMode = 'side' | 'double' | 'up'

/** 基础设施类型：半截楼梯 / 洗手间 / 展馆出入口 / 窗户 / 电梯间 / 墙面 / 家具 */
export type InfraKind =
  | 'stairs'
  | 'restroom'
  | 'gate'
  | 'window'
  | 'elevator'
  | 'wall'
  | 'chair'
  | 'armchair'
  | 'sofa'
  | 'table-round'
  | 'table-square'

/** 基础设施体块：位置为局部原点在地面中心，rotation 为绕 Y 轴弧度 */
export interface Infra {
  id: string
  kind: InfraKind
  name: string
  x: number
  z: number
  /** 局部 +X 的世界朝向（绕 Y 轴弧度，0 时宽度沿 X、进深沿 Z） */
  rotation: number
  /** 局部 X 尺寸（米） */
  width: number
  /** 局部 Z 尺寸（米） */
  depth: number
  /** 高度（米） */
  height: number
  /** 离地高度（仅 window），默认 1 m */
  sill?: number
  /** 电梯数量（仅 elevator） */
  count?: number
  /** 是否打开（仅 gate） */
  open?: boolean
  /** 开启方式（仅 gate），默认对开 */
  openMode?: GateOpenMode
}

export type EditorMode =
  | 'idle'
  | 'draw-venue'
  | 'height-venue'
  | 'draw-booth'
  | 'height-booth'
  | 'paste-booths'
  | 'place-stairs'
  | 'place-restroom'
  | 'place-gate'
  | 'place-window'
  | 'place-elevator'
  | 'place-wall'
  | 'place-chair'
  | 'place-armchair'
  | 'place-sofa'
  | 'place-table-round'
  | 'place-table-square'
