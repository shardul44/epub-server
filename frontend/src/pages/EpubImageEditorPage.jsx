import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { conversionService } from '../services/conversionService';
import EpubImageEditor from '../components/EpubImageEditor';
import {
  AlertCircle,
  ArrowLeft,
  FileCode,
  FilePenLine,
  FileWarning,
  LayoutDashboard,
  Loader2,
  PenLine,
  Save,
  Sparkles,
} from 'lucide-react';
import './EpubImageEditorPage.css';
import WorkflowStudioChrome from '../components/WorkflowStudioChrome';

const ic = { strokeWidth: 2, 'aria-hidden': true };

const EpubImageEditorPage = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [pages, setPages] = useState([]);
  const [documentPageCount, setDocumentPageCount] = useState(null);
  const [selectedPage, setSelectedPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Guard against Strict Mode double-invoke and stale jobId
  const loadingRef   = useRef(false);
  const mountedRef   = useRef(true);
  const lastJobIdRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Skip if no jobId, already loading for this jobId, or component unmounted
    if (!jobId) return;
    if (loadingRef.current && lastJobIdRef.current === jobId) return;

    loadingRef.current   = true;
    lastJobIdRef.current = jobId;

    loadPages();

    // No cleanup interval needed here — loadPages is a one-shot async call
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPages = async () => {
    if (!mountedRef.current) return;

    try {
      setLoading(true);
      setError('');

      // Verify the job exists and is completed
      let job;
      try {
        job = await conversionService.getConversionJob(parseInt(jobId));
      } catch (jobErr) {
        if (!mountedRef.current) return;
        console.error('Error checking job status:', jobErr);
        setError('Failed to load conversion job details.');
        return;
      }

      if (!mountedRef.current) return;

      // null = 404 (job deleted)
      if (!job) {
        setError('Conversion job not found. It may have been deleted.');
        return;
      }

      if (job.status !== 'COMPLETED') {
        // Instead of blocking this page, route the user back to Conversion Jobs
        // and focus the converting job so they can watch progress.
        navigate('/conversions', {
          replace: true,
          state: { focusJobId: String(job.id ?? job.jobId ?? jobId), status: job.status },
        });
        return;
      }

      // Load XHTML spine (one file per chapter or per page) + physical page count from server
      const layout = await conversionService.getJobPages(parseInt(jobId));
      if (!mountedRef.current) return;

      let pagesList = layout.spine || [];
      const docPages =
        layout.documentPageCount != null && layout.documentPageCount > 0
          ? layout.documentPageCount
          : pagesList.length
            ? Math.max(...pagesList.map((p) => p.pageNumber || 0))
            : 0;
      setDocumentPageCount(docPages || null);

      // If no pages, try regenerating once
      if (!pagesList || pagesList.length === 0) {
        try {
          await conversionService.regenerateEpub(parseInt(jobId));
          if (!mountedRef.current) return;
          const layout2 = await conversionService.getJobPages(parseInt(jobId));
          pagesList = layout2.spine || [];
          const doc2 =
            layout2.documentPageCount != null && layout2.documentPageCount > 0
              ? layout2.documentPageCount
              : pagesList.length
                ? Math.max(...pagesList.map((p) => p.pageNumber || 0))
                : 0;
          setDocumentPageCount(doc2 || null);
          if (!mountedRef.current) return;
        } catch (regenErr) {
          console.error('[EpubImageEditorPage] Regeneration failed:', regenErr);
        }
      }

      if (!pagesList || pagesList.length === 0) {
        setError(
          'No editable XHTML pages found for this job. ' +
          'This may happen if the conversion did not produce intermediate HTML files. ' +
          'Try re-running the conversion from the Conversions page.'
        );
        return;
      }

      setPages(pagesList);
      setSelectedPage(pagesList[0].pageNumber);
    } catch (err) {
      if (!mountedRef.current) return;
      // Swallow 404 — job was deleted between checks
      if (err.response?.status === 404) {
        setError('Conversion job not found. It may have been deleted.');
        return;
      }
      console.error('Error loading pages:', err);
      setError(err.response?.data?.message || err.message || 'Failed to load pages');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        loadingRef.current = false;
      }
    }
  };

  const [editorState, setEditorState] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [saveToast, setSaveToast] = useState(null); // { type: 'success' | 'error', message: string }

  // Auto-dismiss toast after 3 s
  useEffect(() => {
    if (!saveToast) return;
    const t = setTimeout(() => setSaveToast(null), 3000);
    return () => clearTimeout(t);
  }, [saveToast]);

  const handleSave = useCallback(async (xhtml) => {
    if (!jobId || !selectedPage) return;
    try {
      await conversionService.savePageXhtml(parseInt(jobId), selectedPage, xhtml);
      setSaveToast({ type: 'success', message: 'Page saved successfully.' });
    } catch (err) {
      console.error('[EpubImageEditorPage] Save failed:', err);
      setSaveToast({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Save failed. Please try again.',
      });
    }
  }, [jobId, selectedPage]);
  
  const handleEditorStateChange = useCallback((state) => {
    setEditorState(state);
  }, []);

  const handleRequestPageChange = useCallback((nextPage) => {
    setSelectedPage(nextPage);
  }, []);

  const handleSyncStudio = async () => {
    try {
      setRegenerating(true);
      await conversionService.regenerateEpub(parseInt(jobId));
    } catch (err) {
      console.error('Regeneration error (proceeding anyway):', err);
    } finally {
      setRegenerating(false);
      navigate(`/sync-studio/${jobId}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2em', textAlign: 'center', color: '#374151' }}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Loader2 size={36} strokeWidth={2.25} className="eiep-icon-spin" aria-hidden />
          <p style={{ margin: 0 }}>Loading pages…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2em', maxWidth: 560, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '14px 16px',
            color: '#b91c1c',
            marginBottom: '1em',
            lineHeight: 1.55,
          }}
        >
          <AlertCircle size={20} {...ic} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
        <button
          type="button"
          className="eiep-btn-inline"
          onClick={() => navigate('/conversions')}
        >
          <ArrowLeft size={18} {...ic} />
          Back to Conversions
        </button>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div style={{ padding: '2em', textAlign: 'center', color: '#374151' }}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <FileWarning size={40} {...ic} style={{ color: '#9ca3af' }} />
          <p style={{ margin: 0 }}>No pages found for this conversion job.</p>
          <button
            type="button"
            className="eiep-btn-inline"
            onClick={() => navigate('/conversions')}
          >
            <ArrowLeft size={18} {...ic} />
            Back to Conversions
          </button>
        </div>
      </div>
    );
  }

  const jid = parseInt(jobId, 10);
  const workflowJob = { id: jid, jobId: jid, jobType: 'REFLOW' };

  return (
    <div className="eiep-root">
      <WorkflowStudioChrome
        activeStep={1}
        jobId={jid}
        job={workflowJob}
        topTitle="EPUB Image Editor"
        backTo="/conversions/fxl-editor"
        hideBackToConversions
      />

      {/* ── Toast notification ── */}
      {saveToast && (
        <div
          className={`eiep-toast eiep-toast--${saveToast.type}`}
          role="alert"
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 9999,
            background: saveToast.type === 'success' ? '#10b981' : '#ef4444',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 500,
            animation: 'eiep-toast-slide-in 0.2s ease-out',
          }}
        >
          {saveToast.type === 'success' ? '✓' : '⚠'} {saveToast.message}
        </div>
      )}

      {/* ── Editor toolbar ── */}
      <header className="eiep-topbar">
        <div className="eiep-topbar-left">
          <label className="eiep-page-label">
            Page
            <select
              className="eiep-page-select"
              value={selectedPage || ''}
              onChange={(e) => setSelectedPage(parseInt(e.target.value))}
            >
              {pages.map((page) => (
                <option key={page.pageNumber} value={page.pageNumber}>
                  {page.pageNumber}
                </option>
              ))}
            </select>
            {documentPageCount != null && documentPageCount > 0 && (
              <span className="eiep-page-docmeta" title="Physical pages in the PDF / text pipeline (may exceed XHTML spine files when chapters are merged)">
                {' '}
                · {documentPageCount} PDF pages · {pages.length} spine file{pages.length !== 1 ? 's' : ''}
              </span>
            )}
          </label>
        </div>

        <div className="eiep-topbar-right">
          {editorState && (
            <>
              <button
                type="button"
                className={`eiep-btn${editorState.editMode ? ' eiep-btn--active' : ' eiep-btn--ghost'}`}
                onClick={() => editorState.setEditMode(!editorState.editMode)}
              >
                <PenLine size={15} {...ic} />
                {editorState.editMode ? 'Edit Mode ON' : 'Edit Mode OFF'}
              </button>

              {editorState.modified && (
                <span className="eiep-modified-badge">
                  <FilePenLine size={13} {...ic} />
                  Modified
                </span>
              )}

              <button
                type="button"
                className="eiep-btn eiep-btn--ghost"
                onClick={editorState.handleReset}
                disabled={!editorState.modified || !editorState.editMode}
              >
                Reset
              </button>

              <button
                type="button"
                className="eiep-btn eiep-btn--save"
                onClick={editorState.handleSave}
                disabled={editorState.saving || !editorState.modified || !editorState.editMode}
              >
                {editorState.saving ? (
                  <><Loader2 size={15} strokeWidth={2.25} className="eiep-icon-spin" aria-hidden /> Saving…</>
                ) : (
                  <><Save size={15} {...ic} /> Save XHTML</>
                )}
              </button>
            </>
          )}

          <button
            type="button"
            className="eiep-btn eiep-btn--purple"
            onClick={handleSyncStudio}
            disabled={regenerating}
          >
            {regenerating ? (
              <><Loader2 size={15} strokeWidth={2.25} className="eiep-icon-spin" aria-hidden /> Regenerating…</>
            ) : (
              <><LayoutDashboard size={15} {...ic} /> Sync Studio</>
            )}
          </button>

          {editorState?.handleRegenerateChapter && (
            <button
              type="button"
              className="eiep-btn eiep-btn--pink"
              onClick={editorState.handleRegenerateChapter}
              disabled={editorState.regenerating}
              title="Regenerate chapter containing current page using Gemini AI"
            >
              {editorState.regenerating ? (
                <><Loader2 size={15} strokeWidth={2.25} className="eiep-icon-spin" aria-hidden /> Regenerating…</>
              ) : (
                <><Sparkles size={15} {...ic} /> Regenerate Chapter</>
              )}
            </button>
          )}

          {editorState?.openCodeViewer && (
            <button
              type="button"
              className="eiep-btn eiep-btn--blue"
              onClick={editorState.openCodeViewer}
              title="View XHTML Code"
            >
              <FileCode size={15} {...ic} /> View Code
            </button>
          )}

        </div>
      </header>

      {/* ── Editor body ── */}
      {selectedPage && (
        <div className="eiep-body">
          <EpubImageEditor
            jobId={parseInt(jobId)}
            pageNumber={selectedPage}
            onSave={handleSave}
            onStateChange={handleEditorStateChange}
            onRequestPageChange={handleRequestPageChange}
          />
        </div>
      )}
    </div>
  );
};

export default EpubImageEditorPage;

