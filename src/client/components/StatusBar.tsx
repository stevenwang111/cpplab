import { Cpu, Circle, ShieldCheck, WifiOff } from 'lucide-react';
import type { Capabilities, CompilerId, RunPhase, RunResult, StdId } from '../../shared/types';
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
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  useLocale();
  const isolated = props.capabilities.toolchain.crossOriginIsolated;
  const toolchainTitle = props.capabilities.toolchain.detail;

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className="status-item">
          <Cpu size={12} /> {t('chrome.statusbar.local')}
        </span>
        <span className="status-item">{props.activeFile}</span>
        <span className="status-item">
          Ln {props.cursor.line}, Col {props.cursor.column}
        </span>
        <span className="status-item">{t('chrome.statusbar.indent')}</span>
        <span className="status-item">UTF-8</span>
      </div>
      <div className="statusbar-right">
        <span className={`status-item ${isolated ? 'ok' : 'warn'}`} title={toolchainTitle}>
          <ShieldCheck size={12} /> {t('chrome.statusbar.wasm')}
          <Circle size={6} fill="currentColor" strokeWidth={0} />
        </span>
        <span className="status-item">
          <WifiOff size={12} /> {t('chrome.statusbar.offline')}
        </span>
        <span className="status-item">{props.compiler}</span>
        <span className="status-item">{props.std.toUpperCase()}</span>
        {props.runResult && (
          <span className={`status-item run-chip ${statusClass(props.runResult.status)}`}>
            {statusLabel(props.runResult.status)} · {formatDuration(props.runResult.timeMs)} ·{' '}
            {formatMemory(props.runResult.memoryKb)}
          </span>
        )}
        <span className="status-item muted">CppLab v2.0</span>
      </div>
    </footer>
  );
}
