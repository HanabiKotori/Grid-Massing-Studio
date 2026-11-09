import type { Ref, ShallowRef } from 'vue'
import {
  UNDERLAY_DEFAULT_OPACITY,
  UNDERLAY_INITIAL_SIZE,
  clampUnderlaySpec,
} from '../core/underlay'
import type { Underlay } from '../core/types'

interface UnderlayOptions {
  underlay: ShallowRef<Underlay | null>
  renderOnly: Ref<boolean>
  toast: (text: string) => void
}

function readFileDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function readImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片读取失败'))
    img.src = src
  })
}

export function useUnderlay(options: UnderlayOptions) {
  /** 上传底图：限制格式 / 大小，长边超过 2048 时压缩，初始铺满网格并保持比例 */
  async function addUnderlay(file: File) {
    if (options.renderOnly.value) return
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      options.toast('仅支持 JPG / PNG 图片')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      options.toast('底图不能超过 20MB')
      return
    }

    const dataUrl = await readFileDataUrl(file)
    if (!dataUrl) {
      options.toast('图片读取失败')
      return
    }

    let img: HTMLImageElement
    try {
      img = await readImage(dataUrl)
    } catch {
      options.toast('图片读取失败')
      return
    }
    const srcW = img.naturalWidth
    const srcH = img.naturalHeight
    if (!srcW || !srcH) {
      options.toast('图片尺寸无效')
      return
    }

    let image = dataUrl
    if (Math.max(srcW, srcH) > 2048) {
      const k = 2048 / Math.max(srcW, srcH)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(srcW * k))
      canvas.height = Math.max(1, Math.round(srcH * k))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        image = canvas.toDataURL(
          file.type === 'image/png' ? 'image/png' : 'image/jpeg',
          0.92,
        )
      }
    }

    const aspect = srcW / srcH
    const width =
      aspect >= 1 ? UNDERLAY_INITIAL_SIZE : UNDERLAY_INITIAL_SIZE * aspect
    const height =
      aspect >= 1 ? UNDERLAY_INITIAL_SIZE / aspect : UNDERLAY_INITIAL_SIZE
    options.underlay.value = clampUnderlaySpec({
      image,
      name: (file.name || '底图').slice(0, 60),
      x: 0,
      z: 0,
      width,
      height,
      opacity:
        options.underlay.value?.opacity ?? UNDERLAY_DEFAULT_OPACITY,
      visible: true,
      locked: false,
    })
    options.toast('底图已添加 · Ctrl + 滚轮逐格缩放，Ctrl + 左键逐格拖动')
  }

  function toggleUnderlay() {
    if (options.renderOnly.value || !options.underlay.value) return
    options.underlay.value = {
      ...options.underlay.value,
      visible: !options.underlay.value.visible,
    }
  }

  function toggleUnderlayLock() {
    if (options.renderOnly.value || !options.underlay.value) return
    const locked = options.underlay.value.locked !== true
    options.underlay.value = clampUnderlaySpec({
      ...options.underlay.value,
      locked,
    })
    options.toast(locked ? '底图已锁定位置和缩放' : '底图已解锁')
  }

  function setUnderlayOpacity(value: number) {
    if (options.renderOnly.value || !options.underlay.value) return
    options.underlay.value = {
      ...options.underlay.value,
      opacity: Math.min(100, Math.max(0, Math.round(value))) / 100,
    }
  }

  /** 把底图移回网格中心，尺寸保持不变 */
  function centerUnderlay() {
    if (options.renderOnly.value || !options.underlay.value) return
    options.underlay.value = clampUnderlaySpec({
      ...options.underlay.value,
      x: 0,
      z: 0,
    })
    options.toast('底图已居中')
  }

  function removeUnderlay() {
    if (options.renderOnly.value || !options.underlay.value) return
    options.underlay.value = null
    options.toast('已移除底图')
  }

  function applyUnderlayChange(spec: Underlay) {
    options.underlay.value = clampUnderlaySpec(spec)
  }

  return {
    addUnderlay,
    toggleUnderlay,
    toggleUnderlayLock,
    setUnderlayOpacity,
    centerUnderlay,
    removeUnderlay,
    applyUnderlayChange,
  }
}
