/** 云端存储开关：在 .env / .env.local 中配置，默认关闭并沿用 IndexedDB */
export const CLOUD_STORAGE_ENABLED =
  String(import.meta.env.VITE_CLOUD_STORAGE_ENABLED ?? 'false').toLowerCase() === 'true'

/** 未显式配置时跟随页面主机：局域网 IP 访问也能连到同一台机器的 dataService */
function resolveBaseUrl(): string {
  const configured = String(import.meta.env.VITE_DATA_SERVICE_URL ?? '').trim()
  if (configured) return configured
  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${protocol === 'https:' ? 'https:' : 'http:'}//${hostname}:3020`
    }
  }
  return 'http://127.0.0.1:3020'
}

const BASE_URL = resolveBaseUrl().replace(/\/+$/, '')

/** 供分享 / 评论模块复用同一套 dataService 地址与请求封装 */
export const DATA_SERVICE_URL = BASE_URL

export function dataServiceUrl(path: string): string {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export function dataServiceRequest<T>(
  path: string,
  init: RequestInit = {},
  withAuth = false,
): Promise<T> {
  return request<T>(path, init, withAuth)
}

const TOKEN_KEY = 'gms.cloud.token'
/** 云服务请求超时（毫秒）：避免数据服务不可达时阻塞编辑器启动 */
const REQUEST_TIMEOUT = 6000

export interface CloudUser {
  id: number
  username: string
}

export interface CaptchaChallenge {
  token: string
  background: string
  piece: string
  width: number
  height: number
  pieceSize: number
  yPercent: number
  piecePercent: number
}

export interface CloudSlotMeta {
  /** storage_slots.id：存档实例身份，不等于槽位号 */
  id: number
  slot: number
  name: string
  size: number
  updatedAt: string
}

export interface CloudSlotDetail extends CloudSlotMeta {
  scene: unknown
}

export interface AuthResponse {
  token: string
  user: CloudUser
}

export class CloudStorageError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'CloudStorageError'
    this.status = status
  }
}

export function readCloudToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeCloudToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // 隐私模式下 localStorage 不可用，忽略即可
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  withAuth = false,
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')
  if (withAuth) {
    const token = readCloudToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new CloudStorageError('云存储服务响应超时，请稍后重试')
    }
    throw new CloudStorageError('无法连接云存储服务，请检查 dataService 是否已启动')
  } finally {
    window.clearTimeout(timer)
  }

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `云存储请求失败（${response.status}）`
    throw new CloudStorageError(message, response.status)
  }

  return data as T
}

export const cloudApi = {
  health: () => request<{ ok: boolean; database: boolean }>('/api/health'),

  captcha: () => request<CaptchaChallenge>('/api/captcha'),

  register: (input: {
    username: string
    password: string
    captchaToken: string
    captchaX: number
  }) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  login: (input: {
    username: string
    password: string
    captchaToken: string
    captchaX: number
  }) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  me: () => request<{ user: CloudUser }>('/api/auth/me', {}, true),

  listSlots: () =>
    request<{ slotLimit: number; slots: CloudSlotMeta[] }>('/api/storage', {}, true),

  getSlot: (slot: number) => request<CloudSlotDetail>(`/api/storage/${slot}`, {}, true),

  putSlot: (slot: number, name: string, scene: unknown) =>
    request<CloudSlotMeta>(
      `/api/storage/${slot}`,
      { method: 'PUT', body: JSON.stringify({ name, scene }) },
      true,
    ),

  deleteSlot: (slot: number) =>
    request<{ ok: true }>(`/api/storage/${slot}`, { method: 'DELETE' }, true),
}
