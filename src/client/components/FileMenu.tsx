import { useEffect } from 'react';
import { FileCode2, FilePlus2, Star, Trash2, X } from 'lucide-react';

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="popover-layer">
      <button type="button" className="popover-backdrop" aria-label="关闭文件列表" onClick={props.onClose} />
      <div className="file-menu" role="dialog" aria-label="文件列表">
        <div className="popover-head">
          <span>工作区文件</span>
          <button type="button" className="icon-btn tiny" onClick={props.onClose} title="关闭">
            <X size={14} />
          </button>
        </div>
        <div className="file-menu-list">
          {props.files.map((file) => (
            <div className={`file-menu-row ${file === props.activeFile ? 'active' : ''}`} key={file}>
              <button type="button" className="file-menu-open" onClick={() => props.onSelect(file)}>
                <FileCode2 size={14} />
                <span>{file}</span>
                {file === props.entry && <span className="entry-badge">入口</span>}
              </button>
              {file !== props.entry && (
                <button
                  type="button"
                  className="icon-btn tiny"
                  onClick={() => props.onSetEntry(file)}
                  title="设为入口文件"
                >
                  <Star size={13} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn tiny"
                onClick={() => props.onDelete(file)}
                disabled={file === props.entry}
                title={file === props.entry ? '入口文件不能删除' : '删除文件'}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="file-menu-new" onClick={props.onNewFile}>
          <FilePlus2 size={14} /> 新建文件
        </button>
      </div>
    </div>
  );
}
