import { useState, useMemo, useEffect } from 'react';
import {
  Check,
  X,
  ClipboardList,
  Bot,
  Accessibility as AccessibilityIcon,
  Download,
} from 'lucide-react';
import AccessibilityWizard from '../components/AccessibilityWizard';
import { useListScope } from '../context/ListScopeContext';
import { useAuth } from '../context/AuthContext';
import './Accessibility.css';

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

  const { jobId, summary, file } = wizardState;

  const [recentList, setRecentList] = useState(() => loadRecent(user?.id));

  useEffect(() => {
    setRecentList(loadRecent(user?.id));
  }, [user?.id]);

  const hasResults = !!jobId;

  // Compliance score = (total - violations) / total * 100, capped 0-100
  // Used to record recent checks in localStorage.
  const complianceScore = useMemo(() => {
    if (!hasResults) return null;
    const totalViolations = summary.totalViolations ?? 0;
    if (totalViolations === 0) return 100;
    const penalty = (summary.bySeverity?.critical ?? 0) * 10
                  + (summary.bySeverity?.serious  ?? 0) * 6
                  + (summary.bySeverity?.moderate ?? 0) * 3
                  + (summary.bySeverity?.minor    ?? 0) * 1;
    return Math.max(0, Math.min(100, Math.round(100 - penalty)));
  }, [hasResults, summary]);

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
  }, [jobId]);  

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
      </div>
    </div>
  );
};

export default Accessibility;
