import { useEffect, useState } from 'react';
import { Clock3, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { RunDetail, RunSummary } from '../../shared/types';
import { api } from '../api';
import { formatDuration, formatMemory, formatRelative, statusClass, statusLabel } from '../utils/format';

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  onViewRun: (run: RunDetail) => void;
  onRestored: () => void;
  refreshKey: number;
  pushToast: (kind: 'success' | 'error' | 'info', message: string) => void;
}

export function HistoryDrawer(props: HistoryDrawerProps): JSX.Element | null {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await api.runs(60);
      setRuns(response.runs);
    } catch (error) {
      props.pushToast('error', error instanceof Error ? error.message : '加载运行记录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.onClose]);

  useEffect(() => {
    if (props.open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.refreshKey]);

  if (!props.open) return null;

  const view = async (run: RunSummary): Promise<void> => {
    setSelected(run.id);
    try {
      const detail = await api.runDetail(run.id);
      props.onViewRun(detail.run);
    } catch (error) {
      props.pushToast('error', error instanceof Error ? error.message : '读取记录失败');
    }
  };

  const restore = async (run: RunSummary): Promise<void> => {
    setRestoring(run.id);
    try {
      await api.restoreRun(run.id);
      props.onRestored();
      props.pushToast('success', '已恢复该次运行的代码快照');
    } catch (error) {
      props.pushToast('error', error instanceof Error ? error.message : '恢复失败');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="drawer-layer">
      <button type="button" className="drawer-backdrop" aria-label="关闭运行记录" onClick={props.onClose} />
      <aside className="history-drawer">
        <div className="drawer-header">
          <div>
            <span className="drawer-title">运行记录</span>
            <span className="drawer-subtitle">最近的运行与调试快照</span>
          </div>
          <div className="drawer-actions">
            <button type="button" className="icon-btn small" onClick={() => void load()} title="刷新">
              {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            </button>
            <button type="button" className="icon-btn small" onClick={props.onClose} title="关闭">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {runs.length === 0 && !loading ? (
            <div className="drawer-empty">
              <Clock3 size={26} />
              <span>还没有运行记录</span>
              <p>每次运行都会保存源码快照、编译参数与输出，可在这里恢复。</p>
            </div>
          ) : (
            runs.map((run) => (
              <button
                type="button"
                key={run.id}
                className={`history-item ${selected === run.id ? 'selected' : ''}`}
                onClick={() => void view(run)}
              >
                <div className="history-item-head">
                  <span className={`status-pill ${statusClass(run.status)}`}>{statusLabel(run.status)}</span>
                  <span className="history-time">{formatRelative(run.createdAt)}</span>
                </div>
                <div className="history-item-main">
                  <span className="history-entry">{run.source.entry}</span>
                  <span className="history-meta">
                    {run.source.compiler} · {run.source.std} · {run.source.opt}
                  </span>
                </div>
                <div className="history-item-foot">
                  <span>
                    {formatDuration(run.timeMs)} · {formatMemory(run.memoryKb)}
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    className="history-restore"
                    onClick={(event) => {
                      event.stopPropagation();
                      void restore(run);
                    }}
                  >
                    {restoring === run.id ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />}
                    恢复代码
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
