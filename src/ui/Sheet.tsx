/*
 * ForgeCoach — ui/Sheet.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One modal surface: a bottom sheet on phones, a centred dialog on desktop.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './Icons.tsx';
import { cx } from './util.ts';

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 560,
  className,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
  className?: string;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={cx('sheet', className)}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={ref}
        style={{ ['--sheet-w' as string]: `${width}px` }}
      >
        <div className="sheet-grip" aria-hidden="true" />
        {(title || subtitle) && (
          <header className="sheet-head">
            <div className="sheet-titles">
              {title && <h2 className="sheet-title">{title}</h2>}
              {subtitle && <div className="sheet-sub">{subtitle}</div>}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <IconX size={18} />
            </button>
          </header>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
