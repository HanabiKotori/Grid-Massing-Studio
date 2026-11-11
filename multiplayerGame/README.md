# Grid Massing Studio · 多人漫游服务

纯 Node.js WebSocket 房间服务，为 `multiplayer.html` 提供：

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

- 页面必须与 WebSocket 同为 HTTPS / WSS，否则浏览器会拦截混合内容。
- 宝塔面板和阿里云安全组都需放行 `443`。
- 使用 PM2 守护：`pm2 start server.mjs --name grid-multiplayer && pm2 save`。
- 如使用 `X-Forwarded-For`，服务端会把第一项作为玩家 IP 昵称。

## 行为说明

- 房主创建房间时发送当前 IndexedDB 场景，服务端仅保存在内存中。
- 客人加入时收到完整场景；房间开始后加入的客人也会直接进入。
- 大厅通过 `list` 获取在线房间摘要（房间号、在线人数、上限、是否开始）。
- 天气由房主设置，包含天气类型、天气开关、粒子浓度和能见度；客人只读同步。
- 时间由房主控制，拖动、重置、暂停 / 播放及自动推进进度会同步给客人。
- 房间消息最多 200 字符，PC 按 Y 打开输入，移动端使用操作栏「消息」按钮；消息只在当前房间内实时展示，不持久化。
- 房间满员会返回 `join-error full`，前端留在加入页展示错误。
- 房主主动退出或连接断开时，房间立即删除；所有客人收到 `room-closed`，前端提示后返回默认页面。
- 客人退出只移除该玩家，房主继续房间。
- 昵称暂时使用连接 IP，不做账号体系。
- 房间、玩家、场景均不落盘；服务重启即全部清空。

## 协议概要

客户端发送：

- `create`：人数、场景、天气、天气开关、粒子浓度、能见度、太阳进度；
- `join`：房间号；
- `list`：获取在线房间；
- `start`：仅房主；
- `state`：10 Hz 的 `x / z / y / yaw / pitch / view / auto`；
- `gate`：出入口 id + open；
- `weather`：仅房主，包含天气与天气效果设置；
- `time`：仅房主，同步时间进度与播放 / 暂停状态；
- `message`：发送房间消息，文本最多 200 字符；
- `leave`。

服务端发送：

- `created` / `joined` / `room` / `started`；
- `room-list`：大厅在线房间；
- `player-joined` / `player-left`；
- `gate` / `weather` / `time` / `message` / `room-closed`；
- `join-error` / `create-error` / `error`。

## 限制

- 没有账号、权限、持久化、反作弊和重连恢复。
- 场景只在房主设备上生成，服务端只做转发和内存缓存。
- 人数较多时广播带宽随人数线性增长；建议 2–8 人。
- 移动端浏览器进入后台后 WebSocket 可能被系统挂起，回到前台会自动继续接收。
