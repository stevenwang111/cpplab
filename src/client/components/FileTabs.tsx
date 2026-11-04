import { FileCode2, Plus, X } from 'lucide-react';

interface FileTabsProps {
  openTabs: string[];
  files: Record<string, string>;
  activeFile: string;
  entry: string;
  dirty: Set<string>;
  onSelect: (file: string) => void;
  onClose: (file: string) => void;
  onNewFile: () => void;
}

export function FileTabs(props: FileTabsProps): JSX.Element {
  return (
    <div className="file-tabs">
      <div className="file-tabs-scroll">
        {props.openTabs.map((file) => {
          const isActive = file === props.activeFile;
          const isDirty = props.dirty.has(file);
          return (
            <button
              type="button"
              key={file}
              className={`file-tab ${isActive ? 'active' : ''} ${file === props.entry ? 'is-entry' : ''}`}
              onClick={() => props.onSelect(file)}
              title={`${file}${file === props.entry ? '（入口文件）' : ''}`}
            >
              <FileCode2 size={14} className="file-tab-icon" />
              <span className="file-tab-name">{file.split('/').pop()}</span>
              {file.includes('/') && <span className="file-tab-dir">{file.slice(0, file.lastIndexOf('/'))}/</span>}
              {isDirty && <span className="dirty-dot" />}
              <span
                role="button"
                tabIndex={-1}
                className="file-tab-close"
                aria-label={`关闭 ${file}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClose(file);
                }}
              >
                <X size={12} />
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className="file-tab-add" onClick={props.onNewFile} title="新建文件">
        <Plus size={15} />
      </button>
    </div>
  );
}
