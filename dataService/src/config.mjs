import 'dotenv/config'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** dataService 根目录 */
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function readInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const fallbackSecret = crypto.randomBytes(32).toString('hex')
const configuredSecret = process.env.JWT_SECRET
const secretIsPlaceholder =
  !configuredSecret || configuredSecret === 'change-me-to-a-long-random-secret'

export const config = {
  port: readInt(process.env.PORT, 3020),
  host: process.env.HOST || '0.0.0.0',
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: readInt(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    name: (process.env.DB_NAME || 'grid-massing-data').replace(/[^A-Za-z0-9_-]/g, ''),
    connectionLimit: Math.max(1, readInt(process.env.DB_POOL, 10)),
  },
  jwtSecret: secretIsPlaceholder ? fallbackSecret : configuredSecret,
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  maxSceneMb: Math.max(1, readInt(process.env.MAX_SCENE_MB, 40)),
  allowedOrigins: readList(process.env.ALLOWED_ORIGINS),
  /** 每个用户固定的存储位置数量 */
  slotLimit: 10,
  passwordMin: 6,
  usernamePattern: /^[A-Za-z0-9_\u4e00-\u9fa5]{3,24}$/,
  multiplayer: {
    enabled: process.env.MULTIPLAYER_ENABLED !== 'false',
    maxRoomSize: Math.max(
      2,
      Math.min(8, readInt(process.env.MAX_ROOM_SIZE, 8)),
    ),
    tickHz: Math.max(1, Math.min(30, readInt(process.env.TICK_HZ, 10))),
    /** WebSocket 连接票有效期（秒） */
    ticketTtl: Math.max(30, Math.min(300, readInt(process.env.WS_TICKET_TTL, 60))),
  },
}

if (secretIsPlaceholder) {
  console.warn(
    '[dataService] JWT_SECRET 未配置或仍是示例值，本次启动使用临时密钥，重启后登录状态会失效；请修改 .env。',
  )
}
