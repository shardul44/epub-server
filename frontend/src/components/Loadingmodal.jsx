import { TriangleAlert, Trash2, X, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import './Loadingmodal.css';

/**
 * ConfirmModal — reusable confirmation dialog
 *
 * Props:
 *   isOpen       {boolean}   — controls visibility
 *   onClose      {function}  — called when Cancel or backdrop is clicked
 *   onConfirm    {function}  — called when the confirm button is clicked
 *   title        {string}    — modal heading          (default: "Confirm Deletion")
 *   subtitle     {string}    — small text under title (default: "This action cannot be undone.")
 *   message      {string}    — body paragraph
 *   confirmLabel {string}    — confirm button text    (default: "Delete")
 *   cancelLabel  {string}    — cancel button text     (default: "Cancel")
 *   variant      {string}    — "danger" | "warning" | "info"  (default: "danger")
 *   showIcon     {boolean}   — show the warning icon  (default: true)
 *   loading      {boolean}   — disables buttons while an async action runs
 */
const ConfirmModal = ({
  isOpen = false,
  onClose,
  onConfirm,
  title = 'Confirm Deletion',
  subtitle = 'This action cannot be undone.',
  message = 'Are you sure you want to proceed? This action cannot be undone.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  variant = 'danger',
  showIcon = true,
  loading = false,
}) => {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div className="cm-backdrop" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-labelledby="cm-title">
      <div className="cm-panel">
        {/* ── Header ── */}
        <div className="cm-header">
          {showIcon && (
            <span className={`cm-icon-wrap cm-icon-wrap--${variant}`}>
              <TriangleAlert size={22} />
            </span>
          )}
          <div className="cm-header-text">
            <h2 id="cm-title" className="cm-title">{title}</h2>
            {subtitle && <p className="cm-subtitle">{subtitle}</p>}
          </div>
          <button className="cm-close" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="cm-body">
          <p className="cm-message">{message}</p>
        </div>

        {/* ── Footer ── */}
        <div className="cm-footer">
          <button
            className="cm-btn cm-btn-cancel"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            className={`cm-btn cm-btn-confirm cm-btn-confirm--${variant}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {variant === 'danger' && <Trash2 size={16} />}
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;

/**
 * UploadLoadingModal — shown while a PDF is being uploaded
 *
 * Props:
 *   isOpen    {boolean}  — controls visibility
 *   progress  {number}   — 0-100 upload percentage
 *   fileName  {string}   — name of the file being uploaded
 *   status    {string}   — "uploading" | "success" | "error"
 *   error     {string}   — error message when status === "error"
 *   onClose   {function} — error "Close" button action
 */
export const UploadLoadingModal = ({
  isOpen = false,
  progress = 0,
  fileName = '',
  status = 'uploading',
  error = '',
  onClose,
}) => {
  if (!isOpen) return null;

  const isUploading = status === 'uploading';
  const isSuccess   = status === 'success';
  const isError     = status === 'error';
  return (
    <div className="cm-backdrop ulm-backdrop" role="dialog" aria-modal="true" aria-labelledby="ulm-title">
      <div className="cm-panel ulm-panel">
        {/* ── Icon area ── */}
        <div className="ulm-icon-area">
          {isUploading && (
            <div className="ulm-spinner-wrap">
              <svg className="ulm-ring" viewBox="0 0 56 56" fill="none" aria-hidden="true">
                <circle cx="28" cy="28" r="24" stroke="#e5e7eb" strokeWidth="5" />
                <circle
                  cx="28" cy="28" r="24"
                  stroke="#2563eb"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 24}`}
                  strokeDashoffset={`${2 * Math.PI * 24 * (1 - progress / 100)}`}
                  className="ulm-ring-fill"
                />
              </svg>
              <span className="ulm-ring-pct">{Math.round(progress)}%</span>
            </div>
          )}
          {isSuccess && (
            <span className="ulm-status-icon ulm-status-icon--success">
              <CheckCircle size={40} />
            </span>
          )}
          {isError && (
            <span className="ulm-status-icon ulm-status-icon--error">
              <AlertCircle size={40} />
            </span>
          )}
        </div>

        {/* ── Text ── */}
        <div className="ulm-body">
          <h2 id="ulm-title" className="ulm-title">
            {isUploading && 'Uploading PDF…'}
            {isSuccess   && 'Upload Complete!'}
            {isError     && 'Upload Failed'}
          </h2>

          {fileName && (
            <p className="ulm-filename">
              <Upload size={13} />
              {fileName}
            </p>
          )}

          {isUploading && (
            <>
              <div className="ulm-bar-track">
                <div className="ulm-bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="ulm-hint">Please keep this window open while your file uploads.</p>
            </>
          )}

          {isSuccess && (
            <>
              <p className="ulm-hint ulm-hint--success">
                Your PDF is in My PDFs. Start conversion from there when you are ready.
              </p>
            </>
          )}

          {isError && (
            <>
              <p className="ulm-hint ulm-hint--error">{error || 'Something went wrong. Please try again.'}</p>
              <button className="cm-btn cm-btn-cancel ulm-close-btn" onClick={onClose}>
                Close
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
};
