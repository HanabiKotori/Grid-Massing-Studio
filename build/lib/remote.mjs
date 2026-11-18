import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ssh2 from 'ssh2'

const { Client } = ssh2

export const log = {
  step(message) {
    console.log(`\n==> ${message}`)
  },
  ok(message) {
    console.log(`  + ${message}`)
  },
  info(message) {
    console.log(`    ${message}`)
  },
  warn(message) {
    console.log(`  ! ${message}`)
  },
  error(message) {
    console.error(`\n[x] ${message}`)
  },
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set()
  const options = new Map()

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    if (eq === -1) {
      flags.add(body)
    } else {
      options.set(body.slice(0, eq), body.slice(eq + 1))
    }
  }

  return {
    has: (name) => flags.has(name),
    get: (name, fallback) => (options.has(name) ? options.get(name) : fallback),
  }
}

export function loadConfig(buildDir, args) {
  const fileName = args.get('config', 'deploy.config.json')
  const configPath = path.resolve(buildDir, fileName)

  if (!fs.existsSync(configPath)) {
    throw new Error(
      [
        `找不到配置文件：${configPath}`,
        `请复制同目录下的 deploy.config.example.json 为 ${fileName}，再填写服务器地址与密码`,
      ].join('\n'),
    )
  }

  let config
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`配置文件不是合法 JSON：${configPath}\n${error.message}`)
  }

  return { config, configPath }
}

export function requireSsh(config) {
  const ssh = config.ssh || {}
  const missing = ['host', 'password'].filter((key) => !ssh[key])

  if (missing.length) {
    throw new Error(`配置文件 ssh 缺少字段：${missing.join(', ')}`)
  }

  return {
    host: String(ssh.host),
    port: Number(ssh.port) || 22,
    username: String(ssh.username || 'root'),
    password: String(ssh.password),
  }
}

export function requireRemotePath(value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`配置文件 ${label}.remotePath 未填写`)
  }
  if (!value.startsWith('/')) {
    throw new Error(`${label}.remotePath 必须是绝对路径，当前：${value}`)
  }
  return value.replace(/\/+$/, '') || '/'
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function connect(ssh, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      client.removeAllListeners()
      client.end()
      reject(error)
    }

    client.once('ready', () => {
      if (settled) return
      settled = true
      client.on('error', (error) => log.warn(`SSH 连接异常：${error.message}`))
      resolve(client)
    })

    client.once('error', (error) => fail(new Error(`SSH 连接失败：${error.message}`)))

    client.connect({
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      password: ssh.password,
      readyTimeout: timeout,
      keepaliveInterval: 15000,
    })
  })
}

export function exec(client, command, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    client.exec(`bash -lc ${shellQuote(command)}`, (error, stream) => {
      if (error) {
        reject(new Error(`执行远程命令失败：${error.message}`))
        return
      }

      let stdout = ''
      let stderr = ''

      stream.on('data', (chunk) => {
        stdout += chunk.toString('utf8')
      })
      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8')
      })
      stream.on('close', (code) => {
        if (code !== 0 && !allowFail) {
          const detail = (stderr || stdout).trim()
          reject(new Error(`远程命令退出码 ${code}：${command}${detail ? `\n${detail}` : ''}`))
          return
        }
        resolve({ code: Number(code) || 0, stdout, stderr })
      })
    })
  })
}

function openSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) reject(new Error(`打开 SFTP 失败：${error.message}`))
      else resolve(sftp)
    })
  })
}

function fastPut(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (error) => {
      if (error) reject(new Error(`上传失败 ${path.basename(local)}：${error.message}`))
      else resolve()
    })
  })
}

export async function walkFiles(root) {
  const files = []

  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const local = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(local)
      } else if (entry.isFile()) {
        files.push({
          local,
          relative: path.relative(root, local).split(path.sep).join('/'),
        })
      }
    }
  }

  await walk(root)
  return files.sort((a, b) => a.relative.localeCompare(b.relative))
}

export async function uploadFiles(client, files, { concurrency = 4, onProgress } = {}) {
  if (!files.length) return 0

  const sftp = await openSftp(client)

  try {
    const dirs = [...new Set(files.map((file) => path.posix.dirname(file.remote)))]
      .filter((dir) => dir && dir !== '.' && dir !== '/')

    for (let index = 0; index < dirs.length; index += 40) {
      const batch = dirs.slice(index, index + 40).map(shellQuote).join(' ')
      await exec(client, `mkdir -p ${batch}`)
    }

    let cursor = 0
    let finished = 0
    const workers = Math.min(concurrency, files.length)

    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (cursor < files.length) {
          const file = files[cursor]
          cursor += 1
          await fastPut(sftp, file.local, file.remote)
          finished += 1
          onProgress?.(finished, files.length)
        }
      }),
    )

    return finished
  } finally {
    sftp.end()
  }
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export async function remoteSha256(client, remotePaths) {
  const result = new Map()
  if (!remotePaths.length) return result

  const { stdout } = await exec(
    client,
    `sha256sum ${remotePaths.map(shellQuote).join(' ')} 2>/dev/null || true`,
    { allowFail: true },
  )

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+(.+)$/)
    if (match) result.set(match[2], match[1])
  }

  return result
}

export async function countRemoteFiles(client, dir) {
  const { stdout } = await exec(
    client,
    `find ${shellQuote(dir)} -type f 2>/dev/null | wc -l`,
    { allowFail: true },
  )
  return Number(stdout.trim()) || 0
}
