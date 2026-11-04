/** Strings for one UI area. See ./common.ts for the slice contract. */

const zhCN = {
  // Boot screens
  'app.boot.connecting': '正在连接本地沙箱…',
  'app.boot.loadFailed': '无法加载工作区',
  'app.boot.noProjectData': '项目数据不可用',

  // Sandbox banner
  'app.banner.sandboxNotReady': '沙箱未就绪：',
  'app.banner.sandboxNoNsjail': 'nsjail 不可用',
  'app.banner.sandboxHint': '。运行与调试已禁用，请先执行',
  'app.banner.sandboxSuffix': '。',

  // Editor area
  'app.editor.emptyFiles': '没有可编辑的文件',

  // Panel resizers
  'app.resizer.bottomHeight': '拖动调整底部面板高度',
  'app.resizer.debugWidth': '拖动调整调试侧栏宽度',

  // Delete-file confirm
  'app.delete.fileTitle': '删除文件',
  'app.delete.fileMessage': '确定删除 {file}？该操作会从工作区移除文件，历史运行快照仍可恢复。',

  // Toasts
  'app.toast.compilerMissing': '{name} 未安装',
  'app.toast.entrySwitched': '入口文件已切换为 {file}',
  'app.toast.compileFailed': '编译失败，请查看问题面板',
  'app.toast.runDone': '运行完成 · {ms} ms',
  'app.toast.runEnded': '运行结束：{status}',
  'app.toast.runDisconnected': '运行连接中断，未能取回结果',
  'app.toast.alreadyFormatted': '代码已经符合格式要求',
  'app.toast.formatted': 'clang-format 已格式化当前文件',
  'app.toast.needPaused': '程序暂停后才能执行该操作',
  'app.toast.watchExists': '该监视表达式已存在',
  'app.toast.fileNotInWorkspace': '文件 {file} 不在当前工作区',
  'app.toast.deletedFile': '已删除 {file}',
  'app.toast.projectRenamed': '项目名称已更新',

  // Run status line
  'app.run.waitingSlot': '等待编译槽位',

  // Terminal lines
  'app.term.sandboxRootfs': '只读 rootfs',
  'app.term.sandboxNoNetwork': '无网络',
  'app.term.sandboxMemory': '{n} MiB 内存',
  'app.term.sandboxTimeLimit': '{n} ms 时限',
  'app.term.compiling': 'g++ 正在沙箱内编译…',
  'app.term.historyLoaded': '载入 {when} 的运行记录',
  'app.term.fileCreated': '已创建 {path}',
  'app.term.debugSessionCreated': 'lldb-dap 会话 {id} 已创建',
  'app.term.debugSessionStopped': '会话已停止',

  // Debug console
  'app.debug.paused': '已暂停：{reason}',
  'app.debug.continued': '继续运行',
  'app.debug.ended': '调试结束',
  'app.debug.endedWith': '调试结束：{reason}',
  'app.debug.programExited': '程序退出，退出码 {code}',
  'app.debug.compilingTarget': '正在编译调试目标（-g -O0）…',
  'app.debug.lldbStarted': 'lldb-dap 已启动 · {cwd} · 编译 {ms} ms',
  'app.debug.sessionStopped': '调试会话已停止',
  'app.debug.restarted': '重新启动调试目标',

  // Error fallbacks
  'app.error.backendUnreachable': '无法连接后端服务',
  'app.error.refreshProject': '刷新项目失败',
  'app.error.saveFailed': '保存失败',
  'app.error.updateSettings': '更新项目设置失败',
  'app.error.runRequestFailed': '运行请求失败',
  'app.error.formatFailed': '格式化失败',
  'app.error.syncBreakpoints': '同步断点失败',
  'app.error.loadVariables': '读取变量失败',
  'app.error.loadScopes': '读取作用域失败',
  'app.error.loadStack': '读取调用栈失败',
  'app.error.evaluateFailed': '求值失败',
  'app.error.debugCompileFailed': '调试目标编译失败',
  'app.error.startDebugFailed': '启动调试失败',
  'app.error.deleteFileFailed': '删除文件失败',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  // Boot screens
  'app.boot.connecting': 'Connecting to the local sandbox…',
  'app.boot.loadFailed': 'Failed to load workspace',
  'app.boot.noProjectData': 'Project data unavailable',

  // Sandbox banner
  'app.banner.sandboxNotReady': 'Sandbox not ready: ',
  'app.banner.sandboxNoNsjail': 'nsjail unavailable',
  'app.banner.sandboxHint': '. Running and debugging are disabled. First run ',
  'app.banner.sandboxSuffix': '.',

  // Editor area
  'app.editor.emptyFiles': 'No editable files',

  // Panel resizers
  'app.resizer.bottomHeight': 'Drag to resize the bottom panel',
  'app.resizer.debugWidth': 'Drag to resize the debug sidebar',

  // Delete-file confirm
  'app.delete.fileTitle': 'Delete file',
  'app.delete.fileMessage':
    'Delete {file}? This removes the file from the workspace; historical run snapshots can still restore it.',

  // Toasts
  'app.toast.compilerMissing': '{name} is not installed',
  'app.toast.entrySwitched': 'Entry file switched to {file}',
  'app.toast.compileFailed': 'Compilation failed, see the Problems panel',
  'app.toast.runDone': 'Run finished · {ms} ms',
  'app.toast.runEnded': 'Run ended: {status}',
  'app.toast.runDisconnected': 'Run connection lost; result could not be retrieved',
  'app.toast.alreadyFormatted': 'Code already matches the required style',
  'app.toast.formatted': 'clang-format formatted the current file',
  'app.toast.needPaused': 'Pause the program first to do this',
  'app.toast.watchExists': 'That watch expression already exists',
  'app.toast.fileNotInWorkspace': 'File {file} is not in the current workspace',
  'app.toast.deletedFile': 'Deleted {file}',
  'app.toast.projectRenamed': 'Project name updated',

  // Run status line
  'app.run.waitingSlot': 'Waiting for a compile slot',

  // Terminal lines
  'app.term.sandboxRootfs': 'read-only rootfs',
  'app.term.sandboxNoNetwork': 'no network',
  'app.term.sandboxMemory': '{n} MiB memory',
  'app.term.sandboxTimeLimit': '{n} ms time limit',
  'app.term.compiling': 'g++ compiling in the sandbox…',
  'app.term.historyLoaded': 'loaded run record from {when}',
  'app.term.fileCreated': 'created {path}',
  'app.term.debugSessionCreated': 'lldb-dap session {id} created',
  'app.term.debugSessionStopped': 'session stopped',

  // Debug console
  'app.debug.paused': 'Paused: {reason}',
  'app.debug.continued': 'Continued',
  'app.debug.ended': 'Debug session ended',
  'app.debug.endedWith': 'Debug session ended: {reason}',
  'app.debug.programExited': 'Program exited with code {code}',
  'app.debug.compilingTarget': 'Compiling the debug target (-g -O0)…',
  'app.debug.lldbStarted': 'lldb-dap started · {cwd} · compiled in {ms} ms',
  'app.debug.sessionStopped': 'Debug session stopped',
  'app.debug.restarted': 'Restarted the debug target',

  // Error fallbacks
  'app.error.backendUnreachable': 'Cannot reach the backend service',
  'app.error.refreshProject': 'Failed to refresh the project',
  'app.error.saveFailed': 'Failed to save',
  'app.error.updateSettings': 'Failed to update project settings',
  'app.error.runRequestFailed': 'Run request failed',
  'app.error.formatFailed': 'Formatting failed',
  'app.error.syncBreakpoints': 'Failed to sync breakpoints',
  'app.error.loadVariables': 'Failed to read variables',
  'app.error.loadScopes': 'Failed to read scopes',
  'app.error.loadStack': 'Failed to read the call stack',
  'app.error.evaluateFailed': 'Evaluation failed',
  'app.error.debugCompileFailed': 'Failed to compile the debug target',
  'app.error.startDebugFailed': 'Failed to start debugging',
  'app.error.deleteFileFailed': 'Failed to delete the file',
};

export default { 'zh-CN': zhCN, en };
