/** 家具 / 基础设施墙面的预设材质与自定义贴图 */

export type MaterialScope = 'furniture' | 'wall'

export interface MaterialPreset {
  id: string
  label: string
  scopes: MaterialScope[]
  /** 相对 public/textures 的路径 */
  texture?: string
  /** 无贴图时的底色 */
  color: string
  roughness: number
  metalness: number
  /** 墙面贴图每多少米重复一次 */
  wallTile?: number
  /** 无贴图时色板显示的底色 */
  swatch: string
}

export const CUSTOM_TEXTURE_MAX_LENGTH = 1_600_000

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: 'fabric-light',
    label: '浅灰布艺',
    scopes: ['furniture'],
    texture: 'furniture/fabric-light-grey.jpg',
    color: '#ffffff',
    roughness: 0.92,
    metalness: 0,
    swatch: '#d8d9d7',
  },
  {
    id: 'fabric-mid',
    label: '中灰布艺',
    scopes: ['furniture', 'wall'],
    texture: 'furniture/fabric-mid-grey.jpg',
    color: '#ffffff',
    roughness: 0.92,
    metalness: 0,
    wallTile: 3,
    swatch: '#a8aaa8',
  },
  {
    id: 'fabric-graphite',
    label: '深灰布艺',
    scopes: ['furniture', 'wall'],
    texture: 'furniture/fabric-graphite.jpg',
    color: '#ffffff',
    roughness: 0.88,
    metalness: 0.02,
    wallTile: 3,
    swatch: '#4a4c4d',
  },
  {
    id: 'metal-satin',
    label: '拉丝金属',
    scopes: ['furniture', 'wall'],
    texture: 'furniture/metal-satin-grey.jpg',
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0.18,
    wallTile: 3.2,
    swatch: '#8e9192',
  },
  {
    id: 'wood-oak',
    label: '浅橡木',
    scopes: ['furniture', 'wall'],
    texture: 'materials/wood-oak.jpg',
    color: '#ffffff',
    roughness: 0.72,
    metalness: 0,
    wallTile: 2.6,
    swatch: '#b88b5d',
  },
  {
    id: 'concrete',
    label: '清水混凝土',
    scopes: ['wall'],
    texture: 'materials/concrete-wall.jpg',
    color: '#ffffff',
    roughness: 0.96,
    metalness: 0,
    wallTile: 3.4,
    swatch: '#9b9a94',
  },
  {
    id: 'plaster-white',
    label: '白色乳胶漆',
    scopes: ['wall'],
    texture: 'materials/plaster-white.jpg',
    color: '#ffffff',
    roughness: 0.94,
    metalness: 0,
    wallTile: 3.6,
    swatch: '#efeee9',
  },
  {
    id: 'white-panel',
    label: '白色饰面',
    scopes: ['furniture', 'wall'],
    color: '#f2f0ea',
    roughness: 0.86,
    metalness: 0,
    swatch: '#f2f0ea',
  },
  {
    id: 'black-panel',
    label: '黑色哑光',
    scopes: ['furniture', 'wall'],
    color: '#2b2d31',
    roughness: 0.82,
    metalness: 0.04,
    swatch: '#2b2d31',
  },
]

const PRESET_BY_ID = new Map(MATERIAL_PRESETS.map((item) => [item.id, item]))

export function materialPresetById(id: string | undefined): MaterialPreset | undefined {
  if (!id) return undefined
  return PRESET_BY_ID.get(id)
}

export function isMaterialPresetId(value: unknown): value is string {
  return typeof value === 'string' && PRESET_BY_ID.has(value)
}

export function materialPresetsFor(scope: MaterialScope): MaterialPreset[] {
  return MATERIAL_PRESETS.filter((item) => item.scopes.includes(scope))
}

/** 预设贴图的公开 URL；BASE_URL 支持子目录部署 */
export function materialTextureUrl(preset: MaterialPreset): string | undefined {
  if (!preset.texture) return undefined
  return `${import.meta.env.BASE_URL}textures/${preset.texture}`
}

export function materialPreviewUrl(preset: MaterialPreset): string | undefined {
  return materialTextureUrl(preset)
}

/** 场景导入 / 多人同步时校验自定义贴图 */
export function normalizeMaterialTexture(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length > CUSTOM_TEXTURE_MAX_LENGTH) return undefined
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(value)) return undefined
  return value
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解析失败'))
    image.src = url
  })
}

/** 把上传图片压成最多 1024px 的 WebP / JPEG，控制场景体积与多人传输大小 */
export async function readMaterialImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件')
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('图片不能超过 8MB')
  }
  const source = await readFileAsDataUrl(file)
  const image = await loadImage(source)
  let maxSide = 1024
  for (let attempt = 0; attempt < 3; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持图片压缩')
    ctx.drawImage(image, 0, 0, width, height)
    const webp = canvas.toDataURL('image/webp', 0.82)
    if (webp.length <= CUSTOM_TEXTURE_MAX_LENGTH) return webp
    const jpeg = canvas.toDataURL('image/jpeg', 0.78)
    if (jpeg.length <= CUSTOM_TEXTURE_MAX_LENGTH) return jpeg
    maxSide = Math.round(maxSide * 0.72)
  }
  throw new Error('图片压缩后仍然过大，请换一张更小的图')
}
