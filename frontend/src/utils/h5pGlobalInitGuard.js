/**
 * Wrap global H5P "initialized" handlers so missing preview iframes do not throw.
 */
export function installH5pGlobalInitGuard() {
  if (typeof window === 'undefined') return undefined;

  const apply = () => {
    const dispatcher = window.H5P?.externalDispatcher;
    if (!dispatcher?.on || dispatcher.__initGuardPatched) {
      return Boolean(dispatcher?.__initGuardPatched);
    }

    const originalOn = dispatcher.on.bind(dispatcher);
    dispatcher.on = function guardedOn(event, handler, context) {
      if (event !== 'initialized' || typeof handler !== 'function') {
        return originalOn(event, handler, context);
      }
      const wrapped = function wrappedInitializedHandler(...args) {
        try {
          return handler.apply(context || this, args);
        } catch (err) {
          const msg = err?.message || '';
          if (msg.includes('contentWindow') || msg.includes('null')) {
            return undefined;
          }
          throw err;
        }
      };
      return originalOn(event, wrapped, context);
    };
    dispatcher.__initGuardPatched = true;
    return true;
  };

  if (apply()) return undefined;

  let attempts = 0;
  const intervalId = window.setInterval(() => {
    if (apply() || ++attempts > 400) window.clearInterval(intervalId);
  }, 50);

  return () => window.clearInterval(intervalId);
}
