/**
 * Headless UI check for the i18n layer. Run with `npm run i18n:ui`.
 *
 * What it proves, in a real browser:
 *   1. an en-US browser gets an English page (lang, title, zero CJK in text or
 *      in title/aria-label/placeholder attributes),
 *   2. the starter code comment inside the editor is English too,
 *   3. the language switch in Settings flips the UI to Chinese and persists,
 *   4. the choice survives a reload and can be switched back.
 *
 * Requires a running backend: BASE_URL=http://127.0.0.1:3104 npm run i18n:ui
 * Requires Playwright's chromium (available in this environment); the script
 * exits with a clear message when it is not installed.
 */
const fs = require('node:fs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright is not installed; skipping the browser check.');
  process.exit(2);
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3104';
const SHOTS = process.env.SHOT_DIR || '/tmp';
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

const failures = [];
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

/** Everything a user can read: visible text plus the labels around widgets. */
async function readUiText(page) {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, option, noscript').forEach((node) => node.remove());
    const text = clone.textContent || '';
    const attrs = [...document.querySelectorAll('[title], [aria-label], [placeholder], [alt]')]
      .map((el) =>
        [el.title, el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('alt')]
          .filter(Boolean)
          .join(' '),
      )
      .join(' ');
    return `${text}\n${attrs}`;
  });
}

async function cjkLines(text) {
  return text.split('\n').map((line) => line.trim()).filter((line) => line && CJK.test(line));
}

/** Monaco paints its lines asynchronously and may use non-breaking spaces. */
async function pageHasText(page, needle, timeoutMs = 20000) {
  const wanted = normalizeText(needle);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = normalizeText(await page.evaluate(() => document.body.textContent || ''));
    if (text.includes(wanted)) return { found: true, text };
    if (Date.now() > deadline) return { found: false, text };
    await page.waitForTimeout(250);
  }
}

/** Fold the invisible spacing characters Monaco uses so ASCII needles match. */
function normalizeText(value) {
  return value.replace(/[\u00a0\u2007\u202f\u200b]/g, ' ');
}

async function openSettings(page) {
  await page.click('button[title="Editor settings"]');
  await page.waitForSelector('select[aria-label="Language"]', { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });

  try {
    console.log(`1. English page (browser locale en-US) — ${BASE}`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.view-lines', { timeout: 60000 });
    await page.waitForTimeout(800);

    check('html lang is en', (await page.getAttribute('html', 'lang')) === 'en');
    check('document title', (await page.title()) === 'CppLab · Online C++ IDE', await page.title());

    const englishText = await readUiText(page);
    const englishCjk = await cjkLines(englishText);
    check('no CJK anywhere in the English UI', englishCjk.length === 0, englishCjk.slice(0, 5).join(' / '));

    const editor = await pageHasText(page, 'Set a breakpoint in main');
    check('starter comment in the editor is English', editor.found, editor.text.slice(0, 80).replace(/\s+/g, ' '));
    const labels = await page.evaluate(() => document.body.innerText);
    check('Run button visible', /\bRun\b/.test(labels));
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/i18n-en.png` });

    console.log('2. Language switch to Chinese');
    await openSettings(page);
    const languageSelect = page.locator('select[aria-label="Language"]');
    check('language row present in Settings', (await languageSelect.count()) === 1);
    check('defaults to English', (await languageSelect.inputValue()) === 'en');
    await page.screenshot({ path: `${SHOTS}/i18n-settings-en.png` });
    await languageSelect.selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN', null, { timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const chineseText = await readUiText(page);
    check('Chinese UI shows CJK', (await cjkLines(chineseText)).length > 0);
    check(
      'switch persisted to localStorage',
      (await page.evaluate(() => localStorage.getItem('cpplab.lang'))) === 'zh-CN',
    );
    const zhEditor = await pageHasText(page, '在 main 中设置断点');
    check('starter comment follows the language', zhEditor.found);
    await page.screenshot({ path: `${SHOTS}/i18n-zh.png` });

    console.log('3. Reload keeps the choice, and switching back works');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.view-lines', { timeout: 60000 });
    check('zh-CN survives a reload', (await page.getAttribute('html', 'lang')) === 'zh-CN');

    await page.click('button[title="编辑器设置"]');
    await page.waitForSelector('select[aria-label="界面语言"]', { timeout: 10000 });
    await page.locator('select[aria-label="界面语言"]').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 10000 });
    check('back to English', (await page.getAttribute('html', 'lang')) === 'en');

    console.log('4. Page health');
    const fatal = await page.locator('h1:has-text("无法加载工作区"), h1:has-text("Workspace")').count();
    check('no fatal error screen', fatal === 0);
    check('no page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } catch (error) {
    failures.push(`exception: ${error.message}`);
    console.error(`  ✗ exception: ${error.message}`);
    try {
      await page.screenshot({ path: `${SHOTS}/i18n-error.png` });
    } catch {
      // Nothing else to do; the report below carries the failure.
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\ni18n UI check failed (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`\ni18n UI check passed. Screenshots: ${SHOTS}/i18n-en.png, ${SHOTS}/i18n-zh.png`);
})();
