import type { RunStatus } from '../../shared/types';

export const STATUS_LABELS: Record<RunStatus, string> = {
  OK: '通过',
  CE: '编译错误',
  RE: '运行错误',
  TLE: '超时',
  MLE: '内存超限',
  OLE: '输出超限',
  IE: '内部错误',
};

export function statusLabel(status: RunStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusClass(status: RunStatus): string {
  return `status-${status.toLowerCase()}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatMemory(kb: number): string {
  if (!Number.isFinite(kb) || kb <= 0) return '—';
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index >= 0 ? filePath.slice(0, index) : '';
}
