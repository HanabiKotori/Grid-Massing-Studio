import type { Ref } from 'vue'
import type { WalkState } from '../core/Stage'
import type { EditorMode, Underlay } from '../core/types'

interface EditorShortcutOptions {
  presentationOn: Ref<boolean>
  showHelp: Ref<boolean>
  showWeather: Ref<boolean>
  walkState: Ref<WalkState>
  renderOnly: Ref<boolean>
  underlay: Ref<Underlay | null>
  mode: Ref<EditorMode>
  isPlacing: Ref<boolean>
  selectedIds: Ref<string[]>
  selectedInfraId: Ref<string | null>
  toast: (text: string) => void
  exitPresentation: () => void
  closeWeather: () => void
  openWeather: () => void
  toggleHelp: () => void
  closeHelp: () => void
  hasToolMenu: () => boolean
  closeToolMenu: () => void
  toggleWalk: () => void
  toggleUnderlayLock: () => void
  viewTop: () => void
  viewIso: () => void
  fitView: () => void
  enterPresentation: () => void
  hasMergeDialog: () => boolean
  closeMergeDialog: () => void
  cancelBoothPaste: () => void
  cancelInfraPlacement: () => void
  cancelDraft: () => void
  backToDraw: () => void
  confirmHeight: () => void
  closeDraft: () => void
  copySelectedBooths: () => void
  copySelectedInfra: () => void
  undoPoint: () => void
  undo: () => void
  redo: () => void
  deleteSelectedBooths: () => void
  deleteInfra: (id: string) => void
  toggleGrid: () => void
}

export function useEditorShortcuts(options: EditorShortcutOptions) {
  function onKey(e: KeyboardEvent) {
    if (options.presentationOn.value) {
      if (e.key === 'Escape') {
        e.preventDefault()
        options.exitPresentation()
      }
      return
    }

    // F1 在任何模式下都能打开 / 关闭帮助
    if (e.key === 'F1') {
      e.preventDefault()
      options.toggleHelp()
      return
    }

    // 帮助打开时只响应关闭，不触发编辑快捷键
    if (options.showHelp.value) {
      if (e.key === 'Escape') {
        e.preventDefault()
        options.closeHelp()
      }
      return
    }

    // 天气面板打开时只响应关闭
    if (options.showWeather.value) {
      const closeKey =
        e.key === 'Escape' ||
        (!e.ctrlKey && !e.metaKey && e.altKey && e.key.toLowerCase() === 'w')
      if (closeKey) {
        e.preventDefault()
        options.closeWeather()
      }
      return
    }

    // Esc 优先关闭工具栏二级菜单
    if (e.key === 'Escape' && options.hasToolMenu()) {
      e.preventDefault()
      options.closeToolMenu()
      return
    }

    const el = e.target as HTMLElement | null
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')

    // P：进入 / 退出漫游，预览模式下也可用
    if (
      !typing &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      e.key.toLowerCase() === 'p'
    ) {
      e.preventDefault()
      options.toggleWalk()
      return
    }

    // Alt+W：编辑 / 预览模式打开天气面板；漫游中由 Stage 处理
    if (
      !typing &&
      !e.ctrlKey &&
      !e.metaKey &&
      e.altKey &&
      e.key.toLowerCase() === 'w' &&
      options.walkState.value === 'off'
    ) {
      e.preventDefault()
      options.openWeather()
      return
    }

    // Alt+L：锁定 / 解锁底图
    if (
      !typing &&
      !e.repeat &&
      !e.ctrlKey &&
      !e.metaKey &&
      e.altKey &&
      (e.code === 'KeyL' || e.key.toLowerCase() === 'l') &&
      options.walkState.value === 'off'
    ) {
      if (options.renderOnly.value) return
      e.preventDefault()
      if (!options.underlay.value) {
        options.toast('请先上传底图')
        return
      }
      options.toggleUnderlayLock()
      return
    }

    // 视角快捷键：T 俯视 / I 轴测 / F 适配，预览模式下也可用
    if (
      !typing &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      options.walkState.value === 'off'
    ) {
      const viewKey = e.key.toLowerCase()
      if (viewKey === 't') {
        e.preventDefault()
        options.closeToolMenu()
        options.viewTop()
        return
      }
      if (viewKey === 'i') {
        e.preventDefault()
        options.closeToolMenu()
        options.viewIso()
        return
      }
      if (viewKey === 'f') {
        e.preventDefault()
        options.closeToolMenu()
        options.fitView()
        return
      }
      if (viewKey === 's') {
        e.preventDefault()
        options.closeToolMenu()
        options.enterPresentation()
        return
      }
    }

    // 纯渲染模式禁用其他编辑快捷键
    if (options.renderOnly.value) return

    if (e.key === 'Escape') {
      if (options.hasMergeDialog()) {
        options.closeMergeDialog()
        return
      }
      if (options.mode.value === 'paste-booths') {
        options.cancelBoothPaste()
        return
      }
      if (options.isPlacing.value) {
        options.cancelInfraPlacement()
      } else if (
        options.mode.value === 'draw-venue' ||
        options.mode.value === 'draw-booth'
      ) {
        options.cancelDraft()
      } else if (
        options.mode.value === 'height-venue' ||
        options.mode.value === 'height-booth'
      ) {
        options.backToDraw()
      } else {
        options.selectedIds.value = []
      }
      if (typing) (el as HTMLInputElement).blur()
      return
    }

    if (typing) {
      if (
        e.key === 'Enter' &&
        (options.mode.value === 'height-venue' ||
          options.mode.value === 'height-booth')
      ) {
        e.preventDefault()
        options.confirmHeight()
        ;(el as HTMLInputElement).blur()
      }
      return
    }

    if (e.key === 'Enter') {
      if (
        options.mode.value === 'draw-venue' ||
        options.mode.value === 'draw-booth'
      ) {
        options.closeDraft()
      } else if (
        options.mode.value === 'height-venue' ||
        options.mode.value === 'height-booth'
      ) {
        options.confirmHeight()
      }
      return
    }

    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key === 'c' && !e.shiftKey) {
        if (options.selectedIds.value.length) {
          e.preventDefault()
          options.copySelectedBooths()
        } else if (options.selectedInfraId.value) {
          e.preventDefault()
          options.copySelectedInfra()
        }
        return
      }
      if (key === 'z') {
        e.preventDefault()
        if (
          options.mode.value === 'draw-venue' ||
          options.mode.value === 'draw-booth'
        ) {
          options.undoPoint()
        } else if (e.shiftKey) {
          options.redo()
        } else {
          options.undo()
        }
        return
      }
      if (key === 'y') {
        e.preventDefault()
        options.redo()
        return
      }
    }

    if (
      e.key === 'Backspace' &&
      (options.mode.value === 'draw-venue' ||
        options.mode.value === 'draw-booth')
    ) {
      e.preventDefault()
      options.undoPoint()
      return
    }

    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      options.mode.value === 'idle'
    ) {
      if (options.selectedIds.value.length) {
        e.preventDefault()
        options.deleteSelectedBooths()
        return
      }
      if (options.selectedInfraId.value) {
        e.preventDefault()
        options.deleteInfra(options.selectedInfraId.value)
        return
      }
    }

    if (e.key.toLowerCase() === 'g') options.toggleGrid()
  }

  return { onKey }
}
