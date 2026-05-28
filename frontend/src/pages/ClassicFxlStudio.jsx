/**
 * Classic FXL Studio — layout-only pipeline (no AI zoning).
 * Start from PDF list with "Classic FXL"; poll job until complete; Publish Classic EPUB and download.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Download, Check } from 'lucide-react';
import { kitabooService } from '../services/kitabooService';
import './ClassicFxlStudio.css';

const POLL_INTERVAL_MS = 1500;

export default function ClassicFxlStudio() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const pollRef = useRef(null);

  const hasLayoutFragments = job?.pages?.some(p => Array.isArray(p.layoutFragments) && p.layoutFragments.length > 0);
  const hasZonesOnly = job?.pages?.length > 0 && !hasLayoutFragments && job?.pages?.some(p => (p.zones || []).length > 0);
  const totalFragments = (job?.pages || []).reduce((sum, p) => sum + (p.layoutFragments || []).length, 0);

  useEffect(() => {
    if (!jobId) {
      setError('No job ID');
      setLoading(false);
      return;
    }

    const fetchJob = async () => {
      try {
        const data = await kitabooService.getJob(jobId);
        setJob(data);
        setError('');
        if (data.status === 'FAILED') {
          setError(data.error || 'Conversion failed');
          if (pollRef.current) clearInterval(pollRef.current);
        }
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e) {
        if (e.response?.status === 404) {
          setError('Job not found');
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setError(e.response?.data?.message || e.message || 'Failed to load job');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchJob();
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !job) return;
    if (job.status === 'IN_PROGRESS' || job.status === 'PENDING') {
      // Clear any existing interval before creating a new one to prevent stacking
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const data = await kitabooService.getJob(jobId);
          setJob(data);
          if (data.status === 'COMPLETED' || data.status === 'FAILED') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch (_) {}
      }, POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, job?.status]);

  const handlePublishClassic = async () => {
    if (!jobId || !hasLayoutFragments) return;
    setPublishing(true);
    setError('');
    try {
      const data = await kitabooService.publishClassic(jobId);
      const filename = data?.epubPath || `kitaboo_fxl_${jobId}.epub`;
      await kitabooService.downloadFxlEpub(jobId, filename);
      setPublishSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Publish or download failed');
    } finally {
      setPublishing(false);
    }
  };

  if (!jobId) {
    return (
      <div className="classic-fxl-studio">
        <div className="classic-fxl-header">
          <button type="button" className="classic-fxl-back" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} /> Back
          </button>
        </div>
        <div className="classic-fxl-content">
          <p className="classic-fxl-message error">No job ID.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="classic-fxl-studio">
      <header className="classic-fxl-header">
        <button type="button" className="classic-fxl-back" onClick={() => navigate('/pdfs/upload')}>
          <ArrowLeft size={20} /> Back
        </button>
        <h1 className="classic-fxl-title">Classic FXL</h1>
        <span className="classic-fxl-job-badge">Job #{jobId}</span>
      </header>

      <main className="classic-fxl-content">
        {loading && !job && (
          <div className="classic-fxl-card">
            <p className="classic-fxl-message">Loading job…</p>
          </div>
        )}

        {error && !job?.status && (
          <div className="classic-fxl-card classic-fxl-card-error">
            <p className="classic-fxl-message error">{error}</p>
            <button type="button" className="classic-fxl-btn secondary" onClick={() => navigate('/pdfs/upload')}>
              Back to Upload
            </button>
          </div>
        )}

        {job?.status === 'IN_PROGRESS' || job?.status === 'PENDING' ? (
          <div className="classic-fxl-card">
            <h2>Converting (layout-only)</h2>
            <p className="classic-fxl-step">{job.currentStep || 'In progress…'}</p>
            <div className="classic-fxl-progress-wrap">
              <div className="classic-fxl-progress-bar">
                <div
                  className="classic-fxl-progress-fill"
                  style={{ width: `${job.progressPercentage ?? 0}%` }}
                />
              </div>
              <span className="classic-fxl-progress-pct">{job.progressPercentage ?? 0}%</span>
            </div>
          </div>
        ) : null}

        {job?.status === 'FAILED' && (
          <div className="classic-fxl-card classic-fxl-card-error">
            <h2>Conversion failed</h2>
            <p className="classic-fxl-message error">{job.error || error}</p>
            <button type="button" className="classic-fxl-btn secondary" onClick={() => navigate('/pdfs/upload')}>
              Back to Upload
            </button>
          </div>
        )}

        {job?.status === 'COMPLETED' && hasLayoutFragments && (
          <div className="classic-fxl-card classic-fxl-card-success">
            <h2><Check size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Ready</h2>
            <p className="classic-fxl-stats">
              {job.pages?.length ?? 0} pages · {totalFragments} text fragments (PDF coordinates)
            </p>
            <p className="classic-fxl-desc">
              This is a layout-only conversion (no AI zoning). Publish to build an EPUB with one background image per page and positioned text divs with CSS coordinate classes — matching classic PDF-reconstruction style.
            </p>
            {error && <p className="classic-fxl-message error">{error}</p>}
            {publishSuccess && (
              <p className="classic-fxl-message success">EPUB built and download started.</p>
            )}
            <div className="classic-fxl-actions">
              <button
                type="button"
                className="classic-fxl-btn primary"
                onClick={handlePublishClassic}
                disabled={publishing}
              >
                {publishing ? 'Publishing…' : (
                  <>
                    <FileText size={18} /> Publish Classic EPUB
                  </>
                )}
              </button>
              {publishSuccess && (
                <button
                  type="button"
                  className="classic-fxl-btn secondary"
                  onClick={() => kitabooService.downloadFxlEpub(jobId)}
                >
                  <Download size={18} /> Download again
                </button>
              )}
            </div>
          </div>
        )}

        {job?.status === 'COMPLETED' && hasZonesOnly && (
          <div className="classic-fxl-card">
            <h2>AI zoning job</h2>
            <p className="classic-fxl-message">
              This job was created with AI zoning (Gemini). To publish with zones and sync, use Kitaboo Studio. For classic layout (PDF coordinates only), start a new conversion with <strong>Classic FXL</strong> from the PDF list.
            </p>
            <div className="classic-fxl-actions">
              <button
                type="button"
                className="classic-fxl-btn primary"
                onClick={() => navigate(`/kitaboo-studio/${jobId}`)}
              >
                Open Kitaboo Studio
              </button>
              <button type="button" className="classic-fxl-btn secondary" onClick={() => navigate('/pdfs/upload')}>
                Back to Upload
              </button>
            </div>
          </div>
        )}

        {job?.status === 'COMPLETED' && !hasLayoutFragments && !hasZonesOnly && (
          <div className="classic-fxl-card">
            <h2>No layout data</h2>
            <p className="classic-fxl-message">
              This job has no layout fragments. Start a <strong>Classic FXL</strong> conversion from the PDF list to use the layout-only pipeline.
            </p>
            <button type="button" className="classic-fxl-btn secondary" onClick={() => navigate('/pdfs/upload')}>
              Back to Upload
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
