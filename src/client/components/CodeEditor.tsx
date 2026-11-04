import { useEffect, useRef } from 'react';
import type { Diagnostic } from '../../shared/types';
import { monaco, modelUri, MONACO_THEME, registerCppSnippets } from '../editor/monaco';
import { t, useLocale } from '../i18n';

export interface EditorBreakpoint {
  file: string;
  line: number;
  verified: boolean;
  id?: number;
}

export interface EditorSettings {
  fontSize: number;
  minimap: boolean;
  wordWrap: 'off' | 'on';
}

interface CodeEditorProps {
  files: Record<string, string>;
  activeFile: string;
  diagnostics: Diagnostic[];
  breakpoints: EditorBreakpoint[];
  currentLine: { file: string; line: number } | null;
  gotoLine: { file: string; line: number; column: number; nonce: number } | null;
  settings: EditorSettings;
  onChange: (file: string, value: string) => void;
  onCursor: (line: number, column: number) => void;
  onToggleBreakpoint: (line: number) => void;
  onSave: () => void;
}

export function CodeEditor(props: CodeEditorProps): JSX.Element {
  const locale = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const viewStatesRef = useRef<Map<string, monaco.editor.ICodeEditorViewState | null>>(new Map());
  const activeRef = useRef(props.activeFile);
  const callbacksRef = useRef(props);
  const breakpointDecorations = useRef<Map<string, string[]>>(new Map());
  const currentLineDecoration = useRef<string | null>(null);
  const currentDecorationModel = useRef<monaco.editor.ITextModel | null>(null);
  const currentModelPath = useRef<string>('');
  const suppressChange = useRef(false);

  callbacksRef.current = props;
  activeRef.current = props.activeFile;

  useEffect(() => {
    if (!hostRef.current) return;
    registerCppSnippets();

    const editor = monaco.editor.create(hostRef.current, {
      theme: MONACO_THEME,
      language: 'cpp',
      automaticLayout: true,
      glyphMargin: true,
      lineNumbersMinChars: 3,
      minimap: { enabled: callbacksRef.current.settings.minimap, renderCharacters: false, maxColumn: 80 },
      fontSize: callbacksRef.current.settings.fontSize,
      lineHeight: 22,
      fontFamily:
        "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      fontLigatures: false,
      tabSize: 4,
      insertSpaces: true,
      detectIndentation: false,
      formatOnPaste: true,
      formatOnType: true,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderWhitespace: 'selection',
      padding: { top: 14, bottom: 20 },
      fixedOverflowWidgets: true,
      wordWrap: callbacksRef.current.settings.wordWrap,
      quickSuggestions: { other: true, comments: false, strings: false },
      suggest: { showSnippets: true, snippetsPreventQuickSuggestions: false },
      snippetSuggestions: 'top',
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      stickyScroll: { enabled: false },
    });
    editorRef.current = editor;

    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;
      const file = activeRef.current;
      const current = modelsRef.current.get(file);
      if (current !== model || suppressChange.current) return;
      callbacksRef.current.onChange(file, model.getValue());
    });
    editor.onDidChangeCursorPosition((event) => {
      callbacksRef.current.onCursor(event.position.lineNumber, event.position.column);
    });
    editor.onMouseDown((event) => {
      if (
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        return;
      }
      if (!event.target.position) return;
      if (event.event.leftButton) callbacksRef.current.onToggleBreakpoint(event.target.position.lineNumber);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacksRef.current.onSave());

    return () => {
      editor.dispose();
      editorRef.current = null;
      for (const model of modelsRef.current.values()) model.dispose();
      modelsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    for (const [filePath, content] of Object.entries(props.files)) {
      let model = modelsRef.current.get(filePath);
      if (!model) {
        model = monaco.editor.createModel(content, 'cpp', modelUri(filePath));
        modelsRef.current.set(filePath, model);
      } else if (model.getValue() !== content) {
        suppressChange.current = true;
        model.setValue(content);
        suppressChange.current = false;
      }
    }
    for (const [filePath, model] of modelsRef.current) {
      if (!(filePath in props.files)) {
        if (activeRef.current === filePath) {
          activeRef.current = Object.keys(props.files)[0] ?? '';
        }
        model.dispose();
        modelsRef.current.delete(filePath);
        viewStatesRef.current.delete(filePath);
      }
    }

    const nextModel = modelsRef.current.get(props.activeFile) ?? modelsRef.current.values().next().value;
    if (!nextModel) return;
    if (editor.getModel() !== nextModel) {
      const previous = editor.getModel();
      if (previous) viewStatesRef.current.set(currentModelPath.current, editor.saveViewState());
      editor.setModel(nextModel);
      currentModelPath.current = props.activeFile;
      const saved = viewStatesRef.current.get(props.activeFile);
      if (saved) editor.restoreViewState(saved);
    }
    applyBreakpointDecorations();
    applyCurrentLineDecoration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.files, props.activeFile]);

  useEffect(() => {
    applyDiagnosticsMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.diagnostics, props.files]);

  useEffect(() => {
    applyBreakpointDecorations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.breakpoints, props.files, locale]);

  useEffect(() => {
    applyCurrentLineDecoration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.currentLine, props.activeFile]);

  useEffect(() => {
    if (!props.gotoLine) return;
    if (props.gotoLine.file !== props.activeFile) return;
    const editor = editorRef.current;
    const model = modelsRef.current.get(props.gotoLine.file);
    if (!editor || !model) return;
    if (editor.getModel() !== model) editor.setModel(model);
    const line = Math.min(Math.max(1, props.gotoLine.line), model.getLineCount());
    const column = Math.max(1, Math.min(props.gotoLine.column, model.getLineMaxColumn(line)));
    editor.setPosition({ lineNumber: line, column });
    editor.revealPositionInCenter({ lineNumber: line, column }, monaco.editor.ScrollType.Smooth);
    editor.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.gotoLine, props.activeFile]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: props.settings.fontSize,
      minimap: { enabled: props.settings.minimap },
      wordWrap: props.settings.wordWrap,
    });
  }, [props.settings]);

  function applyDiagnosticsMarkers(): void {
    const byFile = new Map<string, monaco.editor.IMarkerData[]>();
    for (const diagnostic of props.diagnostics) {
      const list = byFile.get(diagnostic.file) ?? [];
      list.push({
        severity:
          diagnostic.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : diagnostic.severity === 'warning'
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
        message: diagnostic.message,
        startLineNumber: diagnostic.line,
        startColumn: Math.max(1, diagnostic.col),
        endLineNumber: diagnostic.line,
        endColumn: Math.max(2, diagnostic.col + 1),
      });
      byFile.set(diagnostic.file, list);
    }
    for (const [filePath, model] of modelsRef.current) {
      monaco.editor.setModelMarkers(model, 'cpplab', byFile.get(filePath) ?? []);
      byFile.delete(filePath);
    }
  }

  function applyBreakpointDecorations(): void {
    const byFile = new Map<string, Array<{ line: number; verified: boolean }>>();
    for (const breakpoint of props.breakpoints) {
      const list = byFile.get(breakpoint.file) ?? [];
      list.push({ line: breakpoint.line, verified: breakpoint.verified });
      byFile.set(breakpoint.file, list);
    }
    for (const [filePath, model] of modelsRef.current) {
      const previous = breakpointDecorations.current.get(filePath) ?? [];
      const decorations = (byFile.get(filePath) ?? []).map((breakpoint) => ({
        range: new monaco.Range(breakpoint.line, 1, breakpoint.line, 1),
        options: {
          glyphMarginClassName: breakpoint.verified ? 'bp-dot' : 'bp-dot-unverified',
          glyphMarginHoverMessage: {
            value: breakpoint.verified ? t('debug.breakpoint.hoverVerified') : t('debug.breakpoint.hoverUnverified'),
          },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      }));
      breakpointDecorations.current.set(filePath, model.deltaDecorations(previous, decorations));
    }
  }

  function applyCurrentLineDecoration(): void {
    const editor = editorRef.current;
    if (!editor) return;
    if (currentDecorationModel.current && !currentDecorationModel.current.isDisposed()) {
      currentDecorationModel.current.deltaDecorations(currentLineDecoration.current ? [currentLineDecoration.current] : [], []);
      currentLineDecoration.current = null;
      currentDecorationModel.current = null;
    }
    const current = props.currentLine;
    if (!current || current.file !== props.activeFile) return;
    const model = modelsRef.current.get(current.file);
    if (!model) return;
    currentLineDecoration.current = model.deltaDecorations([], [
      {
        range: new monaco.Range(current.line, 1, current.line, 1),
        options: {
          isWholeLine: true,
          className: 'current-exec-line',
          linesDecorationsClassName: 'current-exec-gutter',
        },
      },
    ])[0];
    currentDecorationModel.current = model;
    editor.revealLineInCenterIfOutsideViewport(current.line, monaco.editor.ScrollType.Smooth);
  }

  return <div className="editor-host" ref={hostRef} />;
}
