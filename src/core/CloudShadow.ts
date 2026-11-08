import * as THREE from 'three'
import { WEATHER_PRESETS, type WeatherKind } from './weather'

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** 各天气预设对应的程序化云量，用于云影浓度和阳光摆动幅度 */
const CLOUD_COVER: Record<WeatherKind, number> = {
  clear: 0,
  partly: 0.3,
  cloudy: 0.66,
  overcast: 0.92,
  haze: 0.4,
  fog: 0.5,
  'light-rain': 0.72,
  'heavy-rain': 0.92,
  thunder: 1,
  'light-snow': 0.62,
  'heavy-snow': 0.9,
  dust: 0.35,
  wind: 0.55,
}

/**
 * 程序化云影层：不创建真实云体，只用一张缓慢漂移的透明阴影贴图铺在地面，
 * 同时把同一条云层漂移相位用于太阳主光的明暗变化。
 */
export class CloudShadow {
  readonly group = new THREE.Group()

  private readonly texture: THREE.CanvasTexture
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private targetCover = 0
  private cover = 0
  private wind = 0
  private phase = 0
  private daylight = 1
  private opacity = 0

  constructor() {
    this.texture = this.makeTexture()
    this.texture.wrapS = THREE.RepeatWrapping
    this.texture.wrapT = THREE.RepeatWrapping
    this.texture.repeat.set(6, 6)

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: 0x0d1116,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const geometry = new THREE.PlaneGeometry(3000, 3000)
    geometry.rotateX(-Math.PI / 2)
    this.mesh = new THREE.Mesh(geometry, material)
    // 略高于场馆地坪，保证无顶棚时云影也能落在地面上
    this.mesh.position.y = 0.2
    this.mesh.renderOrder = 1
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.group.add(this.mesh)
  }

  setWeather(kind: WeatherKind) {
    this.targetCover = CLOUD_COVER[kind] ?? 0
    this.wind = WEATHER_PRESETS[kind].wind
  }

  update(dt: number, daylight: number, indoor: boolean) {
    this.daylight = clamp01(daylight)

    if (this.targetCover <= 0.001 && this.cover <= 0.001) {
      if (this.mesh.visible) {
        this.opacity = 0
        this.mesh.material.opacity = 0
        this.mesh.visible = false
      }
      return
    }

    // 云影沿风向缓慢漂移，纹理无缝循环
    const speed = 0.012 + this.wind * 0.02
    this.texture.offset.x = (this.texture.offset.x + dt * speed) % 1
    this.texture.offset.y = (this.texture.offset.y + dt * speed * 0.34) % 1

    // 云量平滑过渡，切换天气时不会突然出现或消失
    const blend = Math.min(1, dt * 0.85)
    this.cover += (this.targetCover - this.cover) * blend
    this.phase += dt * (0.55 + this.wind * 0.8)

    const targetOpacity = this.cover * this.daylight * (indoor ? 0 : 1) * 0.48
    this.opacity += (targetOpacity - this.opacity) * Math.min(1, dt * 1.6)
    this.mesh.material.opacity = this.opacity
    this.mesh.visible = this.opacity > 0.002
  }

  /** 云量越高，主光的明暗摆动越明显 */
  get lightFactor(): number {
    if (this.cover <= 0.001 || this.daylight <= 0.001) return 1
    const wave =
      0.5 +
      0.5 *
        (0.55 * Math.sin(this.phase * 0.9 + 1.3) +
          0.32 * Math.sin(this.phase * 2.1 + 0.2) +
          0.13 * Math.sin(this.phase * 3.9))
    return 1 + this.cover * this.daylight * 0.26 * (0.5 - wave)
  }

  dispose() {
    this.texture.dispose()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }

  private makeTexture(): THREE.CanvasTexture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return new THREE.CanvasTexture(canvas)

    // 可平铺的 fBm 值噪声，只保留高值区域作为云影，避免整张纹理均匀变黑
    const hash = (x: number, y: number): number => {
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
      h = Math.imul(h ^ (h >>> 13), 1274126177)
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295
    }
    const wrap = (v: number, period: number) => ((v % period) + period) % period
    const smooth = (t: number) => t * t * (3 - 2 * t)
    const valueNoise = (x: number, y: number, period: number): number => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const xf = smooth(x - xi)
      const yf = smooth(y - yi)
      const x0 = wrap(xi, period)
      const x1 = wrap(xi + 1, period)
      const y0 = wrap(yi, period)
      const y1 = wrap(yi + 1, period)
      const a = hash(x0, y0)
      const b = hash(x1, y0)
      const c = hash(x0, y1)
      const d = hash(x1, y1)
      const top = a + (b - a) * xf
      const bottom = c + (d - c) * xf
      return top + (bottom - top) * yf
    }
    const fbm = (x: number, y: number): number => {
      let value = 0
      let amplitude = 0.5
      let frequency = 4
      for (let octave = 0; octave < 4; octave++) {
        value += valueNoise(x * frequency, y * frequency, frequency) * amplitude
        amplitude *= 0.5
        frequency *= 2
      }
      return value / 0.9375
    }

    const image = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x / size, y / size)
        const shaped = Math.max(0, Math.min(1, (n - 0.4) / 0.25))
        const alpha = Math.round(Math.pow(shaped, 1.2) * 245)
        const i = (y * size + x) * 4
        image.data[i] = 0
        image.data[i + 1] = 0
        image.data[i + 2] = 0
        image.data[i + 3] = alpha
      }
    }
    ctx.putImageData(image, 0, 0)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
  }
}
