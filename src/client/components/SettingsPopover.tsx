import { useEffect, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
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
      <button type="button" className="popover-backdrop" aria-label="关闭设置" onClick={props.onClose} />
      <div className="settings-popover" role="dialog" aria-label="编辑器设置">
        <div className="popover-head">
          <span>编辑器设置</span>
          <button type="button" className="icon-btn tiny" onClick={props.onClose} title="关闭">
            <Minus size={14} />
          </button>
        </div>

        <div className="setting-row">
          <span className="setting-label">字体大小</span>
          <div className="stepper">
            <button
              type="button"
              onClick={() => update({ fontSize: Math.max(11, props.settings.fontSize - 1) })}
              title="减小"
            >
              <Minus size={12} />
            </button>
            <span>{props.settings.fontSize}px</span>
            <button
              type="button"
              onClick={() => update({ fontSize: Math.min(20, props.settings.fontSize + 1) })}
              title="增大"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>

        <label className="setting-row clickable">
          <span className="setting-label">显示 minimap</span>
          <input
            type="checkbox"
            checked={props.settings.minimap}
            onChange={(event) => update({ minimap: event.target.checked })}
          />
        </label>

        <label className="setting-row clickable">
          <span className="setting-label">自动换行</span>
          <input
            type="checkbox"
            checked={props.settings.wordWrap === 'on'}
            onChange={(event) => update({ wordWrap: event.target.checked ? 'on' : 'off' })}
          />
        </label>

        <div className="setting-divider" />

        <div className="setting-row">
          <span className="setting-label">运行时限</span>
          <select
            value={props.runLimits.timeMs}
            onChange={(event) => props.onRunLimitsChange({ ...props.runLimits, timeMs: Number(event.target.value) })}
          >
            <option value={1000}>1 秒</option>
            <option value={2000}>2 秒</option>
            <option value={5000}>5 秒</option>
            <option value={10000}>10 秒</option>
          </select>
        </div>

        <div className="setting-row">
          <span className="setting-label">内存上限</span>
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
          <span className="setting-label">项目名称</span>
          <div className="rename-row">
            <input
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="项目名称"
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
              <Check size={13} /> 保存
            </button>
          </div>
        </div>

        <p className="setting-note">设置保存在浏览器本地；项目名保存到 SQLite。</p>
      </div>
    </div>
  );
}
