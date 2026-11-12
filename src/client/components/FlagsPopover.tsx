import { useEffect, useState } from 'react';
import { Plus, ShieldCheck, X } from 'lucide-react';
import { t, useLocale } from '../i18n';

interface FlagsPopoverProps {
  flags: string[];
  onChange: (flags: string[]) => void;
  onClose: () => void;
}

const COMMON_FLAGS = [
  { flag: '-DDEBUG', labelKey: 'dialogs.flags.debug' },
  { flag: '-DNDEBUG', labelKey: 'dialogs.flags.ndebug' },
] as const;

export function FlagsPopover(props: FlagsPopoverProps): JSX.Element {
  useLocale();

  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  useEffect(() => {
    setCustom('');
    setError('');
  }, [props.flags]);

  const toggle = (flag: string): void => {
    if (props.flags.includes(flag)) {
      props.onChange(props.flags.filter((item) => item !== flag));
    } else {
      props.onChange([...props.flags, flag]);
    }
  };

  const addCustom = (): void => {
    const value = custom.trim();
    if (!value) return;
    if (!/^-D[A-Za-z_][A-Za-z0-9_]*(=.*)?$|^-I[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(value)) {
      setError(t('dialogs.flags.errorFormat'));
      return;
    }
    if (props.flags.includes(value)) {
      setError(t('dialogs.flags.errorDuplicate'));
      return;
    }
    props.onChange([...props.flags, value]);
    setCustom('');
    setError('');
  };

  return (
    <div className="popover-layer">
      <button type="button" className="popover-backdrop" aria-label={t('dialogs.flags.backdrop')} onClick={props.onClose} />
      <div className="flags-popover" role="dialog" aria-label={t('dialogs.flags.title')}>
        <div className="popover-head">
          <span>{t('dialogs.flags.title')}</span>
          <button type="button" className="icon-btn tiny" onClick={props.onClose} title={t('common.close')}>
            <X size={14} />
          </button>
        </div>
        <p className="popover-note">
          <ShieldCheck size={13} /> {t('dialogs.flags.note')}
        </p>
        <div className="flag-list">
          {COMMON_FLAGS.map((item) => {
            const active = props.flags.includes(item.flag);
            return (
              <label className={`flag-item ${active ? 'active' : ''}`} key={item.flag}>
                <input type="checkbox" checked={active} onChange={() => toggle(item.flag)} />
                <span className="flag-name">{item.flag}</span>
                <span className="flag-desc">{t(item.labelKey)}</span>
              </label>
            );
          })}
        </div>
        {props.flags.filter((flag) => !COMMON_FLAGS.some((item) => item.flag === flag)).length > 0 && (
          <div className="custom-flags">
            {props.flags
              .filter((flag) => !COMMON_FLAGS.some((item) => item.flag === flag))
              .map((flag) => (
                <span className="flag-chip" key={flag}>
                  {flag}
                  <button
                    type="button"
                    onClick={() => props.onChange(props.flags.filter((item) => item !== flag))}
                    title={t('common.remove')}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
          </div>
        )}
        <div className="custom-flag-row">
          <input
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCustom();
              }
            }}
            placeholder={t('dialogs.flags.customPlaceholder')}
            spellCheck={false}
          />
          <button type="button" className="icon-btn small" onClick={addCustom} disabled={!custom.trim()} title={t('dialogs.flags.addTitle')}>
            <Plus size={14} />
          </button>
        </div>
        {error && <p className="flag-error">{error}</p>}
      </div>
    </div>
  );
}
