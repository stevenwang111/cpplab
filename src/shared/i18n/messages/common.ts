/**
 * Cross-cutting strings shared by several components.
 *
 * Every slice follows this shape:
 *   - `zhCN` is the source of truth and defines the key set.
 *   - `en` must contain exactly the same keys (TypeScript enforces it).
 *   - Placeholders use `{name}` and must match across both locales.
 */

const zhCN = {
  'meta.title': 'CppLab · 在线 C++ IDE',
  'meta.description': '在浏览器里编辑、编译、运行 C++，编译器本身也是 WebAssembly',
  'common.close': '关闭',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.delete': '删除',
  'common.confirm': '确认',
  'common.retry': '重试',
  'common.loading': '加载中',
  'common.remove': '移除',
  'common.add': '添加',
  'common.refresh': '刷新',
  'common.empty': '空',
  'common.working': '处理中…',
  'common.failed': '操作失败',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  'meta.title': 'CppLab · Online C++ IDE',
  'meta.description': 'Edit, compile and run C++ in your browser — the compiler is WebAssembly too',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.confirm': 'Confirm',
  'common.retry': 'Retry',
  'common.loading': 'Loading',
  'common.remove': 'Remove',
  'common.add': 'Add',
  'common.refresh': 'Refresh',
  'common.empty': 'Empty',
  'common.working': 'Working…',
  'common.failed': 'Operation failed',
};

export default { 'zh-CN': zhCN, en };
