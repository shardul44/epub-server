/**
 * Legacy entry point — re-exports the typed selector from store/hooks.
 * Existing imports from `hooks/useAppSelector` continue to work.
 * New code should prefer:
 *   import { useAppSelector } from '@/store/hooks';
 */
import { useAppSelector } from '../store/hooks';

export { useAppSelector };
export default useAppSelector;
