import { useState, useMemo, useEffect } from 'react';
import {
  Zap,
  Check,
  X,
  AlertTriangle,
  Minus,
  ClipboardList,
  Bot,
  Accessibility as AccessibilityIcon,
  Download,
} from 'lucide-react';
import AccessibilityWizard from '../components/AccessibilityWizard';
import { useListScope } from '../context/ListScopeContext';
import { useAuth } from '../context/AuthContext';
import './Accessibility.css';

/* ── Auto-fixable rule keys (mirrors wizard's AUTO_FIXED_RULES) ── */
const AUTO_FIXABLE_RULES = new Set([
  'epub-lang','html-has-lang','metadata-accessmode','metadata-accessmodesufficient',
  'metadata-accessibilityfeature','metadata-accessibilityhazard','metadata-accessibilitysummary',
  'scrollable-region-focusable','landmark-no-duplicate-contentinfo','landmark-unique',
  'epub-toc-order','epub-type-has-matching-role','epub-type-has-matching-dpub-role',
  'aria-roles','epub-pagelist-broken',
]);

/* ── Human-readable violation titles ────────────────────────────── */
const RULE_LABELS = {
  'image-alt':                        'Missing alt text on images',
  'html-has-lang':                    'Document language not set',
  'epub-lang':                        'EPUB language not set',
  'color-contrast':                   'Color contrast too low',
  'heading-order':                    'Empty or skipped heading elements',
  'document-title':                   'Document title missing',
  'scrollable-region-focusable':      'Scrollable region not keyboard-focusable',
  'landmark-unique':                  'Duplicate landmark regions',
  'landmark-no-duplicate-contentinfo':'Duplicate footer landmarks',
  'aria-roles':                       'Invalid ARIA role',
  'epub-toc-order':                   'Table of contents role missing',
  'epub-type-has-matching-role':      'epub:type missing DPUB-ARIA role',
  'epub-type-has-matching-dpub-role': 'epub:type missing DPUB-ARIA role',
  'epub-pagelist-broken':             'Broken page-list links',
  'metadata-accessmode':              'Missing accessMode metadata',
  'metadata-accessmodesufficient':    'Missing accessModeSufficient metadata',
  'metadata-accessibilityfeature':    'Missing accessibilityFeature metadata',
  'metadata-accessibilityhazard':     'Missing accessibilityHazard metadata',
  'metadata-accessibilitysummary':    'Missing accessibilitySummary metadata',
};

/* ── Human-readable descriptions ────────────────────────────────── */
const RULE_DESCRIPTIONS = {
  'image-alt':         'Images found without alternative text. Screen readers will skip them entirely.',
  'html-has-lang':     'The <html> element is missing a lang attribute. Assistive tech cannot determine reading language.',
  'epub-lang':         'The OPF <package> element is missing xml:lang and lang attributes.',
  'color-contrast':    'Text elements have contrast ratio below 4.5:1. Current values fail WCAG AA.',
  'heading-order':     '<h2> or deeper elements found with no text content — causes confusing tab stops for keyboard users.',
  'document-title':    'The <title> element is empty or missing from the document.',
  'scrollable-region-focusable': 'Scrollable containers are not reachable via keyboard Tab navigation.',
  'landmark-unique':   'Multiple landmarks of the same type exist without unique labels.',
  'aria-roles':        'Elements use invalid or mismatched ARIA role values.',
  'epub-toc-order':    'The nav element with epub:type="toc" is missing role="doc-toc".',
  'epub-type-has-matching-role':      'epub:type values are missing their required DPUB-ARIA role counterparts.',
  'epub-type-has-matching-dpub-role': 'epub:type values are missing their required DPUB-ARIA role counterparts.',
};

/* ── Severity badge config ───────────────────────────────────────── */
const SEV_CONFIG = {
  critical: { label: 'Critical',  cls: 'ac-vbadge-critical' },
  serious:  { label: 'Serious',   cls: 'ac-vbadge-serious'  },
  moderate: { label: 'Moderate',  cls: 'ac-vbadge-moderate' },
  minor:    { label: 'Minor',     cls: 'ac-vbadge-minor'    },
};

/* ── Group violations by rule title ─────────────────────────────── */
function groupViolations(violations) {
  const map = new Map();
  for (const v of violations) {
    const key = v?.title || 'unknown';
    if (!map.has(key)) {
      map.set(key, {
        title: key,
        severity: v?.severity || 'minor',
        // Use the first non-empty description/helpDescription from real data,
        // fall back to static map only if nothing comes from the backend.
        description: v?.description || v?.helpDescription || RULE_DESCRIPTIONS[key] || '',
        snippet: v?.offendingSnippet || '',
        count: 0,
        items: [],
      });
    }
    const g = map.get(key);
    g.count += 1;
    g.items.push(v);

    // Fill in description from later items if first was empty
    if (!g.description) {
      g.description = v?.description || v?.helpDescription || RULE_DESCRIPTIONS[key] || '';
    }
    // Use first non-empty snippet
    if (!g.snippet && v?.offendingSnippet) {
      g.snippet = v.offendingSnippet;
    }
    // Escalate severity to highest seen
    const order = ['critical', 'serious', 'moderate', 'minor'];
    if (order.indexOf(v?.severity) < order.indexOf(g.severity)) {
      g.severity = v.severity;
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const order = ['critical', 'serious', 'moderate', 'minor'];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });
}

/* ── Single violation card ───────────────────────────────────────── */
const ViolationCard = ({ group }) => {
  const sev     = SEV_CONFIG[group.severity] || SEV_CONFIG.minor;
  const label   = RULE_LABELS[group.title] || group.title;
  const desc    = group.description || RULE_DESCRIPTIONS[group.title] || '';
  const snippet = group.snippet;
  // Show unique file paths affected (up to 2)
  const files = [...new Set(group.items.map(v => v?.filePath).filter(Boolean).map(p => p.split('/').pop()))];

  return (
    <div className="ac-vcard">
      <div className="ac-vcard-header">
        <span className="ac-vcard-title">
          {label}
          {group.count > 1 && <span className="ac-vcard-count"> ×{group.count}</span>}
        </span>
        <span className={`ac-vbadge ${sev.cls}`}>{sev.label}</span>
      </div>

      {desc && <p className="ac-vcard-desc">{desc}</p>}

      {files.length > 0 && (
        <div className="ac-vcard-files">
          {files.slice(0, 2).map(f => (
            <span key={f} className="ac-vcard-file-chip">{f}</span>
          ))}
          {files.length > 2 && (
            <span className="ac-vcard-file-chip ac-vcard-file-more">+{files.length - 2} more</span>
          )}
        </div>
      )}

      {snippet && (
        <div className="ac-vcard-snippet">
          <code>{snippet.length > 100 ? snippet.slice(0, 100) + '…' : snippet}</code>
        </div>
      )}

      <button className="ac-vcard-fix-btn" type="button">
        <Zap className="ac-vcard-fix-icon" size={15} strokeWidth={2.25} aria-hidden />
        Apply AI fix
      </button>
    </div>
  );
};

/* ── Violations panel ────────────────────────────────────────────── */
const ViolationsPanel = ({ allViolations, autoFixableRules }) => {
  const [filter, setFilter] = useState('all');

  const grouped = useMemo(() => groupViolations(allViolations), [allViolations]);

  const filtered = useMemo(() => {
    if (filter === 'critical')    return grouped.filter(g => g.severity === 'critical');
    if (filter === 'autofixable') return grouped.filter(g => autoFixableRules.has(g.title));
    return grouped;
  }, [grouped, filter, autoFixableRules]);

  const criticalCount   = grouped.filter(g => g.severity === 'critical').length;
  const autoFixCount    = grouped.filter(g => autoFixableRules.has(g.title)).length;

  return (
    <div className="ac-violations-panel">
      {/* Header */}
      <div className="ac-vp-header">
        <span className="ac-vp-title">Violations ({allViolations.length})</span>
        <div className="ac-vp-tabs">
          <button
            className={`ac-vp-tab ${filter === 'all' ? 'ac-vp-tab--active' : ''}`}
            onClick={() => setFilter('all')}
          >All</button>
          <button
            className={`ac-vp-tab ${filter === 'critical' ? 'ac-vp-tab--active' : ''}`}
            onClick={() => setFilter('critical')}
          >
            Critical{criticalCount > 0 && <span className="ac-vp-tab-count">{criticalCount}</span>}
          </button>
          <button
            className={`ac-vp-tab ${filter === 'autofixable' ? 'ac-vp-tab--active' : ''}`}
            onClick={() => setFilter('autofixable')}
          >
            Auto-fixable{autoFixCount > 0 && <span className="ac-vp-tab-count">{autoFixCount}</span>}
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="ac-vp-list">
        {filtered.length === 0 ? (
          <div className="ac-vp-empty">No violations in this category.</div>
        ) : (
          filtered.map(group => (
            <ViolationCard
              key={group.title}
              group={group}
            />
          ))
        )}
      </div>
    </div>
  );
};

/* ── Metadata checklist items ────────────────────────────────────── */
const METADATA_CHECKS = [
  {
    key: 'dc:title',
    label: 'dc:title present',
    check: (meta) => !!(meta?.['dc:title'] || meta?.title || meta?.['dct:title']),
  },
  {
    key: 'dc:creator',
    label: 'dc:creator present',
    check: (meta) => !!(meta?.['dc:creator'] || meta?.creator || meta?.author),
  },
  {
    key: 'accessMode',
    label: 'accessMode declared',
    check: (meta, violations) =>
      !violations.some(v => v?.title === 'metadata-accessmode'),
  },
  {
    key: 'accessibilitySummary',
    label: 'accessibilitySummary present',
    check: (meta, violations) =>
      !violations.some(v => v?.title === 'metadata-accessibilitysummary'),
  },
  {
    key: 'certifiedBy',
    label: 'certifiedBy field present',
    check: (meta) => !!(meta?.certifiedBy || meta?.['schema:certifiedBy']),
  },
  {
    key: 'accessibilityFeature',
    label: 'schema:accessibilityFeature present',
    check: (meta, violations) =>
      !violations.some(v => v?.title === 'metadata-accessibilityfeature'),
  },
];

/* ── EPUB Metadata Checklist panel ──────────────────────────────── */
const MetadataChecklist = ({ metadata, allViolations }) => (
  <div className="ac-meta-panel">
    <div className="ac-meta-title">EPUB metadata checklist</div>
    <ul className="ac-meta-list">
      {METADATA_CHECKS.map((item, idx) => {
        const pass = item.check(metadata, allViolations);
        return (
          <li key={item.key} className={`ac-meta-item ${idx < METADATA_CHECKS.length - 1 ? 'ac-meta-item--border' : ''}`}>
            <span className={`ac-meta-icon ${pass ? 'ac-meta-icon--pass' : 'ac-meta-icon--fail'}`} aria-hidden>
              {pass ? (
                <Check size={13} strokeWidth={2.75} />
              ) : (
                <X size={13} strokeWidth={2.75} />
              )}
            </span>
            <span className="ac-meta-label">{item.label}</span>
          </li>
        );
      })}
    </ul>
  </div>
);

/* ── Recent checks panel ─────────────────────────────────────────── */
const RECENT_KEY_PREFIX = 'ac_recent_checks';
const MAX_RECENT = 7;

function recentStorageKey(userId) {
  return userId != null ? `${RECENT_KEY_PREFIX}:${userId}` : RECENT_KEY_PREFIX;
}

function loadRecent(userId) {
  try { return JSON.parse(localStorage.getItem(recentStorageKey(userId)) || '[]'); }
  catch { return []; }
}

function saveRecent(userId, list) {
  try { localStorage.setItem(recentStorageKey(userId), JSON.stringify(list)); }
  catch { /* ignore */ }
}

function formatRelativeTime(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  // Format as "Apr 29"
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const RecentChecks = ({ recentList }) => (
  <div className="ac-recent-panel">
    <div className="ac-recent-title">Recent checks</div>
    {recentList.length === 0 ? (
      <div className="ac-recent-empty">No checks yet — upload an EPUB to get started.</div>
    ) : (
      <ul className="ac-recent-list">
        {recentList.slice(0, 7).map((item, idx) => {
          const scoreColor = item.score >= 90 ? '#16a34a'
                           : item.score >= 70 ? '#2563eb'
                           : item.score >= 50 ? '#d97706'
                           : '#dc2626';
          return (
            <li key={idx} className="ac-recent-item">
              <span className="ac-recent-name">{item.filename}</span>
              <span className="ac-recent-time">{formatRelativeTime(item.checkedAt)}</span>
              <span className="ac-recent-score" style={{ color: scoreColor }}>
                {item.score}%
              </span>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

/* ── Compliance criteria derived from violations ─────────────── */
const CRITERIA = [
  {
    key: 'perceivable',
    label: 'Perceivable — structure',
    rules: ['heading-order', 'document-title', 'epub-toc-order'],
  },
  {
    key: 'operable',
    label: 'Operable — keyboard nav',
    rules: ['scrollable-region-focusable', 'keyboard', 'focus-order'],
  },
  {
    key: 'understandable',
    label: 'Understandable — lang attr',
    rules: ['epub-lang', 'html-has-lang'],
  },
  {
    key: 'robust',
    label: 'Robust — valid markup',
    rules: ['aria-roles', 'epub-type-has-matching-role', 'epub-type-has-matching-dpub-role', 'landmark-unique'],
  },
  {
    key: 'images',
    label: 'Images — alt text',
    rules: ['image-alt'],
  },
  {
    key: 'color',
    label: 'Color contrast',
    rules: ['color-contrast'],
  },
];

/* ── Status icon (Lucide in circular badge) ─────────────────── */
const CI_ICON = { size: 12, strokeWidth: 2.75 };

const StatusIcon = ({ status }) => {
  if (status === 'pass') {
    return (
      <span className="ac-ci-icon ac-ci-pass" aria-hidden>
        <Check {...CI_ICON} />
      </span>
    );
  }
  if (status === 'warn') {
    return (
      <span className="ac-ci-icon ac-ci-warn" aria-hidden>
        <AlertTriangle {...CI_ICON} />
      </span>
    );
  }
  if (status === 'fail') {
    return (
      <span className="ac-ci-icon ac-ci-fail" aria-hidden>
        <X {...CI_ICON} />
      </span>
    );
  }
  return (
    <span className="ac-ci-icon ac-ci-idle" aria-hidden>
      <Minus {...CI_ICON} />
    </span>
  );
};

/* ── Main page ───────────────────────────────────────────────── */
const Accessibility = () => {
  const { user } = useAuth();
  const listScope = useListScope();
  const [wizardState, setWizardState] = useState({
    jobId: '',
    summary: { totalViolations: 0, bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 } },
    allViolations: [],
    file: null,
    metadata: {},
  });

  const [recentList, setRecentList] = useState(() => loadRecent(user?.id));

  const { jobId, summary, allViolations, file, metadata } = wizardState;
  const hasResults = !!jobId;

  /* ── Derived stats ── */
  const totalViolations = summary.totalViolations ?? 0;
  const criticalCount   = summary.bySeverity?.critical ?? 0;

  // Auto-fixable = violations whose rule is in AUTO_FIXED_RULES (approximated by non-critical/serious)
  const autoFixable = useMemo(() => {
    if (!hasResults) return 0;
    return allViolations.filter(v => {
      const t = v?.title || '';
      return [
        'epub-lang','html-has-lang','metadata-accessmode','metadata-accessmodesufficient',
        'metadata-accessibilityfeature','metadata-accessibilityhazard','metadata-accessibilitysummary',
        'scrollable-region-focusable','landmark-no-duplicate-contentinfo','landmark-unique',
        'epub-toc-order','epub-type-has-matching-role','epub-type-has-matching-dpub-role',
        'aria-roles','epub-pagelist-broken',
      ].includes(t);
    }).length;
  }, [allViolations, hasResults]);

  // Compliance score = (total - violations) / total * 100, capped 0-100
  const complianceScore = useMemo(() => {
    if (!hasResults) return null;
    if (totalViolations === 0) return 100;
    // Rough heuristic: each violation costs points based on severity
    const penalty = (summary.bySeverity?.critical ?? 0) * 10
                  + (summary.bySeverity?.serious  ?? 0) * 6
                  + (summary.bySeverity?.moderate ?? 0) * 3
                  + (summary.bySeverity?.minor    ?? 0) * 1;
    return Math.max(0, Math.min(100, Math.round(100 - penalty)));
  }, [hasResults, totalViolations, summary]);

  /* ── Criteria status ── */
  const criteriaStatus = useMemo(() => {
    if (!hasResults) return {};
    const violationTitles = new Set(allViolations.map(v => v?.title).filter(Boolean));
    return Object.fromEntries(
      CRITERIA.map(c => {
        const failing = c.rules.filter(r => violationTitles.has(r));
        const status = failing.length === 0 ? 'pass'
                     : failing.length < c.rules.length ? 'warn'
                     : 'fail';
        return [c.key, { status, count: failing.length }];
      })
    );
  }, [hasResults, allViolations]);

  /* ── Unique chapters/files affected ── */
  const chaptersAffected = useMemo(() => {
    if (!hasResults) return 0;
    return new Set(allViolations.map(v => v?.filePath).filter(Boolean)).size;
  }, [hasResults, allViolations]);

  /* ── Save to recent checks when a new job completes ── */
  useEffect(() => {
    if (!jobId || complianceScore === null) return;
    const filename = file?.name || `job-${jobId}.epub`;
    setRecentList(prev => {
      // Avoid duplicate entries for the same job
      const filtered = prev.filter(r => r.jobId !== jobId);
      const next = [
        { jobId, filename, score: complianceScore, checkedAt: new Date().toISOString() },
        ...filtered,
      ].slice(0, MAX_RECENT);
      saveRecent(user?.id, next);
      return next;
    });
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ac-root">

      {/* ── Page header ── */}
      <div className="ac-header">
        <div className="ac-header-left">
          <h1 className="ac-title">Accessibility Checker</h1>
          <span className="ac-badge ac-badge-blue">WCAG AA</span>
          <span className="ac-badge ac-badge-green">NEW: AI Fix</span>
        </div>
        <p className="ac-subtitle">
          {listScope === 'own'
            ? 'Upload your EPUB, review violations, apply AI-assisted fixes, re-validate, and download a WCAG\u00a0AA-compliant file.'
            : 'Upload an EPUB for your organization, review violations, apply AI-assisted fixes, re-validate, and download a WCAG\u00a0AA-compliant file.'}
        </p>
      </div>

      {/* ── Wizard (upload + fix panels) ── */}
      <div className="ac-sections">
        <div className="ac-wizard-wrap">
          <AccessibilityWizard onStateChange={setWizardState} />
        </div>

      {/* ── Dashboard tiles — shown after check runs ── */}
      {hasResults && (
        <>
          {/* ── 4 stat tiles ── */}
          <div className="ac-stat-grid">
            <div className="ac-stat-tile">
              <div className="ac-stat-tile-label">Total violations</div>
              <div className="ac-stat-tile-value ac-val-red">{totalViolations}</div>
              <div className="ac-stat-tile-sub">
                {chaptersAffected > 0 ? `across ${chaptersAffected} chapter${chaptersAffected !== 1 ? 's' : ''}` : 'in this EPUB'}
              </div>
            </div>

            <div className="ac-stat-tile">
              <div className="ac-stat-tile-label">Critical issues</div>
              <div className="ac-stat-tile-value ac-val-amber">{criticalCount}</div>
              <div className="ac-stat-tile-sub">need manual review</div>
            </div>

            <div className="ac-stat-tile">
              <div className="ac-stat-tile-label">Auto-fixable</div>
              <div className="ac-stat-tile-value ac-val-green">{autoFixable}</div>
              <div className="ac-stat-tile-sub">AI can resolve</div>
            </div>

            <div className="ac-stat-tile">
              <div className="ac-stat-tile-label">Compliance score</div>
              <div className="ac-stat-tile-value ac-val-blue">{complianceScore}%</div>
              <div className="ac-stat-tile-sub">target: 100%</div>
            </div>
          </div>

          {/* ── WCAG compliance progress ── */}
          <div className="ac-progress-panel">
            <div className="ac-progress-header">
              <span className="ac-progress-title">WCAG AA compliance progress</span>
              <span className="ac-progress-pct ac-val-blue">{complianceScore}%</span>
            </div>
            <div className="ac-progress-track">
              <div
                className="ac-progress-fill"
                style={{
                  width: `${complianceScore}%`,
                  background: complianceScore === 100 ? '#16a34a'
                            : complianceScore >= 70   ? '#2563eb'
                            : complianceScore >= 40   ? '#d97706'
                            : '#dc2626',
                }}
              />
            </div>

            {/* ── Criteria checklist ── */}
            <div className="ac-criteria-grid">
              {CRITERIA.map(c => {
                const cs = criteriaStatus[c.key] || { status: 'idle', count: 0 };
                return (
                  <div key={c.key} className={`ac-criteria-item ac-ci-${cs.status}`}>
                    <StatusIcon status={cs.status} />
                    <span className="ac-ci-label">
                      {c.label}
                      {cs.status === 'fail' && cs.count > 0 && (
                        <span className="ac-ci-count"> — {cs.count} fail{cs.count !== 1 ? 's' : ''}</span>
                      )}
                      {cs.status === 'warn' && cs.count > 0 && (
                        <span className="ac-ci-count"> — {cs.count} warn</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Empty state hint (before any check) ── */}
      {!hasResults && (
        <div className="ac-hint-panel">
          <div className="ac-hint-header">
            <div className="ac-hint-header-left">
              <span className="ac-hint-eyebrow">How it works</span>
              <h2 className="ac-hint-heading">4 steps to a fully accessible EPUB</h2>
              <p className="ac-hint-subtext">
                Upload your file above to begin. The checker runs automatically and guides you through every fix.
              </p>
            </div>
            <div className="ac-hint-header-right">
              <div className="ac-hint-stat">
                <span className="ac-hint-stat-value">WCAG AA</span>
                <span className="ac-hint-stat-label">Standard</span>
              </div>
              <div className="ac-hint-stat">
                <span className="ac-hint-stat-value">AI</span>
                <span className="ac-hint-stat-label">Auto-fix</span>
              </div>
              <div className="ac-hint-stat">
                <span className="ac-hint-stat-value">100%</span>
                <span className="ac-hint-stat-label">Target score</span>
              </div>
            </div>
          </div>

          <div className="ac-hint-grid">
            <div className="ac-hint-item">
              <div className="ac-hint-step-num">01</div>
              <div className="ac-hint-icon-box ac-hint-icon-box--blue">
                <ClipboardList className="ac-hint-icon ac-hint-icon--blue" size={22} strokeWidth={2} aria-hidden />
              </div>
              <div className="ac-hint-body">
                <div className="ac-hint-title">WCAG 2.1 AA Check</div>
                <div className="ac-hint-desc">Full compliance scan against all 50+ WCAG success criteria — perceivable, operable, understandable, robust.</div>
                <div className="ac-hint-tags">
                  <span className="ac-hint-tag">Perceivable</span>
                  <span className="ac-hint-tag">Operable</span>
                </div>
              </div>
            </div>

            <div className="ac-hint-item">
              <div className="ac-hint-step-num">02</div>
              <div className="ac-hint-icon-box ac-hint-icon-box--purple">
                <Bot className="ac-hint-icon ac-hint-icon--purple" size={22} strokeWidth={2} aria-hidden />
              </div>
              <div className="ac-hint-body">
                <div className="ac-hint-title">AI-Assisted Fixes</div>
                <div className="ac-hint-desc">Gemini AI generates code repairs for each violation. Review, approve, and apply with one click.</div>
                <div className="ac-hint-tags">
                  <span className="ac-hint-tag">Auto-repair</span>
                  <span className="ac-hint-tag">Review</span>
                </div>
              </div>
            </div>

            <div className="ac-hint-item">
              <div className="ac-hint-step-num">03</div>
              <div className="ac-hint-icon-box ac-hint-icon-box--teal">
                <AccessibilityIcon className="ac-hint-icon ac-hint-icon--teal" size={22} strokeWidth={2} aria-hidden />
              </div>
              <div className="ac-hint-body">
                <div className="ac-hint-title">EPUB Accessibility 1.1</div>
                <div className="ac-hint-desc">Validates metadata, landmarks, reading order, alt text, and language attributes per EPUB spec.</div>
                <div className="ac-hint-tags">
                  <span className="ac-hint-tag">Metadata</span>
                  <span className="ac-hint-tag">Landmarks</span>
                </div>
              </div>
            </div>

            <div className="ac-hint-item">
              <div className="ac-hint-step-num">04</div>
              <div className="ac-hint-icon-box ac-hint-icon-box--green">
                <Download className="ac-hint-icon ac-hint-icon--green" size={22} strokeWidth={2} aria-hidden />
              </div>
              <div className="ac-hint-body">
                <div className="ac-hint-title">Download Fixed EPUB</div>
                <div className="ac-hint-desc">Get a fully remediated, standards-compliant EPUB with a downloadable Ace accessibility report.</div>
                <div className="ac-hint-tags">
                  <span className="ac-hint-tag">Compliant</span>
                  <span className="ac-hint-tag">Report</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

   {/* ── Violations panel ── */}
      {hasResults && allViolations.length > 0 && (
        <ViolationsPanel
          allViolations={allViolations}
          autoFixableRules={AUTO_FIXABLE_RULES}
        />
      )}

      {/* ── Metadata checklist + Recent checks ── */}
      <div className="ac-bottom-grid">
        <MetadataChecklist
          metadata={metadata}
          allViolations={allViolations}
        />
        <RecentChecks recentList={recentList} />
      </div>

      </div>{/* end ac-sections */}
    </div>
  );
};

export default Accessibility;
