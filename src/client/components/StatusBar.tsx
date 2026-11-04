import { Circle, GitBranch, ShieldCheck, WifiOff } from 'lucide-react';
import type { Capabilities, CompilerId, RunPhase, RunResult, StdId } from '../../shared/types';
import type { DebugState } from '../debug/dapClient';
import { formatDuration, formatMemory, statusClass, statusLabel } from '../utils/format';
import { t, useLocale } from '../i18n';

interface StatusBarProps {
  activeFile: string;
  cursor: { line: number; column: number };
  compiler: CompilerId;
  std: StdId;
  capabilities: Capabilities;
  saveState: 'saved' | 'saving' | 'dirty' | 'error';
  runPhase: RunPhase | null;
  runResult: RunResult | null;
  debugState: DebugState;
}

const DEBUG_LABEL = {
  idle: 'chrome.statusbar.debug.idle',
  starting: 'chrome.statusbar.debug.starting',
  running: 'chrome.statusbar.debug.running',
  paused: 'chrome.statusbar.debug.paused',
  terminated: 'chrome.statusbar.debug.terminated',
} as const;

export function StatusBar(props: StatusBarProps): JSX.Element {
  useLocale();
  const sandboxReady = props.capabilities.sandbox.available;
  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className="status-item">
          <GitBranch size={12} /> playground
        </span>
        <span className="status-item">{props.activeFile}</span>
        <span className="status-item">
          Ln {props.cursor.line}, Col {props.cursor.column}
        </span>
        <span className="status-item">{t('chrome.statusbar.indent')}</span>
        <span className="status-item">UTF-8</span>
      </div>
      <div className="statusbar-right">
        <span className={`status-item ${sandboxReady ? 'ok' : 'warn'}`} title={props.capabilities.sandbox.detail}>
          <ShieldCheck size={12} /> {t('chrome.statusbar.sandbox')}
          <Circle size={6} fill="currentColor" strokeWidth={0} />
        </span>
        <span className="status-item">
          <WifiOff size={12} /> {t('chrome.statusbar.offline')}
        </span>
        <span className="status-item">{props.compiler}</span>
        <span className="status-item">{props.std.toUpperCase()}</span>
        {props.runResult && (
          <span className={`status-item run-chip ${statusClass(props.runResult.status)}`}>
            {statusLabel(props.runResult.status)} · {formatDuration(props.runResult.timeMs)} · {formatMemory(props.runResult.memoryKb)}
          </span>
        )}
        <span className="status-item">{t(DEBUG_LABEL[props.debugState])}</span>
        <span className="status-item muted">CppLab v1.0</span>
      </div>
    </footer>
  );
}
