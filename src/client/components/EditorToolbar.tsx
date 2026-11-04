import { Flag, FolderTree, SlidersHorizontal } from 'lucide-react';
import type { CompilerCapability, CompilerId, OptId, StdId } from '../../shared/types';

interface EditorToolbarProps {
  compilers: CompilerCapability[];
  stds: readonly StdId[];
  opts: readonly OptId[];
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
  extraFlags: string[];
  entry: string;
  onCompiler: (value: CompilerId) => void;
  onStd: (value: StdId) => void;
  onOpt: (value: OptId) => void;
  onOpenFlags: () => void;
  onOpenFiles: () => void;
  onNewFile: () => void;
}

export function EditorToolbar(props: EditorToolbarProps): JSX.Element {
  return (
    <div className="editor-toolbar">
      <div className="select-field">
        <span className="select-label">编译器</span>
        <select
          value={props.compiler}
          onChange={(event) => props.onCompiler(event.target.value as CompilerId)}
          aria-label="编译器"
        >
          {props.compilers.map((compiler) => (
            <option key={compiler.id} value={compiler.id} disabled={!compiler.available}>
              {compiler.id}
              {compiler.available ? '' : '（未安装）'}
            </option>
          ))}
        </select>
      </div>

      <div className="select-field">
        <span className="select-label">标准</span>
        <select value={props.std} onChange={(event) => props.onStd(event.target.value as StdId)} aria-label="C++ 标准">
          {props.stds.map((std) => (
            <option key={std} value={std}>
              {std.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="select-field">
        <span className="select-label">优化</span>
        <select value={props.opt} onChange={(event) => props.onOpt(event.target.value as OptId)} aria-label="优化级别">
          {props.opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <button type="button" className={`toolbar-pill ${props.extraFlags.length ? 'has-value' : ''}`} onClick={props.onOpenFlags}>
        <SlidersHorizontal size={14} />
        编译参数
        {props.extraFlags.length > 0 && <span className="pill-badge">{props.extraFlags.length}</span>}
      </button>

      <span className="entry-hint">
        <Flag size={13} /> 入口 {props.entry}
      </span>

      <div className="toolbar-spacer" />

      <button type="button" className="toolbar-pill" onClick={props.onOpenFiles}>
        <FolderTree size={14} />
        文件
      </button>
    </div>
  );
}
