# AGENTS.md — 在线 C++ IDE 开发约定

> 本文档是 AI 辅助开发的执行依据。若与代码冲突，先改文档再改代码。
> 约束：单机部署，用户 ≤ 10 人。`MUST` 条目不可协商；`可选` 条目默认不做。

## 0. 执行规则

1. 按 §8 里程碑顺序开发，每个阶段跑通验收再进入下一阶段，不要并行铺开。
2. §3「安全底线清单」是硬约束，任何简化都不得突破。
3. 生成代码时同时给出验证方式（如何手动测试这条路径）。
4. 未覆盖的决策点：小决策直接做并说明理由；涉及架构/安全的决策先提问。

## 1. 项目目标与非目标

**做**：网页版 C++ 编辑/编译/运行/调试平台 —— 语法高亮、自动缩进、补全、格式化、多文件；服务端 g++/clang++ 编译；图形化断点调试（断点、单步、调用栈、变量、Watch）；严格沙箱隔离不可信代码；**本地账号与多用户隔离（管理员创建账号、个人项目/历史/调试会话）**。

**本期不做**：多用户实时协作；自助注册、邮件找回、OIDC/LDAP/Passkey、RBAC 细粒度权限；多项目 UI/项目切换器；管理员读取他人源码；OJ 多测试点批量评测；跨语言（只做 C++）；集群/K8s；VS Code 插件生态；反向调试、多线程调试 UI。

## 2. 威胁模型

需要防御三类攻击：

1. **逃逸**：读宿主文件（密钥、`/etc/passwd`、他人代码）、访问内网、提权
2. **资源滥用**：死循环、fork bomb、打爆输出、写满磁盘、拖垮宿主机
3. **编译期攻击**：通过编译器选项（`-fplugin`、`-wrapper`）或编译器 bug 在编译阶段执行任意代码

**多用户新增威胁**（详见 `docs/multi-user-auth.md` §4）：

| 威胁 | 防御 |
|---|---|
| 凭据填充 / 暴力破解 | scrypt（N=32768,r=8,p=1）、统一错误、登录 IP/用户名限流、失败退避、审计 |
| 会话窃取（XSS/日志/URL） | HttpOnly + SameSite=Strict Cookie、token 只存 SHA-256、不把 token 放 URL、日志脱敏、HTTPS 下 Secure |
| CSRF / 登录 CSRF | 所有非 GET `/api` 校验同源 `Origin`；WebSocket 升级同样校验 |
| IDOR / 越权 | 查询一律带当前账号的 `projectId`；运行/调试会话记录 owner；跨用户返回 404；WS 附着前校验 owner |
| 账号枚举 / 时序 | 未知用户名也执行 dummy scrypt；统一 401；响应时间接近 |
| 单账号资源独占 | 全局信号量之外增加每账号运行/调试槽与按账号限流 |
| 登录接口 DoS | 登录体 ≤8 KiB、限流先于哈希、scrypt 并发上限 4 |
| 审计日志洪水 | 登录失败先限流；单行 ≤8 KiB；10 MiB × 5 轮转 |

不防御：宿主 root、内核 0-day 级国家级攻击者、拿到 DB 文件的攻击者（但文件权限必须收紧）。

## 3. 安全底线清单（7 条 + 鉴权 8 条，不可省略）

> 与用户规模无关，任何简化都不得突破。

### 3.1 沙箱底线（7 条）

1. **编译也在沙箱内**（编译器 bug 是真实攻击面）
2. **编译选项白名单**（`-fplugin`/`-wrapper` 是编译期 RCE）
3. **输出大小上限**（防 `while(1) puts()` 打爆磁盘）
4. **杀进程组，不是杀子进程**
5. **无网络**
6. **只读 rootfs + 每任务独立 tmpfs**
7. **no-new-privs + 非 root uid**

### 3.2 鉴权底线（8 条，M5 起）

1. **密码只存 scrypt 哈希**（每密码独立盐、`timingSafeEqual`、参数可升级），绝不存明文。
2. **会话 token 只存 SHA-256**，HttpOnly + SameSite=Strict + Path=/，HTTPS 加 Secure；
   登录必轮换，改密/禁用/重置撤销既有会话。
3. **所有业务 API 默认需要登录**；health/login 之外的 `/api/*` 不得有匿名入口。
4. **每个查询都带 owner 条件**：服务端从会话解析 `projectId`，不接受客户端传入；运行/调试
   资源校验 owner；跨用户统一 404。
5. **WebSocket 是第二套入口**：升级时必须解析 Cookie、校验会话与资源 owner；会话被撤销后
   停止转发并关闭 4401。
6. **Cookie 鉴权必须防 CSRF**：非 GET `/api` 强制同源 Origin；WebSocket 同样校验。
7. **登录限流先于 scrypt**，并限制 scrypt 并发；审计不得记录密码、token、Cookie 原文。
8. **每账号同时只保留 1 个有效会话**：登录/改密在事务中撤销旧会话并签发新 token；DB 用
   唯一部分索引兜底；旧设备 HTTP 401、旧 WebSocket 关闭 4401。不得只靠前端隐藏或 IP/UA 判断。

## 4. 禁止事项

- ❌ 把用户输入直接拼进 shell 字符串（MUST 用 argv 数组）
- ❌ 透传未校验的编译参数
- ❌ 在沙箱外执行任何用户可控的二进制/脚本
- ❌ 调试会话不设超时
- ❌ 用 `exec`/`system` 调用 `timeout` 命令做限制（必须在代码里实现 watchdog）
- ❌ 跳过 §3 安全底线的任何一条
- ❌ 把 UUID/runId/sessionId 当作授权凭证（必须校验 owner）
- ❌ 接收客户端传入的 `projectId`/`userId` 作为归属依据
- ❌ 把登录/鉴权放在 `express.json()` 之后（未认证请求不得消耗 body 解析）
- ❌ 提供 `AUTH_ENABLED=0` 之类的永久鉴权后门，或在 smoke test 中跳过真实登录
- ❌ 在日志、URL、错误响应中输出密码、token、Cookie 原文
- ❌ 用 loopback 地址代替授权判断（多用户后 `isLoopback()` 不是权限）
- ❌ 在 `data/` 权限仍为 755 / DB 644 时上线密码哈希
- ❌ 把 `trust proxy` 设为 `true` 或无条件信任 `X-Forwarded-*`

## 5. 编译执行链路

### 5.1 流程

0. 鉴权（Cookie 会话）→ 从会话解析当前账号与 `projectId`；校验 Origin；登录接口单独限流。
1. 校验请求（文件数、大小、flags 白名单）
2. `mkdtemp` 创建 tmpfs 工作目录，写入文件
3. **编译**（沙箱内）：wall timeout 20s，内存 1 GiB
4. 失败 → 返回 `CE` + 解析后的诊断
5. **运行**（沙箱内）：喂 stdin，管道收 stdout/stderr
6. 父进程 watchdog：超时或输出超限 → `kill(-pgid, SIGKILL)`
7. 回收：杀进程组、删 tmpfs、释放 cgroup
8. 状态分类：`signal==SIGXCPU/SIGKILL+超时` → TLE，cgroup OOM → MLE，输出超限 → OLE

### 5.2 编译选项白名单（MUST）

**编译器参数本身是 RCE 向量**，绝不透传原始 argv。

```
允许：
  -std=c++17|c++20|c++23
  -O0|-O1|-O2|-O3|-Os
  -g | -Wall | -Wextra | -Werror
  -pthread | -lm
  -fsanitize=address|undefined|address,undefined
  -D<白名单字符>              （值需再校验，禁止 $( )
  -I<仅限工作目录内>          （解析后必须仍在 workdir 下）
  -ffile-prefix-map=...       （调试用，见 §6.4）

拒绝（必须显式拦截）：
  -o          -fplugin      -wrapper      @任何东西
  -specs=     -B            -Xclang       -include
  --gcc-toolchain=           -plugin       -dumpspecs
  任何包含 .. 或以 / 开头的路径参数
```

### 5.3 资源限制（MUST）

| 维度 | 手段 | 运行期取值 |
|---|---|---|
| 墙钟超时 | 父进程 watchdog + SIGKILL | 2s（可配，上限 10s） |
| CPU 时间 | `RLIMIT_CPU` / cgroup `cpu.max` | 与墙钟同量级 |
| 内存 | **cgroup `memory.max`**（不要只靠 `RLIMIT_AS`） | 256 MiB |
| 进程数 | cgroup `pids.max` | 14 |
| 输出 | 父进程读管道，超限即杀 | 64 KiB |
| 磁盘 | tmpfs `size=` + `RLIMIT_FSIZE` | 256 MiB |
| fd | `RLIMIT_NOFILE` | 100 |
| core | `RLIMIT_CORE=0` | — |

**超时必须杀整个进程组**（`setsid()` 建组 + `kill(-pgid, SIGKILL)`），只杀直接子进程会漏掉孙子进程。

### 5.4 沙箱通用加固（MUST）

- 6 类 namespace：user / pid / mount / net / ipc / uts
- `no_new_privs` + drop 全部 capabilities
- 只读 rootfs，唯一可写为 tmpfs 工作目录
- 非 root uid 运行；空网络命名空间（默认禁网）
- 超时后杀**进程组**
- 注入伪造的 `/etc/passwd`、`/etc/shadow`；敏感路径用 tmpfs 覆盖

## 6. 图形化调试

### 6.1 架构要点

- 前端与后端走 WebSocket 裸 JSON（DAP），后端只做 stdio ↔ WebSocket 的哑管道转发（Content-Length framing ⇄ WS 自带分帧）
- **调试器与被调试程序放在同一个沙箱**，仅 stdio 穿出；避免 TCP 连接，网络保持禁用
- **WS 升级必须鉴权**：解析 Cookie 会话 → 校验 `DebugSession.ownerId` → 才允许 `attach`；
  会话被撤销/禁用后停止转发并关闭 4401，不能只依赖升级瞬间的检查
- 后端会话管理：并发 ≤ 2；空闲超时 5min / 硬超时 30min → kill 进程组；沙箱 `time_limit=3600` 兜底（防后端崩溃泄漏）

### 6.2 状态机（MUST 严格遵守）

```
idle → starting → running ⇄ paused → terminated
                     ↑________↓
```

- **只有 `paused` 才能发 `stackTrace`/`scopes`/`variables`/`evaluate`**，否则返回 `program is not stopped`
- `setBreakpoints` 是**该文件的全量替换**，不是增量
- 收到 `stopped` → 先拉 `stackTrace` 拿 `frameId` → 再 `scopes` → 用户展开时才 `variables`
- `evaluate` 的 `context` 区分：`watch` / `repl` / `hover` / `variables`

### 6.3 调试沙箱与普通运行的差异

| 项 | 普通运行 | 调试会话 |
|---|---|---|
| `ptrace` | DENY | **ALLOW**（MUST，否则调试器无法工作） |
| `time_limit` | 30s | 3600s（改由后端空闲超时管） |
| 内存 | 256 MiB | 1024 MiB |
| `pids_max` | 14 | 32 |
| `/proc` | 最小化 | **完整挂载**（读 `/proc/pid/maps`） |
| 网络 | 禁用 | **仍禁用** |

Yama `ptrace_scope` 默认 1 允许 ptrace 自己的后代；调试器与目标同 uid 同 jail 即合法，**不需要改内核参数**（拆到不同 jail 才会撞墙——必须同 jail 的原因）。

### 6.4 源码路径映射（最易踩坑）

DWARF 记录的路径必须与 Monaco model URI 一致，否则断点不生效、栈帧跳不过去。

**MUST 采用**：沙箱内固定挂载点 `/workspace`，编译用绝对路径：

```
沙箱 cwd = /workspace
编译:  g++ -g -O0 -ffile-prefix-map=$PWD=/workspace /workspace/main.cpp -o /workspace/prog
DWARF: /workspace/main.cpp        ← 天然一致
前端:  Monaco model URI = "/workspace/main.cpp"
```

兜底：用 DAP `launch` 的 `sourceMap` 参数重映射：`[["/tmp/abc123", "/workspace"]]`。

### 6.5 其他 MUST

- **调试强制 `-g -O0`**（`-O1` 以上变量会被优化掉）
- 三层超时：空闲 5min → disconnect + kill 进程组；硬超时 30min → kill；沙箱 `time_limit=3600` 兜底
- 变量树**懒加载**：`variablesReference > 0` 才可展开，禁止一次性全量拉取
- 断点 `verified:false` 必须画空心圈，否则用户以为断上了其实没有
- 程序 `printf` 输出经 DAP `event: output` 进面板，`stdout`/`stderr` 分 tab

### 6.6 调试功能范围

**本期**：行断点增删、当前行高亮、继续/单步跳过/步入/步出/暂停/停止、调用栈（点击跳转 + 切帧）、局部变量树（懒加载）、Watch、调试控制台、程序输出面板。

**后续（可选，默认不做）**：条件/日志断点 → `setVariable` 改值 → hover 求值 → 异常断点 → 多线程 → 反向调试。

## 7. 非功能需求

| 项 | 要求 |
|---|---|
| 并发 | 编译 ≤2、运行 ≤4、调试会话 ≤2（进程内信号量）；每账号运行 ≤1、调试 ≤1 |
| 限流 | 按 IP：运行 ≤ 1 req/s，突发 ≤ 5；按账号同量级；登录 IP 10/min、用户名 5/min + 退避 |
| 会话 | 空闲 8 h、绝对 7 天；每账号同时仅 1 个有效会话（新登录逐出旧设备）；改密/禁用撤销；每小时清理过期记录 |
| 账号 | 本地账号、管理员 CLI 创建；密码 10–128；首个管理员不得公开注册 |
| 数据保护 | `data/ 0700`、DB/WAL/SHM `0600`；只存 scrypt/token 哈希 |
| 请求大小 | 源码 ≤ 256 KiB，stdin ≤ 1 MiB，文件数 ≤ 16 |
| 输出 | stdout/stderr ≤ 64 KiB（超出截断并标 OLE） |
| 日志 | 每次执行记录：userId、源码 hash、参数、退出原因、沙箱 SIGSYS 次数；登录成功/失败、会话撤销、用户变更；单行限长、轮转 |
| 清理 | 定期扫描超时未回收的沙箱进程并 kill |

## 8. 里程碑

- **M1 MVP 编译运行**：后端骨架 + SQLite；沙箱配置调通（编译 + 运行）；`/api/run` + 白名单 + 资源限制；Monaco 基础编辑；流式输出、编译错误跳转。**验收**：死循环代码 → TLE 且宿主无残留进程。
- **M2 IDE 体验**：格式化、多文件 Tab、snippet 补全、stdin 交互、历史记录。**验收**：多文件项目可编译，格式化生效。
- **M3 图形化调试**：调试沙箱（放开 ptrace）、DAP 桥接 + 会话管理 + 三层超时、断点装饰 + 当前行高亮、调试面板、路径映射验证。**验收**：设断点 → 命中 → 看局部变量 → 单步 → 栈帧点击跳转。
- **M4 生产加固**：限流 + 并发信号量、审计日志 + 监控、沙箱 SIGSYS 告警。
- **M5 多用户鉴权（已完成）**：数据迁移 + 账号 CLI、HTTP 登录/登出/改密、Cookie 会话 + CSRF、
  项目/运行/调试 owner 授权、WebSocket 鉴权、按账号配额、登录页/用户菜单/强制改密/本地存储
  按账号隔离。**验收**：双用户 A/B 互相看不到项目/历史/调试；未登录全 401；跨用户 404/4403；
  `npm run test:unit` + `npm test`（27 项 smoke）+ `npm run i18n:check` + `npm run build` 全绿。
  设计见 `docs/multi-user-auth.md`。

每个里程碑内开发顺序：先写该模块的**沙箱/安全测试**（逃逸用例）→ 再写功能实现 → 最后写 UI → 通过验收再进下一阶段。M5 起同样先写鉴权测试（未登录/越权/CSRF/枚举），再写功能。

## 9. 已知坑清单

| # | 坑 | 规避 |
|---|---|---|
| 1 | 只用 `docker --memory` 就上线 | 必须沙箱隔离，共享内核不够 |
| 2 | 编译不沙箱 | 编译期才是最被忽视的 RCE 面 |
| 3 | 超时只用 `timeout` 命令 | 漏掉子进程，必须杀进程组 |
| 4 | 用 `RLIMIT_AS` 管内存 | cgroup `memory.max` 更可靠 |
| 5 | 忘记输出限制 | 一个 `while(1) puts()` 打爆磁盘 |
| 6 | seccomp 白名单少写一个 syscall | 程序在 `main()` 前 SIGSYS，需先宽松跑 strace 再收紧 |
| 7 | clangd 无限制长跑 | 内存缓慢泄漏拖垮 worker |
| 8 | 调试会话无超时 | 调试器挂着不释放 |
| 9 | `stopped` 前发查询请求 | DAP 返回 `program is not stopped` |
| 10 | 断点 `verified:false` 不处理 | 必须画空心圈 |
| 11 | DWARF 路径与前端 URI 不一致 | 断点不生效、栈帧跳不过去（§6.4） |
| 12 | 调试用了 `-O1` 以上 | 变量全是 `<optimized out>`，必须强制 `-O0` |
| 13 | 变量树一次性全量拉取 | 大结构体卡死前端，必须懒加载 |
| 14 | 调试沙箱忘了放开 `ptrace` | 调试器起不来，静默失败 |
| 15 | 只加登录页，DB 仍硬编码 `playground` | 登录变装饰；必须去掉 `DEFAULT_PROJECT_ID`，查询显式带 projectId |
| 16 | 只保护 Express 而忘了 WebSocket `upgrade` | 用 runId/UUID 即可越权附着；必须在 upgrade 中校验会话与 owner |
| 17 | 跨用户返回 403 | 泄露 ID 是否存在；统一 404 |
| 18 | 鉴权写在 `express.json()` 之后 | 未认证请求也能消耗 3 MiB body 解析；鉴权必须在 body parser 之前 |
| 19 | 把 loopback 当授权 | 多用户后必须按 owner 过滤调试会话列表 |
| 20 | 同一浏览器切换账号串 localStorage | 所有 `cpplab.*` 偏好改为 `cpplab.<userId>.*`，登出清内存态 |
| 21 | 反代后 Cookie 缺 Secure / `req.ip` 不可信 | 显式配置 `TRUST_PROXY=<跳数>`、`PUBLIC_ORIGIN`、`COOKIE_SECURE=auto` |
| 22 | 失败登录逐条写审计被洪水打满 | 限流先于审计、单行限长、日志轮转 |
| 23 | 登录对未知用户直接返回 | 时序枚举；未知用户名也跑一次 dummy scrypt |
| 24 | 重置密码/禁用后旧 WS 仍收数据 | 转发前与 1 秒定时复核会话（不续期），撤销后关闭 4401 |
| 25 | 只在前端限制“单设备”，后端仍可多会话 | 登录/改密在事务中撤销旧会话 + 唯一部分索引；旧 HTTP 401、旧 WS 4401 |

## 10. 验收测试（每个 PR 必须能回答）

**沙箱类**
- [ ] `while(1);` → TLE，宿主无残留进程
- [ ] `#include </etc/passwd>` → 编译失败
- [ ] `system("cat /etc/passwd")` → 看不到真实内容
- [ ] fork bomb → 被 `pids.max` 拦截
- [ ] 大量 `puts()` → 被输出上限拦截
- [ ] `socket(AF_INET,...)` → 失败（无网络）
- [ ] `-fplugin=/tmp/x.so` → 被白名单拒绝

**鉴权类（M5 起）**
- [ ] 未登录访问任一业务 API → 401；`/api/health` 与 `/api/auth/login` 公开
- [ ] 错误密码 / 未知用户 / 禁用账号 → 同一 401 文案，响应时间接近
- [ ] 连续失败登录 → 429 + `Retry-After`；登录成功清空该用户名退避
- [ ] 非 GET 请求缺少/跨站 `Origin` → 403；WebSocket 跨站升级被拒
- [ ] A 登录后访问 B 的项目/run/restore/debug → 404；A 的 WS 被 B 连接 → 4403
- [ ] 无 Cookie 连 WS → 4401；登出/改密/禁用后旧会话与旧 WS 失效
- [ ] 改密后旧 session 失效、当前连接换发新 token
- [ ] 同一账号第二次登录成功，首个设备的下一次请求/WS 被拒；DB 中该账号仅 1 条未撤销会话
- [ ] 管理员重置密码只显示一次，目标账号被强制改密
- [ ] 首账号继承旧 `playground`；仍有 `owner_id IS NULL` 且已有账号时业务 API fail closed
- [ ] `data/` 0700、DB/WAL/SHM 0600；DB 内无 token 明文、无密码明文
- [ ] 同一浏览器切换账号，`stdin`/断点/Watch/当前文件不串
- [ ] 新错误码/登录页/用户菜单文案中英文齐全（`npm run i18n:check`）

**调试类**
- [ ] 设断点 → 启动 → 命中，当前行高亮正确
- [ ] 单步跳过/步入/步出行为正确
- [ ] 调用栈点击可跳转，切帧后变量随之变化
- [ ] 变量树展开嵌套结构体/数组正常
- [ ] Watch 表达式在每次 `stopped` 后刷新
- [ ] 程序 `printf` 输出出现在输出面板
- [ ] 断点设在空行 → 显示未验证（空心圈）
- [ ] 5 分钟无操作 → 会话自动回收
- [ ] 程序正常退出 → `terminated` 事件，UI 状态复位
