import { ref } from 'vue'
import {
  CloudStorageError,
  cloudApi,
  readCloudToken,
  writeCloudToken,
  type AuthResponse,
  type CloudUser,
} from '../core/cloudStorage'

/** 分享页的轻量登录态：只复用账号，不加载云端存档列表 */
export function useShareAuth() {
  const user = ref<CloudUser | null>(null)
  const ready = ref(false)

  async function bootstrap() {
    ready.value = false
    if (!readCloudToken()) {
      user.value = null
      ready.value = true
      return
    }
    try {
      const me = await cloudApi.me()
      user.value = me.user
    } catch (err) {
      if (err instanceof CloudStorageError && err.status === 401) {
        writeCloudToken(null)
      }
      user.value = null
    } finally {
      ready.value = true
    }
  }

  function accept(result: AuthResponse) {
    writeCloudToken(result.token)
    user.value = result.user
    ready.value = true
  }

  function logout() {
    writeCloudToken(null)
    user.value = null
  }

  return { user, ready, bootstrap, accept, logout }
}
