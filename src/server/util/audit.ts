import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_BACKUPS = 5;
const MAX_LINE_CHARS = 8 * 1024;

/**
 * Cap a single audit line. Failure floods are also rate-limited before they
 * reach this function, but a bounded line keeps one request from bloating the
 * log.
 */
function boundedLine(entry: Record<string, unknown>): string {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  if (line.length <= MAX_LINE_CHARS) return line;
  return `${line.slice(0, MAX_LINE_CHARS)}...[truncated]`;
}

function rotateIfNeeded(file: string): void {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  if (size < MAX_LOG_BYTES) return;
  try {
    fs.rmSync(`${file}.${MAX_BACKUPS}`, { force: true });
    for (let index = MAX_BACKUPS - 1; index >= 1; index -= 1) {
      const from = `${file}.${index}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${file}.${index + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    // Rotation failing must not break request handling.
  }
}

/** Append-only audit trail for auth and run/debug lifecycle events. */
export function audit(entry: Record<string, unknown>): void {
  try {
    const dir = path.join(config.dataDir, 'runtime');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'audit.log');
    rotateIfNeeded(file);
    fs.appendFileSync(file, `${boundedLine(entry)}\n`, { mode: 0o600 });
  } catch {
    // Audit logging must not break request handling.
  }
}
