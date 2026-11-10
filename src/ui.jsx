import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Marks — the product's own drawing language.
 * X is two strokes, O is one circle, drawn with round caps like a
 * marker on a scoresheet. Nothing else in the UI uses this geometry.
 * ------------------------------------------------------------------ */

export const Mark = ({ symbol, className = '', strokeWidth = 10 }) => {
  if (!symbol) return null;
  const common = {
    viewBox: '0 0 100 100',
    className: `mark mark-${String(symbol).toLowerCase()} ${className}`.trim(),
    'aria-hidden': 'true',
    focusable: 'false',
  };
  if (symbol === 'X' || symbol === 'x') {
    return (
      <svg {...common}>
        <line x1="24" y1="24" x2="76" y2="76" strokeWidth={strokeWidth} strokeLinecap="round" />
        <line x1="76" y1="24" x2="24" y2="76" strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="50" cy="50" r="27" fill="none" strokeWidth={strokeWidth} />
    </svg>
  );
};

export const Brand = ({ compact = false }) => (
  <span className={`brand${compact ? ' brand-compact' : ''}`}>
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <line x1="11" y1="3" x2="11" y2="29" />
      <line x1="21" y1="3" x2="21" y2="29" />
      <line x1="3" y1="11" x2="29" y2="11" />
      <line x1="3" y1="21" x2="29" y2="21" />
      <circle cx="16" cy="16" r="4.4" className="brand-mark-o" />
    </svg>
    {!compact && <span className="brand-name">Noughtline</span>}
  </span>
);

export const Avatar = ({ src, name = 'Player', size = 40, className = '' }) => (
  <img
    className={`avatar ${className}`.trim()}
    src={src || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name || 'player')}`}
    alt=""
    width={size}
    height={size}
    style={{ width: size, height: size }}
    loading="lazy"
  />
);

/* ------------------------------------------------------------------ *
 * Dialog — one accessible shell for every modal: Escape, backdrop,
 * focus trap, focus restore, scroll lock, labelled title.
 * ------------------------------------------------------------------ */

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export const Dialog = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  busy = false,
  tone = 'default',
  className = '',
}) => {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector('[data-autofocus]') || panel.querySelector(FOCUSABLE) || panel;
      if (typeof first.focus === 'function') first.focus({ preventScroll: true });
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!event.shiftKey && document.activeElement === last && !panel.contains(document.activeElement)) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restore = restoreRef.current;
      if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
        restore.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busyRef.current) onCloseRef.current?.(); }}
    >
      <div
        ref={panelRef}
        className={`dialog dialog-${size} dialog-${tone} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <div className="dialog-head">
          <div>
            {title && <h2 className="dialog-title" id={titleId}>{title}</h2>}
            {description && <p className="dialog-desc" id={descId}>{description}</p>}
          </div>
          {!busy && (
            <button type="button" className="icon-btn dialog-close" onClick={onClose} aria-label="Close dialog">
              <X size={18} />
            </button>
          )}
        </div>
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

/* ------------------------------------------------------------------ *
 * Small shared pieces
 * ------------------------------------------------------------------ */

export const Segmented = ({ options, value, onChange, label, className = '' }) => (
  <div className={`segmented ${className}`.trim()} role="group" aria-label={label}>
    {options.map((option) => {
      const active = option.value === value;
      const Icon = option.icon;
      return (
        <button
          key={option.value}
          type="button"
          className={`segmented-item${active ? ' is-active' : ''}`}
          aria-pressed={active}
          onClick={() => onChange(option.value)}
        >
          {Icon && <Icon size={15} aria-hidden="true" />}
          <span>{option.label}</span>
          {option.count != null && <span className="segmented-count">{option.count}</span>}
        </button>
      );
    })}
  </div>
);

export const Progress = ({ value, max = 100, label, tone = 'accent', showLabel = false }) => {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className="progress-wrap">
      {showLabel && (
        <div className="progress-meta">
          <span>{label}</span>
          <span className="num">{Math.round(value)} / {Math.round(max)}</span>
        </div>
      )}
      <div
        className={`progress progress-${tone}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
        aria-label={label || 'Progress'}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export const Chip = ({ children, tone = 'neutral', className = '' }) => (
  <span className={`chip chip-${tone} ${className}`.trim()}>{children}</span>
);

export const Stat = ({ label, value, unit, hint }) => (
  <div className="stat">
    <span className="stat-label">{label}</span>
    <span className="stat-value num">
      {value}
      {unit && <span className="stat-unit">{unit}</span>}
    </span>
    {hint && <span className="stat-hint">{hint}</span>}
  </div>
);

export const Empty = ({ title, children, action }) => (
  <div className="empty">
    <p className="empty-title">{title}</p>
    {children && <p className="empty-copy">{children}</p>}
    {action}
  </div>
);

export const ErrorNote = ({ children, onRetry }) => (
  <div className="error-note" role="alert">
    <p>{children}</p>
    {onRetry && <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Try again</button>}
  </div>
);

export const Loading = ({ label = 'Loading…' }) => (
  <p className="loading-note" role="status">{label}</p>
);
