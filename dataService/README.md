# Grid Massing Studio 云存储服务（dataService）

为前端提供账号注册 / 登录、滑块验证码与多版本场景存储。前端通过 `.env` 中的
`VITE_CLOUD_STORAGE_ENABLED` 决定使用云端还是浏览器 IndexedDB。

## 功能

- 用户名 + 密码注册 / 登录（scrypt 加盐哈希，JWT 有效期 7 天）；
- 随机 SVG 图片滑块验证码（缺口坐标只保存在服务端，5 分钟过期、最多 4 次尝试）；
- 每个账号固定 10 个存储位置（slot 1-10），每个位置保存一份场景快照；
- 登录状态下自动保存写入所选位置，支持手动保存 / 加载 / 删除；
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
2. 连接目标数据库，按 `schema.sql` 创建 `users` 与 `storage_slots` 表。

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
| DELETE | `/api/storage/:slot` | 删除指定位置 |

`slot` 取值为 1-10，每个用户独立。

## 前端配置

项目根目录 `.env.local`（或 `.env`）：

```bash
# 开启云端存储；关闭时沿用浏览器 IndexedDB
VITE_CLOUD_STORAGE_ENABLED=true
VITE_DATA_SERVICE_URL=http://127.0.0.1:3020
```

生产环境建议通过 Nginx 将 `/api` 反向代理到 dataService，并把
`VITE_DATA_SERVICE_URL` 配置为同域地址，同时在 `ALLOWED_ORIGINS` 中填写站点域名。

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
