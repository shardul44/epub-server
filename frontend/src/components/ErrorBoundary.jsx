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
import { LayoutGrid, RefreshCw } from 'lucide-react';
import './ErrorBoundary.css';

const SUPPORT_MAILTO =
  'mailto:support@kodeit.digital?subject=Application%20Error%20Report';

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
      <div className="eb-page" role="alert">
        <span className="eb-bg-deco eb-bg-deco--dots" aria-hidden="true" />
        <span className="eb-bg-deco eb-bg-deco--x" aria-hidden="true">
          ×
        </span>
        <span className="eb-bg-deco eb-bg-deco--ring" aria-hidden="true" />

        <div className="eb-card">
          <div className="eb-illustration" aria-hidden="true">
            <div className="eb-illustration-glow" />
            <span className="eb-deco eb-deco--plus">+</span>
            <span className="eb-deco eb-deco--dot" />
            <span className="eb-deco eb-deco--grid">
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} />
              ))}
            </span>
            <div className="eb-browser">
              <div className="eb-browser-bar">
                <span className="eb-browser-dot eb-browser-dot--red" />
                <span className="eb-browser-dot eb-browser-dot--yellow" />
                <span className="eb-browser-dot eb-browser-dot--green" />
              </div>
              <div className="eb-browser-face">
                <div className="eb-browser-eyes">
                  <span />
                  <span />
                </div>
                <div className="eb-browser-mouth" />
              </div>
            </div>
            <span className="eb-badge">!</span>
          </div>

          <h1 className="eb-title">
            Something <span className="eb-title-accent">went wrong</span>
          </h1>
          <p className="eb-desc">
            An unexpected error occurred while rendering this page. You can try
            again, go back to the dashboard, or refresh the browser.
          </p>

          <div className="eb-actions">
            <button
              type="button"
              className="eb-btn eb-btn--primary"
              onClick={this.reset}
            >
              <span className="eb-btn-icon">
                <RefreshCw size={14} strokeWidth={2.5} />
              </span>
              Try again
            </button>
            <button
              type="button"
              className="eb-btn eb-btn--dashboard"
              onClick={this.goHome}
            >
              <span className="eb-btn-icon">
                <LayoutGrid size={14} strokeWidth={2.5} />
              </span>
              Go to dashboard
            </button>
            <button
              type="button"
              className="eb-btn eb-btn--ghost"
              onClick={() => window.location.reload()}
            >
              <span className="eb-btn-icon">
                <RefreshCw size={14} strokeWidth={2.5} />
              </span>
              Refresh page
            </button>
          </div>

          <footer className="eb-footer">
            <div className="eb-help">
              <span className="eb-help-icon" aria-hidden="true">
                ?
              </span>
              <p className="eb-help-text">
                <strong>Need help?</strong>
                If the problem persists, please contact support.{' '}
                <a className="eb-help-link" href={SUPPORT_MAILTO}>
                  Contact support →
                </a>
              </p>
            </div>
          </footer>

          {isDev && this.state.error && (
            <details className="eb-dev-details">
              <summary>Error details (development only)</summary>
              <pre>
                {String(this.state.error)}
                {'\n'}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
