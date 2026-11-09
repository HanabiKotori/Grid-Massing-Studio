import { reactive, ref, useTemplateRef } from 'vue'
import type { Stage } from '../core/Stage'

interface MobileWalkOptions {
  getStage: () => Stage | null
}

export function useMobileWalkControls(options: MobileWalkOptions) {
  const moveStickEl = useTemplateRef<HTMLElement>('moveStickEl')
  const moveKnob = reactive({ x: 0, y: 0 })
  const moveBoost = ref(0)
  const lookKnob = reactive({ x: 0, y: 0 })
  let movePointerId: number | null = null
  let lookPointerId: number | null = null
  let lookLastX = 0
  let lookLastY = 0

  function stickRadius(el: HTMLElement) {
    const rect = el.getBoundingClientRect()
    return {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      radius: Math.max(1, rect.width / 2 - 24),
      baseRadius: rect.width / 2,
    }
  }

  function updateMoveStick(e: PointerEvent) {
    const el = moveStickEl.value
    if (!el) return
    const { cx, cy, radius, baseRadius } = stickRadius(el)
    const rawX = e.clientX - cx
    const rawY = e.clientY - cy
    const len = Math.hypot(rawX, rawY)
    const clamped = Math.min(len, radius)
    const dx = len > 0 ? (rawX / len) * clamped : 0
    const dy = len > 0 ? (rawY / len) * clamped : 0
    moveKnob.x = dx / radius
    moveKnob.y = dy / radius

    // 超出第二个加速圈后逐渐提升到奔跑速度
    const boostStart = baseRadius * 1.3
    const boostEnd = baseRadius * 1.65
    moveBoost.value =
      len <= boostStart ? 0 : Math.min(1, (len - boostStart) / (boostEnd - boostStart))

    options.getStage()?.setWalkMove(moveKnob.x, -moveKnob.y, moveBoost.value)
  }

  function onMoveStickDown(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (movePointerId !== null) return
    movePointerId = e.pointerId
    updateMoveStick(e)
    // 在 window 上跟踪，不使用 pointer capture，避免抢占其他手指的按钮点击
    window.addEventListener('pointermove', onMoveStickMove)
    window.addEventListener('pointerup', onMoveStickUp)
    window.addEventListener('pointercancel', onMoveStickUp)
  }

  function onMoveStickMove(e: PointerEvent) {
    if (movePointerId !== e.pointerId) return
    e.preventDefault()
    updateMoveStick(e)
  }

  function onMoveStickUp(e: PointerEvent) {
    if (movePointerId !== e.pointerId) return
    movePointerId = null
    moveKnob.x = 0
    moveKnob.y = 0
    moveBoost.value = 0
    options.getStage()?.setWalkMove(0, 0, 0)
    window.removeEventListener('pointermove', onMoveStickMove)
    window.removeEventListener('pointerup', onMoveStickUp)
    window.removeEventListener('pointercancel', onMoveStickUp)
  }

  function onLookStickDown(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (lookPointerId !== null) return
    lookPointerId = e.pointerId
    lookLastX = e.clientX
    lookLastY = e.clientY
    lookKnob.x = 0
    lookKnob.y = 0
    window.addEventListener('pointermove', onLookStickMove)
    window.addEventListener('pointerup', onLookStickUp)
    window.addEventListener('pointercancel', onLookStickUp)
  }

  function onLookStickMove(e: PointerEvent) {
    if (lookPointerId !== e.pointerId) return
    e.preventDefault()
    const dx = e.clientX - lookLastX
    const dy = e.clientY - lookLastY
    lookLastX = e.clientX
    lookLastY = e.clientY
    options.getStage()?.lookWalk(dx, dy)
    lookKnob.x = Math.max(-1, Math.min(1, lookKnob.x + dx / 36))
    lookKnob.y = Math.max(-1, Math.min(1, lookKnob.y + dy / 36))
  }

  function onLookStickUp(e: PointerEvent) {
    if (lookPointerId !== e.pointerId) return
    lookPointerId = null
    lookKnob.x = 0
    lookKnob.y = 0
    window.removeEventListener('pointermove', onLookStickMove)
    window.removeEventListener('pointerup', onLookStickUp)
    window.removeEventListener('pointercancel', onLookStickUp)
  }

  function jumpMobileWalk() {
    options.getStage()?.jumpWalk()
  }

  function returnMobileWalk() {
    options.getStage()?.returnToWalkStart()
  }

  function exitMobileWalk() {
    options.getStage()?.stopWalk()
  }

  function dispose() {
    window.removeEventListener('pointermove', onMoveStickMove)
    window.removeEventListener('pointerup', onMoveStickUp)
    window.removeEventListener('pointercancel', onMoveStickUp)
    window.removeEventListener('pointermove', onLookStickMove)
    window.removeEventListener('pointerup', onLookStickUp)
    window.removeEventListener('pointercancel', onLookStickUp)
  }

  return {
    moveKnob,
    moveBoost,
    lookKnob,
    onMoveStickDown,
    onMoveStickMove,
    onMoveStickUp,
    onLookStickDown,
    onLookStickMove,
    onLookStickUp,
    jumpMobileWalk,
    returnMobileWalk,
    exitMobileWalk,
    dispose,
  }
}
