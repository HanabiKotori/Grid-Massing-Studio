import { watch, type Ref, type ShallowRef } from 'vue'
import type { Stage, WalkState } from '../core/Stage'
import type { Booth, BoothKind, EditorMode, Infra, Pt, Underlay, Venue } from '../core/types'
import type { BoothPasteClipboard } from './useBoothEditing'
import { kindOfPlaceMode } from './useInfraEditing'

interface StageSyncOptions {
  venue: ShallowRef<Venue | null>
  booths: ShallowRef<Booth[]>
  infras: ShallowRef<Infra[]>
  selectedIds: ShallowRef<string[]>
  selectedInfraIds: ShallowRef<string[]>
  draftPoints: ShallowRef<Pt[]>
  draftHeight: Ref<number>
  mode: Ref<EditorMode>
  boothKind: Ref<BoothKind>
  walkState: Ref<WalkState>
  walkPose: Ref<{ x: number; z: number; yaw: number } | null>
  minimapExpanded: Ref<boolean>
  underlay: ShallowRef<Underlay | null>
  venueXray: Ref<boolean>
  gridWanted: Ref<boolean>
  gridOn: Ref<boolean>
  pendingInfraCopy: Ref<Infra | null>
  getStage: () => Stage | null
  getPasteClipboard: () => BoothPasteClipboard | null
  applyVenueXray: () => void
  applyLiveWeatherForVenue: () => Promise<void> | void
  clampHeight: (v: number) => number
}

export function useStageSync(options: StageSyncOptions) {
  let walkPoseTimer = 0

  function syncPreview() {
    const stage = options.getStage()
    if (!stage) return
    const m = options.mode.value
    if (m === 'height-venue' || m === 'height-booth') {
      stage.setPreview(
        options.draftPoints.value,
        options.clampHeight(options.draftHeight.value),
        m === 'height-venue' ? 'venue' : 'booth',
        options.boothKind.value,
        true,
      )
    } else {
      stage.setPreview(null)
    }
  }

  function syncMode() {
    const stage = options.getStage()
    if (!stage) return
    const m = options.mode.value
    const placeKind = kindOfPlaceMode(m)
    if (!placeKind && m !== 'paste-booths') {
      options.pendingInfraCopy.value = null
    }
    if (!placeKind) stage.stopInfraPlace()
    if (m !== 'idle' && options.walkState.value !== 'off') stage.stopWalk()
    if (m === 'paste-booths') {
      const clip = options.getPasteClipboard()
      if (!clip) {
        options.mode.value = 'idle'
        return
      }
      stage.setMode('draw')
      stage.startBoothPaste(clip)
    } else if (placeKind) {
      stage.setMode('draw')
      stage.startInfraPlace(
        placeKind,
        options.pendingInfraCopy.value?.kind === placeKind
          ? options.pendingInfraCopy.value
          : undefined,
      )
    } else if (m === 'draw-venue' || m === 'draw-booth') {
      stage.setMode('draw')
    } else if (m === 'height-venue' || m === 'height-booth') {
      stage.setMode('confirm')
    } else {
      stage.setMode('idle')
    }
    // 绘制场馆 / 展台时左键拖拽直接拉矩形；其他模式恢复左键旋转视角
    stage.setRectDrawEnabled(m === 'draw-venue' || m === 'draw-booth')
    // 绘制展台时自动半透明；浏览时由用户开关决定
    options.applyVenueXray()
    syncPreview()
  }

  watch(
    [options.venue, options.booths, options.infras],
    ([v, b, i], [pv, pb, pi]) => {
      const venueChanged = v !== pv
      const boothsChanged = b !== pb
      const infrasChanged = i !== pi
      const changedCount =
        Number(venueChanged) + Number(boothsChanged) + Number(infrasChanged)
      const stage = options.getStage()
      if (changedCount > 1) stage?.setScene(v, b, i)
      else if (venueChanged) stage?.setVenue(v)
      else if (boothsChanged) stage?.setBooths(b)
      else if (infrasChanged) stage?.setInfras(i)
    },
  )

  // 首次生成 / 载入场馆后自动应用实时天气；高度调整不重复覆盖
  watch(options.venue, (next, prev) => {
    if (next && !prev) void options.applyLiveWeatherForVenue()
  })

  watch(options.walkState, (state) => {
    window.clearInterval(walkPoseTimer)
    if (state === 'walk') {
      const tick = () => {
        options.walkPose.value = options.getStage()?.getWalkPose() ?? null
      }
      tick()
      walkPoseTimer = window.setInterval(tick, 100)
    } else {
      options.walkPose.value = null
      options.minimapExpanded.value = false
    }
  })

  watch(options.selectedInfraIds, (ids) => {
    options.getStage()?.setSelectedInfras(ids)
  })
  watch(options.draftPoints, (v) => options.getStage()?.setDraft(v))
  watch(options.selectedIds, (ids) => options.getStage()?.setSelected(ids))
  watch(options.mode, syncMode)
  watch(options.draftHeight, syncPreview)
  watch(options.underlay, (u) => options.getStage()?.setUnderlay(u))
  watch(options.venueXray, () => options.applyVenueXray())
  watch(options.gridWanted, (on) => {
    options.gridOn.value = on
    options.getStage()?.setGridVisible(on)
  })

  function dispose() {
    window.clearInterval(walkPoseTimer)
  }

  return { syncPreview, syncMode, dispose }
}
