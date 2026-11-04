import { Circle, GitBranch, ShieldCheck, WifiOff } from 'lucide-react';
import type { Capabilities, CompilerId, RunPhase, RunResult, StdId } from '../../shared/types';
import type { DebugState } from '../debug/dapClient';
import { formatDuration, formatMemory, statusClass, statusLabel } from '../utils/format';

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

const DEBUG_LABEL: Record<DebugState, string> = {
  idle: '调试未启动',
  starting: '调试启动中',
  running: '调试运行中',
  paused: '调试已暂停',
  terminated: '调试已结束',
};

export function StatusBar(props: StatusBarProps): JSX.Element {
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
        <span className="status-item">空格: 4</span>
        <span className="status-item">UTF-8</span>
      </div>
      <div className="statusbar-right">
        <span className={`status-item ${sandboxReady ? 'ok' : 'warn'}`} title={props.capabilities.sandbox.detail}>
          <ShieldCheck size={12} /> nsjail 隔离
          <Circle size={6} fill="currentColor" strokeWidth={0} />
        </span>
        <span className="status-item">
          <WifiOff size={12} /> 无网络
        </span>
        <span className="status-item">{props.compiler}</span>
        <span className="status-item">{props.std.toUpperCase()}</span>
        {props.runResult && (
          <span className={`status-item run-chip ${statusClass(props.runResult.status)}`}>
            {statusLabel(props.runResult.status)} · {formatDuration(props.runResult.timeMs)} · {formatMemory(props.runResult.memoryKb)}
          </span>
        )}
        <span className="status-item">{DEBUG_LABEL[props.debugState]}</span>
        <span className="status-item muted">CppLab v1.0</span>
      </div>
    </footer>
  );
}
