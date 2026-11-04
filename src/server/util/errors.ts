import type { Locale, LocalizedText, MessageKey, MessageParams } from '../../shared/i18n/index.js';
import { DEFAULT_LOCALE, renderText } from '../../shared/i18n/index.js';

/** Build a message that is rendered in the caller's locale at the HTTP boundary. */
export function msg(key: MessageKey, params?: MessageParams): LocalizedText {
  return { key, params };
}

/** Build a message from text that cannot be translated (tool output, raw errors). */
export function raw(text: string): LocalizedText {
  return { text };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly text: LocalizedText,
    public readonly detail?: LocalizedText,
  ) {
    // Error.message only feeds logs, so render it in the default locale.
    super(renderText(text, DEFAULT_LOCALE) || code);
    this.name = 'ApiError';
  }

  /** Message shown to the user, rendered in `locale`. */
  localized(locale: Locale): string {
    return renderText(this.text, locale) || this.code;
  }
}

export class SandboxUnavailableError extends ApiError {
  constructor(text: LocalizedText, detail?: LocalizedText) {
    super(503, 'SANDBOX_UNAVAILABLE', text, detail);
  }
}

/** Render whatever went wrong in `locale`; used by the run/debug bridges. */
export function errorText(error: unknown, locale: Locale): string {
  if (error instanceof ApiError) return error.localized(locale);
  if (error instanceof Error) return error.message;
  return String(error);
}
