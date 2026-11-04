import type {
  ApiErrorBody,
  Capabilities,
  DebugStartRequest,
  DebugStartResponse,
  FileEntry,
  Project,
  ProjectState,
  RunDetail,
  RunResult,
  RunSummary,
  RunRequest,
} from '../shared/types';
import { getLocale, t } from './i18n';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // The server renders API errors, run phases and sandbox notes in this language.
      'Accept-Language': getLocale(),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Fall through to the generic message.
    }
    throw new ApiClientError(
      response.status,
      body?.error.code ?? 'HTTP_ERROR',
      body?.error.message ?? t('api.httpError', { status: response.status }),
      body?.error.detail,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; capabilities: Capabilities }>('/api/health'),

  project: () => request<ProjectState>('/api/project'),

  updateProject: (body: { settings?: Partial<Project['settings']>; name?: string }) =>
    request<{ project: Project }>('/api/project', { method: 'PATCH', body: JSON.stringify(body) }),

  saveFile: (path: string, content: string) =>
    request<{ ok: boolean }>('/api/files', { method: 'POST', body: JSON.stringify({ path, content }) }),

  deleteFile: (path: string) =>
    request<{ ok: boolean }>(`/api/files/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE',
    }),

  format: (file: string, content: string) =>
    request<{ formatted: string; changed: boolean }>('/api/format', {
      method: 'POST',
      body: JSON.stringify({ file, content }),
    }),

  run: (body: RunRequest) =>
    request<{ runId: string; wsPath: string }>('/api/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  runResult: (id: string) =>
    request<{ runId: string; done: boolean; result: RunResult | null }>(`/api/run/${id}`),

  runs: (limit = 40) => request<{ runs: RunSummary[] }>(`/api/runs?limit=${limit}`),

  runDetail: (id: string) => request<{ run: RunDetail }>(`/api/runs/${id}`),

  restoreRun: (id: string) =>
    request<ProjectState>(`/api/runs/${id}/restore`, { method: 'POST', body: '{}' }),

  startDebug: (body: DebugStartRequest) =>
    request<DebugStartResponse | { status: 'CE'; diagnostics: unknown[]; compileOutput: string }>(
      '/api/debug/start',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  stopDebug: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/debug/${sessionId}/stop`, { method: 'POST', body: '{}' }),
};

export function wsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export function toFileMap(files: FileEntry[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.path, file.content]));
}
