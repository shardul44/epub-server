import React, { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  FileCheck,
  History,
  Info,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Check,
  X,
  Trash2,
  Upload,
} from 'lucide-react';
import DashboardHeader from '../components/layout/Header';
import MainContent from '../components/layout/MainContent';
import EpubConformanceCheck from '../components/EpubConformanceCheck';
import {
  formatEpubCheckerSubtitle,
  readEpubcheckHistory,
  clearEpubcheckHistory,
} from '../utils/epubCheckerMeta';
import './Dashboard.css';
import './EpubCheckerPage.css';

const STEPS = ['Upload', 'Validate', 'Review', 'Auto-fix', 'AI drafts', 'Download'];

/* ─── Upload Success Modal ────────────────────────────────────── */
const UploadSuccessModal = ({ fileName, onClose }) => (
  <div
    className="ecc-success-overlay"
    onClick={onClose}
    role="dialog"
    aria-modal="true"
    aria-labelledby="ecc-success-title"
  >
    <div className="ecc-success-modal" onClick={(e) => e.stopPropagation()}>
      {/* Icon */}
      <div className="ecc-success-icon-wrap">
        <div className="ecc-success-icon-ring">
          <CheckCircle2 size={36} strokeWidth={2} />
        </div>
      </div>

      {/* Text */}
      <div className="ecc-success-body">
        <h2 id="ecc-success-title" className="ecc-success-title">Uploaded Successfully!</h2>
        <p className="ecc-success-sub">Your EPUB file is ready to validate.</p>
        {fileName && (
          <div className="ecc-success-filename">
            <Upload size={13} />
            <span>{fileName}</span>
          </div>
        )}
      </div>

      {/* Action */}
      <button className="ecc-success-btn" onClick={onClose} autoFocus>
        <Check size={15} /> Got it
      </button>

      {/* Close X */}
      <button className="ecc-success-close" onClick={onClose} aria-label="Close">
        <X size={16} />
      </button>
    </div>
  </div>
);

const fmtWhen = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
};

const EpubCheckerPage = () => {
  const [checkerUi, setCheckerUi] = useState({
    stepperStep: 0,
    javaStatus: null,
    checkerLabel: null,
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [uploadedFile, setUploadedFile] = useState(null); // drives success modal

  const onCheckerUiState = useCallback((next) => {
    setCheckerUi((prev) => ({ ...prev, ...next }));
  }, []);

  const refreshHistory = useCallback(() => {
    setHistoryItems(readEpubcheckHistory());
  }, []);

  useEffect(() => {
    if (historyOpen) refreshHistory();
  }, [historyOpen, refreshHistory]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setHistoryOpen(false);
        setAboutOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeModals = () => {
    setHistoryOpen(false);
    setAboutOpen(false);
  };

  const { javaStatus, stepperStep, checkerLabel } = checkerUi;
  const versionLine = formatEpubCheckerSubtitle(checkerLabel);

  return (
    <div className="ds-root">
      <DashboardHeader
        title="EPUB Checker"
        subtitle={versionLine}
        actions={
          <div className="ecc-checker-header-actions">
            <NavLink
              to="/epub-checker"
              end
              className={({ isActive }) =>
                `ds-navbar-btn ds-navbar-btn--ghost${isActive ? ' ecc-checker-nav-active' : ''}`
              }
            >
              <FileCheck size={16} strokeWidth={2} aria-hidden />
              Checker
            </NavLink>
            <button
              type="button"
              className="ds-navbar-btn ds-navbar-btn--ghost"
              onClick={() => {
                setAboutOpen(false);
                setHistoryOpen(true);
              }}
            >
              <History size={16} strokeWidth={2} aria-hidden />
              History
            </button>
            <button
              type="button"
              className="ds-navbar-btn ds-navbar-btn--ghost"
              onClick={() => {
                setHistoryOpen(false);
                setAboutOpen(true);
              }}
            >
              <Info size={16} strokeWidth={2} aria-hidden />
              About
            </button>
          </div>
        }
      />

      <MainContent className="ds-container--full ecc-page-shell">
        <section className="ecc-hero">
          <h1>EPUB Conformance Validator</h1>
          <p className="ecc-hero-desc">
            Upload an EPUB, run W3C EPUBCheck, review messages, then optionally apply deterministic fixes or AI drafts,
            re-validate, and download a repaired package — all in one flow.
          </p>
          {!javaStatus && (
            <div className="ecc-hero-badge ecc-hero-badge--loading">
              <Loader2 className="ecc-hero-badge-icon ecc-hero-badge-icon--spin" size={15} aria-hidden />
              Checking server environment…
            </div>
          )}
          {javaStatus?.javaAvailable && (
            <div className="ecc-hero-badge ecc-hero-badge--ok">
              <CheckCircle2 className="ecc-hero-badge-icon" size={15} strokeWidth={2.25} aria-hidden />
              Server ready — Java found, EPUBCheck can run
            </div>
          )}
          {javaStatus && !javaStatus.javaAvailable && (
            <div className="ecc-hero-badge ecc-hero-badge--bad">
              <AlertCircle className="ecc-hero-badge-icon" size={15} strokeWidth={2.25} aria-hidden />
              Server not ready — install a JRE and add <code>java</code> to PATH
            </div>
          )}
        </section>

        <div className="ecc-stepper-wrap">
          <ol className="ecc-stepper" aria-label="Progress">
            {STEPS.map((label, i) => {
              const active = i === stepperStep;
              const done = i < stepperStep;
              return (
                <li
                  key={label}
                  className={`ecc-step${active ? ' ecc-step--active' : ''}${done ? ' ecc-step--done' : ''}`}
                >
                  <span className="ecc-step-circle" aria-hidden="true">
                    {done ? (
                      <Check size={12} strokeWidth={3} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="ecc-step-label">{label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="ecc-main ecc-results-wrap">
          <EpubConformanceCheck
            checkerPageLayout
            onCheckerUiState={onCheckerUiState}
            onFileUploaded={(f) => setUploadedFile(f)}
          />
        </div>
      </MainContent>

      {/* ── Upload success modal ── */}
      {uploadedFile && (
        <UploadSuccessModal
          fileName={uploadedFile.name}
          onClose={() => setUploadedFile(null)}
        />
      )}

      {historyOpen && (
        <div className="ecc-modal-root">
          <button
            type="button"
            className="ecc-modal-backdrop"
            aria-label="Close history"
            onClick={closeModals}
          />
          <div
            className="ecc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ecc-history-title"
          >
            <div className="ecc-modal-header">
              <h2 id="ecc-history-title">Validation history</h2>
              <button type="button" className="ecc-modal-close" onClick={closeModals} aria-label="Close">
                <X size={18} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
            <p className="ecc-modal-lead">
              Recent runs from this browser only (stored in session storage). Clearing your browser data removes this list.
            </p>
            {historyItems.length === 0 ? (
              <p className="ecc-modal-empty">No runs yet. Upload an EPUB and choose Run EPUBCheck to start.</p>
            ) : (
              <ul className="ecc-history-list">
                {historyItems.map((row) => (
                  <li key={row.id} className="ecc-history-item">
                    <div className="ecc-history-main">
                      <span className="ecc-history-file">{row.fileName || '—'}</span>
                      {row.publicationTitle && (
                        <span className="ecc-history-title-sub">{row.publicationTitle}</span>
                      )}
                    </div>
                    <div className="ecc-history-meta">
                      <span
                        className={
                          row.valid ? 'ecc-history-pill ecc-history-pill--ok' : 'ecc-history-pill ecc-history-pill--bad'
                        }
                      >
                        {row.valid ? (
                          <>
                            <CheckCircle2 size={13} strokeWidth={2.25} className="ecc-history-pill-icon" aria-hidden />
                            Valid
                          </>
                        ) : (
                          <>
                            <AlertCircle size={13} strokeWidth={2.25} className="ecc-history-pill-icon" aria-hidden />
                            Issues
                          </>
                        )}
                      </span>
                      <span className="ecc-history-time">{fmtWhen(row.at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {historyItems.length > 0 && (
              <div className="ecc-modal-footer">
                <button
                  type="button"
                  className="ds-navbar-btn ds-navbar-btn--ghost"
                  onClick={() => {
                    clearEpubcheckHistory();
                    refreshHistory();
                  }}
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden />
                  Clear history
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {aboutOpen && (
        <div className="ecc-modal-root">
          <button
            type="button"
            className="ecc-modal-backdrop"
            aria-label="Close about"
            onClick={closeModals}
          />
          <div
            className="ecc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ecc-about-title"
          >
            <div className="ecc-modal-header">
              <h2 id="ecc-about-title">About EPUB Checker</h2>
              <button type="button" className="ecc-modal-close" onClick={closeModals} aria-label="Close">
                <X size={18} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
            <div className="ecc-about-body">
              <p>
                This tool runs{' '}
                <a href="https://www.w3.org/publishing/epubcheck/" target="_blank" rel="noopener noreferrer">
                  W3C EPUBCheck
                </a>{' '}
                on your uploaded package to report conformance with EPUB standards. Optional passes can apply safe
                deterministic fixes or AI-assisted drafts, then re-validate and download a repaired EPUB.
              </p>
              <p>
                <strong>Version line in the header</strong> comes from the server status endpoint or your last validation
                report so you know which checker build ran.
              </p>
              <p className="ecc-about-version">
                <strong>Displayed subtitle:</strong> {versionLine}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EpubCheckerPage;
