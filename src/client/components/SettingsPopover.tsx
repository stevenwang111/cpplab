import { useEffect, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { t, useLocale, setLocale, LANGUAGE_OPTIONS, type Locale } from '../i18n';
import type { EditorSettings } from './CodeEditor';

interface SettingsPopoverProps {
  settings: EditorSettings;
  projectName: string;
  runLimits: { timeMs: number; memoryMb: number };
  onRunLimitsChange: (limits: { timeMs: number; memoryMb: number }) => void;
  onChange: (settings: EditorSettings) => void;
  onRenameProject: (name: string) => Promise<void>;
  onClose: () => void;
}

export function SettingsPopover(props: SettingsPopoverProps): JSX.Element {
  const locale = useLocale();
  const [name, setName] = useState(props.projectName);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  useEffect(() => {
    setName(props.projectName);
  }, [props.projectName]);

  const update = (patch: Partial<EditorSettings>): void => {
    props.onChange({ ...props.settings, ...patch });
  };

  return (
    <div className="popover-layer">
      <button type="button" className="popover-backdrop" aria-label={t('dialogs.settings.backdrop')} onClick={props.onClose} />
      <div className="settings-popover" role="dialog" aria-label={t('dialogs.settings.title')}>
        <div className="popover-head">
          <span>{t('dialogs.settings.title')}</span>
          <button type="button" className="icon-btn tiny" onClick={props.onClose} title={t('common.close')}>
            <Minus size={14} />
          </button>
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('dialogs.settings.language')}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            aria-label={t('dialogs.settings.language')}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('dialogs.settings.fontSize')}</span>
          <div className="stepper">
            <button
              type="button"
              onClick={() => update({ fontSize: Math.max(11, props.settings.fontSize - 1) })}
              title={t('dialogs.settings.decrease')}
            >
              <Minus size={12} />
            </button>
            <span>{props.settings.fontSize}px</span>
            <button
              type="button"
              onClick={() => update({ fontSize: Math.min(20, props.settings.fontSize + 1) })}
              title={t('dialogs.settings.increase')}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>

        <label className="setting-row clickable">
          <span className="setting-label">{t('dialogs.settings.minimap')}</span>
          <input
            type="checkbox"
            checked={props.settings.minimap}
            onChange={(event) => update({ minimap: event.target.checked })}
          />
        </label>

        <label className="setting-row clickable">
          <span className="setting-label">{t('dialogs.settings.wordWrap')}</span>
          <input
            type="checkbox"
            checked={props.settings.wordWrap === 'on'}
            onChange={(event) => update({ wordWrap: event.target.checked ? 'on' : 'off' })}
          />
        </label>

        <div className="setting-divider" />

        <div className="setting-row">
          <span className="setting-label">{t('dialogs.settings.timeLimit')}</span>
          <select
            value={props.runLimits.timeMs}
            onChange={(event) => props.onRunLimitsChange({ ...props.runLimits, timeMs: Number(event.target.value) })}
          >
            <option value={1000}>{t('dialogs.settings.seconds', { n: 1 })}</option>
            <option value={2000}>{t('dialogs.settings.seconds', { n: 2 })}</option>
            <option value={5000}>{t('dialogs.settings.seconds', { n: 5 })}</option>
            <option value={10000}>{t('dialogs.settings.seconds', { n: 10 })}</option>
          </select>
        </div>

        <div className="setting-row">
          <span className="setting-label">{t('dialogs.settings.memoryLimit')}</span>
          <select
            value={props.runLimits.memoryMb}
            onChange={(event) => props.onRunLimitsChange({ ...props.runLimits, memoryMb: Number(event.target.value) })}
          >
            <option value={128}>128 MiB</option>
            <option value={256}>256 MiB</option>
            <option value={512}>512 MiB</option>
          </select>
        </div>

        <div className="setting-divider" />

        <div className="setting-block">
          <span className="setting-label">{t('dialogs.settings.projectName')}</span>
          <div className="rename-row">
            <input
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('dialogs.settings.projectName')}
            />
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={!name.trim() || name.trim() === props.projectName || renaming}
              onClick={() => {
                setRenaming(true);
                void props
                  .onRenameProject(name.trim())
                  .finally(() => setRenaming(false));
              }}
            >
              <Check size={13} /> {t('common.save')}
            </button>
          </div>
        </div>

        <p className="setting-note">{t('dialogs.settings.note')}</p>
      </div>
    </div>
  );
}
