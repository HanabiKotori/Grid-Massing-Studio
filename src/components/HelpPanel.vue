<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

interface HelpCard {
  title: string
  text: string
}

interface HelpShortcut {
  keys: string
  action: string
}

interface HelpShortcutGroup {
  title: string
  hint: string
  rows: HelpShortcut[]
}

interface HelpSection {
  id: string
  title: string
  lead: string
  cards: HelpCard[]
  tips?: string
  shortcuts?: HelpShortcutGroup[]
}

type HelpQuickAction = 'fit' | 'grid' | 'labels' | 'areas' | 'weather' | 'walk'

const props = defineProps<{
  gridOn: boolean
  labelsOn: boolean
  areasOn: boolean
  canWalk: boolean
}>()

const emit = defineEmits<{
  (e: 'quick', action: HelpQuickAction): void
  (e: 'close'): void
}>()

const active = ref('start')
const contentEl = ref<HTMLElement | null>(null)
const closeEl = ref<HTMLButtonElement | null>(null)
const year = new Date().getFullYear()

const sections: HelpSection[] = [
  {
    id: 'start',
    title: '快速上手',
    lead: '从空白场地到可交付白膜，按这个顺序操作即可。第一次使用可以先载入示例，熟悉后再清空重画。',
    cards: [
      {
        title: '1. 绘制场馆',
        text: '点击「开始绘制」或右侧「绘制场地面积」，在 1 m 网格上依次点击顶点。回到起点、双击或按 Enter 闭合轮廓。',
      },
      {
        title: '2. 设定净高',
        text: '在底部面板输入 2–24 m 的净高，确认后生成场馆白膜。高度决定后续展台和设施的可用范围。',
      },
      {
        title: '3. 绘制展台',
        text: '右侧选择标准 / 脚手架 / 光地，在馆内画出轮廓。标准与脚手架需要设定高度，光地直接生成 0.15 m 台板。',
      },
      {
        title: '4. 设施与家具',
        text: '从右侧基础设施或家具列表选择类型，再点击位置放置。家具必须完整落在同一展台内部。',
      },
      {
        title: '5. 检查与导出',
        text: '用俯视、轴测和漫游检查体量与动线；在「数据 → 汇报图」生成高清俯视图，或导出场景 JSON。',
      },
      {
        title: '示例场景',
        text: '欢迎页「载入示例」会载入内置 W1 场景：19 个展台、66 个设施，包含 25 扇窗户、10 个出入口、16 段内墙和 7 件家具。',
      },
    ],
    tips: '编辑内容会自动保存到浏览器 IndexedDB，刷新页面会自动恢复；导入 JSON 或载入示例会立即覆盖自动保存。重要方案仍建议额外导出备份。',
  },
  {
    id: 'interface',
    title: '界面与视图',
    lead: '画布是主工作区，顶部时间轴、分组工具栏和右侧场景结构分别控制环境、观察方式与模型数据。',
    cards: [
      {
        title: '顶部时间与太阳',
        text: '时间轴按真实时间推进，默认当前本地时间。可拖动、播放/暂停，或点击时钟箭头回到当前时间。',
      },
      {
        title: '分组工具栏',
        text: '分成「视角 / 显示 / 画质 / 数据」四组，二级菜单在工具栏内部展开；帮助和漫游直接进入。显示 → 名称 还有第三级菜单，可分别开关「展台」和「基础设施」名称；默认只显示展台名称，基础设施名称需手动开启。点击菜单内操作后工具栏会保持展开，方便连续调整；再次点击一级按钮或按 Esc 收起。打开天气、帮助、展示模式或进入漫游时会自动关闭菜单。画质单独作为一级菜单，可选极致 / 高 / 中 / 低。视角快捷键：T 俯视、I 轴测、F 适配。PC 为左侧竖向，移动端为顶部横向，可按内容宽度收起 / 展开。',
      },
      {
        title: '快速设置',
        text: 'PC 帮助顶部提供适配视图、网格、名称、面积、天气面板和进入漫游快捷按钮；点击后自动关闭帮助并执行。没有场馆或正在编辑时，进入漫游会禁用。',
      },
      {
        title: '场馆名称与展示模式',
        text: '点击左上角场馆名称可以重命名。按 S 或从视角菜单进入「展示模式」：隐藏所有界面、缓慢环绕观察，把展台名称分散到馆外并用折线连接展台，同时隐藏基础设施名称；按 Esc 或右下角按钮退出。',
      },
      {
        title: '右侧场景结构',
        text: '分场馆、展台、基础设施三组，均可展开收起。顶部固定显示场馆面积和展台覆盖率；选中展台或设施时会自动展开对应卡片并定位到条目。',
      },
      {
        title: '欢迎页与面板',
        text: '首次进入且没有场景时显示欢迎页，右侧场景结构暂时隐藏；生成场馆后结构面板出现，PC 端从右向左滑入。',
      },
      {
        title: '画布操作',
        text: '左键拖动旋转，滚轮缩放，右键拖动平移。右键单击可旋转展台或设施；按住空格进入纯视角浏览。',
      },
      {
        title: '底部操作条',
        text: '绘制和高度确认时出现。Enter 确认，Esc 取消，Backspace 撤销上一点。',
      },
    ],
    tips: '编辑 / 预览切换在顶部中央。预览模式会隐藏编辑面板，只保留查看、导出和漫游。',
  },
  {
    id: 'venue',
    title: '绘制场馆',
    lead: '场馆是所有展台和设施的边界。轮廓必须是闭合、无自交的多边形，并且展台必须完全落在馆内安全范围内。',
    cards: [
      {
        title: '绘制轮廓',
        text: '在网格交点依次点击。至少 3 个顶点；回到第一个点、双击或按 Enter 闭合。Backspace 可撤回上一个点。',
      },
      {
        title: '场馆高度',
        text: '支持 2–24 m。高度只是白膜体量，不会自动生成天花桁架或灯带。',
      },
      {
        title: '封顶与 X-Ray',
        text: '「顶板」控制是否封闭场馆顶部；X-Ray 让墙体半透明，便于看清馆内，但不会自动打开网格。绘制展台时会临时自动半透明。有顶场馆进入漫游选点时，顶板会临时半透明，进入或取消后恢复。刻度数字带 L / W / H 代号，分别表示长、宽、高。',
      },
      {
        title: '面积与覆盖率',
        text: '右侧顶部统计场馆面积、展台总覆盖面积与覆盖率，用于快速判断展位密度。',
      },
      {
        title: '重画与删除',
        text: '可以重新绘制场馆轮廓。重画后超出新范围的展台会被移除，操作前建议先导出备份。',
      },
    ],
    tips: '场馆内部可用范围已经扣除墙厚与 0.4 m 安全距离，展台贴墙时需要留出余量。',
  },
  {
    id: 'booth',
    title: '展台与编辑',
    lead: '三种展台对应不同的空间表达：标准封闭、脚手架通透、光地开放。选中后可以在右侧调整尺寸、展商名称、旋转、标记和 Logo。',
    cards: [
      {
        title: '标准展台',
        text: '四周围挡 + 闭合顶板，适合品牌间。可关闭「顶板」，关闭后顶板和立柱一起消失，只保留低围挡。',
      },
      {
        title: '脚手架展台',
        text: '底部台板 + 加粗金属立柱 / 横梁 + 可选顶棚。柱距按面积自动计算，边界与内部柱网连通为顶部双向桁架，适合通透、可穿行的展位。',
      },
      {
        title: '光地展台',
        text: '只有 0.15 m 微凸台板，适合开放洽谈、产品展示或活动区，可直接摆放家具。',
      },
      {
        title: '移动与旋转',
        text: '拖动展台移动；Alt + 拖动旋转；右键单击旋转 90°。拖动或复制展台进入待放置预览时，靠近其他展台或落地设施约 0.5 m 内会自动贴边吸附，并用橙色框提示目标。旋转和移动都会做轮廓合法性检查。',
      },
      {
        title: '尺寸与合并',
        text: '右侧可调整包围盒长宽。多选后可合并模型；高度不一致时会询问是否统一高度。',
      },
      {
        title: '复制与放置',
        text: '选中一个或多个展台后按 Ctrl / Cmd + C，会连同展台内的家具和落地设施一起复制，并进入幽灵预览放置。选中单个设施后按 Ctrl / Cmd + C，也会以原尺寸、朝向和状态进入放置。待放置的展台和设施同样会吸附到附近对象；门窗吸附墙面及其他门窗，家具仍需落在展台内。移动鼠标后点击落位，Esc 取消。',
      },
      {
        title: '展商名称',
        text: '选中展台后可在右侧填写展商名称，最多 60 个字符。模型名称标签、Logo 立牌、汇报图和 JSON 导出都会带上展商名称；3D 标签中展台名在上、展商名在下。',
      },
      {
        title: 'Logo 与标记',
        text: '标准展台沿每条边各贴一个 Logo；脚手架 / 光地使用正面落地牌。红 / 黄 / 灰标记用于分组识别。',
      },
    ],
    tips: '标准展台关闭顶板后高度标注会降低；需要完整体量时保留顶板。',
  },
  {
    id: 'infra',
    title: '设施与家具',
    lead: '设施参与动线和空间构造，家具用于表达展位内容。两者都不能互相重叠，家具还必须在同一展台内部。',
    cards: [
      {
        title: '出入口',
        text: '自动吸附到最近的场馆墙体或内墙，并在墙上开洞。沿墙拖动靠近另一个门窗时会自动贴边，并用橙色框提示目标。点击现有出入口可以开合；出入口不能旋转。',
      },
      {
        title: '窗户',
        text: '仅能吸附到场馆外墙，默认 2 × 2 m、离地 1 m，可在右侧调整宽度、高度和离地高度。窗户会在墙上开洞，并生成窗框、中梃、窗台和半透明玻璃；不能安装在出入口范围内。沿墙拖动靠近另一个门窗时同样会贴边吸附。',
      },
      {
        title: '内墙与楼梯',
        text: '内墙可以围合空间，楼梯与洗手间、电梯间用于表达辅助功能。拖动设施或移动待放置预览时，靠近其他展台或设施会自动贴边吸附，并显示橙色目标框；放置时仍会检查范围与重叠。',
      },
      {
        title: '家具',
        text: '圆座椅、扶手椅、沙发、圆茶几、方茶几。先点类型，再点展台内部落位；可拖动、旋转、调整长宽。圆座椅固定 0.6 × 0.6 × 0.5 m。',
      },
      {
        title: '多选与整体拖动',
        text: '按住 Ctrl / Cmd 点选相互贴边的设施，可同时选中多个并整体拖动；不相邻的设施会被拒绝加入多选，取消中间设施后若剩余对象断开也会自动回到单选。门窗依附墙面，只能单独选择。',
      },
      {
        title: '摆放限制',
        text: '家具整体必须在同一展台轮廓内；设施之间使用 OBB 碰撞检查。失败时会提示原因。',
      },
      {
        title: '删除',
        text: '选中后在右侧删除，或按 Delete / Backspace。出入口、窗户、内墙和家具都遵循同一套删除逻辑。',
      },
    ],
    tips: '先放沙发、再放茶几和椅子，最容易控制洽谈区的间距。',
  },
  {
    id: 'walk',
    title: '漫游与视角',
    lead: '漫游用于进入馆内检查尺度、动线和展台细节。支持第一人称可见方块身体和第三人称跟随镜头。',
    cards: [
      {
        title: '进入与退出',
        text: '先绘制场馆，再点击工具栏「漫游」或按 P；视角会先切到俯视并适配场馆大小，然后点击地面选择起始位置。Esc 退出；移动端使用左侧摇杆移动、右侧区域调整视角。',
      },
      {
        title: '移动',
        text: 'WASD 移动，Shift 加速，空格跳跃。第一人称低头可以看到身体；第三人称显示完整角色。',
      },
      {
        title: '切换视角',
        text: '按 V 切换第一 / 第三人称，机位带约 0.32 s 平滑过渡。第三人称镜头遇到墙体会自动拉近。',
      },
      {
        title: '返回起点',
        text: '按 R 平滑返回本次漫游的出生点和初始朝向，过渡约 0.7 s。',
      },
      {
        title: '释放鼠标',
        text: '按住 Alt 临时释放鼠标，松开或点击画布重新锁定。便于在漫游中操作其他面板。',
      },
      {
        title: '出入口交互',
        text: '靠近出入口时出现左键提示，点击可以开合。第三人称下准星指向前方场景。',
      },
      {
        title: '缩略地图',
        text: '进入漫游后显示场馆轮廓、展台和当前位置 / 朝向；PC 在右下角，移动端位于时间组件下方。按住 M 可临时放大并居中缩略地图，松开恢复。',
      },
    ],
    tips: '第一人称准星为绿色；按 P 可进入 / 退出漫游，漫游中按 F1 会先退出漫游再打开帮助。',
  },
  {
    id: 'environment',
    title: '时间与画质',
    lead: '时间决定太阳角度、天空色和夜间照明；画质决定阴影、像素比与夜间灯光实现方式。',
    cards: [
      {
        title: '真实时间',
        text: '时间轴 24 小时制，1 秒现实时间 = 1 秒模拟时间，默认当前本地时间。可拖动滑块或点击回到当前时间。',
      },
      {
        title: '播放与暂停',
        text: '播放按钮暂停 / 继续时间推进。点击时钟箭头会平滑回到当前时间，并保持原来的播放 / 暂停状态。',
      },
      {
        title: '画质档位',
        text: '工具栏「画质」是独立一级菜单，可选极致 / 高 / 中 / 低。极致使用实时聚光灯和 4096 阴影；中低画质降低像素比、灯位密度和阴影分辨率。',
      },
      {
        title: '手动天气',
        text: '工具栏「天气」或按 Alt+W 打开面板，Alt+W 只负责打开 / 关闭面板，不改变当前天气。面板顶部有天气效果总开关：关闭时默认为晴天；开启或选择任意天气后生效。切换天气时天空、雾和主光会用约 0.9 秒平滑过渡。实时天气默认查询贵阳，也可以输入城市名或 adcode；PC 端场馆首次生成或载入后会按上次查询城市自动应用实时天气，并在时间组件右侧显示当前天气；移动端默认不自动应用，可在面板中打开「使用实时天气」开关。开关启用后，查询新城市会自动同步；关闭开关则回到晴天。下方可单独拖动雨、雪、沙尘的粒子浓度（0–100%）和能见度；拖动时弹窗与遮罩会暂时隐藏，只保留当前滑块方便观察场景，松开后恢复。当前天气没有对应粒子时滑块会提示并可预览同类天气。少云、多云和阴天会有缓慢漂移的地面云影，太阳主光随之轻微明暗变化。第一人称漫游时叠加镜头雨滴、雾气和雷暴闪白。封闭顶棚下不显示降水。',
      },
      {
        title: '极致灯光',
        text: '极致模式最多 24 盏向下发光的实时聚光灯，不使用烘焙光池；其他画质保留自发光灯泡 + 烘焙光池。',
      },
      {
        title: '性能建议',
        text: '移动端优先使用中或低画质；桌面演示可用高，需要夜景细节时再切极致。少云 / 多云的程序化云影只增加一个透明地面层，对性能影响很小。',
      },
    ],
    tips: '低画质会关闭实时阴影；如果画面发暗或帧率下降，先降低画质再减少展台和家具数量。',
  },
  {
    id: 'delivery',
    title: '保存与交付',
    lead: '编辑内容会自动保存到 IndexedDB 并在刷新后恢复；正式交付仍建议导出 JSON 留档。',
    cards: [
      {
        title: '自动保存与恢复',
        text: '场馆名称、场馆、展台、设施、天气和太阳时间会自动保存。重新打开页面会恢复上次状态；如果手动导入 JSON 或载入示例，新的场景优先并覆盖自动保存。',
      },
      {
        title: '导出 JSON',
        text: '「数据 → 导出」下载场景文件，包含场馆名称、天气、太阳时间、场馆、展台、展商名称、设施、标记、Logo 和材质相关字段。',
      },
      {
        title: '导入 JSON',
        text: '「导入」会做字段容错和范围收敛，兼容旧字段；导入会替换当前场景并立即成为新的自动保存内容。',
      },
      {
        title: '汇报图',
        text: '「数据 → 汇报图」生成约 2400 × 1500 的高质量俯视图，包含场馆名称、面积、覆盖率、展台名称、展商名称和展台编号；有 Logo 的展台会在各自左下角绘制高清 Logo 卡片，即使关闭展台名称也会导出。显示菜单中已打开面积或刻度也会一并绘制，刻度使用 L / W / H 代号并自动避让重叠数字，适合汇报与归档。',
      },
      {
        title: '预览模式',
        text: 'URL 加 `render=1` 进入纯渲染模式，隐藏编辑面板和快捷键，适合嵌入展示。',
      },
      {
        title: '外部 API',
        text: '页面暴露 `window.gridMassing`，可导出展台列表、导入场景和切换纯渲染模式，便于与其他系统对接。',
      },
      {
        title: '交付检查',
        text: '确认场馆闭合、展台不越界、家具在展台内、出入口可开合，并保存一份最终 JSON。',
      },
    ],
    tips: '编辑内容会自动保存到浏览器 IndexedDB，刷新后恢复；正式交付仍建议把导出的 JSON 和截图一起归档。',
  },
  {
    id: 'shortcuts',
    title: '快捷键',
    lead: '常用操作。按是否处于漫游模式分成两组；输入框聚焦时不会触发编辑快捷键。',
    cards: [],
    shortcuts: [
      {
        title: '非漫游 / 编辑',
        hint: '视图、绘制与面板操作',
        rows: [
          { keys: 'Enter', action: '闭合正在绘制的轮廓 / 确认高度' },
          { keys: 'Esc', action: '取消绘制、放置，或清空选择；帮助打开时关闭帮助' },
          { keys: 'Backspace', action: '绘制中撤回上一点；空闲时删除选中对象' },
          { keys: 'Delete', action: '删除选中的展台或设施' },
          { keys: 'Ctrl / Cmd + C', action: '复制选中展台及其内部内容，或复制选中设施并进入放置' },
          { keys: 'Ctrl / Cmd + Z', action: '撤销；绘制中撤回上一点' },
          { keys: 'Ctrl / Cmd + Y', action: '重做' },
          { keys: 'G', action: '显示 / 隐藏网格' },
          { keys: 'T', action: '切换到俯视' },
          { keys: 'I', action: '切换到轴测方向' },
          { keys: 'F', action: '适配并框住当前模型' },
          { keys: 'S', action: '进入展示模式；Esc 退出' },
          { keys: 'Alt+W', action: '打开 / 关闭天气面板，不改变当前天气' },
          { keys: '空格 + 左键拖动', action: '仅旋转视角，不选中或移动模型' },
          { keys: '空格 + 右键拖动', action: '仅平移视角' },
          { keys: '右键单击', action: '旋转光标下的展台 / 设施 90°（出入口除外）' },
        ],
      },
      {
        title: '漫游模式',
        hint: '进入漫游后由漫游接管按键',
        rows: [
          { keys: 'W A S D', action: '移动' },
          { keys: 'Shift', action: '加速' },
          { keys: '空格', action: '跳跃' },
          { keys: 'V', action: '切换第一 / 第三人称' },
          { keys: 'R', action: '平滑返回起点' },
          { keys: 'M', action: '按住放大并居中缩略地图' },
          { keys: 'Alt', action: '按住释放鼠标' },
          { keys: 'Esc', action: '退出漫游' },
          { keys: 'P', action: '进入 / 退出漫游' },
          { keys: 'F1', action: '先退出漫游，再打开帮助' },
        ],
      },
    ],
    tips: '漫游中按 F1 会先退出漫游再打开帮助；关闭帮助后可重新进入漫游。',
  },
]

function selectSection(id: string) {
  active.value = id
  nextTick(() => {
    contentEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

function runQuick(action: HelpQuickAction) {
  emit('quick', action)
}

onMounted(() => closeEl.value?.focus())
</script>

<template>
  <Teleport to="body">
    <div class="help-mask" @click.self="emit('close')">
      <section
        class="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabindex="-1"
      >
        <header class="help-head">
          <div class="help-title">
            <span class="help-mark">?</span>
            <div>
              <h2 id="help-title">使用帮助</h2>
              <p>场馆白膜 · 第一次使用从这里开始</p>
            </div>
          </div>
          <div class="help-head-actions">
            <span class="help-f1"><kbd>F1</kbd> 开关</span>
            <button
              ref="closeEl"
              class="help-close"
              type="button"
              aria-label="关闭帮助"
              title="关闭帮助"
              @click="emit('close')"
            >
              ×
            </button>
          </div>
        </header>

        <div class="help-body">
          <nav class="help-nav" aria-label="帮助目录">
            <button
              v-for="(item, index) in sections"
              :key="item.id"
              type="button"
              :class="{ active: active === item.id }"
              :aria-current="active === item.id ? 'page' : undefined"
              @click="selectSection(item.id)"
            >
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
              {{ item.title }}
            </button>
          </nav>

          <main ref="contentEl" class="help-content">
            <section class="help-quick" aria-label="快速设置">
              <div class="help-quick-head">
                <b>快速设置</b>
                <span>执行后自动关闭帮助</span>
              </div>
              <div class="help-quick-grid">
                <button type="button" @click="runQuick('fit')">
                  适配视图
                </button>
                <button
                  type="button"
                  :class="{ on: gridOn }"
                  :aria-pressed="gridOn"
                  @click="runQuick('grid')"
                >
                  网格<span>{{ gridOn ? '开' : '关' }}</span>
                </button>
                <button
                  type="button"
                  :class="{ on: labelsOn }"
                  :aria-pressed="labelsOn"
                  @click="runQuick('labels')"
                >
                  名称<span>{{ labelsOn ? '开' : '关' }}</span>
                </button>
                <button
                  type="button"
                  :class="{ on: areasOn }"
                  :aria-pressed="areasOn"
                  @click="runQuick('areas')"
                >
                  面积<span>{{ areasOn ? '开' : '关' }}</span>
                </button>
                <button type="button" @click="runQuick('weather')">
                  天气面板
                </button>
                <button
                  type="button"
                  :disabled="!canWalk"
                  :title="canWalk ? '进入漫游' : '请先生成场馆并完成当前编辑'"
                  @click="runQuick('walk')"
                >
                  进入漫游
                </button>
              </div>
            </section>

            <section v-for="item in sections" v-show="active === item.id" :key="item.id">
              <p class="help-lead">{{ item.lead }}</p>

              <div v-if="item.cards.length" class="help-cards">
                <article v-for="card in item.cards" :key="card.title" class="help-card">
                  <h3>{{ card.title }}</h3>
                  <p>{{ card.text }}</p>
                </article>
              </div>

              <div v-if="item.tips" class="help-tip">{{ item.tips }}</div>

              <div v-if="item.shortcuts" class="help-shortcut-groups">
                <div
                  v-for="group in item.shortcuts"
                  :key="group.title"
                  class="help-shortcut-group"
                >
                  <div class="help-shortcut-group-head">
                    <h3>{{ group.title }}</h3>
                    <span>{{ group.hint }}</span>
                  </div>
                  <table class="help-shortcuts">
                    <tbody>
                      <tr v-for="row in group.rows" :key="row.keys">
                        <td><kbd>{{ row.keys }}</kbd></td>
                        <td>{{ row.action }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <footer class="help-foot">
              <span>按 F1 或 Esc 关闭帮助</span>
              <span>Grid Massing Studio · {{ year }}</span>
            </footer>
          </main>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.help-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(18, 20, 24, 0.46);
  backdrop-filter: blur(5px);
}

.help-panel {
  width: min(1040px, 100%);
  max-height: min(780px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 30px 80px -28px rgba(20, 22, 28, 0.55);
  animation: help-in 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.help-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}

.help-title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.help-mark {
  width: 32px;
  height: 32px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--ink);
  color: #fff;
  font-size: 17px;
  font-weight: 600;
}

.help-title h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.help-title p {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: var(--ink-3);
}

.help-head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.help-f1 {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--ink-3);
}

.help-f1 kbd,
.help-shortcuts kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  padding: 0 6px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.help-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--ink-2);
  font-size: 20px;
  line-height: 1;
}

.help-close:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.help-body {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 218px minmax(0, 1fr);
}

.help-nav {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  border-right: 1px solid var(--line);
  background: #faf9f6;
}

.help-nav button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: 8px;
  color: var(--ink-2);
  font-size: 12px;
  text-align: left;
}

.help-nav button span {
  color: var(--ink-3);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

.help-nav button:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.help-nav button.active {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.help-nav button.active span {
  color: var(--accent-ink);
  opacity: 0.65;
}

.help-content {
  min-width: 0;
  overflow-y: auto;
  padding: 24px 28px 18px;
  scroll-behavior: smooth;
}

.help-quick {
  margin: 0 0 18px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: #faf9f6;
}

.help-quick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.help-quick-head b {
  font-size: 11.5px;
  font-weight: 600;
}

.help-quick-head span {
  color: var(--ink-3);
  font-size: 9.5px;
}

.help-quick-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.help-quick-grid button {
  height: 32px;
  padding: 0 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  color: var(--ink-2);
  font-size: 11px;
  text-align: left;
}

.help-quick-grid button:hover {
  border-color: var(--line-strong);
  background: var(--surface-2);
  color: var(--ink);
}

.help-quick-grid button.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.help-quick-grid button span {
  color: var(--ink-3);
  font-size: 9px;
}

.help-quick-grid button.on span {
  color: var(--accent-ink);
  opacity: 0.7;
}

.help-quick-grid button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.help-content section:not(.help-quick) {
  max-width: 760px;
}

.help-content section {
  max-width: 760px;
}

.help-lead {
  margin: 0 0 18px;
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.75;
}

.help-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.help-card {
  padding: 13px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fbfaf7;
}

.help-card h3 {
  margin: 0 0 5px;
  font-size: 12px;
  font-weight: 600;
}

.help-card p {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--ink-2);
}

.help-tip {
  margin-top: 14px;
  padding: 11px 13px;
  border-left: 3px solid var(--accent);
  border-radius: 0 8px 8px 0;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 11.5px;
  line-height: 1.7;
}

.help-shortcut-groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 14px;
}

.help-shortcut-group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
  padding: 0 2px;
}

.help-shortcut-group-head h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.help-shortcut-group-head span {
  color: var(--ink-3);
  font-size: 9.5px;
}

.help-shortcuts {
  width: 100%;
  margin-top: 4px;
  border-collapse: collapse;
  font-size: 11.5px;
}

.help-shortcuts tr + tr {
  border-top: 1px solid var(--line);
}

.help-shortcuts td {
  padding: 9px 0;
  vertical-align: top;
  color: var(--ink-2);
  line-height: 1.55;
}

.help-shortcuts td:first-child {
  width: 150px;
  padding-right: 16px;
}

.help-foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 24px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  color: var(--ink-3);
  font-size: 10px;
}

@keyframes help-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 820px) {
  .help-mask {
    padding: 10px;
  }

  .help-panel {
    max-height: calc(100dvh - 20px);
    border-radius: 14px;
  }

  .help-head {
    padding: 12px 14px;
  }

  .help-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .help-nav {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px;
    border-right: none;
    border-bottom: 1px solid var(--line);
    scrollbar-width: none;
  }

  .help-nav::-webkit-scrollbar {
    display: none;
  }

  .help-nav button {
    width: auto;
    flex: none;
    white-space: nowrap;
    padding: 7px 9px;
  }

  .help-content {
    padding: 16px 14px 14px;
  }

  .help-cards {
    grid-template-columns: 1fr;
  }

  .help-shortcuts td:first-child {
    width: 112px;
    padding-right: 10px;
  }

  .help-f1 {
    display: none;
  }
}
</style>
