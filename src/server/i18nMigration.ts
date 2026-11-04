import type { DatabaseSync } from 'node:sqlite';

/**
 * Before the i18n layer existed, the starter project was seeded with Chinese
 * literals. Installs created back then still carry them in SQLite, so they are
 * rewritten to message keys once at startup. This module is the only place the
 * legacy text survives, and scripts/i18n-check.mjs exempts it.
 */

const LEGACY_PROJECT_NAME = '我的 C++ 项目';
const LEGACY_SAMPLE_COMMENT = '在 main 中设置断点，观察 values 的变化。';

const SEED_PROJECT_NAME_KEY = '__i18n__:db.projectName';
const SEED_COMMENT_KEY = '// __i18n__:db.sampleComment';

/** Idempotent: rows already holding keys no longer match. */
export function migrateLegacySeed(database: DatabaseSync): void {
  database.prepare('UPDATE projects SET name = ? WHERE name = ?').run(SEED_PROJECT_NAME_KEY, LEGACY_PROJECT_NAME);
  database
    .prepare('UPDATE files SET content = replace(content, ?, ?) WHERE content LIKE ?')
    .run(`// ${LEGACY_SAMPLE_COMMENT}`, SEED_COMMENT_KEY, `%${LEGACY_SAMPLE_COMMENT}%`);
}
