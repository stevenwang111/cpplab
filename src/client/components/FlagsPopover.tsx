import { useEffect, useState } from 'react';
import { Plus, ShieldCheck, X } from 'lucide-react';

interface FlagsPopoverProps {
  flags: string[];
  onChange: (flags: string[]) => void;
  onClose: () => void;
}

const COMMON_FLAGS = [
  { flag: '-Wall', label: '显示常规警告' },
  { flag: '-Wextra', label: '显示额外警告' },
  { flag: '-Werror', label: '警告视为错误' },
  { flag: '-pthread', label: '启用 POSIX 线程' },
  { flag: '-lm', label: '链接数学库' },
  { flag: '-fsanitize=address', label: 'AddressSanitizer' },
  { flag: '-fsanitize=undefined', label: 'UBSan' },
  { flag: '-fsanitize=address,undefined', label: 'ASan + UBSan' },
];

export function FlagsPopover(props: FlagsPopoverProps): JSX.Element {
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
      setError('仅支持 -D<宏> 或 -I<工作区内相对目录>');
      return;
    }
    if (props.flags.includes(value)) {
      setError('该参数已存在');
      return;
    }
    props.onChange([...props.flags, value]);
    setCustom('');
    setError('');
  };

  return (
    <div className="popover-layer">
      <button type="button" className="popover-backdrop" aria-label="关闭编译参数" onClick={props.onClose} />
      <div className="flags-popover" role="dialog" aria-label="编译参数">
        <div className="popover-head">
          <span>编译参数</span>
          <button type="button" className="icon-btn tiny" onClick={props.onClose} title="关闭">
            <X size={14} />
          </button>
        </div>
        <p className="popover-note">
          <ShieldCheck size={13} /> 服务端会对所有参数再次白名单校验；不允许传递 -o、@file、-fplugin 等选项。
        </p>
        <div className="flag-list">
          {COMMON_FLAGS.map((item) => {
            const active = props.flags.includes(item.flag);
            return (
              <label className={`flag-item ${active ? 'active' : ''}`} key={item.flag}>
                <input type="checkbox" checked={active} onChange={() => toggle(item.flag)} />
                <span className="flag-name">{item.flag}</span>
                <span className="flag-desc">{item.label}</span>
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
                    title="移除"
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
            placeholder="-DDEBUG 或 -Iinclude"
            spellCheck={false}
          />
          <button type="button" className="icon-btn small" onClick={addCustom} disabled={!custom.trim()} title="添加参数">
            <Plus size={14} />
          </button>
        </div>
        {error && <p className="flag-error">{error}</p>}
      </div>
    </div>
  );
}
