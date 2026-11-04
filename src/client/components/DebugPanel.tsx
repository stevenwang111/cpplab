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
import { t, useLocale } from '../i18n';

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

const STATE_LABEL: Record<DebugState, Parameters<typeof t>[0]> = {
  idle: 'debug.state.idle',
  starting: 'debug.state.starting',
  running: 'debug.state.running',
  paused: 'debug.state.paused',
  terminated: 'debug.state.terminated',
};

export function DebugPanel(props: DebugPanelProps): JSX.Element {
  useLocale();
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
          {t('debug.header.title')}
          <span className={`debug-state ${state}`}>
            <span className="debug-state-dot" />
            {t(STATE_LABEL[state])}
          </span>
        </div>
        <div className="debug-actions">
          {!isActive && (
            <button
              type="button"
              className="btn btn-debug btn-small"
              onClick={props.onStart}
              title={t('debug.action.start')}
            >
              <Play size={13} fill="currentColor" /> {t('debug.action.startShort')}
            </button>
          )}
          {isActive && (
            <>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onContinue}
                disabled={!isPaused}
                title={t('debug.action.continue')}
              >
                <Play size={15} fill="currentColor" />
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onPause}
                disabled={!isRunning}
                title={t('debug.action.pause')}
              >
                <Pause size={15} fill="currentColor" />
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onNext}
                disabled={!isPaused}
                title={t('debug.action.stepOver')}
              >
                <StepForward size={15} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onStepIn}
                disabled={!isPaused}
                title={t('debug.action.stepInto')}
              >
                <ArrowDownToLine size={15} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onStepOut}
                disabled={!isPaused}
                title={t('debug.action.stepOut')}
              >
                <ArrowUpFromLine size={15} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={props.onRestart}
                title={t('debug.action.restart')}
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                className="icon-btn small danger"
                onClick={props.onStop}
                title={t('debug.action.stop')}
              >
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
          {t('debug.tab.stack')} {stackCount > 0 && <span className="debug-tab-count">{stackCount}</span>}
        </button>
        <button
          type="button"
          className={props.activeTab === 'variables' ? 'active' : ''}
          onClick={() => props.onTabChange('variables')}
        >
          {t('debug.tab.variables')} {props.scopes.length > 0 && <span className="debug-tab-count">{props.scopes.length}</span>}
        </button>
        <button
          type="button"
          className={props.activeTab === 'watch' ? 'active' : ''}
          onClick={() => props.onTabChange('watch')}
        >
          {t('debug.tab.watch')} {props.watches.length > 0 && <span className="debug-tab-count">{props.watches.length}</span>}
        </button>
        <button
          type="button"
          className={props.activeTab === 'breakpoints' ? 'active' : ''}
          onClick={() => props.onTabChange('breakpoints')}
        >
          {t('debug.tab.breakpoints')} {breakpointCount > 0 && <span className="debug-tab-count">{breakpointCount}</span>}
        </button>
      </div>

      <div className="debug-content">
        {props.activeTab === 'stack' && (
          <div className="stack-view">
            {props.frames.length === 0 ? (
              <DebugEmpty
                title={isPaused ? t('debug.empty.stack.paused') : t('debug.empty.stack.idle')}
                hint={t('debug.empty.stack.hint')}
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
                      {frame.source?.path ? basename(frame.source.path) : t('debug.frame.unknownFile')}:{frame.line}
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
                title={isPaused ? t('debug.empty.variables.paused') : t('debug.empty.variables.idle')}
                hint={t('debug.empty.variables.hint')}
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
                            <Loader2 size={12} className="spin" /> {t('common.loading')}
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
                        {variables && variables.length === 0 && <div className="tree-empty">{t('common.empty')}</div>}
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
                placeholder={t('debug.watch.placeholder')}
                spellCheck={false}
              />
              <button
                type="submit"
                className="icon-btn small"
                disabled={!props.watchInput.trim()}
                title={t('common.add')}
              >
                <Plus size={14} />
              </button>
            </form>
            {props.watches.length === 0 ? (
              <DebugEmpty title={t('debug.empty.watch.title')} hint={t('debug.empty.watch.hint')} />
            ) : (
              props.watches.map((watch) => (
                <div className="watch-row" key={watch.expression}>
                  <div className="watch-main">
                    <span className="watch-expression">{watch.expression}</span>
                    <span className={`watch-value ${watch.error ? 'error' : ''}`}>
                      {watch.loading ? t('debug.watch.evaluating') : watch.error ? watch.error : watch.value ?? '—'}
                      {watch.type && !watch.error && <span className="watch-type">{watch.type}</span>}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    onClick={() => props.onRemoveWatch(watch.expression)}
                    title={t('debug.watch.remove')}
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
              <DebugEmpty title={t('debug.empty.breakpoints.title')} hint={t('debug.empty.breakpoints.hint')} />
            ) : (
              groupBreakpoints(props.breakpoints).map(([file, list]) => (
                <div className="breakpoint-group" key={file}>
                  <div className="breakpoint-file">{file}</div>
                  {list.map((breakpoint) => (
                    <div className="breakpoint-row" key={`${file}-${breakpoint.line}`}>
                      <button type="button" className="breakpoint-open" onClick={() => props.onOpenBreakpoint(breakpoint)}>
                        <span className={`bp-indicator ${breakpoint.verified ? 'verified' : 'unverified'}`} />
                        <span>{t('debug.breakpoint.line', { line: breakpoint.line })}</span>
                        <span className={`bp-status ${breakpoint.verified ? 'verified' : ''}`}>
                          {breakpoint.verified ? t('debug.breakpoint.verified') : t('debug.breakpoint.unverified')}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn tiny"
                        onClick={() => props.onRemoveBreakpoint(breakpoint)}
                        title={t('debug.breakpoint.remove')}
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
        {isActive ? t('debug.footer.active') : t('debug.footer.idle')}
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
  useLocale();
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
  useLocale();
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
              <Loader2 size={11} className="spin" /> {t('common.loading')}
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
              {t('common.empty')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
