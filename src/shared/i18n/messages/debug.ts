/** Strings for one UI area. See ./common.ts for the slice contract. */

const zhCN = {
  'debug.state.idle': '未启动',
  'debug.state.starting': '启动中',
  'debug.state.running': '运行中',
  'debug.state.paused': '已暂停',
  'debug.state.terminated': '已结束',

  'debug.header.title': '调试',

  'debug.action.start': '启动调试 (F5)',
  'debug.action.startShort': '开始',
  'debug.action.continue': '继续 (F5)',
  'debug.action.pause': '暂停',
  'debug.action.stepOver': '单步跳过 (F10)',
  'debug.action.stepInto': '单步步入 (F11)',
  'debug.action.stepOut': '单步步出 (Shift + F11)',
  'debug.action.restart': '重新启动调试',
  'debug.action.stop': '停止调试 (Shift + F5)',

  'debug.tab.stack': '调用栈',
  'debug.tab.variables': '变量',
  'debug.tab.watch': '监视',
  'debug.tab.breakpoints': '断点',

  'debug.empty.stack.paused': '没有调用栈信息',
  'debug.empty.stack.idle': '程序暂停后显示调用栈',
  'debug.empty.stack.hint': '命中断点或暂停后，这里会列出栈帧；点击可跳转到源码。',
  'debug.empty.variables.paused': '当前帧没有可见变量',
  'debug.empty.variables.idle': '暂停后查看局部变量',
  'debug.empty.variables.hint': '变量按作用域分组，嵌套结构在展开时才加载。',
  'debug.empty.watch.title': '还没有监视表达式',
  'debug.empty.watch.hint': '暂停时会自动求值；例如 values.size() 或 p.x。',
  'debug.empty.breakpoints.title': '没有断点',
  'debug.empty.breakpoints.hint': '点击编辑器行号左侧的断点槽即可设置断点。',

  'debug.frame.unknownFile': '未知文件',

  'debug.watch.placeholder': '添加监视表达式',
  'debug.watch.evaluating': '求值中…',
  'debug.watch.remove': '移除监视',

  'debug.breakpoint.line': '第 {line} 行',
  'debug.breakpoint.verified': '已验证',
  'debug.breakpoint.unverified': '未验证',
  'debug.breakpoint.remove': '移除断点',
  'debug.breakpoint.hoverVerified': '已设置断点',
  'debug.breakpoint.hoverUnverified': '断点未验证（可能不在可执行行）',

  'debug.footer.active': 'lldb-dap · 沙箱内调试',
  'debug.footer.idle': '调试会话空闲',

  'debug.error.ws': '调试 WebSocket 连接错误',
  'debug.error.connectionClosed': '调试连接已关闭',
  'debug.error.launchRejected': '调试器拒绝启动目标程序',
  'debug.error.requestFailed': '{command} 请求失败',
  'debug.error.notConnected': '调试连接尚未就绪',
  'debug.error.timeout': '调试请求超时：{command}',
  'debug.terminated.program': '程序已结束',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  'debug.state.idle': 'Not started',
  'debug.state.starting': 'Starting',
  'debug.state.running': 'Running',
  'debug.state.paused': 'Paused',
  'debug.state.terminated': 'Ended',

  'debug.header.title': 'Debug',

  'debug.action.start': 'Start debugging (F5)',
  'debug.action.startShort': 'Start',
  'debug.action.continue': 'Continue (F5)',
  'debug.action.pause': 'Pause',
  'debug.action.stepOver': 'Step over (F10)',
  'debug.action.stepInto': 'Step into (F11)',
  'debug.action.stepOut': 'Step out (Shift + F11)',
  'debug.action.restart': 'Restart debugging',
  'debug.action.stop': 'Stop debugging (Shift + F5)',

  'debug.tab.stack': 'Call stack',
  'debug.tab.variables': 'Variables',
  'debug.tab.watch': 'Watch',
  'debug.tab.breakpoints': 'Breakpoints',

  'debug.empty.stack.paused': 'No call stack available',
  'debug.empty.stack.idle': 'Call stack appears while the program is paused',
  'debug.empty.stack.hint': 'When a breakpoint hits or the program pauses, frames are listed here; click one to jump to the source.',
  'debug.empty.variables.paused': 'No visible variables in this frame',
  'debug.empty.variables.idle': 'Pause to view local variables',
  'debug.empty.variables.hint': 'Variables are grouped by scope; nested structures load only when expanded.',
  'debug.empty.watch.title': 'No watch expressions yet',
  'debug.empty.watch.hint': 'Expressions are evaluated automatically while paused; e.g. values.size() or p.x.',
  'debug.empty.breakpoints.title': 'No breakpoints',
  'debug.empty.breakpoints.hint': 'Click the breakpoint slot left of the line number to set a breakpoint.',

  'debug.frame.unknownFile': 'Unknown file',

  'debug.watch.placeholder': 'Add a watch expression',
  'debug.watch.evaluating': 'Evaluating…',
  'debug.watch.remove': 'Remove watch',

  'debug.breakpoint.line': 'Line {line}',
  'debug.breakpoint.verified': 'Verified',
  'debug.breakpoint.unverified': 'Unverified',
  'debug.breakpoint.remove': 'Remove breakpoint',
  'debug.breakpoint.hoverVerified': 'Breakpoint set',
  'debug.breakpoint.hoverUnverified': 'Breakpoint not verified (it may not be on an executable line)',

  'debug.footer.active': 'lldb-dap · Debugging inside the sandbox',
  'debug.footer.idle': 'Debug session idle',

  'debug.error.ws': 'Debug WebSocket connection error',
  'debug.error.connectionClosed': 'Debug connection closed',
  'debug.error.launchRejected': 'The debugger refused to start the target program',
  'debug.error.requestFailed': 'Request {command} failed',
  'debug.error.notConnected': 'Debug connection is not ready',
  'debug.error.timeout': 'Debug request timed out: {command}',
  'debug.terminated.program': 'The program has ended',
};

export default { 'zh-CN': zhCN, en };
