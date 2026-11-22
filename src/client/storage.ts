/**
 * Browser preferences are per account. A shared lab machine must not leak the
 * previous user's stdin, breakpoints or open file into the next account
 * (multi-user-auth.md §10.6).
 */

const PREFIX = 'cpplab';
const GLOBAL_KEYS = new Set(['lang']);

/** Keys used by the single-user release; migrated into the first account. */
const LEGACY_KEYS = [
  'stdin',
  'flags',
  'watches',
  'breakpoints',
  'activeFile',
  'runLimits',
  'debugWidth',
  'bottomHeight',
  'editor',
  'debugCollapsed',
];

export function userStorageKey(userId: string, name: string): string {
  if (GLOBAL_KEYS.has(name)) return `${PREFIX}.${name}`;
  return `${PREFIX}.${userId}.${name}`;
}

/**
 * Copy old browser-level values into the account namespace once. The legacy
 * key is removed so the next account cannot read it.
 */
export function migrateLegacyStorage(userId: string): void {
  try {
    for (const name of LEGACY_KEYS) {
      const legacyKey = `${PREFIX}.${name}`;
      const value = localStorage.getItem(legacyKey);
      if (value === null) continue;
      const scopedKey = userStorageKey(userId, name);
      if (localStorage.getItem(scopedKey) === null) localStorage.setItem(scopedKey, value);
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // Private mode or disabled storage: the workspace still works in memory.
  }
}
