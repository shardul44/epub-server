import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import './QuickActionsFab.css';

const ACTION_ICON_SIZE = 44;
const ROW_GAP = 12;
const ROW_STEP = ACTION_ICON_SIZE + ROW_GAP;

function computePositions(count) {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => ({
    x: 0,
    y: -(i + 1) * ROW_STEP,
  }));
}

/**
 * Floating action button with a vertical stack menu.
 *
 * Action descriptor shape:
 *   { Icon: LucideIcon, label: string, to: string, show?: boolean }
 *
 * Actions with show === false are skipped. The FAB self-hides when nothing
 * is visible.
 */
export default function QuickActionsFab({ actions = [] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const items = useMemo(
    () => actions.filter((a) => a && a.show !== false),
    [actions],
  );

  const positions = useMemo(
    () => computePositions(items.length),
    [items.length],
  );

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open, close]);

  if (items.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="qa-fab-root"
      data-open={open ? 'true' : 'false'}
      role="region"
      aria-label="Quick actions"
    >
      {items.map((a, i) => {
        const { x, y } = positions[i] || { x: 0, y: 0 };
        return (
          <motion.div
            key={a.label}
            className="qa-fab-action"
            initial={false}
            animate={{
              x: open ? x : 0,
              y: open ? y : 0,
              opacity: open ? 1 : 0,
              scale: open ? 1 : 0.45,
            }}
            transition={{
              type: 'spring',
              stiffness: 280,
              damping: 22,
              mass: 0.7,
              delay: open
                ? i * 0.045
                : Math.max(0, (items.length - 1 - i) * 0.02),
            }}
            style={{ pointerEvents: open ? 'auto' : 'none' }}
          >
            <motion.span
              className="qa-fab-action-label"
              initial={false}
              animate={{ opacity: open ? 1 : 0, x: open ? 0 : 10 }}
              transition={{
                delay: open ? i * 0.045 + 0.08 : 0,
                duration: 0.18,
                ease: 'easeOut',
              }}
            >
              {a.label}
            </motion.span>
            <Link
              to={a.to}
              className="qa-fab-action-btn"
              tabIndex={open ? 0 : -1}
              onClick={close}
              aria-label={a.label}
            >
              <a.Icon size={20} strokeWidth={2} aria-hidden />
            </Link>
          </motion.div>
        );
      })}

      <motion.button
        type="button"
        className="qa-fab-main"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close quick actions menu' : 'Open quick actions menu'}
        aria-expanded={open}
        whileTap={{ scale: 0.92 }}
        whileHover={{ scale: 1.06 }}
        transition={{ type: 'spring', stiffness: 360, damping: 18 }}
      >
        <motion.span
          className="qa-fab-main-icon"
          animate={{ rotate: open ? 0 : 45 }}
          transition={{ type: 'spring', stiffness: 240, damping: 20 }}
        >
          <X size={28} strokeWidth={2.4} aria-hidden />
        </motion.span>
      </motion.button>
    </div>
  );
}
