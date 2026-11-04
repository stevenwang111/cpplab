import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, FilePlus2, X } from 'lucide-react';

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-layer">
      <button type="button" className="modal-backdrop" aria-label="关闭对话框" onClick={onClose} />
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span className="modal-icon">{icon}</span>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn small" onClick={onClose} title="关闭">
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
      setError('请输入文件路径');
      return;
    }
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(path) || path.includes('..') || path.startsWith('/')) {
      setError('路径只能包含字母、数字、下划线、点、斜杠，且必须是相对路径');
      return;
    }
    if (existing.includes(path)) {
      setError('同名文件已存在');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(path);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="新建文件"
      subtitle="多文件项目会一起写入沙箱工作区"
      icon={<FilePlus2 size={19} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? '创建中…' : '创建文件'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>文件路径</span>
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
          placeholder="例如 util.h 或 include/math.hpp"
          spellCheck={false}
        />
      </label>
      <p className="field-hint">建议使用 .cpp / .cc / .h / .hpp；入口文件在工具栏中切换。</p>
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
  confirmLabel = '确认',
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
  if (!open) return null;
  return (
    <ModalShell
      title={title}
      icon={<AlertTriangle size={19} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
    </ModalShell>
  );
}

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  if (!open) return null;
  return (
    <ModalShell
      title="CppLab 使用说明"
      subtitle="浏览器中的 C++ 编辑、隔离运行与图形化调试"
      icon={<span className="help-mark">C++</span>}
      onClose={onClose}
      wide
    >
      <div className="help-grid">
        <section>
          <h3>快捷键</h3>
          <dl className="shortcut-list">
            <div><dt><kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd></dt><dd>运行</dd></div>
            <div><dt><kbd>F5</kbd></dt><dd>启动调试 / 继续</dd></div>
            <div><dt><kbd>Shift</kbd> + <kbd>F5</kbd></dt><dd>停止调试</dd></div>
            <div><dt><kbd>F9</kbd></dt><dd>当前行切换断点</dd></div>
            <div><dt><kbd>F10</kbd></dt><dd>单步跳过</dd></div>
            <div><dt><kbd>F11</kbd></dt><dd>单步步入</dd></div>
            <div><dt><kbd>Shift</kbd> + <kbd>F11</kbd></dt><dd>单步步出</dd></div>
            <div><dt><kbd>Ctrl/⌘</kbd> + <kbd>S</kbd></dt><dd>保存当前文件</dd></div>
            <div><dt><kbd>Ctrl/⌘</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></dt><dd>clang-format 格式化</dd></div>
          </dl>
        </section>
        <section>
          <h3>安全边界</h3>
          <ul className="help-list">
            <li>编译器与程序都在 nsjail 中执行，编译期同样隔离。</li>
            <li>每次任务独立 tmpfs 工作区，根文件系统只读。</li>
            <li>无网络、非 root uid、丢弃 capabilities、no_new_privs。</li>
            <li>编译参数经过白名单，运行输出与进程数受 cgroup 限制。</li>
            <li>调试配置单独放开 ptrace，仍禁用网络。</li>
          </ul>
          <h3>限制</h3>
          <ul className="help-list">
            <li>源码 ≤ 256 KiB / 16 个文件，stdin ≤ 1 MiB。</li>
            <li>运行墙钟 ≤ 10 s，输出 ≤ 64 KiB，内存 64–512 MiB。</li>
            <li>并发：编译 2、运行 4、调试会话 2。</li>
            <li>调试空闲 5 分钟回收，硬上限 30 分钟。</li>
          </ul>
        </section>
      </div>
    </ModalShell>
  );
}
