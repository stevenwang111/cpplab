/** Locale primitives shared by the HTTP server and the React client. */

export const LOCALES = ['zh-CN', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/** Used when nothing else is known about the caller. English-first. */
export const DEFAULT_LOCALE: Locale = 'en';

export type MessageParams = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Parse an Accept-Language header (or a bare `lang=` value) into a supported locale.
 * Unknown or missing input falls back to DEFAULT_LOCALE.
 */
export function resolveLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase();
    if (!tag) continue;
    if (tag === '*') return DEFAULT_LOCALE;
    if (tag.startsWith('zh')) return 'zh-CN';
    if (tag.startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}
