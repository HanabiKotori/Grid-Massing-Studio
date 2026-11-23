import crypto from 'node:crypto'
import { readAuthUser, requireAuth } from './auth.mjs'
import { getPool } from './db.mjs'
import { config } from './config.mjs'

const TICKET_TTL = 60_000
const COMMENT_MAX = 1000
const NAME_MAX = 24
const TITLE_MAX = 64

/** 短时 SSE ticket：EventSource 不能带 Authorization，用 ticket 换取连接 */
const tickets = new Map()
/** key -> Set<{ res }> */
const channels = new Map()
/** 简单的内存限流：key -> number[] */
const rateBuckets = new Map()

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

function requireDb(req, res, next) {
  if (!req.app.locals.dbReady) {
    res.status(503).json({ error: '云存储数据库未就绪，请检查 dataService 配置' })
    return
  }
  next()
}

function newShareToken() {
  return crypto.randomBytes(12).toString('base64url')
}

function randomKey(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex')
}

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max)
}

function allowRate(key, max, windowMs) {
  const now = Date.now()
  const list = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (list.length >= max) {
    rateBuckets.set(key, list)
    return false
  }
  list.push(now)
  rateBuckets.set(key, list)
  return true
}

function issueTicket(payload) {
  const ticket = randomKey(18)
  tickets.set(ticket, { ...payload, exp: Date.now() + TICKET_TTL })
  return ticket
}

function readTicket(value, kind) {
  const ticket = String(value ?? '')
  const data = tickets.get(ticket)
  if (!data || data.exp < Date.now() || data.kind !== kind) return null
  return data
}

function channelKeyShare(token) {
  return `share:${token}`
}

function channelKeyProject(projectKey) {
  return `project:${projectKey}`
}

function publish(key, payload) {
  const set = channels.get(key)
  if (!set || !set.size) return
  const line = `data: ${JSON.stringify(payload)}\n\n`
  for (const client of set) {
    try {
      client.res.write(line)
    } catch {
      // 连接断开由 close 事件清理
    }
  }
}

function subscribe(key, res, hello) {
  let set = channels.get(key)
  if (!set) {
    set = new Set()
    channels.set(key, set)
  }
  const client = { res }
  set.add(client)
  res.write(`data: ${JSON.stringify(hello)}\n\n`)
  const timer = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      // ignore
    }
  }, 20_000)
  res.on('close', () => {
    clearInterval(timer)
    set.delete(client)
    if (!set.size) channels.delete(key)
    if (key.startsWith('share:')) {
      const token = key.slice(6)
      publish(key, { type: 'presence', token, count: set.size })
    }
  })
  if (key.startsWith('share:')) {
    const token = key.slice(6)
    publish(key, { type: 'presence', token, count: set.size })
  }
  return client
}

function closeChannel(key, payload) {
  const set = channels.get(key)
  if (!set) return
  const line = `data: ${JSON.stringify(payload)}\n\n`
  for (const client of set) {
    try {
      client.res.write(line)
      client.res.end()
    } catch {
      // ignore
    }
  }
  channels.delete(key)
}

function viewerCount(token) {
  return channels.get(channelKeyShare(token))?.size ?? 0
}

function shareJson(row, commentCount = 0) {
  return {
    token: row.token,
    title: row.title,
    projectKey: row.project_key,
    storageSlotId: row.storage_slot_id ? Number(row.storage_slot_id) : null,
    storageSlot: row.storage_slot != null ? Number(row.storage_slot) : null,
    storageName: row.storage_name || '',
    revision: Number(row.revision),
    sceneVersion: Number(row.scene_version),
    liveMode: !!row.live_mode,
    allowComment: !!row.allow_comment,
    allowDownload: !!row.allow_download,
    revoked: !!row.revoked_at,
    viewerCount: viewerCount(row.token),
    commentCount,
    sceneSize: Number(row.scene_size ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseAnchor(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { point: [0, 0, 0] }
  }
  const point = Array.isArray(raw.point) ? raw.point.slice(0, 3).map(Number) : [0, 0, 0]
  if (point.length !== 3 || point.some((n) => !Number.isFinite(n))) point.splice(0, 3, 0, 0, 0)
  const anchor = { point }
  if (raw.object && typeof raw.object === 'object') {
    const kind = raw.object.kind === 'infra' ? 'infra' : raw.object.kind === 'booth' ? 'booth' : ''
    const id = cleanText(raw.object.id, 64)
    if (kind && id) anchor.object = { kind, id }
  }
  if (Array.isArray(raw.objectOrigin) && raw.objectOrigin.length === 2) {
    const origin = raw.objectOrigin.map(Number)
    if (origin.every((n) => Number.isFinite(n))) anchor.objectOrigin = origin
  }
  if (raw.camera && typeof raw.camera === 'object') {
    const pos = Array.isArray(raw.camera.position) ? raw.camera.position.map(Number) : null
    const target = Array.isArray(raw.camera.target) ? raw.camera.target.map(Number) : null
    if (pos?.length === 3 && target?.length === 3 && [...pos, ...target].every((n) => Number.isFinite(n))) {
      anchor.camera = { position: pos, target }
    }
  }
  return anchor
}

function eventReplyJson(row, viewerUserId = null) {
  return {
    id: Number(row.id),
    content: row.content,
    actorUserId: row.actor_user_id ? Number(row.actor_user_id) : null,
    actorName: row.actor_name || '登录用户',
    actorRole: row.actor_role === 'owner' ? 'owner' : 'visitor',
    createdAt: row.created_at,
    mine:
      !!viewerUserId &&
      !!row.actor_user_id &&
      Number(row.actor_user_id) === Number(viewerUserId),
  }
}

function eventJson(row, replies = [], viewerUserId = null) {
  return {
    id: Number(row.id),
    action: row.action === 'resolved' ? 'resolved' : 'unresolved',
    actorUserId: row.actor_user_id ? Number(row.actor_user_id) : null,
    actorName: row.actor_name || '登录用户',
    actorRole: row.actor_role === 'owner' ? 'owner' : 'visitor',
    createdAt: row.created_at,
    replyCount: replies.length,
    replies: replies.map((reply) => eventReplyJson(reply, viewerUserId)),
  }
}

function commentJson(row, share, mine = false, events = []) {
  let anchor = { point: [0, 0, 0] }
  try {
    anchor = parseAnchor(JSON.parse(row.anchor_json))
  } catch {
    anchor = { point: [0, 0, 0] }
  }
  const isOwner =
    !!row.author_user_id && Number(row.author_user_id) === Number(share.owner_user_id)
  return {
    id: Number(row.id),
    parentId: row.parent_id ? Number(row.parent_id) : null,
    shareToken: share.token,
    shareTitle: share.title,
    anchor,
    authorName: row.author_name || (isOwner ? '作者' : '访客'),
    authorUserId: row.author_user_id ? Number(row.author_user_id) : null,
    replyToUserId: row.reply_to_user_id ? Number(row.reply_to_user_id) : null,
    replyToName: row.reply_to_name || '',
    authorRole: isOwner ? 'owner' : 'visitor',
    // 没有 user_id、只有历史 author_token 的评论属于匿名评论，保留只读
    legacy: !row.author_user_id && !!row.author_token,
    content: row.content,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events,
    mine: !!mine,
  }
}

async function loadShare(token) {
  const pool = getPool()
  const [rows] = await pool.query(
    `SELECT s.*, st.slot AS storage_slot, st.name AS storage_name
       FROM share_links s
       LEFT JOIN storage_slots st ON st.id = s.storage_slot_id
      WHERE s.token = ?
      LIMIT 1`,
    [token],
  )
  return rows[0] ?? null
}

async function loadShareByStorageSlotId(storageSlotId) {
  const pool = getPool()
  const [rows] = await pool.query(
    `SELECT s.*, st.slot AS storage_slot, st.name AS storage_name
       FROM share_links s
       LEFT JOIN storage_slots st ON st.id = s.storage_slot_id
      WHERE s.storage_slot_id = ?
      LIMIT 1`,
    [storageSlotId],
  )
  return rows[0] ?? null
}

async function loadStorageSlot(userId, slot) {
  const pool = getPool()
  const [rows] = await pool.query(
    `SELECT id, slot, name, scene_json
       FROM storage_slots
      WHERE user_id = ? AND slot = ?
      LIMIT 1`,
    [userId, slot],
  )
  return rows[0] ?? null
}

function parseStorageSlot(raw) {
  const slot = Number(raw)
  return Number.isInteger(slot) && slot >= 1 && slot <= config.slotLimit ? slot : null
}

async function loadComment(shareId, commentId) {
  const pool = getPool()
  const [rows] = await pool.query(
    'SELECT * FROM share_comments WHERE id = ? AND share_id = ? LIMIT 1',
    [commentId, shareId],
  )
  return rows[0] ?? null
}

async function loadCommentEvent(shareId, commentId, eventId) {
  const pool = getPool()
  const [rows] = await pool.query(
    `SELECT * FROM share_comment_events
      WHERE id = ? AND share_id = ? AND comment_id = ?
      LIMIT 1`,
    [eventId, shareId, commentId],
  )
  return rows[0] ?? null
}

async function loadEventReply(eventId, replyId) {
  const pool = getPool()
  const [rows] = await pool.query(
    'SELECT * FROM share_comment_event_replies WHERE id = ? AND event_id = ? LIMIT 1',
    [replyId, eventId],
  )
  return rows[0] ?? null
}

/**
 * 一次性加载一组评论的事件与事件回复，避免评论列表 N+1。
 * 返回 commentId -> Event[]。
 */
async function loadCommentEvents(shareId, commentIds, viewerUserId = null) {
  const ids = [...new Set(commentIds.map(Number).filter((id) => id > 0))]
  const grouped = new Map()
  if (!ids.length) return grouped

  const pool = getPool()
  const [events] = await pool.query(
    `SELECT * FROM share_comment_events
      WHERE share_id = ? AND comment_id IN (?)
      ORDER BY created_at ASC, id ASC`,
    [shareId, ids],
  )
  if (!events.length) return grouped

  const eventIds = events.map((event) => Number(event.id))
  const [replies] = await pool.query(
    `SELECT * FROM share_comment_event_replies
      WHERE event_id IN (?)
      ORDER BY created_at ASC, id ASC`,
    [eventIds],
  )
  const repliesByEvent = new Map()
  for (const reply of replies) {
    const eventId = Number(reply.event_id)
    const list = repliesByEvent.get(eventId) ?? []
    list.push(reply)
    repliesByEvent.set(eventId, list)
  }

  for (const event of events) {
    const commentId = Number(event.comment_id)
    const list = grouped.get(commentId) ?? []
    list.push(eventJson(event, repliesByEvent.get(Number(event.id)) ?? [], viewerUserId))
    grouped.set(commentId, list)
  }
  return grouped
}

async function eventsForComment(shareId, commentId, viewerUserId = null) {
  const grouped = await loadCommentEvents(shareId, [commentId], viewerUserId)
  return grouped.get(Number(commentId)) ?? []
}

async function commentCount(shareId) {
  const pool = getPool()
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM share_comments WHERE share_id = ? AND deleted_at IS NULL',
    [shareId],
  )
  return Number(rows[0]?.n ?? 0)
}

function hasVenueContent(scene) {
  const points = scene?.venue?.points
  return Array.isArray(points) && points.length >= 3
}

function applyScenePatch(scene, patch) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
    throw new Error('场景数据已损坏')
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('补丁格式不正确')
  }
  if (patch.venue !== undefined) scene.venue = patch.venue
  if (patch.underlay !== undefined) scene.underlay = patch.underlay
  if (patch.weather !== undefined) scene.weather = patch.weather
  if (patch.weatherOn !== undefined) scene.weatherOn = !!patch.weatherOn
  if (patch.sunProgress !== undefined && Number.isFinite(Number(patch.sunProgress))) {
    scene.sunProgress = Number(patch.sunProgress)
  }
  if (patch.rules !== undefined) scene.rules = patch.rules

  const mergeList = (field, delta) => {
    if (!delta || typeof delta !== 'object') return
    const list = Array.isArray(scene[field]) ? scene[field] : []
    const map = new Map(list.map((item) => [item?.id, item]))
    if (Array.isArray(delta.remove)) {
      for (const id of delta.remove) map.delete(String(id))
    }
    if (Array.isArray(delta.upsert)) {
      for (const item of delta.upsert) {
        if (!item || typeof item !== 'object') continue
        if (typeof item.id !== 'string' || !item.id) continue
        map.set(item.id, item)
      }
    }
    scene[field] = [...map.values()]
  }

  mergeList('booths', patch.booths)
  mergeList('infras', patch.infras)
  return scene
}

function publicComment(share, row, mine) {
  return commentJson(row, share, mine)
}

function publishComment(share, comment) {
  publish(channelKeyShare(share.token), { type: 'comment.created', comment })
  publish(channelKeyProject(share.project_key), { type: 'comment.created', comment })
}

function publishCommentUpdate(share, comment, meta = {}) {
  publish(channelKeyShare(share.token), { type: 'comment.updated', comment, ...meta })
  publish(channelKeyProject(share.project_key), { type: 'comment.updated', comment, ...meta })
}

function publishCommentDelete(share, id, meta = {}) {
  publish(channelKeyShare(share.token), {
    type: 'comment.deleted',
    shareToken: share.token,
    id,
    ...meta,
  })
  publish(channelKeyProject(share.project_key), {
    type: 'comment.deleted',
    shareToken: share.token,
    id,
    ...meta,
  })
}

function publishEventReply(share, commentId, event, reply, meta = {}) {
  const payload = {
    type: 'comment.event.replied',
    shareToken: share.token,
    commentId,
    eventId: Number(event.id),
    eventAction: event.action,
    eventActorUserId: event.actor_user_id ? Number(event.actor_user_id) : null,
    reply,
    ...meta,
  }
  publish(channelKeyShare(share.token), payload)
  publish(channelKeyProject(share.project_key), payload)
}

function publishEventReplyDelete(share, commentId, eventId, reply, meta = {}) {
  const payload = {
    type: 'comment.event.reply.deleted',
    shareToken: share.token,
    commentId,
    eventId: Number(eventId),
    reply,
    ...meta,
  }
  publish(channelKeyShare(share.token), payload)
  publish(channelKeyProject(share.project_key), payload)
}

/** 删除云端存档前通知访客并关闭该存档链接的 SSE */
export async function notifyStorageSlotShareRemoved(userId, slot) {
  const pool = getPool()
  const [rows] = await pool.query(
    `SELECT s.token, s.project_key
       FROM share_links s
       JOIN storage_slots st ON st.id = s.storage_slot_id
      WHERE st.user_id = ? AND st.slot = ?`,
    [userId, slot],
  )
  for (const row of rows) {
    closeChannel(channelKeyShare(row.token), { type: 'revoked' })
    publish(channelKeyProject(row.project_key), {
      type: 'share.revoked',
      shareToken: row.token,
    })
  }
}

export function registerShareRoutes(app) {
  /* ---------------- 分享链接 ---------------- */

  app.put(
    '/api/storage/:slot/share',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const slotNumber = parseStorageSlot(req.params.slot)
      if (!slotNumber) {
        res.status(400).json({ error: `存储位置需为 1-${config.slotLimit}` })
        return
      }
      const storageSlot = await loadStorageSlot(req.user.id, slotNumber)
      if (!storageSlot) {
        res.status(404).json({ error: '该存储位置还没有云端存档' })
        return
      }

      const existing = await loadShareByStorageSlotId(storageSlot.id)
      const sceneProvided = req.body?.scene !== undefined
      let scene = null
      let text = ''
      let size = 0

      if (sceneProvided) {
        scene = req.body.scene
        if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
          res.status(400).json({ error: '场景数据格式不正确' })
          return
        }
        if (!hasVenueContent(scene)) {
          res.status(400).json({ error: '场景还没有场馆内容，无法发布' })
          return
        }
        text = JSON.stringify(scene)
        size = Buffer.byteLength(text)
        if (size > config.maxSceneMb * 1024 * 1024) {
          res.status(413).json({ error: `场景超过 ${config.maxSceneMb}MB 上限` })
          return
        }
      } else if (!existing) {
        try {
          scene = JSON.parse(storageSlot.scene_json)
        } catch {
          res.status(500).json({ error: '云端场景数据已损坏' })
          return
        }
        if (!scene || !hasVenueContent(scene)) {
          res.status(400).json({ error: '场景还没有场馆内容，无法发布' })
          return
        }
        text = JSON.stringify(scene)
        size = Buffer.byteLength(text)
        if (size > config.maxSceneMb * 1024 * 1024) {
          res.status(413).json({ error: `场景超过 ${config.maxSceneMb}MB 上限` })
          return
        }
      }

      const title =
        cleanText(req.body?.title, TITLE_MAX) ||
        cleanText(storageSlot.name, TITLE_MAX) ||
        '未命名场景'
      const liveMode = req.body?.liveMode !== false
      const allowComment = req.body?.allowComment !== false
      const allowDownload = req.body?.allowDownload === true
      const pool = getPool()

      if (existing) {
        const fields = []
        const params = []
        let sceneUpdated = false
        if (req.body?.title !== undefined) {
          fields.push('title = ?')
          params.push(cleanText(req.body.title, TITLE_MAX) || '未命名场景')
        }
        if (req.body?.liveMode !== undefined) {
          fields.push('live_mode = ?')
          params.push(req.body.liveMode ? 1 : 0)
        }
        if (req.body?.allowComment !== undefined) {
          fields.push('allow_comment = ?')
          params.push(req.body.allowComment ? 1 : 0)
        }
        if (req.body?.allowDownload !== undefined) {
          fields.push('allow_download = ?')
          params.push(req.body.allowDownload ? 1 : 0)
        }
        if (sceneProvided && scene) {
          const projectKey =
            cleanText(scene.projectKey, 32) ||
            cleanText(existing.project_key, 32) ||
            randomKey(12)
          scene.projectKey = projectKey
          const sceneText = JSON.stringify(scene)
          fields.push(
            'project_key = ?',
            'scene_json = ?',
            'scene_size = ?',
            'scene_version = scene_version + 1',
            'revision = revision + 1',
          )
          params.push(
            projectKey,
            sceneText,
            Buffer.byteLength(sceneText),
          )
          sceneUpdated = true
        }
        if (!fields.length) {
          res.json(shareJson(existing, 0))
          return
        }
        params.push(existing.id)
        await pool.query(
          `UPDATE share_links SET ${fields.join(', ')} WHERE id = ?`,
          params,
        )
        const next = await loadShareByStorageSlotId(storageSlot.id)
        const meta = shareJson(next, await commentCount(next.id))
        if (sceneUpdated) {
          publish(channelKeyShare(next.token), {
            type: 'scene.reset',
            revision: meta.revision,
            sceneVersion: meta.sceneVersion,
          })
        }
        publish(channelKeyShare(next.token), { type: 'share.updated', share: meta })
        publish(channelKeyProject(next.project_key), {
          type: 'share.updated',
          share: meta,
        })
        res.json(meta)
        return
      }

      const projectKey =
        cleanText(req.body?.projectKey || scene?.projectKey, 32) ||
        randomKey(12)
      if (scene) scene.projectKey = projectKey
      const sceneText = JSON.stringify(scene)
      let token = newShareToken()
      for (let i = 0; i < 5; i++) {
        const [exists] = await pool.query(
          'SELECT id FROM share_links WHERE token = ? LIMIT 1',
          [token],
        )
        if (!exists.length) break
        token = newShareToken()
      }
      const [result] = await pool.query(
        `INSERT INTO share_links
          (token, owner_user_id, storage_slot_id, project_key, title, scene_json, scene_size, live_mode, allow_comment, allow_download)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          token,
          req.user.id,
          storageSlot.id,
          projectKey,
          title,
          sceneText,
          Buffer.byteLength(sceneText),
          liveMode ? 1 : 0,
          allowComment ? 1 : 0,
          allowDownload ? 1 : 0,
        ],
      )
      const share = await loadShareByStorageSlotId(storageSlot.id)
      if (!share) {
        res.status(500).json({ error: '创建分享链接失败' })
        return
      }
      const meta = shareJson(share, 0)
      publish(channelKeyProject(projectKey), { type: 'share.created', share: meta })
      res.status(201).json(meta)
    }),
  )

  app.get(
    '/api/storage/:slot/share',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const slotNumber = parseStorageSlot(req.params.slot)
      if (!slotNumber) {
        res.status(400).json({ error: `存储位置需为 1-${config.slotLimit}` })
        return
      }
      const storageSlot = await loadStorageSlot(req.user.id, slotNumber)
      if (!storageSlot) {
        res.status(404).json({ error: '该存储位置还没有云端存档' })
        return
      }
      const share = await loadShareByStorageSlotId(storageSlot.id)
      if (!share) {
        res.status(404).json({ error: '该存档还没有分享链接' })
        return
      }
      res.json(shareJson(share, await commentCount(share.id)))
    }),
  )

  app.post(
    '/api/shares',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const slotNumber = parseStorageSlot(req.body?.storageSlot)
      if (!slotNumber) {
        res.status(400).json({ error: '请先将场景保存到云端存档后再分享' })
        return
      }
      const storageSlot = await loadStorageSlot(req.user.id, slotNumber)
      if (!storageSlot) {
        res.status(404).json({ error: '该存储位置还没有云端存档' })
        return
      }
      const existing = await loadShareByStorageSlotId(storageSlot.id)
      if (existing) {
        res.json(shareJson(existing, await commentCount(existing.id)))
        return
      }
      const scene = req.body?.scene
      if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
        res.status(400).json({ error: '场景数据格式不正确' })
        return
      }
      if (!hasVenueContent(scene)) {
        res.status(400).json({ error: '场景还没有场馆内容，无法发布' })
        return
      }
      const text = JSON.stringify(scene)
      const size = Buffer.byteLength(text)
      if (size > config.maxSceneMb * 1024 * 1024) {
        res.status(413).json({ error: `场景超过 ${config.maxSceneMb}MB 上限` })
        return
      }

      const projectKey = cleanText(
        req.body?.projectKey || scene.projectKey,
        32,
      ) || randomKey(12)
      if (!scene.projectKey) scene.projectKey = projectKey
      const title =
        cleanText(req.body?.title, TITLE_MAX) ||
        cleanText(storageSlot.name, TITLE_MAX) ||
        '未命名场景'
      const liveMode = req.body?.liveMode !== false
      const allowComment = req.body?.allowComment !== false
      const allowDownload = req.body?.allowDownload === true
      const pool = getPool()

      let token = newShareToken()
      for (let i = 0; i < 5; i++) {
        const [exists] = await pool.query('SELECT id FROM share_links WHERE token = ? LIMIT 1', [token])
        if (!exists.length) break
        token = newShareToken()
      }

      await pool.query(
        `INSERT INTO share_links
          (token, owner_user_id, storage_slot_id, project_key, title, scene_json, scene_size, live_mode, allow_comment, allow_download)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          token,
          req.user.id,
          storageSlot.id,
          projectKey,
          title,
          JSON.stringify(scene),
          Buffer.byteLength(JSON.stringify(scene)),
          liveMode ? 1 : 0,
          allowComment ? 1 : 0,
          allowDownload ? 1 : 0,
        ],
      )
      const share = await loadShareByStorageSlotId(storageSlot.id)
      if (!share) {
        res.status(500).json({ error: '创建分享链接失败' })
        return
      }
      const meta = shareJson(share, 0)
      publish(channelKeyProject(projectKey), { type: 'share.created', share: meta })
      res.status(201).json(meta)
    }),
  )

  app.get(
    '/api/shares',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const rawProjectKey = req.query.projectKey
      const projectKey =
        rawProjectKey === undefined
          ? ''
          : cleanText(rawProjectKey, 32)
      if (rawProjectKey !== undefined && !projectKey) {
        res.status(400).json({ error: '项目标识不正确' })
        return
      }
      const rawStorageSlot = req.query.storageSlot
      const storageSlot =
        rawStorageSlot === undefined ? null : parseStorageSlot(rawStorageSlot)
      if (rawStorageSlot !== undefined && !storageSlot) {
        res.status(400).json({ error: '存储位置不正确' })
        return
      }
      const pool = getPool()
      const params = [req.user.id]
      let sql = `SELECT s.*, st.slot AS storage_slot, st.name AS storage_name
                   FROM share_links s
                   LEFT JOIN storage_slots st ON st.id = s.storage_slot_id
                  WHERE s.owner_user_id = ?`
      if (projectKey) {
        sql += ' AND s.project_key = ?'
        params.push(projectKey)
      }
      if (storageSlot) {
        sql += ' AND st.slot = ?'
        params.push(storageSlot)
      }
      sql += ' ORDER BY s.created_at DESC LIMIT 50'
      const [rows] = await pool.query(sql, params)
      const counts = new Map()
      if (rows.length) {
        const ids = rows.map((r) => r.id)
        const [grouped] = await pool.query(
          `SELECT share_id, COUNT(*) AS n FROM share_comments
           WHERE share_id IN (?) AND deleted_at IS NULL GROUP BY share_id`,
          [ids],
        )
        for (const g of grouped) counts.set(Number(g.share_id), Number(g.n))
      }
      res.json({
        shares: rows.map((row) => shareJson(row, counts.get(Number(row.id)) ?? 0)),
      })
    }),
  )

  app.get(
    '/api/shares/:token',
    requireDb,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      res.json(shareJson(share, await commentCount(share.id)))
    }),
  )

  app.get(
    '/api/shares/:token/scene',
    requireDb,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      let scene
      try {
        scene = JSON.parse(share.scene_json)
      } catch {
        res.status(500).json({ error: '分享场景数据已损坏' })
        return
      }
      await getPool().query('UPDATE share_links SET view_count = view_count + 1 WHERE id = ?', [share.id])
      res.json({ revision: Number(share.revision), sceneVersion: Number(share.scene_version), scene })
    }),
  )

  app.patch(
    '/api/shares/:token',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (Number(share.owner_user_id) !== req.user.id) {
        res.status(403).json({ error: '没有权限管理该链接' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }

      const pool = getPool()
      const fields = []
      const params = []
      if (req.body?.title !== undefined) {
        fields.push('title = ?')
        params.push(cleanText(req.body.title, TITLE_MAX) || '未命名场景')
      }
      if (req.body?.liveMode !== undefined) {
        fields.push('live_mode = ?')
        params.push(req.body.liveMode ? 1 : 0)
      }
      if (req.body?.allowComment !== undefined) {
        fields.push('allow_comment = ?')
        params.push(req.body.allowComment ? 1 : 0)
      }
      if (req.body?.allowDownload !== undefined) {
        fields.push('allow_download = ?')
        params.push(req.body.allowDownload ? 1 : 0)
      }

      let sceneUpdated = false
      if (req.body?.scene !== undefined) {
        const scene = req.body.scene
        if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
          res.status(400).json({ error: '场景数据格式不正确' })
          return
        }
        if (!hasVenueContent(scene)) {
          res.status(400).json({ error: '场景还没有场馆内容，无法发布' })
          return
        }
        const text = JSON.stringify(scene)
        if (Buffer.byteLength(text) > config.maxSceneMb * 1024 * 1024) {
          res.status(413).json({ error: `场景超过 ${config.maxSceneMb}MB 上限` })
          return
        }
        fields.push('scene_json = ?', 'scene_size = ?', 'scene_version = scene_version + 1', 'revision = revision + 1')
        params.push(text, Buffer.byteLength(text))
        sceneUpdated = true
      }

      if (!fields.length) {
        res.status(400).json({ error: '没有需要更新的字段' })
        return
      }

      params.push(share.id)
      await pool.query(`UPDATE share_links SET ${fields.join(', ')} WHERE id = ?`, params)
      const next = await loadShare(share.token)
      const meta = shareJson(next, await commentCount(next.id))
      if (sceneUpdated) {
        publish(channelKeyShare(next.token), {
          type: 'scene.reset',
          revision: meta.revision,
          sceneVersion: meta.sceneVersion,
        })
      }
      publish(channelKeyShare(next.token), { type: 'share.updated', share: meta })
      publish(channelKeyProject(next.project_key), { type: 'share.updated', share: meta })
      res.json(meta)
    }),
  )

  app.delete(
    '/api/shares/:token',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (Number(share.owner_user_id) !== req.user.id) {
        res.status(403).json({ error: '没有权限撤销该链接' })
        return
      }
      // 一条链接只属于一个云端存档；撤销即删除，重新分享会生成新 token。
      await getPool().query('DELETE FROM share_links WHERE id = ?', [share.id])
      closeChannel(channelKeyShare(share.token), { type: 'revoked' })
      publish(channelKeyProject(share.project_key), {
        type: 'share.revoked',
        shareToken: share.token,
      })
      res.json({ ok: true })
    }),
  )

  /* ---------------- 实时场景 ---------------- */

  app.patch(
    '/api/shares/:token/live',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (Number(share.owner_user_id) !== req.user.id) {
        res.status(403).json({ error: '没有权限写入该链接' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      if (!share.live_mode) {
        res.status(409).json({ error: '该链接已冻结，不再接收实时更新', frozen: true })
        return
      }
      const baseRevision = Number(req.body?.baseRevision)
      if (baseRevision !== Number(share.revision)) {
        res.status(409).json({ error: '场景版本已变化，请重新同步', revision: Number(share.revision) })
        return
      }
      const patch = req.body?.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        res.status(400).json({ error: '补丁格式不正确' })
        return
      }
      if (patch.venue !== undefined && !hasVenueContent({ venue: patch.venue })) {
        res.status(400).json({ error: '场景还没有场馆内容，无法实时同步' })
        return
      }
      const patchSize = Buffer.byteLength(JSON.stringify(patch))
      if (patchSize > 4 * 1024 * 1024) {
        res.status(413).json({ error: '单次更新过大' })
        return
      }

      let scene
      try {
        scene = JSON.parse(share.scene_json)
      } catch {
        res.status(500).json({ error: '分享场景数据已损坏' })
        return
      }
      let nextScene
      try {
        nextScene = applyScenePatch(scene, patch)
      } catch (err) {
        res.status(400).json({ error: err.message || '补丁无法应用' })
        return
      }
      const text = JSON.stringify(nextScene)
      if (Buffer.byteLength(text) > config.maxSceneMb * 1024 * 1024) {
        res.status(413).json({ error: `场景超过 ${config.maxSceneMb}MB 上限` })
        return
      }

      const revision = Number(share.revision) + 1
      await getPool().query(
        'UPDATE share_links SET scene_json = ?, scene_size = ?, revision = ? WHERE id = ?',
        [text, Buffer.byteLength(text), revision, share.id],
      )
      publish(channelKeyShare(share.token), { type: 'scene.patch', revision, patch })
      res.json({ revision })
    }),
  )

  app.get(
    '/api/shares/:token/live',
    requireDb,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      const since = Number(req.query.since)
      if (Number.isFinite(since) && since === Number(share.revision)) {
        res.json({ revision: Number(share.revision), scene: null })
        return
      }
      let scene
      try {
        scene = JSON.parse(share.scene_json)
      } catch {
        res.status(500).json({ error: '分享场景数据已损坏' })
        return
      }
      res.json({ revision: Number(share.revision), scene })
    }),
  )

  /* ---------------- 评论 ---------------- */

  app.get(
    '/api/shares/:token/comments',
    requireDb,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      const user = readAuthUser(req)
      const pool = getPool()
      const [rows] = await pool.query(
        'SELECT * FROM share_comments WHERE share_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 500',
        [share.id],
      )
      const eventsByComment = await loadCommentEvents(
        share.id,
        rows.map((row) => row.id),
        user?.id ?? null,
      )
      res.json({
        comments: rows.map((row) =>
          commentJson(
            row,
            share,
            !!user && Number(row.author_user_id) === user.id,
            eventsByComment.get(Number(row.id)) ?? [],
          ),
        ),
      })
    }),
  )

  app.post(
    '/api/shares/:token/comments',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const ip = req.ip || req.socket?.remoteAddress || 'unknown'
      if (!allowRate(`c:${ip}:${req.params.token}`, 30, 60_000)) {
        res.status(429).json({ error: '评论太频繁，请稍后再试' })
        return
      }
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      if (!share.allow_comment) {
        res.status(403).json({ error: '该链接未开放评论' })
        return
      }

      const content = cleanText(req.body?.content, COMMENT_MAX)
      if (!content) {
        res.status(400).json({ error: '评论内容不能为空' })
        return
      }
      const user = req.user
      const anchor = parseAnchor(req.body?.anchor)
      if (Buffer.byteLength(JSON.stringify(anchor)) > 8 * 1024) {
        res.status(413).json({ error: '评论锚点过大' })
        return
      }
      const parentIdRaw = Number(req.body?.parentId)
      let parentId = Number.isFinite(parentIdRaw) && parentIdRaw > 0 ? parentIdRaw : null
      const replyToIdRaw = Number(req.body?.replyToId)
      const replyToId =
        Number.isFinite(replyToIdRaw) && replyToIdRaw > 0 ? replyToIdRaw : null
      let replyToUserId = null
      let replyToName = ''
      if (replyToId) {
        const target = await loadComment(share.id, replyToId)
        if (!target || target.deleted_at) {
          res.status(400).json({ error: '回复的目标评论不存在' })
          return
        }
        if (!target.author_user_id && target.author_token) {
          res.status(400).json({ error: '历史匿名评论不可回复' })
          return
        }
        // 始终回到根评论线程，reply_to_* 单独记录“回复给谁”
        parentId = target.parent_id ? Number(target.parent_id) : Number(target.id)
        replyToUserId = target.author_user_id ? Number(target.author_user_id) : null
        replyToName = cleanText(target.author_name, NAME_MAX) || '登录用户'
      } else if (parentId) {
        const parent = await loadComment(share.id, parentId)
        if (!parent) {
          res.status(400).json({ error: '回复的评论不存在' })
          return
        }
        if (!parent.author_user_id && parent.author_token) {
          res.status(400).json({ error: '历史匿名评论不可回复' })
          return
        }
        replyToUserId = parent.author_user_id ? Number(parent.author_user_id) : null
        replyToName = cleanText(parent.author_name, NAME_MAX) || '登录用户'
      }
      const authorName = cleanText(user.username, NAME_MAX) || '登录用户'
      const clientId = cleanText(req.body?.clientId, 32)
      const pool = getPool()
      const [result] = await pool.query(
        `INSERT INTO share_comments
          (share_id, parent_id, anchor_json, scene_version, author_token, author_name, author_user_id, reply_to_user_id, reply_to_name, content, client_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          share.id,
          parentId,
          JSON.stringify(anchor),
          Number(share.scene_version),
          '',
          authorName,
          user.id,
          replyToUserId,
          replyToName,
          content,
          clientId,
        ],
      )
      const row = await loadComment(share.id, result.insertId)
      const comment = commentJson(row, share, true)
      // 广播时不带 mine：mine 只对当前请求者有意义，客户端自行判定归属
      publishComment(share, { ...comment, mine: false })
      res.status(201).json({ comment })
    }),
  )

  app.patch(
    '/api/shares/:token/comments/:id',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      const commentId = Number(req.params.id)
      const row = await loadComment(share.id, commentId)
      if (!row || row.deleted_at) {
        res.status(404).json({ error: '评论不存在' })
        return
      }
      const user = req.user
      const isOwner = Number(share.owner_user_id) === user.id
      const isAuthor = !!row.author_user_id && Number(row.author_user_id) === user.id
      if (!isOwner && !isAuthor) {
        res.status(403).json({ error: '没有权限修改该评论' })
        return
      }
      // 关闭评论后分享页只读；作者仍可在编辑器管理已有评论
      if (!share.allow_comment && !isOwner) {
        res.status(403).json({ error: '该链接未开放评论' })
        return
      }

      const actorName =
        cleanText(user.username, NAME_MAX) || (isOwner ? '作者' : '登录用户')
      const actorRole = isOwner ? 'owner' : 'visitor'
      const fields = []
      const params = []
      if (req.body?.content !== undefined) {
        const content = cleanText(req.body.content, COMMENT_MAX)
        if (!content) {
          res.status(400).json({ error: '评论内容不能为空' })
          return
        }
        fields.push('content = ?')
        params.push(content)
      }

      let stateChanged = false
      let nextResolved = !!row.resolved_at
      if (req.body?.resolved !== undefined) {
        nextResolved = req.body.resolved === true
        stateChanged = nextResolved !== !!row.resolved_at
        if (stateChanged) {
          if (nextResolved) {
            fields.push('resolved_at = NOW()', 'resolved_by = ?')
            params.push(actorName)
          } else {
            fields.push('resolved_at = NULL', 'resolved_by = ?')
            params.push('')
          }
        }
      }

      if (!fields.length) {
        const events = await eventsForComment(share.id, row.id, user.id)
        res.json({
          comment: commentJson(row, share, isAuthor, events),
        })
        return
      }

      const pool = getPool()
      const conn = await pool.getConnection()
      let activity = null
      try {
        await conn.beginTransaction()
        params.push(row.id)
        await conn.query(
          `UPDATE share_comments SET ${fields.join(', ')} WHERE id = ?`,
          params,
        )
        if (stateChanged) {
          const [inserted] = await conn.query(
            `INSERT INTO share_comment_events
              (share_id, comment_id, action, actor_user_id, actor_name, actor_role)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              share.id,
              row.id,
              nextResolved ? 'resolved' : 'unresolved',
              user.id,
              actorName,
              actorRole,
            ],
          )
          const [eventRows] = await conn.query(
            'SELECT * FROM share_comment_events WHERE id = ? LIMIT 1',
            [inserted.insertId],
          )
          activity = eventJson(eventRows[0], [], user.id)
        }
        await conn.commit()
      } catch (error) {
        await conn.rollback()
        throw error
      } finally {
        conn.release()
      }

      const next = await loadComment(share.id, row.id)
      const events = await eventsForComment(share.id, row.id, user.id)
      const comment = commentJson(next, share, isAuthor, events)
      publishCommentUpdate(
        share,
        { ...comment, mine: false },
        {
          actorUserId: user.id,
          actorRole,
          ...(activity ? { activity: { ...activity, mine: false } } : {}),
        },
      )
      res.json({ comment, ...(activity ? { activity } : {}) })
    }),
  )

  app.post(
    '/api/shares/:token/comments/:id/events/:eventId/replies',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const ip = req.ip || req.socket?.remoteAddress || 'unknown'
      if (!allowRate(`er:${ip}:${req.params.token}`, 30, 60_000)) {
        res.status(429).json({ error: '回复太频繁，请稍后再试' })
        return
      }
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      const isOwner = Number(share.owner_user_id) === req.user.id
      if (!share.allow_comment && !isOwner) {
        res.status(403).json({ error: '该链接未开放评论' })
        return
      }
      const comment = await loadComment(share.id, Number(req.params.id))
      if (!comment || comment.deleted_at) {
        res.status(404).json({ error: '评论不存在' })
        return
      }
      const event = await loadCommentEvent(
        share.id,
        comment.id,
        Number(req.params.eventId),
      )
      if (!event) {
        res.status(404).json({ error: '解决记录不存在' })
        return
      }
      const content = cleanText(req.body?.content, COMMENT_MAX)
      if (!content) {
        res.status(400).json({ error: '回复内容不能为空' })
        return
      }
      const clientId = cleanText(req.body?.clientId, 32)
      const actorName =
        cleanText(req.user.username, NAME_MAX) || (isOwner ? '作者' : '登录用户')
      const actorRole = isOwner ? 'owner' : 'visitor'
      const pool = getPool()
      if (clientId) {
        const [existing] = await pool.query(
          `SELECT * FROM share_comment_event_replies
            WHERE event_id = ? AND actor_user_id = ? AND client_id = ?
            LIMIT 1`,
          [event.id, req.user.id, clientId],
        )
        if (existing.length) {
          res.status(200).json({
            reply: eventReplyJson(existing[0], req.user.id),
          })
          return
        }
      }
      const [inserted] = await pool.query(
        `INSERT INTO share_comment_event_replies
          (event_id, actor_user_id, actor_name, actor_role, content, client_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [event.id, req.user.id, actorName, actorRole, content, clientId],
      )
      const replyRow = await loadEventReply(event.id, inserted.insertId)
      const reply = eventReplyJson(replyRow, req.user.id)
      publishEventReply(
        share,
        Number(comment.id),
        event,
        { ...reply, mine: false },
        { actorUserId: req.user.id, actorRole },
      )
      res.status(201).json({ reply })
    }),
  )

  app.delete(
    '/api/shares/:token/comments/:id/events/:eventId/replies/:replyId',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      const isOwner = Number(share.owner_user_id) === req.user.id
      if (!share.allow_comment && !isOwner) {
        res.status(403).json({ error: '该链接未开放评论' })
        return
      }
      const comment = await loadComment(share.id, Number(req.params.id))
      if (!comment || comment.deleted_at) {
        res.status(404).json({ error: '评论不存在' })
        return
      }
      const event = await loadCommentEvent(
        share.id,
        comment.id,
        Number(req.params.eventId),
      )
      if (!event) {
        res.status(404).json({ error: '解决记录不存在' })
        return
      }
      const replyRow = await loadEventReply(
        event.id,
        Number(req.params.replyId),
      )
      if (!replyRow) {
        res.status(404).json({ error: '回复不存在' })
        return
      }
      const isReplyAuthor =
        !!replyRow.actor_user_id &&
        Number(replyRow.actor_user_id) === req.user.id
      if (!isOwner && !isReplyAuthor) {
        res.status(403).json({ error: '没有权限删除该回复' })
        return
      }
      const reply = eventReplyJson(replyRow, req.user.id)
      await getPool().query(
        'DELETE FROM share_comment_event_replies WHERE id = ?',
        [replyRow.id],
      )
      publishEventReplyDelete(
        share,
        Number(comment.id),
        event.id,
        { ...reply, mine: false },
        {
          actorUserId: req.user.id,
          actorRole: isOwner ? 'owner' : 'visitor',
          replyAuthorUserId: replyRow.actor_user_id
            ? Number(replyRow.actor_user_id)
            : null,
          replyAuthorName: reply.actorName,
        },
      )
      res.json({ ok: true })
    }),
  )

  app.delete(
    '/api/shares/:token/comments/:id',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      const row = await loadComment(share.id, Number(req.params.id))
      if (!row || row.deleted_at) {
        res.status(404).json({ error: '评论不存在' })
        return
      }
      const user = req.user
      const isOwner = Number(share.owner_user_id) === user.id
      const isAuthor = !!row.author_user_id && Number(row.author_user_id) === user.id
      if (!isOwner && !isAuthor) {
        res.status(403).json({ error: '没有权限删除该评论' })
        return
      }
      if (!share.allow_comment && !isOwner) {
        res.status(403).json({ error: '该链接未开放评论' })
        return
      }
      const pool = getPool()
      // 删除主评论时一并软删回复，避免刷新后回复变成无主评论
      const [children] = row.parent_id
        ? [[]]
        : await pool.query(
            'SELECT id FROM share_comments WHERE share_id = ? AND parent_id = ? AND deleted_at IS NULL',
            [share.id, row.id],
          )
      await pool.query(
        'UPDATE share_comments SET deleted_at = NOW() WHERE share_id = ? AND (id = ? OR parent_id = ?)',
        [share.id, row.id, row.id],
      )
      const deleteMeta = {
        actorUserId: user.id,
        actorRole: isOwner ? 'owner' : 'visitor',
      }
      publishCommentDelete(share, Number(row.id), deleteMeta)
      for (const child of children) {
        publishCommentDelete(share, Number(child.id), deleteMeta)
      }
      res.json({ ok: true })
    }),
  )

  /* ---------------- 编辑器聚合 ---------------- */

  app.get(
    '/api/review/comments',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const projectKey = cleanText(req.query.projectKey, 32)
      if (!projectKey) {
        res.status(400).json({ error: '缺少项目标识' })
        return
      }
      const pool = getPool()
      const [shares] = await pool.query(
        `SELECT * FROM share_links
         WHERE owner_user_id = ? AND project_key = ? AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 20`,
        [req.user.id, projectKey],
      )
      if (!shares.length) {
        res.json({ links: [], comments: [], unresolved: 0 })
        return
      }
      const ids = shares.map((s) => s.id)
      const [rows] = await pool.query(
        `SELECT * FROM share_comments
         WHERE share_id IN (?) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 500`,
        [ids],
      )
      const byId = new Map(shares.map((s) => [Number(s.id), s]))
      const comments = rows.map((row) => {
        const share = byId.get(Number(row.share_id))
        return commentJson(row, share, Number(row.author_user_id) === req.user.id)
      })
      res.json({
        links: shares.map((s) => shareJson(s, 0)),
        comments,
        unresolved: comments.filter((c) => !c.resolvedAt).length,
      })
    }),
  )

  /* ---------------- SSE ticket 与流 ---------------- */

  app.post(
    '/api/shares/:token/stream-ticket',
    requireDb,
    wrap(async (req, res) => {
      const ip = req.ip || req.socket?.remoteAddress || 'unknown'
      if (!allowRate(`t:${ip}`, 60, 60_000)) {
        res.status(429).json({ error: '请求太频繁' })
        return
      }
      const share = await loadShare(req.params.token)
      if (!share) {
        res.status(404).json({ error: '分享链接不存在' })
        return
      }
      if (share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      const ticket = issueTicket({ kind: 'share', token: share.token })
      res.json({ ticket, expiresIn: Math.floor(TICKET_TTL / 1000) })
    }),
  )

  app.get(
    '/api/shares/:token/stream',
    requireDb,
    wrap(async (req, res) => {
      const data = readTicket(req.query.ticket, 'share')
      if (!data || data.token !== req.params.token) {
        res.status(401).json({ error: '实时连接凭证无效' })
        return
      }
      const share = await loadShare(req.params.token)
      if (!share || share.revoked_at) {
        res.status(410).json({ error: '分享链接已撤销', revoked: true })
        return
      }
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders?.()
      subscribe(channelKeyShare(share.token), res, {
        type: 'hello',
        revision: Number(share.revision),
        viewerCount: viewerCount(share.token) + 1,
      })
    }),
  )

  app.post(
    '/api/review/stream-ticket',
    requireDb,
    requireAuth,
    wrap(async (req, res) => {
      const projectKey = cleanText(req.body?.projectKey, 32)
      if (!projectKey) {
        res.status(400).json({ error: '缺少项目标识' })
        return
      }
      const [owned] = await getPool().query(
        `SELECT 1 FROM share_links
         WHERE owner_user_id = ? AND project_key = ? AND revoked_at IS NULL
         LIMIT 1`,
        [req.user.id, projectKey],
      )
      if (!owned.length) {
        res.status(403).json({ error: '没有该项目的有效分享链接' })
        return
      }
      const ticket = issueTicket({ kind: 'project', projectKey, uid: req.user.id })
      res.json({ ticket, expiresIn: Math.floor(TICKET_TTL / 1000) })
    }),
  )

  app.get(
    '/api/review/stream',
    requireDb,
    wrap(async (req, res) => {
      const data = readTicket(req.query.ticket, 'project')
      if (!data) {
        res.status(401).json({ error: '实时连接凭证无效' })
        return
      }
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders?.()
      subscribe(channelKeyProject(data.projectKey), res, { type: 'hello' })
    }),
  )

  /* ---------------- 清理 ---------------- */

  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [key, value] of tickets) if (value.exp < now) tickets.delete(key)
    for (const [key, list] of rateBuckets) {
      const next = list.filter((t) => now - t < 65_000)
      if (next.length) rateBuckets.set(key, next)
      else rateBuckets.delete(key)
    }
  }, 60_000)
  cleanup.unref?.()
}
