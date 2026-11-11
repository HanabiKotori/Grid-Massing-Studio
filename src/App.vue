<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ActionDock from './components/ActionDock.vue'
import AppToolbar from './components/AppToolbar.vue'
import HelpMobilePanel from './components/HelpMobilePanel.vue'
import HelpPanel from './components/HelpPanel.vue'
import Inspector from './components/Inspector.vue'
import SceneStatus from './components/SceneStatus.vue'
import WalkMinimap from './components/WalkMinimap.vue'
import WalkOverlay from './components/WalkOverlay.vue'
import WeatherPanel from './components/WeatherPanel.vue'
import {
  insetPolygon,
  pointInPolygon,
  polygonArea,
} from './core/polygon'
import { Stage } from './core/Stage'
import { saveStoredProject } from './core/projectStore'
import sampleSceneJson from './data/sample-scene.json'
import { exportBoothList, type SceneJson } from './core/sceneFile'
import {
  useSceneHistory,
  type SceneChangeSet,
  type SceneSnapshot,
} from './composables/useSceneHistory'
import type { WeatherKind } from './core/weather'
import { useWeather } from './composables/useWeather'
import { useEditorShortcuts } from './composables/useEditorShortcuts'
import { useScenePersistence } from './composables/useScenePersistence'
import { useStageSync } from './composables/useStageSync'
import { useUnderlay } from './composables/useUnderlay'
import { useInfraEditing } from './composables/useInfraEditing'
import { useBoothEditing } from './composables/useBoothEditing'
import { useSceneOperations } from './composables/useSceneOperations'
import { useEditorUi } from './composables/useEditorUi'
import {
  QUALITY_LABELS,
  useEditorState,
} from './composables/useEditorState'
import type { Pt } from './core/types'

const {
  hostEl,
  venue,
  venueName,
  editingVenueName,
  booths,
  infras,
  selectedInfraId,
  selectedInfraIds,
  skipRevealBoothId,
  skipRevealInfraId,
  addFocusSection,
  addFocusToken,
  mode,
  draftPoints,
  draftHeight,
  boothKind,
  selectedIds,
  gridOn,
  dimOn,
  underlay,
  northDeg,
  sunProgress,
  sunPlaying,
  quality,
  venueXray,
  boothLabelsOn,
  infraLabelsOn,
  areaOn,
  venueNoTop,
  toastMsg,
  showHelp,
  showWeather,
  toolMenu,
  toolSubMenu,
  hover,
  rotateDeg,
  walkState,
  walkView,
  walkAuto,
  walkAutoSpeed,
  walkAutoLoop,
  walkTourInfo,
  walkUiHidden,
  presentationOn,
  walkPose,
  minimapExpanded,
  walkInteract,
  spaceNavActive,
  isMobile,
  mobilePanelOpen,
  toolsCollapsed,
  isPortrait,
  showRotateHint,
  renderOnly,
  appBooting,
  dockExpanded,
  qualityLabel,
  simTime,
  sunMinutes,
  sunPercent,
  sunIsDay,
  labelsOn,
  mobileDocked,
  venueArea,
  boothsArea,
  coverage,
  showWelcome,
  draftArea,
  isDrawing,
  isPlacing,
  rotateDisplay,
  rotateSnapped,
  gridWanted,
  segmentLength,
  focusAdd,
  toast,
  handleStageHover,
  dispose: disposeEditorState,
} = useEditorState()

const {
  weather,
  weatherOn,
  liveWeatherOn,
  liveWeather,
  particleDensities,
  weatherVisibility,
  setParticleDensity,
  setWeatherVisibility,
  previewParticleWeather,
  toggleWeatherEnabled,
  chooseWeather,
  toggleLiveWeather,
  applyLiveWeatherForVenue,
  setSuppressAutoWeather,
} = useWeather({
  getStage: () => stage,
  isMobile: () => isMobile.value,
  isRestoring: () => restoringProject.value,
  toast,
  onChoose: () => {
    showWeather.value = false
    if (walkState.value === 'walk') stage?.resumeWalkFromUi()
  },
})

const LENS_WEATHER = new Set<WeatherKind>([
  'haze',
  'fog',
  'light-rain',
  'heavy-rain',
  'thunder',
  'light-snow',
  'heavy-snow',
  'dust',
])
const weatherLensOn = computed(
  () =>
    walkState.value === 'walk' &&
    walkView.value === 'first' &&
    !venue.value?.ceiling &&
    LENS_WEATHER.has(weather.value),
)
const importInput = ref<HTMLInputElement | null>(null)
watch(mobileDocked, (on) => {
  if (!on) dockExpanded.value = false
})

let stage: Stage | null = null

let seq = 0
let infraSeq = 0
const restoringProject = ref(false)

function beginVenueRename() {
  editingVenueName.value = true
}

function finishVenueRename() {
  if (!editingVenueName.value) return
  venueName.value = venueName.value.trim() || '场馆白膜'
  editingVenueName.value = false
}

function cancelVenueRename() {
  venueName.value = venueName.value.trim() || '场馆白膜'
  editingVenueName.value = false
}

function resetSequences(boothCount: number, infraCount: number) {
  seq = Math.max(boothCount, 1)
  infraSeq = Math.max(infraCount, 1)
}

const {
  setInfraSelection,
  clearInfraSelection,
  handlePick,
  hasGroupInSelection,
  selectionIsOneGroup,
  mergeDialog,
  overlaps,
  cleanupFurniture,
  nextGroupId,
  deleteVenue,
  deleteBooth,
  deleteSelectedBooths,
  changeVenueHeight,
  changeBoothHeight,
  changeBoothKind,
  setBoothCanopy,
  setBoothNoTop,
  setBoothMark,
  resizeBooth,
  rotateSelected,
  mergeSelected,
  applyMerge,
  unmergeSelected,
  moveBooth,
  rotateBooth,
} = useSceneOperations({
  venue,
  booths,
  infras,
  selectedIds,
  selectedInfraIds,
  selectedInfraId,
  skipRevealBoothId,
  skipRevealInfraId,
  mode,
  draftPoints,
  venueNoTop,
  toast,
  venueInner,
})

const {
  buildSceneJson,
  downloadScene,
  onImportFile,
  importSceneJson,
  applySceneJson,
  scheduleAutosave,
  restoreStoredProject,
  dispose: disposeScenePersistence,
} = useScenePersistence({
  venue,
  venueName,
  booths,
  infras,
  underlay,
  weather,
  weatherOn,
  sunProgress,
  liveWeatherOn,
  liveWeather,
  venueNoTop,
  selectedIds,
  draftPoints,
  mode,
  renderOnly,
  restoringProject,
  appBooting,
  clearInfraSelection,
  setSuppressAutoWeather,
  toast,
  getStage: () => stage,
  resetSequences,
})

function clampHeight(v: number): number {
  if (!Number.isFinite(v)) return 6
  const isVenue = mode.value === 'height-venue'
  return Math.round(Math.min(isVenue ? 24 : 8, Math.max(isVenue ? 2 : 1, v)))
}

/** 场馆内部可用区域（扣掉墙厚与安全距离） */
function venueInner(pad = 0.4): Pt[] | null {
  if (!venue.value) return null
  return insetPolygon(venue.value.points, pad) ?? venue.value.points
}

function insideVenueArea(p: Pt): boolean {
  const inner = venueInner()
  if (!inner) return false
  return pointInPolygon(p, inner)
}

const {
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
  toggleNameSubmenu,
  toggleAreas,
  toggleGrid,
  toggleDimensions,
  toggleSunPlay,
  resetSunToNow,
  chooseQuality,
  onSunScrub,
  toggleWalk,
  onOrientationChange,
  cancelRotateHint,
  exitWalkFullscreen,
  applyVenueXray,
  toggleVenueXray,
  toggleVenueTop,
} = useEditorUi({
  venue,
  mode,
  selectedIds,
  mobilePanelOpen,
  walkState,
  walkView,
  isMobile,
  isPortrait,
  showRotateHint,
  toolsCollapsed,
  toolMenu,
  toolSubMenu,
  showHelp,
  showWeather,
  presentationOn,
  gridOn,
  dimOn,
  areaOn,
  boothLabelsOn,
  infraLabelsOn,
  quality,
  sunPlaying,
  sunProgress,
  venueXray,
  venueNoTop,
  getStage: () => stage,
  toast,
})

// ---------- 基础设施 ----------

const {
  pendingInfraCopy,
  beginInfraPlace,
  handlePlaceInfra,
  selectInfra,
  renameInfra,
  deleteInfra,
  updateInfraDims,
  moveInfra,
  moveInfraGroup,
  rotateInfra,
  toggleGate,
  setGateOpenMode,
  changeInfraCount,
  cancelInfraPlacement,
} = useInfraEditing({
  infras,
  booths,
  venue,
  mode,
  draftPoints,
  selectedIds,
  selectedInfraIds,
  selectedInfraId,
  skipRevealInfraId,
  setInfraSelection,
  clearInfraSelection,
  focusAdd,
  toast,
  nextInfraSeq: () => {
    infraSeq += 1
    return infraSeq
  },
})

function selectInfraFromPanel(id: string) {
  selectInfra(id)
  stage?.focusInfra(id)
}

function selectBoothFromPanel(id: string, additive = false) {
  handlePick(id, additive, 'booth')
  stage?.focusBooth(id)
}

const {
  getPasteClipboard,
  startVenueDraw,
  startBoothDraw,
  handlePlace,
  handleDrawRect,
  undoPoint,
  cancelDraft,
  closeDraft,
  backToDraw,
  copySelectedBooths,
  copySelectedInfra,
  cancelBoothPaste,
  placePastedBooths,
  confirmHeight,
} = useBoothEditing({
  venue,
  booths,
  infras,
  mode,
  draftPoints,
  draftHeight,
  boothKind,
  venueNoTop,
  selectedIds,
  selectedInfraId,
  skipRevealBoothId,
  pendingInfraCopy,
  renderOnly,
  clearInfraSelection,
  clearHover: () => {
    hover.value = null
  },
  focusAdd,
  toast,
  getStage: () => stage,
  applyLiveWeatherForVenue,
  venueInner,
  insideVenueArea,
  clampHeight,
  overlaps,
  cleanupFurniture,
  nextGroupId,
  nextBoothSeq: () => {
    seq += 1
    return seq
  },
  nextInfraSeq: () => {
    infraSeq += 1
    return infraSeq
  },
})

// ---------- 撤销 / 重做 ----------

function applyHistoryScene(snap: SceneSnapshot, changed: SceneChangeSet) {
  if (changed.venue) {
    venue.value = snap.venue
      ? {
          ...snap.venue,
          points: snap.venue.points.map((p) => ({ x: p.x, z: p.z })),
        }
      : null
  }
  if (changed.booths) {
    booths.value = snap.booths.map((b) => ({
      ...b,
      points: b.points.map((p) => ({ x: p.x, z: p.z })),
    }))
  }
  if (changed.infras) {
    infras.value = snap.infras.map((it) => ({ ...it }))
  }
  venueNoTop.value = snap.venue ? !snap.venue.ceiling : venueNoTop.value
  selectedIds.value = []
  clearInfraSelection()
  mode.value = 'idle'
  draftPoints.value = []
}

const {
  canUndo,
  canRedo,
  undo,
  redo,
  dispose: disposeHistory,
} = useSceneHistory({
  venue,
  booths,
  infras,
  renderOnly,
  applyScene: applyHistoryScene,
})

// IndexedDB 自动保存：名称、场景、底图、天气和太阳时间一起保留
watch(
  [venue, booths, infras, underlay, venueName, weather, weatherOn, sunProgress],
  () => scheduleAutosave(),
)

// ---------- JSON 导入 / 导出 ----------

async function downloadReportImage() {
  if (!venue.value) {
    toast('请先绘制场馆')
    return
  }
  const dataUrl = await stage?.captureReportImage({
    title: venueName.value.trim() || '场馆白膜',
    subtitle: `${polygonArea(venue.value.points).toFixed(1)} m² · ${booths.value.length} 个展台 · ${infras.value.length} 个设施`,
    stats: [
      { label: '场馆面积', value: `${polygonArea(venue.value.points).toFixed(1)} m²` },
      { label: '展台覆盖率', value: `${coverage.value}%` },
      { label: '展台', value: `${booths.value.length}` },
    ],
  })
  if (!dataUrl) {
    toast('汇报图生成失败，请稍后重试')
    return
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  toast('高质量俯视汇报图已生成')
}

function triggerImport() {
  if (renderOnly.value) return
  importInput.value?.click()
}

// ---------- 纯渲染模式 ----------

function setRenderOnly(on: boolean) {
  renderOnly.value = on
  if (on) {
    if (mode.value !== 'idle') mode.value = 'idle'
    selectedIds.value = []
    clearInfraSelection()
    draftPoints.value = []
    if (walkState.value !== 'off') stage?.stopWalk()
  }
  stage?.setReadOnly(on)
}

/** 对外暴露的场景 API */
const gridMassingApi = {
  exportBooths: () => exportBoothList(booths.value),
  exportScene: () => buildSceneJson(),
  importScene: (input: string | SceneJson) =>
    typeof input === 'string' ? importSceneJson(input) : applySceneJson(input),
  setRenderMode: (on: boolean) => setRenderOnly(on),
}

// ---------- 底图 ----------

const {
  addUnderlay,
  toggleUnderlay,
  toggleUnderlayLock,
  setUnderlayOpacity,
  centerUnderlay,
  removeUnderlay,
  applyUnderlayChange,
} = useUnderlay({
  underlay,
  renderOnly,
  toast,
})

// ---------- 场景操作 ----------

function renameBooth(id: string, name: string) {
  const b = booths.value.find((x) => x.id === id)
  if (!b || b.name === name) return
  booths.value = booths.value.map((x) => (x.id === id ? { ...x, name } : x))
  toast(`已重命名为「${name}」`)
}

function setBoothExhibitor(id: string, value: string) {
  const b = booths.value.find((x) => x.id === id)
  if (!b) return
  const exhibitor = value.trim().slice(0, 60)
  if ((b.exhibitor ?? '') === exhibitor) return
  booths.value = booths.value.map((x) =>
    x.id === id ? { ...x, exhibitor: exhibitor || undefined } : x,
  )
  toast(exhibitor ? `展商名称：${exhibitor}` : '已清除展商名称')
}

function setBoothLogo(id: string, logo: string) {
  if (logo.length > 8_000_000) {
    toast('Logo 图片过大，请压缩后再试')
    return
  }
  booths.value = booths.value.map((b) => (b.id === id ? { ...b, logo } : b))
  toast('展台 Logo 已更新')
}

function removeBoothLogo(id: string) {
  booths.value = booths.value.map((b) => (b.id === id ? { ...b, logo: undefined } : b))
  toast('已移除展台 Logo')
}

// 移动端点击模型后自动弹出结构抽屉，并滚动到对应属性
watch([selectedIds, selectedInfraId], () => {
  if (!isMobile.value || renderOnly.value || walkState.value !== 'off') return
  mobilePanelOpen.value = selectedIds.value.length > 0 || !!selectedInfraId.value
})

function onDraftHeight(v: number) {
  draftHeight.value = clampHeight(v)
}

/** 载入内置示例：使用当前 IndexedDB 导出的 W1 场景 */
function loadSample() {
  if (renderOnly.value) return
  if (!applySceneJson(sampleSceneJson)) return

  selectedIds.value = []
  clearInfraSelection()
  mode.value = 'idle'
  draftPoints.value = []
  boothLabelsOn.value = false
  infraLabelsOn.value = false
  stage?.setLabelsVisible(false)
  toast(`W1 示例场景已载入 · ${booths.value.length} 个展台 / ${infras.value.length} 个设施`)
}

// ---------- 同步与生命周期 ----------

const { dispose: disposeStageSync } = useStageSync({
  venue,
  booths,
  infras,
  selectedIds,
  selectedInfraIds,
  draftPoints,
  draftHeight,
  mode,
  boothKind,
  walkState,
  walkPose,
  minimapExpanded,
  underlay,
  venueXray,
  gridWanted,
  gridOn,
  pendingInfraCopy,
  getStage: () => stage,
  getPasteClipboard,
  applyVenueXray,
  applyLiveWeatherForVenue,
  clampHeight,
})

function toggleHelpShortcut() {
  toolMenu.value = null
  if (showWeather.value) closeWeather()
  showHelp.value = !showHelp.value
}

function closeHelpShortcut() {
  showHelp.value = false
}

function hasToolMenu() {
  return toolMenu.value !== null
}

function closeToolMenu() {
  toolMenu.value = null
}

function hasMergeDialog() {
  return mergeDialog.value !== null
}

function closeMergeDialog() {
  mergeDialog.value = null
}

/** 多人漫游在新页面运行；先落盘当前场景，避免跳转丢失最新编辑 */
async function openMultiplayer() {
  if (!venue.value) {
    toast('请先创建场馆')
    return
  }
  try {
    await saveStoredProject({
      version: 1,
      savedAt: Date.now(),
      scene: buildSceneJson(),
    })
    window.location.assign(new URL('multiplayer.html', window.location.href).href)
  } catch (err) {
    console.error(err)
    toast('进入多人漫游失败：无法保存当前场景')
  }
}

const { onKey } = useEditorShortcuts({
  presentationOn,
  showHelp,
  showWeather,
  walkState,
  renderOnly,
  underlay,
  mode,
  isPlacing,
  selectedIds,
  selectedInfraId,
  toast,
  exitPresentation,
  closeWeather,
  openWeather,
  toggleHelp: toggleHelpShortcut,
  closeHelp: closeHelpShortcut,
  hasToolMenu,
  closeToolMenu,
  toggleWalk,
  toggleUnderlayLock,
  viewTop,
  viewIso,
  fitView,
  enterPresentation,
  hasMergeDialog,
  closeMergeDialog,
  cancelBoothPaste,
  cancelInfraPlacement,
  cancelDraft,
  backToDraw,
  confirmHeight,
  closeDraft,
  copySelectedBooths,
  copySelectedInfra,
  undoPoint,
  undo,
  redo,
  deleteSelectedBooths,
  deleteInfra,
  toggleGrid,
  openMultiplayer,
})

onMounted(() => {
  if (!hostEl.value) return
  stage = new Stage(hostEl.value, {
    onPlace: handlePlace,
    onDrawRect: handleDrawRect,
    onUnderlayChange: applyUnderlayChange,
    onCloseDraft: closeDraft,
    onPick: handlePick,
    onHover: handleStageHover,
    onMoveBooth: moveBooth,
    onRotateBooth: rotateBooth,
    onRotateInfra: (id, dir) => rotateInfra(id, dir),
    onRotateDrag: (deg) => (rotateDeg.value = deg),
    onSpaceNav: (on) => (spaceNavActive.value = on),
    onWalkView: (v) => (walkView.value = v),
    onWalkAuto: (on) => {
      walkAuto.value = on
      if (!on) {
        walkTourInfo.value = null
        walkUiHidden.value = false
      }
    },
    onWalkAutoFail: () =>
      toast('自动巡游：未找到可通行路线，请先在场馆内留出通道'),
    onWalkTourInfo: (info) => (walkTourInfo.value = info),
    onWalkUiHidden: (hidden) => (walkUiHidden.value = hidden),
    onWalkAutoSpeed: (v) => (walkAutoSpeed.value = Math.round(v * 10) / 10),
    onWalkAutoLoop: (v) => (walkAutoLoop.value = v),
    onWeatherShortcut: () => openWeather(),
    onHelp: () => openHelp(),
    onWalkState: (s) => {
      walkState.value = s
      if (s !== 'off') {
        mobilePanelOpen.value = false
        toolMenu.value = null
      }
      if (s === 'off') {
        walkAuto.value = false
        walkTourInfo.value = null
        walkUiHidden.value = false
        toolsCollapsed.value = false
        if (isMobile.value) void exitWalkFullscreen()
      }
      if (isMobile.value && s === 'walk') {
        toolsCollapsed.value = false
        if (isPortrait.value) showRotateHint.value = true
      }
    },
    onWalkInteract: (target) => (walkInteract.value = target),
    onMinimapHold: (on) => (minimapExpanded.value = on),
    onToggleGate: (id) => toggleGate(id),
    onPlaceInfra: (kind, spot) => handlePlaceInfra(kind, spot),
    onPlacePaste: (center) => placePastedBooths(center),
    onMoveInfra: (id, x, z, rotation) => moveInfra(id, x, z, rotation),
    onMoveInfras: (targets) => moveInfraGroup(targets),
    onNorthAngle: (deg) => (northDeg.value = Math.round(deg * 10) / 10),
    onSunTime: (p) => (sunProgress.value = p),
    onQualityChange: (level, auto) => {
      quality.value = level
      if (auto) {
        toast(`帧率较低，已自动切换为${QUALITY_LABELS[level]}画质`)
      }
    },
  })
  stage.setMode('idle')
  stage.setWalkAutoSpeed(walkAutoSpeed.value)
  stage.setWalkAutoLoop(walkAutoLoop.value)
  stage.setSunProgress(sunProgress.value)
  stage.setWeather(weather.value)
  stage.setParticleDensities(particleDensities.value)
  stage.setWeatherVisibility(weatherVisibility.value / 100)
  stage.setGridVisible(gridOn.value)
  stage.setUnderlay(underlay.value)
  stage.setBoothLabelsVisible(boothLabelsOn.value)
  stage.setInfraLabelsVisible(infraLabelsOn.value)
  stage.setBoothAreasVisible(areaOn.value)
  stage.setDimensionsVisible(dimOn.value)
  stage.setReadOnly(renderOnly.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onOrientationChange)
  window.addEventListener('orientationchange', onOrientationChange)
  void restoreStoredProject()

  // 对外 API：导出展台 list / 场景，导入场景，切换纯渲染模式
  ;(window as unknown as { gridMassing?: typeof gridMassingApi }).gridMassing = gridMassingApi
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__stage = stage
    w.__app = {
      venue,
      booths,
      infras,
      selectedIds,
      selectedInfraId,
      mode,
      venueXray,
      venueNoTop,
      areaOn,
    }
  }
})

function toggleWalkAuto() {
  stage?.toggleWalkAuto()
}

function changeWalkAutoSpeed(value: number) {
  const v = Math.min(2, Math.max(0.5, Math.round(value * 10) / 10))
  walkAutoSpeed.value = v
  stage?.setWalkAutoSpeed(v)
}

function changeWalkAutoLoop(value: boolean) {
  walkAutoLoop.value = value
  stage?.setWalkAutoLoop(value)
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onOrientationChange)
  window.removeEventListener('orientationchange', onOrientationChange)
  disposeEditorState()
  disposeHistory()
  disposeScenePersistence()
  disposeStageSync()
  const w = window as unknown as { gridMassing?: typeof gridMassingApi }
  if (w.gridMassing === gridMassingApi) delete w.gridMassing
  stage?.dispose()
  stage = null
})
</script>

<template>
  <div
    class="app"
    :class="{
      'quality-low': quality === 'low',
      'is-mobile': isMobile,
      'is-walking': walkState !== 'off',
      'walk-ui-hidden': walkUiHidden,
      presenting: presentationOn,
      }"
  >
  <div ref="hostEl" class="viewport" />

  <WalkMinimap
    v-if="walkState === 'walk' && !presentationOn"
    :venue="venue"
    :booths="booths"
    :infras="infras"
    :pose="walkPose"
    :mobile="isMobile"
    :expanded="minimapExpanded"
  />

  <button
    v-if="presentationOn"
    type="button"
    class="presentation-exit"
    @click="exitPresentation"
  >
    退出展示 · Esc
  </button>

    <Transition name="weather-fx">
      <div
        v-if="walkState === 'walk' && weather !== 'clear'"
        class="weather-fx"
        :class="[weather, walkView]"
        aria-hidden="true"
      >
        <div class="weather-atmos" />
        <div v-if="weatherLensOn" class="weather-lens" />
        <div v-if="weather === 'thunder'" class="weather-flash" />
      </div>
    </Transition>

    <SceneStatus
      :venue-name="venueName"
      :editing-venue-name="editingVenueName"
      :sim-time="simTime"
      :sun-is-day="sunIsDay"
      :sun-playing="sunPlaying"
      :sun-minutes="sunMinutes"
      :sun-percent="sunPercent"
      :live-weather="liveWeather"
      :weather-on="weatherOn"
      :is-mobile="isMobile"
      :walk-state="walkState"
      :render-only="renderOnly"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :north-deg="northDeg"
      @update:venue-name="venueName = $event"
      @begin-rename="beginVenueRename"
      @finish-rename="finishVenueRename"
      @cancel-rename="cancelVenueRename"
      @toggle-sun="toggleSunPlay"
      @reset-sun="resetSunToNow"
      @sun-scrub="onSunScrub"
      @set-render="setRenderOnly"
      @undo="undo"
      @redo="redo"
    />

    <AppToolbar
      :is-mobile="isMobile"
      :tools-collapsed="toolsCollapsed"
      :tool-menu="toolMenu"
      :tool-sub-menu="toolSubMenu"
      :has-venue="!!venue"
      :render-only="renderOnly"
      :quality="quality"
      :quality-label="qualityLabel"
      :booth-labels-on="boothLabelsOn"
      :infra-labels-on="infraLabelsOn"
      :dim-on="dimOn"
      :area-on="areaOn"
      :grid-on="gridOn"
      :has-underlay="!!underlay"
      :underlay-visible="!!underlay?.visible"
      :weather-active="weatherOn && weather !== 'clear'"
      :walk-active="walkState !== 'off'"
      @toggle-collapse="toggleToolbarCollapse"
      @toggle-menu="toggleToolMenu"
      @toggle-name-submenu="toggleNameSubmenu"
      @toggle-booth-labels="toggleBoothLabels"
      @toggle-infra-labels="toggleInfraLabels"
      @toggle-dimensions="toggleDimensions"
      @toggle-areas="toggleAreas"
      @toggle-grid="toggleGrid"
      @toggle-underlay="toggleUnderlay"
      @view-top="viewTop"
      @view-iso="viewIso"
      @fit-view="fitView"
      @presentation="enterPresentation"
      @choose-quality="chooseQuality"
      @report="downloadReportImage"
      @export="downloadScene"
      @import="triggerImport"
      @open-weather="openWeather"
      @open-help="openHelp"
      @open-multiplayer="openMultiplayer"
      @toggle-walk="toggleWalk"
    />

    <input
      ref="importInput"
      type="file"
      accept="application/json,.json"
      class="hidden-file"
      @change="onImportFile"
    />

    <WalkOverlay
      :walk-state="walkState"
      :walk-view="walkView"
      :walk-interact="walkInteract"
      :is-mobile="isMobile"
      :space-nav-active="spaceNavActive"
      :show-rotate-hint="showRotateHint"
      :walk-auto="walkAuto"
      :walk-auto-speed="walkAutoSpeed"
      :walk-auto-loop="walkAutoLoop"
      :walk-tour-info="walkTourInfo"
      :walk-ui-hidden="walkUiHidden"
      :get-stage="() => stage"
      @toggle-auto="toggleWalkAuto"
      @update:speed="changeWalkAutoSpeed"
      @update:loop="changeWalkAutoLoop"
      @cancel-rotate="cancelRotateHint"
    />

    <div v-if="rotateDeg !== null" class="coord" :class="{ snap: rotateSnapped }">
      <div class="coord-item"><span>旋转</span><b>{{ rotateDisplay }}</b><i>°</i></div>
    </div>

    <div v-if="isDrawing" class="coord">
      <div class="coord-item"><span>X</span><b>{{ hover ? hover.x.toFixed(0) : '—' }}</b><i>m</i></div>
      <div class="coord-item"><span>Z</span><b>{{ hover ? hover.z.toFixed(0) : '—' }}</b><i>m</i></div>
      <div class="sep" />
      <div class="coord-item"><span>边长</span><b>{{ segmentLength ? segmentLength.toFixed(1) : '—' }}</b><i>m</i></div>
    </div>

    <div v-if="gridOn" class="legend"><i />网格 1 格 = 1 米</div>

    <Transition name="panel-slide" :css="!isMobile">
      <div
        v-if="!renderOnly && !showWelcome"
        class="panel-dock"
        :class="{ docked: mobileDocked, expanded: mobileDocked && dockExpanded }"
      >
      <Inspector
        :class="{ 'mobile-open': mobilePanelOpen }"
      :mobile-open="mobilePanelOpen"
      :venue="venue"
      :booths="booths"
      :underlay="underlay"
      :mode="mode"
      :space-nav="spaceNavActive"
      :selected-ids="selectedIds"
      :venue-area="venueArea"
      :booth-area="boothsArea"
      :coverage="coverage"
      :skip-reveal-booth-id="skipRevealBoothId"
      :skip-reveal-infra-id="skipRevealInfraId"
      :focus-add-section="addFocusSection"
      :focus-add-token="addFocusToken"
      @draw-venue="startVenueDraw"
      @draw-booth="startBoothDraw"
      @underlay-file="addUnderlay"
      @center-underlay="centerUnderlay"
      @toggle-underlay-lock="toggleUnderlayLock"
      @remove-underlay="removeUnderlay"
      @underlay-opacity="setUnderlayOpacity"
      @booth-canopy="setBoothCanopy"
      @booth-top="setBoothNoTop"
      @delete-venue="deleteVenue"
      @delete-booth="deleteBooth"
      @select="selectBoothFromPanel"
      @venue-height="changeVenueHeight"
      @booth-height="changeBoothHeight"
      @booth-kind="changeBoothKind"
      @booth-size="resizeBooth"
      @set-mark="setBoothMark"
      :xray="venueXray"
      :no-top="venueNoTop"
      @rename="renameBooth"
      @exhibitor="setBoothExhibitor"
      @logo="setBoothLogo"
      @remove-logo="removeBoothLogo"
      @logo-error="toast"
      @toggle-xray="toggleVenueXray"
      @toggle-top="toggleVenueTop"
      @rotate="rotateSelected"
      @merge="mergeSelected"
      @unmerge="unmergeSelected"
      :grouped="hasGroupInSelection"
      :single-group="selectionIsOneGroup"
      :infras="infras"
      :selected-infra-id="selectedInfraId"
      @add-infra="beginInfraPlace"
      @select-infra="selectInfraFromPanel"
      @clear-infra-selection="clearInfraSelection"
      @delete-infra="deleteInfra"
      @infra-size="updateInfraDims"
      @rotate-infra="rotateInfra"
      @toggle-gate="toggleGate"
      @gate-open-mode="setGateOpenMode"
      @infra-count="changeInfraCount"
      @rename-infra="renameInfra"
      />
      </div>
    </Transition>

    <button
      v-if="mobileDocked && !showWelcome && !appBooting"
      type="button"
      class="dock-toggle"
      :class="{ expanded: dockExpanded }"
      :aria-expanded="dockExpanded"
      :aria-label="dockExpanded ? '收起结构' : '展开结构'"
      :title="dockExpanded ? '收起结构' : '展开结构'"
      @pointerdown.stop
      @click="dockExpanded = !dockExpanded"
    >
      <svg
        v-if="dockExpanded"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
      <svg
        v-else
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>

    <div class="dock-wrap">
      <ActionDock
        v-if="!renderOnly && mode !== 'idle' && !isPlacing"
        :mode="mode"
        :points="draftPoints"
        :height="draftHeight"
        :area="draftArea"
        @undo="undoPoint"
        @cancel="cancelDraft"
        @close="closeDraft"
        @back="backToDraw"
        @confirm="confirmHeight"
        @height="onDraftHeight"
      />
    </div>

    <div v-if="appBooting" class="boot-mask" role="status" aria-live="polite">
      <div class="boot-card">
        <span class="boot-spinner" aria-hidden="true" />
        <div class="boot-copy">
          <b>正在加载场景</b>
          <span>正在读取本地保存的数据…</span>
        </div>
      </div>
    </div>

    <div
      v-if="showWelcome"
      class="welcome"
      :class="{ 'dock-open': mobileDocked && dockExpanded }"
    >
      <h2>用面积图生成场馆白膜</h2>
      <p>在地面网格上依次点击顶点，或按住左键拖拽拉出矩形，输入高度即可生成白膜体量。</p>
      <ol class="steps">
        <li><i>1</i>绘制场馆轮廓（网格 1 格 = 1 米）</li>
        <li><i>2</i>输入净高，生成场馆白膜</li>
        <li><i>3</i>在馆内画出展台并设定高度</li>
      </ol>
      <div class="welcome-actions">
        <button class="btn primary" @click="startVenueDraw">开始绘制</button>
        <button class="btn" @click="loadSample">载入示例</button>
        <button class="btn" @click="showHelp = true">帮助</button>
      </div>
    </div>

    <div v-if="mergeDialog" class="modal-mask" @click.self="mergeDialog = null">
      <div class="modal">
        <h3>展台高度不一致</h3>
        <p>
          所选展台高度分别为
          {{ mergeDialog.heights.map((h) => h.toFixed(2) + ' m').join(' / ') }}。<br />
          可统一为「{{ mergeDialog.targetName }}」的 {{ mergeDialog.targetHeight.toFixed(2) }} m，也可以保留各自高度（模型仍会合并）。
        </p>
        <div class="modal-actions">
          <button class="btn ghost" @click="mergeDialog = null">取消</button>
          <button class="btn" @click="applyMerge(false)">保留各自高度</button>
          <button class="btn primary" @click="applyMerge(true)">
            统一为 {{ mergeDialog.targetHeight.toFixed(2) }} m
          </button>
        </div>
      </div>
    </div>

    <WeatherPanel
      v-if="showWeather"
      :current="weather"
      :enabled="weatherOn"
      :densities="particleDensities"
      :visibility="weatherVisibility"
      :live-enabled="liveWeatherOn"
      @select="chooseWeather"
      @live-toggle="toggleLiveWeather"
      @density="setParticleDensity"
      @visibility="setWeatherVisibility"
      @preview-particle="previewParticleWeather"
      @toggle="toggleWeatherEnabled"
      @close="closeWeather()"
    />

    <HelpMobilePanel v-if="showHelp && isMobile" @close="showHelp = false" />
    <HelpPanel
      v-else-if="showHelp"
      :grid-on="gridOn"
      :labels-on="labelsOn"
      :areas-on="areaOn"
      :can-walk="!!venue && mode === 'idle'"
      @quick="runHelpQuickAction"
      @close="showHelp = false"
    />

    <transition name="toast">
      <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
    </transition>
  </div>
</template>
