import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  connect,
  countRemoteFiles,
  exec,
  formatBytes,
  loadConfig,
  log,
  parseArgs,
  requireRemotePath,
  requireSsh,
  shellQuote,
  uploadFiles,
  walkFiles,
} from './lib/remote.mjs'

const buildDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(buildDir, '..')

async function main() {
  const args = parseArgs()
  const { config, configPath } = loadConfig(buildDir, args)
  const ssh = requireSsh(config)
  const web = config.web || {}
  const remotePath = requireRemotePath(web.remotePath, 'web')
  const distDir = path.resolve(projectRoot, web.distDir || 'dist')
  const buildCommand = String(web.buildCommand || 'npm run build')
  const startedAt = Date.now()

  log.step(`配置文件：${configPath}`)
  log.info(`服务器：${ssh.username}@${ssh.host}:${ssh.port}`)
  log.info(`站点目录：${remotePath}`)

  if (args.has('skip-build')) {
    log.warn('已跳过打包，直接使用现有 dist')
  } else {
    log.step(`打包项目：${buildCommand}`)
    const result = spawnSync(buildCommand, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true,
    })
    if (result.status !== 0) {
      throw new Error(`打包失败，退出码 ${result.status ?? result.signal}`)
    }
    log.ok(`打包完成，用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
  }

  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`找不到构建产物目录：${distDir}`)
  }

  const localFiles = await walkFiles(distDir)
  if (!localFiles.length) {
    throw new Error(`构建产物为空：${distDir}`)
  }

  const totalBytes = localFiles.reduce((sum, file) => sum + fs.statSync(file.local).size, 0)
  log.step(`待上传 ${localFiles.length} 个文件，共 ${formatBytes(totalBytes)}`)

  if (args.has('dry-run')) {
    for (const file of localFiles.slice(0, 10)) {
      log.info(`${file.relative}  ${formatBytes(fs.statSync(file.local).size)}`)
    }
    if (localFiles.length > 10) log.info(`... 其余 ${localFiles.length - 10} 个文件`)
    log.warn('dry-run 模式，未连接服务器')
    return
  }

  const client = await connect(ssh)
  log.ok('SSH 连接成功')

  const tmpDir = `/tmp/bt-web-deploy-${Date.now()}`

  try {
    log.step(`上传到服务器临时目录：${tmpDir}`)
    await exec(client, `rm -rf ${shellQuote(tmpDir)} && mkdir -p ${shellQuote(tmpDir)}`)

    let lastTick = 0
    await uploadFiles(
      client,
      localFiles.map((file) => ({
        local: file.local,
        remote: path.posix.join(tmpDir, file.relative),
      })),
      {
        concurrency: 4,
        onProgress: (done, total) => {
          if (!process.stdout.isTTY) return
          const now = Date.now()
          if (done !== total && now - lastTick < 120) return
          lastTick = now
          process.stdout.write(`\r    已上传 ${done}/${total}`)
          if (done === total) process.stdout.write('\n')
        },
      },
    )
    log.ok('上传完成')

    log.step(`更新站点目录：${remotePath}`)
    const keepNames = (Array.isArray(web.keep) ? web.keep : ['.user.ini', '.htaccess']).filter(Boolean)
    const keepArgs = keepNames.map((name) => `! -name ${shellQuote(name)}`).join(' ')

    await exec(
      client,
      [
        `mkdir -p ${shellQuote(remotePath)}`,
        `find ${shellQuote(remotePath)} -mindepth 1 -maxdepth 1 ${keepArgs} -exec rm -rf {} +`,
        `cp -a ${shellQuote(tmpDir)}/. ${shellQuote(remotePath)}/`,
        `rm -rf ${shellQuote(tmpDir)}`,
      ].join(' && '),
    )
    log.ok('站点文件已更新')

    if (web.owner) {
      if (/^[\w.-]+(:[\w.-]+)?$/.test(String(web.owner))) {
        await exec(client, `chown -R ${web.owner} ${shellQuote(remotePath)}`, { allowFail: true })
        log.info(`已设置属主：${web.owner}`)
      } else {
        log.warn(`web.owner 格式不合法，已跳过：${web.owner}`)
      }
    }

    const remoteCount = await countRemoteFiles(client, remotePath)
    log.step('部署结果')
    log.ok(`远端文件数：${remoteCount}（本地 ${localFiles.length}）`)
    log.ok(`总用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
    if (remoteCount < localFiles.length) {
      log.warn('远端文件数少于本地，请检查是否有文件上传失败')
    }
  } finally {
    client.end()
  }
}

main().catch((error) => {
  log.error(error.message)
  process.exitCode = 1
})
