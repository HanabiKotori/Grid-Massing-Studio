const TOKEN_KEY = 'gms.review.authorToken'
const NAME_KEY = 'gms.review.authorName'

function randomToken(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 匿名访客身份：作者 token 只存在本机，用来编辑自己的评论 */
export function authorToken(): string {
  try {
    const saved = localStorage.getItem(TOKEN_KEY)
    if (saved) return saved
    const next = randomToken()
    localStorage.setItem(TOKEN_KEY, next)
    return next
  } catch {
    return randomToken()
  }
}

export function authorName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() || '访客'
  } catch {
    return '访客'
  }
}

export function setAuthorName(name: string) {
  try {
    const value = name.trim().slice(0, 24)
    if (value) localStorage.setItem(NAME_KEY, value)
  } catch {
    // 隐私模式下忽略
  }
}
