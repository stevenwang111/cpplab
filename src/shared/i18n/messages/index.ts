import type { Locale } from '../types.js';
import common from './common.js';
import chrome from './chrome.js';
import panels from './panels.js';
import dialogs from './dialogs.js';
import app from './app.js';
import client from './client.js';

/**
 * Slices are spread in source order. A key defined by two slices would be a
 * silent override, which `scripts/i18n-check.mts` rejects, so keep prefixes unique.
 */
export const zhCNMessages = {
  ...common['zh-CN'],
  ...chrome['zh-CN'],
  ...panels['zh-CN'],
  ...dialogs['zh-CN'],
  ...app['zh-CN'],
  ...client['zh-CN'],
};

export const enMessages = {
  ...common.en,
  ...chrome.en,
  ...panels.en,
  ...dialogs.en,
  ...app.en,
  ...client.en,
};

/** Every key that ships in the product. Each slice keeps zh-CN and en in lockstep. */
export type MessageKey = keyof typeof zhCNMessages;

export const catalogs: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCNMessages,
  en: enMessages,
};
