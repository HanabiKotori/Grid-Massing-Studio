import { computed, nextTick, ref, watch, type Ref, type ShallowRef } from 'vue'
import type { Booth, Infra, Venue } from '../core/types'

export interface SceneSnapshot {
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
}

export interface SceneChangeSet {
  venue: boolean
  booths: boolean
  infras: boolean
}

interface SceneHistoryOptions {
  venue: ShallowRef<Venue | null>
  booths: ShallowRef<Booth[]>
  infras: ShallowRef<Infra[]>
  renderOnly: Ref<boolean>
  /** 恢复快照时同步重置选中、模式、草稿等 UI 状态 */
  applyScene: (snapshot: SceneSnapshot, changed: SceneChangeSet) => void
  /** 连续修改的合并延迟 */
  mergeDelay?: number
  maxSteps?: number
}

function sameVenue(a: Venue | null, b: Venue | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.height !== b.height || !!a.ceiling !== !!b.ceiling) return false
  if (a.points.length !== b.points.length) return false
  return a.points.every((p, i) => p.x === b.points[i].x && p.z === b.points[i].z)
}

function sameBooths(a: Booth[], b: Booth[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.exhibitor !== y.exhibitor ||
      x.height !== y.height ||
      x.kind !== y.kind ||
      x.canopy !== y.canopy ||
      x.noTop !== y.noTop ||
      x.groupId !== y.groupId ||
      x.mark !== y.mark ||
      x.marked !== y.marked ||
      x.logo !== y.logo ||
      x.data !== y.data
    ) {
      return false
    }
    return (
      x.points.length === y.points.length &&
      x.points.every((p, j) => p.x === y.points[j].x && p.z === y.points[j].z)
    )
  })
}

function sameInfras(a: Infra[], b: Infra[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    return (
      x.id === y.id &&
      x.kind === y.kind &&
      x.name === y.name &&
      x.x === y.x &&
      x.z === y.z &&
      x.rotation === y.rotation &&
      x.width === y.width &&
      x.depth === y.depth &&
      x.height === y.height &&
      (x.sill ?? 0) === (y.sill ?? 0) &&
      (x.open ?? false) === (y.open ?? false) &&
      (x.openMode ?? 'double') === (y.openMode ?? 'double') &&
      (x.count ?? 0) === (y.count ?? 0)
    )
  })
}

export function useSceneHistory(options: SceneHistoryOptions) {
  const undoStack = ref<SceneSnapshot[]>([])
  const redoStack = ref<SceneSnapshot[]>([])
  const pendingChange = ref(false)
  let mergeTimer = 0
  let applying = false
  const mergeDelay = options.mergeDelay ?? 260
  const maxSteps = options.maxSteps ?? 60

  const canUndo = computed(
    () =>
      !options.renderOnly.value &&
      (undoStack.value.length > 1 || pendingChange.value),
  )
  const canRedo = computed(
    () => !options.renderOnly.value && redoStack.value.length > 0,
  )

  function snapshotScene(): SceneSnapshot {
    return {
      venue: options.venue.value
        ? {
            ...options.venue.value,
            points: options.venue.value.points.map((p) => ({ x: p.x, z: p.z })),
          }
        : null,
      booths: options.booths.value.map((b) => ({
        ...b,
        points: b.points.map((p) => ({ x: p.x, z: p.z })),
      })),
      infras: options.infras.value.map((it) => ({ ...it })),
    }
  }

  function commitHistory() {
    if (!pendingChange.value) return
    pendingChange.value = false
    undoStack.value.push(snapshotScene())
    if (undoStack.value.length > maxSteps) undoStack.value.shift()
    redoStack.value = []
  }

  function restore(snapshot: SceneSnapshot) {
    const changed: SceneChangeSet = {
      venue: !sameVenue(options.venue.value, snapshot.venue),
      booths: !sameBooths(options.booths.value, snapshot.booths),
      infras: !sameInfras(options.infras.value, snapshot.infras),
    }
    applying = true
    options.applyScene(snapshot, changed)
    void nextTick(() => {
      applying = false
    })
  }

  function undo() {
    if (options.renderOnly.value) return
    window.clearTimeout(mergeTimer)

    if (pendingChange.value) {
      pendingChange.value = false
      redoStack.value.push(snapshotScene())
      restore(undoStack.value[undoStack.value.length - 1] ?? snapshotScene())
      return
    }

    if (undoStack.value.length <= 1) return
    const current = undoStack.value.pop()!
    redoStack.value.push(current)
    restore(undoStack.value[undoStack.value.length - 1])
  }

  function redo() {
    if (options.renderOnly.value) return
    window.clearTimeout(mergeTimer)
    if (pendingChange.value) commitHistory()
    if (!redoStack.value.length) return
    const next = redoStack.value.pop()!
    undoStack.value.push(next)
    restore(next)
  }

  function dispose() {
    window.clearTimeout(mergeTimer)
  }

  watch([options.venue, options.booths, options.infras], () => {
    if (applying) return
    pendingChange.value = true
    window.clearTimeout(mergeTimer)
    mergeTimer = window.setTimeout(commitHistory, mergeDelay)
  })

  undoStack.value = [snapshotScene()]

  return { canUndo, canRedo, undo, redo, dispose }
}
