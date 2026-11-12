/** Strings for one UI area. See ./common.ts for the slice contract. */

const zhCN = {
  'panels.tab.output': '运行输出',
  'panels.tab.stdin': '输入',
  'panels.tab.terminal': '终端',
  'panels.tab.problems': '问题',

  'panels.meta.running': '运行中',
  'panels.meta.executing': '正在执行',
  'panels.action.clearPanel': '清空当前面板',
  'panels.action.expand': '展开面板',
  'panels.action.collapse': '收起面板',

  'panels.output.emptyTitleNoOutput': '程序没有产生输出',
  'panels.output.emptyTitleStart': '点击右上角「运行」开始',
  'panels.output.emptyHint': 'stdout 与 stderr 会实时流式显示在这里，输出上限 64 KiB。',

  'panels.stdin.label': '标准输入（stdin）',
  'panels.stdin.placeholder': '例如：\n5\n1 2 3 4 5',
  'panels.stdin.hint': '程序通过 std::cin 读取这段内容；运行时一次性送入 WASI fd_read。',

  'panels.terminal.emptyTitle': '终端还没有记录',
  'panels.terminal.emptyHint': '运行后，这里会显示编译命令与 WebAssembly 沙箱摘要。',

  'panels.problems.emptyTitle': '没有编译问题',
  'panels.problems.emptyHint': '编译错误和警告会按文件、行号列出，点击可跳转到编辑器。',
  'panels.severity.error': '错误',
  'panels.severity.warning': '警告',
  'panels.severity.note': '提示',

  'panels.history.title': '运行记录',
  'panels.history.subtitle': '保存在本机浏览器中的运行快照',
  'panels.history.closeAria': '关闭运行记录',
  'panels.history.emptyTitle': '还没有运行记录',
  'panels.history.emptyHint': '每次运行都会保存源码快照、编译参数与输出，可在这里恢复。',
  'panels.history.restore': '恢复代码',
  'panels.history.restored': '已恢复该次运行的代码快照',
  'panels.history.loadFailed': '加载运行记录失败',
  'panels.history.readFailed': '读取记录失败',
  'panels.history.restoreFailed': '恢复失败',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  'panels.tab.output': 'Output',
  'panels.tab.stdin': 'Input',
  'panels.tab.terminal': 'Terminal',
  'panels.tab.problems': 'Problems',

  'panels.meta.running': 'Running',
  'panels.meta.executing': 'Executing',
  'panels.action.clearPanel': 'Clear current panel',
  'panels.action.expand': 'Expand panel',
  'panels.action.collapse': 'Collapse panel',

  'panels.output.emptyTitleNoOutput': 'The program produced no output',
  'panels.output.emptyTitleStart': 'Click Run in the top-right corner to start',
  'panels.output.emptyHint': 'stdout and stderr stream here in real time, up to 64 KiB.',

  'panels.stdin.label': 'Standard input (stdin)',
  'panels.stdin.placeholder': 'e.g.:\n5\n1 2 3 4 5',
  'panels.stdin.hint': 'Your program reads this via std::cin; the bytes are handed to WASI fd_read when the run starts.',

  'panels.terminal.emptyTitle': 'No terminal entries yet',
  'panels.terminal.emptyHint': 'After a run, the compile command and WebAssembly sandbox summary appear here.',

  'panels.problems.emptyTitle': 'No compilation problems',
  'panels.problems.emptyHint': 'Errors and warnings are listed by file and line; click one to jump to the editor.',
  'panels.severity.error': 'Error',
  'panels.severity.warning': 'Warning',
  'panels.severity.note': 'Note',

  'panels.history.title': 'Run history',
  'panels.history.subtitle': 'Snapshots kept in this browser',
  'panels.history.closeAria': 'Close run history',
  'panels.history.emptyTitle': 'No run history yet',
  'panels.history.emptyHint': 'Every run saves a source snapshot, compiler flags and output; you can restore them here.',
  'panels.history.restore': 'Restore code',
  'panels.history.restored': 'Restored the code snapshot from this run',
  'panels.history.loadFailed': 'Failed to load run history',
  'panels.history.readFailed': 'Failed to read this run',
  'panels.history.restoreFailed': 'Restore failed',
};

export default { 'zh-CN': zhCN, en };
