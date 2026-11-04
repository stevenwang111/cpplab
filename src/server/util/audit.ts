import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/** Append-only audit trail for run/debug lifecycle events. */
export function audit(entry: Record<string, unknown>): void {
  try {
    const dir = path.join(config.dataDir, 'runtime');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'audit.log'),
      `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Audit logging must not break request handling.
  }
}
