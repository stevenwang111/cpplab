// `edcore.main` is the full editor (all contributions, workers, keybindings)
// without the language packs: only C++ is registered below, which keeps the
// static bundle far smaller than importing `monaco-editor` wholesale.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { MessageKey } from '../../shared/i18n';
import { t } from '../i18n';

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

export const MONACO_THEME = 'cpplab-light';
/** Editor model root. Source paths are workspace-relative. */
export const WORKSPACE_URI_ROOT = '/workspace';

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
  detailKey: MessageKey;
  insertText: string;
  documentationKey: MessageKey;
}> = [
  {
    label: 'main',
    detailKey: 'monaco.snippet.main.detail',
    documentationKey: 'monaco.snippet.main.doc',
    insertText:
      'int main() {\n\tios::sync_with_stdio(false);\n\tcin.tie(nullptr);\n\t\n\t$0\n\treturn 0;\n}',
  },
  {
    label: 'for',
    detailKey: 'monaco.snippet.for.detail',
    documentationKey: 'monaco.snippet.for.doc',
    insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}',
  },
  {
    label: 'forr',
    detailKey: 'monaco.snippet.forr.detail',
    documentationKey: 'monaco.snippet.forr.doc',
    insertText: 'for (const auto& ${1:item} : ${2:container}) {\n\t$0\n}',
  },
  {
    label: 'vec',
    detailKey: 'monaco.snippet.vec.detail',
    documentationKey: 'monaco.snippet.vec.doc',
    insertText: 'vector<${1:int}> ${2:values}(${3:n});$0',
  },
  {
    label: 'sort',
    detailKey: 'monaco.snippet.sort.detail',
    documentationKey: 'monaco.snippet.sort.doc',
    insertText: 'sort(${1:values}.begin(), ${1:values}.end());$0',
  },
  {
    label: 'umap',
    detailKey: 'monaco.snippet.umap.detail',
    documentationKey: 'monaco.snippet.umap.doc',
    insertText: 'unordered_map<${1:int}, ${2:int}> ${3:count};$0',
  },
  {
    label: 'fastio',
    detailKey: 'monaco.snippet.fastio.detail',
    documentationKey: 'monaco.snippet.fastio.doc',
    insertText: 'ios::sync_with_stdio(false);\ncin.tie(nullptr);$0',
  },
  {
    label: 'class',
    detailKey: 'monaco.snippet.class.detail',
    documentationKey: 'monaco.snippet.class.doc',
    insertText:
      'class ${1:Solution} {\npublic:\n\t${1:Solution}() = default;\n\n\t$0\n\nprivate:\n\tint value_{0};\n};',
  },
  {
    label: 'struct',
    detailKey: 'monaco.snippet.struct.detail',
    documentationKey: 'monaco.snippet.struct.doc',
    insertText: 'struct ${1:Point} {\n\tint ${2:x};\n\tint ${3:y};\n};$0',
  },
  {
    label: 'include',
    detailKey: 'monaco.snippet.include.detail',
    documentationKey: 'monaco.snippet.include.doc',
    insertText: '#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n\n$0',
  },
  {
    label: 'printf',
    detailKey: 'monaco.snippet.printf.detail',
    documentationKey: 'monaco.snippet.printf.doc',
    insertText: 'printf("${1:%d}\\n", ${2:value});$0',
  },
  {
    label: 'debug',
    detailKey: 'monaco.snippet.debug.detail',
    documentationKey: 'monaco.snippet.debug.doc',
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
          detail: t(snippet.detailKey),
          documentation: t(snippet.documentationKey),
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
  return monaco.Uri.file(`${WORKSPACE_URI_ROOT}/${filePath}`);
}

export { monaco };
