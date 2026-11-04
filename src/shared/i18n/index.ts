import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  resolveLocale,
  type Locale,
  type MessageParams,
} from './types.js';
import { catalogs, type MessageKey } from './messages/index.js';

export { DEFAULT_LOCALE, LOCALES, isLocale, resolveLocale };
export type { Locale, MessageKey, MessageParams };

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Render a message in `locale`.
 * Unknown keys fall back to English, then to the key itself, so a missing
 * translation degrades instead of crashing the UI.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const template = catalogs[locale]?.[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}

/**
 * A message that may be localizable (`key`) or already concrete (`text`).
 * Server code that runs far from a request context returns this instead of a
 * pre-rendered string.
 */
export interface LocalizedText {
  key?: MessageKey;
  params?: MessageParams;
  text?: string;
}

export function localized(key: MessageKey, params?: MessageParams): LocalizedText {
  return { key, params };
}

export function renderText(value: LocalizedText | string | undefined, locale: Locale): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value.key) return translate(locale, value.key, value.params);
  return value.text ?? '';
}
