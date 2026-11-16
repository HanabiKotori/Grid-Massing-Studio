<script setup lang="ts">
import { ref } from 'vue'
import { DEFAULT_REPORT_LAYERS, type ReportLayers } from '../core/Stage'

defineProps<{ busy?: boolean }>()

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'export', kind: 'png' | 'pdf', layers: ReportLayers): void
}>()

const ITEMS: { key: keyof ReportLayers; label: string; hint: string }[] = [
  { key: 'boothNames', label: '展台名称', hint: '编号与名称气泡' },
  { key: 'exhibitors', label: '展商', hint: '名称下方的小字' },
  { key: 'areas', label: '面积', hint: '展台面积标签' },
  { key: 'dimensions', label: '刻度', hint: '场馆与展台的尺寸线' },
  { key: 'logos', label: 'Logo', hint: '名称左侧的品牌图标' },
  { key: 'aisles', label: '过道宽度', hint: '相邻展台之间的净距' },
  { key: 'infraNames', label: '基础设施名称', hint: '楼梯、洗手间、出入口等' },
  { key: 'underlay', label: '底图', hint: '上传的参考图纸' },
]

const layers = ref<ReportLayers>({ ...DEFAULT_REPORT_LAYERS })

function toggle(key: keyof ReportLayers) {
  layers.value = { ...layers.value, [key]: !layers.value[key] }
}

function setAll(on: boolean) {
  const next = { ...layers.value }
  for (const item of ITEMS) next[item.key] = on
  layers.value = next
}
</script>

<template>
  <div class="export-mask" @click.self="emit('cancel')">
    <div class="export-dialog" role="dialog" aria-modal="true" aria-label="导出图像">
      <header class="ed-head">
        <div>
          <p class="ed-kicker">导出</p>
          <h3>选择要包含的内容</h3>
        </div>
        <button type="button" class="ed-close" aria-label="关闭" @click="emit('cancel')">×</button>
      </header>

      <div class="ed-tools">
        <span class="ed-count">{{ ITEMS.filter((i) => layers[i.key]).length }} / {{ ITEMS.length }}</span>
        <button type="button" class="ed-link" @click="setAll(true)">全选</button>
        <button type="button" class="ed-link" @click="setAll(false)">全不选</button>
      </div>

      <ul class="ed-list">
        <li v-for="item in ITEMS" :key="item.key">
          <button
            type="button"
            class="ed-row"
            :class="{ on: layers[item.key] }"
            :aria-pressed="layers[item.key]"
            @click="toggle(item.key)"
          >
            <span class="ed-box" />
            <b>{{ item.label }}</b>
            <span class="ed-hint">{{ item.hint }}</span>
          </button>
        </li>
      </ul>

      <footer class="ed-foot">
        <button type="button" class="ed-btn ghost" :disabled="busy" @click="emit('cancel')">取消</button>
        <button type="button" class="ed-btn" :disabled="busy" @click="emit('export', 'png', layers)">
          {{ busy ? '生成中…' : '导出 PNG' }}
        </button>
        <button type="button" class="ed-btn pri" :disabled="busy" @click="emit('export', 'pdf', layers)">
          {{ busy ? '生成中…' : '导出 PDF' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.export-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 5, 6, 0.66);
  backdrop-filter: blur(3px);
}

.export-dialog {
  width: 420px;
  max-width: 100%;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: #0b0c0e;
  box-shadow: 0 40px 90px -30px #000;
  color: var(--ink-2, #b6bac1);
}

.ed-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.ed-kicker {
  margin: 0 0 3px;
  font-family: var(--mono, monospace);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3, #63666c);
}

.ed-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink, #ecedef);
}

.ed-close {
  margin-left: auto;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: #16171b;
  color: var(--ink-2, #b6bac1);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.ed-close:hover {
  color: var(--ink, #ecedef);
}

.ed-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ed-count {
  font-family: var(--mono, monospace);
  font-size: 10px;
  color: var(--ink-3, #63666c);
}

.ed-link {
  padding: 0;
  border: 0;
  background: none;
  color: #8b93c7;
  font-size: 11px;
  cursor: pointer;
}

.ed-link:hover {
  color: #cdd3ff;
}

.ed-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px 8px;
  list-style: none;
  overflow-y: auto;
}

.ed-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 34px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--ink-2, #b6bac1);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.ed-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.ed-box {
  position: relative;
  flex: none;
  width: 14px;
  height: 14px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background: #0e0f12;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.ed-row.on .ed-box {
  border-color: transparent;
  background: #6f7ce8;
}

/* 对勾用两条边框旋转绘制，避免渐变画出的斜线像叉号 */
.ed-row.on .ed-box::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1.5px;
  width: 3px;
  height: 6px;
  border: solid #fff;
  border-width: 0 1.8px 1.8px 0;
  transform: rotate(45deg);
}

.ed-row b {
  flex: none;
  font-weight: 500;
  color: inherit;
}

.ed-row.on b {
  color: #cdd3ff;
}

.ed-hint {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--ink-3, #63666c);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ed-foot {
  display: flex;
  gap: 8px;
  padding: 12px 16px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.ed-btn {
  flex: 1;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: #16171b;
  color: var(--ink-2, #b6bac1);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.ed-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--ink, #ecedef);
}

.ed-btn.pri {
  border-color: transparent;
  background: #6f7ce8;
  color: #fff;
}

.ed-btn.pri:hover:not(:disabled) {
  background: #7f8bef;
}

.ed-btn.ghost {
  flex: none;
  width: 68px;
  border-color: transparent;
  background: none;
}

.ed-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 520px) {
  .export-dialog {
    width: 100%;
  }

  .ed-hint {
    display: none;
  }
}
</style>
