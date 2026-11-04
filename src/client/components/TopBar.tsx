import {
  Bug,
  CircleHelp,
  Cloud,
  CloudUpload,
  Code2,
  History,
  Loader2,
  Play,
  Settings2,
  Square,
  Wand2,
} from 'lucide-react';
import type { DebugState } from '../debug/dapClient';
import type { RunPhase } from '../../shared/types';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

interface TopBarProps {
  projectName: string;
  saveState: SaveState;
  runPhase: RunPhase | null;
  debugState: DebugState;
  canRun: boolean;
  canDebug: boolean;
  onRun: () => void;
  onDebug: () => void;
  onStopDebug: () => void;
  onFormat: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

function SaveIndicator({ state }: { state: SaveState }): JSX.Element {
  if (state === 'saving') {
    return (
      <span className="save-indicator saving">
        <Loader2 size={13} className="spin" /> 保存中
      </span>
    );
  }
  if (state === 'dirty') {
    return (
      <span className="save-indicator dirty">
        <CloudUpload size={13} /> 未保存
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="save-indicator error">
        <Cloud size={13} /> 保存失败
      </span>
    );
  }
  return (
    <span className="save-indicator">
      <Cloud size={13} /> 已保存
    </span>
  );
}

export function TopBar(props: TopBarProps): JSX.Element {
  const runBusy = props.runPhase === 'queued' || props.runPhase === 'compiling' || props.runPhase === 'running';
  const debugActive =
    props.debugState === 'starting' || props.debugState === 'running' || props.debugState === 'paused';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand" title="CppLab 在线 C++ IDE">
          <span className="brand-mark">
            <Code2 size={18} strokeWidth={2.2} />
          </span>
          <span className="brand-text">
            Cpp<span>Lab</span>
          </span>
        </div>
        <div className="topbar-divider" />
        <div className="project-title">
          <span className="project-name">{props.projectName}</span>
          <SaveIndicator state={props.saveState} />
        </div>
      </div>

      <div className="topbar-center">
        <button
          type="button"
          className={`btn btn-run ${runBusy ? 'is-busy' : ''}`}
          onClick={props.onRun}
          disabled={!props.canRun || runBusy}
          title="运行 (Ctrl/Cmd + Enter)"
        >
          {runBusy ? <Loader2 size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
          {runBusy ? (props.runPhase === 'compiling' ? '编译中' : '运行中') : '运行'}
        </button>
        <button
          type="button"
          className={`btn btn-debug ${debugActive ? 'is-active' : ''}`}
          onClick={debugActive ? props.onStopDebug : props.onDebug}
          disabled={debugActive ? false : !props.canDebug}
          title={debugActive ? '停止调试 (Shift + F5)' : '启动调试 (F5)'}
        >
          {debugActive ? <Square size={14} fill="currentColor" /> : <Bug size={15} />}
          {debugActive ? '停止调试' : '调试'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={props.onFormat}
          disabled={runBusy}
          title="格式化当前文件 (Ctrl/Cmd + Shift + F)"
        >
          <Wand2 size={15} />
          <span className="btn-label">格式化</span>
        </button>
      </div>

      <div className="topbar-right">
        <button type="button" className="icon-btn" onClick={props.onOpenHistory} title="运行记录">
          <History size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={props.onOpenSettings} title="编辑器设置">
          <Settings2 size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={props.onOpenHelp} title="帮助与快捷键">
          <CircleHelp size={18} />
        </button>
        <span className="topbar-divider" />
        <span className="avatar" title="本地单用户工作区">C++</span>
      </div>
    </header>
  );
}
