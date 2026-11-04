import type { NextFunction, Request, Response } from 'express';
import {
  isLocale,
  resolveLocale,
  translate,
  type Locale,
  type MessageKey,
} from '../shared/i18n/index.js';

/** Seeded database values store a message key instead of a fixed language. */
const SEED_PREFIX = '__i18n__:';

/**
 * Resolve seeded values (default project name, starter-code comments) into the
 * caller's language. Anything without the marker is returned untouched.
 */
export function resolveI18nText(value: string, locale: Locale): string {
  if (!value.includes(SEED_PREFIX)) return value;
  return value.replace(/__i18n__:([A-Za-z][\w.]*)/g, (_match, key: string) =>
    translate(locale, key as MessageKey),
  );
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Language negotiated for this request (Accept-Language, then ?lang). */
    locale: Locale;
  }
}

/**
 * Every response carries a language: the client sends `Accept-Language`, so the
 * same code path serves English and Chinese without duplicating routes.
 */
export function localeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const query = req.query.lang;
  if (isLocale(query)) {
    req.locale = query;
  } else {
    req.locale = resolveLocale(headerValue(req.headers['accept-language']));
  }
  next();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** For code outside Express (debug sessions, run sessions) that must pick a language. */
export function negotiateLocale(header: string | string[] | undefined): Locale {
  return resolveLocale(headerValue(header));
}
