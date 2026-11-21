import type { SceneJson } from './sceneFile'
import type { ScenePatch } from './shareApi'
import type { Booth, Infra } from './types'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function diffEntities<T extends { id: string }>(
  prev: T[],
  next: T[],
): { upsert: T[]; remove: string[] } | null {
  const before = new Map(prev.map((item) => [item.id, item]))
  const after = new Map(next.map((item) => [item.id, item]))
  const upsert: T[] = []
  const remove: string[] = []

  for (const item of next) {
    const old = before.get(item.id)
    if (!old || !same(old, item)) upsert.push(item)
  }
  for (const id of before.keys()) {
    if (!after.has(id)) remove.push(id)
  }
  if (!upsert.length && !remove.length) return null
  return { upsert, remove }
}

/** 计算两份场景之间的最小补丁；没有变化时返回 null */
export function diffScene(prev: SceneJson, next: SceneJson): ScenePatch | null {
  const patch: ScenePatch = {}

  if (!same(prev.venue, next.venue)) patch.venue = next.venue ?? undefined
  if (!same(prev.underlay, next.underlay)) patch.underlay = next.underlay ?? null
  if (prev.weather !== next.weather) patch.weather = next.weather
  if (prev.weatherOn !== next.weatherOn) patch.weatherOn = next.weatherOn
  if (!same(prev.rules, next.rules)) patch.rules = next.rules

  const booths = diffEntities<Booth>(prev.booths ?? [], next.booths ?? [])
  if (booths) patch.booths = booths
  const infras = diffEntities<Infra>(prev.infras ?? [], next.infras ?? [])
  if (infras) patch.infras = infras

  return Object.keys(patch).length ? patch : null
}

/** 把服务端 / 实时流的补丁合并进本地场景（只读视图使用） */
export function applyScenePatch(scene: SceneJson, patch: ScenePatch): SceneJson {
  const next: SceneJson = {
    ...scene,
    booths: [...(scene.booths ?? [])],
    infras: [...(scene.infras ?? [])],
  }

  if (patch.venue !== undefined) next.venue = patch.venue
  if (patch.underlay !== undefined) next.underlay = patch.underlay
  if (patch.weather !== undefined) next.weather = patch.weather
  if (patch.weatherOn !== undefined) next.weatherOn = patch.weatherOn
  if (patch.sunProgress !== undefined) next.sunProgress = patch.sunProgress
  if (patch.rules !== undefined) next.rules = patch.rules

  if (patch.booths) {
    const map = new Map(next.booths.map((item) => [item.id, item]))
    for (const id of patch.booths.remove) map.delete(id)
    for (const item of patch.booths.upsert) map.set(item.id, item)
    next.booths = [...map.values()]
  }
  if (patch.infras) {
    const map = new Map(next.infras.map((item) => [item.id, item]))
    for (const id of patch.infras.remove) map.delete(id)
    for (const item of patch.infras.upsert) map.set(item.id, item)
    next.infras = [...map.values()]
  }

  return next
}
