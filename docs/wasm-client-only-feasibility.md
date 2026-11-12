# 纯客户端 WebAssembly 实现的可行性分析

> 分支：`analysis/pure-client-wasm`
> 前提：按讨论约定，**如果没有调试功能就算了** —— 即"编辑 + 编译 + 运行"可接受，"断点/单步/变量"可不做。
> 结论先行：**编译和运行都能纯客户端做，而且比现在的服务端方案更干净；自带 UI 的源码级调试做不了。去掉调试后这个改造是成立的。**

## 1. 去掉服务端意味着要重新实现什么

现有架构把五件事放在 Node 里：编译、运行、调试、格式化、持久化。纯客户端方案逐项对应：

| 能力 | 现状 | 纯客户端替代 | 难度 |
|---|---|---|---|
| 编译 | nsjail 内 g++/clang++ | clang 编译成 WebAssembly，在 Worker 里跑 | 中（有现成方案） |
| 运行 | nsjail 内执行 ELF | 编译产物是 wasm，浏览器直接执行 | **低**（比现状简单） |
| 调试 | nsjail 内 lldb-dap + DAP over WS | 无成熟方案 | **不可行** |
| 格式化 | nsjail 内 clang-format | clang-format.wasm（同源可编） | 低 |
| 持久化 | SQLite | IndexedDB / OPFS | 低 |

关键洞察：**"运行"在纯客户端方案里不是难点而是红利**。用户代码被编译成 wasm 之后，它本身就跑在浏览器的 wasm 沙箱里——没有 syscall、没有文件系统、没有网络，只有你显式提供的导入函数。nsjail、cgroup、seccomp、setuid 那一整套（以及它们的维护成本）全部消失，换成浏览器自带的沙箱。

## 2. 编译：可行，代价是 payload

### 2.1 已有成熟实现

`emception`（原 `jprendes/emception`，现由 GameGuild 维护为 `@gameguild/emception-toolchain`）把 clang / lld / binaryen / emcc 全部编译成 WASM，在浏览器里构建了一个微内核：每个工具是独立 wasm 进程，TypeScript 内核负责 VFS、IPC、调度，系统头文件从 CDN 懒加载，用户文件存 IndexedDB。提供 React 19 适配器（`@gameguild/emception-react`）、Web Component、xterm 适配器，也有无 UI 的 headless API。

### 2.2 实测体积（从 CDN manifest 解析，非估算）

| 项 | 值 |
|---|---|
| 工具链版本 | emsdk 5.0.7 · LLVM **23.0.0git** · binaryen 129 |
| npm 包 | `@gameguild/emception-toolchain@4.5.2`，解包 107.7 MB |
| `clang.wasm` | **109.8 MB**（brotli 传输 21.5 MB） |
| `lld.wasm` | **54.9 MB**（brotli 传输 11.7 MB） |
| 系统头文件 | 2.6 MB + 0.4 MB |
| libc++ 变体库 | 4.6 MB |
| crt / core | 2.7 MB |
| **编译+链接 C++ 到 wasm 的最小必需集合** | **≈ 40.9 MB（brotli 传输）** |
| 全套工具链（含 CPython、emcc、CMake、Ninja、SDL3、raylib） | 104.1 MB / 解压 796 MB |
| 可选：sanitizer 变体 | 1.7 MB |
| 可选：debug 变体库 | 7.9 MB |

也就是说：**LLVM 23 意味着 C++17/20/23 都没问题**（比现在服务器上的 g++ 还新），但首次编译要拉 41 MB。这是整个方案最大的产品代价，而不是技术障碍。

好在它是**按需分批**的：manifest 驱动，第一次点"运行"才下载 clang，用到链接才下 lld，头文件按 `#include` 懒取。可以做成"预热"策略（进入页面空闲时预取），把首编延迟藏起来。

### 2.3 两条路线

**路线 A：直接接 emception（推荐先做）**

- 优点：不用自己维护 LLVM 构建链；多文件、CMake、sanitizer 都已支持；LLVM 版本跟着上游走。
- 缺点：104 MB 全量里 60 MB 你用不上；编译目标是 emscripten，运行时要靠它的顶层运行时；跨源隔离要求要实测。

**路线 B：自建裁剪版 llvm-box**

只保留 clang + lld，只开 `wasm32` 一个 backend，关掉 OpenMP/其它 target/无用组件。经验上 wasm 体积可以从 165 MB 压到 40–60 MB（brotli 后 10–15 MB 量级），且目标 triple 可以选 `wasm32-wasi` —— 产物是标准 WASI 模块，JS 侧只要一个 ~200 行的 WASI shim（`fd_read`/`fd_write`/`proc_exit`/`clock_time_get`/`random_get`）就能跑，不依赖任何框架。
- 优点：体积小 3–4 倍；运行时你自己完全掌控；可以只暴露你要的导入函数（安全性最干净）。
- 缺点：要自建并长期维护 LLVM 交叉编译（一次构建数小时，随 LLVM 升级重做）。

**路线 C：不做真编译**（仅供排除）

用源码解释器或 cpp 子集编译器（如 tcc wasm）——tcc 只支持 C，不支持 C++；CINT/cling 依赖 JIT，无 wasm 版本。对 C++ 不成立。

### 2.4 要注意的编译器能力差异

现有白名单里的这些选项在 wasm 下语义会变，需要重新划：

| 选项 | wasm 下 |
|---|---|
| `-pthread` | 需要 SharedArrayBuffer + COOP/COEP 跨源隔离；算法题基本不用，建议禁用 |
| `-fsanitize=address/undefined` | emception 提供了 sanitizer 变体库（1.7 MB），可用；自建路线要额外编 |
| `-O0..-O3 / -Os` | 正常 |
| `-D` / `-I` | 正常（`-I` 仍限制在工作目录内） |
| `-lm` | 无意义（libm 在 libc 里），静默忽略即可 |

## 3. 运行：比现状更简单

- 编译产物是 wasm 模块，`WebAssembly.instantiate` 即可跑；stdout/stderr 通过 WASI `fd_write` 导入接到 JS 回调，stdin 通过 `fd_read` 从一个 JS 字符串喂。
- **资源限制天然可得**：
  - 内存：`WebAssembly.Memory({ initial, maximum })` —— `maximum` 是硬上限，超了直接 trap，等价于现在的 `MLE`。
  - 时间：跑在独立 Worker 里，`worker.terminate()` 就是 TLE，精度在几十毫秒级，比现在的进程组 kill 干净得多（没有孤儿进程这回事）。
  - 输出：JS 侧计数即可，等价 `OLE`。
  - 崩溃：捕获 `RuntimeError`（含 `unreachable` / `memory access out of bounds`）→ `RE`。
- **不需要指令计数**。真要精确 TLE 可以做 wasm 插桩（在每个循环回边计数），但收益不大，先不做。

## 4. 调试：这是决定项，答案是"做不了"

按你给的条件，这一节只需要论证"确实做不了"，而不是想办法做。

### 4.1 浏览器里唯一的成熟源码级调试路径不可嵌入

Chrome DevTools 确实支持 wasm 源码级调试：编译时带 `-g` 生成 DWARF custom section，装 "C/C++ DevTools Support (DWARF)" 扩展后，可以在 Sources 面板里对 C++ 源码下断点、单步、看带名字和类型的局部变量（Firefox 近期也内置了 DWARF 支持）。

但这套东西**只能发生在浏览器自己的 DevTools 里**。一个网页无法把自己的执行流交给自己的 DevTools 并从中取回栈帧和变量——那是调试器对调试器的操作。所以这条路能给你"用户按 F12 自己调"，给不了"IDE 内置调试面板"，而后者才是这个项目的形态。

（JetBrains 的 Hexana 能做 wasm 单步，是因为它是桌面 IDE，从外部用 CDP 驱动一个 Chromium 实例。）

### 4.2 想在自有 UI 里单步 = 自己写 wasm 解释器

核心限制：**浏览器不能中断/单步已经 JIT 编译好的 wasm**。没有 stepping API，没有断点指令。要做单步，只有一条路：不用 `WebAssembly.instantiate` 的本地执行，改用**自己实现的 wasm 解释器**逐条解释字节码，再配一个 DWARF 解析器把 wasm 偏移映射回源码行、把栈上的值映射回变量名和类型。

- 这条路有先例：`WasmInspect`（解释执行 + DWARF，支持断点/单步/内存查看/完整 WASI），**2020 年 5 月后停止维护**。
- 工作量：一个正确覆盖 WASM 核心规范（+ 你编译出来的模块会用到的 SIMD/异常/GC 子集）的解释器约 1.5 万行；DWARF 4/5 的 `.debug_info`/`.debug_line`/`.debug_loc` 解析约 1 万行；再加上表达式求值、类型渲染、变量树懒加载。**保守估计 3–5 人月**，而且性能掉 10–50 倍（解释执行 vs JIT），算法题里跑个百万级循环就会明显卡。
- 还要求编译器产出的 DWARF 与解释器的偏移计算严格对齐——LLVM 每次升级都可能打破这个假设。

### 4.3 lldb 编译成 wasm 不成立

lldb-dap 依赖 ptrace 等价物、进程控制、socket、动态库加载。浏览器里没有这些，wasm 化 lldb 不是"还没人做"，而是缺语义基础。

### 4.4 商业替代品 CheerpX

Leaning Technologies 的 CheerpX 用 x86→wasm 虚拟化在浏览器里跑完整 Linux，自带 gdb，可以真调试。但：商业授权、镜像体积更大、且你是把"沙箱"换成了一个黑盒 VM——安全性和可控性都不如原生 wasm。对本项目是过度方案。

### 4.5 结论

| 方案 | 自有 UI 内断点/单步 | 可行性 |
|---|---|---|
| Chrome DevTools + DWARF 扩展 | 否（在 DevTools 里） | 现成但形态不符 |
| 自写 wasm 解释器 + DWARF | 是 | 3–5 人月 + 性能损失，不划算 |
| lldb 编译成 wasm | — | 不成立 |
| CheerpX | 是 | 商业授权，过重 |

**所以：纯客户端 + 内置调试 = 不作考虑。** 你的预设条件（没有调试就算了）正好把方案从"不可行"变成"可行"。

## 5. 对现有代码的改造量

| 动作 | 内容 | 行数 |
|---|---|---|
| 删除 | `src/server/**` 全部（含 nsjail 配置、DAP 会话、SQLite） | −3,639 |
| 删除 | `src/client/debug/dapClient.ts`、`components/DebugPanel.tsx`、`App.tsx` 中的调试管线 | −约 1,100 |
| 删除 | `scripts/setup-sandbox.sh`、`security-test.mjs`、`security-ensure-rootfs.mts`、`tests/sandbox`、`tests/debug` | −约 555 |
| 保留 | `src/shared/**`（types + i18n 全量，391 key 直接复用） | 1,329 |
| 保留 | Monaco 编辑器、FileTabs、HistoryDrawer（改数据源）、SettingsPopover、ToastStack、BottomPanel、StatusBar | 约 4,500 |
| 改写 | `App.tsx` 的 run 管线、`api.ts` → 本地编译/运行调度 | 约 700 |
| 新增 | 编译 Worker（emception 封装 + VFS 映射 + 编译参数拼装） | 约 400–600 |
| 新增 | 运行器（instantiate + WASI shim + 资源限额 + Worker 生命周期） | 约 300–500 |
| 新增 | 存储层（OPFS/IndexedDB 取代 SQLite，含历史快照） | 约 200 |

净效果：**删掉约 5,300 行，新增约 1,500 行**。项目从"前后端 + 系统级沙箱"变成一个纯静态站点，构建产物只有前端。

`AGENTS.md` 的 §2 威胁模型、§3 七条安全底线、§5 编译执行链路全部失效——不是被违反，是不再适用。需要重写为：威胁模型 = "恶意 C++ 代码试图耗尽浏览器资源或读取宿主页面数据"，对策 = wasm 沙箱 + Worker 隔离 + 不暴露任何危险导入 + CSP。

## 6. 体验与工程代价

| 项 | 影响 |
|---|---|
| 首编延迟 | 首次点运行要拉 ≈41 MB（brotli）+ 实例化 165 MB wasm，估计 10–30 s（网络好时可能更快）。之后走 Cache Storage，接近 0。**这是最大的体验倒退** |
| 编译速度 | wasm 版 clang 比原生慢约 3–5 倍（非实测，按 wasm 通用开销估计）。百行级代码几百毫秒，几千行带 STL 可能数秒 |
| 部署 | 纯静态，可放对象存储/CDN，零服务器成本，**Windows/macOS/Linux/手机/iPad 全部可用**（现状是只能 Linux） |
| 跨源隔离 | emception 的错误类型里有 `CrossOriginIsolationError`，说明存在需要 COOP/COEP（SharedArrayBuffer）的路径。**静态托管必须能自定义响应头**；GitHub Pages 不支持，需要 `coi-serviceworker` 之类的 worker 注入方案兜底，且这是必须实测的第一件事 |
| 包体 | 现有 Monaco 主 chunk 3.71 MB 的问题要顺手解决（`import * as monaco` 改成 editor.api + 只注册 cpp），否则"静态站"首屏依旧重 |
| 交互式 stdin | 现在的 Run 支持 stdin；纯客户端要自己把输入面板接到 WASI `fd_read`，不难但要想清楚"程序阻塞等待输入"时的 UI 状态 |
| 多文件 | clang 逐文件编 `.o` 再 `wasm-ld` 链接，和现在多文件逻辑一致 |
| 安全 | 比现状严格更好：没有 setuid nsjail，没有宿主进程，恶意代码最多耗掉一个 Worker 的内存和时间 |

## 7. 建议的推进方式

**方案一（推荐）：纯客户端，砍掉调试，分三步走**

1. **验证性 Demo（1–2 天）**：单文件 `main.cpp` → emception 编译 → 跑起来打印 stdout。同时验证 COOP/COEP 和首编耗时。这一步不成功就别往下走。
2. **替换运行链路（3–5 天）**：接入 Worker、资源限额、状态分类（CE/TLE/OLE/RE）、多文件、格式化、stdin。把 `src/server` 删掉，历史改 OPFS。
3. **收尾（2–3 天）**：Monaco 按需引入、预热策略（`requestIdleCallback` 预取 clang bundle）、i18n 复用、CI（tsc + 前端 e2e）。

**方案二：混合模式（客户端编译运行 + 需要调试时才连服务端）**

保留 `src/server/**` 的 debug 部分，客户端发现用户点"调试"时才去连后端 lldb。优点是什么都不丢；缺点是两套执行链、两套构建产物、两套失效模式，维护成本比现在更高。除非调试是硬需求，否则不建议。

**方案三：不做。** 如果这个项目的主要价值就是"能图形化调试 C++"，那纯客户端化等于把核心卖点砍了，不如维持现状继续加固服务端。

## 8. 判断

- **技术上**：编译、运行、格式化都能纯客户端做，且有现成可用的工具链。唯一真正过不去的是"自带 UI 的源码级调试"。
- **产品上**：纯客户端换来的最大收益不是"省一台服务器"，而是**跨平台 + 零部署 + 没有 setuid nsjail 这个定时炸弹**；代价是首编 41 MB 和丢失调试。
- **所以**：如果目标是算法练习场 / 教学演示 / 内网之外的人也能用，这个改造值得做，做完的项目比现在更容易维护（少 3,600 行服务端和整套沙箱运维）。如果目标是替代真正的 IDE 调试体验，别做。

## 附：数据来源

- npm registry `@gameguild/emception-toolchain@4.5.2`：`dist.unpackedSize` = 107.7 MB
- 该包 `cdn/manifest.json`（jsDelivr 取回，3.5 MB）：`bundles` 各项 `size` 字段、`files` 各项 `size` 字段、`toolVersions`
- `docs/` 与公开资料：Chrome DevTools + C/C++ DWARF 扩展的 wasm 源码级调试能力；WasmInspect 停更时间；CheerpX 的 x86 虚拟化 + gdb 方案
