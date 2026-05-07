/**
 * Typed selector hook — use this everywhere instead of plain useSelector.
 * Centralises the selector pattern and makes future TypeScript migration trivial.
 */
import { useSelector } from 'react-redux';

/**
 * @template T
 * @param {(state: import('../store/store').default) => T} selector
 * @returns {T}
 */
const useAppSelector = (selector) => useSelector(selector);

export default useAppSelector;
