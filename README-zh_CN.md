# CppLab · 在线 C++ IDE

一个完全跑在浏览器标签页里的 C++ 编辑 / 编译 / 运行工作台。clang 本身被编译成 WebAssembly，
编辑器通过 Worker 与它通信，产出的 `.wasm` 再由手写的 WASI 层执行。**没有后端**：不上传代码、
不在服务器上执行任何东西，整站是纯静态资源。

> **English**: [README.md](README.md)

![CppLab 首页](docs/screenshots/home.png)

## 功能

- **编辑**：Monaco Editor，C++ 高亮、括号匹配、自动缩进、折叠、minimap、snippet 补全；
  自动保存到 IndexedDB（700 ms 防抖）并支持本地撤销。
- **多文件**：文件标签、新建 / 删除 / 切换入口文件，每个翻译单元生成一个目标文件，最后统一链接。
- **编译与运行**：`wasm32-unknown-emscripten` 目标上的 clang++ 语义，C++17/20/23，
  `-O0…-O3`/`-Os`，编译参数白名单，stdin，stdout/stderr 流式输出。
- **诊断**：解析 clang 的 `file:line:col: error:`，进“问题”面板并映射成 Monaco 标记，点击跳转。
- **资源限制**：内存上限在链接期写进模块，时限靠终止 Worker，输出逐次写入计数；
  结果分类为 `OK / CE / RE / TLE / MLE / OLE / IE`。
- **运行历史**：保留最近 60 次运行的源码快照、stdin、输出与状态，可一键还原。
- **双语界面**：客户端与工具链层共用一套文案，阶段提示、限制说明、错误信息与界面同语言。
  首次访问跟随浏览器语言，随时可在 设置 → 语言 切换。
- **无网络、无文件系统**：运行器只拿到 fd 0/1/2、argv、时钟和随机源；`sock_*`、`path_*`
  一律返回 `ENOSYS`。

## 快速开始

环境：Node.js ≥ 22.5（开发服务器与构建）；支持 WebAssembly 的现代浏览器。若浏览器提供
SharedArrayBuffer（即 `crossOriginIsolated`），stdin 通道会优先使用它。

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

生产构建与本地预览：

```bash
npm run build      # tsc --noEmit + vite build → dist/
npm start          # vite preview，http://127.0.0.1:4173
```

`dist/` 就是普通静态站点，可直接丢到任意静态托管。首次编译会从 `cdn.jsdelivr.net` 拉取固定版本的
工具链（约 41 MB brotli，浏览器缓存 + 工具链 VFS 缓存），之后离线可用。

### 跨源隔离响应头

工具链的 stdin 通道偏好 SharedArrayBuffer，建议给站点加上：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`vite dev` 与 `vite preview` 已自动发送。若托管环境无法设置响应头，应用会在首次加载时注册
`coi-serviceworker` 并重载一次；若浏览器仍报告 `crossOriginIsolated === false`，编译照常工作，
仅交互式 stdin 会降级。

## 架构

```text
主线程（React + Monaco + IndexedDB）
  ├─ api.ts             本地门面：项目 / 文件 / 格式化 / 运行 / 历史
  ├─ wasm/toolchain.ts  启动 + 预热 + 编译流水线（工具调用串行化）
  │     └─ Worker: @gameguild/emception-browser → clang、wasm-ld（LLVM 23.0.0git）
  └─ wasm/run/runner.ts 每次运行一个 Worker：实例化 + WASI 层 + 限额
```

每个翻译单元的编译链路：

```text
clang -cc1 -triple wasm32-unknown-emscripten -emit-obj … -o /tmp/main.o /home/user/main.cpp
wasm-ld /tmp/main.o -o /tmp/program.wasm --entry=main --initial-memory=… --max-memory=…
```

随后把链接结果转移到运行 Worker，用 WASI import 对象实例化，依次调用 `__wasm_call_ctors` 与 `main`。

### 目录结构

```text
src/client:
  App.tsx                 工作台状态与交互
  api.ts                  工具链、存储与运行流水线的本地门面
  capabilities.ts         clang 版本、跨源隔离状态、限额
  wasm/constants.ts       固定 manifest 地址、工作区路径、bundle 清单
  wasm/flags.ts           cc1 / wasm-ld 参数拼装 + 编译参数白名单
  wasm/diagnostics.ts     clang 诊断解析
  wasm/toolchain.ts       Worker 启动、工作区同步、编译与链接
  wasm/toolchain.worker.ts  Worker 入口（引入 emception 的 worker 运行时）
  wasm/run/protocol.ts    运行器消息类型
  wasm/run/runner.worker.ts WASI 实现与 trap 分类
  wasm/run/runner.ts      单次运行监管：Worker 生命周期、TLE、输出预算
  wasm/isolation.ts       COOP/COEP 检查 + coi-serviceworker 兜底
  storage/db.ts           IndexedDB：project / files / runs
  components/             TopBar、编辑器、底部面板、历史抽屉、弹窗
  editor/monaco.ts        主题、C++ snippet、语言配置
  styles/app.css          LeetCode 风格视觉系统

src/shared:
  types.ts                UI、编译层、运行层共享的类型
  i18n/                   文案目录（zh-CN / en）
```

## 资源限制

| 维度 | 默认值 | 实现方式 |
|---|---|---|
| 墙钟时限 | 2 s（200 ms – 10 s） | 主线程 `worker.terminate()` → `TLE` |
| 内存 | 256 MiB（64 – 512 MiB） | `wasm-ld --max-memory`，超限增长失败 → `MLE` |
| 输出 | 64 KiB | `fd_write` 中计数 → `OLE` |
| 文件 | 16 个，单个 256 KiB | 编译前校验请求 |
| stdin | 1 MiB | 边界截断 |

限额存放在 `localStorage`（`cpplab.runLimits`），并在 `api.ts` 里再夹一次范围。

## 安全模型

架构变了，威胁模型也随之变化：用户代码不再到达任何服务器，问题从“能否逃出沙箱”变成
“一个 `.wasm` 模块在 Worker 里能碰到什么”。

1. **编译器天然沙箱化**：clang 是跑在 Worker 里的 WebAssembly 模块，带虚拟文件系统，
   只能打开 IDE 写入的文件。
2. **运行器由 import 表决定能力**：模块只能拿到我们提供的导入——三个文件描述符、argv、
   `clock_time_get`、`random_get`、`proc_exit`；其余 `wasi_snapshot_preview1` 项
   （`path_open`、`sock_connect` 等）统一返回 `ENOSYS`。
3. **运行器里根本不存在文件系统和网络解析器**：没有“逃出去的目的地”，也没有交给用户代码任何宿主对象。
4. **输出在写入那一刻封顶**：`fd_write` 计字节，越界立即以 `OLE` 终止，缓冲区涨不起来。
5. **内存在链接期封顶**：`--max-memory` 让增长在模块内部失败，页面堆不会被程序拖垮。
6. **时限靠杀掉 Worker**：`while(true)` 没有别的打断方式；每次运行都用新 Worker，状态也不会带到下一次。
7. **编译参数是白名单，不是透传**：`-D…`、`-I…`（仅限工作区内）、`-DDEBUG`、`-DNDEBUG`；
   `-lm` 静默忽略（libm 已在 libc 中）。`-fplugin`、`-wrapper`、`@file`、`-specs=`、`-B`
   这类驱动期选项在 `-cc1` 命令行上没有意义，直接拒绝。
8. **存储留在本地**：项目、文件、历史都在 IndexedDB。应用唯一的网络请求是按固定地址下载工具链 bundle。

已知且被接受的限制：

- 页面无法收回自身能力，因此 wasm 模块与同源页面共享存储配额。设计上没有让用户代码触及其它源的路径，
  但失控模块仍可能在内存天花板生效前把磁盘配额写满。
- 不支持 `-pthread`（需要模块内启用 SharedArrayBuffer，得换一套 libc 构建）；
  `-fsanitize=…` 需要额外运行时 bundle，固定工具链里没有。
- C++ 异常无法展开：该目标需要 emscripten 的 JS unwinder，而纯 `wasm-ld` 链接拿不到。
  抛出异常会以一条明确的信息终止。

## 已知问题

- **格式化功能关闭**：`clang-format` 不在固定工具链 bundle 中，能力探测返回 false，
  按钮会直接说明原因而不是静默失败。要开启需在工具链 manifest 里加一个 bundle。
- `tzset` 没有时区数据，`localtime` 实际按 UTC 运行。
- 默认时限 2 s 是评测风格默认值，较重的程序请在设置里调大。
- 拿不到 `SharedArrayBuffer` 时，交互式 stdin 会退化为“输入到底”。

## 测试

```bash
npm run typecheck    # tsc --noEmit
npm run build
npm run i18n:check   # zh-CN 与 en 键位、占位符完全一致；src/scripts 内无漏翻中文
npm run i18n:ui      # 对运行中的预览起 headless Chromium：英文页无中文、切换生效、刷新后保持
```

`npm run i18n:ui` 默认访问 `http://127.0.0.1:4173`，可用 `BASE_URL=…` 覆盖。

手工验收清单（2.0 发布前均在 Chromium 中端到端跑过）：

```text
✓ std::vector 排序程序输出 "sorted: 3 10 17 24 31 38 45 52"
✓ 多文件项目（main.cpp + lib.cpp）链接成功并输出 total=10
✓ 类型错误 → CE，“问题”面板列出 main.cpp:4:9，点击跳转到该行
✓ std::cin 从“输入”面板读取数据
✓ while(true) → 到达时限后 TLE
✓ 无限输出 → OLE，在 64 KiB 处截断
✓ 每次 8 MiB 分配直到堆顶 → MLE
✓ return 7 → RE，并附退出码说明
```

## 快捷键

| 快捷键 | 动作 |
|---|---|
| `Ctrl/⌘ + Enter` | 编译并运行 |
| `Ctrl/⌘ + S` | 立即保存 |
| `Ctrl/⌘ + Shift + F` | 格式化（当前工具链会提示不可用） |

## 参考资料

- [docs/wasm-client-only-feasibility.md](docs/wasm-client-only-feasibility.md)：为什么选这条路、
  代价是什么、旧的服务端设计哪些部分被保留
- [AGENTS.md](AGENTS.md)：改这份代码（人或 agent）必须遵守的边界与约束

## 许可证

[MIT](LICENSE)
