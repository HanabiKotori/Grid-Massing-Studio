<script setup lang="ts">
import { computed } from 'vue'
import type { EditorMode, Pt } from '../core/types'

const props = defineProps<{
  mode: EditorMode
  objectCount: number
  selectedCount: number
  selectedLabel: string
  hover: Pt | null
  /** 选中对象在网格坐标系中的位置，未选中时为 null */
  position: Pt | null
  /** 画布中心的世界坐标 */
  viewCenter: { x: number; y: number; z: number } | null
  /** 相机方位角，正北为 0°，顺时针 */
  viewAzimuth: number
  gridOn: boolean
  renderOnly: boolean
  walking: boolean
  spaceNav: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  savedAt: number | null
}>()

const modeText = computed(() => {
  if (props.walking) return '漫游中'
  if (props.spaceNav) return '浏览模式'
  if (props.renderOnly) return '只读预览'
  if (props.mode === 'idle') return '就绪'
  if (props.mode === 'draw-venue') return '绘制场馆'
  if (props.mode === 'draw-booth') return '绘制展台'
  if (props.mode.startsWith('place-')) return '放置对象'
  if (props.mode === 'paste-booths') return '粘贴展台'
  return '编辑模式'
})

const selectionText = computed(() => {
  if (props.selectedCount > 1) return `已选 ${props.selectedCount} 个`
  if (props.selectedCount === 1) return props.selectedLabel || '已选 1 个'
  return '未选择'
})

/** 选中对象优先，未选中时跟随鼠标，方便绘制时读点 */
const coord = computed(() => props.position ?? props.hover)

const saveText = computed(() => {
  if (props.saveState === 'saving') return '保存中…'
  if (props.saveState === 'error') return '保存失败'
  if (props.saveState === 'saved' && props.savedAt) {
    const d = new Date(props.savedAt)
    return `已保存 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return '无数据'
})
</script>

<template>
  <footer class="wb-status">
    <span class="live">{{ modeText }}</span>
    <span class="vsep" />
    <span>{{ selectionText }}</span>
    <span class="vsep" />
    <span
      class="wb-coord wb-object-coord"
      :title="position ? '选中对象在网格中的位置' : '鼠标在网格中的位置'"
    >
      <span class="wb-coord-label">{{ position ? '对象' : '鼠标' }}</span>
      <span>X <b>{{ coord ? coord.x.toFixed(1) : '—' }}</b></span>
      <span>Z <b>{{ coord ? coord.z.toFixed(1) : '—' }}</b></span>
      <span class="wb-coord-unit">m</span>
    </span>
    <span class="vsep" />
    <span class="wb-coord" title="画布中心的世界坐标与相机方位角（正北为 0°）">
      <span class="wb-coord-label">中心</span>
      <span>X <b>{{ viewCenter ? viewCenter.x.toFixed(1) : '—' }}</b></span>
      <span>Y <b>{{ viewCenter ? viewCenter.y.toFixed(1) : '—' }}</b></span>
      <span>Z <b>{{ viewCenter ? viewCenter.z.toFixed(1) : '—' }}</b></span>
      <span class="wb-coord-unit">m</span>
      <span class="wb-coord-sep" />
      <span>方位 <b>{{ viewAzimuth.toFixed(1) }}</b></span>
      <span class="wb-coord-unit">°</span>
    </span>
    <span class="sp" />
    <span class="wb-save" :class="saveState">{{ saveText }}</span>
    <span class="vsep" />
    <span>{{ gridOn ? '1 m 网格 · 吸附 0.5 m' : '网格关闭' }}</span>
    <span class="vsep" />
    <span>对象 <b>{{ objectCount }}</b></span>
  </footer>
</template>
