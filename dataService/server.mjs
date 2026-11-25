import express from 'express'
import cors from 'cors'
import { config } from './src/config.mjs'
import { closeDatabase, getPool, initDatabase } from './src/db.mjs'
import {
  hashPassword,
  requireAuth,
  signToken,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './src/auth.mjs'
import { issueCaptcha, verifyCaptcha } from './src/captcha.mjs'
import {
  notifyStorageSlotShareRemoved,
  registerShareRoutes,
} from './src/shares.mjs'
import { registerMultiplayer } from './src/multiplayer/index.mjs'
import { disposeTickets, issueTicket } from './src/multiplayer/tickets.mjs'

const app = express()
app.disable('x-powered-by')

const PRIVATE_ORIGIN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?$/

/** 允许配置的来源；未配置时允许所有，另外放行本机与局域网地址便于调试 */
function originAllowed(origin) {
  if (!origin) return true
  if (config.allowedOrigins.length === 0) return true
  if (config.allowedOrigins.includes(origin)) return true
  return PRIVATE_ORIGIN.test(origin)
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, originAllowed(origin))
    },
  }),
)
app.use(express.json({ limit: `${config.maxSceneMb + 2}mb` }))

function publicUser(row) {
  return { id: Number(row.id), username: row.username }
}

/** 数据库未就绪时统一返回 503，健康检查仍可用 */
function requireDatabase(req, res, next) {
  if (!app.locals.dbReady) {
    res.status(503).json({ error: '云存储数据库未就绪，请检查 dataService 配置' })
    return
  }
  next()
}

function parseSlot(value) {
  const slot = Number.parseInt(String(value), 10)
  if (!Number.isInteger(slot) || slot < 1 || slot > config.slotLimit) return null
  return slot
}

function slotMeta(row) {
  return {
    id: Number(row.id),
    slot: Number(row.slot),
    name: row.name,
    size: Number(row.scene_size ?? 0),
    updatedAt: row.updated_at,
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    database: !!app.locals.dbReady,
    slotsPerUser: config.slotLimit,
    maxSceneMb: config.maxSceneMb,
    multiplayer: config.multiplayer.enabled,
  })
})

app.get('/api/captcha', (req, res) => {
  res.json(issueCaptcha().payload)
})

app.post('/api/auth/register', requireDatabase, async (req, res, next) => {
  try {
    const usernameCheck = validateUsername(req.body?.username)
    if (!usernameCheck.ok) {
      res.status(400).json({ error: usernameCheck.error })
      return
    }
    const passwordCheck = validatePassword(req.body?.password)
    if (!passwordCheck.ok) {
      res.status(400).json({ error: passwordCheck.error })
      return
    }
    const captcha = verifyCaptcha(req.body?.captchaToken, req.body?.captchaX)
    if (!captcha.ok) {
      res.status(400).json({ error: captcha.error })
      return
    }

    const pool = getPool()
    const [exists] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [
      usernameCheck.value,
    ])
    if (exists.length) {
      res.status(409).json({ error: '该用户名已被注册' })
      return
    }

    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [usernameCheck.value, hashPassword(passwordCheck.value)],
    )
    const user = { id: Number(result.insertId), username: usernameCheck.value }
    res.status(201).json({ token: signToken(user), user })
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: '该用户名已被注册' })
      return
    }
    next(err)
  }
})

app.post('/api/auth/login', requireDatabase, async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim()
    const password = String(req.body?.password ?? '')
    if (!username || !password) {
      res.status(400).json({ error: '请输入用户名与密码' })
      return
    }
    const captcha = verifyCaptcha(req.body?.captchaToken, req.body?.captchaX)
    if (!captcha.ok) {
      res.status(400).json({ error: captcha.error })
      return
    }

    const pool = getPool()
    const [rows] = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1',
      [username],
    )
    const row = rows[0]
    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: '用户名或密码不正确' })
      return
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id])
    const user = publicUser(row)
    res.json({ token: signToken(user), user })
  } catch (err) {
    next(err)
  }
})

app.post('/api/multiplayer/ticket', requireDatabase, requireAuth, async (req, res, next) => {
  try {
    // JWT 里的 username 可能是旧快照；房间身份以 users 表当前名称为准
    const [rows] = await getPool().query(
      'SELECT username FROM users WHERE id = ? LIMIT 1',
      [req.user.id],
    )
    if (!rows.length) {
      res.status(401).json({ error: '账号不存在，请重新登录' })
      return
    }
    const issued = issueTicket({
      id: req.user.id,
      username: rows[0].username,
    })
    if (issued.rateLimited) {
      res.status(429).json({ error: '连接票申请太频繁，请稍后再试' })
      return
    }
    res.json({ ticket: issued.ticket, expiresIn: issued.expiresIn })
  } catch (err) {
    next(err)
  }
})

app.get('/api/auth/me', requireDatabase, requireAuth, async (req, res, next) => {
  try {
    const pool = getPool()
    const [rows] = await pool.query(
      'SELECT id, username, created_at FROM users WHERE id = ? LIMIT 1',
      [req.user.id],
    )
    if (!rows.length) {
      res.status(401).json({ error: '账号不存在，请重新登录' })
      return
    }
    res.json({ user: publicUser(rows[0]), createdAt: rows[0].created_at })
  } catch (err) {
    next(err)
  }
})

app.get('/api/storage', requireDatabase, requireAuth, async (req, res, next) => {
  try {
    const pool = getPool()
    const [rows] = await pool.query(
      'SELECT id, slot, name, scene_size, updated_at FROM storage_slots WHERE user_id = ? ORDER BY slot',
      [req.user.id],
    )
    res.json({
      slotLimit: config.slotLimit,
      slots: rows.map(slotMeta),
    })
  } catch (err) {
    next(err)
  }
})

app.get('/api/storage/:slot', requireDatabase, requireAuth, async (req, res, next) => {
  try {
    const slot = parseSlot(req.params.slot)
    if (!slot) {
      res.status(400).json({ error: `存储位置需为 1-${config.slotLimit}` })
      return
    }
    const pool = getPool()
    const [rows] = await pool.query(
      'SELECT id, slot, name, scene_json, scene_size, updated_at FROM storage_slots WHERE user_id = ? AND slot = ? LIMIT 1',
      [req.user.id, slot],
    )
    if (!rows.length) {
      res.status(404).json({ error: '该存储位置还没有数据' })
      return
    }

    let scene
    try {
      scene = JSON.parse(rows[0].scene_json)
    } catch {
      res.status(500).json({ error: '云端场景数据已损坏' })
      return
    }
    res.json({ ...slotMeta(rows[0]), scene })
  } catch (err) {
    next(err)
  }
})

app.put('/api/storage/:slot', requireDatabase, requireAuth, async (req, res, next) => {
  try {
    const slot = parseSlot(req.params.slot)
    if (!slot) {
      res.status(400).json({ error: `存储位置需为 1-${config.slotLimit}` })
      return
    }

    const scene = req.body?.scene
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
      res.status(400).json({ error: '场景数据格式不正确' })
      return
    }

    const text = JSON.stringify(scene)
    const size = Buffer.byteLength(text)
    if (size > config.maxSceneMb * 1024 * 1024) {
      res.status(413).json({ error: `场景超过 ${config.maxSceneMb}MB 上限` })
      return
    }

    const name =
      String(req.body?.name ?? '')
        .trim()
        .slice(0, 64) || '未命名场景'

    const pool = getPool()
    await pool.query(
      `INSERT INTO storage_slots (user_id, slot, name, scene_json, scene_size)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         scene_json = VALUES(scene_json),
         scene_size = VALUES(scene_size)`,
      [req.user.id, slot, name, text, size],
    )

    const [rows] = await pool.query(
      'SELECT id, slot, name, scene_size, updated_at FROM storage_slots WHERE user_id = ? AND slot = ?',
      [req.user.id, slot],
    )
    res.json(slotMeta(rows[0]))
  } catch (err) {
    next(err)
  }
})

app.delete('/api/storage/:slot', requireDatabase, requireAuth, async (req, res, next) => {
  try {
    const slot = parseSlot(req.params.slot)
    if (!slot) {
      res.status(400).json({ error: `存储位置需为 1-${config.slotLimit}` })
      return
    }
    const pool = getPool()
    await notifyStorageSlotShareRemoved(req.user.id, slot)
    const [result] = await pool.query(
      'DELETE FROM storage_slots WHERE user_id = ? AND slot = ?',
      [req.user.id, slot],
    )
    if (!result.affectedRows) {
      res.status(404).json({ error: '该存储位置没有可删除的数据' })
      return
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

registerShareRoutes(app)

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: '场景数据过大' })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: '请求 JSON 格式不正确' })
    return
  }
  console.error('[dataService] 未处理错误', err)
  res.status(500).json({ error: '服务器内部错误' })
})

app.locals.dbReady = false

const server = app.listen(config.port, config.host, () => {
  console.log(`[dataService] 监听 http://${config.host}:${config.port}`)
})

const multiplayer = registerMultiplayer(server, { originAllowed })
if (config.multiplayer.enabled) {
  console.log(
    `[dataService] 多人漫游 /ws 已就绪 · TICK_HZ=${config.multiplayer.tickHz} · MAX_ROOM_SIZE=${config.multiplayer.maxRoomSize}`,
  )
}

// 数据库初始化放到后台：MySQL 暂不可达时，健康检查与验证码接口仍立即可用
void (async () => {
  try {
    await initDatabase()
    app.locals.dbReady = true
    console.log('[dataService] MySQL 已连接，表结构就绪')
  } catch (err) {
    console.error('[dataService] 数据库初始化失败：', err?.message ?? err)
    console.error('[dataService] 仅提供健康检查与验证码接口，请修正 DB 配置后重启')
    await closeDatabase().catch(() => {})
  }
})()

server.on('error', (err) => {
  console.error('[dataService] 服务启动失败：', err?.message ?? err)
  process.exit(1)
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[dataService] 收到 ${signal}，正在关闭`)
  await multiplayer.close().catch(() => {})
  disposeTickets()
  server.close()
  await closeDatabase().catch(() => {})
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
