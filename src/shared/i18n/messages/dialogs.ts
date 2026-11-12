/** Strings for one UI area. See ./common.ts for the slice contract. */

const zhCN = {
  // Modal shell
  'dialogs.modal.backdrop': '关闭对话框',

  // New file modal
  'dialogs.newFile.title': '新建文件',
  'dialogs.newFile.subtitle': '多文件项目会一起编译进同一个 wasm 模块',
  'dialogs.newFile.pathLabel': '文件路径',
  'dialogs.newFile.pathPlaceholder': '例如 util.h 或 include/math.hpp',
  'dialogs.newFile.hint': '建议使用 .cpp / .cc / .h / .hpp；入口文件在工具栏中切换。',
  'dialogs.newFile.creating': '创建中…',
  'dialogs.newFile.submit': '创建文件',
  'dialogs.newFile.errorEmptyPath': '请输入文件路径',
  'dialogs.newFile.errorInvalidPath': '路径只能包含字母、数字、下划线、点、斜杠，且必须是相对路径',
  'dialogs.newFile.errorExists': '同名文件已存在',
  'dialogs.newFile.errorCreateFailed': '创建失败',

  // Help / shortcuts modal
  'dialogs.help.title': 'CppLab 使用说明',
  'dialogs.help.subtitle': '完全运行在浏览器里的 C++ 编辑、编译与运行',
  'dialogs.help.shortcuts': '快捷键',
  'dialogs.help.shortcut.run': '运行',
  'dialogs.help.shortcut.saveFile': '保存当前文件',
  'dialogs.help.shortcut.format': 'clang-format 格式化',
  'dialogs.help.security': '安全边界',
  'dialogs.help.securityWasm': '编译器同样是 WebAssembly 模块，源码不会离开这台设备。',
  'dialogs.help.securityImports': '你的程序只能调用 WASI 的 stdio、时钟与随机数，没有文件系统、没有网络。',
  'dialogs.help.securityWorker': '每次运行都在独立 Worker 中执行，超时直接终止，没有孤儿进程。',
  'dialogs.help.securityStorage': '代码、设置与历史保存在浏览器 IndexedDB 中。',
  'dialogs.help.limits': '限制',
  'dialogs.help.limitsSource': '源码 ≤ 256 KiB / 16 个文件，stdin ≤ 1 MiB。',
  'dialogs.help.limitsRuntime': '运行墙钟 ≤ 10 s，输出 ≤ 64 KiB，内存由链接期 --max-memory 限制。',
  'dialogs.help.limitsFirstRun': '首次编译需下载约 41 MB 工具链（brotli），之后由浏览器缓存。',
  'dialogs.help.limitsDebug': '纯前端构建不提供断点与单步调试。',

  // Flags popover
  'dialogs.flags.title': '编译参数',
  'dialogs.flags.backdrop': '关闭编译参数',
  'dialogs.flags.note': '参数只会交给 clang -cc1，且经过白名单校验；-pthread、-fsanitize、-lm 在 wasm 目标下不适用。',
  'dialogs.flags.debug': '定义调试宏',
  'dialogs.flags.ndebug': '关闭 assert',
  'dialogs.flags.customPlaceholder': '-DDEBUG 或 -Iinclude',
  'dialogs.flags.addTitle': '添加参数',
  'dialogs.flags.errorFormat': '仅支持 -D<宏> 或 -I<工作区内相对目录>',
  'dialogs.flags.errorDuplicate': '该参数已存在',

  // Settings popover
  'dialogs.settings.language': '界面语言',
  'dialogs.settings.title': '编辑器设置',
  'dialogs.settings.backdrop': '关闭设置',
  'dialogs.settings.fontSize': '字体大小',
  'dialogs.settings.decrease': '减小',
  'dialogs.settings.increase': '增大',
  'dialogs.settings.minimap': '显示 minimap',
  'dialogs.settings.wordWrap': '自动换行',
  'dialogs.settings.timeLimit': '运行时限',
  'dialogs.settings.seconds': '{n} 秒',
  'dialogs.settings.memoryLimit': '内存上限',
  'dialogs.settings.projectName': '项目名称',
  'dialogs.settings.note': '设置保存在浏览器本地；项目、文件与运行历史都存放在 IndexedDB 中。',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  // Modal shell
  'dialogs.modal.backdrop': 'Close dialog',

  // New file modal
  'dialogs.newFile.title': 'New file',
  'dialogs.newFile.subtitle': 'Multi-file projects are compiled into one wasm module',
  'dialogs.newFile.pathLabel': 'File path',
  'dialogs.newFile.pathPlaceholder': 'e.g. util.h or include/math.hpp',
  'dialogs.newFile.hint': 'Prefer .cpp / .cc / .h / .hpp; switch the entry file from the toolbar.',
  'dialogs.newFile.creating': 'Creating…',
  'dialogs.newFile.submit': 'Create file',
  'dialogs.newFile.errorEmptyPath': 'Please enter a file path',
  'dialogs.newFile.errorInvalidPath': 'Paths may only contain letters, digits, underscores, dots and slashes, and must be relative',
  'dialogs.newFile.errorExists': 'A file with that name already exists',
  'dialogs.newFile.errorCreateFailed': 'Creation failed',

  // Help / shortcuts modal
  'dialogs.help.title': 'CppLab user guide',
  'dialogs.help.subtitle': 'C++ editing, compiling and running entirely inside your browser',
  'dialogs.help.shortcuts': 'Keyboard shortcuts',
  'dialogs.help.shortcut.run': 'Run',
  'dialogs.help.shortcut.saveFile': 'Save current file',
  'dialogs.help.shortcut.format': 'Format with clang-format',
  'dialogs.help.security': 'Security boundary',
  'dialogs.help.securityWasm': 'The compiler itself is a WebAssembly module; your source never leaves this device.',
  'dialogs.help.securityImports': 'A program can only reach WASI stdio, the clock and randomness — no filesystem, no network.',
  'dialogs.help.securityWorker': 'Every run gets a fresh Worker; a timeout terminates it, so no process can be orphaned.',
  'dialogs.help.securityStorage': 'Code, settings and history live in the browser IndexedDB.',
  'dialogs.help.limits': 'Limits',
  'dialogs.help.limitsSource': 'Source ≤ 256 KiB / 16 files, stdin ≤ 1 MiB.',
  'dialogs.help.limitsRuntime': 'Wall-clock ≤ 10 s, output ≤ 64 KiB; memory is capped at link time via --max-memory.',
  'dialogs.help.limitsFirstRun': 'The first compile downloads about 41 MB of toolchain (brotli); afterwards the browser caches it.',
  'dialogs.help.limitsDebug': 'A client-only build has no breakpoints or stepping.',

  // Flags popover
  'dialogs.flags.title': 'Compiler flags',
  'dialogs.flags.backdrop': 'Close compiler flags',
  'dialogs.flags.note': 'Flags go to clang -cc1 through a whitelist; -pthread, -fsanitize and -lm do not apply to the wasm target.',
  'dialogs.flags.debug': 'Define the debug macro',
  'dialogs.flags.ndebug': 'Disable assert',
  'dialogs.flags.customPlaceholder': '-DDEBUG or -Iinclude',
  'dialogs.flags.addTitle': 'Add flag',
  'dialogs.flags.errorFormat': 'Only -D<macro> or -I<directory relative to the workspace> is supported',
  'dialogs.flags.errorDuplicate': 'This flag already exists',

  // Settings popover
  'dialogs.settings.language': 'Language',
  'dialogs.settings.title': 'Editor settings',
  'dialogs.settings.backdrop': 'Close settings',
  'dialogs.settings.fontSize': 'Font size',
  'dialogs.settings.decrease': 'Decrease',
  'dialogs.settings.increase': 'Increase',
  'dialogs.settings.minimap': 'Show minimap',
  'dialogs.settings.wordWrap': 'Word wrap',
  'dialogs.settings.timeLimit': 'Run time limit',
  'dialogs.settings.seconds': '{n} s',
  'dialogs.settings.memoryLimit': 'Memory limit',
  'dialogs.settings.projectName': 'Project name',
  'dialogs.settings.note': 'Settings are stored in this browser; projects, files and history live in IndexedDB.',
};

export default { 'zh-CN': zhCN, en };
