import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bug,
  ChevronRight,
  CircleDot,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  StepForward,
  X,
} from 'lucide-react';
import type { DapScope, DapStackFrame, DapVariable, DebugState } from '../debug/dapClient';
import type { EditorBreakpoint } from './CodeEditor';
import { basename } from '../utils/format';

export type DebugTab = 'stack' | 'variables' | 'watch' | 'breakpoints';

export interface WatchExpression {
  expression: string;
  value?: string;
  type?: string;
  error?: string;
  loading?: boolean;
}

interface DebugPanelProps {
  state: DebugState;
  breakpoints: EditorBreakpoint[];
  frames: DapStackFrame[];
  selectedFrameId: number | null;
  scopes: DapScope[];
  variables: Record<number, DapVariable[]>;
  expanded: Set<number>;
  loadingRefs: Set<number>;
  watches: WatchExpression[];
  watchInput: string;
  activeTab: DebugTab;
  onTabChange: (tab: DebugTab) => void;
  onStart: () => void;
  onStop: () => void;
  onContinue: () => void;
  onPause: () => void;
  onNext: () => void;
  onStepIn: () => void;
  onStepOut: () => void;
  onRestart: () => void;
  onSelectFrame: (frame: DapStackFrame) => void;
  onExpandVariable: (reference: number) => void;
  onWatchInputChange: (value: string) => void;
  onAddWatch: () => void;
  onRemoveWatch: (expression: string) => void;
  onOpenBreakpoint: (breakpoint: EditorBreakpoint) => void;
  onRemoveBreakpoint: (breakpoint: EditorBreakpoint) => void;
}

const STATE_LABEL: Record<DebugState, string> = {
  idle: '未启动',
  starting: '启动中',
  running: '运行中',
  paused: '已暂停',
  terminated: '已结束',
};

export function DebugPanel(props: DebugPanelProps): JSX.Element {
  const { state } = props;
  const isPaused = state === 'paused';
  const isRunning = state === 'running';
  const isActive = isPaused || isRunning || state === 'starting';
  const stackCount = props.frames.length;
  const breakpointCount = props.breakpoints.length;

  return (
    <aside className="debug-panel">
      <div className="debug-header">
        <div className="debug-title">
          <Bug size={16} />
          调试
          <span className={`debug-state ${state}`}>
            <span className="debug-state-dot" />
            {STATE_LABEL[state]}
          </span>
        </div>
        <div className="debug-actions">
          {!isActive && (
            <button type="button" className="btn btn-debug btn-small" onClick={props.onStart} title="启动调试 (F5)">
              <Play size={13} fill="currentColor" /> 开始
            </button>
          )}
          {isActive && (
            <>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onContinue}
                disabled={!isPaused}
                title="继续 (F5)"
              >
                <Play size={15} fill="currentColor" />
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onPause}
                disabled={!isRunning}
                title="暂停"
              >
                <Pause size={15} fill="currentColor" />
              </button>
              <button type="button" className="icon-btn small" onClick={props.onNext} disabled={!isPaused} title="单步跳过 (F10)">
                <StepForward size={15} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onStepIn}
                disabled={!isPaused}
                title="单步步入 (F11)"
              >
                <ArrowDownToLine size={15} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onStepOut}
                disabled={!isPaused}
                title="单步步出 (Shift + F11)"
              >
                <ArrowUpFromLine size={15} />
              </button>
              <button type="button" className="icon-btn small" onClick={props.onRestart} title="重新启动调试">
                <RotateCcw size={14} />
              </button>
              <button type="button" className="icon-btn small danger" onClick={props.onStop} title="停止调试 (Shift + F5)">
                <Square size={14} fill="currentColor" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="debug-tabs">
        <button
          type="button"
          className={props.activeTab === 'stack' ? 'active' : ''}
          onClick={() => props.onTabChange('stack')}
        >
          调用栈 {stackCount > 0 && <span className="debug-tab-count">{stackCount}</span>}
        </button>
        <button
          type="button"
          className={props.activeTab === 'variables' ? 'active' : ''}
          onClick={() => props.onTabChange('variables')}
        >
          变量 {props.scopes.length > 0 && <span className="debug-tab-count">{props.scopes.length}</span>}
        </button>
        <button
          type="button"
          className={props.activeTab === 'watch' ? 'active' : ''}
          onClick={() => props.onTabChange('watch')}
        >
          监视 {props.watches.length > 0 && <span className="debug-tab-count">{props.watches.length}</span>}
        </button>
        <button
          type="button"
          className={props.activeTab === 'breakpoints' ? 'active' : ''}
          onClick={() => props.onTabChange('breakpoints')}
        >
          断点 {breakpointCount > 0 && <span className="debug-tab-count">{breakpointCount}</span>}
        </button>
      </div>

      <div className="debug-content">
        {props.activeTab === 'stack' && (
          <div className="stack-view">
            {props.frames.length === 0 ? (
              <DebugEmpty
                title={isPaused ? '没有调用栈信息' : '程序暂停后显示调用栈'}
                hint="命中断点或暂停后，这里会列出栈帧；点击可跳转到源码。"
              />
            ) : (
              props.frames.map((frame, index) => (
                <button
                  type="button"
                  key={frame.id}
                  className={`stack-frame ${props.selectedFrameId === frame.id ? 'selected' : ''}`}
                  onClick={() => props.onSelectFrame(frame)}
                  title={`${frame.source?.path ?? ''}:${frame.line}`}
                >
                  <span className="frame-index">{index}</span>
                  <span className="frame-main">
                    <span className="frame-name">{frame.name}</span>
                    <span className="frame-location">
                      {frame.source?.path ? basename(frame.source.path) : '未知文件'}:{frame.line}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {props.activeTab === 'variables' && (
          <div className="variables-view">
            {props.scopes.length === 0 ? (
              <DebugEmpty
                title={isPaused ? '当前帧没有可见变量' : '暂停后查看局部变量'}
                hint="变量按作用域分组，嵌套结构在展开时才加载。"
              />
            ) : (
              props.scopes.map((scope) => {
                const isOpen = props.expanded.has(scope.variablesReference);
                const variables = props.variables[scope.variablesReference];
                return (
                  <div className="scope-group" key={`${scope.name}-${scope.variablesReference}`}>
                    <button
                      type="button"
                      className="scope-row"
                      onClick={() => props.onExpandVariable(scope.variablesReference)}
                    >
                      <ChevronRight size={13} className={`chevron ${isOpen ? 'open' : ''}`} />
                      <span className="scope-name">{scope.name}</span>
                      {scope.expensive && <span className="scope-expensive">expensive</span>}
                      <span className="scope-count">{variables ? variables.length : ''}</span>
                    </button>
                    {isOpen && (
                      <div className="scope-body">
                        {props.loadingRefs.has(scope.variablesReference) && (
                          <div className="tree-loading">
                            <Loader2 size={12} className="spin" /> 加载中
                          </div>
                        )}
                        {variables?.map((variable) => (
                          <VariableRow
                            key={`${scope.variablesReference}-${variable.name}`}
                            variable={variable}
                            depth={0}
                            variables={props.variables}
                            expanded={props.expanded}
                            loadingRefs={props.loadingRefs}
                            onExpand={props.onExpandVariable}
                          />
                        ))}
                        {variables && variables.length === 0 && <div className="tree-empty">空</div>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {props.activeTab === 'watch' && (
          <div className="watch-view">
            <form
              className="watch-add"
              onSubmit={(event) => {
                event.preventDefault();
                props.onAddWatch();
              }}
            >
              <input
                value={props.watchInput}
                onChange={(event) => props.onWatchInputChange(event.target.value)}
                placeholder="添加监视表达式"
                spellCheck={false}
              />
              <button type="submit" className="icon-btn small" disabled={!props.watchInput.trim()} title="添加">
                <Plus size={14} />
              </button>
            </form>
            {props.watches.length === 0 ? (
              <DebugEmpty title="还没有监视表达式" hint="暂停时会自动求值；例如 values.size() 或 p.x。" />
            ) : (
              props.watches.map((watch) => (
                <div className="watch-row" key={watch.expression}>
                  <div className="watch-main">
                    <span className="watch-expression">{watch.expression}</span>
                    <span className={`watch-value ${watch.error ? 'error' : ''}`}>
                      {watch.loading ? '求值中…' : watch.error ? watch.error : watch.value ?? '—'}
                      {watch.type && !watch.error && <span className="watch-type">{watch.type}</span>}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    onClick={() => props.onRemoveWatch(watch.expression)}
                    title="移除监视"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {props.activeTab === 'breakpoints' && (
          <div className="breakpoints-view">
            {props.breakpoints.length === 0 ? (
              <DebugEmpty title="没有断点" hint="点击编辑器行号左侧的断点槽即可设置断点。" />
            ) : (
              groupBreakpoints(props.breakpoints).map(([file, list]) => (
                <div className="breakpoint-group" key={file}>
                  <div className="breakpoint-file">{file}</div>
                  {list.map((breakpoint) => (
                    <div className="breakpoint-row" key={`${file}-${breakpoint.line}`}>
                      <button type="button" className="breakpoint-open" onClick={() => props.onOpenBreakpoint(breakpoint)}>
                        <span className={`bp-indicator ${breakpoint.verified ? 'verified' : 'unverified'}`} />
                        <span>第 {breakpoint.line} 行</span>
                        <span className={`bp-status ${breakpoint.verified ? 'verified' : ''}`}>
                          {breakpoint.verified ? '已验证' : '未验证'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn tiny"
                        onClick={() => props.onRemoveBreakpoint(breakpoint)}
                        title="移除断点"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="debug-footer">
        <CircleDot size={12} />
        {isActive ? 'lldb-dap · 沙箱内调试' : '调试会话空闲'}
      </div>
    </aside>
  );
}

function groupBreakpoints(breakpoints: EditorBreakpoint[]): Array<[string, EditorBreakpoint[]]> {
  const map = new Map<string, EditorBreakpoint[]>();
  for (const breakpoint of breakpoints) {
    const list = map.get(breakpoint.file) ?? [];
    list.push(breakpoint);
    map.set(breakpoint.file, list);
  }
  return [...map.entries()].map(([file, list]) => [file, [...list].sort((a, b) => a.line - b.line)]);
}

function DebugEmpty({ title, hint }: { title: string; hint: string }): JSX.Element {
  return (
    <div className="debug-empty">
      <span className="debug-empty-icon">
        <Bug size={18} />
      </span>
      <span className="debug-empty-title">{title}</span>
      <span className="debug-empty-hint">{hint}</span>
    </div>
  );
}

interface VariableRowProps {
  variable: DapVariable;
  depth: number;
  variables: Record<number, DapVariable[]>;
  expanded: Set<number>;
  loadingRefs: Set<number>;
  onExpand: (reference: number) => void;
}

function VariableRow(props: VariableRowProps): JSX.Element {
  const { variable } = props;
  const hasChildren = variable.variablesReference > 0;
  const isOpen = props.expanded.has(variable.variablesReference);
  const children = props.variables[variable.variablesReference];
  return (
    <div className="variable-branch" style={{ marginLeft: props.depth * 13 }}>
      <button
        type="button"
        className={`variable-row ${hasChildren ? 'has-children' : ''}`}
        onClick={() => hasChildren && props.onExpand(variable.variablesReference)}
        title={variable.evaluateName ?? variable.name}
      >
        <span className="variable-chevron">
          {hasChildren && <ChevronRight size={11} className={`chevron ${isOpen ? 'open' : ''}`} />}
        </span>
        <span className="variable-name">{variable.name}</span>
        {variable.type && <span className="variable-type">{variable.type}</span>}
        <span className="variable-equals">=</span>
        <span className="variable-value" title={variable.value}>
          {variable.value}
        </span>
      </button>
      {isOpen && (
        <div>
          {props.loadingRefs.has(variable.variablesReference) && (
            <div className="tree-loading" style={{ marginLeft: (props.depth + 1) * 13 }}>
              <Loader2 size={11} className="spin" /> 加载中
            </div>
          )}
          {children?.map((child) => (
            <VariableRow
              key={`${variable.variablesReference}-${child.name}`}
              variable={child}
              depth={props.depth + 1}
              variables={props.variables}
              expanded={props.expanded}
              loadingRefs={props.loadingRefs}
              onExpand={props.onExpand}
            />
          ))}
          {children && children.length === 0 && (
            <div className="tree-empty" style={{ marginLeft: (props.depth + 1) * 13 }}>
              空
            </div>
          )}
        </div>
      )}
    </div>
  );
}
