/**
 * Typed Redux hooks — single import point for the whole app.
 *
 * Prefer:
 *   import { useAppDispatch, useAppSelector } from '@/store/hooks';
 *
 * The legacy hooks at `src/hooks/useAppDispatch.js` and
 * `src/hooks/useAppSelector.js` continue to re-export these so existing
 * imports keep working.
 */
import { useDispatch, useSelector } from 'react-redux';

/** @returns {import('@reduxjs/toolkit').ThunkDispatch} */
export const useAppDispatch = () => useDispatch();

/**
 * @template T
 * @param {(state: ReturnType<typeof import('./store').default.getState>) => T} selector
 * @returns {T}
 */
export const useAppSelector = (selector) => useSelector(selector);
