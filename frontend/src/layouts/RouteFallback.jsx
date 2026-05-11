/**
 * RouteFallback — Suspense fallback shown while a lazy-loaded route chunk
 * is still downloading. Kept intentionally minimal and unstyled so it
 * doesn't flash distracting content for fast loads.
 */
export default function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: '40vh',
        color: '#64748b',
        fontSize: 14,
        gap: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          border: '2px solid #cbd5e1',
          borderTopColor: '#2563eb',
          borderRadius: '50%',
          animation: 'route-fallback-spin 0.8s linear infinite',
        }}
      />
      <span>Loading…</span>
      <style>{`@keyframes route-fallback-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
