import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.mjs'

const KEY_LENGTH = 64

/** scrypt 加盐哈希：scrypt:salt:hash */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const actual = crypto.scryptSync(password, salt, KEY_LENGTH)
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpires },
  )
}

export function requireAuth(req, res, next) {
  const header = String(req.headers.authorization ?? '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ error: '请先登录' })
    return
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    if (!payload || typeof payload !== 'object' || !payload.uid) throw new Error('bad token')
    req.user = { id: Number(payload.uid), username: String(payload.username ?? '') }
    next()
  } catch {
    res.status(401).json({ error: '登录已失效，请重新登录' })
  }
}

/** 可选登录：有合法 Bearer 时返回用户，否则返回 null；用于公开评论接口识别作者 */
export function readAuthUser(req) {
  const header = String(req.headers.authorization ?? '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    if (!payload || typeof payload !== 'object' || !payload.uid) return null
    return { id: Number(payload.uid), username: String(payload.username ?? '') }
  } catch {
    return null
  }
}

export function validateUsername(value) {
  const username = String(value ?? '').trim()
  if (!config.usernamePattern.test(username)) {
    return { ok: false, error: '用户名需为 3-24 位中文、字母、数字或下划线' }
  }
  return { ok: true, value: username }
}

export function validatePassword(value) {
  const password = String(value ?? '')
  if (password.length < config.passwordMin || password.length > 64) {
    return { ok: false, error: `密码长度需为 ${config.passwordMin}-64 位` }
  }
  return { ok: true, value: password }
}
