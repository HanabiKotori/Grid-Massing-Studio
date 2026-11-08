<script setup lang="ts">
import { ref } from 'vue'

interface MobileHelpCard {
  title: string
  text: string
}

interface MobileHelpSection {
  id: string
  title: string
  lead: string
  cards: MobileHelpCard[]
  tip?: string
}

const emit = defineEmits<{
  (e: 'close'): void
}>()

const openId = ref('start')

const sections: MobileHelpSection[] = [
  {
    id: 'start',
    title: '快速上手',
    lead: '移动端按「先场馆、再展台、最后设施和家具」的顺序操作。第一次使用可以先载入示例。',
    cards: [
      {
        title: '1. 绘制场馆',
        text: '点击「开始绘制」或右侧「绘制场地面积」，在 1 m 网格上依次点选顶点。点击起点、双击或按 Enter 闭合。',
      },
      {
        title: '2. 设定净高',
        text: '底部面板会换行显示高度滑块、数字输入和预设按钮。确认后生成场馆白膜。',
      },
      {
        title: '3. 绘制展台',
        text: '在场景结构里选择标准 / 脚手架 / 光地，在馆内画出轮廓；标准与脚手架需要设定高度。',
      },
      {
        title: '4. 设施与家具',
        text: '从右侧面板选择设施或家具，再点击位置放置。家具只能放在展台内部。',
      },
      {
        title: '5. 检查与导出',
        text: '切到漫游检查空间，最后通过「数据 → 导出」保存 JSON。',
      },
      {
        title: '示例场景',
        text: '欢迎页「载入示例」会载入内置 W1 场景：19 个展台、66 个设施，包含 25 扇窗户、10 个出入口、16 段内墙和 7 件家具。',
      },
    ],
    tip: '编辑内容会自动保存到浏览器 IndexedDB，刷新后恢复；手动导入 JSON 或载入示例时新场景优先。重要方案仍建议额外导出备份。',
  },
  {
    id: 'layout',
    title: '移动端界面',
    lead: '移动端工具栏在顶部横向显示，面板和操作区会针对触屏重新排列。',
    cards: [
      {
        title: '工具栏',
        text: '一级按钮按内容宽度显示，右侧箭头可以收起 / 展开。视角、显示、画质、数据为分组菜单，帮助和漫游直接进入；二级菜单在工具栏内部另起一行，不会弹出到屏幕外，过长时可横向滚动。显示 → 名称 还有第三级菜单，可分别开关「展台」和「基础设施」名称；默认只显示展台名称。点击菜单内操作后工具栏保持展开，方便连续调整。',
      },
      {
        title: '场景结构',
        text: '未创建场馆时欢迎页显示，结构面板隐藏。创建场馆后可以打开结构面板，面积和覆盖率固定在顶部。',
      },
      {
        title: '选中与定位',
        text: '在画布或列表选中展台 / 设施后，对应卡片会自动展开并定位到条目。',
      },
      {
        title: '面板与安全区',
        text: '移动端面板使用底部抽屉 / 侧栏布局，按钮已避开刘海和底部安全区。',
      },
      {
        title: '场馆名称与展示模式',
        text: '点击左上角场馆名称可重命名。视角菜单里的「展示模式」会隐藏界面并缓慢环绕，展台名称会分配到馆外并用折线连接展台，基础设施名称隐藏；点击右下角按钮退出。',
      },
    ],
    tip: '屏幕较窄时优先横屏操作，工具栏和场景视野会更宽。',
  },
  {
    id: 'venue',
    title: '场馆与展台',
    lead: '场馆决定可用边界和净高，三种展台表达不同的空间类型。',
    cards: [
      {
        title: '场馆轮廓',
        text: '至少 3 个顶点；回到起点、双击或 Enter 闭合。镜头会自动适配当前屏幕比例。',
      },
      {
        title: '展台类型',
        text: '标准展台带围挡和顶板；脚手架展台使用台板 + 自动立柱 / 桁架；光地只有 0.15 m 台板。',
      },
      {
        title: '调整与旋转',
        text: '选中展台后，在结构面板调整长宽、高度、展商名称、顶板和标记；展商名称会进入模型标签、汇报图和导出 JSON。移动端可通过面板按钮旋转。',
      },
      {
        title: '设施与家具',
        text: '出入口、窗户、内墙、楼梯、洗手间、电梯间和家具都从右侧面板添加。窗户仅能吸附场馆外墙，会在墙上开洞并生成窗框和半透明玻璃，可调宽度、高度与离地高度，不能与出入口重叠。',
      },
    ],
  },
  {
    id: 'walk',
    title: '移动端漫游',
    lead: '漫游建议横屏并进入全屏，左侧移动、右侧看视角。',
    cards: [
      {
        title: '进入漫游',
        text: '需要先生成场馆。点击工具栏「漫游」后再点击地面选择起点；竖屏会提示旋转设备。有顶场馆在选点时顶板会临时半透明，进入漫游后恢复。',
      },
      {
        title: '移动与视角',
        text: '左侧虚拟摇杆移动；右侧半屏触摸区调整视角。使用「回到起点」平滑返回本次漫游起点，使用跳跃按钮跨越台阶，使用「退出」结束漫游。',
      },
      {
        title: '第一 / 第三人称',
        text: '使用「第一人称 / 第三人称」按钮切换，镜头带平滑过渡；第三人称会避让墙体和展台。',
      },
      {
        title: '罗盘与工具栏',
        text: '漫游时罗盘位于时间组件左侧；工具栏保持可见并可折叠，不占用左侧摇杆区域。',
      },
      {
        title: '缩略地图',
        text: '漫游时缩略地图位于时间组件下方，显示场馆轮廓、展台和当前位置 / 朝向。',
      },
    ],
    tip: '移动端没有键盘快捷键，回到起点、跳跃、退出和帮助都使用屏幕按钮。',
  },
  {
    id: 'environment',
    title: '时间与画质',
    lead: '时间影响太阳和夜间灯光；移动端建议优先保证帧率。',
    cards: [
      {
        title: '真实时间',
        text: '时间轴按真实时间推进，默认当前本地时间。可以拖动滑块、暂停 / 播放，或点击时钟箭头回到当前时间。',
      },
      {
        title: '画质',
        text: '工具栏「画质」是独立一级菜单，可选极致 / 高 / 中 / 低；中 / 低画质会降低像素比、阴影和夜间灯位密度，移动端优先使用中或低。',
      },
      {
        title: '手动天气',
        text: '工具栏「天气」会先查询高德实时天气，默认贵阳，也可输入其他城市；面板顶部有天气效果总开关，关闭时默认为晴天，选择任意天气或开启实时天气后自动启用。切换天气时天空、雾和主光会用约 0.9 秒平滑过渡。移动端默认不会在场馆生成后自动应用实时天气，可在面板中打开「使用实时天气」开关；启用后查询新城市会自动同步，关闭则回到晴天。下方可分别拖动雨、雪、沙尘粒子浓度和能见度，拖动时弹窗与遮罩会暂时隐藏，只保留当前滑块便于预览，松开恢复。少云、多云和阴天会有漂移云影和轻微阳光明暗变化。当前天气没有对应粒子时会提示并可预览同类天气。第一人称漫游时叠加镜头水痕、雾气与闪白；封闭场馆内不会下雨下雪。',
      },
      {
        title: '夜间灯光',
        text: '常规画质使用自发光灯泡和烘焙地面光池；极致模式使用实时聚光灯，移动端不建议长时间使用。',
      },
    ],
  },
  {
    id: 'save',
    title: '保存与交付',
    lead: '编辑内容会自动保存到 IndexedDB 并在刷新后恢复。',
    cards: [
      {
        title: '自动保存与恢复',
        text: '场馆名称、场馆、展台、设施、天气和太阳时间会自动保存；刷新页面会恢复上次状态。手动导入 JSON 或载入示例后，新场景优先并覆盖自动保存。',
      },
      {
        title: '汇报图',
        text: '通过「数据 → 汇报图」生成高质量俯视图，包含场馆名称、面积、覆盖率、展台名称和展商名称；有 Logo 的展台会在左下角导出高清 Logo 卡片。显示菜单中打开的面积或刻度也会一并导出，刻度使用 L / W / H 代号并自动避让重叠数字。',
      },
      {
        title: '导出 JSON',
        text: '通过「数据 → 导出」下载场景文件。导入会替换当前场景并成为新的自动保存内容。',
      },
      {
        title: '预览模式',
        text: '使用 `render=1` 进入纯预览，隐藏编辑面板，适合嵌入或现场展示。',
      },
      {
        title: '交付检查',
        text: '确认场馆闭合、展台不越界、家具在展台内，并保存最终 JSON。',
      },
    ],
  },
  {
    id: 'gestures',
    title: '触屏操作',
    lead: '移动端没有鼠标右键和键盘快捷键，主要依靠单指、双指和屏幕按钮。',
    cards: [
      {
        title: '旋转 / 平移视角',
        text: '画布上单指拖动旋转；双指手势用于缩放 / 平移。',
      },
      {
        title: '选择与移动',
        text: '点按选中展台或设施，拖动调整位置；拖动或待放置预览靠近其他展台或设施约 0.5 m 内会自动贴边吸附，橙色框表示目标。门窗沿墙靠近另一个门窗时也会吸附，尺寸和旋转使用右侧面板按钮。',
      },
      {
        title: '关闭帮助',
        text: '点击右上角关闭按钮，或点击页面遮罩区域退出帮助。',
      },
    ],
  },
]

function toggle(id: string) {
  openId.value = openId.value === id ? '' : id
}
</script>

<template>
  <Teleport to="body">
    <div class="mobile-help" role="dialog" aria-modal="true" aria-labelledby="mobile-help-title">
      <header class="mobile-help-head">
        <div>
          <p>移动端指南</p>
          <h2 id="mobile-help-title">使用帮助</h2>
        </div>
        <button class="mobile-help-close" type="button" aria-label="关闭帮助" @click="emit('close')">
          ×
        </button>
      </header>

      <main class="mobile-help-body">
        <p class="mobile-help-intro">第一次使用，从「快速上手」开始；遇到操作问题再展开对应章节。</p>

        <section v-for="(item, index) in sections" :key="item.id" class="mobile-help-section">
          <button
            class="mobile-help-section-head"
            type="button"
            :aria-expanded="openId === item.id"
            @click="toggle(item.id)"
          >
            <span class="mobile-help-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <b>{{ item.title }}</b>
            <span class="mobile-help-chevron" :class="{ open: openId === item.id }" />
          </button>

          <div v-show="openId === item.id" class="mobile-help-section-body">
            <p class="mobile-help-lead">{{ item.lead }}</p>
            <article v-for="card in item.cards" :key="card.title" class="mobile-help-card">
              <h3>{{ card.title }}</h3>
              <p>{{ card.text }}</p>
            </article>
            <div v-if="item.tip" class="mobile-help-tip">{{ item.tip }}</div>
          </div>
        </section>

        <footer class="mobile-help-foot">
          <span>场馆白膜 · 移动端</span>
          <button type="button" @click="emit('close')">关闭帮助</button>
        </footer>
      </main>
    </div>
  </Teleport>
</template>

<style scoped>
.mobile-help {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  flex-direction: column;
  background: #f3f1ec;
  color: var(--ink);
}

.mobile-help-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
  background: rgba(255, 255, 255, 0.94);
  border-bottom: 1px solid var(--line);
}

.mobile-help-head p {
  margin: 0 0 2px;
  color: var(--ink-3);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.mobile-help-head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.mobile-help-close {
  width: 40px;
  height: 40px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 22px;
  line-height: 1;
}

.mobile-help-body {
  min-height: 0;
  overflow-y: auto;
  padding: 14px 14px calc(20px + env(safe-area-inset-bottom));
  -webkit-overflow-scrolling: touch;
}

.mobile-help-intro {
  margin: 0 2px 14px;
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.7;
}

.mobile-help-section {
  margin-bottom: 9px;
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 13px;
}

.mobile-help-section-head {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 13px;
  text-align: left;
}

.mobile-help-index {
  color: var(--ink-3);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.mobile-help-section-head b {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
}

.mobile-help-chevron {
  width: 7px;
  height: 7px;
  flex: none;
  border-right: 1.5px solid var(--ink-3);
  border-bottom: 1.5px solid var(--ink-3);
  transform: rotate(45deg);
  transition: transform 0.2s ease;
}

.mobile-help-chevron.open {
  transform: rotate(225deg);
}

.mobile-help-section-body {
  padding: 0 13px 13px;
}

.mobile-help-lead {
  margin: 0 0 10px;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.7;
}

.mobile-help-card {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}

.mobile-help-card h3 {
  margin: 0 0 4px;
  font-size: 12.5px;
  font-weight: 600;
}

.mobile-help-card p {
  margin: 0;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.7;
}

.mobile-help-tip {
  margin-top: 6px;
  padding: 9px 10px;
  border-left: 3px solid var(--accent);
  border-radius: 0 7px 7px 0;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 11.5px;
  line-height: 1.65;
}

.mobile-help-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 18px 2px 0;
  color: var(--ink-3);
  font-size: 10.5px;
}

.mobile-help-foot button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--ink-2);
  font-size: 11.5px;
}
</style>
