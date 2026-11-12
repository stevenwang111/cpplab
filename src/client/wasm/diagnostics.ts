/**
 * clang diagnostic parsing.
 *
 * The compiler runs inside the worker with `<workspace>` as its root, so the
 * absolute paths it reports map straight back to editor model paths.
 */
import type { Diagnostic } from '../../shared/types';
import { WORKSPACE_ROOT } from './constants';

const DIAGNOSTIC_RE = /^([^:\s]+):(\d+)(?::(\d+))?:\s+(fatal error|error|warning|note):\s+(.*)$/;

export interface ParsedDiagnostics {
  diagnostics: Diagnostic[];
  warnings: number;
  errors: number;
}

export function parseDiagnostics(compilerStderr: string): ParsedDiagnostics {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  let warnings = 0;
  let errors = 0;

  for (const rawLine of compilerStderr.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(' ') || line.startsWith('In file included from')) continue;
    const match = DIAGNOSTIC_RE.exec(line);
    if (!match) continue;

    const [, rawFile, rawLineNumber, rawColumn, severity, message] = match;
    if (rawFile === '<command-line>' || rawFile === '<built-in>') continue;
    const file = normalizeDiagnosticFile(rawFile);
    if (!file) continue;
    const lineNumber = Number(rawLineNumber);
    if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) continue;
    const col = rawColumn ? Math.max(1, Number(rawColumn) || 1) : 1;
    const key = `${file}:${lineNumber}:${col}:${severity}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const normalized = severity === 'fatal error' ? 'error' : (severity as Diagnostic['severity']);
    diagnostics.push({ file, line: lineNumber, col, severity: normalized, message });
    if (normalized === 'error') errors += 1;
    if (normalized === 'warning') warnings += 1;
  }

  return { diagnostics, warnings, errors };
}

function normalizeDiagnosticFile(raw: string): string | null {
  if (!raw || raw === '<stdin>') return null;
  let value = raw.replace(/\\/g, '/');
  if (value.startsWith(`${WORKSPACE_ROOT}/`)) value = value.slice(WORKSPACE_ROOT.length + 1);
  if (value.startsWith('/')) {
    // Sysroot headers are useful context but cannot be opened in the editor.
    if (value.startsWith('/usr/')) return null;
    value = value.slice(value.lastIndexOf('/') + 1);
  }
  if (!value || value === '.' || value.startsWith('../')) return null;
  return value;
}
