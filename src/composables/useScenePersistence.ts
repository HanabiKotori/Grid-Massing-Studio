import { nextTick, type Ref, type ShallowRef } from 'vue'
import { isFurnitureKind } from '../core/infra'
import { furnitureInsidePolygon } from '../core/infraGeometry'
import { pointInPolygon } from '../core/polygon'
import { loadStoredProject, saveStoredProject } from '../core/projectStore'
import {
  buildSceneFile,
  normalizeUnderlay,
  readBooth,
  readInfra,
  readPoints,
  type SceneJson,
} from '../core/sceneFile'
import type { LiveWeather } from '../core/amapWeather'
import type { Stage } from '../core/Stage'
import type {
  Booth,
  EditorMode,
  Infra,
  Pt,
  Underlay,
  Venue,
} from '../core/types'
import { WEATHER_LABELS, type WeatherKind } from '../core/weather'

interface ScenePersistenceOptions {
  venue: ShallowRef<Venue | null>
  venueName: Ref<string>
  booths: ShallowRef<Booth[]>
  infras: ShallowRef<Infra[]>
  underlay: ShallowRef<Underlay | null>
  weather: Ref<WeatherKind>
  weatherOn: Ref<boolean>
  sunProgress: Ref<number>
  liveWeatherOn: Ref<boolean>
  liveWeather: Ref<LiveWeather | null>
  venueNoTop: Ref<boolean>
  selectedIds: ShallowRef<string[]>
  draftPoints: ShallowRef<Pt[]>
  mode: Ref<EditorMode>
  renderOnly: Ref<boolean>
  restoringProject: Ref<boolean>
  /** 初次加载遮罩：查到本地场景后保持 2 秒再应用，避免欢迎弹窗闪现 */
  appBooting: Ref<boolean>
  clearInfraSelection: () => void
  setSuppressAutoWeather: (on: boolean) => void
  toast: (text: string) => void
  getStage: () => Stage | null
  resetSequences: (booths: number, infras: number) => void
}

/** 查到本地数据后，加载遮罩的最短展示时间 */
const BOOT_RESTORE_DELAY = 2000

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** 只有存在实际场景内容时才进入恢复流程；忽略首次打开自动保存的空场景 */
function hasRestorableScene(scene: unknown): boolean {
  if (!scene || typeof scene !== 'object') return false
  const s = scene as {
    venue?: { points?: unknown }
    booths?: unknown
    infras?: unknown
    underlay?: unknown
  }
  const venuePoints = s.venue?.points
  return (
    (Array.isArray(venuePoints) && venuePoints.length >= 3) ||
    (Array.isArray(s.booths) && s.booths.length > 0) ||
    (Array.isArray(s.infras) && s.infras.length > 0) ||
    !!s.underlay
  )
}

export function useScenePersistence(options: ScenePersistenceOptions) {
  let autosaveTimer = 0
  let autosaveReady = false
  let importedDuringRestore = false

  function buildSceneJson(): SceneJson {
    return buildSceneFile({
      venue: options.venue.value,
      venueName: options.venueName.value,
      weather: options.weather.value,
      weatherOn: options.weatherOn.value,
      sunProgress: options.sunProgress.value,
      booths: options.booths.value,
      infras: options.infras.value,
      underlay: options.underlay.value,
    })
  }

  async function saveProjectNow() {
    if (options.renderOnly.value) return
    try {
      await saveStoredProject({
        version: 1,
        savedAt: Date.now(),
        scene: buildSceneJson(),
      })
    } catch (err) {
      console.warn('自动保存失败', err)
    }
  }

  function scheduleAutosave() {
    if (
      !autosaveReady ||
      options.restoringProject.value ||
      options.renderOnly.value
    ) {
      return
    }
    window.clearTimeout(autosaveTimer)
    autosaveTimer = window.setTimeout(() => void saveProjectNow(), 500)
  }

  async function restoreStoredProject() {
    if (options.renderOnly.value) {
      autosaveReady = true
      options.appBooting.value = false
      return
    }
    try {
      const saved = await loadStoredProject()
      if (
        !saved ||
        importedDuringRestore ||
        !hasRestorableScene(saved.scene)
      ) {
        autosaveReady = true
        options.appBooting.value = false
        return
      }

      // 确认有本地数据后，先让加载遮罩完整展示 2 秒，再恢复场景
      await wait(BOOT_RESTORE_DELAY)
      options.restoringProject.value = true
      let restored = false
      try {
        restored = applySceneJson(saved.scene)
      } finally {
        options.restoringProject.value = false
        autosaveReady = true
        options.appBooting.value = false
      }
      if (restored) options.toast('已恢复上次自动保存的场景')
    } catch (err) {
      autosaveReady = true
      options.appBooting.value = false
      console.warn('读取自动保存失败', err)
    }
  }

  function downloadScene() {
    const blob = new Blob([JSON.stringify(buildSceneJson(), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `grid-massing-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    options.toast('场景 JSON 已导出')
  }

  function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') importSceneJson(reader.result)
    }
    reader.readAsText(file)
  }

  function importSceneJson(text: string): boolean {
    if (options.renderOnly.value) {
      options.toast('只读模式已禁用编辑功能')
      return false
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      options.toast('JSON 解析失败，请检查文件格式')
      return false
    }
    return applySceneJson(parsed)
  }

  function applySceneJson(input: unknown): boolean {
    if (options.renderOnly.value) {
      options.toast('只读模式已禁用编辑功能')
      return false
    }
    if (!input || typeof input !== 'object') {
      options.toast('JSON 格式不正确')
      return false
    }

    const obj = input as Partial<SceneJson>
    if (!options.restoringProject.value) importedDuringRestore = true
    const nextUnderlay = normalizeUnderlay(obj.underlay)

    const nextName =
      typeof obj.venueName === 'string' && obj.venueName.trim()
        ? obj.venueName.trim().slice(0, 24)
        : '场馆白膜'
    const nextWeather =
      typeof obj.weather === 'string' && obj.weather in WEATHER_LABELS
        ? (obj.weather as WeatherKind)
        : null

    let nextVenue: Venue | null = null
    if (obj.venue && typeof obj.venue === 'object') {
      const v = obj.venue as unknown as Record<string, unknown>
      const points = readPoints(v.points)
      const height = Number(v.height)
      if (points && Number.isFinite(height)) {
        nextVenue = {
          points,
          height: Math.min(24, Math.max(2, height)),
          ceiling: !!v.ceiling,
        }
      }
    }

    const nextBooths: Booth[] = []
    const usedBoothIds = new Set<string>()
    const rawBooths = Array.isArray(obj.booths) ? obj.booths : []
    rawBooths.forEach((raw, i) => {
      const b = readBooth(raw, i)
      if (!b) return
      let nextId = b.id
      while (usedBoothIds.has(nextId)) {
        nextId = `imp-${Date.now().toString(36)}-${i}-${usedBoothIds.size}`
      }
      b.id = nextId
      usedBoothIds.add(nextId)
      nextBooths.push(b)
    })

    const nextInfras: Infra[] = []
    const usedInfraIds = new Set<string>()
    const rawInfras = Array.isArray(obj.infras) ? obj.infras : []
    rawInfras.forEach((raw, i) => {
      const it = readInfra(raw, i, nextVenue?.height)
      if (!it) return
      let nextId = it.id
      while (usedInfraIds.has(nextId)) {
        nextId = `imp-inf-${Date.now().toString(36)}-${i}-${usedInfraIds.size}`
      }
      it.id = nextId
      usedInfraIds.add(nextId)
      nextInfras.push(it)
    })

    // 家具必须完整位于某个展台内部，导入时丢弃不合法项
    const validInfras = nextInfras.filter((it) => {
      if (!isFurnitureKind(it.kind)) return true
      const host = nextBooths.find((b) => pointInPolygon(it, b.points))
      return (
        !!host &&
        furnitureInsidePolygon(
          host.points,
          it.x,
          it.z,
          it.width,
          it.depth,
          it.rotation,
        )
      )
    })

    options.venueName.value = nextName
    options.venue.value = nextVenue
    options.venueNoTop.value = nextVenue
      ? !nextVenue.ceiling
      : options.venueNoTop.value
    options.booths.value = nextBooths
    options.infras.value = validInfras
    options.underlay.value = nextUnderlay
    options.selectedIds.value = []
    options.clearInfraSelection()
    options.mode.value = 'idle'
    options.draftPoints.value = []
    options.resetSequences(nextBooths.length, validInfras.length)

    const nextWeatherOn = obj.weatherOn !== false
    if (nextWeather) {
      options.setSuppressAutoWeather(true)
      options.weatherOn.value = nextWeatherOn
      options.weather.value = nextWeatherOn ? nextWeather : 'clear'
      options.liveWeatherOn.value = false
      options.liveWeather.value = null
      options.getStage()?.setWeather(options.weather.value)
      nextTick(() => {
        options.setSuppressAutoWeather(false)
      })
    }
    if (typeof obj.sunProgress === 'number' && Number.isFinite(obj.sunProgress)) {
      options.sunProgress.value = Math.max(0, Math.min(1, obj.sunProgress))
      options.getStage()?.setSunProgress(options.sunProgress.value)
    }

    nextTick(() => {
      if (nextVenue) options.getStage()?.fit(nextVenue.points, nextVenue.height)
      else options.getStage()?.fit()
    })
    if (!options.restoringProject.value) {
      window.setTimeout(() => void saveProjectNow(), 0)
    }
    options.toast(
      `已导入场景 · ${nextBooths.length} 个展台 / ${validInfras.length} 个设施`,
    )
    return true
  }

  function dispose() {
    window.clearTimeout(autosaveTimer)
  }

  return {
    buildSceneJson,
    downloadScene,
    onImportFile,
    importSceneJson,
    applySceneJson,
    scheduleAutosave,
    restoreStoredProject,
    dispose,
  }
}
