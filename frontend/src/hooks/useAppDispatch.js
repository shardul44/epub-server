/**
 * Legacy entry point — re-exports the typed dispatch from store/hooks.
 * Existing imports from `hooks/useAppDispatch` continue to work.
 * New code should prefer:
 *   import { useAppDispatch } from '@/store/hooks';
 */
import { useAppDispatch } from '../store/hooks';

export { useAppDispatch };
export default useAppDispatch;
