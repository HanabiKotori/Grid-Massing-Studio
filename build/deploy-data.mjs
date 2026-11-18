import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  connect,
  delay,
  exec,
  formatBytes,
  loadConfig,
  log,
  parseArgs,
  remoteSha256,
  requireRemotePath,
  requireSsh,
  sha256File,
  shellQuote,
  uploadFiles,
  walkFiles,
} from './lib/remote.mjs'

const buildDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(buildDir, '..')

// 宝塔 / nvm 安装的 node、pm2 可能不在非交互式 SSH 的 PATH 里
const NODE_PATH_FIX =
  'for d in /www/server/nodejs/*/bin /root/.nvm/versions/node/*/bin /usr/local/node*/bin; do ' +
  'if [ -d "$d" ]; then case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac; fi; done; export PATH'

const DEFAULT_INCLUDE = [
  'server.mjs',
  'schema.sql',
  'package.json',
  'package-lock.json',
  'src',
]

function withNodeEnv(command, pathPrefix) {
  const prefix = pathPrefix ? String(pathPrefix) : NODE_PATH_FIX
  return `${prefix}\n${command}`
}

function parseJsonArray(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function describe(proc) {
  const env = proc.pm2_env || {}
  const uptime = env.pm_uptime
    ? `${Math.max(0, Math.round((Date.now() - Number(env.pm_uptime)) / 1000))}s`
    : '-'
  return `${proc.name} | status=${env.status || '-'} | pid=${proc.pid || '-'} | restarts=${env.restart_time ?? 0} | uptime=${uptime}`
}

/** 收集 dataService 的文件与子目录，跳过 node_modules 等 */
async function collectLocalFiles(localDir, include, uploadEnv) {
  const names = [...include]
  if (uploadEnv) names.push('.env')

  const files = []
  const seen = new Set()

  for (const name of names) {
    const local = path.resolve(localDir, name)
    if (!fs.existsSync(local)) {
      log.warn(`本地文件不存在，已跳过：${local}`)
      continue
    }

    const stat = fs.statSync(local)
    if (stat.isDirectory()) {
      const nested = await walkFiles(local)
      for (const item of nested) {
        const relative = path.posix.join(name.split(path.sep).join('/'), item.relative)
        if (seen.has(relative)) continue
        seen.add(relative)
        files.push({
          name: relative,
          local: item.local,
          remote: path.posix.join('/__REMOTE__', relative),
        })
      }
    } else if (stat.isFile()) {
      const relative = name.split(path.sep).join('/')
      if (seen.has(relative)) continue
      seen.add(relative)
      files.push({
        name: relative,
        local,
        remote: path.posix.join('/__REMOTE__', relative),
      })
    }
  }

  return files
}

async function main() {
  const args = parseArgs()
  const { config, configPath } = loadConfig(buildDir, args)
  const ssh = requireSsh(config)
  const data = config.data || {}
  const remotePath = requireRemotePath(
    data.remotePath || '/www/wwwroot/数据',
    'data',
  )
  const localDir = path.resolve(projectRoot, data.localDir || 'dataService')
  const pm2Name = String(data.pm2Name || 'grid-massing-data')
  const entry = String(data.entry || 'server.mjs')
  const installDeps = data.installDeps !== false
  const restartMode = ['auto', 'always', 'never'].includes(data.restartMode)
    ? data.restartMode
    : 'auto'
  const uploadEnv = data.uploadEnv !== false
  const include = Array.isArray(data.include) && data.include.length
    ? data.include.map(String)
    : DEFAULT_INCLUDE
  const healthUrl = String(data.healthUrl || 'http://127.0.0.1:3020/api/health')
  const startedAt = Date.now()

  log.step(`配置文件：${configPath}`)
  log.info(`服务器：${ssh.username}@${ssh.host}:${ssh.port}`)
  log.info(`云存储服务目录：${remotePath}`)
  log.info(`PM2 进程名：${pm2Name}`)
  log.info(`上传 .env：${uploadEnv ? '是' : '否'}`)

  const localFiles = await collectLocalFiles(localDir, include, uploadEnv)
  if (!localFiles.length) {
    throw new Error(`没有可上传的文件，请检查 data.localDir：${localDir}`)
  }

  for (const file of localFiles) {
    file.remote = path.posix.join(remotePath, file.name)
  }

  log.step(
    `本地文件 ${localFiles.length} 个，共 ${formatBytes(
      localFiles.reduce((sum, file) => sum + fs.statSync(file.local).size, 0),
    )}`,
  )

  if (args.has('dry-run')) {
    for (const file of localFiles) {
      log.info(`${file.name}  ${formatBytes(fs.statSync(file.local).size)}`)
    }
    log.warn('dry-run 模式，未连接服务器')
    return
  }

  const client = await connect(ssh)
  log.ok('SSH 连接成功')

  try {
    await exec(client, `mkdir -p ${shellQuote(remotePath)}`)

    log.step('比对远端文件')
    const remoteHashes = await remoteSha256(
      client,
      localFiles.map((file) => file.remote),
    )
    const changed = localFiles.filter(
      (file) => remoteHashes.get(file.remote) !== sha256File(file.local),
    )
    const changedNames = new Set(changed.map((file) => file.name))

    if (!changed.length) {
      log.ok('远端文件与本地一致，跳过上传')
    } else {
      log.info(`需要更新：${[...changedNames].slice(0, 8).join(', ')}${changedNames.size > 8 ? ` 等 ${changedNames.size} 个` : ''}`)
      await uploadFiles(client, changed, { concurrency: 3 })
      log.ok(`已上传 ${changed.length} 个文件`)
    }

    let needsInstall =
      installDeps &&
      (changedNames.has('package.json') || changedNames.has('package-lock.json'))

    if (installDeps && !needsInstall) {
      const probe = await exec(
        client,
        `test -d ${shellQuote(path.posix.join(remotePath, 'node_modules'))} && echo yes || echo no`,
        { allowFail: true },
      )
      needsInstall = probe.stdout.trim() !== 'yes'
    }

    if (needsInstall) {
      log.step('安装依赖')
      const result = await exec(
        client,
        withNodeEnv(
          `cd ${shellQuote(remotePath)} && npm install --omit=dev --no-audit --no-fund --loglevel=error`,
          data.pathPrefix,
        ),
      )
      const output = result.stdout.trim()
      if (output) {
        for (const line of output.split(/\r?\n/).slice(-10)) log.info(line)
      }
      log.ok('依赖安装完成')
    }

    log.step('检查 PM2 进程')
    const pm2Path = (
      await exec(client, withNodeEnv('command -v pm2 || true', data.pathPrefix), {
        allowFail: true,
      })
    ).stdout.trim()

    if (!pm2Path) {
      throw new Error(
        '服务器上找不到 pm2，请在宝塔「Node.js 版本管理器」中安装 PM2，或执行 npm i -g pm2',
      )
    }
    log.info(`pm2：${pm2Path}`)

    const readPm2List = async () => {
      const { stdout } = await exec(
        client,
        withNodeEnv('pm2 jlist 2>/dev/null', data.pathPrefix),
        { allowFail: true },
      )
      const list = parseJsonArray(stdout)
      if (!list) {
        throw new Error(
          `无法解析 pm2 jlist 输出，请手动执行 pm2 list 检查\n${stdout.slice(0, 300)}`,
        )
      }
      return list
    }

    const before = await readPm2List()
    const normalize = (value) => path.posix.normalize(String(value || ''))
    const cwdMatches = (item) =>
      Boolean(item.pm2_env?.pm_cwd) && normalize(item.pm2_env.pm_cwd) === normalize(remotePath)
    // 宝塔创建的进程名可能不是 pm2Name（例如统一叫 server），优先按运行目录匹配
    const named = before.filter((item) => item.name === pm2Name)
    const proc = named.find(cwdMatches) ?? before.find(cwdMatches) ?? null
    const status = proc?.pm2_env?.status
    const cwd = proc?.pm2_env?.pm_cwd
    const forced =
      restartMode === 'always' || args.has('force-restart') || args.has('restart')

    let action = 'skip'
    let reason = ''

    if (!proc) {
      const sameName = named.find((item) => !cwdMatches(item))
      if (sameName) {
        log.warn(
          `PM2 中已有同名进程 ${pm2Name}，但运行目录为 ${sameName.pm2_env?.pm_cwd || '-'}；` +
            '请先执行 pm2 delete 清理，避免重复启动导致端口冲突',
        )
      }
      action = 'start'
      reason = 'PM2 中不存在该目录对应的进程'
    } else if (status !== 'online') {
      action = 'restart'
      reason = `进程状态为 ${status || '未知'}`
    } else if (forced) {
      action = 'restart'
      reason = '按配置强制重启'
    } else if (changed.length) {
      action = 'restart'
      reason = `检测到文件更新（${[...changedNames].slice(0, 5).join(', ')}）`
    } else {
      reason = '文件无变化且进程运行中，无需重启'
    }

    if (proc && proc.name !== pm2Name) {
      log.info(
        `复用目录匹配的 PM2 进程：${proc.name}（id=${proc.pm_id}），将按进程 id 重启，避免与其他同名进程冲突`,
      )
    }

    if (action === 'start') {
      log.step(`启动 PM2 进程：${reason}`)
      await exec(
        client,
        withNodeEnv(
          `cd ${shellQuote(remotePath)} && pm2 start ${shellQuote(entry)} --name ${shellQuote(pm2Name)}`,
          data.pathPrefix,
        ),
      )
      await exec(client, withNodeEnv('pm2 save', data.pathPrefix), { allowFail: true })
    } else if (action === 'restart') {
      log.step(`重启 PM2 进程：${reason}`)
      // 使用进程 id 重启：宝塔下可能同时存在多个同名 server 进程
      const target = proc?.pm_id ?? pm2Name
      const targetArg = typeof target === 'number' ? String(target) : shellQuote(target)
      await exec(
        client,
        withNodeEnv(`pm2 restart ${targetArg} --update-env`, data.pathPrefix),
      )
      await exec(client, withNodeEnv('pm2 save', data.pathPrefix), { allowFail: true })
    } else {
      log.ok(`无需重启：${reason}`)
    }

    log.step('验证进程状态')
    let current = proc
    let crashed = false

    const findCurrent = (list) =>
      proc && Number.isInteger(proc.pm_id)
        ? list.find((item) => item.pm_id === proc.pm_id)
        : list.find((item) => item.name === pm2Name)

    if (action === 'skip') {
      log.info(`沿用现有进程：${describe(proc)}`)
    } else {
      await delay(2000)
      const first = findCurrent(await readPm2List())
      const firstRestarts = Number(first?.pm2_env?.restart_time ?? 0)
      await delay(3000)
      const list = await readPm2List()
      current = findCurrent(list)
      const secondRestarts = Number(current?.pm2_env?.restart_time ?? 0)
      crashed =
        !current ||
        current.pm2_env?.status !== 'online' ||
        secondRestarts > firstRestarts
      if (current) log.info(describe(current))
    }

    log.step('健康检查')
    const health = await exec(
      client,
      `curl -fsS --max-time 5 ${shellQuote(healthUrl)} 2>/dev/null || true`,
      { allowFail: true },
    )
    const healthText = health.stdout.trim()
    if (healthText) {
      log.info(`接口返回：${healthText}`)
      if (healthText.includes('"database":false')) {
        log.warn('服务已启动，但数据库未就绪，请检查服务器上的 .env 与 MySQL 配置')
      }
    } else {
      log.warn(`健康检查无响应：${healthUrl}（请检查端口与 .env）`)
    }

    log.step('部署结果')
    log.info(`服务目录：${remotePath}`)
    log.ok(`总用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

    if (action === 'skip') {
      log.ok('进程在线，本次未重启')
    }

    const failed = !current || current.pm2_env?.status !== 'online' || crashed
    if (failed) {
      const logName = current?.name || proc?.name || pm2Name
      const errorLog = `/root/.pm2/logs/${logName}-error.log`
      const tail = await exec(
        client,
        `tail -n 20 ${shellQuote(errorLog)} 2>/dev/null || true`,
        { allowFail: true },
      )
      if (tail.stdout.trim()) log.info(`最近错误日志（${errorLog}）：\n${tail.stdout.trim()}`)
      throw new Error(
        `PM2 进程 ${pm2Name} 状态为 ${current?.pm2_env?.status || '未知'}` +
          `${crashed ? '（检测到反复重启，请检查端口占用与启动日志）' : ''}`,
      )
    }
    log.ok(`进程 ${pm2Name} 稳定在线`)
  } finally {
    client.end()
  }
}

main().catch((error) => {
  log.error(error.message)
  process.exitCode = 1
})
