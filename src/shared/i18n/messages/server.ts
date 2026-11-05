/**
 * Server-side messages: API errors, run phases, sandbox and debugger output.
 * Slice contract: see ./common.ts.
 *
 * Key prefixes used here: err. (validation & API errors), run. (compile/run
 * bridge), caps. (capability detection), dbg. (debug session), db. (seed data).
 */

const zhCN = {
  // --- validation.ts ---
  'err.pathMustBeString': '文件路径必须是字符串',
  'err.pathLengthInvalid': '文件路径长度不合法',
  'err.pathInvalid': '非法文件路径：{path}',
  'err.pathCharset': '文件路径只能包含字母、数字、下划线、点和斜杠：{path}',
  'err.filesNotObject': 'files 必须是对象',
  'err.filesEmpty': '至少需要一个源文件',
  'err.tooManyFiles': '文件数量不能超过 {max} 个',
  'err.fileContentNotString': '文件内容必须是字符串：{path}',
  'err.filePathDuplicate': '文件路径重复：{path}',
  'err.sourceFileTooLarge': '单个文件不能超过 {kb} KiB',
  'err.sourceTotalTooLarge': '源码总大小不能超过 {kb} KiB',
  'err.entryMissing': '入口文件不存在：{entry}',
  'err.enumInvalid': '{field} 取值不合法',
  'err.bodyNotJson': '请求体必须是 JSON 对象',
  'err.stdinTooLarge': '标准输入不能超过 {kb} KiB',
  'err.contentNotString': 'content 必须是字符串',
  'err.sourceTooLarge': '源码过大',
  'err.fileTooLarge': '单个文件超过大小上限',

  // --- compile/flags.ts ---
  'err.flagsNotArray': 'extraFlags 必须是字符串数组',
  'err.flagsTooMany': '编译参数最多 {max} 个',
  'err.flagsNotString': '编译参数必须是字符串',
  'err.flagsLengthInvalid': '编译参数长度不合法',
  'err.flagsBadChars': '编译参数包含非法字符',
  'err.flagsTotalTooLong': '编译参数总长度超限',
  'err.flagNotAllowed': '不允许的编译参数：{flag}',
  'err.defineNotAllowed': '不允许的宏定义：{flag}',
  'err.defineValueInvalid': '宏定义值包含非法字符：{flag}',
  'err.includeOutsideWorkspace': '头文件目录必须位于工作区内：-I{dir}',
  'err.includeNameInvalid': '头文件目录名不合法：-I{dir}',
  'err.compilerMissing': '{compiler} 未安装',

  // --- compile/runner.ts ---
  'run.sandbox.compileSpawnFailed': '编译沙箱启动失败',
  'run.sandbox.compileFailed': '编译沙箱执行失败',
  'run.sandbox.execSpawnFailed': '运行沙箱启动失败',
  'run.sandbox.execFailed': '运行沙箱执行失败',
  'run.sandbox.formatSpawnFailed': '格式化沙箱启动失败',
  'run.sandbox.noOutput': 'nsjail 未返回可用结果',
  'run.note.compileTimeout': '[编译超时：超过 {s} 秒]',
  'run.note.runTimeout': '[运行超时：超过 {ms} ms，进程组已终止]',
  'run.note.outputLimit': '[输出超过 {kb} KiB，进程组已终止]',
  'run.note.sigsys': '[沙箱：程序触发了被禁止的系统调用，进程被终止]',
  'err.formatterMissing': 'clang-format 未安装',
  'err.formatFailed': 'clang-format 执行失败',

  // --- runService.ts ---
  'run.phase.queuedCompile': '等待编译槽位',
  'run.phase.compiling': '正在编译',
  'run.phase.queuedRun': '等待运行槽位',
  'run.phase.running': '程序运行中',
  'run.phase.finished': '运行结束',

  // --- sandbox & capability detection ---
  'caps.devicesReady': '设备节点就绪',
  'caps.devicesMissing': '缺少设备节点 {list}；请运行 npm run sandbox:setup',
  'caps.nsjailMissing': 'nsjail 未安装，无法启动隔离沙箱',
  'caps.nsjailSetupHint': '运行 npm run sandbox:setup 安装构建依赖，或设置 NSJAIL_PATH。',
  'caps.nsjailPermission': 'nsjail 需要 root 或 setuid 权限',
  'caps.nsjailPermissionHint': '使用 sudo chown root:root 并 chmod u+s 安装 nsjail，或由 root 启动后端。',
  'caps.nsjailStatFailed': '无法检查 nsjail 可执行文件',
  'caps.nsjailDevicesNotReady': '沙箱设备节点未就绪',
  'caps.nsjailStartFailed': '无法启动 nsjail',
  'caps.nsjailNotInstalled': 'nsjail 未安装；请运行 npm run sandbox:setup',
  'caps.nsjailReady': 'nsjail 就绪',
  'caps.nsjailProbeFailed': 'nsjail 自检失败：{snippet}',
  'caps.nsjailProbeFailedEmpty': 'nsjail 自检失败，未返回任何输出',
  'err.workspaceEscape': '工作区路径越界：{path}',

  // --- debug session ---
  'err.debuggerMissing': 'lldb-dap 未安装',
  'err.debugStartFailed': '启动调试会话失败',
  'dbg.idleTimeout': '空闲超时（5 分钟无操作）',
  'dbg.hardTimeout': '会话超过 30 分钟上限',
  'dbg.clientBadJson': '客户端发送了非法 JSON',
  'dbg.clientClosed': '客户端断开',
  'dbg.clientError': '客户端连接错误',
  'dbg.adapterStdinClosed': '调试适配器的输入管道已关闭',
  'dbg.outputLimit': '程序输出超过 {limit}，调试会话已终止',
  'dbg.outputLimitReason': '程序输出超过上限',
  'dbg.adapterExited': '调试适配器已退出',
  'dbg.adapterFlood': '调试适配器输出超出内部缓冲上限，会话已终止',
  'dbg.sessionStopped': '会话已停止',
  'dbg.serverShutdown': '服务器关闭',

  // --- HTTP error bodies (main.ts) ---
  'err.rateLimited': '请求过于频繁，请稍后再试',
  'err.projectNameLength': '项目名长度需在 1-60 字符之间',
  'err.fileMissing': '文件不存在',
  'err.lastFile': '至少保留一个文件',
  'err.entryFile': '不能删除入口文件',
  'err.runNotFound': '运行记录不存在',
  'err.debugSessionNotFound': '调试会话不存在',
  'err.apiNotFound': '接口不存在',
  'err.invalidJson': '请求 JSON 格式错误',
  'err.bodyTooLarge': '请求体过大',
  'err.internal': '服务器内部错误',

  // --- seed data (db.ts) ---
  'db.projectName': '我的 C++ 项目',
  'db.sampleComment': '在 main 中设置断点，观察 values 的变化。',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  // --- validation.ts ---
  'err.pathMustBeString': 'File path must be a string',
  'err.pathLengthInvalid': 'Invalid file path length',
  'err.pathInvalid': 'Invalid file path: {path}',
  'err.pathCharset': 'File paths may only contain letters, digits, underscore, dot and slash: {path}',
  'err.filesNotObject': 'files must be an object',
  'err.filesEmpty': 'At least one source file is required',
  'err.tooManyFiles': 'At most {max} files are allowed',
  'err.fileContentNotString': 'File content must be a string: {path}',
  'err.filePathDuplicate': 'Duplicate file path: {path}',
  'err.sourceFileTooLarge': 'A single file cannot exceed {kb} KiB',
  'err.sourceTotalTooLarge': 'Total source size cannot exceed {kb} KiB',
  'err.entryMissing': 'Entry file does not exist: {entry}',
  'err.enumInvalid': 'Invalid value for {field}',
  'err.bodyNotJson': 'Request body must be a JSON object',
  'err.stdinTooLarge': 'Standard input cannot exceed {kb} KiB',
  'err.contentNotString': 'content must be a string',
  'err.sourceTooLarge': 'Source code is too large',
  'err.fileTooLarge': 'File exceeds the size limit',

  // --- compile/flags.ts ---
  'err.flagsNotArray': 'extraFlags must be an array of strings',
  'err.flagsTooMany': 'At most {max} compiler flags are allowed',
  'err.flagsNotString': 'Compiler flags must be strings',
  'err.flagsLengthInvalid': 'Invalid compiler flag length',
  'err.flagsBadChars': 'Compiler flags contain illegal characters',
  'err.flagsTotalTooLong': 'Compiler flags exceed the total length limit',
  'err.flagNotAllowed': 'Compiler flag not allowed: {flag}',
  'err.defineNotAllowed': 'Macro definition not allowed: {flag}',
  'err.defineValueInvalid': 'Macro value contains illegal characters: {flag}',
  'err.includeOutsideWorkspace': 'Include directory must stay inside the workspace: -I{dir}',
  'err.includeNameInvalid': 'Invalid include directory name: -I{dir}',
  'err.compilerMissing': '{compiler} is not installed',

  // --- compile/runner.ts ---
  'run.sandbox.compileSpawnFailed': 'Failed to start the compile sandbox',
  'run.sandbox.compileFailed': 'The compile sandbox failed to run',
  'run.sandbox.execSpawnFailed': 'Failed to start the run sandbox',
  'run.sandbox.execFailed': 'The run sandbox failed to run',
  'run.sandbox.formatSpawnFailed': 'Failed to start the formatter sandbox',
  'run.sandbox.noOutput': 'nsjail returned no usable output',
  'run.note.compileTimeout': '[Compile timed out after {s} s]',
  'run.note.runTimeout': '[Run timed out after {ms} ms; process group killed]',
  'run.note.outputLimit': '[Output exceeded {kb} KiB; process group killed]',
  'run.note.sigsys': '[Sandbox: the program triggered a blocked syscall and was killed]',
  'err.formatterMissing': 'clang-format is not installed',
  'err.formatFailed': 'clang-format failed',

  // --- runService.ts ---
  'run.phase.queuedCompile': 'Waiting for a compile slot',
  'run.phase.compiling': 'Compiling',
  'run.phase.queuedRun': 'Waiting for a run slot',
  'run.phase.running': 'Program is running',
  'run.phase.finished': 'Run finished',

  // --- sandbox & capability detection ---
  'caps.devicesReady': 'Device nodes are ready',
  'caps.devicesMissing': 'Missing device nodes: {list}; run npm run sandbox:setup',
  'caps.nsjailMissing': 'nsjail is not installed; the sandbox cannot start',
  'caps.nsjailSetupHint': 'Run npm run sandbox:setup to install build dependencies, or set NSJAIL_PATH.',
  'caps.nsjailPermission': 'nsjail needs root or setuid privileges',
  'caps.nsjailPermissionHint':
    'Install nsjail with sudo chown root:root and chmod u+s, or start the backend as root.',
  'caps.nsjailStatFailed': 'Could not inspect the nsjail executable',
  'caps.nsjailDevicesNotReady': 'Sandbox device nodes are not ready',
  'caps.nsjailStartFailed': 'Failed to start nsjail',
  'caps.nsjailNotInstalled': 'nsjail is not installed; run npm run sandbox:setup',
  'caps.nsjailReady': 'nsjail is ready',
  'caps.nsjailProbeFailed': 'nsjail self-test failed: {snippet}',
  'caps.nsjailProbeFailedEmpty': 'nsjail self-test failed and produced no output',
  'err.workspaceEscape': 'Workspace path escapes the work directory: {path}',

  // --- debug session ---
  'err.debuggerMissing': 'lldb-dap is not installed',
  'err.debugStartFailed': 'Failed to start the debug session',
  'dbg.idleTimeout': 'Idle timeout (5 minutes without activity)',
  'dbg.hardTimeout': 'Session exceeded the 30 minute limit',
  'dbg.clientBadJson': 'The client sent invalid JSON',
  'dbg.clientClosed': 'Client disconnected',
  'dbg.clientError': 'Client connection error',
  'dbg.adapterStdinClosed': 'The debug adapter input pipe is closed',
  'dbg.outputLimit': 'Program output exceeded {limit}; the debug session was terminated',
  'dbg.outputLimitReason': 'Program output exceeded the limit',
  'dbg.adapterExited': 'The debug adapter exited',
  'dbg.adapterFlood': 'The debug adapter exceeded the internal buffer limit; the session was terminated',
  'dbg.sessionStopped': 'Session stopped',
  'dbg.serverShutdown': 'Server shutting down',

  // --- HTTP error bodies (main.ts) ---
  'err.rateLimited': 'Too many requests; please try again shortly',
  'err.projectNameLength': 'Project name must be 1-60 characters long',
  'err.fileMissing': 'File not found',
  'err.lastFile': 'At least one file must remain',
  'err.entryFile': 'The entry file cannot be deleted',
  'err.runNotFound': 'Run record not found',
  'err.debugSessionNotFound': 'Debug session not found',
  'err.apiNotFound': 'API endpoint not found',
  'err.invalidJson': 'Malformed JSON in the request body',
  'err.bodyTooLarge': 'Request body is too large',
  'err.internal': 'Internal server error',

  // --- seed data (db.ts) ---
  'db.projectName': 'My C++ Project',
  'db.sampleComment': 'Set a breakpoint in main and watch how values changes.',
};

export default { 'zh-CN': zhCN, en };
