import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  CLOUD_STORAGE_ENABLED,
  CloudStorageError,
  cloudApi,
  readCloudToken,
  writeCloudToken,
  type AuthResponse,
  type CaptchaChallenge,
  type CloudSlotDetail,
  type CloudSlotMeta,
  type CloudUser,
} from '../core/cloudStorage'

export interface CloudStorageController {
  enabled: boolean
  user: Ref<CloudUser | null>
  slots: Ref<CloudSlotMeta[]>
  currentSlot: Ref<number | null>
  busy: Ref<boolean>
  error: Ref<string>
  ready: ComputedRef<boolean>
  slotLimit: Ref<number>
  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
  login: (input: CloudAuthInput) => Promise<void>
  register: (input: CloudAuthInput) => Promise<void>
  logout: () => void
  setCurrentSlot: (slot: number | null) => void
  saveSlot: (slot: number, name: string, scene: unknown) => Promise<CloudSlotMeta>
  fetchSlot: (slot: number) => Promise<CloudSlotDetail>
  removeSlot: (slot: number) => Promise<void>
  fetchCurrentScene: () => Promise<unknown | null>
  saveAutosave: (scene: unknown) => Promise<boolean>
  getCaptcha: () => Promise<CaptchaChallenge>
}

export interface CloudAuthInput {
  username: string
  password: string
  captchaToken: string
  captchaX: number
}

const DEFAULT_SLOT_LIMIT = 10

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : '云存储操作失败'
}

function sceneNameOf(scene: unknown): string {
  if (scene && typeof scene === 'object') {
    const name = (scene as { venueName?: unknown }).venueName
    if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 64)
  }
  return ''
}

function slotStorageKey(userId: number): string {
  return `gms.cloud.current-slot.${userId}`
}

function readStoredSlot(userId: number): number | null {
  try {
    const raw = localStorage.getItem(slotStorageKey(userId))
    const slot = Number.parseInt(String(raw ?? ''), 10)
    return Number.isInteger(slot) && slot >= 1 && slot <= DEFAULT_SLOT_LIMIT ? slot : null
  } catch {
    return null
  }
}

export function useCloudStorage(): CloudStorageController {
  const enabled = CLOUD_STORAGE_ENABLED
  const user = ref<CloudUser | null>(null)
  const slots = ref<CloudSlotMeta[]>([])
  const currentSlot = ref<number | null>(null)
  const busy = ref(false)
  const error = ref('')
  const slotLimit = ref(DEFAULT_SLOT_LIMIT)

  const ready = computed(
    () => enabled && !!user.value && currentSlot.value !== null,
  )

  function setCurrentSlot(slot: number | null) {
    currentSlot.value = slot
    const current = user.value
    if (!current) return
    try {
      if (slot === null) localStorage.removeItem(slotStorageKey(current.id))
      else localStorage.setItem(slotStorageKey(current.id), String(slot))
    } catch {
      // 忽略存储异常
    }
  }

  function upsertSlot(meta: CloudSlotMeta) {
    const index = slots.value.findIndex((item) => item.slot === meta.slot)
    if (index >= 0) {
      const next = [...slots.value]
      next[index] = meta
      slots.value = next
    } else {
      slots.value = [...slots.value, meta].sort((a, b) => a.slot - b.slot)
    }
  }

  async function refresh() {
    if (!user.value) return
    const result = await cloudApi.listSlots()
    slots.value = result.slots
    slotLimit.value = result.slotLimit
  }

  async function bootstrap() {
    if (!enabled || !readCloudToken()) return
    busy.value = true
    error.value = ''
    try {
      const me = await cloudApi.me()
      user.value = me.user
      currentSlot.value = readStoredSlot(me.user.id)
      await refresh()
      if (
        currentSlot.value !== null &&
        !slots.value.some((item) => item.slot === currentSlot.value)
      ) {
        setCurrentSlot(null)
      }
    } catch (err) {
      if (err instanceof CloudStorageError && err.status === 401) {
        writeCloudToken(null)
      } else {
        error.value = messageOf(err)
      }
    } finally {
      busy.value = false
    }
  }

  async function authenticate(run: () => Promise<AuthResponse>) {
    busy.value = true
    error.value = ''
    try {
      const result = await run()
      writeCloudToken(result.token)
      user.value = result.user
      currentSlot.value = readStoredSlot(result.user.id)
      await refresh()
      if (
        currentSlot.value !== null &&
        !slots.value.some((item) => item.slot === currentSlot.value)
      ) {
        setCurrentSlot(null)
      }
    } catch (err) {
      error.value = messageOf(err)
      throw err
    } finally {
      busy.value = false
    }
  }

  function login(input: CloudAuthInput) {
    return authenticate(() => cloudApi.login(input))
  }

  function register(input: CloudAuthInput) {
    return authenticate(() => cloudApi.register(input))
  }

  function logout() {
    writeCloudToken(null)
    user.value = null
    slots.value = []
    currentSlot.value = null
    error.value = ''
  }

  async function saveSlot(slot: number, name: string, scene: unknown) {
    if (!user.value) throw new CloudStorageError('请先登录云存储')
    busy.value = true
    error.value = ''
    try {
      const meta = await cloudApi.putSlot(slot, name.trim() || '未命名场景', scene)
      upsertSlot(meta)
      return meta
    } catch (err) {
      error.value = messageOf(err)
      throw err
    } finally {
      busy.value = false
    }
  }

  async function fetchSlot(slot: number) {
    return cloudApi.getSlot(slot)
  }

  async function removeSlot(slot: number) {
    if (!user.value) throw new CloudStorageError('请先登录云存储')
    busy.value = true
    error.value = ''
    try {
      await cloudApi.deleteSlot(slot)
      slots.value = slots.value.filter((item) => item.slot !== slot)
      if (currentSlot.value === slot) setCurrentSlot(null)
    } catch (err) {
      error.value = messageOf(err)
      throw err
    } finally {
      busy.value = false
    }
  }

  /** 读取当前自动保存位置上的场景；位置不存在时返回 null */
  async function fetchCurrentScene(): Promise<unknown | null> {
    if (!ready.value || currentSlot.value === null) return null
    try {
      const detail = await cloudApi.getSlot(currentSlot.value)
      return detail.scene
    } catch (err) {
      if (err instanceof CloudStorageError && err.status === 404) {
        setCurrentSlot(null)
        return null
      }
      throw err
    }
  }

  /** 编辑器静默自动保存：失败只记录错误，不打断编辑；同一时间只保留一个请求 */
  let autosaveInFlight = false
  async function saveAutosave(scene: unknown): Promise<boolean> {
    if (!ready.value || currentSlot.value === null) return false
    // 上一次保存还在路上：视为已处理，避免并发请求与误报失败
    if (autosaveInFlight) return true
    autosaveInFlight = true
    const slot = currentSlot.value
    const existing = slots.value.find((item) => item.slot === slot)
    const name = existing?.name || sceneNameOf(scene) || `位置 ${slot}`
    try {
      const meta = await cloudApi.putSlot(slot, name, scene)
      upsertSlot(meta)
      error.value = ''
      return true
    } catch (err) {
      error.value = messageOf(err)
      return false
    } finally {
      autosaveInFlight = false
    }
  }

  function getCaptcha() {
    return cloudApi.captcha()
  }

  return {
    enabled,
    user,
    slots,
    currentSlot,
    busy,
    error,
    ready,
    slotLimit,
    bootstrap,
    refresh,
    login,
    register,
    logout,
    setCurrentSlot,
    saveSlot,
    fetchSlot,
    removeSlot,
    fetchCurrentScene,
    saveAutosave,
    getCaptcha,
  }
}
