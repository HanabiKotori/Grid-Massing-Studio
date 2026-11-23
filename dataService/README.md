# Grid Massing Studio 云存储服务（dataService）

为前端提供账号注册 / 登录、滑块验证码与多版本场景存储。前端通过 `.env` 中的
`VITE_CLOUD_STORAGE_ENABLED` 决定使用云端还是浏览器 IndexedDB。

## 功能

- 用户名 + 密码注册 / 登录（scrypt 加盐哈希，JWT 有效期 7 天）；
- 随机 SVG 图片滑块验证码（缺口坐标只保存在服务端，5 分钟过期、最多 4 次尝试）；
- 每个账号固定 10 个存储位置（slot 1-10），每个位置保存一份场景快照；
- 登录状态下自动保存写入所选位置，支持手动保存 / 加载 / 删除；
- 分享链接：绑定云端存档实例，一个存档一条链接，实时 / 冻结快照、公开查看、登录评论；删除存档会级联删除链接；
- 实时通道：SSE 广播场景增量补丁、评论新增 / 状态变更 / 解决日志 / 状态讨论 / 删除；
- MySQL 表结构在启动时自动创建（`schema.sql` 也可手动执行）。

## 快速开始

```bash
cd dataService
npm install
cp .env.example .env
# 修改 .env 中的数据库账号、JWT_SECRET 与允许来源
npm start
```

默认监听 `0.0.0.0:3020`，健康检查：

```bash
curl http://127.0.0.1:3020/api/health
# {"ok":true,"database":true,"slotsPerUser":10,"maxSceneMb":40}
```

`database` 为 `false` 时账号与存储接口会返回 503，需先修正 MySQL 配置。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3020` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | MySQL 地址 |
| `DB_USER` / `DB_PASSWORD` | 空 | MySQL 账号 |
| `DB_NAME` | `grid-massing-data` | 数据库名（账号已有该库权限时直接使用） |
| `DB_POOL` | `10` | 连接池大小 |
| `JWT_SECRET` | 临时随机 | 登录令牌密钥，生产必须固定配置 |
| `JWT_EXPIRES` | `7d` | 令牌有效期 |
| `MAX_SCENE_MB` | `40` | 单个场景 JSON 上限 |
| `ALLOWED_ORIGINS` | 空 | 允许的前端来源，逗号分隔；留空允许所有来源 |

## MySQL 说明

服务启动时会：

1. 使用配置的账号连接 MySQL，执行 `CREATE DATABASE IF NOT EXISTS`；
2. 连接目标数据库，按 `schema.sql` 创建 `users`、`storage_slots`、`share_links`、`share_comments` 表。

如果该账号没有建库权限，请先在 MySQL 中手动建库并授权，再执行 `schema.sql`：

```sql
CREATE DATABASE `grid-massing-data` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `grid-massing-data`;
SOURCE schema.sql;
```

数据库端口必须对运行 dataService 的机器开放（云服务器安全组 / 防火墙）。
若 MySQL 只监听内网，建议把 dataService 部署到同一台服务器上运行。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（含数据库状态） |
| GET | `/api/captcha` | 获取滑块验证码（背景图、拼图块、token） |
| POST | `/api/auth/register` | 注册：`username`、`password`、`captchaToken`、`captchaX` |
| POST | `/api/auth/login` | 登录，参数同上 |
| GET | `/api/auth/me` | 当前用户，需要 `Authorization: Bearer <token>` |
| GET | `/api/storage` | 存储位置列表（最多 10 条） |
| GET | `/api/storage/:slot` | 读取指定位置的完整场景 |
| PUT | `/api/storage/:slot` | 保存 / 覆盖：`{ name, scene }` |
| DELETE | `/api/storage/:slot` | 删除指定位置；该存档的分享链接级联删除 |
| GET | `/api/storage/:slot/share` | 获取该存档的独立链接 |
| PUT | `/api/storage/:slot/share` | 创建 / 更新该存档链接；已有映射时 token 不变 |
| DELETE | `/api/shares/:token` | 删除链接；重新分享生成新 token |

`slot` 取值为 1-10，每个用户独立。

## 分享与实时评审接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/shares` | 登录 | 发布实时链接：`{ title, scene, projectKey, liveMode, allowComment, allowDownload }` |
| GET | `/api/shares?storageSlot=` | 登录 | 当前用户的链接列表；可按存档槽位筛选 |
| GET | `/api/shares/:token` | 公开 | 链接元信息（不含场景） |
| GET | `/api/shares/:token/scene` | 公开 | 场景快照 + 当前 revision |
| PATCH | `/api/shares/:token` | owner | 改标题 / 权限；带 `scene` 时更新快照 |
| DELETE | `/api/shares/:token` | owner | 撤销链接并关闭 SSE |
| PATCH | `/api/shares/:token/live` | owner | 实时增量补丁：`{ baseRevision, patch }` |
| GET | `/api/shares/:token/live?since=` | 公开 | 断线追平：同 revision 返回空，否则返回完整场景 |
| GET | `/api/shares/:token/comments` | 公开 | 评论列表；带 JWT 时返回当前账号的 `mine` |
| POST | `/api/shares/:token/comments` | 登录 | 新建 / 回复；作者从 JWT 取，匿名评论已移除 |
| PATCH / DELETE | `/api/shares/:token/comments/:id` | 登录（owner 或作者） | 编辑、解决 / 取消解决、删除；历史匿名评论仅 owner 可删除 |
| POST | `/api/shares/:token/comments/:id/events/:eventId/replies` | 登录 | 回复某条解决 / 取消解决日志 |
| DELETE | `/api/shares/:token/comments/:id/events/:eventId/replies/:replyId` | 登录（owner 或回复作者） | 删除状态讨论回复 |
| GET | `/api/review/comments?projectKey=` | 登录 | 编辑器按项目聚合评论 |
| POST | `/api/shares/:token/stream-ticket` | 公开 | 分享页 SSE 短时 ticket（60 秒） |
| GET | `/api/shares/:token/stream` | ticket | 分享页 SSE：场景补丁、评论、在线人数 |
| POST | `/api/review/stream-ticket` | 登录 | 编辑器项目流 ticket；需该项目下存在自己的有效链接 |
| GET | `/api/review/stream` | ticket | 编辑器 SSE：项目内评论新增 / 更新 / 删除 |

评论写入统一要求 `Authorization: Bearer <token>`；历史匿名评论（`author_user_id` 为空、仅有 `author_token`）保留只读，不能回复或解决，仅链接 owner 可删除。查看分享页与评论列表仍然公开。

解决 / 取消解决会写入 `share_comment_events`，状态日志下的讨论写入
`share_comment_event_replies`；两张表随评论级联删除。事件回复作者或链接 owner
可删除回复，删除前由前端二次确认。

SSE 连接保存在进程内存中，建议单实例运行；多实例需要 Redis pub/sub。Nginx 需要关闭响应缓冲：

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:3020;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_buffering off;
  proxy_read_timeout 3600s;
}
```

## 前端配置

项目根目录 `.env.local`（或 `.env`）：

```bash
# 开启云端存储；关闭时沿用浏览器 IndexedDB
VITE_CLOUD_STORAGE_ENABLED=true
```

前端统一请求同源 `/api`：本地由 `vite.config.ts` 的 `server.proxy` 转发到
`http://127.0.0.1:3020`；生产由 Nginx 将 `/api/` 反向代理到 dataService。
不需要设置 `VITE_DATA_SERVICE_URL`。生产环境如需允许跨域直连，再在
`ALLOWED_ORIGINS` 中填写站点域名。

## 部署示例（Nginx）

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:3020;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  client_max_body_size 50m;
}
```

使用 PM2 常驻：

```bash
pm2 start server.mjs --name grid-massing-data
pm2 save
```

## 一键部署（build 部署脚本）

项目根目录 `build/` 下提供 `deploy-data.mjs`，通过 SSH 上传 `dataService`（含 `.env`、`src/`、`schema.sql`）到服务器，自动安装依赖并用 PM2 启动：

```bash
cd build
npm install        # 首次需要安装 ssh2
npm run deploy:data
```

默认部署到 `/www/wwwroot/数据`，配置见 `build/deploy.config.example.json` 的 `data` 段：

| 字段 | 说明 |
| --- | --- |
| `remotePath` | 服务器目录，默认 `/www/wwwroot/数据` |
| `localDir` | 本地目录，默认 `dataService` |
| `include` | 上传的文件与目录，默认含 `server.mjs`、`schema.sql`、`package.json`、`package-lock.json`、`src` |
| `uploadEnv` | 是否上传 `.env`（默认 `true`，包含数据库密码） |
| `pm2Name` | PM2 进程名，默认 `grid-massing-data` |
| `healthUrl` | 部署后的健康检查地址 |

试运行（只列出待上传文件，不连接服务器）：

```bash
npm run deploy:data -- --dry-run
```

强制重启或仅更新文件不重启：

```bash
npm run deploy:data -- --restart
```

## 安全建议

- 生产环境必须配置固定的 `JWT_SECRET`，不要使用默认临时密钥；
- 限制 `ALLOWED_ORIGINS` 为实际站点域名；
- 不要把 `.env`（含数据库密码）提交到仓库；
- 建议通过 HTTPS 访问，避免令牌被截获。
