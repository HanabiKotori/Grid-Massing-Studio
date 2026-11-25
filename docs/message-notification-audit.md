# 消息通知与 Toast 现状审计

日期：2026-11-22  
范围：编辑器、分享页、多人漫游、云端 / 分享 / 天气等对话框，以及三端使用的 REST / SSE / WebSocket 消息。

> 2026-11-22 更新：本报告是审计基线，后续已开始落地统一 ToastHost / MessageCenter。当前实现、倒计时进度条、动画和音效候选见 `docs/message-system-design.html` 与 `docs/message-types-and-sounds.md`。

## 结论摘要

项目里目前不是一套消息系统，而是 **4 套 Toast + 2 套持久提示 + 1 套聊天流**：

- 编辑器全局 Toast：底部居中，2.8 秒，单槽位
- 编辑器评审 Toast：右上角，3.6 秒，单槽位，可点击「查看」
- 分享页 Toast：左上角，3.2 秒，单槽位
- 多人漫游 Toast：顶部居中，2.2 秒，单槽位
- 多人大厅持久错误 / 状态：内联，带 `role="status"` / `aria-live`
- 各对话框内联错误：分享、云端、分享登录、天气等
- 多人房间聊天：WebSocket 消息流，最近 5 条、8 秒后消失

核心问题有三个：

1. **分享页没有真正的新消息通知**：`comment.created` 只对 `authorRole === 'owner'` 弹 Toast，其他访客的新评论、回复都静默插入列表；没有未读数，也没有移动端入口。
2. **Toast 没有统一的队列、严重级别和无障碍支持**：所有 Toast 都是单槽位覆盖，没有 `role="status"` / `aria-live`，没有暂停、关闭、去重，连续消息会丢失。
3. **消息通道分散**：编辑器有两套 Toast，分享页和多人各有一套；错误有的内联、有的 Toast、有的只写 `console.warn`，用户看到的反馈不一致。

建议不要直接把现有 Toast 换成一个更大的 Toast，而是拆成：

- **Toast**：短暂的成功 / 信息 / 非阻塞错误
- **Notification Center**：评论、未读、需要回看的事件
- **Inline Error**：表单和对话框校验
- **Banner / Status**：页面级错误、保存状态、连接状态
- **Chat Feed**：多人房间聊天，不混入 Toast

---

## 1. 通道清单

| # | 通道 | 实现位置 | 时长 / 位置 | 行为 | 无障碍 |
| --- | --- | --- | --- | --- | --- |
| 1 | 编辑器全局 Toast | `src/composables/useEditorState.ts` `toast()`；`App.vue` 底部渲染 | 2.8s；底部居中，时间轴上方；`z-index: 70` | 单槽位，新消息覆盖旧消息；无操作按钮 | 无 |
| 2 | 编辑器评审 Toast | `src/App.vue` `reviewToast`；`review.css` `.review-toast` | 3.6s；固定右上角，`top: 56px` | 单槽位；点击整条或「查看」打开评审 Tab；只对访客评论触发 | 无 |
| 3 | 分享页 Toast | `src/share/ShareApp.vue` `showToast()`；`share.css` `.share-toast` | 3.2s；左上角，`top: 46px`；`z-index: 9` | 单槽位；成功、登录、复制、作者回复共用 | 无 |
| 4 | 多人漫游 Toast | `src/multiplayer/MultiplayerApp.vue` `toast()`；`multiplayer.css` `.mp-toast` | 2.2s；顶部居中；`z-index: 60` | 单槽位；加入 / 退出 / 全屏 / 权限提示 | 无 |
| 5 | 多人大厅持久提示 | `MultiplayerApp.vue` `error` / `status`；`.mp-alert-stack` | 不自动消失；大厅顶部 | 错误与状态可同时展示 | `role="status"` `aria-live="polite"` |
| 6 | 对话框内联错误 | `ShareDialog` `.sd-error`；`CloudStorageDialog` `.cs-error`；`ShareLoginDialog` `.sl-error`；`WeatherPanel` `.wp-error` | 跟随表单 | 错误留在原地，不自动消失 | 无统一 `role="alert"` |
| 7 | 分享页全屏错误 | `ShareApp.vue` `.share-error` | 页面级 | 链接撤销 / 加载失败时覆盖画布，只提供「返回编辑器」 | 无 |
| 8 | 编辑器状态栏 | `StatusBar.vue`：保存中 / 已保存 / 保存失败 / 云端未就绪 | 持续 | 自动保存与云端状态的唯一持久入口 | 无 `aria-live` |
| 9 | 评审只读 / 登录门槛 | `ReviewPanel.vue` `.rp-readonly` / `.rp-login-gate` | 持续 | 未登录、评论关闭时替代输入框 | 无 |
| 10 | 多人聊天流 | `MultiplayerApp.vue` `.mp-chat-feed`；`dataService/src/multiplayer/index.mjs` | 最近 5 条，8 秒后消失 | WebSocket `message`；自己和他人的消息同流；系统提示也走同一通道 | 无 `role="log"` |
| 11 | 徽标 / 在线状态 | `AppTopBar` 评审未读、分享查看人数；`ReviewPanel` 未读；`CommentLayer` 引脚；多人 `mp-online-badge` | 持续 | 评论未读、在线人数、评论引脚 | 在线人数有 `aria-live`，其余无 |
| 12 | 页面级遮罩 | `App.vue` 启动遮罩；多人房间关闭弹窗 | 持续到完成 / 跳转 | 启动加载、房主退出、连接断开 | 启动遮罩有 `role="status"` |

### 代码统计

按当前源码统计：

- 编辑器 `toast(...)` 调用点约 **170 处**（`App.vue` 49 处 + 各 composable 约 121 处）
- 分享页 `showToast(...)` 调用点 **23 处**
- 多人漫游 `toast(...)` 调用点 **13 处**
- 有 `role="status"` / `aria-live` 的只有启动遮罩、多人大厅状态和在线人数；**所有 Toast 都没有无障碍播报**
- 没有 `window.alert` / `confirm` / `prompt`
- 没有 Notification API、系统通知或音效

---

## 2. 分界面现状

### 2.1 编辑器

**全局 Toast**

- 入口：`useEditorState.ts` 的 `toast()`，写到 `toastMsg`。
- 覆盖：保存、导入、导出、阵列复制、底图、天气、画质、只读提示、云端位置等。
- 特点：
  - 一条消息覆盖上一条，2.8 秒后清空。
  - 成功、警告、失败共用同一个中性样式。
  - 没有操作按钮，没有暂停 / 关闭。
  - 演示模式 CSS 会隐藏 `.toast`，但不会隐藏评审 Toast。

**评审 Toast**

- `App.vue` 在 `useReviewComments` 的 `onNewComment` 中触发：
  ```ts
  if (comment.authorRole !== 'visitor') return
  reviewToast.value = `${comment.authorName} 新增了评论`
  ```
- 3.6 秒后自动消失；点击打开评审 Tab 并标记已读。
- 即使评审面板已经打开，也仍会显示 Toast；`isPanelOpen` 只影响未读数，不影响 Toast。
- 文本统一写「新增了评论」，回复事件也会显示成「新增了评论」。
- 与全局 Toast 是两个独立状态，可以同时出现：一个在底部，一个在右上角。
- 评审 Tab 和顶栏有未读徽标，画布有评论引脚。

**未读与状态**

- `ReviewPanel` 的「我的」筛选、未解决数量、`rp-new` 标记。
- `AppTopBar` 的评论未读徽标、分享实时/查看人数。
- 没有声音，也没有浏览器通知。

### 2.2 分享页

**分享页 Toast**

`ShareApp.vue` 的 `showToast()` 是单槽位，3.2 秒，覆盖范围包括：

- 登录成功 / 退出 / 登录过期
- 复制链接
- 选择评论位置
- 评论发送 / 回复发送 / 删除
- 分享版本更新
- 作者评论更新

它是「操作反馈」和「消息通知」的混合通道。新消息会覆盖上一条操作反馈，反之亦然。

**新评论通知缺口**

`handleStreamEvent` 里：

```ts
if (event.type === 'comment.created') {
  comments.value = mergeComment(comments.value, event.comment)
  if (event.comment.authorRole === 'owner') {
    showToast(`${event.comment.authorName} 更新了评论`)
  }
  return
}
```

因此：

- 作者回复：有 Toast（但文案只有「更新了评论」，没有说明是回复）。
- **其他访客的新评论 / 回复：没有 Toast。**
- `comment.updated`（解决 / 取消解决）：没有 Toast，只更新卡片。
- `comment.deleted`：静默移除。
- 没有未读数；移动端评论抽屉关闭时，评论 FAB 没有红点 / 计数。
- 没有按 `user_id` 过滤自己的 SSE 回声；目前靠「自己的发送响应只提示一次」规避，但不可靠。
- 登录弹窗、评论面板和 Toast 的层级相互独立：分享 Toast `z-index: 9`，登录弹窗 `120`，移动端评论面板 `40`。

**分享页错误**

- 链接加载失败 / 撤销：全屏 `.share-error`，只有「返回编辑器」，没有重试。
- 登录 / 注册错误：`ShareLoginDialog` 内联 `.sl-error`。
- 评论操作失败：`showToast`。
- 发布 / 更新 / 冻结 / 撤销失败：`App.shareError`，只有分享弹窗内可见；如果弹窗关闭，错误不可见。

### 2.3 多人漫游

**Toast**

- 2.2 秒顶部居中，单槽位。
- 触发包括：玩家加入 / 退出、房主权限提示、全屏失败、玩家名称为空、复制邀请链接等。
- 没有队列 / 无障碍播报。

**大厅持久提示**

- `error` / `status` 在 `.mp-alert-stack` 内展示，`role="status"`、`aria-live="polite"`。
- 房间卡片里又重复渲染一次 `.mp-message`，没有 `role`，可能造成屏幕阅读器重复播报或遗漏。

**聊天**

- 入口：游戏内「消息」按钮，打开底部输入层。
- 传输：WebSocket `{ type: 'message', text }`。
- 服务端 `sanitizeChatText`：去控制字符、trim、最多 200 字。
- 广播给房间所有人，**包括发送者自己**；客户端没有区分自己的消息。
- 客户端只保留最近 5 条，8 秒后淡出，不持久化、无未读、无历史。
- 系统事件（击退、拖拽开始/结束）复用同一个 `message` 类型，`nickname: '系统'`，和聊天混在一起。
- 没有 `role="log"`，没有消息到达提示音，也没有消息按钮未读徽标。

**房间生命周期**

- 房主退出 / 被踢 / 连接断开：`hostLeft` 弹窗 + 自动返回大厅，没有走 Toast。
- 加入 / 创建失败：大厅内联错误；断线超时也会写 `error`。

### 2.4 对话框与表单

| 位置 | 错误方式 | 成功方式 | 备注 |
| --- | --- | --- | --- |
| 分享发布弹窗 `ShareDialog` | `.sd-error` 内联 | 父级 `toast` | 未登录、无场馆、接口错误都在弹窗内；关闭弹窗后错误消失 |
| 云端存储 `CloudStorageDialog` | `.cs-error` 内联 | `emit('notify')` → 编辑器 Toast | 登录 / 注册成功走 Toast，失败留在弹窗 |
| 分享登录 `ShareLoginDialog` | `.sl-error` 内联 | 父级 Toast「已登录」 | 错误不会冒泡到分享页 Toast |
| 天气面板 `WeatherPanel` | `.wp-error` 内联 | 无 | 查询失败只在面板内可见 |
| 导出弹窗 `ExportDialog` | 无本地错误 | 父级 Toast | 生成失败在父级捕获 |
| 属性面板 `Inspector` | 文件校验 `logo-error` / `material-error` → 父级 Toast | 无 | 图片格式 / 大小错误走全局 Toast |
| 评审查阅 `ReviewPanel` | 只读文案 / 登录门槛 / 空态 | 父级 Toast | 操作失败由分享页 / 编辑器父级提示 |
| 状态栏 `StatusBar` | `saveState` / `cloudHint` | `saved` 文本 | 自动保存失败不弹 Toast，只变红 |
| 启动遮罩 | `boot-mask` | 自动消失 | 有 `role="status"` |

### 2.5 状态、空态与加载

- 编辑器：启动遮罩、欢迎页、`SceneTree` / `Inspector` 空态、状态栏。
- 分享页：加载遮罩、链接错误全屏、评论空态、登录门槛、评论只读。
- 多人：大厅连接中、自动加入中、房间关闭弹窗、横屏 / 全屏提示。
- 这些状态大多是持久的，不应该塞进 Toast；它们和 Toast 的边界目前是清楚的。

---

## 3. 事件矩阵

| 事件 | 编辑器当前 | 分享页当前 | 多人当前 | 建议 |
| --- | --- | --- | --- | --- |
| 新访客评论 | 评审 Toast + 未读 + 引脚 | **无通知** | — | 通知中心 + 未读；面板关闭/页面隐藏时 Toast；可选音效 |
| 新访客回复 | 评审 Toast（文案误写为「新增评论」） | **无通知** | — | 与评论区分文案；未读 |
| 作者回复 | — | Toast「更新了评论」 | — | 明确「作者回复」；未读 |
| 解决 / 取消解决 | 卡片更新 | 卡片更新 | — | 内联状态；不弹 Toast、不配音 |
| 删除评论 | 静默移除 | 静默移除 | — | 内联移除；作者操作可轻提示 |
| 自己的评论 / 操作 | 成功 Toast | 成功 Toast | 聊天流 | 不通知自己、不配音 |
| 作者编辑场景 | — | 「作者正在编辑」HUD | — | 保留 HUD，不发 Toast |
| 保存成功 / 失败 | 手动保存 Toast；自动保存状态栏 | — | — | 成功可轻 Toast；自动保存只走状态栏 |
| 表单校验 | 部分 Toast、部分内联 | 登录弹窗内联 | 大厅内联 | 表单上下文优先内联 |
| 实时同步失败 | `shareError`（仅弹窗打开时可见） | 重连状态 | — | 页面级 Banner / 状态 + 可重试 |
| 云端登录 / 注册 | 内联错误 + 成功 Toast | 内联错误 + 成功 Toast | — | 成功 Toast；失败内联 |
| 多人加入 / 退出 | — | — | Toast | Toast + 队列 |
| 聊天消息 | — | — | 最近 5 条聊天流 | 独立聊天流 + 未读 |
| 房间关闭 / 断线 | — | — | 弹窗 + 状态 | 保持弹窗；不降级为 Toast |
| 链接撤销 / 加载失败 | — | 全屏错误 | — | 全屏错误 + 重试 |

---

## 4. 主要问题

### P0：会影响功能或漏消息

1. **分享页其他访客评论没有任何通知**
   - `comment.created` 只处理 owner。
   - 没有未读数、没有移动端红点。
   - 这是「链接页面缺少消息通知」的直接原因。

2. **所有 Toast 都没有无障碍播报**
   - 没有 `role="status"`、`aria-live`、`aria-atomic`。
   - 屏幕阅读器用户无法得知保存、发布、评论失败等反馈。
   - 多人大厅的 `mp-alert-stack` 是唯一做得比较完整的持久提示。

3. **实时同步错误可能完全不可见**
   - `useLiveShare` 的 `onError` 只写 `App.shareError`。
   - `shareError` 仅在 `ShareDialog` 内渲染；弹窗关闭时，实时推送失败没有页面级提示。

### P1：一致性与体验问题

4. **四套 Toast 各自为政**
   - 时长 2.2 / 2.8 / 3.2 / 3.6 秒
   - 位置底部居中 / 右上 / 左上 / 顶部居中
   - 样式、动画、z-index 都不同
   - 没有共享组件或消息类型

5. **编辑器有两套 Toast 可同时出现**
   - 全局 Toast 在底部，评审 Toast 在右上。
   - 连续评论只保留最后一条文字，前一条会被覆盖。
   - 评审面板打开时仍然弹评审 Toast，干扰输入。

6. **分享页单槽位 Toast 把「操作反馈」和「消息通知」混在一起**
   - 「评论已发送」会覆盖刚到的「作者回复」。
   - 没有队列、去重、优先级。

7. **多人聊天缺少未读与持久性**
   - 最近 5 条、8 秒消失；切到其他 UI 或看漏就丢失。
   - 自己的消息、系统提示、他人消息没有视觉区分。
   - 没有未读徽标、没有 `role="log"`。

8. **内联错误和 Toast 的边界不统一**
   - 同样是网络失败：分享弹窗内联、编辑器 Toast、自动保存状态栏、云端弹窗内联。
   - 用户需要知道「这次失败该看哪里」。

### P2：打磨与可维护性

9. **没有音效 / 系统通知**
   - 所有评论消息都是静默的；切到其他标签页后完全不知道有新消息。

10. **没有消息目录和严重级别**
    - 文案散落在组件和 composable 中。
    - 成功、警告、错误共用中性 Toast 样式。

11. **部分错误只写控制台**
    - 本地自动保存恢复失败 `console.warn`。
    - `shareError` 关闭弹窗后不可见。
    - 用户可能认为「没有发生任何事」。

12. **演示模式抑制不一致**
    - `.app.presenting .toast` 被隐藏。
    - `.review-toast` 没有被同一个规则隐藏，演示时仍可能出现。

13. **Toast 无暂停 / 关闭 / 重试**
    - 只有评审 Toast 有「查看」。
    - 所有其他 Toast 都不能手动关闭或重试。

---

## 5. 建议的统一消息架构

### 5.1 分层

```text
MessageCenter
├── ToastHost            短暂、可排队、可操作
├── NotificationCenter   评论 / 未读 / 需回看的事件
├── InlineError          表单与对话框校验
├── Banner               页面级错误、链接不可用、实时同步失败
├── StatusBar            保存 / 连接 / 云端就绪
└── ChatFeed             多人房间聊天（独立通道）
```

### 5.2 消息模型

建议统一成类似：

```ts
type MessageSeverity = 'success' | 'info' | 'warning' | 'error'

interface AppMessage {
  id: string
  scope: 'editor' | 'share' | 'multiplayer'
  channel: 'toast' | 'notification' | 'banner' | 'chat'
  severity: MessageSeverity
  title?: string
  text: string
  action?: { label: string; run: () => void }
  duration?: number
  dedupeKey?: string
  persist?: boolean
}
```

### 5.3 ToastHost 规范

- 队列最多 3 条，超出排队；相同 `dedupeKey` 合并。
- 默认时长按严重级别：success 2.4s / info 3s / warning 4s / error 5s 或不自动消失。
- 支持手动关闭、悬停暂停、焦点进入暂停。
- `role="status"` + `aria-live="polite"`；错误使用 `role="alert"`。
- 移动端底部避开评论抽屉 / 输入框；分享页和编辑器各自挂载同一个组件。
- 成功 / 信息 / 警告 / 错误有不同图标与颜色，但不改变整体深色风格。

### 5.4 事件路由建议

| 事件 | 路由 |
| --- | --- |
| 保存、复制、导出、设置成功 | Toast（success） |
| 表单校验、验证码错误 | 表单内联，不上 Toast |
| 网络失败但可重试 | Toast / Banner + 重试动作 |
| 链接撤销、项目无场馆、服务不可用 | 页面级 Banner 或全屏错误 |
| 新评论 / 回复 | NotificationCenter + 未读徽标；面板关闭或页面隐藏时 Toast |
| 解决 / 删除 | 内联状态；不弹 Toast |
| 聊天 | ChatFeed；不进入 Toast |
| 房间关闭 / 断线 | 持久弹窗，不降级为 Toast |

### 5.5 分享页通知补齐

建议在分享页单独补：

- 新评论 / 回复：`comment.created` 中过滤 `authorUserId === currentUser.id`，其他人的消息进入通知。
- 未读数：评论 dock / 移动端评论 FAB 显示计数；打开面板后清零。
- Toast：
  - 面板关闭或页面隐藏时弹「王工 评论了 W1A03」。
  - 面板打开时只插入卡片 + `新` 标记，不弹打断式 Toast。
  - 作者回复单独文案「作者回复了你」。
- 解决 / 取消解决：只更新卡片，不弹 Toast、不配音。
- 自己的操作：成功 Toast 仍可保留，但不进入未读。

> 当前 `ShareComment` 只有 `mine`，没有稳定的 `authorUserId`。建议 API 增加 `authorUserId`（或 `authorId`），用于前端过滤自己的 SSE 回声，而不是比较用户名。

### 5.6 多人聊天

- 聊天保持独立，不接 Toast。
- 输入框旁 / 消息按钮增加未读徽标；打开面板后清零。
- 自己的消息右对齐或标记「我」；系统消息单独样式。
- 聊天流使用 `role="log"` + `aria-live="polite"`。
- 服务端可加简单限流，避免刷屏。

---

## 6. 音效接入建议

音效应接在 **MessageCenter 的事件层**，而不是每个 Toast 组件里：

- 只对「其他访客新评论 / 新回复 / 作者回复」播放。
- 自己的操作、保存成功、表单校验、解决 / 删除不配音。
- 默认首次用户交互后解锁（浏览器自动播放限制）；顶栏提供持久化静音开关。
- 采用 S2 / S7 的玻璃与风铃家族：
  - 编辑器：S9 纯五度玻璃（更暖）或 S12 水晶单音（更轻）
  - 分享页：S2 玻璃双音（直接）或 S7 三音风铃（更明确）
- 连续消息合并，最多每 2.5 秒一次。
- 页面隐藏 / 面板关闭时才响；面板打开时只做视觉未读。

---

## 7. 实施顺序

1. **P0**：抽出 `ToastHost` / `useMessages`，补 `aria-live`、队列、去重、暂停和关闭；先迁移编辑器全局 Toast。
2. **P0**：分享页补 `comment.created` 通知、未读徽标、移动端 FAB 计数，按 `authorUserId` 过滤自己。
3. **P0**：把 `useLiveShare` 的错误接到页面级 Banner / 状态，不再只依赖 `shareError`。
4. **P1**：将评审 Toast 并入统一队列；面板打开时只更新未读，不弹 Toast；文案区分评论 / 回复。
5. **P1**：多人聊天补未读、自己消息标识、`role="log"`；系统提示与聊天分开。
6. **P2**：接入音效与静音开关；补消息目录、严重级别和测试。

---

## 附录：代码位置

| 内容 | 位置 |
| --- | --- |
| 编辑器全局 Toast | `src/composables/useEditorState.ts` `toast()`；`src/App.vue` |
| 编辑器评审 Toast | `src/App.vue` `reviewToast`；`src/review/review.css` `.review-toast` |
| 分享页 Toast | `src/share/ShareApp.vue` `showToast()`；`src/share/share.css` `.share-toast` |
| 分享页评论事件 | `src/share/ShareApp.vue` `handleStreamEvent` 的 `comment.created` |
| 多人 Toast | `src/multiplayer/MultiplayerApp.vue` `toast()` |
| 多人大厅持久提示 | `src/multiplayer/MultiplayerApp.vue` `error` / `status`；`.mp-alert-stack` |
| 多人聊天 | `src/multiplayer/MultiplayerApp.vue` `sendChatMessage()` / `pushChat()`；`dataService/src/multiplayer/index.mjs` `sendChatMessage()` |
| 分享弹窗错误 | `src/review/ShareDialog.vue` `.sd-error` |
| 云端弹窗错误 | `src/components/CloudStorageDialog.vue` `.cs-error` |
| 分享登录错误 | `src/share/ShareLoginDialog.vue` `.sl-error` |
| 天气错误 | `src/components/WeatherPanel.vue` `.wp-error` |
| 状态栏 | `src/components/StatusBar.vue` |
| 实时同步错误 | `src/review/useLiveShare.ts` `onError` → `App.shareError` |
| 分享页全屏错误 | `src/share/ShareApp.vue` `.share-error` |
| 启动遮罩 | `src/App.vue` `.boot-mask` |
