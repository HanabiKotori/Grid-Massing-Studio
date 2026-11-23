import { readFile } from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { ROOT, config } from './config.mjs'

let pool = null

/** 去掉注释行后按分号拆分 SQL，避免依赖 multipleStatements */
function splitSql(raw) {
  const lines = raw
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
  return lines
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

/** 建库（有权限时）、建连接池并确保表结构存在 */
export async function initDatabase() {
  const { host, port, user, password, name, connectionLimit } = config.database
  if (!user) throw new Error('未配置 DB_USER')
  if (!password || password === 'change-me') {
    console.warn('[dataService] DB_PASSWORD 为空或仍是示例值 change-me，请填写真实数据库密码')
  }

  const base = { host, port, user, password, connectTimeout: 8000 }

  // 库已存在且有权限时直接连接；只有库不存在才尝试建库
  try {
    const existing = await mysql.createConnection({ ...base, database: name })
    await existing.end()
  } catch (err) {
    if (err?.code !== 'ER_BAD_DB_ERROR') throw err
    const admin = await mysql.createConnection(base)
    try {
      await admin.query(
        `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      )
    } finally {
      await admin.end()
    }
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database: name,
    waitForConnections: true,
    connectionLimit,
    charset: 'utf8mb4_unicode_ci',
    connectTimeout: 8000,
    enableKeepAlive: true,
  })

  const schema = await readFile(path.join(ROOT, 'schema.sql'), 'utf8')
  for (const statement of splitSql(schema)) {
    await pool.query(statement)
  }
  // 已有 share_comments 表不会因 CREATE TABLE IF NOT EXISTS 自动加列
  const [replyColumns] = await pool.query(
    "SHOW COLUMNS FROM share_comments LIKE 'reply_to_%'",
  )
  const columnNames = new Set(replyColumns.map((row) => row.Field))
  if (!columnNames.has('reply_to_user_id')) {
    await pool.query(
      'ALTER TABLE share_comments ADD COLUMN reply_to_user_id BIGINT UNSIGNED NULL AFTER author_user_id',
    )
  }
  if (!columnNames.has('reply_to_name')) {
    await pool.query(
      "ALTER TABLE share_comments ADD COLUMN reply_to_name VARCHAR(32) NOT NULL DEFAULT '' AFTER reply_to_user_id",
    )
  }

  // 分享链接绑定云端存档实例：每个 storage_slots.id 最多一条有效链接
  const [shareSlotColumns] = await pool.query(
    "SHOW COLUMNS FROM share_links LIKE 'storage_slot_id'",
  )
  if (!shareSlotColumns.length) {
    await pool.query(
      'ALTER TABLE share_links ADD COLUMN storage_slot_id BIGINT UNSIGNED NULL AFTER owner_user_id',
    )
  }
  const [shareSlotIndexes] = await pool.query(
    "SHOW INDEX FROM share_links WHERE Column_name = 'storage_slot_id' AND Non_unique = 0",
  )
  if (!shareSlotIndexes.length) {
    await pool.query(
      'ALTER TABLE share_links ADD UNIQUE KEY uk_share_storage_slot (storage_slot_id)',
    )
  }
  const [shareSlotFks] = await pool.query(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'share_links'
        AND COLUMN_NAME = 'storage_slot_id'
        AND REFERENCED_TABLE_NAME = 'storage_slots'
      LIMIT 1`,
  )
  if (!shareSlotFks.length) {
    await pool.query(
      `ALTER TABLE share_links
         ADD CONSTRAINT fk_share_storage_slot
         FOREIGN KEY (storage_slot_id) REFERENCES storage_slots (id) ON DELETE CASCADE`,
    )
  }
  return pool
}

export function getPool() {
  if (!pool) throw new Error('数据库尚未初始化')
  return pool
}

export async function closeDatabase() {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
}
