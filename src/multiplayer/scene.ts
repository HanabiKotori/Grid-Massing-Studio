import { parseSceneJson, type LoadedScene } from '../core/sceneParse'
import { loadStoredProject, type StoredProject } from '../core/projectStore'

export type LoadedMultiplayerScene = LoadedScene

/** 兼容原多人页引用：解析逻辑统一在 core/sceneParse */
export const parseMultiplayerScene = parseSceneJson

const MULTIPLAYER_SCENE_KEY = 'gms.multiplayer.scene'

/** 云存储模式通过 sessionStorage 传递场景，避免写 IndexedDB */
function readSessionScene(): StoredProject | null {
  try {
    const raw = sessionStorage.getItem(MULTIPLAYER_SCENE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredProject
    return parsed && typeof parsed === 'object' && parsed.scene ? parsed : null
  } catch {
    return null
  }
}

/** 房主读取当前标签页传递的场景，兼容本地 IndexedDB 模式 */
export async function loadCurrentMultiplayerScene(): Promise<LoadedMultiplayerScene> {
  const stored = readSessionScene() ?? (await loadStoredProject())
  if (!stored || !stored.scene) {
    throw new Error('当前没有可用的场馆场景，请先在主页面创建或载入场景')
  }
  return parseSceneJson(stored.scene)
}
