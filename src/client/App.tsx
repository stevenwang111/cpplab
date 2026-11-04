import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Code2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import type {
  CompilerId,
  Diagnostic,
  OptId,
  ProjectState,
  RunDetail,
  RunEvent,
  RunPhase,
  RunResult,
  StdId,
} from '../shared/types';
import { api, wsUrl } from './api';
import { TopBar } from './components/TopBar';
import { EditorToolbar } from './components/EditorToolbar';
import { FileTabs } from './components/FileTabs';
import { CodeEditor, type EditorBreakpoint, type EditorSettings } from './components/CodeEditor';
import { BottomPanel, type BottomTab, type DebugLogEntry } from './components/BottomPanel';
import { DebugPanel, type DebugTab, type WatchExpression } from './components/DebugPanel';
import { StatusBar } from './components/StatusBar';
import { HistoryDrawer } from './components/HistoryDrawer';
import { SettingsPopover } from './components/SettingsPopover';
import { FlagsPopover } from './components/FlagsPopover';
import { FileMenu } from './components/FileMenu';
import { ConfirmModal, HelpModal, NewFileModal } from './components/Modals';
import { ToastStack } from './components/ToastStack';
import { useResizable } from './hooks/useResizable';
import { useToast } from './hooks/useToast';
import { getLocale, t, useLocale } from './i18n';
import { DapClient, type DapBreakpoint, type DapHandlers, type DapScope, type DapStackFrame, type DapVariable, type DebugState } from './debug/dapClient';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

interface RunLimits {
  timeMs: number;
  memoryMb: number;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readString(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // Local storage can be unavailable in private mode; editing still works.
  }
}

export default function App(): JSX.Element {
  const locale = useLocale();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToast();

  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState('');
  const [entry, setEntry] = useState('main.cpp');
  const [compiler, setCompiler] = useState<CompilerId>('g++');
  const [std, setStd] = useState<StdId>('c++20');
  const [opt, setOpt] = useState<OptId>('-O0');
  const [extraFlags, setExtraFlags] = useState<string[]>(() => readJson('cpplab.flags', []));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveState>('saved');
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [gotoLine, setGotoLine] = useState<{ file: string; line: number; column: number; nonce: number } | null>(null);

  const [runPhase, setRunPhase] = useState<RunPhase | null>(null);
  const [runMessage, setRunMessage] = useState('');
  const [liveStdout, setLiveStdout] = useState('');
  const [liveStderr, setLiveStderr] = useState('');
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [bottomTab, setBottomTab] = useState<BottomTab>('output');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [terminalLog, setTerminalLog] = useState<string[]>([]);
  const [stdin, setStdin] = useState<string>(() => readString('cpplab.stdin'));
  const [runLimits, setRunLimits] = useState<RunLimits>(() => readJson('cpplab.runLimits', { timeMs: 2000, memoryMb: 256 }));

  const [debugState, setDebugState] = useState<DebugState>('idle');
  const [debugSession, setDebugSession] = useState<{ sessionId: string; program: string; cwd: string } | null>(null);
  const [debugThreadId, setDebugThreadId] = useState<number | null>(null);
  const [debugTab, setDebugTab] = useState<DebugTab>('stack');
  const [frames, setFrames] = useState<DapStackFrame[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<DapScope[]>([]);
  const [variables, setVariables] = useState<Record<number, DapVariable[]>>({});
  const [expandedVars, setExpandedVars] = useState<Set<number>>(new Set());
  const [loadingRefs, setLoadingRefs] = useState<Set<number>>(new Set());
  const [watches, setWatches] = useState<WatchExpression[]>(() =>
    readJson<string[]>('cpplab.watches', []).map((expression) => ({ expression })),
  );
  const [watchInput, setWatchInput] = useState('');
  const [currentLine, setCurrentLine] = useState<{ file: string; line: number } | null>(null);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const [debugExpression, setDebugExpression] = useState('');
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [breakpoints, setBreakpoints] = useState<EditorBreakpoint[]>(() =>
    readJson<EditorBreakpoint[]>('cpplab.breakpoints', [])
      .filter((item) => item && typeof item.file === 'string' && typeof item.line === 'number')
      .map((item) => ({ file: item.file, line: item.line, verified: false })),
  );

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(() =>
    readJson('cpplab.editor', { fontSize: 13, minimap: true, wordWrap: 'off' as const }),
  );
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const filesRef = useRef(files);
  const activeFileRef = useRef(activeFile);
  const dirtyRef = useRef(dirty);
  const breakpointsRef = useRef(breakpoints);
  const variablesRef = useRef(variables);
  const expandedRef = useRef(expandedVars);
  const watchesRef = useRef(watches);
  const debugStateRef = useRef(debugState);
  const debugThreadRef = useRef<number | null>(null);
  const selectedFrameRef = useRef<number | null>(null);
  const dapRef = useRef<DapClient | null>(null);
  const pauseTokenRef = useRef(0);
  const runSocketRef = useRef<WebSocket | null>(null);
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const logIdRef = useRef(0);
  const gotoNonceRef = useRef(0);
  const lastTerminalPhaseRef = useRef<string>('');
  const cursorRef = useRef(cursor);

  filesRef.current = files;
  activeFileRef.current = activeFile;
  dirtyRef.current = dirty;
  breakpointsRef.current = breakpoints;
  variablesRef.current = variables;
  expandedRef.current = expandedVars;
  watchesRef.current = watches;
  debugStateRef.current = debugState;
  cursorRef.current = cursor;

  const debugResize = useResizable(320, { min: 280, max: 520, storageKey: 'cpplab.debugWidth' });
  const bottomResize = useResizable(220, { min: 150, max: 520, storageKey: 'cpplab.bottomHeight', invert: true });

  const capabilities = projectState?.capabilities ?? null;
  const compilers = capabilities?.compilers ?? [];
  const sandboxReady = capabilities?.sandbox.available ?? false;
  const runBusy = runPhase === 'queued' || runPhase === 'compiling' || runPhase === 'running';
  const debugActive = debugState === 'starting' || debugState === 'running' || debugState === 'paused';
  const canRun = Boolean(activeFile) && sandboxReady && !runBusy && !debugActive;
  const canDebug =
    Boolean(activeFile) &&
    sandboxReady &&
    Boolean(capabilities?.tools.debugger) &&
    !runBusy &&
    !debugActive;

  useEffect(() => {
    saveLocal('cpplab.stdin', stdin);
  }, [stdin]);
  useEffect(() => {
    saveLocal('cpplab.flags', extraFlags);
  }, [extraFlags]);
  useEffect(() => {
    saveLocal('cpplab.runLimits', runLimits);
  }, [runLimits]);
  useEffect(() => {
    saveLocal('cpplab.editor', editorSettings);
  }, [editorSettings]);
  useEffect(() => {
    saveLocal('cpplab.watches', watches.map((watch) => watch.expression));
  }, [watches]);
  useEffect(() => {
    saveLocal(
      'cpplab.breakpoints',
      breakpoints.map(({ file, line }) => ({ file, line })),
    );
  }, [breakpoints]);
  useEffect(() => {
    if (activeFile) saveLocal('cpplab.activeFile', activeFile);
  }, [activeFile]);
  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    void bootstrap();
    return () => {
      for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
      runSocketRef.current?.close();
      dapRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Text the server renders per language (seeded project name, starter-code
    // comment) has to follow a language switch. Skipped while an edit is
    // unsaved: applyProjectState would replace the buffers with the server copy.
    if (!projectState || saveStatus !== 'saved') return;
    void refreshProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  function applyProjectState(state: ProjectState): void {
    setProjectState(state);
    const nextFiles = Object.fromEntries(state.files.map((file) => [file.path, file.content]));
    setFiles(nextFiles);
    filesRef.current = nextFiles;
    setEntry(state.project.settings.entry);
    setCompiler(state.project.settings.compiler);
    setStd(state.project.settings.std);
    setOpt(state.project.settings.opt);
    setDirty(new Set());
    dirtyRef.current = new Set();
    setSaveStatus('saved');

    const stored = readString('cpplab.activeFile');
    const candidate = nextFiles[stored] ? stored : nextFiles[state.project.settings.entry] ? state.project.settings.entry : (Object.keys(nextFiles)[0] ?? '');
    setActiveFile(candidate);
    activeFileRef.current = candidate;
    setOpenTabs((previous) => {
      const valid = previous.filter((file) => nextFiles[file]);
      if (candidate && !valid.includes(candidate)) valid.push(candidate);
      if (nextFiles[state.project.settings.entry] && !valid.includes(state.project.settings.entry)) valid.unshift(state.project.settings.entry);
      return valid;
    });
    setBreakpoints((previous) => {
      const next = previous.filter((breakpoint) => nextFiles[breakpoint.file]).map((breakpoint) => ({ ...breakpoint, verified: false, id: undefined }));
      breakpointsRef.current = next;
      return next;
    });
    setGotoLine(null);
  }

  async function bootstrap(): Promise<void> {
    setLoading(true);
    try {
      const state = await api.project();
      applyProjectState(state);
      setFatalError(null);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : t('app.error.backendUnreachable'));
    } finally {
      setLoading(false);
    }
  }

  async function refreshProject(): Promise<void> {
    try {
      const state = await api.project();
      applyProjectState(state);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : t('app.error.refreshProject'));
    }
  }

  function markDirty(file: string): void {
    setDirty((previous) => {
      const next = new Set(previous);
      next.add(file);
      dirtyRef.current = next;
      return next;
    });
    setSaveStatus('dirty');
  }

  function clearDirty(file: string): void {
    setDirty((previous) => {
      const next = new Set(previous);
      next.delete(file);
      dirtyRef.current = next;
      if (next.size === 0) setSaveStatus('saved');
      return next;
    });
  }

  function handleChange(file: string, value: string): void {
    filesRef.current = { ...filesRef.current, [file]: value };
    setFiles((previous) => ({ ...previous, [file]: value }));
    markDirty(file);
    const existing = saveTimersRef.current.get(file);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(file);
      void persistFile(file, value);
    }, 700);
    saveTimersRef.current.set(file, timer);
  }

  async function persistFile(file: string, value: string): Promise<void> {
    if (filesRef.current[file] !== value) return;
    setSaveStatus('saving');
    try {
      await api.saveFile(file, value);
      if (filesRef.current[file] === value) {
        clearDirty(file);
        if (dirtyRef.current.size === 0) setSaveStatus('saved');
      }
    } catch (error) {
      setSaveStatus('error');
      pushToast('error', error instanceof Error ? error.message : t('app.error.saveFailed'));
    }
  }

  async function saveAll(): Promise<boolean> {
    const current = [...dirtyRef.current];
    if (current.length === 0) return true;
    let ok = true;
    await Promise.all(
      current.map(async (file) => {
        try {
          await persistFile(file, filesRef.current[file] ?? '');
        } catch {
          ok = false;
        }
      }),
    );
    return ok;
  }

  function openFile(file: string, line?: number, column = 1): void {
    if (!filesRef.current[file]) return;
    setOpenTabs((previous) => (previous.includes(file) ? previous : [...previous, file]));
    setActiveFile(file);
    activeFileRef.current = file;
    if (line) {
      gotoNonceRef.current += 1;
      setGotoLine({ file, line, column, nonce: gotoNonceRef.current });
    }
  }

  function appendTerminal(line: string): void {
    setTerminalLog((previous) => {
      const next = [...previous, line];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
  }

  function appendDebug(kind: DebugLogEntry['kind'], text: string): void {
    if (!text) return;
    logIdRef.current += 1;
    const entry = { id: logIdRef.current, kind, text };
    setDebugLog((previous) => {
      const next = [...previous, entry];
      return next.length > 400 ? next.slice(next.length - 400) : next;
    });
  }

  async function updateProjectSettings(patch: Partial<ProjectState['project']['settings']>, name?: string): Promise<void> {
    const previous = projectState;
    if (!previous) return;
    setProjectState({
      ...previous,
      project: {
        ...previous.project,
        name: name ?? previous.project.name,
        settings: { ...previous.project.settings, ...patch },
      },
    });
    try {
      const response = await api.updateProject({ settings: patch, name });
      setProjectState((current) => (current ? { ...current, project: response.project } : current));
    } catch (error) {
      setProjectState(previous);
      pushToast('error', error instanceof Error ? error.message : t('app.error.updateSettings'));
    }
  }

  function handleCompiler(value: CompilerId): void {
    const target = compilers.find((item) => item.id === value);
    if (!target?.available) {
      pushToast('error', t('app.toast.compilerMissing', { name: value }));
      return;
    }
    setCompiler(value);
    void updateProjectSettings({ compiler: value });
  }

  function handleStd(value: StdId): void {
    setStd(value);
    void updateProjectSettings({ std: value });
  }

  function handleOpt(value: OptId): void {
    setOpt(value);
    void updateProjectSettings({ opt: value });
  }

  function handleSetEntry(file: string): void {
    setEntry(file);
    setFileMenuOpen(false);
    void updateProjectSettings({ entry: file });
    pushToast('success', t('app.toast.entrySwitched', { file }));
  }

  function applyRunResult(result: RunResult): void {
    setRunPhase(null);
    setRunMessage('');
    setRunResult(result);
    setLiveStdout(result.stdout);
    setLiveStderr(result.stderr);
    setDiagnostics(result.diagnostics);
    appendTerminal(
      `[result] status=${result.status} exit=${result.exitCode ?? 'null'} signal=${result.signal ?? 'null'} time=${result.timeMs}ms memory=${result.memoryKb}KB`,
    );
    setHistoryVersion((value) => value + 1);
    if (result.status === 'CE') {
      pushToast('error', t('app.toast.compileFailed'));
      setBottomTab('problems');
    } else if (result.status === 'OK') {
      pushToast('success', t('app.toast.runDone', { ms: result.timeMs }));
      setBottomTab('output');
    } else {
      pushToast('error', t('app.toast.runEnded', { status: result.status }));
      setBottomTab('output');
    }
  }

  async function recoverRun(runId: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 200 : 250));
      try {
        const response = await api.runResult(runId);
        if (response.result) {
          applyRunResult(response.result);
          return;
        }
        if (response.done) break;
      } catch {
        // The backend may still be recording the result; retry briefly.
      }
    }
    pushToast('error', t('app.toast.runDisconnected'));
    setRunPhase(null);
  }

  async function handleRun(): Promise<void> {
    if (!canRun) return;
    if (dirtyRef.current.size > 0) await saveAll();
    runSocketRef.current?.close();
    setRunResult(null);
    setDiagnostics([]);
    setLiveStdout('');
    setLiveStderr('');
    setRunPhase('queued');
    setRunMessage(t('app.run.waitingSlot'));
    setBottomTab('output');
    setBottomCollapsed(false);
    setCurrentLine(null);
    lastTerminalPhaseRef.current = '';
    appendTerminal(`$ ${compiler} -std=${std} ${opt} ${extraFlags.join(' ')} /workspace/${entry} -o /workspace/prog`.replace(/\s+/g, ' '));
    appendTerminal(
      `[sandbox] nsjail · ${t('app.term.sandboxRootfs')} · ${t('app.term.sandboxNoNetwork')} · ${t('app.term.sandboxMemory', { n: runLimits.memoryMb })} · ${t('app.term.sandboxTimeLimit', { n: runLimits.timeMs })}`,
    );

    try {
      const response = await api.run({
        files: filesRef.current,
        entry,
        compiler,
        std,
        opt,
        extraFlags,
        stdin,
        limits: { timeMs: runLimits.timeMs, memoryMb: runLimits.memoryMb, outputBytes: 65536 },
      });
      let gotResult = false;
      const socket = new WebSocket(wsUrl(response.wsPath));
      runSocketRef.current = socket;
      socket.onmessage = (event) => {
        let runEvent: RunEvent;
        try {
          runEvent = JSON.parse(event.data) as RunEvent;
        } catch {
          return;
        }
        if (runEvent.type === 'phase') {
          setRunPhase(runEvent.phase);
          if (runEvent.message) setRunMessage(runEvent.message);
          if (runEvent.phase === 'compiling' && lastTerminalPhaseRef.current !== 'compiling') {
            lastTerminalPhaseRef.current = 'compiling';
            appendTerminal(`[compile] ${t('app.term.compiling')}`);
          }
          if (runEvent.phase === 'running' && lastTerminalPhaseRef.current !== 'running') {
            lastTerminalPhaseRef.current = 'running';
            appendTerminal('$ /workspace/prog');
          }
        } else if (runEvent.type === 'stdout') {
          setLiveStdout((previous) => previous + runEvent.data);
        } else if (runEvent.type === 'stderr') {
          setLiveStderr((previous) => previous + runEvent.data);
        } else if (runEvent.type === 'error') {
          pushToast('error', runEvent.message);
          setLiveStderr((previous) => previous + (previous ? '\n' : '') + runEvent.message);
        } else if (runEvent.type === 'result') {
          gotResult = true;
          applyRunResult(runEvent.result);
        }
      };
      socket.onerror = () => {
        // The close handler runs the recovery path.
      };
      socket.onclose = () => {
        if (runSocketRef.current === socket) runSocketRef.current = null;
        if (!gotResult) void recoverRun(response.runId);
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t('app.error.runRequestFailed');
      setRunPhase(null);
      setLiveStderr(message);
      setBottomTab('output');
      pushToast('error', message);
    }
  }

  async function handleFormat(): Promise<void> {
    if (!activeFile || runBusy) return;
    const content = filesRef.current[activeFile];
    if (content === undefined) return;
    try {
      const response = await api.format(activeFile, content);
      if (!response.changed) {
        pushToast('info', t('app.toast.alreadyFormatted'));
        return;
      }
      filesRef.current = { ...filesRef.current, [activeFile]: response.formatted };
      setFiles((previous) => ({ ...previous, [activeFile]: response.formatted }));
      markDirty(activeFile);
      await persistFile(activeFile, response.formatted);
      pushToast('success', t('app.toast.formatted'));
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : t('app.error.formatFailed'));
    }
  }

  function sourceToFile(sourcePath?: string): string | null {
    if (!sourcePath) return null;
    if (sourcePath.startsWith('/workspace/')) {
      const relative = sourcePath.slice('/workspace/'.length);
      return filesRef.current[relative] !== undefined ? relative : null;
    }
    if (sourcePath.startsWith('/')) return null;
    return filesRef.current[sourcePath] !== undefined ? sourcePath : null;
  }

  function updateVerified(file: string, lines: number[], verified: boolean[], ids: Array<number | undefined> = []): void {
    setBreakpoints((previous) => {
      const next = previous.map((breakpoint) => {
        if (breakpoint.file !== file) return breakpoint;
        const index = lines.indexOf(breakpoint.line);
        if (index < 0) return breakpoint;
        return { ...breakpoint, verified: Boolean(verified[index]), id: ids[index] ?? breakpoint.id };
      });
      breakpointsRef.current = next;
      return next;
    });
  }

  function handleToggleBreakpoint(line: number): void {
    const file = activeFileRef.current;
    if (!file) return;
    const previous = breakpointsRef.current;
    const existing = previous.find((breakpoint) => breakpoint.file === file && breakpoint.line === line);
    const next = existing
      ? previous.filter((breakpoint) => !(breakpoint.file === file && breakpoint.line === line))
      : [...previous, { file, line, verified: false }].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    breakpointsRef.current = next;
    setBreakpoints(next);
    if (debugStateRef.current === 'running' || debugStateRef.current === 'paused') {
      const lines = next.filter((breakpoint) => breakpoint.file === file).map((breakpoint) => breakpoint.line);
      void dapRef.current
        ?.setBreakpoints(file, lines)
        .then((result) => updateVerified(file, lines, result.map((item) => item.verified), result.map((item) => item.id)))
        .catch((error) => pushToast('error', error instanceof Error ? error.message : t('app.error.syncBreakpoints')));
    }
  }

  function handleBreakpointResponse(file: string, lines: number[], result: DapBreakpoint[]): void {
    updateVerified(file, lines, result.map((item) => item.verified), result.map((item) => item.id));
  }

  function handleBreakpointEvent(breakpoint: DapBreakpoint): void {
    const file = breakpoint.source?.path ? sourceToFile(breakpoint.source.path) : null;
    if (breakpoint.id === undefined && breakpoint.line === undefined) return;
    setBreakpoints((previous) => {
      const next = previous.map((item) => {
        if (breakpoint.id !== undefined) {
          return item.id === breakpoint.id ? { ...item, verified: Boolean(breakpoint.verified) } : item;
        }
        if (file && item.file !== file) return item;
        if (breakpoint.line !== undefined && item.line !== breakpoint.line) return item;
        return { ...item, verified: Boolean(breakpoint.verified) };
      });
      breakpointsRef.current = next;
      return next;
    });
  }

  async function loadVariables(reference: number, token: number): Promise<void> {
    const dap = dapRef.current;
    if (!dap || variablesRef.current[reference] || loadingRefs.has(reference)) return;
    setLoadingRefs((previous) => new Set(previous).add(reference));
    try {
      const result = await dap.variables(reference);
      if (token !== pauseTokenRef.current) return;
      setVariables((previous) => ({ ...previous, [reference]: result }));
    } catch (error) {
      if (token === pauseTokenRef.current) {
        appendDebug('error', error instanceof Error ? error.message : t('app.error.loadVariables'));
      }
    } finally {
      setLoadingRefs((previous) => {
        const next = new Set(previous);
        next.delete(reference);
        return next;
      });
    }
  }

  async function loadFrame(frame: DapStackFrame, token: number): Promise<void> {
    const dap = dapRef.current;
    if (!dap) return;
    selectedFrameRef.current = frame.id;
    setSelectedFrameId(frame.id);
    const file = sourceToFile(frame.source?.path);
    if (file) {
      openFile(file, frame.line, frame.column);
      setCurrentLine({ file, line: frame.line });
    } else {
      setCurrentLine(null);
    }
    try {
      const nextScopes = await dap.scopes(frame.id);
      if (token !== pauseTokenRef.current) return;
      setScopes(nextScopes);
      setVariables({});
      variablesRef.current = {};
      const emptyExpanded = new Set<number>();
      expandedRef.current = emptyExpanded;
      setExpandedVars(emptyExpanded);
      const localScope = nextScopes.find((scope) => /^locals?$/i.test(scope.name)) ?? nextScopes.find((scope) => scope.variablesReference > 0);
      if (localScope) {
        const nextExpanded = new Set([localScope.variablesReference]);
        expandedRef.current = nextExpanded;
        setExpandedVars(nextExpanded);
        void loadVariables(localScope.variablesReference, token);
      }
      await refreshWatches(frame.id, token);
    } catch (error) {
      if (token === pauseTokenRef.current) {
        appendDebug('error', error instanceof Error ? error.message : t('app.error.loadScopes'));
      }
    }
  }

  async function refreshWatches(frameId: number, token: number): Promise<void> {
    const dap = dapRef.current;
    if (!dap || watchesRef.current.length === 0) return;
    setWatches((previous) => previous.map((watch) => ({ ...watch, loading: true, error: undefined })));
    await Promise.all(
      watchesRef.current.map(async (watch) => {
        try {
          const result = await dap.evaluate(watch.expression, frameId, 'watch');
          if (token !== pauseTokenRef.current) return;
          setWatches((previous) =>
            previous.map((item) =>
              item.expression === watch.expression
                ? { ...item, loading: false, value: result.result, type: result.type, error: undefined }
                : item,
            ),
          );
        } catch (error) {
          if (token !== pauseTokenRef.current) return;
          setWatches((previous) =>
            previous.map((item) =>
              item.expression === watch.expression
                ? { ...item, loading: false, error: error instanceof Error ? error.message : t('app.error.evaluateFailed') }
                : item,
            ),
          );
        }
      }),
    );
  }

  async function handleStopped(body: { threadId: number; reason: string; description?: string }): Promise<void> {
    const token = ++pauseTokenRef.current;
    debugThreadRef.current = body.threadId;
    setDebugThreadId(body.threadId);
    setFrames([]);
    setSelectedFrameId(null);
    setScopes([]);
    setVariables({});
    appendDebug('system', t('app.debug.paused', { reason: body.description ?? body.reason }));
    const dap = dapRef.current;
    if (!dap) return;
    try {
      const nextFrames = await dap.stackTrace(body.threadId);
      if (token !== pauseTokenRef.current) return;
      setFrames(nextFrames);
      setDebugTab('stack');
      if (nextFrames[0]) await loadFrame(nextFrames[0], token);
    } catch (error) {
      if (token === pauseTokenRef.current) {
        appendDebug('error', error instanceof Error ? error.message : t('app.error.loadStack'));
      }
    }
  }

  function debugHandlers(): DapHandlers {
    return {
      onState: (state) => {
        debugStateRef.current = state;
        setDebugState(state);
        if (state === 'running') {
          setCurrentLine(null);
        }
        if (state === 'terminated') {
          pauseTokenRef.current += 1;
          setCurrentLine(null);
          setFrames([]);
          setScopes([]);
          setSelectedFrameId(null);
          setDebugSession(null);
        }
      },
      onStopped: (body) => {
        void handleStopped(body);
      },
      onContinued: () => {
        pauseTokenRef.current += 1;
        setCurrentLine(null);
        setFrames([]);
        setScopes([]);
        setVariables({});
        setSelectedFrameId(null);
        setWatches((previous) => previous.map((watch) => ({ expression: watch.expression })));
        appendDebug('system', t('app.debug.continued'));
      },
      onOutput: (body) => {
        const kind = body.category === 'stdout' ? 'stdout' : body.category === 'stderr' ? 'stderr' : 'console';
        appendDebug(kind, body.output);
      },
      onTerminated: (message) => {
        appendDebug('system', message ? t('app.debug.endedWith', { reason: message }) : t('app.debug.ended'));
        setDebugState('terminated');
        debugStateRef.current = 'terminated';
        setDebugSession(null);
        setCurrentLine(null);
      },
      onExited: (exitCode) => {
        appendDebug('system', t('app.debug.programExited', { code: exitCode }));
      },
      onLog: (message) => appendDebug('console', message),
      onBreakpoint: (breakpoint) => handleBreakpointEvent(breakpoint),
      onBreakpoints: (file, result) => {
        const lines = breakpointsRef.current.filter((item) => item.file === file).map((item) => item.line);
        handleBreakpointResponse(file, lines, result);
      },
      onCapabilities: () => undefined,
      onError: (message) => {
        appendDebug('error', message);
        pushToast('error', message);
      },
    };
  }

  async function handleStartDebug(): Promise<void> {
    if (!canDebug) return;
    if (dirtyRef.current.size > 0) await saveAll();
    pauseTokenRef.current += 1;
    setBreakpoints((previous) => {
      const next = previous.map((breakpoint) => ({ ...breakpoint, id: undefined, verified: false }));
      breakpointsRef.current = next;
      return next;
    });
    setDebugLog([]);
    setFrames([]);
    setScopes([]);
    setVariables({});
    const emptyExpanded = new Set<number>();
    expandedRef.current = emptyExpanded;
    setExpandedVars(emptyExpanded);
    setCurrentLine(null);
    setSelectedFrameId(null);
    setDebugThreadId(null);
    setDebugState('starting');
    debugStateRef.current = 'starting';
    setBottomTab('debug');
    setBottomCollapsed(false);
    setDiagnostics([]);
    setDebugTab('stack');
    appendDebug('system', t('app.debug.compilingTarget'));
    appendTerminal(`[debug] ${compiler} -std=${std} -g -O0 /workspace/${entry} -o /workspace/prog`);

    try {
      const response = await api.startDebug({
        files: filesRef.current,
        entry,
        compiler,
        std,
        extraFlags,
      });
      if ('sessionId' in response) {
        const breakpointMap: Record<string, number[]> = {};
        for (const breakpoint of breakpointsRef.current) {
          (breakpointMap[breakpoint.file] ??= []).push(breakpoint.line);
        }
        setDebugSession({ sessionId: response.sessionId, program: response.program, cwd: response.cwd });
        const client = new DapClient(response.sessionId, {
          program: response.program,
          cwd: response.cwd,
          breakpoints: breakpointMap,
          handlers: debugHandlers(),
        });
        dapRef.current = client;
        client.connect();
        appendDebug('system', t('app.debug.lldbStarted', { cwd: response.cwd, ms: response.compileTimeMs }));
        appendTerminal(`[debug] ${t('app.term.debugSessionCreated', { id: response.sessionId.slice(0, 8) })}`);
      } else {
        setDiagnostics((response.diagnostics ?? []) as Diagnostic[]);
        setDebugState('idle');
        debugStateRef.current = 'idle';
        setBottomTab('problems');
        pushToast('error', t('app.error.debugCompileFailed'));
        appendDebug('error', response.compileOutput || t('app.error.debugCompileFailed'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('app.error.startDebugFailed');
      setDebugState('terminated');
      debugStateRef.current = 'terminated';
      setDebugSession(null);
      appendDebug('error', message);
      pushToast('error', message);
    }
  }

  async function handleStopDebug(): Promise<void> {
    const dap = dapRef.current;
    dapRef.current = null;
    pauseTokenRef.current += 1;
    if (dap) void dap.disconnect();
    if (debugSession) void api.stopDebug(debugSession.sessionId).catch(() => undefined);
    setDebugState('terminated');
    debugStateRef.current = 'terminated';
    setDebugSession(null);
    setCurrentLine(null);
    setFrames([]);
    setScopes([]);
    setSelectedFrameId(null);
    appendDebug('system', t('app.debug.sessionStopped'));
    appendTerminal(`[debug] ${t('app.term.debugSessionStopped')}`);
  }

  function ensurePaused(): boolean {
    if (debugStateRef.current !== 'paused') {
      pushToast('info', t('app.toast.needPaused'));
      return false;
    }
    return true;
  }

  function handleContinue(): void {
    if (!debugThreadRef.current || !dapRef.current) return;
    void dapRef.current.continue(debugThreadRef.current).catch((error) => pushToast('error', error.message));
  }

  function handlePause(): void {
    if (!debugThreadRef.current || !dapRef.current) return;
    void dapRef.current.pause(debugThreadRef.current).catch((error) => pushToast('error', error.message));
  }

  function handleNext(): void {
    if (!ensurePaused() || !debugThreadRef.current || !dapRef.current) return;
    void dapRef.current.next(debugThreadRef.current).catch((error) => pushToast('error', error.message));
  }

  function handleStepIn(): void {
    if (!ensurePaused() || !debugThreadRef.current || !dapRef.current) return;
    void dapRef.current.stepIn(debugThreadRef.current).catch((error) => pushToast('error', error.message));
  }

  function handleStepOut(): void {
    if (!ensurePaused() || !debugThreadRef.current || !dapRef.current) return;
    void dapRef.current.stepOut(debugThreadRef.current).catch((error) => pushToast('error', error.message));
  }

  function handleRestart(): void {
    if (!dapRef.current) return;
    pauseTokenRef.current += 1;
    setCurrentLine(null);
    setFrames([]);
    setScopes([]);
    setSelectedFrameId(null);
    void dapRef.current.restart().catch((error) => pushToast('error', error.message));
    appendDebug('system', t('app.debug.restarted'));
  }

  function handleSelectFrame(frame: DapStackFrame): void {
    void loadFrame(frame, pauseTokenRef.current);
  }

  function handleExpandVariable(reference: number): void {
    if (expandedRef.current.has(reference)) {
      const next = new Set(expandedRef.current);
      next.delete(reference);
      expandedRef.current = next;
      setExpandedVars(next);
      return;
    }
    const next = new Set(expandedRef.current);
    next.add(reference);
    expandedRef.current = next;
    setExpandedVars(next);
    void loadVariables(reference, pauseTokenRef.current);
  }

  async function evaluateWatch(expression: string, frameId: number, token: number): Promise<void> {
    const dap = dapRef.current;
    if (!dap) return;
    setWatches((previous) => previous.map((watch) => (watch.expression === expression ? { ...watch, loading: true } : watch)));
    try {
      const result = await dap.evaluate(expression, frameId, 'watch');
      if (token !== pauseTokenRef.current) return;
      setWatches((previous) =>
        previous.map((watch) =>
          watch.expression === expression
            ? { ...watch, loading: false, value: result.result, type: result.type, error: undefined }
            : watch,
        ),
      );
    } catch (error) {
      if (token !== pauseTokenRef.current) return;
      setWatches((previous) =>
        previous.map((watch) =>
          watch.expression === expression
            ? { ...watch, loading: false, error: error instanceof Error ? error.message : t('app.error.evaluateFailed') }
            : watch,
        ),
      );
    }
  }

  function handleAddWatch(): void {
    const expression = watchInput.trim();
    if (!expression) return;
    if (watchesRef.current.some((watch) => watch.expression === expression)) {
      pushToast('info', t('app.toast.watchExists'));
      return;
    }
    const next = [...watchesRef.current, { expression }];
    watchesRef.current = next;
    setWatches(next);
    setWatchInput('');
    if (debugStateRef.current === 'paused' && selectedFrameRef.current !== null) {
      void evaluateWatch(expression, selectedFrameRef.current, pauseTokenRef.current);
    }
  }

  function handleRemoveWatch(expression: string): void {
    const next = watchesRef.current.filter((watch) => watch.expression !== expression);
    watchesRef.current = next;
    setWatches(next);
  }

  async function handleEvaluateRepl(): Promise<void> {
    const expression = debugExpression.trim();
    if (!expression) return;
    if (!ensurePaused() || selectedFrameRef.current === null || !dapRef.current) return;
    setEvaluationBusy(true);
    appendDebug('repl', `› ${expression}`);
    try {
      const result = await dapRef.current.evaluate(expression, selectedFrameRef.current, 'repl');
      appendDebug('repl', `${result.result}${result.type ? `  (${result.type})` : ''}`);
      setDebugExpression('');
    } catch (error) {
      appendDebug('error', error instanceof Error ? error.message : t('app.error.evaluateFailed'));
    } finally {
      setEvaluationBusy(false);
    }
  }

  function handleOpenProblem(diagnostic: Diagnostic): void {
    if (!filesRef.current[diagnostic.file]) {
      pushToast('error', t('app.toast.fileNotInWorkspace', { file: diagnostic.file }));
      return;
    }
    openFile(diagnostic.file, diagnostic.line, diagnostic.col);
  }

  function handleViewRun(run: RunDetail): void {
    setRunResult(run);
    setLiveStdout(run.stdout);
    setLiveStderr(run.stderr);
    setDiagnostics(run.diagnostics);
    setRunPhase(null);
    setBottomTab('output');
    setBottomCollapsed(false);
    appendTerminal(`[history] ${t('app.term.historyLoaded', { when: new Date(run.createdAt).toLocaleString(getLocale()) })}`);
    setHistoryOpen(false);
  }

  async function handleCreateFile(path: string): Promise<void> {
    const content = `// ${path}\n`;
    await api.saveFile(path, content);
    filesRef.current = { ...filesRef.current, [path]: content };
    setFiles((previous) => ({ ...previous, [path]: content }));
    setOpenTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));
    setActiveFile(path);
    activeFileRef.current = path;
    appendTerminal(`[file] ${t('app.term.fileCreated', { path })}`);
  }

  async function handleDeleteFile(): Promise<void> {
    const file = deleteTarget;
    if (!file) return;
    const pending = saveTimersRef.current.get(file);
    if (pending) {
      window.clearTimeout(pending);
      saveTimersRef.current.delete(file);
    }
    try {
      await api.deleteFile(file);
      const nextFiles = { ...filesRef.current };
      delete nextFiles[file];
      filesRef.current = nextFiles;
      setFiles(nextFiles);
      const nextTabs = openTabs.filter((item) => item !== file);
      const fallback = nextFiles[entry] ? entry : (Object.keys(nextFiles)[0] ?? '');
      if (fallback && !nextTabs.includes(fallback)) nextTabs.unshift(fallback);
      setOpenTabs(nextTabs);
      if (activeFile === file) {
        setActiveFile(fallback);
        activeFileRef.current = fallback;
      }
      const nextBreakpoints = breakpointsRef.current.filter((breakpoint) => breakpoint.file !== file);
      breakpointsRef.current = nextBreakpoints;
      setBreakpoints(nextBreakpoints);
      pushToast('success', t('app.toast.deletedFile', { file }));
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : t('app.error.deleteFileFailed'));
    } finally {
      setDeleteTarget(null);
    }
  }

  function handleCloseTab(file: string): void {
    const index = openTabs.indexOf(file);
    const nextTabs = openTabs.filter((item) => item !== file);
    setOpenTabs(nextTabs);
    if (activeFile === file) {
      const fallback = nextTabs[Math.max(0, index - 1)] ?? (files[entry] ? entry : Object.keys(files)[0] ?? '');
      setActiveFile(fallback);
      activeFileRef.current = fallback;
      if (fallback && !nextTabs.includes(fallback)) setOpenTabs([...nextTabs, fallback]);
    }
  }

  function handleToggleBreakpointAt(file: string, line: number): void {
    if (file !== activeFileRef.current) openFile(file);
    setBreakpoints((previous) => {
      const next = previous.filter((breakpoint) => !(breakpoint.file === file && breakpoint.line === line));
      breakpointsRef.current = next;
      return next;
    });
    if (debugStateRef.current === 'running' || debugStateRef.current === 'paused') {
      const lines = breakpointsRef.current.filter((breakpoint) => breakpoint.file === file).map((breakpoint) => breakpoint.line);
      void dapRef.current
        ?.setBreakpoints(file, lines)
        .then((result) => updateVerified(file, lines, result.map((item) => item.verified), result.map((item) => item.id)))
        .catch(() => undefined);
    }
  }

  function handleClearOutput(): void {
    if (bottomTab === 'output') {
      setLiveStdout('');
      setLiveStderr('');
      setRunResult(null);
      setDiagnostics([]);
    } else if (bottomTab === 'debug') {
      setDebugLog([]);
    } else if (bottomTab === 'terminal') {
      setTerminalLog([]);
    } else if (bottomTab === 'problems') {
      setDiagnostics([]);
    } else if (bottomTab === 'stdin') {
      setStdin('');
    }
  }

  const actionsRef = useRef({
    run: handleRun,
    startDebug: handleStartDebug,
    stopDebug: handleStopDebug,
    continue: handleContinue,
    pause: handlePause,
    next: handleNext,
    stepIn: handleStepIn,
    stepOut: handleStepOut,
    format: handleFormat,
    save: saveAll,
    toggleBreakpoint: handleToggleBreakpoint,
  });
  actionsRef.current = {
    run: handleRun,
    startDebug: handleStartDebug,
    stopDebug: handleStopDebug,
    continue: handleContinue,
    pause: handlePause,
    next: handleNext,
    stepIn: handleStepIn,
    stepOut: handleStepOut,
    format: handleFormat,
    save: saveAll,
    toggleBreakpoint: handleToggleBreakpoint,
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const inMonaco = Boolean(target?.closest('.monaco-editor'));
      const editing =
        !inMonaco &&
        (target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.tagName === 'SELECT' ||
          target?.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === 'F5') {
        event.preventDefault();
        if (event.shiftKey) {
          void actionsRef.current.stopDebug();
        } else if (debugStateRef.current === 'paused') {
          actionsRef.current.continue();
        } else if (debugStateRef.current === 'running') {
          actionsRef.current.pause();
        } else {
          void actionsRef.current.startDebug();
        }
        return;
      }
      if (event.key === 'F9') {
        event.preventDefault();
        actionsRef.current.toggleBreakpoint(cursorRef.current.line);
        return;
      }
      if (event.key === 'F10') {
        event.preventDefault();
        actionsRef.current.next();
        return;
      }
      if (event.key === 'F11') {
        event.preventDefault();
        if (event.shiftKey) actionsRef.current.stepOut();
        else actionsRef.current.stepIn();
        return;
      }
      if (editing) return;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void actionsRef.current.save();
        return;
      }
      if (mod && event.key === 'Enter') {
        event.preventDefault();
        void actionsRef.current.run();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void actionsRef.current.format();
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const workspaceStyle = {
    '--debug-width': `${debugResize.size}px`,
  } as React.CSSProperties & Record<string, string>;
  const mainStyle = {
    '--bottom-height': `${bottomResize.size}px`,
  } as React.CSSProperties & Record<string, string>;

  const fileNames = useMemo(() => Object.keys(files).sort(), [files]);

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <Code2 size={30} />
        </div>
        <h1>CppLab</h1>
        <p>{t('app.boot.connecting')}</p>
        <Loader2 size={20} className="spin" />
      </div>
    );
  }

  if (fatalError || !projectState) {
    return (
      <div className="boot-screen">
        <div className="boot-mark error">
          <AlertTriangle size={28} />
        </div>
        <h1>{t('app.boot.loadFailed')}</h1>
        <p>{fatalError ?? t('app.boot.noProjectData')}</p>
        <button type="button" className="btn btn-primary" onClick={() => void bootstrap()}>
          <RefreshCw size={15} /> {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar
        projectName={projectState.project.name}
        saveState={saveStatus}
        runPhase={runPhase}
        debugState={debugState}
        canRun={canRun}
        canDebug={canDebug}
        onRun={() => void handleRun()}
        onDebug={() => void handleStartDebug()}
        onStopDebug={() => void handleStopDebug()}
        onFormat={() => void handleFormat()}
        onOpenHistory={() => {
          setSettingsOpen(false);
          setFlagsOpen(false);
          setFileMenuOpen(false);
          setHistoryOpen(true);
        }}
        onOpenSettings={() => {
          setFlagsOpen(false);
          setFileMenuOpen(false);
          setSettingsOpen(true);
        }}
        onOpenHelp={() => {
          setSettingsOpen(false);
          setFlagsOpen(false);
          setFileMenuOpen(false);
          setHelpOpen(true);
        }}
      />

      {!sandboxReady && (
        <div className="system-banner">
          <ShieldAlert size={15} />
          <span>
            {t('app.banner.sandboxNotReady')}
            {capabilities?.sandbox.detail ?? t('app.banner.sandboxNoNsjail')}
            {t('app.banner.sandboxHint')}
            <code>npm run sandbox:setup</code>
            {t('app.banner.sandboxSuffix')}
          </span>
        </div>
      )}

      <div className="workspace" style={workspaceStyle}>
        <main className="main-column" style={mainStyle}>
          <section className="editor-card panel-card">
            <EditorToolbar
              compilers={compilers}
              stds={capabilities?.stds ?? ['c++17', 'c++20', 'c++23']}
              opts={capabilities?.opts ?? ['-O0', '-O1', '-O2', '-O3', '-Os']}
              compiler={compiler}
              std={std}
              opt={opt}
              extraFlags={extraFlags}
              entry={entry}
              onCompiler={handleCompiler}
              onStd={handleStd}
              onOpt={handleOpt}
              onOpenFlags={() => {
                setSettingsOpen(false);
                setFileMenuOpen(false);
                setFlagsOpen(true);
              }}
              onOpenFiles={() => {
                setSettingsOpen(false);
                setFlagsOpen(false);
                setFileMenuOpen(true);
              }}
              onNewFile={() => setNewFileOpen(true)}
            />
            <FileTabs
              openTabs={openTabs}
              files={files}
              activeFile={activeFile}
              entry={entry}
              dirty={dirty}
              onSelect={openFile}
              onClose={handleCloseTab}
              onNewFile={() => setNewFileOpen(true)}
            />
            <div className="editor-area">
              {activeFile ? (
                <CodeEditor
                  files={files}
                  activeFile={activeFile}
                  diagnostics={diagnostics}
                  breakpoints={breakpoints}
                  currentLine={currentLine}
                  gotoLine={gotoLine}
                  settings={editorSettings}
                  onChange={handleChange}
                  onCursor={(line, column) => setCursor({ line, column })}
                  onToggleBreakpoint={handleToggleBreakpoint}
                  onSave={() => void saveAll()}
                />
              ) : (
                <div className="editor-empty">{t('app.editor.emptyFiles')}</div>
              )}
            </div>
          </section>

          {!bottomCollapsed && (
            <div
              className={`resizer horizontal ${bottomResize.dragging ? 'dragging' : ''}`}
              onPointerDown={bottomResize.startDrag}
              title={t('app.resizer.bottomHeight')}
            />
          )}

          <BottomPanel
            activeTab={bottomTab}
            onTabChange={setBottomTab}
            collapsed={bottomCollapsed}
            onToggleCollapse={() => setBottomCollapsed((value) => !value)}
            runPhase={runPhase}
            runMessage={runMessage}
            liveStdout={liveStdout}
            liveStderr={liveStderr}
            result={runResult}
            diagnostics={diagnostics}
            stdin={stdin}
            onStdinChange={(value) => setStdin(value.slice(0, capabilities?.limits.maxStdinBytes ?? 1024 * 1024))}
            stdinLimit={capabilities?.limits.maxStdinBytes ?? 1024 * 1024}
            terminalLog={terminalLog}
            debugLog={debugLog}
            debugState={debugState}
            debugExpression={debugExpression}
            onDebugExpressionChange={setDebugExpression}
            onEvaluate={() => void handleEvaluateRepl()}
            evaluationBusy={evaluationBusy}
            onProblemClick={handleOpenProblem}
            onClearOutput={handleClearOutput}
          />
        </main>

        <div
          className={`resizer vertical ${debugResize.dragging ? 'dragging' : ''}`}
          onPointerDown={debugResize.startDrag}
          title={t('app.resizer.debugWidth')}
        />

        <DebugPanel
          state={debugState}
          breakpoints={breakpoints}
          frames={frames}
          selectedFrameId={selectedFrameId}
          scopes={scopes}
          variables={variables}
          expanded={expandedVars}
          loadingRefs={loadingRefs}
          watches={watches}
          watchInput={watchInput}
          activeTab={debugTab}
          onTabChange={setDebugTab}
          onStart={() => void handleStartDebug()}
          onStop={() => void handleStopDebug()}
          onContinue={handleContinue}
          onPause={handlePause}
          onNext={handleNext}
          onStepIn={handleStepIn}
          onStepOut={handleStepOut}
          onRestart={handleRestart}
          onSelectFrame={handleSelectFrame}
          onExpandVariable={handleExpandVariable}
          onWatchInputChange={setWatchInput}
          onAddWatch={handleAddWatch}
          onRemoveWatch={handleRemoveWatch}
          onOpenBreakpoint={(breakpoint) => openFile(breakpoint.file, breakpoint.line)}
          onRemoveBreakpoint={(breakpoint) => handleToggleBreakpointAt(breakpoint.file, breakpoint.line)}
        />
      </div>

      <StatusBar
        activeFile={activeFile}
        cursor={cursor}
        compiler={compiler}
        std={std}
        capabilities={capabilities!}
        saveState={saveStatus}
        runPhase={runPhase}
        runResult={runResult}
        debugState={debugState}
      />

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onViewRun={handleViewRun}
        onRestored={() => void refreshProject()}
        pushToast={pushToast}
        refreshKey={historyVersion}
      />

      {settingsOpen && (
        <SettingsPopover
          settings={editorSettings}
          projectName={projectState.project.name}
          runLimits={runLimits}
          onRunLimitsChange={setRunLimits}
          onChange={setEditorSettings}
          onRenameProject={async (name) => {
            await updateProjectSettings({}, name);
            pushToast('success', t('app.toast.projectRenamed'));
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {flagsOpen && (
        <FlagsPopover
          flags={extraFlags}
          onChange={(flags) => setExtraFlags(flags.slice(0, 12))}
          onClose={() => setFlagsOpen(false)}
        />
      )}

      {fileMenuOpen && (
        <FileMenu
          files={fileNames}
          entry={entry}
          activeFile={activeFile}
          onSelect={(file) => {
            openFile(file);
            setFileMenuOpen(false);
          }}
          onDelete={(file) => {
            setFileMenuOpen(false);
            setDeleteTarget(file);
          }}
          onSetEntry={handleSetEntry}
          onNewFile={() => {
            setFileMenuOpen(false);
            setNewFileOpen(true);
          }}
          onClose={() => setFileMenuOpen(false)}
        />
      )}

      <NewFileModal
        open={newFileOpen}
        existing={fileNames}
        onClose={() => setNewFileOpen(false)}
        onSubmit={handleCreateFile}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        title={t('app.delete.fileTitle')}
        message={t('app.delete.fileMessage', { file: deleteTarget ?? '' })}
        confirmLabel={t('common.delete')}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteFile()}
      />

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
