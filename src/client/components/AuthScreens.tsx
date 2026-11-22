import { useState } from 'react';
import { AlertTriangle, Code2, KeyRound, Loader2, LogOut, ShieldCheck, UserRound, X } from 'lucide-react';
import type { AuthUser } from '../../shared/types';
import { api, ApiClientError } from '../api';
import { LANGUAGE_OPTIONS, setLocale, t, useLocale } from '../i18n';

function errorMessage(error: unknown, fallbackKey: Parameters<typeof t>[0]): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return t(fallbackKey);
}

export function LoginScreen({
  notice,
  onSuccess,
}: {
  notice?: string;
  onSuccess: (user: AuthUser) => void;
}): JSX.Element {
  const locale = useLocale();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = await api.login(username, password);
      setPassword('');
      onSuccess(state.user);
    } catch (caught) {
      setError(errorMessage(caught, 'auth.error.loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <Code2 size={20} strokeWidth={2.2} />
          </span>
          <span className="brand-text">
            Cpp<span>Lab</span>
          </span>
          <select
            className="auth-lang"
            aria-label={t('dialogs.settings.language')}
            value={locale}
            onChange={(event) => setLocale(event.target.value as typeof locale)}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <h1>{t('auth.login.title')}</h1>
        <p className="auth-subtitle">{t('auth.login.subtitle')}</p>

        {notice && <p className="auth-notice">{notice}</p>}

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>{t('auth.login.username')}</span>
            <input
              name="username"
              autoComplete="username"
              autoFocus
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>{t('auth.login.password')}</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              <AlertTriangle size={13} /> {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <UserRound size={15} />}
            {busy ? t('auth.login.submitting') : t('auth.login.submit')}
          </button>
        </form>

        <p className="auth-footnote">
          <ShieldCheck size={12} /> {t('auth.login.footnote')}
        </p>
      </div>
    </div>
  );
}

interface PasswordFormProps {
  onSuccess: (user: AuthUser) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/** Shared by the forced-change screen and the user menu dialog. */
function PasswordForm({ onSuccess, onCancel, autoFocus }: PasswordFormProps): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (newPassword.length < 10) {
      setError(t('auth.password.tooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('auth.password.mismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('auth.password.unchanged'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const state = await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onSuccess(state.user);
    } catch (caught) {
      setError(errorMessage(caught, 'auth.error.passwordFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label className="field">
        <span>{t('auth.password.current')}</span>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus={autoFocus}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>{t('auth.password.new')}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>{t('auth.password.confirm')}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
      </label>
      <p className="field-hint">{t('auth.password.hint')}</p>
      {error && (
        <p className="auth-error" role="alert">
          <AlertTriangle size={13} /> {error}
        </p>
      )}
      <div className="auth-form-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
          {busy ? t('auth.password.submitting') : t('auth.password.submit')}
        </button>
      </div>
    </form>
  );
}

export function ChangePasswordScreen({
  user,
  onSuccess,
  onLogout,
}: {
  user: AuthUser;
  onSuccess: (user: AuthUser) => void;
  onLogout: () => void;
}): JSX.Element {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <Code2 size={20} strokeWidth={2.2} />
          </span>
          <span className="brand-text">
            Cpp<span>Lab</span>
          </span>
        </div>
        <h1>{t('auth.change.title')}</h1>
        <p className="auth-subtitle">{t('auth.change.subtitle', { username: user.username })}</p>
        <PasswordForm onSuccess={onSuccess} autoFocus />
        <button type="button" className="auth-logout" onClick={onLogout}>
          <LogOut size={13} /> {t('auth.user.logout')}
        </button>
      </div>
    </div>
  );
}

export function ChangePasswordDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}): JSX.Element | null {
  if (!open) return null;
  return (
    <div className="modal-layer">
      <button type="button" className="modal-backdrop" aria-label={t('common.close')} onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('auth.password.dialogTitle')}>
        <div className="modal-head">
          <span className="modal-icon">
            <KeyRound size={18} />
          </span>
          <div>
            <h2>{t('auth.password.dialogTitle')}</h2>
            <p>{t('auth.password.dialogSubtitle')}</p>
          </div>
          <button type="button" className="icon-btn small" onClick={onClose} aria-label={t('common.close')}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <PasswordForm
            onSuccess={(user) => {
              onSuccess(user);
              onClose();
            }}
            onCancel={onClose}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
