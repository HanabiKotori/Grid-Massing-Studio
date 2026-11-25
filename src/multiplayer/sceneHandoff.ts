import type { StoredProject } from '../core/projectStore'

/**
 * 编辑器 → 多人页的同页场景交接。
 *
 * 路由组件在同一个 JS 运行时内切换，直接用内存传递可以避开
 * sessionStorage 5MB 配额和 IndexedDB 写入失败，尤其是包含
 * Logo / 底图的大型场景。
 */
let pendingProject: StoredProject | null = null

export function setMultiplayerSceneHandoff(project: StoredProject): void {
  pendingProject = project
}

export function readMultiplayerSceneHandoff(): StoredProject | null {
  return pendingProject
}

export function clearMultiplayerSceneHandoff(): void {
  pendingProject = null
}
