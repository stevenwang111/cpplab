/**
 * i18n guard. Run with `npm run i18n:check`.
 *
 * Fails when:
 *   1. a source file outside the message catalogs still contains CJK text,
 *   2. the zh-CN and en catalogs disagree on keys or on {placeholder} sets,
 *   3. the same message key is declared by two different slices.
 *
 * Exemptions are deliberate: the zh-CN catalogs hold the source strings, the
 * legacy seed migration still carries the old text it rewrites, and index.html
 * keeps a small pre-paint fallback for the tab title.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogs } from '../src/shared/i18n/messages/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

const EXEMPT_PATHS = [
  path.join('src', 'shared', 'i18n', 'messages'),
  path.join('src', 'server', 'i18nMigration.ts'),
  path.join('scripts', 'i18n-check.mts'),
  'index.html',
];
const EXEMPT_LINE = 'i18n-allowed';

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mjs', '.md', '.sh', '.html']);
const SCAN_ROOTS = ['src', 'scripts', 'tests'];

const errors: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(filePath: string): string {
  return path.relative(root, filePath);
}

function isExempt(filePath: string): boolean {
  const relative = rel(filePath);
  return EXEMPT_PATHS.some((prefix) => relative === prefix || relative.startsWith(prefix));
}

// --- 1. no CJK outside the catalogs ---------------------------------------
for (const scanRoot of SCAN_ROOTS) {
  const base = path.join(root, scanRoot);
  if (!fs.existsSync(base)) continue;
  for (const filePath of walk(base)) {
    if (!SCAN_EXTENSIONS.has(path.extname(filePath)) || isExempt(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes(EXEMPT_LINE)) return;
      if (CJK.test(line)) errors.push(`${rel(filePath)}:${index + 1}: untranslated text -> ${line.trim()}`);
    });
  }
}

// --- 2. catalog parity -----------------------------------------------------
const zh = catalogs['zh-CN'];
const en = catalogs.en;
const zhKeys = Object.keys(zh).sort();
const enKeys = Object.keys(en).sort();

for (const key of zhKeys) if (!(key in en)) errors.push(`missing en translation: ${key}`);
for (const key of enKeys) if (!(key in zh)) errors.push(`missing zh-CN translation: ${key}`);

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
}

for (const key of zhKeys) {
  if (!(key in en)) continue;
  const zhPlaceholders = placeholders(zh[key]);
  const enPlaceholders = placeholders(en[key]);
  if (zhPlaceholders !== enPlaceholders) {
    errors.push(`placeholder mismatch for ${key}: zh-CN [${zhPlaceholders}] vs en [${enPlaceholders}]`);
  }
}

// --- 3. no key declared twice ---------------------------------------------
const owner = new Map<string, string>();
const messageDir = path.join(root, 'src', 'shared', 'i18n', 'messages');
for (const filePath of fs.readdirSync(messageDir)) {
  if (!filePath.endsWith('.ts') || filePath === 'index.ts') continue;
  const source = fs.readFileSync(path.join(messageDir, filePath), 'utf8');
  for (const match of source.matchAll(/^\s{2}'([^']+)':/gm)) {
    const key = match[1];
    const previous = owner.get(key);
    if (previous && previous !== filePath) errors.push(`duplicate key ${key} in ${previous} and ${filePath}`);
    owner.set(key, filePath);
  }
}

// --- report ----------------------------------------------------------------
if (errors.length > 0) {
  console.error(`i18n check failed with ${errors.length} problem(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`i18n check passed: ${zhKeys.length} keys, zh-CN and en in sync, no stray CJK in ${SCAN_ROOTS.join('/')}.`);
