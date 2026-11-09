import type { Ref, ShallowRef } from 'vue'
import type { QualityLevel, Stage, WalkState, WalkView } from '../core/Stage'
import type { EditorMode, Venue } from '../core/types'

type ToolMenu = 'view' | 'display' | 'quality' | 'data'
export type HelpQuickAction =
  | 'fit'
  | 'grid'
  | 'labels'
  | 'areas'
  | 'weather'
  | 'walk'

const QUALITY_LABELS: Record<QualityLevel, string> = {
  ultra: '极致',
  high: '高',
  medium: '中',
  low: '低',
}

function currentSunProgress(): number {
  const now = new Date()
  const seconds =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  return seconds / 86400
}

interface EditorUiOptions {
  venue: ShallowRef<Venue | null>
  mode: Ref<EditorMode>
  selectedIds: ShallowRef<string[]>
  mobilePanelOpen: Ref<boolean>
  walkState: Ref<WalkState>
  walkView: Ref<WalkView>
  isMobile: Ref<boolean>
  isPortrait: Ref<boolean>
  showRotateHint: Ref<boolean>
  toolsCollapsed: Ref<boolean>
  toolMenu: Ref<ToolMenu | null>
  toolSubMenu: Ref<'names' | null>
  showHelp: Ref<boolean>
  showWeather: Ref<boolean>
  presentationOn: Ref<boolean>
  gridOn: Ref<boolean>
  dimOn: Ref<boolean>
  areaOn: Ref<boolean>
  boothLabelsOn: Ref<boolean>
  infraLabelsOn: Ref<boolean>
  quality: Ref<QualityLevel>
  sunPlaying: Ref<boolean>
  sunProgress: Ref<number>
  venueXray: Ref<boolean>
  venueNoTop: Ref<boolean>
  getStage: () => Stage | null
  toast: (text: string) => void
}

export function useEditorUi(options: EditorUiOptions) {
  let rotatePending = false

  async function requestWalkFullscreen() {
    if (!options.isMobile.value) return
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      }
      const orientation = window.screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>
      }
      if (orientation?.lock) await orientation.lock('landscape')
    } catch {
      /* 浏览器不支持全屏 / 方向锁定时静默降级 */
    }
  }

  async function exitWalkFullscreen() {
    if (!options.isMobile.value) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      /* ignore */
    }
  }

  function viewTop() {
    options.getStage()?.viewTop()
  }

  function viewIso() {
    options.getStage()?.viewIso()
  }

  function fitView() {
    if (options.venue.value) {
      options
        .getStage()
        ?.fit(options.venue.value.points, options.venue.value.height)
    } else {
      options.getStage()?.fit()
    }
  }

  function toggleToolMenu(menu: ToolMenu) {
    options.toolMenu.value =
      options.toolMenu.value === menu ? null : menu
    options.toolSubMenu.value = null
  }

  function toggleToolbarCollapse() {
    options.toolsCollapsed.value = !options.toolsCollapsed.value
    options.toolMenu.value = null
    options.toolSubMenu.value = null
  }

  function enterPresentation() {
    if (!options.venue.value) {
      options.toast('请先绘制场馆')
      return
    }
    options.toolMenu.value = null
    options.showWeather.value = false
    options.showHelp.value = false
    if (options.walkState.value !== 'off') options.getStage()?.stopWalk()
    options.presentationOn.value = true
    options.getStage()?.startPresentation()
  }

  function exitPresentation() {
    if (!options.presentationOn.value) return
    options.presentationOn.value = false
    options.getStage()?.stopPresentation()
  }

  function openHelp() {
    options.toolMenu.value = null
    options.showWeather.value = false
    options.showHelp.value = true
  }

  function runHelpQuickAction(action: HelpQuickAction) {
    options.showHelp.value = false
    if (action === 'fit') {
      fitView()
      return
    }
    if (action === 'grid') {
      toggleGrid()
      return
    }
    if (action === 'labels') {
      toggleLabels()
      return
    }
    if (action === 'areas') {
      toggleAreas()
      return
    }
    if (action === 'weather') {
      openWeather()
      return
    }
    if (action === 'walk') {
      if (!options.venue.value) {
        options.toast('请先绘制场馆')
        return
      }
      toggleWalk()
    }
  }

  function openWeather() {
    options.toolMenu.value = null
    if (
      options.walkState.value === 'walk' &&
      !options.showWeather.value
    ) {
      options.getStage()?.suspendWalkForUi()
    }
    options.showWeather.value = true
  }

  function closeWeather() {
    options.showWeather.value = false
    if (options.walkState.value === 'walk') {
      options.getStage()?.resumeWalkFromUi()
    }
  }

  function toggleBoothLabels() {
    options.boothLabelsOn.value = !options.boothLabelsOn.value
    options
      .getStage()
      ?.setBoothLabelsVisible(options.boothLabelsOn.value)
  }

  function toggleInfraLabels() {
    options.infraLabelsOn.value = !options.infraLabelsOn.value
    options
      .getStage()
      ?.setInfraLabelsVisible(options.infraLabelsOn.value)
  }

  /** 帮助快捷入口同时控制两类名称 */
  function toggleLabels() {
    const on = !(
      options.boothLabelsOn.value && options.infraLabelsOn.value
    )
    options.boothLabelsOn.value = on
    options.infraLabelsOn.value = on
    options.getStage()?.setBoothLabelsVisible(on)
    options.getStage()?.setInfraLabelsVisible(on)
  }

  function toggleNameSubmenu() {
    if (options.toolMenu.value !== 'display') return
    options.toolSubMenu.value =
      options.toolSubMenu.value === 'names' ? null : 'names'
  }

  function toggleAreas() {
    options.areaOn.value = !options.areaOn.value
    options.getStage()?.setBoothAreasVisible(options.areaOn.value)
  }

  function toggleGrid() {
    options.gridOn.value = !options.gridOn.value
    options.getStage()?.setGridVisible(options.gridOn.value)
  }

  function toggleDimensions() {
    options.dimOn.value = !options.dimOn.value
    options.getStage()?.setDimensionsVisible(options.dimOn.value)
  }

  function toggleSunPlay() {
    options.sunPlaying.value = !options.sunPlaying.value
    options.getStage()?.setSunPaused(!options.sunPlaying.value)
  }

  /** 一键把模拟时间平滑拉回当前真实时间；保持播放 / 暂停状态 */
  function resetSunToNow() {
    const p = currentSunProgress()
    const stage = options.getStage()
    if (stage) {
      stage.transitionSunTo(p, 900)
    } else {
      options.sunProgress.value = p
    }
    options.toast('已回到当前时间')
  }

  function chooseQuality(level: QualityLevel) {
    options.quality.value = level
    options.getStage()?.setQuality(level)
    options.toast(`画质已切换为${QUALITY_LABELS[level]}`)
  }

  function onSunScrub(e: Event) {
    const minutes = Number((e.target as HTMLInputElement).value)
    if (!Number.isFinite(minutes)) return
    const progress = minutes / 1440
    options.sunProgress.value = progress
    options.getStage()?.setSunProgress(progress)
  }

  function startWalkPick() {
    if (!options.venue.value) {
      options.toast('请先绘制场馆')
      return
    }
    options.selectedIds.value = []
    options.mobilePanelOpen.value = false
    options.getStage()?.startWalkPick()
  }

  function toggleWalkView() {
    options.getStage()?.toggleWalkView()
  }

  /** 第一人称漫游：移动端竖屏先提示旋转，横屏后再选点 */
  function toggleWalk() {
    if (options.walkState.value !== 'off') {
      options.getStage()?.stopWalk()
      return
    }
    if (!options.venue.value) {
      options.toast('请先绘制场馆')
      return
    }
    if (options.mode.value !== 'idle') {
      options.toast('请先完成当前编辑')
      return
    }
    if (options.isMobile.value) void requestWalkFullscreen()
    if (options.isMobile.value && options.isPortrait.value) {
      rotatePending = true
      options.showRotateHint.value = true
      return
    }
    startWalkPick()
  }

  function onOrientationChange() {
    options.isPortrait.value = window.innerHeight > window.innerWidth
    if (!options.isPortrait.value && options.showRotateHint.value) {
      options.showRotateHint.value = false
      if (rotatePending) {
        rotatePending = false
        startWalkPick()
        options.toast('已横屏，点击地面选择起点')
      }
    } else if (
      options.isPortrait.value &&
      options.walkState.value === 'walk'
    ) {
      options.showRotateHint.value = true
    }
  }

  function cancelRotateHint() {
    rotatePending = false
    options.showRotateHint.value = false
    if (options.walkState.value !== 'off') options.getStage()?.stopWalk()
    else void exitWalkFullscreen()
  }

  function applyVenueXray() {
    const stage = options.getStage()
    if (!stage) return
    const boothMode =
      options.mode.value === 'draw-booth' ||
      options.mode.value === 'height-booth'
    stage.setVenueXray(options.venueXray.value || boothMode)
  }

  function toggleVenueXray() {
    options.venueXray.value = !options.venueXray.value
    applyVenueXray()
  }

  function toggleVenueTop() {
    options.venueNoTop.value = !options.venueNoTop.value
    if (options.venue.value) {
      options.venue.value = {
        ...options.venue.value,
        ceiling: !options.venueNoTop.value,
      }
    }
  }

  return {
    viewTop,
    viewIso,
    fitView,
    toggleToolMenu,
    toggleToolbarCollapse,
    enterPresentation,
    exitPresentation,
    openHelp,
    runHelpQuickAction,
    openWeather,
    closeWeather,
    toggleBoothLabels,
    toggleInfraLabels,
    toggleLabels,
    toggleNameSubmenu,
    toggleAreas,
    toggleGrid,
    toggleDimensions,
    toggleSunPlay,
    resetSunToNow,
    chooseQuality,
    onSunScrub,
    startWalkPick,
    toggleWalkView,
    toggleWalk,
    onOrientationChange,
    cancelRotateHint,
    exitWalkFullscreen,
    applyVenueXray,
    toggleVenueXray,
    toggleVenueTop,
    requestWalkFullscreen,
  }
}
