# AGENTS.md — 纯客户端 C++ IDE 开发约定

> 本文档是 AI 辅助开发的执行依据。若与代码冲突，先改文档再改代码。
> 形态：**纯静态站点，无后端**。`MUST` 条目不可协商；`可选` 条目默认不做。

## 0. 执行规则

1. 按 §8 里程碑顺序开发，每个阶段跑通验收再进入下一阶段，不要并行铺开。
2. §3「安全底线清单」是硬约束，任何简化都不得突破。
3. 生成代码时同时给出验证方式（如何在浏览器里手动确认这条路径）。
4. 未覆盖的决策点：小决策直接做并说明理由；涉及架构/安全的决策先提问。
5. 任何改动都必须能通过 `npm run typecheck && npm run build && npm run i18n:check`。

## 1. 项目目标与非目标

**做**：网页版 C++ 编辑 / 编译 / 运行工作台 —— 语法高亮、自动缩进、补全、多文件、诊断跳转、
stdin、运行历史；编译器本身以 WebAssembly 形式在浏览器内运行；执行结果按资源限额分类。

**本期不做**：图形化断点调试（无 DAP、无 lldb）；服务器端编译；多用户与账号体系；
OJ 批量评测；跨语言（只做 C++）；格式化（工具链无 clang-format，见 §9）；
`-pthread`、`-fsanitize`、可用的 C++ 异常展开（见 §2 的边界）。

## 2. 威胁模型与能力边界

攻击面从"宿主内核"变成了"页面里的一段 wasm"，需要防的是：

1. **越权访问**：用户程序试图读写工作区外的文件、访问网络、拿到宿主对象
2. **资源滥用**：死循环、把内存涨爆、无限输出拖垮标签页
3. **编译期攻击**：通过编译参数（`-fplugin`/`-wrapper`/`@file`）在编译阶段执行任意代码

**不再需要防御**：进程逃逸、提权、宿主文件系统、fork bomb —— 这些能力在 wasm 目标里不存在。

**能力边界（必须诚实对待，不要承诺做不到的事）**

| 能力 | 状态 | 原因 |
|---|---|---|
| 文件系统 | 只有 VFS | 运行器不实现 `path_*`，一律 `ENOSYS` |
| 网络 | 无 | 不实现 `sock_*` |
| 线程 `-pthread` | 不支持 | 需要模块内 SAB，需另一套 libc 构建 |
| `-fsanitize=*` | 不支持 | 需要额外运行时 bundle，固定工具链未包含 |
| C++ 异常展开 | 不支持 | 需要 emscripten JS unwinder，纯 wasm-ld 链接拿不到 |
| 时区 | UTC | `_tzset_js` 无数据 |
| clang-format | 未启用 | 不在 bundle 中，能力探测返回 false |

## 3. 安全底线清单（不可省略）

1. **编译器在 Worker 内运行**：不得为了"快"把编译搬到主线程或引入服务端。
2. **编译参数白名单**：`-D…`、`-I…`（仅工作区内）、`-DDEBUG`、`-DNDEBUG`；其余显式拒绝。
3. **输出上限在 `fd_write` 里**：不得改成"先攒完再截断"。
4. **时限靠终止 Worker**：不得依赖程序自己让出，也不得用 `setTimeout` 只做提醒。
5. **内存上限写在链接参数里**：`wasm-ld --max-memory`，不得只靠运行期判断。
6. **运行器只提供最小 import 表**：新增任何 wasm 导入都要在 PR 说明里论证，且不得暴露宿主对象。
7. **不缓存用户代码到远端**：存储只写 IndexedDB；唯一网络请求是固定 URL 的工具链 bundle。

## 4. 禁止事项

- ❌ 把用户输入拼进 shell 字符串（本项目根本没有 shell，出现即说明架构跑偏）
- ❌ 透传未校验的编译参数
- ❌ 引入服务端进程、socket、`fs` 访问
- ❌ 在主线程同步跑 clang（会冻结 UI）
- ❌ 用 `Promise.all` 并联"首次 seed"与"读取文件列表"（见 §9 坑 6）
- ❌ 跳过 §3 任何一条

## 5. 编译执行链路

### 5.1 流程

1. 校验请求（文件数 ≤16、单文件 ≤256 KiB、入口存在、flags 白名单）
2. `resetVfs()` → 逐个 `writeFile('/home/user/<path>')`
3. **编译**：每个翻译单元一次 `clang -cc1`，产物写 `/tmp/<name>.o`
4. 任一单元失败 → `CE` + 解析后的诊断
5. **链接**：`wasm-ld … -o /tmp/program.wasm`，带上内存上限
6. `getFile('/tmp/program.wasm')` → `ArrayBuffer` transfer 给运行 Worker
7. **运行**：实例化 → `__wasm_call_ctors` → `main`（或 `_start`）
8. 状态分类：见 §5.4

### 5.2 编译参数（MUST）

`clang -cc1` 只认 cc1 选项，不认驱动选项：

```
允许（我们生成）：
  -cc1 -triple wasm32-unknown-emscripten -emit-obj -O0..-O3/-Os
  -internal-isystem /usr/include/c++/v1 …  -resource-dir /usr/lib/clang/23
  -std=c++17|c++20|c++23  -ferror-limit 50  -fcxx-exceptions -fexceptions
允许（用户）：
  -D<标识符>[=值]   -I<工作区内相对路径>   -DDEBUG   -DNDEBUG
忽略：
  -lm（libm 在 libc 中）
拒绝（必须显式拦截）：
  -fplugin  -wrapper  @file  -specs=  -B  -Xclang  -include  -o  -fdiagnostics-format
  -fno-color-diagnostics  -ferror-limit=50（cc1 不接受 `=` 写法）
```

中间产物目录 MUST 用 `/tmp`：VFS 里只有 `/home/user` 与 `/tmp` 存在，clang 不会自己建目录。

### 5.3 资源限制（MUST）

| 维度 | 手段 | 取值 |
|---|---|---|
| 墙钟超时 | 主线程 `worker.terminate()` | 2 s 默认，200 ms–10 s |
| 内存 | `wasm-ld --max-memory` + `emscripten_resize_heap` 拒绝越界增长 | 256 MiB 默认，64–512 |
| 输出 | `fd_write` 累计字节 | 64 KiB |
| 输入 | stdin 字符串长度 | 1 MiB |
| 文件 | 请求校验 | 16 个 / 256 KiB |

上限是**双层**的：链接期限制模块能长多大，运行期 `emscripten_resize_heap` 决定允不允许长。

### 5.4 状态分类

| 状态 | 判据 |
|---|---|
| `OK` | `main` 返回 0 |
| `CE` | 某次 `clang` 退出码非 0 |
| `RE` | `main` 返回非 0，或 trap 且不是内存原因 |
| `TLE` | 主线程计时器触发，Worker 被 terminate |
| `MLE` | `heapExhausted` 为真（`emscripten_resize_heap` 拒绝过增长），或堆顶 trap |
| `OLE` | `fd_write` 计数越界 |
| `IE` | 模块编译/实例化失败、Worker 崩溃 |

## 6. 运行器实现要点

- **WASI 只实现必要项**：`fd_write`/`fd_read`/`fd_close`/`fd_seek`/`fd_fdstat_get`/
  `environ_*`/`args_*`/`clock_time_get`/`random_get`/`proc_exit`。
- **`env` 命名空间必须实现** `emscripten_resize_heap`：dlmalloc 靠它扩堆，缺了就把程序钉死在初始内存。
  `_abort_js` 抛 `AbortTrap`，`__cxa_throw` 抛带说明的 `AbortTrap`，`_tzset_js` 空实现（UTC）。
- **`proc_exit` 用异常实现**，不要试图 `return` 回去。
- **每次运行新建 Worker**：这是唯一干净的 TLE 手段，也保证不会串状态。
- **trap 分类要能解释给用户**：`unreachable` 就是 abort，输出面板要附人话说明。

## 7. 非功能需求

| 项 | 要求 |
|---|---|
| 首次加载 | 工具链 bundle 约 41 MB brotli，必须走缓存，不得每次编译重下 |
| 工具调用 | **串行**：一个 Worker 一次只跑一个进程，并发会互相踩 VFS |
| 预热 | 空闲时 `requestIdleCallback` 预热；有真实编译在等时 MUST 让位 |
| 请求大小 | 源码 ≤256 KiB，stdin ≤1 MiB，文件数 ≤16 |
| 存储 | 运行历史裁剪到 60 条；项目/文件/历史都在 IndexedDB |
| 文案 | 所有面向用户的字符串走 `src/shared/i18n`，zh-CN 与 en 必须键位一致 |

## 8. 里程碑

- **M1 编译运行闭环**：Worker 启动 + clang/wasm-ld + WASI 运行 + 诊断。**验收**：排序程序打印正确结果。
- **M2 IDE 体验**：多文件、stdin、历史、格式化能力探测、双语界面。**验收**：多文件项目可编译运行。
- **M3 限额与分类**：TLE/OLE/MLE/RE 全部可触发且分类正确。**验收**：四条用例各自命中预期状态。
- **M4 托管就绪**：COOP/COEP、coi 兜底、静态部署验证、文档与截图。**验收**：`dist/` 直接托管可编译运行。

## 9. 已知坑清单（都是踩过的）

| # | 坑 | 规避 |
|---|---|---|
| 1 | 把驱动选项塞进 `-cc1` | `-fdiagnostics-format`/`-fno-color-diagnostics`/`-ferror-limit=50` 会被拒，编译 20 ms 就退出 |
| 2 | `-o` 指向不存在的目录 | VFS 只有 `/home/user` 和 `/tmp`，产物一律写 `/tmp` |
| 3 | Worker 流式回调是按行的 | chunk 之间要补 `\n`，否则所有诊断粘成一行、解析全废 |
| 4 | 不实现 `emscripten_resize_heap` | 堆永远停在 16 MiB，任何真实分配都 abort 成 RE |
| 5 | `main` 返回值被丢掉 | 一律 `emit exit code: Number(main())`，否则 `return 7` 会被当成通过 |
| 6 | `Promise.all` 并行 seed 与读文件 | 首次访问文件列表为空、Monaco 不挂载；必须串行 |
| 7 | 包内 `sideEffects: false` 把 worker 入口 tree-shake 成 0 字节 | Vite 插件在 `moduleParsed` 里改 `moduleSideEffects`，且要注册进 `worker.plugins` |
| 8 | 预热与用户编译并发 | 两个 clang 进程抢同一 VFS，还会加载两份 21 MB 模块；工具调用必须加锁 |
| 9 | 忘记 COOP/COEP | `crossOriginIsolated === false`，SAB 不可用；dev/preview 已在 vite 配置里设好 |
| 10 | 假设 `clang-format` 可用 | 它会以 127 退出；走能力探测，UI 明说不可用 |
| 11 | 用 `catch` 兜 `__cxa_throw` | 该目标没有 unwinder，抛异常必然终止；不要承诺 try/catch 能工作 |

## 10. 验收测试（每个 PR 必须能回答）

**编译类**
- [ ] 单文件排序程序 → `OK`，stdout 正确
- [ ] `main.cpp + lib.cpp` 多文件 → 链接成功
- [ ] 类型错误 → `CE`，"问题"面板有行号且可跳转
- [ ] 写 `/home/user/x.o` 之类的越界产物路径 → 不出现（产物固定 `/tmp`）

**限额类**
- [ ] `while(true)` → `TLE`，且下一次运行不受影响
- [ ] `while(1) cout << …` → `OLE`，在 64 KiB 截断
- [ ] 8 MiB 分块分配直到堆顶 → `MLE`
- [ ] `return 7` → `RE`，附退出码说明

**边界类**
- [ ] `-fplugin=/tmp/x.so` → 白名单拒绝
- [ ] `#include "/etc/passwd"` → 编译失败（VFS 里没有）
- [ ] `socket()` → 失败或 `ENOSYS`
- [ ] 刷新页面 → 项目、文件、stdin、历史都在

**文档类**
- [ ] README 与 README-zh_CN 的功能列表与代码一致
- [ ] 截图来自当前构建，不含已删除的功能
