# AGENTS.md — 在线 C++ IDE 开发约定

> 本文档是 AI 辅助开发的执行依据。若与代码冲突，先改文档再改代码。
> 约束：单机部署，用户 ≤ 10 人。`MUST` 条目不可协商；`可选` 条目默认不做。

## 0. 执行规则

1. 按 §8 里程碑顺序开发，每个阶段跑通验收再进入下一阶段，不要并行铺开。
2. §3「安全底线清单」是硬约束，任何简化都不得突破。
3. 生成代码时同时给出验证方式（如何手动测试这条路径）。
4. 未覆盖的决策点：小决策直接做并说明理由；涉及架构/安全的决策先提问。

## 1. 项目目标与非目标

**做**：网页版 C++ 编辑/编译/运行/调试平台 —— 语法高亮、自动缩进、补全、格式化、多文件；服务端 g++/clang++ 编译；图形化断点调试（断点、单步、调用栈、变量、Watch）；严格沙箱隔离不可信代码。

**本期不做**：多用户实时协作；OJ 多测试点批量评测；跨语言（只做 C++）；集群/K8s；VS Code 插件生态；反向调试、多线程调试 UI。

## 2. 威胁模型

需要防御三类攻击：

1. **逃逸**：读宿主文件（密钥、`/etc/passwd`、他人代码）、访问内网、提权
2. **资源滥用**：死循环、fork bomb、打爆输出、写满磁盘、拖垮宿主机
3. **编译期攻击**：通过编译器选项（`-fplugin`、`-wrapper`）或编译器 bug 在编译阶段执行任意代码

不防御：内核 0-day 级国家级攻击者（单机内部场景）。

## 3. 安全底线清单（7 条，不可省略）

> 与用户规模无关，任何简化都不得突破。

1. **编译也在沙箱内**（编译器 bug 是真实攻击面）
2. **编译选项白名单**（`-fplugin`/`-wrapper` 是编译期 RCE）
3. **输出大小上限**（防 `while(1) puts()` 打爆磁盘）
4. **杀进程组，不是杀子进程**
5. **无网络**
6. **只读 rootfs + 每任务独立 tmpfs**
7. **no-new-privs + 非 root uid**

## 4. 禁止事项

- ❌ 把用户输入直接拼进 shell 字符串（MUST 用 argv 数组）
- ❌ 透传未校验的编译参数
- ❌ 在沙箱外执行任何用户可控的二进制/脚本
- ❌ 调试会话不设超时
- ❌ 用 `exec`/`system` 调用 `timeout` 命令做限制（必须在代码里实现 watchdog）
- ❌ 跳过 §3 安全底线的任何一条

## 5. 编译执行链路

### 5.1 流程

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
| 并发 | 编译 ≤2、运行 ≤4、调试会话 ≤2（进程内信号量） |
| 限流 | 按 IP：运行 ≤ 1 req/s，突发 ≤ 5 |
| 请求大小 | 源码 ≤ 256 KiB，stdin ≤ 1 MiB，文件数 ≤ 16 |
| 输出 | stdout/stderr ≤ 64 KiB（超出截断并标 OLE） |
| 日志 | 每次执行记录：源码 hash、参数、退出原因、沙箱 SIGSYS 次数 |
| 清理 | 定期扫描超时未回收的沙箱进程并 kill |

## 8. 里程碑

- **M1 MVP 编译运行**：后端骨架 + SQLite；沙箱配置调通（编译 + 运行）；`/api/run` + 白名单 + 资源限制；Monaco 基础编辑；流式输出、编译错误跳转。**验收**：死循环代码 → TLE 且宿主无残留进程。
- **M2 IDE 体验**：格式化、多文件 Tab、snippet 补全、stdin 交互、历史记录。**验收**：多文件项目可编译，格式化生效。
- **M3 图形化调试**：调试沙箱（放开 ptrace）、DAP 桥接 + 会话管理 + 三层超时、断点装饰 + 当前行高亮、调试面板、路径映射验证。**验收**：设断点 → 命中 → 看局部变量 → 单步 → 栈帧点击跳转。
- **M4 生产加固**：限流 + 并发信号量、审计日志 + 监控、沙箱 SIGSYS 告警。

每个里程碑内开发顺序：先写该模块的**沙箱/安全测试**（逃逸用例）→ 再写功能实现 → 最后写 UI → 通过验收再进下一阶段。

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

## 10. 验收测试（每个 PR 必须能回答）

**沙箱类**
- [ ] `while(1);` → TLE，宿主无残留进程
- [ ] `#include </etc/passwd>` → 编译失败
- [ ] `system("cat /etc/passwd")` → 看不到真实内容
- [ ] fork bomb → 被 `pids.max` 拦截
- [ ] 大量 `puts()` → 被输出上限拦截
- [ ] `socket(AF_INET,...)` → 失败（无网络）
- [ ] `-fplugin=/tmp/x.so` → 被白名单拒绝

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
