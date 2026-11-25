import crypto from 'node:crypto'
import { config } from '../config.mjs'

/** 一次性 WebSocket 连接票：只保存哈希，原始票只返回给浏览器一次 */
const tickets = new Map()
const issueLog = new Map()
const TTL_MS = Math.max(30, config.multiplayer.ticketTtl) * 1000
const ISSUE_WINDOW_MS = 60_000
const ISSUE_LIMIT = 20

function hashTicket(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function pruneExpired(now = Date.now()) {
  for (const [key, item] of tickets) {
    if (item.expiresAt <= now) tickets.delete(key)
  }
  for (const [userId, timestamps] of issueLog) {
    const recent = timestamps.filter((at) => now - at < ISSUE_WINDOW_MS)
    if (recent.length) issueLog.set(userId, recent)
    else issueLog.delete(userId)
  }
}

/**
 * 给登录用户签发一张短时、单次使用的 WebSocket 票。
 * 同一账号每分钟最多 20 次，避免反复申请。
 */
export function issueTicket(user) {
  pruneExpired()
  const userId = Number(user.id)
  const now = Date.now()
  const recent = (issueLog.get(userId) ?? []).filter(
    (at) => now - at < ISSUE_WINDOW_MS,
  )
  if (recent.length >= ISSUE_LIMIT) {
    return { rateLimited: true }
  }
  recent.push(now)
  issueLog.set(userId, recent)

  const ticket = crypto.randomBytes(32).toString('base64url')
  tickets.set(hashTicket(ticket), {
    userId,
    username: String(user.username ?? ''),
    expiresAt: now + TTL_MS,
  })
  return {
    rateLimited: false,
    ticket,
    expiresIn: Math.floor(TTL_MS / 1000),
  }
}

/** 原子消费票据：成功返回用户，失败、过期或重放返回 null */
export function consumeTicket(value) {
  if (!value) return null
  pruneExpired()
  const key = hashTicket(value)
  const item = tickets.get(key)
  if (!item) return null
  tickets.delete(key)
  if (item.expiresAt <= Date.now()) return null
  return { id: item.userId, username: item.username }
}

export function disposeTickets() {
  tickets.clear()
  issueLog.clear()
}
