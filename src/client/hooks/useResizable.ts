import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizeOptions {
  min: number;
  max: number;
  storageKey: string;
  invert?: boolean;
}

/**
 * Pointer-driven split resizing. The hook owns only the numeric size; the
 * caller supplies a CSS variable and applies it to the layout.
 */
export function useResizable(initial: number, options: ResizeOptions): {
  size: number;
  dragging: boolean;
  startDrag: (event: React.PointerEvent) => void;
} {
  const [size, setSize] = useState<number>(() => {
    const stored = Number(localStorage.getItem(options.storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : initial;
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ start: number; size: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(options.storageKey, String(Math.round(size)));
  }, [options.storageKey, size]);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      drag.current = { start: options.invert ? event.clientY : event.clientX, size };
      setDragging(true);
      document.body.classList.add('is-resizing');
      const onMove = (moveEvent: PointerEvent): void => {
        if (!drag.current) return;
        const current = options.invert ? moveEvent.clientY : moveEvent.clientX;
        const delta = current - drag.current.start;
        const next = options.invert ? drag.current.size - delta : drag.current.size - delta;
        setSize(Math.min(options.max, Math.max(options.min, next)));
      };
      const onUp = (): void => {
        drag.current = null;
        setDragging(false);
        document.body.classList.remove('is-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [options.invert, options.max, options.min, size],
  );

  return { size, dragging, startDrag };
}
