# 多用户鉴权设计（提案）

> 状态：**已实现（2026-11-22，M5）**。本文最初作为设计提案，先于代码落地，
> 符合 `AGENTS.md` §0.4“涉及架构/安全的决策先提问”；§16 的三项决策确认后，
> 已按 §14 的顺序完成 M5.0–M5.7。实现落点与验收证据见 §18。
>
> 关联：`AGENTS.md` §1（非目标）、§2（威胁模型）、§3（安全底线）、§7（非功能需求）、
> §8（里程碑）、`README.md`（部署与 API 说明）。

## 1. 结论先行

推荐一套**适合单机、≤10 人、无外部 IdP**的最小完整方案：

| 维度 | 选择 |
|---|---|
| 账号来源 | 本地账号；管理员通过 CLI 创建，默认**不开放注册** |
| 密码存储 | Node 内置 `crypto.scrypt`（N=32768, r=8, p=1），不引入原生依赖 |
| 会话 | 服务端会话表 + 32 字节随机 token，存 SHA-256；HttpOnly Cookie |
| Cookie | `cpplab_session`，`HttpOnly; SameSite=Strict; Path=/`，HTTPS 下加 `Secure` |
| CSRF | SameSite=Strict + 所有非 GET `/api` 校验 `Origin`；WebSocket 同样校验 |
| 数据隔离 | 每个用户一个个人项目；`projects.owner_id` 为唯一归属依据 |
| 授权 | 所有项目/运行/调试资源按 owner 查询；跨用户一律 404 |
| 配额 | 保留全局信号量，新增**按用户**的并发槽与限流，防单账号独占 |
| 管理 | 首期 CLI 管理用户；管理员 API/UI 可后置 |
| 传输 | 本机回环或 HTTPS 反代；局域网明文 HTTP 仅限受信内网，并明确告警 |

核心原则：**登录只是入口，授权才是主体**。项目现在的 `projects.owner` 列已经存在但完全没被使用，
所有查询都硬编码到 `DEFAULT_PROJECT_ID = 'playground'`，所以必须先把数据层改成“按项目/按用户”，
否则登录页只会变成一个可以绕过的装饰。

## 2. 现状与风险

从代码里确认的事实：

1. **单项目全局态**：`src/server/db.ts` 中 `DEFAULT_PROJECT_ID = 'playground'`，
   `getProject()`、`getFiles()`、`getRuns()`、`recordRun()` 等全部不接收项目/用户参数；
   `projects.owner` 列从未被读写。
2. **所有 HTTP 接口无鉴权**：`src/server/main.ts` 的 `/api/project`、`/api/files`、
   `/api/run`、`/api/runs`、`/api/debug/*` 均可直接调用。`/api/health` 还暴露能力探测和调试会话列表。
3. **WebSocket 升级是独立入口**：Express 中间件不会作用于 `upgrade` 事件。当前只校验
   `Origin` 同源，然后直接用 URL 里的 `runId` / `sessionId` 附着会话；UUID 实际上被当作 bearer token。
4. **运行/调试会话没有 owner**：`RunSession`、`DebugSession` 都只持有 id；`attach` / `stop` 不校验归属。
5. **限流按 IP**：`RateLimiter` 以 `req.ip` 为 key，且 `trust proxy = false`；登录暴力破解需要独立的
   按 IP + 按用户名的限流，而不是复用运行限流。
6. **全局并发**：`compileSemaphore` / `runSemaphore` / debug 信号量都是进程级。多用户后一个用户
   可以用多个请求占满队列，造成其他用户饥饿。
7. **客户端无登录态**：`App.tsx` 启动即 `api.project()`；`localStorage` 的 `cpplab.*` 键是浏览器级，
   同一浏览器切换账号会串用 `stdin`、断点、Watch、当前文件等数据。
8. **调试会话列表只对 loopback 开放**：`isLoopback()` 是单用户时代的补偿措施；多用户后应改为
   “只返回当前用户自己的会话”，loopback 不再是授权依据。
9. **审计无上限**：`audit()` 使用 `appendFileSync`，登录失败若逐条写日志，可被用来填满磁盘。
10. **数据目录权限偏宽**：当前 `data/` 为 `755`、`data/cpplab.db` 为 `644`。加入密码哈希后应收紧为
    `data/ 700`、DB/WAL/SHM `600`。

## 3. 目标与非目标

**目标**

- 用户名 + 密码登录、登出、当前用户查询、修改密码。
- 管理员创建/禁用用户、重置密码；不开放匿名注册（默认）。
- 每个用户只能看到并操作自己的项目、文件、运行历史、调试会话。
- HTTP 与 WebSocket 两条路径都鉴权；跨用户访问返回 404。
- 按用户限流/并发配额；登录暴力破解防护。
- 现有单用户数据可迁移给首个管理员，不丢失历史。
- 不引入原生依赖；保持 `node:sqlite` + 单进程架构。

**非目标（本期不做）**

- 多用户实时协作、共享项目、团队/组织、RBAC 细粒度权限。
- OIDC/SAML/LDAP/Passkey；邮件找回密码。
- 多实例/水平扩展；分布式会话。
- 审计日志外送、SIEM 集成。
- 管理员的“查看他人源码”能力（默认不允许，避免越权）。

## 4. 威胁模型新增

在 `AGENTS.md` §2 的三类攻击之外，增加：

| 威胁 | 防御 |
|---|---|
| 凭据填充 / 暴力破解 | scrypt、统一错误、登录限流、失败退避、审计 |
| 会话窃取（XSS/日志/URL） | HttpOnly Cookie、不把 token 放 URL、日志脱敏、Secure |
| CSRF | SameSite=Strict + Origin 校验；WebSocket 也校验 Origin |
| IDOR / 越权 | 每个查询带 owner 条件；跨用户 404；WS 附着前校验 owner |
| 账号枚举 | 未知用户执行 dummy scrypt；统一 401；响应时间接近 |
| 单账号资源独占 | 按用户并发槽 + 按用户限流；全局上限仍保留 |
| 登录接口 DoS | 登录体 ≤8 KiB、限流先于哈希、哈希并发上限 |
| 审计日志洪水 | 登录失败限流、日志行长度上限、轮转/大小上限 |

不防御：宿主 root、内核 0-day、拿到 DB 文件的攻击者（但仍应收紧文件权限）。

## 5. 总体架构

```text
Browser
  ├─ GET /            -> SPA（公开）
  ├─ POST /api/auth/login（公开，独立限流 + 8KiB body）
  ├─ /api/*           -> attachAuth -> requireAuth -> requireSameOrigin -> json -> 业务
  └─ WS /ws/...       -> 手动解析 Cookie -> 校验会话 -> 校验资源 owner -> 附着
                         │
                         ▼
Node 单进程
  ├─ auth/            密码哈希、会话、登录限流、用户管理
  ├─ authz            项目/运行/调试资源的归属查询
  ├─ db.ts            改为显式接收 userId/projectId（去掉 DEFAULT_PROJECT_ID）
  ├─ runService       RunSession 增加 ownerId/projectId
  └─ debug/session    DebugSession 增加 ownerId；list 只返回自己的
```

请求处理顺序（关键）：

1. 安全响应头、locale。
2. `/api/health` 公开（只返回 `ok/serverTime/capabilities`，不再返回调试会话）。
3. `/api/auth/login`：独立限流 → 8 KiB JSON → 认证。
4. 其余 `/api/*`：`attachAuth`（只读 Cookie，不解析 body）→ `requireAuth`。
5. `requireSameOrigin`（非 GET）→ `express.json({ limit: 3 MiB })` → 路由。
6. 路由内部做 owner 校验；`must_change_password` 用户只允许访问 me/logout/password。

> 顺序很重要：当前 `express.json()` 在路由之前，若先解析 3 MiB body 再判断登录态，
> 未认证请求也能消耗解析 CPU/内存。鉴权必须放在 JSON body parser 之前。

## 6. 数据模型

### 6.1 新表

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires ON auth_sessions(expires_at);
```

- `username` 限制 `^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$`；`COLLATE NOCASE` 只对 ASCII 生效，
  因此不要允许中文/Unicode 用户名，避免大小写/归一化歧义。
- `password_hash` 存自描述格式：`scrypt$32768$8$1$<salt-b64>$<hash-b64>`，便于以后调参/升级。
- `auth_sessions.id` 用 UUID；`token_hash = SHA-256(token)`，DB 泄露也无法直接复用 token。

### 6.2 现有表

```sql
ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id);
```

- 现有 `projects.owner` 列可以保留不动或后续删除；新代码只认 `owner_id`。
- `runs` / `debug_sessions` 不新增 `user_id`，通过 `project_id -> projects.owner_id` 关联，
  避免冗余字段漂移；若后续需要审计快照，再加 `user_id`。
- `files` 已按 `project_id` 主键，不需要改。

### 6.3 一人一项目

当前 UI 没有项目切换器，**本期保持“一个用户一个个人项目”**，但 schema 不禁止多项目：

- 创建用户时同时创建 project 和默认 `main.cpp`（复用现有 `DEFAULT_SOURCE`）。
- `getProjectForUser(userId)`：`WHERE owner_id = ? ORDER BY created_at LIMIT 1`。
- 所有 DB 函数改为显式参数：

```ts
getProject(projectId)
getFiles(projectId)
upsertFile(projectId, path, content)
deleteFile(projectId, path)
replaceFiles(projectId, files, settings)
listRuns(projectId, limit)
getRun(projectId, runId)
recordRun({ projectId, ... })
```

- 服务层从 `req.user.id` 解析出 `projectId`，**不接受客户端传入的 projectId**；这样从源头消除
  “传别人的 projectId” 这一类 IDOR。

### 6.4 迁移

- 用 `PRAGMA user_version` 管理版本（当前为 0，目标 1）。
- 迁移前建议停服并备份；`data/` 被 gitignore，不能依赖 git 回滚。
- 步骤：
  1. 建 `users` / `auth_sessions`，`projects` 加 `owner_id`。
  2. 由 CLI 创建首个管理员，或读取一次性 bootstrap 环境变量。
  3. 把现有 `playground` 项目（以及它的 files/runs/debug_sessions）赋给该管理员。
  4. 若仍有 `owner_id IS NULL` 的 project：**拒绝启动 API**（health 可用），
     输出明确指令，绝不把遗留数据暴露给第一个登录者。
- 迁移后 `initDb` 检查并 `chmod`：`data/ 700`、DB/WAL/SHM `600`。

## 7. 密码与登录

### 7.1 哈希

- `crypto.scrypt`（Node 内置，无原生依赖），参数 N=32768, r=8, p=1, keylen=32,
  `maxmem=64 MiB`；每个密码独立 16 字节随机盐。
- 校验用 `timingSafeEqual`；解析 hash 字符串中的参数，参数升级后在下次登录成功时 rehash。
- 密码策略：长度 10–128，不做 trim（空格是密码的一部分），不强制字符类别（长度优先）。
- 登录时对未知用户名也执行一次固定 dummy hash，避免“用户不存在”的时序差异。
- scrypt 是 CPU/内存密集操作：登录限流必须在哈希之前；再限制并发哈希数（如 4），
  防止登录洪水打满 libuv 线程池拖垮整个服务。

### 7.2 登录流程

```text
POST /api/auth/login { username, password }
  -> 校验 Origin
  -> 登录限流（IP + username）
  -> 查 user（未知则 dummy hash）
  -> scrypt 校验
  -> 失败：统一 401 INVALID_CREDENTIALS + 审计（不记录密码）
  -> 成功：创建新 session（防 session fixation，绝不复用旧 token）
          Set-Cookie: cpplab_session=<token>; HttpOnly; SameSite=Strict; Path=/;
                      Max-Age=<absolute>; [Secure]
          返回 { user, mustChangePassword }
```

- 错误统一：用户名不存在、密码错误、账号禁用都返回同一文案；禁用账号可在正确密码后返回
  `ACCOUNT_DISABLED`，但这会泄露“密码正确”，本期建议一律统一。
- 限流：IP 10 次/分钟、用户名 5 次/分钟；连续失败做指数退避（1m → 5m → 15m），
  不做永久锁定（避免被用来锁死他人账号）。429 带 `Retry-After`。
- 登录失败日志可能被洪水攻击：审计写入前先限流，并限制单行长度/日志大小。

### 7.3 会话

- token：`randomBytes(32).toString('base64url')`；只把 SHA-256 存 DB。
- Cookie：`HttpOnly; SameSite=Strict; Path=/`；HTTPS 下 `Secure`；不设 `Domain`。
- 超时：
  - 空闲超时 8 小时（`last_seen_at` 超过即失效）；
  - 绝对超时 7 天（`expires_at`）。
  - 二者可配置；对 IDE 来说 30 分钟过短，8 小时是安全/可用折中。
- 每次认证请求最多每 60 秒更新一次 `last_seen_at`，避免写放大。
- 登出：撤销当前 session、清 Cookie。
- 改密码：校验旧密码 → 更新 hash → **撤销该用户其他所有 session** → 给当前连接发新 token。
- 管理员禁用/重置密码：撤销该用户全部 session。
- 定时清理过期/已撤销超过 7 天的 session。
- 重启后 DB 会话仍有效；内存中的 run/debug 会话本来就会丢失，客户端需处理 4404/断线。

### 7.4 CSRF / Origin

- Cookie 鉴权必须防 CSRF。采用：
  - `SameSite=Strict`；
  - 所有非 GET `/api/*` 请求必须有 `Origin`，且与 `Host`/配置的 `PUBLIC_ORIGIN` 同源；
    缺失 `Origin` 直接 403（非浏览器客户端需显式带 Origin）。
  - WebSocket 升级同样校验 `Origin`（现有 `originAllowed` 可复用）。
- 不引入 CSRF token 的取舍：单页应用、同源、无需跨站表单；Origin + SameSite 足够。
  若以后要支持第三方客户端，再加 double-submit token 或 Bearer token。
- 不启用 CORS；不要用 `Access-Control-Allow-Origin: *` 配 Cookie。

## 8. 授权

### 8.1 中间件

```ts
req.user?: { id, username, displayName, role, mustChangePassword }
req.authSessionId?: string
```

- `attachAuth`：解析 Cookie → 查 session（未撤销、未过期）→ join user → 挂到 req。
- `requireAuth`：无 `req.user` → 401 `AUTH_REQUIRED`。
- `requireAdmin`：`role !== 'admin'` → 403。
- `requireSameOrigin`：非 GET 校验 Origin。
- `requirePasswordChanged`：`must_change_password=1` 时只放行
  `/api/auth/me`、`/api/auth/logout`、`/api/auth/password`，其余 403
  `PASSWORD_CHANGE_REQUIRED`。

### 8.2 路由矩阵

| 方法/路径 | 鉴权 | 归属/说明 |
|---|---|---|
| `GET /api/health` | 公开 | 仅 `ok/serverTime/capabilities`，不含会话列表 |
| `POST /api/auth/login` | 公开 | 独立限流、8 KiB body |
| `GET /api/auth/me` | 登录 | 返回脱敏 user |
| `POST /api/auth/logout` | 登录 | 撤销当前 session |
| `POST /api/auth/password` | 登录 | 校验旧密码，撤销其他 session |
| `GET/PATCH /api/project` | 登录 | 当前用户自己的 project |
| `POST/DELETE /api/files/*` | 登录 | 当前用户 project 下的文件 |
| `POST /api/format` | 登录 | 无状态，但按用户限流 |
| `POST /api/run` | 登录 | 创建 RunSession 时写入 ownerId/projectId |
| `GET /api/run/:id` | 登录 | 只允许该 run 的 owner |
| `GET /api/runs` | 登录 | 只列当前用户 project 的历史 |
| `GET /api/runs/:id` | 登录 | owner 校验 |
| `POST /api/runs/:id/restore` | 登录 | **先校验 owner 再覆盖文件**，否则是严重 IDOR |
| `POST /api/debug/start` | 登录 | 创建 DebugSession 时写入 ownerId |
| `GET /api/debug` | 登录 | 只返回当前用户会话；不再依赖 loopback |
| `POST /api/debug/:id/stop` | 登录 | owner 校验 |
| `WS /ws/run/:id` | 登录 | Cookie + session 校验 + run owner |
| `WS /ws/debug/:id` | 登录 | Cookie + session 校验 + debug owner |
| `GET /api/admin/users` | admin | 列表脱敏 |
| `POST /api/admin/users` | admin | 创建用户；可一次性返回初始密码 |
| `PATCH /api/admin/users/:id` | admin | 禁用/启用/改角色 |
| `POST /api/admin/users/:id/reset-password` | admin | 一次性密码 + 强制改密 + 撤销会话 |

- 跨用户资源统一返回 **404**（不确认资源存在），不要返回 403 泄露 ID 有效性。
- 管理员默认**不能**读取他人源码/运行输出；如果未来需要，单独加权限并审计。
- 所有错误走现有 `ApiError`，新增错误码并在中英文 i18n 目录补键。

### 8.3 WebSocket

这是最容易漏的一条路径：

```text
server.on('upgrade', (req, socket, head) => {
  // 1. 校验 Origin（现有逻辑）
  // 2. 从 req.headers.cookie 解析 token -> 校验 session（未过期/未撤销）
  // 3. 解析 URL 得到 runId/sessionId
  // 4. 查资源并校验 ownerId === session.user.id
  // 5. 失败：socket.write('HTTP/1.1 401/403...') 后 destroy，或 handleUpgrade 后 close(4401/4403)
  // 6. 成功：handleUpgrade -> attach
});
```

- 不能只依赖 Express 中间件；`upgrade` 不经过 `app.use`。
- 不能继续把 UUID 当 bearer token；owner 校验必须在附着前完成。
- 建议关闭码：`4401` 未登录/会话失效、`4403` 非 owner、`4404` 资源不存在。
- 客户端遇到 4401/4403 不自动重连，直接回到登录页。
- 反代（nginx/Caddy）必须转发 `Cookie` 和 `Origin`，否则 WS 会 401/403；写入 README。

## 9. 配额、限流与公平性

保留现有全局上限（compile 2 / run 4 / debug 2），新增按用户上限：

| 维度 | 全局 | 每用户 | 超限行为 |
|---|---|---|---|
| 编译并发 | 2 | 1 | 排队或 429（建议 run 请求直接 429 `USER_BUSY`） |
| 运行并发 | 4 | 1 | 429 `USER_BUSY` |
| 调试会话 | 2 | 1 | 429 `DEBUG_BUSY` |
| 运行/格式化请求 | 全局 IP 限流 | 1 req/s，burst 5 | 429 `RATE_LIMITED` |
| 登录 | — | IP 10/min，用户名 5/min | 429 + `Retry-After` |

- 按用户限流的 key 用 `user:<id>`，不要用 IP；否则同一 NAT/反代后的用户会互相影响。
- 全局信号量仍是硬上限；按用户槽防止单账号占满队列。
- 是否给“排队”而不是直接 429：当前全局信号量是 FIFO 排队。建议 run/debug 在用户已有
  活动/排队任务时直接 429，避免一个用户把队列塞满；前端提示“已有任务在运行”。
- 输出上限、内存、时间等沙箱限制不变，仍由每次任务独立执行。

## 10. 客户端改动

1. **启动顺序**：`GET /api/auth/me` → 401 显示登录页；200 再 `GET /api/project`。
   不要把“后端不可达”和“未登录”混成同一个 fatal error。
2. **API 客户端**：`fetch` 明确 `credentials: 'same-origin'`；统一处理 401：
   清空用户态、关闭 WS、显示登录页，避免 toast 循环。
3. **登录页**：用户名/密码、错误提示、loading、Enter 提交；中英文 i18n。
4. **用户菜单**：TopBar 右侧显示当前用户，提供登出、修改密码；管理员可加入口。
5. **强制改密**：`mustChangePassword` 时进入改密界面，未改密不能进入工作台。
6. **localStorage 隔离**：当前 `cpplab.stdin / flags / watches / breakpoints / activeFile /
   runLimits / debugWidth / bottomHeight` 是浏览器级。改为 `cpplab.<userId>.*`，
   首次登录时迁移旧键；`cpplab.lang` 可保持全局。登出时清空用户态（至少清内存态），
   避免同一浏览器切换账号串数据。
7. **登出清理**：清理自动保存定时器、关闭 run WS、停止 debug 会话、重置 project/files/debug 状态。
8. **WS 关闭码**：4401 → 回登录；4403 → 提示无权限；4404 → 会话不存在；不要无限重连。
9. **i18n**：所有新增错误码/登录页/用户菜单文案必须同时加 `zh-CN`/`en` 键；
   `npm run i18n:check` 会直接失败。

## 11. 管理与运维

### 11.1 用户管理（首期 CLI）

```bash
npm run user:add -- alice --admin       # 交互式输入密码
npm run user:add -- bob                 # 普通用户
npm run user:list
npm run user:passwd -- alice            # 管理员重置，强制下次改密
npm run user:disable -- bob
```

- CLI 直接用 `node:sqlite` 打开 DB；要求服务已停止，或至少避免并发写冲突（SQLite WAL 可承受，
  但迁移/建用户建议停服）。
- 首个管理员**不要**通过公开 HTTP 端点创建；避免“谁先访问谁当管理员”。
- 可选 bootstrap：仅当 `users` 为空且显式设置 `ALLOW_BOOTSTRAP=1` 时读取
  `BOOTSTRAP_ADMIN_USERNAME/PASSWORD` 创建管理员；创建后立即失效。测试/容器可用，
  生产建议 CLI。密码不得打印到 stdout/日志。
- 重置密码生成一次性随机密码，只显示一次，`must_change_password=1`，并撤销旧会话。
- 删除用户默认做“禁用”，不硬删；硬删会级联项目/历史，需单独确认。

### 11.2 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `AUTH_ENABLED` | — | **未实现（有意）**：不提供任何鉴权后门，本地开发也必须登录 |
| `SESSION_IDLE_HOURS` | `8` | 空闲超时 |
| `SESSION_ABSOLUTE_DAYS` | `7` | 绝对超时 |
| `COOKIE_SECURE` | `auto` | `auto` 按请求协议；反代后需 `TRUST_PROXY` |
| `TRUST_PROXY` | `0` | 反代跳数；只有确认代理可信时才设置 |
| `PUBLIC_ORIGIN` | — | 反代后浏览器可见的 origin，用于 Origin 校验 |
| `ALLOW_REGISTRATION` | — | **未实现（有意）**：本期不开放注册，账号只能由管理员创建 |
| `ALLOW_BOOTSTRAP` | `0` | 仅首次建管理员用 |

- `HOST=0.0.0.0` 现在有了实际意义，但必须配合 TLS 或受信内网；README 要改掉
  “no built-in auth”的旧说明。
- `trust proxy` 不能无脑设为 `true`，否则 `X-Forwarded-For` 可伪造，IP 限流失效。
- HTTPS 反代时 Cookie 加 `Secure`；纯 HTTP 下不要加，否则浏览器不保存。
- 建议加 HSTS（仅 HTTPS）和基础 CSP；本期至少不要引入内联脚本。

### 11.3 数据与备份

- `data/` 0700，DB/WAL/SHM 0600；启动时检查并修正。
- 迁移前 `VACUUM INTO` 或停服复制 DB；密码哈希和源码都在里面。
- 审计日志 `data/runtime/audit.log` 已有 0600；加入登录事件后要限制大小/轮转，
  否则失败登录洪水可填满磁盘。

## 12. 审计与日志

新增事件（JSON lines，继续写 `audit.log`）：

```json
{"event":"auth.login","ok":false,"username":"alice","ip":"...","reason":"bad_password"}
{"event":"auth.login","ok":true,"userId":"...","username":"alice","ip":"..."}
{"event":"auth.logout","userId":"...","sessionId":"..."}
{"event":"auth.session.revoke","userId":"...","reason":"password_change"}
{"event":"user.create","actorId":"...","targetId":"...","role":"user"}
{"event":"user.disable","actorId":"...","targetId":"..."}
{"event":"user.password.reset","actorId":"...","targetId":"..."}
```

- run/debug 事件增加 `userId`/`username`（当前只有 runId/sourceHash）。
- 绝不记录密码、token、Cookie 原文、完整请求体。
- 失败登录也记录，但先限流；日志单行长度上限；定期轮转（如 10 MiB × 5）。

## 13. 测试计划

### 13.1 单元测试（`node --test` 或 `tsx --test`）

- scrypt hash/verify：正确密码、错误密码、篡改 hash、参数解析、rehash。
- session：过期、撤销、空闲超时、token hash 不存明文。
- 登录限流：IP/用户名双维度、退避、429。
- 授权纯函数：A 不能读 B 的 project/run/debug。
- 迁移：旧 `playground` 赋给管理员；`owner_id IS NULL` 时 fail closed。

### 13.2 集成/冒烟（扩展 `scripts/smoke-test.mjs`）

当前脚本启动临时 DB 后直接调 API；需要：

1. 用 bootstrap/CLI 在临时 DB 建 `alice`（admin）和 `bob`。
2. 增加登录 helper，保存 `Set-Cookie`；所有请求带 `Cookie` 和 `Origin`。
3. 新增检查：
   - 未登录 `GET /api/project` → 401；
   - 错误密码 → 401 且文案不区分用户是否存在；
   - 连续失败 → 429；
   - 登录成功 → 200 + HttpOnly/SameSite cookie；
   - bob 访问 alice 的 `/api/run/:id`、`/api/runs/:id`、`/api/runs/:id/restore`、
     `/api/debug/:id/stop` → 404；
   - bob 用 alice 的 runId 连 WS → 关闭 4403/4404；
   - 无 Cookie 连 WS → 401/4401；
   - 登出后再访问 → 401；
   - 改密后旧 session 失效；
   - 非 GET 缺少/跨站 `Origin` → 403。
4. 原有 15 项沙箱/调试检查全部带登录 Cookie 跑通。

### 13.3 手工验收

- 两个浏览器（或隐身窗口）分别登录 alice/bob，确认项目、文件、历史、调试互不可见。
- 同一浏览器切换账号，确认 `stdin`/断点/Watch/当前文件不串。
- 管理员禁用 bob 后，bob 的现有页面在下一次请求/WS 消息时被拒。
- 反代 HTTPS 下确认 Cookie 带 `Secure`、WS 正常升级。
- 停服后重启，DB 会话仍可用；运行/调试内存会话正确提示不存在。

## 14. 实施顺序（已作为 M5 完成）

按“先安全测试，再实现”的既有约定：

1. **M5.0 文档**：更新 `AGENTS.md`（§1/§2/§3/§7/§8/§10）、README 中英文、本文定稿；
   先把“7 条安全底线”扩成含鉴权的清单，避免代码与文档冲突。
2. **M5.1 数据层**：`users`/`auth_sessions`/`projects.owner_id` 迁移；去掉
   `DEFAULT_PROJECT_ID`；DB 函数显式接收 projectId；CLI 建管理员；密码哈希。
   验收：旧 DB 迁移后管理员能登录，旧项目/历史归其所有。
3. **M5.2 认证 HTTP**：login/logout/me/password、Cookie、CSRF、登录限流、
   `must_change_password`；加单元测试。验收：未登录全 401，登录后可访问。
4. **M5.3 授权**：所有路由按当前用户解析 project；run/debug owner；
   `runs/:id/restore` 校验；跨用户 404；加 A/B 集成测试。
5. **M5.4 WebSocket**：升级时解析 Cookie、校验 session 与 owner；关闭码；
   客户端 401 处理。验收：无 Cookie/跨用户 WS 被拒。
6. **M5.5 配额与审计**：按用户并发槽/限流；审计 userId；登录失败限流与轮转。
7. **M5.6 客户端**：登录页、用户菜单、改密、localStorage 命名空间、登出清理、i18n。
8. **M5.7 回归**：`npm run typecheck`、`npm run i18n:check`、`npm run build`、
   `npm run test`（扩展后的 smoke）、手工双用户验收。

每个阶段都先写对应安全测试（未登录/越权/CSRF/枚举），再写功能。实际落地时，
`tests/unit/*.test.ts` 覆盖密码、会话、登录限流、并发槽与数据迁移；`scripts/smoke-test.mjs`
用真实登录串起双用户越权、CSRF、WS 拒绝、强制改密、会话轮换等 25 项端到端检查。

## 15. 重点注意事项（按风险排序）

1. **不要只加登录页**：`db.ts` 里所有硬编码 `DEFAULT_PROJECT_ID` 的查询都要改成显式
   projectId；否则登录后仍然是全员共享一个项目。
2. **WebSocket 是第二套入口**：Express 鉴权中间件对 `upgrade` 无效；必须在
   `server.on('upgrade')` 里手动解析 Cookie、校验 session、校验资源 owner。
3. **runId/sessionId 不再是凭证**：UUID 不可猜测不等于授权；跨用户附着必须被拒。
4. **`/api/runs/:id/restore` 是最危险的 IDOR**：它会覆盖当前项目文件；先校验 run 的
   owner，再 `replaceFiles`。
5. **跨用户返回 404**：403 会泄露“这个 ID 存在”；统一 404 更安全。
6. **Cookie 鉴权必须配 CSRF 防护**：SameSite=Strict + Origin 校验；登录接口也要校验
   Origin，防 login CSRF。
7. **会话 token 只存哈希**：DB 泄露不等于会话泄露；HttpOnly、Secure、登录时轮换、
   改密/禁用时撤销。
8. **时序/枚举/暴力破解**：未知用户跑 dummy scrypt；统一错误；登录限流先于哈希；
   限制并发 scrypt，防止登录洪水拖垮线程池。
9. **`trust proxy` 与 `Secure`**：反代后 `req.ip`、`X-Forwarded-Proto` 的信任必须显式配置；
   否则 IP 限流可伪造，或 Cookie 不生效。
10. **body parser 顺序**：鉴权要放在 `express.json()` 之前；登录 body 单独限 8 KiB，
    否则未认证请求也能触发 3 MiB JSON 解析。
11. **遗留数据归属**：现有 `playground` 必须显式赋给管理员；`owner_id IS NULL` 时
    宁可拒绝服务也不要让第一个登录者继承全部数据。
12. **按用户配额**：全局信号量会被单账号占满；每个用户最多 1 个运行/1 个调试，
    并对 run/format 做按用户限流。
13. **同一浏览器切换账号会串 localStorage**：`stdin`、断点、Watch、当前文件都要按
    userId 命名空间；登出清理内存态。
14. **loopback 不是授权**：`isLoopback()` 只适合单用户时代；多用户后调试列表必须按
    owner 过滤，不能再返回全部会话。
15. **审计日志可被洪水攻击**：失败登录先限流，单行限长，日志轮转；绝不记录密码/token。
16. **DB 文件权限**：当前 `data/` 755、DB 644；加入密码哈希后收紧到 700/600（含 WAL/SHM）。
17. **i18n 与测试**：新增错误码/文案必须中英文都加，否则 `i18n:check` 失败；
    smoke test 不能加“测试跳过鉴权”的后门，必须真实登录。
18. **管理接口最小权限**：管理员默认不读他人源码；重置密码只显示一次并强制改密；
    首个管理员只能 CLI/bootstrap 创建，不能公开注册。
19. **会话清理与重启**：DB 会话可跨重启；定时清理过期记录；内存 run/debug 会话
    丢失后客户端要正确提示，不要无限重连。
20. **传输安全**：局域网明文 HTTP 会暴露密码和 Cookie；优先 HTTPS 反代或
    `127.0.0.1` + SSH 隧道；README 要明确写出这一限制。

## 16. 已确认的决策（2026-11-22）

| 决策 | 选择 | 对实现的影响 |
|---|---|---|
| 账号创建 | **管理员 CLI 创建**，不开放注册 | 不做注册/邀请码/审批；首个管理员用 CLI 或一次性 bootstrap 创建；管理 UI 可后置 |
| 数据隔离 | **每用户独立项目**，UI 仍单项目 | `projects.owner_id` + `getProjectForUser()`；不做项目切换器；schema 保留多项目扩展空间 |
| 部署 | **HTTPS 反向代理** | 默认 `COOKIE_SECURE=auto`，配置 `TRUST_PROXY=1`/`PUBLIC_ORIGIN`；README 给出 Caddy/nginx 的 Cookie/Origin/WS 转发说明 |

由此确定的首期范围：

- 不做注册、邀请码、OIDC、多项目 UI、管理员读他人源码。
- 首期管理入口为 CLI；管理员 HTTP API/UI 作为 M5.5 可选增量。
- 安全测试以“双用户 A/B + 跨用户 404 + WS 拒绝”为核心验收。

## 17. 后续可选工作

本期已交付的内容不再重复；以下均为可选增量，默认不做：

- 管理员用户管理 UI（HTTP API 已就绪，见 `/api/admin/users`）。
- 多项目 UI / 项目切换器（schema 已支持一个账号多个项目）。
- OIDC/LDAP/Passkey、邮件找回密码、会话设备列表与手动吊销。
- 第三方客户端支持（需要新增 CSRF token 或 Bearer token 模式）。
- 审计日志外送与 SIEM 集成。

## 18. 实现落点与验收证据（2026-11-22）

### 18.1 代码落点

| 模块 | 文件 | 说明 |
|---|---|---|
| 数据层/迁移 | `src/server/db.ts` | `PRAGMA user_version=1`；`users`、`auth_sessions`、`projects.owner_id`；所有项目/运行/调试函数显式接收 `projectId`；首个账号继承遗留项目；启动时收紧 `data/` 与 DB 权限 |
| 密码 | `src/server/auth/password.ts` | scrypt N=32768/r=8/p=1、自描述格式、`timingSafeEqual`、dummy 校验、rehash、哈希并发槽、密码策略 |
| 会话 | `src/server/auth/session.ts` | 32 字节 token、只存 SHA-256、HttpOnly/SameSite/Path/Secure、空闲/绝对超时、每 60 秒 touch、轮换与撤销；`authenticateTokenHash` 供 WS 复用 |
| 登录防护 | `src/server/auth/loginLimiter.ts` | IP 10/min、用户名 5/min、连续失败 1m→5m→15m 退避，成功登录清空该账号窗口 |
| 中间件 | `src/server/auth/middleware.ts` | `attachAuth` / `requireAuth` / `requireAdmin` / `requireSameOrigin` / `requirePasswordChanged`；WS Origin 校验 |
| 认证服务 | `src/server/auth/service.ts` | login/logout/me/password、管理员创建/禁用/改角色/重置、一次性 bootstrap、统一错误与审计 |
| HTTP | `src/server/main.ts` | 鉴权先于 3 MiB body parser；登录独立 8 KiB parser；health 不再泄露调试会话；admin API；按账号限流/并发槽；跨用户 404 |
| 运行/调试 | `src/server/runService.ts`、`src/server/debug/session.ts` | `RunSession`/`DebugSession` 持有 `ownerId`/`projectId`；WS 附着前校验归属；会话被撤销后 WS 在转发下一条消息/事件时关闭 4401 |
| 配额 | `src/server/util/userQuota.ts` | 每账号 1 运行 / 1 调试；全局信号量仍是硬上限 |
| 审计 | `src/server/util/audit.ts` | 登录、会话撤销、用户管理、运行/调试事件（含 userId/username）；单行 ≤8 KiB，10 MiB × 5 轮转 |
| CLI | `scripts/user-cli.mts` | `user:add/list/passwd/disable/enable/role`；首个账号自动继承遗留项目 |
| 客户端 | `src/client/App.tsx`、`components/AuthScreens.tsx`、`TopBar.tsx`、`storage.ts` | `me → 登录页 → 工作台`；强制改密；用户菜单；统一 401；localStorage 按 userId 命名空间并迁移旧键；WS 4401/4403 处理 |
| 配置/文档 | `src/server/config.ts`、README、AGENTS.md | 会话/代理/Cookie/bootstrap 环境变量；部署与验收说明 |

### 18.2 与提案的差异（均为有意的实现选择）

1. **没有提供 `AUTH_ENABLED=0` 后门，也没有实现 `ALLOW_REGISTRATION`**：§16 已确认不开放
   注册；§11.2 中的 `AUTH_ENABLED` 也被有意省略，本地开发同样必须真实登录。注册/邀请码/
   审批如果要加，必须作为新的安全决策单独评审。
2. **管理员 UI 后置**：管理员 HTTP API 已实现并有测试覆盖，但未做前端用户管理页。
3. **WS 会话续验**：除升级时校验外，调试 WS 在转发每条消息、运行 WS 在发送每个事件前，
   以及心跳（30 s）时都会限频复核会话；管理员禁用/改密后最多 5 秒内关闭 `4401`，
   而不是等到连接自然断开。
4. **首个账号继承全部无主项目**：优先保证旧数据不丢；`getProjectForUser` 仍按最早创建
   的项目工作。若仍有 `owner_id IS NULL` 的项目且已存在账号，业务 API 以 `503
   ORPHAN_PROJECTS` fail closed（health 与 `/api/auth/*` 保持可用，便于管理员修复）。
5. **登录成功会清空该用户名的失败窗口**（IP 窗口继续计数），避免合法用户成功登录后仍被
   之前失败次数的退避卡住。
6. **会话清理**：启动时 + 每小时清理过期/撤销超过 7 天的记录。

### 18.3 验收证据

- `npm run test:unit`：26 项，覆盖 scrypt 哈希/校验/参数升级、密码策略、登录限流与退避、
  会话创建/撤销/过期/空闲超时、账号禁用、改密轮换、首次登录迁移、运行历史按 project 隔离、
  每账号并发槽。
- `npm test`（`scripts/smoke-test.mjs`）：25 项，真实 bootstrap 管理员并登录，覆盖未登录 401、
  缺失/跨站 Origin 403、HttpOnly/SameSite Cookie、DB 中只存 token/password 哈希、
  `data/` 0700 与 DB 0600、双用户项目隔离、跨用户 run/restore/debug 404 与 WS 4403/4401、
  每账号运行与调试并发 429、强制改密、改密使旧会话失效、登出失效、登录洪水 429；
  原有沙箱（TLE/OLE/MLE/逃逸/无网络/参数白名单）与 DAP 检查全部带登录 Cookie 跑通。
- `npm run i18n:check`：443 个 key，中英一致，无未翻译文案。
- `npm run i18n:ui`（需真实账号）：登录后英文界面零中文、语言切换与刷新保留、无页面错误。
