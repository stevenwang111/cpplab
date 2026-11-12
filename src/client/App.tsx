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
import { api } from './api';
import { TopBar } from './components/TopBar';
import { EditorToolbar } from './components/EditorToolbar';
import { FileTabs } from './components/FileTabs';
import { CodeEditor, type EditorSettings } from './components/CodeEditor';
import { BottomPanel, type BottomTab } from './components/BottomPanel';
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
import { warmup } from './wasm/toolchain';
import { ensureCrossOriginIsolation } from './wasm/isolation';
import { TOOLCHAIN_MIN_DOWNLOAD_MB } from './wasm/constants';

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
  const [compiler, setCompiler] = useState<CompilerId>('clang++');
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
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const gotoNonceRef = useRef(0);
  const lastTerminalPhaseRef = useRef<string>('');
  const cursorRef = useRef(cursor);
  const runTokenRef = useRef(0);

  filesRef.current = files;
  activeFileRef.current = activeFile;
  dirtyRef.current = dirty;
  cursorRef.current = cursor;

  const bottomResize = useResizable(220, { min: 150, max: 520, storageKey: 'cpplab.bottomHeight', invert: true });

  const capabilities = projectState?.capabilities ?? null;
  const compilers = capabilities?.compilers ?? [];
  const toolchainReady = capabilities?.toolchain.available !== false;
  const runBusy = runPhase === 'queued' || runPhase === 'compiling' || runPhase === 'running';
  const canRun = Boolean(activeFile) && toolchainReady && !runBusy;

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
    if (activeFile) saveLocal('cpplab.activeFile', activeFile);
  }, [activeFile]);
  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    void bootstrap();
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1200));
    const handle = idle(() => void warmup());
    return () => {
      for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Text the client renders per language (seeded project name, starter-code
    // comment) has to follow a language switch. Skipped while an edit is
    // unsaved: applyProjectState would replace the buffers with stored copies.
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
    const candidate = nextFiles[stored]
      ? stored
      : nextFiles[state.project.settings.entry]
        ? state.project.settings.entry
        : (Object.keys(nextFiles)[0] ?? '');
    setActiveFile(candidate);
    activeFileRef.current = candidate;
    setOpenTabs((previous) => {
      const valid = previous.filter((file) => nextFiles[file]);
      if (candidate && !valid.includes(candidate)) valid.push(candidate);
      if (nextFiles[state.project.settings.entry] && !valid.includes(state.project.settings.entry)) {
        valid.unshift(state.project.settings.entry);
      }
      return valid;
    });
    setGotoLine(null);
  }

  async function bootstrap(): Promise<void> {
    setLoading(true);
    try {
      const state = await api.project();
      applyProjectState(state);
      setFatalError(null);
      ensureCrossOriginIsolation();
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : t('app.error.storageUnavailable'));
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

  async function updateProjectSettings(
    patch: Partial<ProjectState['project']['settings']>,
    name?: string,
  ): Promise<void> {
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

  async function handleRun(): Promise<void> {
    if (!canRun) return;
    if (dirtyRef.current.size > 0) await saveAll();
    const token = ++runTokenRef.current;
    setRunResult(null);
    setDiagnostics([]);
    setLiveStdout('');
    setLiveStderr('');
    setRunPhase('queued');
    setRunMessage(t('app.run.phase.preparing'));
    setBottomTab('output');
    setBottomCollapsed(false);
    lastTerminalPhaseRef.current = '';
    appendTerminal(
      `$ ${compiler} -std=${std} ${opt} ${extraFlags.join(' ')} ${entry} -o program.wasm`.replace(/\s+/g, ' '),
    );
    appendTerminal(
      `[wasm] ${t('app.term.toolchain', { llvm: capabilities?.toolchain.llvmVersion ?? '', mb: TOOLCHAIN_MIN_DOWNLOAD_MB })}`,
    );
    appendTerminal(
      `[limits] ${t('app.term.wasmSandbox', { n: runLimits.memoryMb, ms: runLimits.timeMs })}`,
    );

    const onEvent = (event: RunEvent): void => {
      if (token !== runTokenRef.current) return;
      if (event.type === 'phase') {
        setRunPhase(event.phase);
        if (event.message) setRunMessage(event.message);
        if (event.phase === 'compiling' && lastTerminalPhaseRef.current !== 'compiling') {
          lastTerminalPhaseRef.current = 'compiling';
          appendTerminal(`[compile] ${t('app.term.compiling')}`);
        }
        if (event.phase === 'running' && lastTerminalPhaseRef.current !== 'running') {
          lastTerminalPhaseRef.current = 'running';
          appendTerminal(`[run] ${t('app.term.running')}`);
        }
      } else if (event.type === 'stdout') {
        setLiveStdout((previous) => previous + event.data);
      } else if (event.type === 'stderr') {
        setLiveStderr((previous) => previous + event.data);
      } else if (event.type === 'error') {
        pushToast('error', event.message);
        setLiveStderr((previous) => previous + (previous ? '\n' : '') + event.message);
      } else if (event.type === 'result') {
        applyRunResult(event.result);
      }
    };

    try {
      await api.run(
        {
          files: filesRef.current,
          entry,
          compiler,
          std,
          opt,
          extraFlags,
          stdin,
          limits: { timeMs: runLimits.timeMs, memoryMb: runLimits.memoryMb, outputBytes: 65536 },
        },
        { onEvent },
      );
    } catch (error) {
      if (token !== runTokenRef.current) return;
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
      const fallback = nextTabs[Math.max(0, index - 1)] ?? (files[entry] ? entry : (Object.keys(files)[0] ?? ''));
      setActiveFile(fallback);
      activeFileRef.current = fallback;
      if (fallback && !nextTabs.includes(fallback)) setOpenTabs([...nextTabs, fallback]);
    }
  }

  function handleClearOutput(): void {
    if (bottomTab === 'output') {
      setLiveStdout('');
      setLiveStderr('');
      setRunResult(null);
      setDiagnostics([]);
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
    format: handleFormat,
    save: saveAll,
  });
  actionsRef.current = { run: handleRun, format: handleFormat, save: saveAll };

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
        canRun={canRun}
        onRun={() => void handleRun()}
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

      <div className="workspace">
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
                  gotoLine={gotoLine}
                  settings={editorSettings}
                  onChange={handleChange}
                  onCursor={(line, column) => setCursor({ line, column })}
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
            onProblemClick={handleOpenProblem}
            onClearOutput={handleClearOutput}
          />
        </main>
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
          onChange={(flags) => setExtraFlags(flags.slice(0, 8))}
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
