/** Strings for one UI area. See ./common.ts for the slice contract. */

const zhCN = {
  // TopBar
  'chrome.topbar.brand': 'CppLab 在线 C++ IDE',
  'chrome.topbar.save.saving': '保存中',
  'chrome.topbar.save.unsaved': '未保存',
  'chrome.topbar.save.failed': '保存失败',
  'chrome.topbar.save.saved': '已保存',
  'chrome.topbar.run.title': '运行 (Ctrl/Cmd + Enter)',
  'chrome.topbar.run.idle': '运行',
  'chrome.topbar.run.compiling': '编译中',
  'chrome.topbar.run.running': '运行中',
  'chrome.topbar.format.title': '格式化当前文件 (Ctrl/Cmd + Shift + F)',
  'chrome.topbar.format.label': '格式化',
  'chrome.topbar.history': '运行记录',
  'chrome.topbar.settings': '编辑器设置',
  'chrome.topbar.help': '帮助与快捷键',
  'chrome.topbar.workspace': '纯前端本地工作区',

  // StatusBar
  'chrome.statusbar.indent': '空格: 4',
  'chrome.statusbar.local': '本地编译',
  'chrome.statusbar.wasm': 'WASM 沙箱',
  'chrome.statusbar.offline': '无网络',

  // FileTabs / FileMenu
  'chrome.files.newFile': '新建文件',
  'chrome.filetabs.entryFile': '{name}（入口文件）',
  'chrome.filetabs.closeFile': '关闭 {name}',
  'chrome.filemenu.backdropClose': '关闭文件列表',
  'chrome.filemenu.label': '文件列表',
  'chrome.filemenu.heading': '工作区文件',
  'chrome.filemenu.entry': '入口',
  'chrome.filemenu.setEntry': '设为入口文件',
  'chrome.filemenu.entryNoDelete': '入口文件不能删除',
  'chrome.filemenu.deleteFile': '删除文件',

  // EditorToolbar
  'chrome.toolbar.compiler': '编译器',
  'chrome.toolbar.compilerNotInstalled': '{name}（未安装）',
  'chrome.toolbar.std': '标准',
  'chrome.toolbar.stdAria': 'C++ 标准',
  'chrome.toolbar.opt': '优化',
  'chrome.toolbar.optAria': '优化级别',
  'chrome.toolbar.flags': '编译参数',
  'chrome.toolbar.entry': '入口 {name}',
  'chrome.toolbar.files': '文件',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  // TopBar
  'chrome.topbar.brand': 'CppLab · Online C++ IDE',
  'chrome.topbar.save.saving': 'Saving',
  'chrome.topbar.save.unsaved': 'Unsaved',
  'chrome.topbar.save.failed': 'Save failed',
  'chrome.topbar.save.saved': 'Saved',
  'chrome.topbar.run.title': 'Run (Ctrl/Cmd + Enter)',
  'chrome.topbar.run.idle': 'Run',
  'chrome.topbar.run.compiling': 'Compiling',
  'chrome.topbar.run.running': 'Running',
  'chrome.topbar.format.title': 'Format current file (Ctrl/Cmd + Shift + F)',
  'chrome.topbar.format.label': 'Format',
  'chrome.topbar.history': 'Run history',
  'chrome.topbar.settings': 'Editor settings',
  'chrome.topbar.help': 'Help and keyboard shortcuts',
  'chrome.topbar.workspace': 'Client-only local workspace',

  // StatusBar
  'chrome.statusbar.indent': 'Spaces: 4',
  'chrome.statusbar.local': 'Local build',
  'chrome.statusbar.wasm': 'WASM sandbox',
  'chrome.statusbar.offline': 'No network',

  // FileTabs / FileMenu
  'chrome.files.newFile': 'New file',
  'chrome.filetabs.entryFile': '{name} (entry file)',
  'chrome.filetabs.closeFile': 'Close {name}',
  'chrome.filemenu.backdropClose': 'Close file list',
  'chrome.filemenu.label': 'File list',
  'chrome.filemenu.heading': 'Workspace files',
  'chrome.filemenu.entry': 'Entry',
  'chrome.filemenu.setEntry': 'Set as entry file',
  'chrome.filemenu.entryNoDelete': 'Entry file cannot be deleted',
  'chrome.filemenu.deleteFile': 'Delete file',

  // EditorToolbar
  'chrome.toolbar.compiler': 'Compiler',
  'chrome.toolbar.compilerNotInstalled': '{name} (not installed)',
  'chrome.toolbar.std': 'Standard',
  'chrome.toolbar.stdAria': 'C++ standard',
  'chrome.toolbar.opt': 'Optimization',
  'chrome.toolbar.optAria': 'Optimization level',
  'chrome.toolbar.flags': 'Compiler flags',
  'chrome.toolbar.entry': 'Entry: {name}',
  'chrome.toolbar.files': 'Files',
};

export default { 'zh-CN': zhCN, en };
