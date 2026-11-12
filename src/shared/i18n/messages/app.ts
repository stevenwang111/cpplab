/** Strings for one UI area. See ./common.ts for the slice contract. */

const zhCN = {
  // Seeded workspace
  'app.seed.projectName': '我的 C++ 项目',
  'app.seed.comment': '示例程序：排序后打印',

  // Boot screens
  'app.boot.connecting': '正在打开本地工作区…',
  'app.boot.loadFailed': '无法加载工作区',
  'app.boot.noProjectData': '项目数据不可用',

  // Toolchain
  'app.toolchain.detail': 'clang 编译为 WebAssembly 后在本机运行，首次编译需下载约 {mb} MB 工具链',

  // Editor area
  'app.editor.emptyFiles': '没有可编辑的文件',

  // Panel resizers
  'app.resizer.bottomHeight': '拖动调整底部面板高度',

  // Delete-file confirm
  'app.delete.fileTitle': '删除文件',
  'app.delete.fileMessage': '确定删除 {file}？该操作会从工作区移除文件，历史运行快照仍可恢复。',

  // Toasts
  'app.toast.compilerMissing': '{name} 不可用',
  'app.toast.entrySwitched': '入口文件已切换为 {file}',
  'app.toast.compileFailed': '编译失败，请查看问题面板',
  'app.toast.runDone': '运行完成 · {ms} ms',
  'app.toast.runEnded': '运行结束：{status}',
  'app.toast.alreadyFormatted': '代码已经符合格式要求',
  'app.toast.formatted': 'clang-format 已格式化当前文件',
  'app.toast.fileNotInWorkspace': '文件 {file} 不在当前工作区',
  'app.toast.deletedFile': '已删除 {file}',
  'app.toast.projectRenamed': '项目名称已更新',

  // Run phases
  'app.run.phase.preparing': '准备源码',
  'app.run.phase.prepare': '写入虚拟文件系统…',
  'app.run.phase.compiling': '浏览器内编译中…',
  'app.run.phase.linking': 'wasm-ld 链接中…',
  'app.run.phase.running': 'WASI 沙箱执行中…',
  'app.run.phase.finished': '运行结束',

  // Run notes appended to stderr
  'app.run.note.timeout': '[wasm] 超过 {ms} ms 时限，Worker 已终止。',
  'app.run.note.outputLimit': '[wasm] 输出超过 {kb} KiB 上限，已截断。',
  'app.run.note.memoryLimit': '[wasm] 超过 {mb} MiB 内存上限，模块增长失败。',
  'app.run.note.exitCode': '[wasm] 程序以退出码 {code} 结束。',
  'app.run.note.abort': '[wasm] 程序触发了 wasm trap（unreachable）：abort、断言失败或未捕获异常。',

  // Terminal lines
  'app.term.toolchain': 'clang · LLVM {llvm} · 首次运行按需下载 {mb} MB',
  'app.term.wasmSandbox': '{n} MiB 内存上限 · {ms} ms 时限 · 无文件系统 · 无网络',
  'app.term.compiling': 'clang（WebAssembly）正在编译…',
  'app.term.running': '已实例化 wasm 模块，stdout 通过 WASI fd_write 回传',
  'app.term.historyLoaded': '载入 {when} 的运行记录',
  'app.term.fileCreated': '已创建 {path}',

  // Error fallbacks
  'app.error.storageUnavailable': '浏览器本地存储不可用（IndexedDB 被禁用？）',
  'app.error.refreshProject': '刷新项目失败',
  'app.error.saveFailed': '保存失败',
  'app.error.updateSettings': '更新项目设置失败',
  'app.error.runRequestFailed': '运行请求失败',
  'app.error.formatFailed': '格式化失败',
  'app.error.formatUnavailable': '当前工具链未包含 clang-format，格式化暂不可用',
  'app.error.deleteFileFailed': '删除文件失败',
  'app.error.toolchainBootFailed': '无法加载 WebAssembly 工具链，请检查网络与响应头',
  'app.error.toolchainNotReady': '工具链尚未就绪',
  'app.error.toolchainTimeout': '{tool} 执行超时',
  'app.error.compileTimeout': '[wasm] 编译超时，已放弃本次构建。',
  'app.error.compileFailedNoOutput': '[wasm] clang 以退出码 {code} 结束，但没有输出任何诊断信息。',
  'app.error.linkFailedNoOutput': '[wasm] wasm-ld 以退出码 {code} 结束，但没有输出任何诊断信息。',
  'app.error.linkOutputMissing': '[wasm] 链接没有产出可执行模块。',
  'app.error.noSourceFiles': '没有可编译的 C++ 源文件（入口 {entry} 需要是 .cpp/.cc/.cxx）',
  'app.error.noFiles': '工作区没有文件',
  'app.error.tooManyFiles': '文件数量超过上限 {max}',
  'app.error.entryMissing': '入口文件 {entry} 不存在',
  'app.error.fileTooLarge': '文件 {file} 超过 256 KiB 上限',
  'app.error.runNotFound': '找不到该运行记录',
  'app.error.flagsInvalid': '编译参数格式不正确',
  'app.error.flagsTooMany': '编译参数最多 {max} 个',
  'app.error.flagInvalid': '参数 {flag} 不合法',
  'app.error.flagNotAllowed': 'WebAssembly 目标不支持参数 {flag}',
  'app.error.includeOutsideWorkspace': '头文件目录 {dir} 必须位于工作区内',
  'app.error.includeNameInvalid': '头文件目录 {dir} 名称不合法',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  'app.seed.projectName': 'My C++ Project',
  'app.seed.comment': 'Sample program: sort and print',

  'app.boot.connecting': 'Opening your local workspace…',
  'app.boot.loadFailed': 'Failed to load workspace',
  'app.boot.noProjectData': 'Project data unavailable',

  'app.toolchain.detail':
    'clang runs as WebAssembly on this device; the first compile downloads about {mb} MB of toolchain',

  'app.editor.emptyFiles': 'No editable files',

  'app.resizer.bottomHeight': 'Drag to resize the bottom panel',

  'app.delete.fileTitle': 'Delete file',
  'app.delete.fileMessage':
    'Delete {file}? This removes the file from the workspace; historical run snapshots can still restore it.',

  'app.toast.compilerMissing': '{name} is unavailable',
  'app.toast.entrySwitched': 'Entry file switched to {file}',
  'app.toast.compileFailed': 'Compilation failed, see the Problems panel',
  'app.toast.runDone': 'Run finished · {ms} ms',
  'app.toast.runEnded': 'Run ended: {status}',
  'app.toast.alreadyFormatted': 'Code already matches the required style',
  'app.toast.formatted': 'clang-format formatted the current file',
  'app.toast.fileNotInWorkspace': 'File {file} is not in the current workspace',
  'app.toast.deletedFile': 'Deleted {file}',
  'app.toast.projectRenamed': 'Project name updated',

  'app.run.phase.preparing': 'Preparing sources',
  'app.run.phase.prepare': 'Writing the virtual filesystem…',
  'app.run.phase.compiling': 'Compiling in your browser…',
  'app.run.phase.linking': 'Linking with wasm-ld…',
  'app.run.phase.running': 'Running in the WASI sandbox…',
  'app.run.phase.finished': 'Run finished',

  'app.run.note.timeout': '[wasm] Exceeded the {ms} ms limit; the worker was terminated.',
  'app.run.note.outputLimit': '[wasm] Output exceeded {kb} KiB and was truncated.',
  'app.run.note.memoryLimit': '[wasm] Exceeded the {mb} MiB memory ceiling; module growth failed.',
  'app.run.note.exitCode': '[wasm] The program exited with code {code}.',
  'app.run.note.abort': '[wasm] The program hit a wasm trap (unreachable): abort, assertion failure or uncaught exception.',

  'app.term.toolchain': 'clang · LLVM {llvm} · {mb} MB fetched on first run',
  'app.term.wasmSandbox': '{n} MiB memory ceiling · {ms} ms limit · no filesystem · no network',
  'app.term.compiling': 'clang (WebAssembly) is compiling…',
  'app.term.running': 'wasm module instantiated; stdout flows back through WASI fd_write',
  'app.term.historyLoaded': 'loaded run record from {when}',
  'app.term.fileCreated': 'created {path}',

  'app.error.storageUnavailable': 'Browser local storage is unavailable (is IndexedDB disabled?)',
  'app.error.refreshProject': 'Failed to refresh the project',
  'app.error.saveFailed': 'Failed to save',
  'app.error.updateSettings': 'Failed to update project settings',
  'app.error.runRequestFailed': 'Run request failed',
  'app.error.formatFailed': 'Formatting failed',
  'app.error.formatUnavailable': 'This toolchain build has no clang-format; formatting is unavailable',
  'app.error.deleteFileFailed': 'Failed to delete the file',
  'app.error.toolchainBootFailed': 'Could not load the WebAssembly toolchain; check network and response headers',
  'app.error.toolchainNotReady': 'The toolchain is not ready yet',
  'app.error.toolchainTimeout': '{tool} timed out',
  'app.error.compileTimeout': '[wasm] Compilation timed out; the build was abandoned.',
  'app.error.compileFailedNoOutput': '[wasm] clang exited with code {code} but produced no diagnostics.',
  'app.error.linkFailedNoOutput': '[wasm] wasm-ld exited with code {code} but produced no diagnostics.',
  'app.error.linkOutputMissing': '[wasm] The link step produced no executable module.',
  'app.error.noSourceFiles': 'No compilable C++ source (the entry {entry} must be .cpp/.cc/.cxx)',
  'app.error.noFiles': 'The workspace has no files',
  'app.error.tooManyFiles': 'More than {max} files',
  'app.error.entryMissing': 'Entry file {entry} does not exist',
  'app.error.fileTooLarge': 'File {file} exceeds the 256 KiB limit',
  'app.error.runNotFound': 'That run record could not be found',
  'app.error.flagsInvalid': 'Invalid compiler flag payload',
  'app.error.flagsTooMany': 'At most {max} compiler flags',
  'app.error.flagInvalid': 'Flag {flag} is not valid',
  'app.error.flagNotAllowed': 'The WebAssembly target does not support {flag}',
  'app.error.includeOutsideWorkspace': 'Include directory {dir} must stay inside the workspace',
  'app.error.includeNameInvalid': 'Include directory {dir} is not a valid name',
};

export default { 'zh-CN': zhCN, en };
