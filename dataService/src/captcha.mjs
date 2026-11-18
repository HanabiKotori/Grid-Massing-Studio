import crypto from 'node:crypto'

/**
 * 内存版滑块验证码。
 * 服务端只返回背景图与拼图块，缺口坐标留在内存中，校验后立即作废。
 */
const STORE = new Map()
const TTL = 5 * 60 * 1000
const MAX_ATTEMPTS = 4
const WIDTH = 320
const HEIGHT = 160
const PIECE = 38
/** 允许的偏差（百分比），约等于 8px */
const TOLERANCE = 2.6

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function backgroundSvg(targetX, targetY, shape, decoration) {
  const cx = targetX + PIECE / 2
  const cy = targetY + PIECE / 2
  const gap =
    shape === 'circle'
      ? `<circle cx="${cx}" cy="${cy}" r="${PIECE / 2 - 2}" fill="rgba(8, 10, 16, 0.42)" stroke="rgba(255,255,255,0.94)" stroke-width="2" stroke-dasharray="4 3" />`
      : `<rect x="${targetX + 2}" y="${targetY + 2}" width="${PIECE - 4}" height="${PIECE - 4}" rx="8" fill="rgba(8, 10, 16, 0.42)" stroke="rgba(255,255,255,0.94)" stroke-width="2" stroke-dasharray="4 3" />`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${randomInt(0, 359)}, 46%, 42%)" />
      <stop offset="1" stop-color="hsl(${randomInt(0, 359)}, 42%, 28%)" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" rx="10" fill="url(#bg)" />
  ${decoration}
  ${gap}
</svg>`
}

function pieceSvg(shape) {
  const fill = 'rgba(255,255,255,0.24)'
  const body =
    shape === 'circle'
      ? `<circle cx="${PIECE / 2}" cy="${PIECE / 2}" r="${PIECE / 2 - 2}" fill="${fill}" stroke="rgba(255,255,255,0.95)" stroke-width="2" />
         <circle cx="${PIECE / 2}" cy="${PIECE / 2}" r="${PIECE / 2 - 8}" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.4" />`
      : `<rect x="2" y="2" width="${PIECE - 4}" height="${PIECE - 4}" rx="8" fill="${fill}" stroke="rgba(255,255,255,0.95)" stroke-width="2" />
         <rect x="8" y="8" width="${PIECE - 16}" height="${PIECE - 16}" rx="4" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.4" />`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIECE}" height="${PIECE}" viewBox="0 0 ${PIECE} ${PIECE}">
  <defs>
    <filter id="ds" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.4" />
    </filter>
  </defs>
  <g filter="url(#ds)">${body}</g>
</svg>`
}

/** 随机装饰：半透明几何图形，避免纯色背景让缺口太显眼 */
function decorationSvg() {
  const shapes = []
  for (let i = 0; i < 16; i += 1) {
    const hue = randomInt(0, 359)
    const alpha = (randomInt(12, 30) / 100).toFixed(2)
    const color = `hsla(${hue}, ${randomInt(35, 65)}%, ${randomInt(30, 78)}%, ${alpha})`
    if (i % 3 === 0) {
      shapes.push(
        `<rect x="${randomInt(-20, WIDTH - 20)}" y="${randomInt(-20, HEIGHT - 20)}" width="${randomInt(24, 120)}" height="${randomInt(16, 64)}" rx="${randomInt(4, 16)}" fill="${color}" transform="rotate(${randomInt(-40, 40)} ${randomInt(0, WIDTH)} ${randomInt(0, HEIGHT)})" />`,
      )
    } else if (i % 3 === 1) {
      shapes.push(
        `<circle cx="${randomInt(0, WIDTH)}" cy="${randomInt(0, HEIGHT)}" r="${randomInt(6, 34)}" fill="${color}" />`,
      )
    } else {
      shapes.push(
        `<path d="M${randomInt(0, WIDTH)} ${randomInt(0, HEIGHT)} L${randomInt(0, WIDTH)} ${randomInt(0, HEIGHT)} L${randomInt(0, WIDTH)} ${randomInt(0, HEIGHT)}" fill="none" stroke="${color}" stroke-width="${randomInt(2, 9)}" stroke-linecap="round" />`,
      )
    }
  }
  return shapes.join('')
}

function cleanup() {
  const now = Date.now()
  for (const [token, item] of STORE) {
    if (item.expiresAt <= now) STORE.delete(token)
  }
}

/**
 * 生成验证码。
 * answer 仅用于服务端内部与测试脚本，路由只返回 payload。
 */
export function issueCaptcha() {
  cleanup()

  const shape = Math.random() < 0.5 ? 'circle' : 'rect'
  const targetX = randomInt(34, WIDTH - PIECE - 24)
  const targetY = randomInt(22, HEIGHT - PIECE - 22)
  const targetPercent = (targetX / WIDTH) * 100
  const token = crypto.randomBytes(18).toString('hex')

  STORE.set(token, {
    targetPercent,
    attempts: 0,
    expiresAt: Date.now() + TTL,
  })

  return {
    payload: {
      token,
      background: svgDataUrl(backgroundSvg(targetX, targetY, shape, decorationSvg())),
      piece: svgDataUrl(pieceSvg(shape)),
      width: WIDTH,
      height: HEIGHT,
      pieceSize: PIECE,
      /** 拼图块的纵向位置与宽度占比，便于前端对齐；水平坐标不返回 */
      yPercent: (targetY / HEIGHT) * 100,
      piecePercent: (PIECE / WIDTH) * 100,
    },
    answer: targetPercent,
  }
}

/** 校验滑块位置（百分比） */
export function verifyCaptcha(token, x) {
  const key = String(token ?? '')
  const item = STORE.get(key)
  if (!item) return { ok: false, error: '验证码已失效，请刷新后重试' }
  if (item.expiresAt <= Date.now()) {
    STORE.delete(key)
    return { ok: false, error: '验证码已过期，请刷新后重试' }
  }

  item.attempts += 1
  if (item.attempts > MAX_ATTEMPTS) {
    STORE.delete(key)
    return { ok: false, error: '验证码尝试次数过多，请刷新后重试' }
  }

  const value = Number(x)
  if (!Number.isFinite(value)) return { ok: false, error: '滑块位置无效，请重试' }
  if (Math.abs(value - item.targetPercent) > TOLERANCE) {
    return { ok: false, error: '滑块位置不正确，请重试' }
  }

  STORE.delete(key)
  return { ok: true }
}
