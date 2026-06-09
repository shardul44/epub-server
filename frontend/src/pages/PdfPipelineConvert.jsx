import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload,
  FileText,
  X,
  Download,
  RefreshCw,
  Layers,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Container,
} from 'lucide-react';
import {
  pdfPipelineService,
  downloadBlob,
  PIPELINE_JOB_STORAGE_KEY,
} from '../services/pdfPipelineService';
import '../pages/PdfUpload.css';
import './PdfPipelineConvert.css';

const POLL_MS = 2500;

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status) {
  const map = {
    PENDING: ['Pending', 'pending'],
    IN_PROGRESS: ['Converting', 'progress'],
    COMPLETED: ['Complete', 'done'],
    FAILED: ['Failed', 'failed'],
  };
  const [label, tone] = map[status] || [status, 'pending'];
  return <span className={`fxl-pipeline-badge fxl-pipeline-badge--${tone}`}>{label}</span>;
}

export default function PdfPipelineConvert() {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('en');
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [coordsOpen, setCoordsOpen] = useState(false);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  // Restore active job after refresh
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(PIPELINE_JOB_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.jobId) {
          setJobId(parsed.jobId);
          if (parsed.fileName) setTitle((t) => t || parsed.fileName.replace(/\.pdf$/i, ''));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(async (id) => {
    try {
      const data = await pdfPipelineService.getJob(id);
      setJob(data);
      if (data.status === 'COMPLETED') {
        stopPolling();
        try {
          const c = await pdfPipelineService.getCoords(id);
          setCoords(c);
        } catch {
          /* coords may lag slightly */
        }
      } else if (data.status === 'FAILED') {
        stopPolling();
        setError(data.error || 'Conversion failed.');
      }
    } catch (err) {
      stopPolling();
      setError(err.response?.data?.error || err.message || 'Failed to fetch job status.');
    }
  }, [stopPolling]);

  useEffect(() => {
    if (!jobId) return undefined;
    sessionStorage.setItem(PIPELINE_JOB_STORAGE_KEY, JSON.stringify({ jobId, fileName: file?.name }));
    if (job?.status === 'COMPLETED' || job?.status === 'FAILED') return undefined;

    pollJob(jobId);
    pollRef.current = setInterval(() => pollJob(jobId), POLL_MS);
    return () => stopPolling();
  }, [jobId, job?.status, pollJob, stopPolling, file?.name]);

  const validateAndSet = (f) => {
    setError('');
    if (!f) return;
    if (!f.type.includes('pdf') && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a valid PDF file.');
      return;
    }
    if (f.size > 500 * 1024 * 1024) {
      setError('File size must be under 500 MB.');
      return;
    }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConvert = async () => {
    if (!file) {
      setError('Select a PDF file first.');
      return;
    }
    setError('');
    setBusy(true);
    setCoords(null);
    setJob(null);
    stopPolling();

    try {
      const upload = await pdfPipelineService.uploadPdf(file);
      const id = upload.jobId;
      setJobId(id);

      await pdfPipelineService.convert({
        jobId: id,
        title: title || file.name.replace(/\.pdf$/i, ''),
        author: author || 'Unknown',
        language: language || 'en',
        splitPages: true,
      });

      setJob({ id, status: 'IN_PROGRESS', progress: 5, step: 'Starting conversion…' });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Conversion failed to start.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!jobId) return;
    setError('');
    setBusy(true);
    try {
      const { blob, filename } = await pdfPipelineService.downloadEpub(jobId);
      downloadBlob(blob, filename);
    } catch (err) {
      setError(err.message || 'Download failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    stopPolling();
    setJobId(null);
    setJob(null);
    setCoords(null);
    setError('');
    clearFile();
    sessionStorage.removeItem(PIPELINE_JOB_STORAGE_KEY);
  };

  const isConverting = job?.status === 'IN_PROGRESS' || busy;
  const isComplete = job?.status === 'COMPLETED';

  return (
    <div className="fxl-pipeline-page">
      <div className="pu-topbar">
        <div className="pu-topbar-left">
          <h1 className="pu-topbar-title">FXL Pipeline</h1>
          <span className="pu-step-badge">pdf2htmlEX</span>
        </div>
        <Link to="/pdfs/upload" className="fxl-pipeline-btn fxl-pipeline-btn--secondary">
          ← Upload library
        </Link>
      </div>

      <div className="fxl-pipeline-content">
        <div className="fxl-pipeline-card">
          <h2>
            <Layers size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            PDF → Fixed Layout EPUB
          </h2>
          <p>
            Converts PDF via pdf2htmlEX with stable <strong>word</strong> and <strong>sentence</strong> IDs
            for read-aloud sync, highlighting, and SMIL media overlays.
          </p>

          <ul className="fxl-pipeline-requirements">
            <li><Container size={16} /> Requires Docker with <code>guoxuequan/pdf2htmlex</code> image</li>
            <li><CheckCircle size={16} /> Word IDs: <code>word_000001</code> · Sentence IDs: <code>sentence_000001</code></li>
            <li><RefreshCw size={16} /> Supports single-column, two-column, and magazine layouts</li>
          </ul>
        </div>

        {error && (
          <div className="fxl-pipeline-error" role="alert">
            <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {error}
          </div>
        )}

        {isComplete && (
          <div className="fxl-pipeline-success" role="status">
            <CheckCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Conversion complete — download your EPUB or inspect coordinates below.
          </div>
        )}

        <div className="fxl-pipeline-card">
          <h2>1. Upload PDF</h2>
          <p>Select the source PDF. It is sent directly to the conversion pipeline (not the PDF library).</p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="pu-file-input"
            onChange={(e) => validateAndSet(e.target.files?.[0])}
            disabled={isConverting}
          />

          {!file ? (
            <div
              className={`pu-dropzone${dragOver ? ' pu-dropzone--over' : ''}`}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                validateAndSet(e.dataTransfer.files?.[0]);
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => !isConverting && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <Upload className="pu-dropzone-icon" />
              <p className="pu-dropzone-title">Drag &amp; drop PDF here</p>
              <p className="pu-dropzone-sub">or browse from your computer</p>
            </div>
          ) : (
            <div className="pu-file-preview">
              <span className="pu-file-preview-icon"><FileText size={22} /></span>
              <div className="pu-file-preview-info">
                <span className="pu-file-preview-name">{file.name}</span>
                <span className="pu-file-preview-size">{fmtSize(file.size)}</span>
              </div>
              {!isConverting && (
                <button type="button" className="pu-file-remove" onClick={clearFile} aria-label="Remove">
                  <X size={16} />
                </button>
              )}
            </div>
          )}

          <div className="fxl-pipeline-meta">
            <label>
              Book title
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My Book" disabled={isConverting} />
            </label>
            <label>
              Author
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author name" disabled={isConverting} />
            </label>
            <label>
              Language
              <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" disabled={isConverting} />
            </label>
          </div>

          <div className="fxl-pipeline-actions">
            <button
              type="button"
              className="fxl-pipeline-btn fxl-pipeline-btn--primary"
              onClick={handleConvert}
              disabled={!file || isConverting}
            >
              <RefreshCw size={16} className={isConverting ? 'spin' : ''} />
              {isConverting ? 'Converting…' : 'Start conversion'}
            </button>
            {(jobId || file) && !isConverting && (
              <button type="button" className="fxl-pipeline-btn fxl-pipeline-btn--secondary" onClick={handleReset}>
                New job
              </button>
            )}
          </div>
        </div>

        {job && (
          <div className="fxl-pipeline-card">
            <h2>
              2. Progress
              {' '}
              {statusBadge(job.status)}
            </h2>
            {jobId && (
              <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
                Job ID: <code>{jobId}</code>
              </p>
            )}

            <div className="fxl-pipeline-progress">
              <div className="fxl-pipeline-progress-bar-wrap">
                <div
                  className="fxl-pipeline-progress-bar"
                  style={{ width: `${Math.min(100, job.progress || 0)}%` }}
                />
              </div>
              <p className="fxl-pipeline-step">{job.step || 'Processing…'}</p>
            </div>

            {(job.pageCount != null || job.wordCount != null) && (
              <div className="fxl-pipeline-stats">
                {job.pageCount != null && (
                  <div className="fxl-pipeline-stat">
                    <strong>{job.pageCount}</strong>
                    <span>Pages</span>
                  </div>
                )}
                {job.wordCount != null && (
                  <div className="fxl-pipeline-stat">
                    <strong>{job.wordCount}</strong>
                    <span>Words</span>
                  </div>
                )}
                {job.sentenceCount != null && (
                  <div className="fxl-pipeline-stat">
                    <strong>{job.sentenceCount}</strong>
                    <span>Sentences</span>
                  </div>
                )}
              </div>
            )}

            {isComplete && (
              <div className="fxl-pipeline-actions">
                <button
                  type="button"
                  className="fxl-pipeline-btn fxl-pipeline-btn--primary"
                  onClick={handleDownload}
                  disabled={busy}
                >
                  <Download size={16} />
                  Download EPUB
                </button>
              </div>
            )}
          </div>
        )}

        {coords && (
          <div className="fxl-pipeline-card">
            <h2>3. Coordinates (coords.json)</h2>
            <p>Word and sentence IDs for highlighting and read-aloud synchronization.</p>
            <div className="fxl-pipeline-coords-preview">
              <button
                type="button"
                className="fxl-pipeline-coords-toggle"
                onClick={() => setCoordsOpen((o) => !o)}
              >
                Preview JSON
                {coordsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {coordsOpen && (
                <pre className="fxl-pipeline-coords-body">
                  {JSON.stringify(
                    {
                      pages: coords.pages?.length,
                      words: coords.words?.slice(0, 5),
                      sentences: coords.sentences?.slice(0, 3),
                      _note: `Showing sample of ${coords.words?.length} words, ${coords.sentences?.length} sentences`,
                    },
                    null,
                    2,
                  )}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
