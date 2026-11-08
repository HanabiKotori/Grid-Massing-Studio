import * as THREE from 'three'
import {
  DEFAULT_PARTICLE_DENSITIES,
  WEATHER_PRESETS,
  type ParticleDensities,
  type WeatherKind,
  type WeatherPreset,
} from './weather'

const RAIN_MAX = 1100
const SNOW_MAX = 700
const DUST_MAX = 420
const AREA = 58
const TOP = 38

/** 手动天气的轻量粒子系统：雨线、雪花、沙尘和雷电闪光 */
export class WeatherSystem {
  readonly group = new THREE.Group()

  private preset: WeatherPreset = WEATHER_PRESETS.clear
  private densities: ParticleDensities = { ...DEFAULT_PARTICLE_DENSITIES }
  private rainActive = 0
  private snowActive = 0
  private dustActive = 0
  private elapsed = 0
  private nextFlash = 2
  private indoor = false

  private rain: THREE.LineSegments
  private rainPositions = new Float32Array(RAIN_MAX * 6)
  private rainData = new Float32Array(RAIN_MAX * 5)

  private snow: THREE.Points
  private snowPositions = new Float32Array(SNOW_MAX * 3)
  private snowData = new Float32Array(SNOW_MAX * 5)

  private dust: THREE.Points
  private dustPositions = new Float32Array(DUST_MAX * 3)
  private dustData = new Float32Array(DUST_MAX * 5)

  private lightning: THREE.PointLight
  private snowTexture: THREE.CanvasTexture
  private dustTexture: THREE.CanvasTexture

  constructor() {
    this.group.name = 'weather-effects'
    this.group.visible = false

    const rainGeo = new THREE.BufferGeometry()
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3))
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({
        color: 0xa9c2d3,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        fog: true,
      }),
    )
    this.rain.frustumCulled = false
    this.rain.visible = false
    this.group.add(this.rain)

    this.snowTexture = this.dotTexture(0.9)
    const snowGeo = new THREE.BufferGeometry()
    snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowPositions, 3))
    this.snow = new THREE.Points(
      snowGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.38,
        map: this.snowTexture,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        sizeAttenuation: true,
        fog: true,
      }),
    )
    this.snow.frustumCulled = false
    this.snow.visible = false
    this.group.add(this.snow)

    this.dustTexture = this.dotTexture(0.7)
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPositions, 3))
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xd8c29a,
        size: 0.4,
        map: this.dustTexture,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        sizeAttenuation: true,
        fog: true,
      }),
    )
    this.dust.frustumCulled = false
    this.dust.visible = false
    this.group.add(this.dust)

    this.lightning = new THREE.PointLight(0xdfe9ff, 0, 260, 2)
    this.lightning.position.set(0, 30, 0)
    this.group.add(this.lightning)

    for (let i = 0; i < RAIN_MAX; i++) {
      const o = i * 5
      this.rainData[o] = (Math.random() - 0.5) * AREA * 2
      this.rainData[o + 1] = Math.random() * TOP
      this.rainData[o + 2] = (Math.random() - 0.5) * AREA * 2
      this.rainData[o + 3] = 0.45 + Math.random() * 0.9
      this.rainData[o + 4] = 19 + Math.random() * 15
    }

    for (let i = 0; i < SNOW_MAX; i++) {
      const o = i * 5
      this.snowData[o] = (Math.random() - 0.5) * AREA * 2
      this.snowData[o + 1] = Math.random() * TOP
      this.snowData[o + 2] = (Math.random() - 0.5) * AREA * 2
      this.snowData[o + 3] = 1.2 + Math.random() * 2.2
      this.snowData[o + 4] = Math.random() * Math.PI * 2
    }

    for (let i = 0; i < DUST_MAX; i++) {
      const o = i * 5
      this.dustData[o] = (Math.random() - 0.5) * AREA * 2
      this.dustData[o + 1] = 0.3 + Math.random() * 12
      this.dustData[o + 2] = (Math.random() - 0.5) * AREA * 2
      this.dustData[o + 3] = 1 + Math.random() * 2.5
      this.dustData[o + 4] = Math.random() * Math.PI * 2
    }
  }

  setWeather(kind: WeatherKind) {
    this.preset = WEATHER_PRESETS[kind]

    const rainMat = this.rain.material as THREE.LineBasicMaterial
    rainMat.opacity = 0.22 + this.preset.rain * 0.24
    const snowMat = this.snow.material as THREE.PointsMaterial
    snowMat.opacity = 0.34 + this.preset.snow * 0.3
    const dustMat = this.dust.material as THREE.PointsMaterial
    dustMat.opacity = 0.12 + this.preset.dust * 0.2

    this.applyDensities()
    this.lightning.visible = this.preset.lightning
    this.lightning.intensity = 0
    this.nextFlash = 1.5 + Math.random() * 3
    this.group.visible = true
  }

  setDensities(densities: ParticleDensities) {
    this.densities = {
      rain: Math.max(0, Math.min(1, densities.rain)),
      snow: Math.max(0, Math.min(1, densities.snow)),
      dust: Math.max(0, Math.min(1, densities.dust)),
    }
    this.applyDensities()
  }

  private applyDensities() {
    this.rainActive = Math.round(RAIN_MAX * this.preset.rain * this.densities.rain)
    this.snowActive = Math.round(SNOW_MAX * this.preset.snow * this.densities.snow)
    this.dustActive = Math.round(DUST_MAX * this.preset.dust * this.densities.dust)
    this.rain.geometry.setDrawRange(0, this.rainActive * 2)
    this.snow.geometry.setDrawRange(0, this.snowActive)
    this.dust.geometry.setDrawRange(0, this.dustActive)
  }

  update(dt: number, focus: THREE.Vector3, indoors: boolean) {
    this.indoor = indoors

    // 无雨雪沙尘且没有雷电时，整个天气粒子层没有更新意义
    if (
      this.rainActive === 0 &&
      this.snowActive === 0 &&
      this.dustActive === 0 &&
      !this.preset.lightning
    ) {
      this.rain.visible = false
      this.snow.visible = false
      this.dust.visible = false
      this.group.visible = false
      return
    }

    this.group.visible = true
    this.elapsed += dt
    this.group.position.set(focus.x, 0, focus.z)

    const showPrecip = !this.indoor
    this.rain.visible = showPrecip && this.rainActive > 0
    this.snow.visible = showPrecip && this.snowActive > 0
    this.dust.visible = showPrecip && this.dustActive > 0

    if (this.rain.visible) this.updateRain(dt)
    if (this.snow.visible) this.updateSnow(dt)
    if (this.dust.visible) this.updateDust(dt)

    if (this.preset.lightning) {
      this.nextFlash -= dt
      if (this.nextFlash <= 0) {
        this.lightning.intensity = 5 + Math.random() * 5
        this.nextFlash = 1.4 + Math.random() * 4.5
      } else {
        this.lightning.intensity *= Math.exp(-dt * 9)
        if (this.lightning.intensity < 0.02) this.lightning.intensity = 0
      }
    }
  }

  private updateRain(dt: number) {
    const wind = this.preset.wind * 8
    for (let i = 0; i < this.rainActive; i++) {
      const o = i * 5
      let x = this.rainData[o]
      let y = this.rainData[o + 1]
      let z = this.rainData[o + 2]
      const len = this.rainData[o + 3]
      const speed = this.rainData[o + 4]

      y -= speed * dt
      x += wind * dt
      if (y < 0 || Math.abs(x) > AREA) {
        x = (Math.random() - 0.5) * AREA * 2
        y = TOP
        z = (Math.random() - 0.5) * AREA * 2
      }
      this.rainData[o] = x
      this.rainData[o + 1] = y
      this.rainData[o + 2] = z

      const p = i * 6
      this.rainPositions[p] = x
      this.rainPositions[p + 1] = y
      this.rainPositions[p + 2] = z
      this.rainPositions[p + 3] = x + wind * len * 0.035
      this.rainPositions[p + 4] = y - len * 1.7
      this.rainPositions[p + 5] = z
    }
    this.rain.geometry.attributes.position.needsUpdate = true
  }

  private updateSnow(dt: number) {
    const wind = this.preset.wind * 2.2
    for (let i = 0; i < this.snowActive; i++) {
      const o = i * 5
      let x = this.snowData[o]
      let y = this.snowData[o + 1]
      let z = this.snowData[o + 2]
      const speed = this.snowData[o + 3]
      const phase = this.snowData[o + 4]

      y -= speed * dt
      x += (Math.sin(this.elapsed * 0.8 + phase) * 0.35 + wind) * dt
      z += Math.cos(this.elapsed * 0.55 + phase) * 0.18 * dt
      if (y < 0 || Math.abs(x) > AREA) {
        x = (Math.random() - 0.5) * AREA * 2
        y = TOP
        z = (Math.random() - 0.5) * AREA * 2
      }
      this.snowData[o] = x
      this.snowData[o + 1] = y
      this.snowData[o + 2] = z

      const p = i * 3
      this.snowPositions[p] = x
      this.snowPositions[p + 1] = y
      this.snowPositions[p + 2] = z
    }
    this.snow.geometry.attributes.position.needsUpdate = true
  }

  private updateDust(dt: number) {
    const wind = this.preset.wind * 9
    for (let i = 0; i < this.dustActive; i++) {
      const o = i * 5
      let x = this.dustData[o]
      let y = this.dustData[o + 1]
      let z = this.dustData[o + 2]
      const speed = this.dustData[o + 3]
      const phase = this.dustData[o + 4]

      x += (wind + speed) * dt
      z += Math.sin(this.elapsed * 0.7 + phase) * 0.5 * dt
      y += Math.cos(this.elapsed * 0.9 + phase) * 0.22 * dt
      if (x > AREA) {
        x = -AREA
        y = 0.3 + Math.random() * 12
        z = (Math.random() - 0.5) * AREA * 2
      }
      this.dustData[o] = x
      this.dustData[o + 1] = y
      this.dustData[o + 2] = z

      const p = i * 3
      this.dustPositions[p] = x
      this.dustPositions[p + 1] = y
      this.dustPositions[p + 2] = z
    }
    this.dust.geometry.attributes.position.needsUpdate = true
  }

  private dotTexture(softness: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(softness, 'rgba(255,255,255,0.72)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  dispose() {
    this.group.removeFromParent()
    this.rain.geometry.dispose()
    ;(this.rain.material as THREE.Material).dispose()
    this.snow.geometry.dispose()
    ;(this.snow.material as THREE.Material).dispose()
    this.dust.geometry.dispose()
    ;(this.dust.material as THREE.Material).dispose()
    this.snowTexture.dispose()
    this.dustTexture.dispose()
  }
}
