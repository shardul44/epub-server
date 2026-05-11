/**
 * ErrorBoundary — global fallback UI for React render errors.
 *
 * Improvements over the previous version:
 *   - Uses `import.meta.env.DEV` (Vite) instead of `process.env.NODE_ENV`
 *     which is `undefined` in the browser bundle.
 *   - Adds a non-destructive "Try again" button that resets the boundary
 *     state without losing SPA history.
 *   - Adds a "Go home" button that resets and navigates to "/".
 *   - Auto-resets when the route pathname changes (via `resetKey` prop) so
 *     a single render error doesn't permanently brick navigation.
 *
 * This is still a class component because that's the only way to expose
 * `componentDidCatch` / `getDerivedStateFromError` in React 18.
 */
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] caught render error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  componentDidUpdate(prevProps) {
    // Auto-reset when the parent passes a new `resetKey` (e.g. pathname).
    // Without this, a single render bug locks the entire app on a fallback
    // screen until the user manually refreshes.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  goHome = () => {
    this.reset();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/';
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const isDev = !!import.meta.env?.DEV;

    return (
      <div
        role="alert"
        style={{
          padding: 24,
          margin: 24,
          border: '1px solid #fecaca',
          borderRadius: 12,
          background: '#fff5f5',
          maxWidth: 720,
          marginLeft: 'auto',
          marginRight: 'auto',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        }}
      >
        <h2 style={{ color: '#b91c1c', marginTop: 0, marginBottom: 8 }}>
          Something went wrong
        </h2>
        <p style={{ color: '#475569', marginTop: 0 }}>
          An unexpected error occurred while rendering this page. You can try
          again, go back to the dashboard, or refresh the browser.
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={this.reset}
            style={btnStyle('#2563eb')}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={this.goHome}
            style={btnStyle('#0f766e')}
          >
            Go to dashboard
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={btnStyle('#475569')}
          >
            Refresh page
          </button>
        </div>

        {isDev && this.state.error && (
          <details style={{ marginTop: 20, textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', color: '#b91c1c' }}>
              Error details (development only)
            </summary>
            <pre
              style={{
                background: '#f8fafc',
                padding: 12,
                borderRadius: 6,
                overflow: 'auto',
                fontSize: 12,
                marginTop: 8,
                color: '#0f172a',
              }}
            >
              {String(this.state.error)}
              {'\n'}
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
        )}
      </div>
    );
  }
}

function btnStyle(bg) {
  return {
    padding: '8px 16px',
    background: bg,
    color: '#fff',
    border: 0,
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  };
}

export default ErrorBoundary;
