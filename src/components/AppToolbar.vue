<script setup lang="ts">
import type { QualityLevel } from '../core/Stage'

type ToolMenu = 'view' | 'display' | 'quality' | 'data'

defineProps<{
  isMobile: boolean
  toolsCollapsed: boolean
  toolMenu: ToolMenu | null
  toolSubMenu: 'names' | null
  hasVenue: boolean
  renderOnly: boolean
  quality: QualityLevel
  qualityLabel: string
  boothLabelsOn: boolean
  infraLabelsOn: boolean
  dimOn: boolean
  areaOn: boolean
  gridOn: boolean
  hasUnderlay: boolean
  underlayVisible: boolean
  weatherActive: boolean
  walkActive: boolean
  /** 多人房间内只保留显示 / 画质 / 天气 */
  multiplayer?: boolean
  /** 访客不能修改天气 */
  weatherDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-collapse'): void
  (e: 'toggle-menu', menu: ToolMenu): void
  (e: 'toggle-name-submenu'): void
  (e: 'toggle-booth-labels'): void
  (e: 'toggle-infra-labels'): void
  (e: 'toggle-dimensions'): void
  (e: 'toggle-areas'): void
  (e: 'toggle-grid'): void
  (e: 'toggle-underlay'): void
  (e: 'view-top'): void
  (e: 'view-iso'): void
  (e: 'fit-view'): void
  (e: 'presentation'): void
  (e: 'choose-quality', level: QualityLevel): void
  (e: 'report'): void
  (e: 'export'): void
  (e: 'import'): void
  (e: 'open-weather'): void
  (e: 'open-help'): void
  (e: 'open-multiplayer'): void
  (e: 'toggle-walk'): void
}>()

const QUALITY_OPTIONS: { value: QualityLevel; label: string }[] = [
  { value: 'ultra', label: '极致' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]
</script>

<template>
  <div class="view-tools" :class="{ collapsed: toolsCollapsed }">
    <button
      v-if="isMobile"
      type="button"
      class="tool-collapse"
      :class="{ collapsed: toolsCollapsed }"
      :aria-expanded="!toolsCollapsed"
      :aria-label="toolsCollapsed ? '展开工具栏' : '收起工具栏'"
      :title="toolsCollapsed ? '展开工具栏' : '收起工具栏'"
      @click="emit('toggle-collapse')"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m14 7-5 5 5 5" />
      </svg>
    </button>

    <div class="tool-main">
      <div v-if="!multiplayer" class="tool-group">
        <button
          class="tool-btn tool-parent"
          :class="{ on: toolMenu === 'view' }"
          aria-haspopup="menu"
          :aria-expanded="toolMenu === 'view'"
          @click.stop="emit('toggle-menu', 'view')"
        >
          视角<span class="tool-caret" />
        </button>
        <div v-if="!isMobile && toolMenu === 'view'" class="tool-menu" role="menu">
          <button
            class="tool-btn"
            role="menuitem"
            title="俯视 (T)"
            aria-keyshortcuts="T"
            @click="emit('view-top')"
          >
            俯视<kbd class="tool-menu-key">T</kbd>
          </button>
          <button
            class="tool-btn"
            role="menuitem"
            title="轴测 (I)"
            aria-keyshortcuts="I"
            @click="emit('view-iso')"
          >
            轴测<kbd class="tool-menu-key">I</kbd>
          </button>
          <button
            class="tool-btn"
            role="menuitem"
            title="适配 (F)"
            aria-keyshortcuts="F"
            @click="emit('fit-view')"
          >
            适配<kbd class="tool-menu-key">F</kbd>
          </button>
          <button
            class="tool-btn"
            role="menuitem"
            :disabled="!hasVenue"
            title="展示模式 (S)"
            aria-keyshortcuts="S"
            @click="emit('presentation')"
          >
            展示模式<kbd class="tool-menu-key">S</kbd>
          </button>
        </div>
      </div>

      <div class="tool-group">
        <button
          class="tool-btn tool-parent"
          :class="{ on: toolMenu === 'display' }"
          aria-haspopup="menu"
          :aria-expanded="toolMenu === 'display'"
          @click.stop="emit('toggle-menu', 'display')"
        >
          显示<span class="tool-caret" />
        </button>
        <div v-if="!isMobile && toolMenu === 'display'" class="tool-menu" role="menu">
          <div class="tool-subgroup">
            <button
              class="tool-btn tool-parent tool-parent-sub"
              :class="{ on: toolSubMenu === 'names' }"
              role="menuitem"
              aria-haspopup="menu"
              :aria-expanded="toolSubMenu === 'names'"
              @click.stop="emit('toggle-name-submenu')"
            >
              名称<span class="tool-caret" />
            </button>
            <div
              v-if="toolSubMenu === 'names'"
              class="tool-menu tool-menu-nested"
              role="menu"
            >
              <button
                class="tool-btn"
                :class="{ on: boothLabelsOn }"
                role="menuitemcheckbox"
                :aria-checked="boothLabelsOn"
                @click.stop="emit('toggle-booth-labels')"
              >
                展台
              </button>
              <button
                class="tool-btn"
                :class="{ on: infraLabelsOn }"
                role="menuitemcheckbox"
                :aria-checked="infraLabelsOn"
                @click.stop="emit('toggle-infra-labels')"
              >
                基础设施
              </button>
            </div>
          </div>
          <button
            class="tool-btn"
            :class="{ on: dimOn }"
            role="menuitem"
            @click="emit('toggle-dimensions')"
          >
            刻度
          </button>
          <button
            class="tool-btn"
            :class="{ on: areaOn }"
            role="menuitem"
            @click="emit('toggle-areas')"
          >
            面积
          </button>
          <button
            class="tool-btn"
            :class="{ on: gridOn }"
            role="menuitem"
            @click="emit('toggle-grid')"
          >
            网格
          </button>
          <button
            class="tool-btn"
            :class="{ on: underlayVisible }"
            role="menuitemcheckbox"
            :aria-checked="underlayVisible"
            :disabled="!hasUnderlay"
            :title="
              hasUnderlay
                ? 'Ctrl + 滚轮逐格缩放，Ctrl + 左键逐格拖动'
                : '请先在场馆面板中上传底图'
            "
            @click="emit('toggle-underlay')"
          >
            底图
          </button>
        </div>
      </div>

      <div class="tool-group">
        <button
          class="tool-btn tool-parent"
          :class="{ on: toolMenu === 'quality' }"
          :title="`画质 · ${qualityLabel}`"
          aria-haspopup="menu"
          :aria-expanded="toolMenu === 'quality'"
          @click.stop="emit('toggle-menu', 'quality')"
        >
          画质<span class="tool-caret" />
        </button>
        <div
          v-if="!isMobile && toolMenu === 'quality'"
          class="tool-menu"
          role="menu"
        >
          <button
            v-for="option in QUALITY_OPTIONS"
            :key="option.value"
            class="tool-btn"
            :class="{ on: quality === option.value }"
            role="menuitem"
            :aria-checked="quality === option.value"
            @click="emit('choose-quality', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="!multiplayer" class="tool-group">
        <button
          class="tool-btn tool-parent"
          :class="{ on: toolMenu === 'data' }"
          aria-haspopup="menu"
          :aria-expanded="toolMenu === 'data'"
          @click.stop="emit('toggle-menu', 'data')"
        >
          数据<span class="tool-caret" />
        </button>
        <div v-if="!isMobile && toolMenu === 'data'" class="tool-menu" role="menu">
          <button class="tool-btn" role="menuitem" @click="emit('report')">
            汇报图
          </button>
          <button class="tool-btn" role="menuitem" @click="emit('export')">导出</button>
          <button
            v-if="!renderOnly"
            class="tool-btn"
            role="menuitem"
            @click="emit('import')"
          >
            导入
          </button>
        </div>
      </div>

      <button
        class="tool-btn tool-with-key"
        :class="{ on: weatherActive }"
        :disabled="weatherDisabled"
        :title="weatherDisabled ? '只有房主可以修改天气' : '天气面板 (Alt+W)'"
        @click="emit('open-weather')"
      >
        <span>天气</span>
        <kbd v-if="!isMobile" class="tool-key wide">Alt+W</kbd>
      </button>
      <button
        v-if="!multiplayer"
        class="tool-btn tool-with-key"
        title="帮助 (F1)"
        @click="emit('open-help')"
      >
        <span>帮助</span>
        <kbd v-if="!isMobile" class="tool-key">F1</kbd>
      </button>
      <button
        v-if="!multiplayer"
        class="tool-btn tool-with-key"
        :disabled="!hasVenue"
        :title="hasVenue ? '多人漫游 (G)' : '请先绘制场馆'"
        @click="emit('open-multiplayer')"
      >
        <span>多人</span>
        <kbd v-if="!isMobile" class="tool-key">G</kbd>
      </button>
      <button
        v-if="!multiplayer"
        class="tool-btn tool-with-key"
        :class="{ on: walkActive }"
        :disabled="!hasVenue"
        :title="hasVenue ? '漫游 (P)' : '请先绘制场馆'"
        @click="emit('toggle-walk')"
      >
        <span>漫游</span>
        <kbd v-if="!isMobile" class="tool-key">P</kbd>
      </button>
    </div>

    <div
      v-if="isMobile && toolMenu"
      :key="toolMenu"
      class="tool-mobile-sub"
      role="menu"
    >
      <template v-if="toolMenu === 'view'">
        <button class="tool-btn" role="menuitem" @click="emit('view-top')">俯视</button>
        <button class="tool-btn" role="menuitem" @click="emit('view-iso')">轴测</button>
        <button class="tool-btn" role="menuitem" @click="emit('fit-view')">适配</button>
        <button
          class="tool-btn"
          role="menuitem"
          :disabled="!hasVenue"
          @click="emit('presentation')"
        >
          展示模式
        </button>
      </template>
      <template v-else-if="toolMenu === 'display'">
        <button
          class="tool-btn tool-parent tool-parent-sub"
          :class="{ on: toolSubMenu === 'names' }"
          role="menuitem"
          aria-haspopup="menu"
          :aria-expanded="toolSubMenu === 'names'"
          @click.stop="emit('toggle-name-submenu')"
        >
          名称<span class="tool-caret" />
        </button>
        <div
          v-if="toolSubMenu === 'names'"
          class="tool-mobile-sub3"
          role="menu"
        >
          <button
            class="tool-btn"
            :class="{ on: boothLabelsOn }"
            role="menuitemcheckbox"
            :aria-checked="boothLabelsOn"
            @click.stop="emit('toggle-booth-labels')"
          >
            展台
          </button>
          <button
            class="tool-btn"
            :class="{ on: infraLabelsOn }"
            role="menuitemcheckbox"
            :aria-checked="infraLabelsOn"
            @click.stop="emit('toggle-infra-labels')"
          >
            基础设施
          </button>
        </div>
        <button
          class="tool-btn"
          :class="{ on: dimOn }"
          role="menuitem"
          @click="emit('toggle-dimensions')"
        >
          刻度
        </button>
        <button
          class="tool-btn"
          :class="{ on: areaOn }"
          role="menuitem"
          @click="emit('toggle-areas')"
        >
          面积
        </button>
        <button
          class="tool-btn"
          :class="{ on: gridOn }"
          role="menuitem"
          @click="emit('toggle-grid')"
        >
          网格
        </button>
        <button
          class="tool-btn"
          :class="{ on: underlayVisible }"
          role="menuitemcheckbox"
          :aria-checked="underlayVisible"
          :disabled="!hasUnderlay"
          :title="
            hasUnderlay
              ? 'Ctrl + 滚轮逐格缩放，Ctrl + 左键逐格拖动'
              : '请先在场馆面板中上传底图'
          "
          @click="emit('toggle-underlay')"
        >
          底图
        </button>
      </template>
      <template v-else-if="toolMenu === 'quality'">
        <button
          v-for="option in QUALITY_OPTIONS"
          :key="option.value"
          class="tool-btn"
          :class="{ on: quality === option.value }"
          role="menuitem"
          @click="emit('choose-quality', option.value)"
        >
          {{ option.label }}
        </button>
      </template>
      <template v-else-if="toolMenu === 'data'">
        <button class="tool-btn" role="menuitem" @click="emit('report')">
          汇报图
        </button>
        <button class="tool-btn" role="menuitem" @click="emit('export')">导出</button>
        <button
          v-if="!renderOnly"
          class="tool-btn"
          role="menuitem"
          @click="emit('import')"
        >
          导入
        </button>
      </template>
    </div>
  </div>
</template>
