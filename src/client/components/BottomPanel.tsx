import {
  ChevronDown,
  ChevronUp,
  CirclePlay,
  Inbox,
  Keyboard,
  Loader2,
  SquareTerminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { Diagnostic, RunPhase, RunResult } from '../../shared/types';
import type { MessageKey } from '../../shared/i18n';
import { t, useLocale } from '../i18n';
import { formatDuration, formatMemory, statusClass, statusLabel } from '../utils/format';

export type BottomTab = 'output' | 'stdin' | 'terminal' | 'problems';

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
  onProblemClick: (diagnostic: Diagnostic) => void;
  onClearOutput: () => void;
}

const TABS: Array<{ id: BottomTab; labelKey: MessageKey; icon: typeof CirclePlay }> = [
  { id: 'output', labelKey: 'panels.tab.output', icon: CirclePlay },
  { id: 'stdin', labelKey: 'panels.tab.stdin', icon: Keyboard },
  { id: 'terminal', labelKey: 'panels.tab.terminal', icon: SquareTerminal },
  { id: 'problems', labelKey: 'panels.tab.problems', icon: TriangleAlert },
];

export function BottomPanel(props: BottomPanelProps): JSX.Element {
  useLocale();
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
                {t(tab.labelKey)}
                {tab.id === 'problems' && problemCount > 0 && (
                  <span
                    className={`tab-badge ${props.diagnostics.some((item) => item.severity === 'error') ? 'error' : ''}`}
                  >
                    {problemCount}
                  </span>
                )}
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
              <Loader2 size={12} className="spin" /> {props.runMessage || t('panels.meta.running')}
            </span>
          )}
          <button type="button" className="icon-btn small" onClick={props.onClearOutput} title={t('panels.action.clearPanel')}>
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn small"
            onClick={props.onToggleCollapse}
            title={props.collapsed ? t('panels.action.expand') : t('panels.action.collapse')}
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
                  {props.runMessage || t('panels.meta.executing')}
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
                  title={props.result ? t('panels.output.emptyTitleNoOutput') : t('panels.output.emptyTitleStart')}
                  hint={t('panels.output.emptyHint')}
                />
              )}
            </div>
          )}

          {props.activeTab === 'stdin' && (
            <div className="stdin-view">
              <div className="stdin-head">
                <span>{t('panels.stdin.label')}</span>
                <span className="muted">
                  {props.stdin.length.toLocaleString()} / {Math.floor(props.stdinLimit / 1024)} KiB
                </span>
              </div>
              <textarea
                value={props.stdin}
                onChange={(event) => props.onStdinChange(event.target.value)}
                placeholder={t('panels.stdin.placeholder')}
                spellCheck={false}
                className="stdin-editor"
              />
              <div className="stdin-hint">{t('panels.stdin.hint')}</div>
            </div>
          )}

          {props.activeTab === 'terminal' && (
            <div className="terminal-view">
              {props.terminalLog.length === 0 ? (
                <EmptyState
                  icon={<SquareTerminal size={22} />}
                  title={t('panels.terminal.emptyTitle')}
                  hint={t('panels.terminal.emptyHint')}
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

          {props.activeTab === 'problems' && (
            <div className="problems-view">
              {props.diagnostics.length === 0 ? (
                <EmptyState
                  icon={<Inbox size={22} />}
                  title={t('panels.problems.emptyTitle')}
                  hint={t('panels.problems.emptyHint')}
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
                        {diagnostic.severity === 'error'
                          ? t('panels.severity.error')
                          : diagnostic.severity === 'warning'
                            ? t('panels.severity.warning')
                            : t('panels.severity.note')}
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
  useLocale();
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <span className="empty-title">{title}</span>
      <span className="empty-hint">{hint}</span>
    </div>
  );
}
