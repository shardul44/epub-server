/**
 * Toaster — global toast UI driven by uiSlice.
 *
 * Mounted once at the root. Any component can dispatch `showToast({ type, message })`
 * to display a transient banner. Auto-hides after 3.5s.
 */
import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { hideToast, selectToast } from '../slices/uiSlice';
import './Toaster.css';

const TYPE_CLASS = {
  info:    'toaster--info',
  success: 'toaster--success',
  warning: 'toaster--warning',
  error:   'toaster--error',
};

export default function Toaster({ duration = 3500 }) {
  const dispatch = useAppDispatch();
  const toast    = useAppSelector(selectToast);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!toast.open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => dispatch(hideToast()), duration);
    return () => clearTimeout(timerRef.current);
  }, [toast.id, toast.open, duration, dispatch]);

  if (!toast.open) return null;

  return (
    <div
      className={`toaster ${TYPE_CLASS[toast.type] ?? 'toaster--info'}`}
      role="status"
      aria-live="polite"
    >
      <span className="toaster__msg">{toast.message}</span>
      <button
        type="button"
        className="toaster__close"
        onClick={() => dispatch(hideToast())}
        aria-label="Close notification"
      >
        ×
      </button>
    </div>
  );
}
