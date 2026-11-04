import { useEffect } from 'react';
import { FileCode2, FilePlus2, Star, Trash2, X } from 'lucide-react';
import { t, useLocale } from '../i18n';

interface FileMenuProps {
  files: string[];
  entry: string;
  activeFile: string;
  onSelect: (file: string) => void;
  onDelete: (file: string) => void;
  onSetEntry: (file: string) => void;
  onNewFile: () => void;
  onClose: () => void;
}

export function FileMenu(props: FileMenuProps): JSX.Element {
  useLocale();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="popover-layer">
      <button type="button" className="popover-backdrop" aria-label={t('chrome.filemenu.backdropClose')} onClick={props.onClose} />
      <div className="file-menu" role="dialog" aria-label={t('chrome.filemenu.label')}>
        <div className="popover-head">
          <span>{t('chrome.filemenu.heading')}</span>
          <button type="button" className="icon-btn tiny" onClick={props.onClose} title={t('common.close')}>
            <X size={14} />
          </button>
        </div>
        <div className="file-menu-list">
          {props.files.map((file) => (
            <div className={`file-menu-row ${file === props.activeFile ? 'active' : ''}`} key={file}>
              <button type="button" className="file-menu-open" onClick={() => props.onSelect(file)}>
                <FileCode2 size={14} />
                <span>{file}</span>
                {file === props.entry && <span className="entry-badge">{t('chrome.filemenu.entry')}</span>}
              </button>
              {file !== props.entry && (
                <button
                  type="button"
                  className="icon-btn tiny"
                  onClick={() => props.onSetEntry(file)}
                  title={t('chrome.filemenu.setEntry')}
                >
                  <Star size={13} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn tiny"
                onClick={() => props.onDelete(file)}
                disabled={file === props.entry}
                title={file === props.entry ? t('chrome.filemenu.entryNoDelete') : t('chrome.filemenu.deleteFile')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="file-menu-new" onClick={props.onNewFile}>
          <FilePlus2 size={14} /> {t('chrome.files.newFile')}
        </button>
      </div>
    </div>
  );
}
