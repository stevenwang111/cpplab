import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

export const MONACO_THEME = 'cpplab-light';
export const SANDBOX_ROOT = '/workspace';

monaco.editor.defineTheme(MONACO_THEME, {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cf222e' },
    { token: 'keyword.directive', foreground: '0550ae' },
    { token: 'keyword.directive.control', foreground: 'cf222e' },
    { token: 'string', foreground: '0a3069' },
    { token: 'string.escape', foreground: 'cf222e' },
    { token: 'number', foreground: '0550ae' },
    { token: 'type', foreground: '953800' },
    { token: 'type.identifier', foreground: '8250df' },
    { token: 'identifier', foreground: '24292f' },
    { token: 'function', foreground: '8250df' },
    { token: 'operator', foreground: 'cf222e' },
    { token: 'delimiter', foreground: '57606a' },
    { token: 'metatag', foreground: '116329' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#24292f',
    'editorLineNumber.foreground': '#8c959f',
    'editorLineNumber.activeForeground': '#24292f',
    'editor.selectionBackground': '#cfe4ff',
    'editor.inactiveSelectionBackground': '#e6eefb',
    'editor.lineHighlightBackground': '#f6f8fa',
    'editorCursor.foreground': '#0969da',
    'editorIndentGuide.background1': '#e6e8eb',
    'editorIndentGuide.activeBackground1': '#c9ced6',
    'editorBracketMatch.background': '#eaf2ff',
    'editorBracketMatch.border': '#9cc4f5',
    'editorGutter.background': '#ffffff',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d8dee4',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.border': '#d8dee4',
    'editorSuggestWidget.selectedBackground': '#f0f6ff',
    'editorHoverWidget.background': '#ffffff',
    'editorHoverWidget.border': '#d8dee4',
    'editorError.foreground': '#cf222e',
    'editorWarning.foreground': '#bf8700',
    'editorInfo.foreground': '#0969da',
    'focusBorder': '#b6d7ff',
  },
});

const SNIPPETS: Array<{
  label: string;
  detail: string;
  insertText: string;
  documentation: string;
}> = [
  {
    label: 'main',
    detail: '程序入口',
    documentation: '带标准输入输出加速的 main 函数',
    insertText:
      'int main() {\n\tios::sync_with_stdio(false);\n\tcin.tie(nullptr);\n\t\n\t$0\n\treturn 0;\n}',
  },
  {
    label: 'for',
    detail: '下标循环',
    documentation: '从 0 到 n 的标准 for 循环',
    insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}',
  },
  {
    label: 'forr',
    detail: '范围循环',
    documentation: '遍历容器的范围 for 循环',
    insertText: 'for (const auto& ${1:item} : ${2:container}) {\n\t$0\n}',
  },
  {
    label: 'vec',
    detail: 'vector 声明',
    documentation: '声明一个指定大小的 vector',
    insertText: 'vector<${1:int}> ${2:values}(${3:n});$0',
  },
  {
    label: 'sort',
    detail: '排序',
    documentation: '对容器进行升序排序',
    insertText: 'sort(${1:values}.begin(), ${1:values}.end());$0',
  },
  {
    label: 'umap',
    detail: 'unordered_map',
    documentation: '声明一个哈希表',
    insertText: 'unordered_map<${1:int}, ${2:int}> ${3:count};$0',
  },
  {
    label: 'fastio',
    detail: '快速 IO',
    documentation: '关闭同步并解除 cin/cout 绑定',
    insertText: 'ios::sync_with_stdio(false);\ncin.tie(nullptr);$0',
  },
  {
    label: 'class',
    detail: '类定义',
    documentation: '包含构造函数与私有成员的类模板',
    insertText:
      'class ${1:Solution} {\npublic:\n\t${1:Solution}() = default;\n\n\t$0\n\nprivate:\n\tint value_{0};\n};',
  },
  {
    label: 'struct',
    detail: '结构体定义',
    documentation: '简单的结构体模板',
    insertText: 'struct ${1:Point} {\n\tint ${2:x};\n\tint ${3:y};\n};$0',
  },
  {
    label: 'include',
    detail: '常用头文件',
    documentation: '竞赛/练习常用的标准库头文件',
    insertText: '#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n\n$0',
  },
  {
    label: 'printf',
    detail: '格式化输出',
    documentation: 'printf 模板',
    insertText: 'printf("${1:%d}\\n", ${2:value});$0',
  },
  {
    label: 'debug',
    detail: '断点辅助输出',
    documentation: '向 stderr 打印并换行，适合临时排查',
    insertText: 'cerr << "${1:message}" << ${2:value} << endl;$0',
  },
];

let snippetsRegistered = false;

export function registerCppSnippets(): void {
  if (snippetsRegistered) return;
  snippetsRegistered = true;
  monaco.languages.registerCompletionItemProvider('cpp', {
    triggerCharacters: ['.', '>'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: SNIPPETS.map((snippet) => ({
          label: snippet.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: snippet.detail,
          documentation: snippet.documentation,
          range,
          sortText: `0${snippet.label}`,
        })),
      };
    },
  });
  monaco.languages.setLanguageConfiguration('cpp', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      increaseIndentPattern: /^.*\{[^}"']*$/,
      decreaseIndentPattern: /^\s*\}/,
    },
  });
}

export function modelUri(filePath: string): monaco.Uri {
  return monaco.Uri.file(`${SANDBOX_ROOT}/${filePath}`);
}

export { monaco };
