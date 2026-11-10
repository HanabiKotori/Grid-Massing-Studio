import * as THREE from 'three'
import type { WeatherKind } from './weather'

/** 各天气的云层浓度：只给少云 / 多云绘制云朵 */
const CLOUD_OPACITY: Partial<Record<WeatherKind, number>> = {
  partly: 0.55,
  cloudy: 1,
}

/** 云层所在高度（米） */
const CLOUD_HEIGHT = 100
/** 云层平面尺寸（米） */
const CLOUD_PLANE_SIZE = 4000
/** 云层平铺次数：值越大云团越细碎 */
const CLOUD_REPEAT = 5

const DAY_COLOR = new THREE.Color(0xffffff)
const NIGHT_COLOR = new THREE.Color(0x66748c)

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 程序化云层贴图：二维云团，平铺时不出现接缝。
 * 贴图只保留白色云团和透明背景，最终由平面材质着色。
 */
function makeCloudTexture(): THREE.CanvasTexture {
  const width = 1024
  const height = 1024
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(CLOUD_REPEAT, CLOUD_REPEAT)
  texture.anisotropy = 4
  if (!ctx) return texture

  const random = mulberry32(0x9e3779b9)

  const puff = (x: number, y: number, rx: number, ry: number, alpha: number) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(rx, ry)
    const grad = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 1)
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`)
    grad.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.72})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // 云团分布在整个平面；四周复制到邻接区域，保证平铺接缝连续
  for (let i = 0; i < 300; i++) {
    const cx = random() * width
    const cy = random() * height
    const size = 24 + random() * 46
    const parts = 5 + Math.floor(random() * 5)
    for (let j = 0; j < parts; j++) {
      const px = cx + (random() - 0.5) * size * 2.8
      const py = cy + (random() - 0.5) * size * 0.8
      const rx = size * (0.45 + random() * 0.6)
      const ry = size * (0.25 + random() * 0.35)
      const alpha = 0.3 + random() * 0.5
      for (const dx of [-width, 0, width]) {
        for (const dy of [-height, 0, height]) {
          puff(px + dx, py + dy, rx, ry, alpha)
        }
      }
    }
  }

  // 强制左右 / 上下边缘一致，平铺时不会出现十字接缝
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  for (let y = 0; y < height; y++) {
    const left = y * width * 4
    const right = (y * width + width - 1) * 4
    data[right] = data[left]
    data[right + 1] = data[left + 1]
    data[right + 2] = data[left + 2]
    data[right + 3] = data[left + 3]
  }
  for (let x = 0; x < width; x++) {
    const top = x * 4
    const bottom = ((height - 1) * width + x) * 4
    data[bottom] = data[top]
    data[bottom + 1] = data[top + 1]
    data[bottom + 2] = data[top + 2]
    data[bottom + 3] = data[top + 3]
  }
  ctx.putImageData(image, 0, 0)

  texture.needsUpdate = true
  return texture
}

/** 云层平面边缘径向淡出，避免看到 4000 m 平面的直边 */
function makeCloudFadeTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  if (!ctx) return texture
  const c = size / 2
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.4, '#ffffff')
  grad.addColorStop(0.5, '#000000')
  grad.addColorStop(1, '#000000')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  texture.needsUpdate = true
  return texture
}

/** 天空云层：在固定高度铺一层水平云海，少云 / 多云时显示并缓慢漂移 */
export class SkyClouds {
  readonly group = new THREE.Group()

  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly material: THREE.MeshBasicMaterial
  private readonly fadeTexture: THREE.CanvasTexture
  private target = 0
  private opacity = 0

  constructor() {
    const texture = makeCloudTexture()
    this.fadeTexture = makeCloudFadeTexture()
    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      alphaMap: this.fadeTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: false,
    })

    const geo = new THREE.PlaneGeometry(CLOUD_PLANE_SIZE, CLOUD_PLANE_SIZE)
    geo.rotateX(-Math.PI / 2)
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.position.y = CLOUD_HEIGHT
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -200
    this.mesh.visible = false
    this.group.add(this.mesh)
  }

  setWeather(kind: WeatherKind) {
    this.target = CLOUD_OPACITY[kind] ?? 0
  }

  update(dt: number, daylight: number, cameraY: number) {
    const day = clamp01(daylight)
    // 云层缓慢漂移：只滚动贴图偏移，平面本身保持固定高度
    const map = this.material.map
    if (map) {
      map.offset.x += dt * 0.0018
      map.offset.y += dt * 0.0007
    }

    const target = this.target * (0.3 + 0.7 * day)
    this.opacity += (target - this.opacity) * Math.min(1, dt * 2.2)
    if (this.opacity < 0.004 && target < 0.004) {
      this.opacity = 0
      this.material.opacity = 0
      this.mesh.visible = false
      return
    }
    // 相机高于云层时从上方看不到云层，同时避免云层平面遮挡场馆
    this.mesh.visible = cameraY < CLOUD_HEIGHT - 4
    this.material.opacity = this.opacity
    this.material.color.copy(NIGHT_COLOR).lerp(DAY_COLOR, day)
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.map?.dispose()
    this.fadeTexture.dispose()
    this.material.dispose()
  }
}
