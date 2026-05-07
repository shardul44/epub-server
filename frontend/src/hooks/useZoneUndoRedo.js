/**
 * useZoneUndoRedo
 * ───────────────
 * Manages a capped undo/redo history for the zones array.
 *
 * Usage:
 *   const { zones, setZones, resetZones, updateZone, undo, redo, canUndo, canRedo } =
 *     useZoneUndoRedo(initialZones);
 *
 * - updateZone(id, patch)  — apply a partial update and push to history
 * - setZones(newZones)     — replace the whole array and push to history
 * - resetZones(newZones)   — replace WITHOUT pushing to history (use for page navigation)
 * - undo() / redo()        — step through history
 * - canUndo / canRedo      — boolean flags for UI
 */

import { useState, useCallback, useRef } from 'react';

const MAX_HISTORY = 10;

export function useZoneUndoRedo(initialZones = []) {
  // history[cursor] is the "current" state
  const [history, setHistory] = useState([initialZones]);
  const [cursor, setCursor]   = useState(0);

  // Keep a ref so callbacks always see the latest values without stale closures
  const stateRef = useRef({ history: [initialZones], cursor: 0 });
  stateRef.current = { history, cursor };

  /** Push a new snapshot, discarding any redo tail */
  const push = useCallback((newZones) => {
    setHistory(prev => {
      const { cursor: cur } = stateRef.current;
      // Discard redo tail
      const base = prev.slice(0, cur + 1);
      const next = [...base, newZones];
      // Cap at MAX_HISTORY
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
    setCursor(prev => {
      const { history: h } = stateRef.current;
      const base = h.slice(0, prev + 1);
      const newLen = Math.min(base.length + 1, MAX_HISTORY);
      return newLen - 1;
    });
  }, []);

  /**
   * Replace the entire zones array and record in history.
   * Use for explicit user actions (e.g. bulk edits).
   */
  const setZones = useCallback((newZones) => {
    push(newZones);
  }, [push]);

  /**
   * Replace the zones array WITHOUT adding a history entry.
   * Use for page navigation — loading a different page's zones should not
   * pollute the undo stack with cross-page state.
   */
  const resetZones = useCallback((newZones) => {
    setHistory([newZones]);
    setCursor(0);
  }, []);

  /** Apply a partial patch to a single zone by id */
  const updateZone = useCallback((id, patch) => {
    const { history: h, cursor: cur } = stateRef.current;
    const current = h[cur] ?? [];
    const updated = current.map(z => z.id === id ? { ...z, ...patch } : z);
    push(updated);
  }, [push]);

  const undo = useCallback(() => {
    setCursor(c => Math.max(c - 1, 0));
  }, []);

  const redo = useCallback(() => {
    setCursor(c => Math.min(c + 1, stateRef.current.history.length - 1));
  }, []);

  const zones   = history[cursor] ?? [];
  const canUndo = cursor > 0;
  const canRedo = cursor < history.length - 1;

  return { zones, setZones, resetZones, updateZone, undo, redo, canUndo, canRedo };
}
