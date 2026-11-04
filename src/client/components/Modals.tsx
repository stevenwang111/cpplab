import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, FilePlus2, X } from 'lucide-react';
import { t, useLocale } from '../i18n';

function ModalShell({
  title,
  subtitle,
  icon,
  children,
  footer,
  onClose,
  wide,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}): JSX.Element {
  useLocale();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-layer">
      <button type="button" className="modal-backdrop" aria-label={t('dialogs.modal.backdrop')} onClick={onClose} />
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span className="modal-icon">{icon}</span>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn small" onClick={onClose} title={t('common.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function NewFileModal({
  open,
  existing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  existing: string[];
  onClose: () => void;
  onSubmit: (path: string) => Promise<void>;
}): JSX.Element | null {
  useLocale();

  const [value, setValue] = useStateValue(open, existing);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setError('');
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    const path = value.trim();
    if (!path) {
      setError(t('dialogs.newFile.errorEmptyPath'));
      return;
    }
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(path) || path.includes('..') || path.startsWith('/')) {
      setError(t('dialogs.newFile.errorInvalidPath'));
      return;
    }
    if (existing.includes(path)) {
      setError(t('dialogs.newFile.errorExists'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(path);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dialogs.newFile.errorCreateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={t('dialogs.newFile.title')}
      subtitle={t('dialogs.newFile.subtitle')}
      icon={<FilePlus2 size={19} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t('dialogs.newFile.creating') : t('dialogs.newFile.submit')}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{t('dialogs.newFile.pathLabel')}</span>
        <input
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={t('dialogs.newFile.pathPlaceholder')}
          spellCheck={false}
        />
      </label>
      <p className="field-hint">{t('dialogs.newFile.hint')}</p>
      {error && <p className="field-error">{error}</p>}
    </ModalShell>
  );
}

function useStateValue(open: boolean, existing: string[]): [string, (value: string) => void] {
  // The component is mounted only while open; deriving the default from the
  // current file set avoids a stale suggestion after a deletion.
  const suggestion = suggestName(existing);
  const [value, setValue] = useState(suggestion);
  useEffect(() => {
    if (open) setValue(suggestName(existing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return [value, setValue];
}

function suggestName(existing: string[]): string {
  const base = 'solution';
  let index = 1;
  let candidate = `${base}.cpp`;
  while (existing.includes(candidate)) {
    index += 1;
    candidate = `${base}${index}.cpp`;
  }
  return candidate;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  danger = true,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): JSX.Element | null {
  useLocale();

  if (!open) return null;
  return (
    <ModalShell
      title={title}
      icon={<AlertTriangle size={19} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
    </ModalShell>
  );
}

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  useLocale();

  if (!open) return null;
  return (
    <ModalShell
      title={t('dialogs.help.title')}
      subtitle={t('dialogs.help.subtitle')}
      icon={<span className="help-mark">C++</span>}
      onClose={onClose}
      wide
    >
      <div className="help-grid">
        <section>
          <h3>{t('dialogs.help.shortcuts')}</h3>
          <dl className="shortcut-list">
            <div><dt><kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd></dt><dd>{t('dialogs.help.shortcut.run')}</dd></div>
            <div><dt><kbd>F5</kbd></dt><dd>{t('dialogs.help.shortcut.debugContinue')}</dd></div>
            <div><dt><kbd>Shift</kbd> + <kbd>F5</kbd></dt><dd>{t('dialogs.help.shortcut.debugStop')}</dd></div>
            <div><dt><kbd>F9</kbd></dt><dd>{t('dialogs.help.shortcut.toggleBreakpoint')}</dd></div>
            <div><dt><kbd>F10</kbd></dt><dd>{t('dialogs.help.shortcut.stepOver')}</dd></div>
            <div><dt><kbd>F11</kbd></dt><dd>{t('dialogs.help.shortcut.stepInto')}</dd></div>
            <div><dt><kbd>Shift</kbd> + <kbd>F11</kbd></dt><dd>{t('dialogs.help.shortcut.stepOut')}</dd></div>
            <div><dt><kbd>Ctrl/⌘</kbd> + <kbd>S</kbd></dt><dd>{t('dialogs.help.shortcut.saveFile')}</dd></div>
            <div><dt><kbd>Ctrl/⌘</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></dt><dd>{t('dialogs.help.shortcut.format')}</dd></div>
          </dl>
        </section>
        <section>
          <h3>{t('dialogs.help.security')}</h3>
          <ul className="help-list">
            <li>{t('dialogs.help.securityNsJail')}</li>
            <li>{t('dialogs.help.securityTmpfs')}</li>
            <li>{t('dialogs.help.securitySandbox')}</li>
            <li>{t('dialogs.help.securityWhitelist')}</li>
            <li>{t('dialogs.help.securityPtrace')}</li>
          </ul>
          <h3>{t('dialogs.help.limits')}</h3>
          <ul className="help-list">
            <li>{t('dialogs.help.limitsSource')}</li>
            <li>{t('dialogs.help.limitsRuntime')}</li>
            <li>{t('dialogs.help.limitsConcurrency')}</li>
            <li>{t('dialogs.help.limitsDebug')}</li>
          </ul>
        </section>
      </div>
    </ModalShell>
  );
}
