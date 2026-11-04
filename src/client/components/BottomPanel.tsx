import {
  Bug,
  ChevronDown,
  ChevronUp,
  CirclePlay,
  Inbox,
  Keyboard,
  Loader2,
  Send,
  SquareTerminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { Diagnostic, RunPhase, RunResult } from '../../shared/types';
import type { DebugState } from '../debug/dapClient';
import { formatDuration, formatMemory, statusClass, statusLabel } from '../utils/format';

export type BottomTab = 'output' | 'stdin' | 'terminal' | 'debug' | 'problems';

export interface DebugLogEntry {
  id: number;
  kind: 'stdout' | 'stderr' | 'console' | 'system' | 'repl' | 'error';
  text: string;
}

interface BottomPanelProps {
  activeTab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  runPhase: RunPhase | null;
  runMessage: string;
  liveStdout: string;
  liveStderr: string;
  result: RunResult | null;
  diagnostics: Diagnostic[];
  stdin: string;
  onStdinChange: (value: string) => void;
  stdinLimit: number;
  terminalLog: string[];
  debugLog: DebugLogEntry[];
  debugState: DebugState;
  debugExpression: string;
  onDebugExpressionChange: (value: string) => void;
  onEvaluate: () => void;
  evaluationBusy: boolean;
  onProblemClick: (diagnostic: Diagnostic) => void;
  onClearOutput: () => void;
}

const TABS: Array<{ id: BottomTab; label: string; icon: typeof CirclePlay }> = [
  { id: 'output', label: '运行输出', icon: CirclePlay },
  { id: 'stdin', label: '输入', icon: Keyboard },
  { id: 'terminal', label: '终端', icon: SquareTerminal },
  { id: 'debug', label: '调试控制台', icon: Bug },
  { id: 'problems', label: '问题', icon: TriangleAlert },
];

export function BottomPanel(props: BottomPanelProps): JSX.Element {
  const problemCount = props.diagnostics.length;
  const isRunning = props.runPhase === 'compiling' || props.runPhase === 'running' || props.runPhase === 'queued';

  return (
    <section className={`bottom-panel ${props.collapsed ? 'collapsed' : ''}`}>
      <div className="bottom-header">
        <div className="bottom-tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                type="button"
                key={tab.id}
                className={`bottom-tab ${props.activeTab === tab.id ? 'active' : ''}`}
                onClick={() => props.onTabChange(tab.id)}
              >
                <Icon size={14} />
                {tab.label}
                {tab.id === 'problems' && problemCount > 0 && (
                  <span className={`tab-badge ${props.diagnostics.some((item) => item.severity === 'error') ? 'error' : ''}`}>
                    {problemCount}
                  </span>
                )}
                {tab.id === 'debug' && props.debugState === 'paused' && <span className="tab-live-dot" />}
              </button>
            );
          })}
        </div>
        <div className="bottom-meta">
          {props.result && (
            <span className={`status-pill ${statusClass(props.result.status)}`}>{statusLabel(props.result.status)}</span>
          )}
          {props.result && (
            <span className="metric">
              {formatDuration(props.result.timeMs)} · {formatMemory(props.result.memoryKb)}
            </span>
          )}
          {isRunning && (
            <span className="metric running">
              <Loader2 size={12} className="spin" /> {props.runMessage || '运行中'}
            </span>
          )}
          <button type="button" className="icon-btn small" onClick={props.onClearOutput} title="清空当前面板">
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn small"
            onClick={props.onToggleCollapse}
            title={props.collapsed ? '展开面板' : '收起面板'}
          >
            {props.collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {!props.collapsed && (
        <div className="bottom-body">
          {props.activeTab === 'output' && (
            <div className="output-view">
              {isRunning && (
                <div className="run-progress">
                  <span className="run-progress-dot" />
                  {props.runMessage || '正在执行'}
                </div>
              )}
              {props.liveStdout && (
                <div className="output-section">
                  <div className="output-section-label">stdout</div>
                  <pre className="output-pre">{props.liveStdout}</pre>
                </div>
              )}
              {props.liveStderr && (
                <div className="output-section">
                  <div className="output-section-label error">stderr</div>
                  <pre className="output-pre error">{props.liveStderr}</pre>
                </div>
              )}
              {!props.liveStdout && !props.liveStderr && !isRunning && (
                <EmptyState
                  icon={<CirclePlay size={22} />}
                  title={props.result ? '程序没有产生输出' : '点击右上角「运行」开始'}
                  hint="stdout 与 stderr 会实时流式显示在这里，输出上限 64 KiB。"
                />
              )}
            </div>
          )}

          {props.activeTab === 'stdin' && (
            <div className="stdin-view">
              <div className="stdin-head">
                <span>标准输入（stdin）</span>
                <span className="muted">
                  {props.stdin.length.toLocaleString()} / {Math.floor(props.stdinLimit / 1024)} KiB
                </span>
              </div>
              <textarea
                value={props.stdin}
                onChange={(event) => props.onStdinChange(event.target.value)}
                placeholder={'例如：\n5\n1 2 3 4 5'}
                spellCheck={false}
                className="stdin-editor"
              />
              <div className="stdin-hint">程序通过 std::cin 读取这段内容；运行时自动写入管道。</div>
            </div>
          )}

          {props.activeTab === 'terminal' && (
            <div className="terminal-view">
              {props.terminalLog.length === 0 ? (
                <EmptyState
                  icon={<SquareTerminal size={22} />}
                  title="终端还没有记录"
                  hint="运行或调试后，这里会显示编译命令与沙箱执行摘要。"
                />
              ) : (
                <div className="terminal-lines">
                  {props.terminalLog.map((line, index) => (
                    <div key={`${index}-${line}`} className={`terminal-line ${line.startsWith('$') ? 'command' : ''}`}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {props.activeTab === 'debug' && (
            <div className="debug-console">
              <div className="debug-console-log">
                {props.debugLog.length === 0 ? (
                  <EmptyState
                    icon={<Bug size={22} />}
                    title="调试控制台为空"
                    hint="启动调试后，程序输出与调试器消息会显示在这里；暂停时可求值表达式。"
                  />
                ) : (
                  props.debugLog.map((entry) => (
                    <pre key={entry.id} className={`debug-log-line ${entry.kind}`}>
                      {entry.text}
                    </pre>
                  ))
                )}
              </div>
              <form
                className="debug-repl"
                onSubmit={(event) => {
                  event.preventDefault();
                  props.onEvaluate();
                }}
              >
                <span className="repl-prompt">›</span>
                <input
                  value={props.debugExpression}
                  onChange={(event) => props.onDebugExpressionChange(event.target.value)}
                  placeholder={props.debugState === 'paused' ? '在暂停时求值，例如 values.size()' : '程序暂停后可求值'}
                  disabled={props.debugState !== 'paused' || props.evaluationBusy}
                  spellCheck={false}
                />
                <button
                  type="submit"
                  className="icon-btn small"
                  disabled={props.debugState !== 'paused' || props.evaluationBusy || !props.debugExpression.trim()}
                  title="求值"
                >
                  {props.evaluationBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                </button>
              </form>
            </div>
          )}

          {props.activeTab === 'problems' && (
            <div className="problems-view">
              {props.diagnostics.length === 0 ? (
                <EmptyState
                  icon={<Inbox size={22} />}
                  title="没有编译问题"
                  hint="编译错误和警告会按文件、行号列出，点击可跳转到编辑器。"
                />
              ) : (
                <div className="problem-list">
                  {props.diagnostics.map((diagnostic, index) => (
                    <button
                      type="button"
                      key={`${diagnostic.file}-${diagnostic.line}-${diagnostic.col}-${index}`}
                      className={`problem-item ${diagnostic.severity}`}
                      onClick={() => props.onProblemClick(diagnostic)}
                    >
                      <span className={`problem-dot ${diagnostic.severity}`} />
                      <span className="problem-message">{diagnostic.message}</span>
                      <span className="problem-location">
                        {diagnostic.file}:{diagnostic.line}:{diagnostic.col}
                      </span>
                      <span className="problem-severity">
                        {diagnostic.severity === 'error' ? '错误' : diagnostic.severity === 'warning' ? '警告' : '提示'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }): JSX.Element {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <span className="empty-title">{title}</span>
      <span className="empty-hint">{hint}</span>
    </div>
  );
}
