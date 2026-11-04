import fs from 'node:fs';
import path from 'node:path';

/** Resolve a command name through PATH without invoking a shell. */
export function findExecutable(name: string, extraDirs: string[] = []): string | undefined {
  const dirs = [...extraDirs, ...(process.env.PATH ?? '').split(path.delimiter)].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep looking; a missing tool is an expected state.
    }
  }
  return undefined;
}
