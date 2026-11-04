import { useSyncExternalStore } from 'react';
import {
  DEFAULT_LOCALE,
  isLocale,
  resolveLocale,
  translate,
  type Locale,
  type MessageKey,
  type MessageParams,
} from '../../shared/i18n';

export type { Locale };

const STORAGE_KEY = 'cpplab.lang';

function readStoredLocale(): Locale | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Storage → browser language → English. */
export function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const nav = typeof navigator === 'undefined' ? '' : navigator.language || '';
  if (/^zh\b/i.test(nav) || /^zh-/i.test(nav)) return 'zh-CN';
  if (/^en\b/i.test(nav) || /^en-/i.test(nav)) return 'en';
  return DEFAULT_LOCALE;
}

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

function syncDocument(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.title = translate(current, 'meta.title');
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', translate(current, 'meta.description'));
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode: the choice just will not survive a reload.
  }
  syncDocument();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the calling component whenever the language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** Translate with the locale currently active in this browser tab. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params);
}

/** For UI that lists the available languages. Names stay in their own language. */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '中文' }, // i18n-allowed: language names are self-referential
];

// Apply lang/title/meta as soon as the client bundle boots.
syncDocument();
