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
} from './lib/remote.mjs'

const buildDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(buildDir, '..')

// 宝塔 / nvm 安装的 node、pm2 可能不在非交互式 SSH 的 PATH 里
const NODE_PATH_FIX =
  'for d in /www/server/nodejs/*/bin /root/.nvm/versions/node/*/bin /usr/local/node*/bin; do ' +
  'if [ -d "$d" ]; then case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac; fi; done; export PATH'

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

async function main() {
  const args = parseArgs()
  const { config, configPath } = loadConfig(buildDir, args)
  const ssh = requireSsh(config)
  const mp = config.multiplayer || {}
  const remotePath = requireRemotePath(mp.remotePath, 'multiplayer')
  const localDir = path.resolve(projectRoot, mp.localDir || 'gameService')
  const pm2Name = String(mp.pm2Name || 'grid-multiplayer')
  const entry = String(mp.entry || 'server.mjs')
  const installDeps = mp.installDeps !== false
  const restartMode = ['auto', 'always', 'never'].includes(mp.restartMode) ? mp.restartMode : 'auto'
  const startedAt = Date.now()

  log.step(`配置文件：${configPath}`)
  log.info(`服务器：${ssh.username}@${ssh.host}:${ssh.port}`)
  log.info(`多人服务目录：${remotePath}`)
  log.info(`PM2 进程名：${pm2Name}`)

  const fileNames = Array.isArray(mp.files) && mp.files.length
    ? [...mp.files]
    : ['server.mjs', 'package.json', 'package-lock.json']
  if (mp.uploadEnv === true) fileNames.push('.env')
  if (!fileNames.includes(entry)) fileNames.push(entry)

  const localFiles = []
  for (const name of [...new Set(fileNames)]) {
    const local = path.resolve(localDir, name)
    if (!fs.existsSync(local) || !fs.statSync(local).isFile()) {
      log.warn(`本地文件不存在，已跳过：${path.join(localDir, name)}`)
      continue
    }
    localFiles.push({
      name,
      local,
      remote: path.posix.join(remotePath, name.split(path.sep).join('/')),
    })
  }

  if (!localFiles.length) {
    throw new Error(`没有可上传的文件，请检查 multiplayer.localDir：${localDir}`)
  }

  log.step(`本地文件 ${localFiles.length} 个，共 ${formatBytes(localFiles.reduce((sum, file) => sum + fs.statSync(file.local).size, 0))}`)

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
    const remoteHashes = await remoteSha256(client, localFiles.map((file) => file.remote))
    const changed = localFiles.filter((file) => remoteHashes.get(file.remote) !== sha256File(file.local))
    const changedNames = new Set(changed.map((file) => file.name))

    if (!changed.length) {
      log.ok('远端文件与本地一致，跳过上传')
    } else {
      log.info(`需要更新：${[...changedNames].join(', ')}`)
      await uploadFiles(client, changed, { concurrency: 2 })
      log.ok(`已上传 ${changed.length} 个文件`)
    }

    if (installDeps && (changedNames.has('package.json') || changedNames.has('package-lock.json'))) {
      log.step('安装依赖（package.json / lock 有变化）')
      const result = await exec(
        client,
        withNodeEnv(
          `cd ${shellQuote(remotePath)} && npm install --omit=dev --no-audit --no-fund --loglevel=error`,
          mp.pathPrefix,
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
      await exec(client, withNodeEnv('command -v pm2 || true', mp.pathPrefix), { allowFail: true })
    ).stdout.trim()

    if (!pm2Path) {
      throw new Error('服务器上找不到 pm2，请在宝塔「Node.js 版本管理器」中安装 PM2，或执行 npm i -g pm2')
    }
    log.info(`pm2：${pm2Path}`)

    const readPm2List = async () => {
      const { stdout } = await exec(
        client,
        withNodeEnv('pm2 jlist 2>/dev/null', mp.pathPrefix),
        { allowFail: true },
      )
      const list = parseJsonArray(stdout)
      if (!list) {
        throw new Error(`无法解析 pm2 jlist 输出，请手动执行 pm2 list 检查\n${stdout.slice(0, 300)}`)
      }
      return list
    }

    const before = await readPm2List()
    const proc = before.find((item) => item.name === pm2Name)
    const status = proc?.pm2_env?.status
    const cwd = proc?.pm2_env?.pm_cwd
    const forced = restartMode === 'always' || args.has('force-restart') || args.has('restart')
    const cwdMismatch =
      Boolean(proc) &&
      Boolean(cwd) &&
      path.posix.normalize(String(cwd)) !== path.posix.normalize(remotePath)

    let action = 'skip'
    let reason = ''

    if (!proc) {
      const sameDir = before.filter(
        (item) =>
          item.pm2_env?.pm_cwd &&
          path.posix.normalize(String(item.pm2_env.pm_cwd)) === path.posix.normalize(remotePath),
      )
      if (sameDir.length) {
        log.warn(
          `目录 ${remotePath} 已有其他 PM2 进程：` +
          sameDir.map((item) => `${item.name}(${item.pm2_env?.status || '-'})`).join(', '),
        )
        log.warn(`如该进程就是本服务，请把配置文件中的 pm2Name 改为对应名称，避免重复启动导致端口冲突`)
      }
      action = 'start'
      reason = 'PM2 中不存在该进程'
    } else if (cwdMismatch) {
      action = 'skip'
      reason = `同名进程运行目录为 ${cwd}，与配置 ${remotePath} 不一致`
    } else if (status !== 'online') {
      action = 'restart'
      reason = `进程状态为 ${status || '未知'}`
    } else if (forced) {
      action = 'restart'
      reason = '按配置强制重启'
    } else if (changed.length) {
      action = 'restart'
      reason = `检测到文件更新（${[...changedNames].join(', ')}）`
    } else {
      reason = '文件无变化且进程运行中，无需重启'
    }

    if (cwdMismatch) {
      log.warn(
        `进程 ${pm2Name} 当前运行在 ${cwd}，重启也不会切换目录；` +
        `如需切换请先执行 pm2 delete ${pm2Name}，再重新运行本脚本`,
      )
    }

    if (action === 'start') {
      log.step(`启动 PM2 进程：${reason}`)
      await exec(
        client,
        withNodeEnv(
          `cd ${shellQuote(remotePath)} && pm2 start ${shellQuote(entry)} --name ${shellQuote(pm2Name)}`,
          mp.pathPrefix,
        ),
      )
      await exec(client, withNodeEnv('pm2 save', mp.pathPrefix), { allowFail: true })
    } else if (action === 'restart') {
      log.step(`重启 PM2 进程：${reason}`)
      await exec(
        client,
        withNodeEnv(`pm2 restart ${shellQuote(pm2Name)} --update-env`, mp.pathPrefix),
      )
      await exec(client, withNodeEnv('pm2 save', mp.pathPrefix), { allowFail: true })
    } else {
      log.ok(`无需重启：${reason}`)
    }

    log.step('验证进程状态')
    let current = proc
    let crashed = false

    if (action === 'skip') {
      log.info(`沿用现有进程：${describe(proc)}`)
    } else {
      await delay(2000)
      const first = (await readPm2List()).find((item) => item.name === pm2Name)
      const firstRestarts = Number(first?.pm2_env?.restart_time ?? 0)
      await delay(3000)
      current = (await readPm2List()).find((item) => item.name === pm2Name)
      const secondRestarts = Number(current?.pm2_env?.restart_time ?? 0)
      crashed = !current || current.pm2_env?.status !== 'online' || secondRestarts > firstRestarts
      if (current) log.info(describe(current))
    }

    log.step('部署结果')
    log.info(`服务目录：${remotePath}`)
    log.ok(`总用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

    if (action === 'skip' && !cwdMismatch) {
      log.ok('进程在线，本次未重启')
    }

    const failed = !current || current.pm2_env?.status !== 'online' || crashed
    if (failed) {
      const errorLog = `/root/.pm2/logs/${pm2Name}-error.log`
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
