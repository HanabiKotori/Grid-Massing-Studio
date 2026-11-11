# Grid Massing Studio · 多人漫游服务

纯 Node.js WebSocket 房间服务，为 `/#/multiplayer` 路由提供：

- 房间创建 / 加入 / 满员校验；
- 房主场景只保存在服务内存，不做持久化；
- 玩家位置、朝向、视角、自动巡游状态同步；
- 出入口开关、天气同步；
- 10 Hz 房间快照；
- 房主退出自动解散房间，并通知所有客人。

## 运行

```bash
cd multiplayerGame
npm install
cp .env.example .env
npm start
```

开发时可用：

```bash
npm run dev
```

默认监听 `0.0.0.0:3010`，健康检查：

```bash
curl http://127.0.0.1:3010/health
```

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3010` | WebSocket 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `MAX_ROOM_SIZE` | `8` | 房间人数上限，房主可在 2 到该值之间选择 |
| `TICK_HZ` | `10` | 房间快照广播频率 |
| `MAX_SCENE_MB` | `40` | 单条 WebSocket 消息上限，场景含 Logo / 底图时需调大 |
| `ALLOWED_ORIGINS` | 空 | 允许的页面来源，逗号分隔；留空不校验 |

服务端只读取 `multiplayerGame/.env`，与启动目录无关。

## 前端配置

项目根目录 `.env`：

```bash
VITE_MULTIPLAYER_WS_URL=ws://localhost:3010
```

生产环境使用 HTTPS 时必须改为 `wss://`：

```bash
VITE_MULTIPLAYER_WS_URL=wss://your-domain.com/ws
```

前端默认回退到 `ws(s)://<当前域名>:3010`。

## 宝塔 / Nginx 部署

Node 服务监听本机 `3010`，Nginx 负责静态页面并将 `/ws` 反向代理到 Node：

```nginx
location /ws {
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
}
```

多人页面的正式地址是 `/#/multiplayer`，邀请链接为 `/#/multiplayer?room=房间号`；hash 路由不需要 Nginx 回退。旧的 `/multiplayer` 路径和 `/multiplayer.html` 已不再使用。

- 页面必须与 WebSocket 同为 HTTPS / WSS，否则浏览器会拦截混合内容。
- 宝塔面板和阿里云安全组都需放行 `443`。
- 使用 PM2 守护：`pm2 start server.mjs --name grid-multiplayer && pm2 save`。
- 如使用 `X-Forwarded-For`，服务端会把第一项作为玩家 IP 昵称。

## 行为说明

- 房主创建房间时发送当前 IndexedDB 场景，服务端仅保存在内存中。
- 客人加入时收到完整场景，但会停留在房间页；房主开始漫游后，客人点击「开始漫游」才创建 Stage 进入。房间已开始时再加入的客人也先停在房间页。
- 大厅通过 `list` 获取在线房间摘要（房间号、房间人数、上限、是否开始）以及当前连接多人页面的在线玩家总数。
- 天气由房主设置，包含天气类型、天气开关、粒子浓度和能见度；客人只读同步。
- 时间由房主控制，拖动、重置、暂停 / 播放及自动推进进度会同步给客人。
- 房间消息最多 200 字符，PC 按 Y 打开输入，移动端使用操作栏「消息」按钮；消息只在当前房间内实时展示，不持久化。
- 房间内每个玩家可修改自己的名称和模型颜色，服务端广播给房间内所有人；漫游中按住 Tab 可查看玩家列表。
- PC 端在 1m 内对准其他玩家时：左键击退对方，目标后退一小段并触发镜头晃动；按住右键拖动可拖拽对方，拖拽期间目标移动被锁定。互动位置通过服务端同步，操作者与目标都会收到互动消息；击退、开始拖拽和结束拖拽同时以系统消息广播到房间消息流。
- 服务端为玩家分配默认颜色，名称默认使用连接 IP，不做账号体系。
- 房间满员会返回 `join-error full`，前端留在加入页展示错误。
- 玩家点击「退出房间」时，前端发送 `leave` 并回到多人创建大厅，同时移除 URL 中的房间号；返回按钮仍可回到设计页。
- 玩家朝向在客户端上报和服务端校验时都归一化到 `[-π, π]`，避免 PC 长时间自由旋转后远端角色模型停转。
- 移动端仅支持横屏漫游；进入漫游会尝试全屏并锁定横屏，检测到竖屏会暂停并退出漫游状态，横屏后点击「继续漫游」。客人收到房主的开始消息时可能没有用户手势，自动全屏被浏览器拦截后会显示横屏 / 全屏提示，可点击手动重试；不支持全屏 API 时提示横屏继续。
- 房主主动退出或连接断开时，房间立即删除；所有客人收到 `room-closed` 后清理 Stage、解除旧房间绑定并回到多人大厅，可立即再次创建或加入房间。真正的 WebSocket 断开仍返回设计页。
- 客人退出只移除该玩家，房主继续房间；同一 WebSocket 连接可继续用于大厅房间列表或再次创建 / 加入房间。
- 房间、玩家、场景均不落盘；服务重启即全部清空。

## 协议概要

客户端发送：

- `create`：人数、场景、天气、天气开关、粒子浓度、能见度、太阳进度；
- `join`：房间号；
- `list`：获取在线房间；
- `start`：仅房主；
- `state`：10 Hz 的 `x / z / y / yaw / pitch / view / auto`；
- `profile`：修改自己的名称和颜色；
- `interact`：左键击退或右键拖拽其他玩家，包含动作、目标与目标坐标；
- `gate`：出入口 id + open；
- `weather`：仅房主，包含天气与天气效果设置；
- `time`：仅房主，同步时间进度与播放 / 暂停状态；
- `message`：发送房间消息，文本最多 200 字符；
- `leave`。

服务端发送：

- `created` / `joined` / `room` / `started`；
- `room-list`：大厅在线房间与在线玩家总数；
- `player-joined` / `player-updated` / `player-left`；
- `interaction`：广播击退 / 拖拽开始、移动与结束事件；
- `gate` / `weather` / `time` / `message` / `room-closed`；
- `join-error` / `create-error` / `error`。

## 限制

- 没有账号、权限、持久化、反作弊和重连恢复。
- 场景只在房主设备上生成，服务端只做转发和内存缓存。
- 人数较多时广播带宽随人数线性增长；建议 2–8 人。
- 移动端浏览器进入后台后 WebSocket 可能被系统挂起，回到前台会自动继续接收。
