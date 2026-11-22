import type { CollabSound, MessageScope } from './messageCenter'

type AudioContextCtor = new () => AudioContext

let context: AudioContext | null = null
let lastPlayedAt = Number.NEGATIVE_INFINITY
let lastPlayedKind: CollabSound | null = null
let unlockInstalled = false

const COALESCE_MS = 2500
/** 普通评论之后紧接着的回复优先发声，只抑制相反方向的短间隔 */
const CROSS_KIND_GAP_MS = 900

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext ??
    null
  )
}

function ensureContext(): AudioContext | null {
  if (context) return context
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null
  try {
    context = new Ctor()
  } catch {
    context = null
  }
  return context
}

function tone(
  ctx: AudioContext,
  frequency: number,
  delay: number,
  duration: number,
  gain: number,
  type: OscillatorType = 'sine',
  endFrequency?: number,
) {
  const start = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, start)
  if (endFrequency) {
    osc.frequency.exponentialRampToValueAtTime(
      endFrequency,
      start + duration,
    )
  }
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(amp)
  amp.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

function schedule(ctx: AudioContext, kind: CollabSound, scope: MessageScope) {
  if (kind === 'danger') {
    // S8 轻鼓双击：作者删除评论等危险操作
    tone(ctx, 130, 0, 0.14, 0.085, 'sine', 70)
    tone(ctx, 68, 0, 0.1, 0.035, 'triangle', 45)
    tone(ctx, 130, 0.12, 0.11, 0.058, 'sine', 80)
    return
  }

  if (kind === 'reply') {
    // S7 三音风铃：作者或其他访客直接回复当前访客
    tone(ctx, 1046.5, 0, 0.22, 0.045)
    tone(ctx, 1318.5, 0.07, 0.2, 0.042)
    tone(ctx, 1568, 0.14, 0.18, 0.038)
    tone(ctx, 2093, 0.14, 0.12, 0.007)
    return
  }

  if (scope === 'editor') {
    // S9 纯五度玻璃：编辑器新评论，比 S2 低一个八度
    tone(ctx, 523.25, 0, 0.2, 0.055)
    tone(ctx, 783.99, 0.08, 0.22, 0.045)
    tone(ctx, 1046.5, 0.08, 0.14, 0.008)
    return
  }

  // S2 玻璃双音：分享页普通新评论
  tone(ctx, 1046.5, 0, 0.16, 0.06)
  tone(ctx, 1568, 0.08, 0.19, 0.052)
  tone(ctx, 2093, 0.08, 0.14, 0.011)
}

/** 浏览器要求首次用户手势后才能出声；在 ToastHost 挂载时安装一次性解锁 */
export function installNotificationAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return
  unlockInstalled = true
  const detach = () => {
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  const unlock = () => {
    const ctx = ensureContext()
    if (!ctx) return
    if (ctx.state === 'running') {
      detach()
      return
    }
    if (ctx.state !== 'suspended') return
    // 第一次手势可能只完成 resume 排队；确认 running 后再移除监听，
    // 避免一次失败后永远不再尝试解锁。
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') detach()
      })
      .catch(() => {
        // 保留监听，下一次点击 / 按键继续尝试
      })
  }
  window.addEventListener('pointerdown', unlock, { capture: true })
  window.addEventListener('keydown', unlock, { capture: true })
}

export function playCollabSound(
  kind: CollabSound,
  scope: MessageScope,
  force = false,
): void {
  const now = performance.now()
  const elapsed = now - lastPlayedAt
  const sameKind = lastPlayedKind === kind
  // 同类消息 2.5 秒内合并；但普通评论刚响过时，
  // 直接回复不应该被合并掉，否则会漏掉最需要听到的 S7。
  if (!force && sameKind && elapsed < COALESCE_MS) return
  if (
    !force &&
    kind === 'comment' &&
    lastPlayedKind === 'reply' &&
    elapsed < CROSS_KIND_GAP_MS
  ) {
    return
  }

  const ctx = ensureContext()
  if (!ctx) return

  lastPlayedAt = now
  lastPlayedKind = kind
  const play = () => schedule(ctx, kind, scope)

  if (ctx.state === 'suspended') {
    void ctx.resume().then(play).catch(() => {
      // 未获得用户手势时保持静音，不影响视觉通知
    })
    return
  }
  if (ctx.state !== 'running') return
  play()
}
