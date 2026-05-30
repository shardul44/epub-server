import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  X,
  Search,
  Rocket,
  Building2,
  CreditCard,
  FileText,
  Users,
  Plug,
  Type,
  Link2,
  Armchair,
  FileStack,
  CalendarRange,
  ToggleRight,
  Play,
  MessageCircle,
  Mail,
  Bug,
  Lightbulb,
  Server,
  RefreshCw,
  HardDrive,
  Keyboard,
  ExternalLink,
  BookOpen,
  Sparkles,
} from 'lucide-react';
import './HelpCenterPanel.css';

const APP_VERSION = '1.0.0';

const SUGGESTED_TOPICS = [
  'Create organization',
  'Seat limits',
  'Plan upgrades',
  'PDF conversion',
  'Invite users',
  'API keys',
];

function matchesSearch(q, ...parts) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = parts.flat().join(' ').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

const QUICK_HELP = [
  {
    id: 'getting-started',
    icon: Rocket,
    title: 'Getting Started',
    description: 'Platform overview, roles, and your first setup steps.',
    keywords: 'dashboard onboarding setup first steps',
    href: '/',
  },
  {
    id: 'orgs',
    icon: Building2,
    title: 'Organization Management',
    description: 'Create orgs, assign plans, and manage quotas.',
    keywords: 'organization tenant client create organization slug seat',
    href: '/admin/organizations',
  },
  {
    id: 'billing',
    icon: CreditCard,
    title: 'Plans & Billing',
    description: 'Subscriptions, plan requests, and quota add-ons.',
    keywords: 'plan upgrade billing subscription quota addon',
    href: '/admin/plans',
  },
  {
    id: 'conversion',
    icon: FileText,
    title: 'PDF Conversion Guide',
    description: 'Upload workflows, FXL jobs, and export quality.',
    keywords: 'pdf conversion upload epub fxl export',
    href: '/admin/conversions',
  },
  {
    id: 'users',
    icon: Users,
    title: 'User Management',
    description: 'Invite admins, roles, and access control.',
    keywords: 'user invite admin member role access',
    href: '/admin/users',
  },
  {
    id: 'api',
    icon: Plug,
    title: 'API & Integrations',
    description: 'Webhooks, automation, and platform endpoints.',
    keywords: 'api integration webhook key endpoint',
    href: '/admin/settings',
  },
];

const FIELD_HELP = [
  {
    icon: Type,
    title: 'Organization Name',
    description: 'Display name shown across the dashboard, billing, and activity logs.',
    keywords: 'name display label',
  },
  {
    icon: Link2,
    title: 'Slug',
    description: 'URL-safe identifier for the org. Auto-generated from the name if left blank.',
    keywords: 'slug url identifier',
  },
  {
    icon: Armchair,
    title: 'Seat Limit',
    description: 'Maximum team members allowed under the org’s current plan.',
    keywords: 'seat limit members quota team',
  },
  {
    icon: FileStack,
    title: 'PDF Page Quota',
    description: 'Total PDF pages the organization can convert during the billing period.',
    keywords: 'pdf pages quota limit conversion',
  },
  {
    icon: CalendarRange,
    title: 'Valid From / Until',
    description: 'Subscription window. Access and quotas apply only within this date range.',
    keywords: 'valid from until date subscription period',
  },
  {
    icon: ToggleRight,
    title: 'Active Status',
    description: 'Inactive orgs cannot sign in or run conversions until re-enabled.',
    keywords: 'active inactive status enabled disabled',
  },
];

const TUTORIALS = [
  {
    id: 'create-org',
    title: 'Create Organization',
    duration: '4:12',
    keywords: 'create organization tenant new org',
    gradient: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
  },
  {
    id: 'manage-users',
    title: 'Manage Users',
    duration: '3:28',
    keywords: 'users invite admin members',
    gradient: 'linear-gradient(135deg, #0d9488 0%, #2563eb 100%)',
  },
  {
    id: 'upgrade-plans',
    title: 'Upgrade Plans',
    duration: '5:01',
    keywords: 'upgrade plan billing subscription',
    gradient: 'linear-gradient(135deg, #d97706 0%, #dc2626 100%)',
  },
];

const SUPPORT_OPTIONS = [
  {
    id: 'chat',
    icon: MessageCircle,
    label: 'Live Chat',
    hint: 'Typical reply under 5 min',
    keywords: 'chat support live help',
  },
  {
    id: 'email',
    icon: Mail,
    label: 'Email Support',
    hint: 'support@byline.example',
    keywords: 'email contact support',
  },
  {
    id: 'bug',
    icon: Bug,
    label: 'Report Bug',
    hint: 'Include steps to reproduce',
    keywords: 'bug issue error report',
  },
  {
    id: 'feature',
    icon: Lightbulb,
    label: 'Feature Request',
    hint: 'Share your use case',
    keywords: 'feature request idea suggestion',
  },
];

const SYSTEM_STATUS = [
  { id: 'api', label: 'API Status', value: 'Online', tone: 'ok', icon: Server },
  { id: 'conversion', label: 'Conversion Server', value: 'Healthy', tone: 'ok', icon: RefreshCw },
  { id: 'storage', label: 'Storage', value: '78% Used', tone: 'warn', icon: HardDrive },
];

const SHORTCUTS = [
  { keys: '/', label: 'Search' },
  { keys: 'Ctrl + N', label: 'New Organization' },
  { keys: 'Esc', label: 'Close Panel' },
];

function Skeleton({ className = '' }) {
  return <span className={`hcp-skeleton ${className}`.trim()} aria-hidden />;
}

function fmtLastSync() {
  const d = new Date();
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function HelpCenterPanel({ open, onClose }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [lastSync, setLastSync] = useState('');
  const searchRef = useRef(null);
  const drawerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    setLastSync(fmtLastSync());
    const t = window.setTimeout(() => setLoading(false), 480);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onClose();
        navigate('/admin/organizations');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, navigate]);

  useEffect(() => {
    if (open && !loading) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, loading]);

  const q = search.trim().toLowerCase();
  const isSearching = q.length > 0;

  const filteredQuickHelp = useMemo(
    () =>
      QUICK_HELP.filter((c) =>
        matchesSearch(q, c.title, c.description, c.id, c.keywords),
      ),
    [q],
  );

  const filteredFields = useMemo(
    () =>
      FIELD_HELP.filter((f) =>
        matchesSearch(q, f.title, f.description, f.keywords),
      ),
    [q],
  );

  const filteredTutorials = useMemo(
    () =>
      TUTORIALS.filter((t) =>
        matchesSearch(q, t.title, t.duration, t.keywords),
      ),
    [q],
  );

  const filteredSupport = useMemo(
    () =>
      SUPPORT_OPTIONS.filter((s) =>
        matchesSearch(q, s.label, s.hint, s.keywords),
      ),
    [q],
  );

  const filteredTopics = useMemo(
    () =>
      isSearching
        ? SUGGESTED_TOPICS.filter((topic) => matchesSearch(q, topic))
        : SUGGESTED_TOPICS,
    [q, isSearching],
  );

  const resultCount =
    filteredQuickHelp.length +
    filteredFields.length +
    filteredTutorials.length +
    filteredSupport.length;

  const showStatusSection = !isSearching;
  const showShortcutsSection = !isSearching;

  const handleTopicClick = useCallback((topic) => {
    setSearch(topic);
    searchRef.current?.focus();
  }, []);

  if (!open) return null;

  return (
    <div className="hcp-root" role="presentation">
      <button
        type="button"
        className="hcp-backdrop"
        aria-label="Close help center"
        onClick={onClose}
      />

      <aside
        ref={drawerRef}
        className="hcp-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hcp-title"
      >
        <header className="hcp-header">
          <div className="hcp-header-text">
            <h2 id="hcp-title" className="hcp-title">
              Help Center
            </h2>
            <p className="hcp-subtitle">Find guides, tutorials, and support</p>
          </div>
          <button
            type="button"
            className="hcp-close-btn"
            onClick={onClose}
            aria-label="Close help center"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </header>

        <div className="hcp-search-sticky">
          <label className="hcp-search" htmlFor="hcp-help-search">
            <Search className="hcp-search-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              ref={searchRef}
              id="hcp-help-search"
              type="search"
              className="hcp-search-input"
              placeholder="Search help articles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {(filteredTopics.length > 0 || !isSearching) && (
            <div className="hcp-suggested">
              <span className="hcp-suggested-label">
                {isSearching ? 'Matching topics' : 'Suggested'}
              </span>
              <div className="hcp-suggested-chips">
                {filteredTopics.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className="hcp-chip"
                    onClick={() => handleTopicClick(topic)}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="hcp-scroll">
          {loading ? (
            <div className="hcp-loading" aria-busy="true" aria-label="Loading help content">
              <div className="hcp-loading-grid">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="hcp-skeleton-card">
                    <Skeleton className="hcp-skeleton-icon" />
                    <Skeleton className="hcp-skeleton-line hcp-skeleton-line--lg" />
                    <Skeleton className="hcp-skeleton-line" />
                  </div>
                ))}
              </div>
              <Skeleton className="hcp-skeleton-block" />
              <div className="hcp-skeleton-row">
                <Skeleton className="hcp-skeleton-video" />
                <Skeleton className="hcp-skeleton-video" />
                <Skeleton className="hcp-skeleton-video" />
              </div>
            </div>
          ) : (
            <>
              {isSearching && (
                <div
                  className={`hcp-search-feedback${resultCount === 0 ? ' hcp-search-feedback--empty' : ''}`}
                  role="status"
                  aria-live="polite"
                >
                  {resultCount === 0 ? (
                    <>
                      No results for &ldquo;<strong>{search.trim()}</strong>&rdquo;. Try
                      another keyword or pick a suggested topic.
                    </>
                  ) : (
                    <>
                      <strong>{resultCount}</strong>{' '}
                      {resultCount === 1 ? 'result' : 'results'} for &ldquo;
                      {search.trim()}&rdquo;
                    </>
                  )}
                </div>
              )}

              {filteredQuickHelp.length > 0 && (
              <section className="hcp-section" aria-labelledby="hcp-quick-title">
                <h3 id="hcp-quick-title" className="hcp-section-title">
                  Quick help
                </h3>
                  <div className="hcp-quick-grid">
                    {filteredQuickHelp.map((card) => {
                      const Icon = card.icon;
                      return (
                        <Link
                          key={card.id}
                          to={card.href}
                          className="hcp-quick-card"
                          onClick={onClose}
                        >
                          <span className="hcp-quick-card-icon" aria-hidden>
                            <Icon size={20} strokeWidth={2} />
                          </span>
                          <span className="hcp-quick-card-body">
                            <span className="hcp-quick-card-title">{card.title}</span>
                            <span className="hcp-quick-card-desc">{card.description}</span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
              </section>
              )}

              {filteredFields.length > 0 && (
              <section className="hcp-section" aria-labelledby="hcp-fields-title">
                <h3 id="hcp-fields-title" className="hcp-section-title">
                  <Sparkles size={16} aria-hidden />
                  Smart field explanations
                </h3>
                {!isSearching && (
                  <p className="hcp-section-desc">
                    Context for organization form fields on the Organizations page.
                  </p>
                )}
                <ul className="hcp-field-list">
                  {filteredFields.map((field) => {
                    const Icon = field.icon;
                    return (
                      <li key={field.title} className="hcp-field-item">
                        <span className="hcp-field-icon" aria-hidden>
                          <Icon size={16} strokeWidth={2} />
                        </span>
                        <div className="hcp-field-body">
                          <span className="hcp-field-title">{field.title}</span>
                          <span className="hcp-field-desc">{field.description}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
              )}

              {filteredTutorials.length > 0 && (
              <section className="hcp-section" aria-labelledby="hcp-video-title">
                <h3 id="hcp-video-title" className="hcp-section-title">
                  Video tutorials
                </h3>
                <div className="hcp-video-grid">
                  {filteredTutorials.map((vid) => (
                    <button
                      key={vid.id}
                      type="button"
                      className="hcp-video-card"
                      title={`Play: ${vid.title}`}
                    >
                      <span
                        className="hcp-video-thumb"
                        style={{ background: vid.gradient }}
                        aria-hidden
                      >
                        <span className="hcp-video-play">
                          <Play size={22} fill="currentColor" strokeWidth={0} />
                        </span>
                        <span className="hcp-video-duration">{vid.duration}</span>
                      </span>
                      <span className="hcp-video-title">{vid.title}</span>
                    </button>
                  ))}
                </div>
              </section>
              )}

              {filteredSupport.length > 0 && (
              <section className="hcp-section" aria-labelledby="hcp-support-title">
                <h3 id="hcp-support-title" className="hcp-section-title">
                  Contact support
                </h3>
                <div className="hcp-support-grid">
                  {filteredSupport.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button key={opt.id} type="button" className="hcp-support-btn">
                        <Icon size={18} strokeWidth={2} aria-hidden />
                        <span className="hcp-support-label">{opt.label}</span>
                        <span className="hcp-support-hint">{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
              )}

              {showStatusSection && (
              <section className="hcp-section" aria-labelledby="hcp-status-title">
                <h3 id="hcp-status-title" className="hcp-section-title">
                  System status
                </h3>
                <div className="hcp-status-widget">
                  {SYSTEM_STATUS.map((row) => {
                    const Icon = row.icon;
                    return (
                      <div key={row.id} className="hcp-status-row">
                        <span className="hcp-status-left">
                          <Icon size={16} strokeWidth={2} aria-hidden />
                          <span>{row.label}</span>
                        </span>
                        <span className={`hcp-status-pill hcp-status-pill--${row.tone}`}>
                          <span className="hcp-status-dot" aria-hidden />
                          {row.value}
                        </span>
                      </div>
                    );
                  })}
                  <div className="hcp-status-sync">
                    Last sync: <time dateTime={new Date().toISOString()}>{lastSync}</time>
                  </div>
                </div>
              </section>
              )}

              {showShortcutsSection && (
              <section className="hcp-section" aria-labelledby="hcp-kbd-title">
                <h3 id="hcp-kbd-title" className="hcp-section-title">
                  <Keyboard size={16} aria-hidden />
                  Keyboard shortcuts
                </h3>
                <ul className="hcp-shortcuts">
                  {SHORTCUTS.map((s) => (
                    <li key={s.label} className="hcp-shortcut-row">
                      <kbd className="hcp-kbd">{s.keys}</kbd>
                      <span>{s.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
              )}
            </>
          )}
        </div>

        <footer className="hcp-footer">
          <p className="hcp-footer-help">Need more help?</p>
          <a
            href="https://docs.example.com/platform-admin"
            className="hcp-footer-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BookOpen size={15} aria-hidden />
            Documentation
            <ExternalLink size={13} aria-hidden />
          </a>
          <span className="hcp-footer-version">v{APP_VERSION}</span>
        </footer>
      </aside>
    </div>
  );
}
