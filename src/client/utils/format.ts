import type { RunStatus } from '../../shared/types';
import type { MessageKey } from '../../shared/i18n';
import { getLocale, t } from '../i18n';

const STATUS_KEYS: Record<RunStatus, MessageKey> = {
  OK: 'fmt.status.ok',
  CE: 'fmt.status.ce',
  RE: 'fmt.status.re',
  TLE: 'fmt.status.tle',
  MLE: 'fmt.status.mle',
  OLE: 'fmt.status.ole',
  IE: 'fmt.status.ie',
};

export function statusLabel(status: RunStatus): string {
  const key = STATUS_KEYS[status];
  return key ? t(key) : status;
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
  return date.toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return t('fmt.relative.justNow');
  if (diff < 3_600_000) return t('fmt.relative.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('fmt.relative.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  return new Date(timestamp).toLocaleDateString(getLocale(), { month: '2-digit', day: '2-digit' });
}

export function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index >= 0 ? filePath.slice(0, index) : '';
}
