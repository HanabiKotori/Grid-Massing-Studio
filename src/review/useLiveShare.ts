import { ref, type Ref } from 'vue'
import { CloudStorageError } from '../core/cloudStorage'
import { diffScene } from '../core/sceneDiff'
import type { SceneJson } from '../core/sceneFile'
import { shareApi, type ShareMeta } from '../core/shareApi'

interface Options {
  scene: () => SceneJson
  share: Ref<ShareMeta | null>
  enabled: Ref<boolean>
  onError?: (message: string) => void
  onSynced?: (revision: number) => void
}

const PUSH_DELAY = 300

export function useLiveShare(options: Options) {
  const pushing = ref(false)
  const lastError = ref('')
  const lastPushedAt = ref<number | null>(null)

  let lastScene: SceneJson | null = null
  let lastRevision = 0
  let timer = 0
  let busy = false

  function reset(scene: SceneJson, revision: number) {
    lastScene = scene
    lastRevision = revision
    lastError.value = ''
  }

  function canPush(): boolean {
    const share = options.share.value
    return !!share && share.liveMode && !share.revoked && options.enabled.value
  }

  function schedulePush(delay = PUSH_DELAY) {
    if (!canPush()) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void pushNow(), delay)
  }

  async function pushNow() {
    if (!canPush() || busy) return
    const share = options.share.value
    if (!share) return
    const current = options.scene()
    if (!lastScene) {
      reset(current, share.revision)
      return
    }
    const patch = diffScene(lastScene, current)
    if (!patch) return
    busy = true
    pushing.value = true
    try {
      const { revision } = await shareApi.patchLive(share.token, lastRevision, patch)
      lastScene = current
      lastRevision = revision
      lastPushedAt.value = Date.now()
      lastError.value = ''
      options.share.value = { ...share, revision }
      options.onSynced?.(revision)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '实时同步失败，请稍后重试'
      lastError.value = message
      options.onError?.(message)
      if (err instanceof CloudStorageError && err.status === 409) {
        // 另一个标签页已经写入：以服务端为准，等待下一次编辑重新推送
        try {
          const data = await shareApi.getLiveSince(share.token, 0)
          if (data.scene) {
            lastScene = data.scene
            lastRevision = data.revision
            options.share.value = { ...share, revision: data.revision }
          }
        } catch {
          // 忽略二次失败
        }
      }
    } finally {
      busy = false
      pushing.value = false
    }
  }

  function dispose() {
    window.clearTimeout(timer)
  }

  return {
    pushing,
    lastError,
    lastPushedAt,
    reset,
    schedulePush,
    pushNow,
    dispose,
  }
}
