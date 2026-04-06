import React, { useState } from 'react';
import api, { API_BASE_URL } from '../services/api';
import './EpubChecker.css';

const initialSummary = {
  totalViolations: 0,
  bySeverity: {
    critical: 0,
    serious: 0,
    moderate: 0,
  },
};

const EpubChecker = () => {
  const [file, setFile] = useState(null);
  const [summary, setSummary] = useState(initialSummary);
  const [metadata, setMetadata] = useState(null);
  const [reportUrl, setReportUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (event) => {
    const selected = event.target.files?.[0] || null;
    setError('');
    setSummary(initialSummary);
    setMetadata(null);
    setReportUrl('');

    if (selected && !selected.name.toLowerCase().endsWith('.epub')) {
      setError('Please select a valid .epub file.');
      setFile(null);
      return;
    }

    setFile(selected);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!file) {
      setError('Please select an EPUB file first.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      setLoading(true);

      const response = await api.post('/accessibility/check', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const data = response.data?.data || response.data;

      setJobId(data.jobId || '');
      setSummary(data.summary || initialSummary);
      setMetadata(data.metadata || null);
      setReportUrl(data.reportUrl || '');
    } catch (err) {
      console.error('Accessibility check failed:', err);
      const message =
        err.response?.data?.error ||
        err.message ||
        'Failed to analyze EPUB accessibility.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenReport = () => {
    if (reportUrl) {
      const backendBase = API_BASE_URL.replace(/\/api\/?$/, '');
      const absoluteUrl = reportUrl.startsWith('http')
        ? reportUrl
        : `${backendBase}${reportUrl}`;
      window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDownloadPdf = () => {
    if (!jobId) return;
    const backendBase = API_BASE_URL.replace(/\/api\/?$/, '');
    const url = `${backendBase}/api/accessibility/report/${jobId}/pdf`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="epub-checker-card">
      <h2 className="epub-checker-title">EPUB Accessibility Checker</h2>
      <p className="epub-checker-subtitle">
        Upload an EPUB file to run an accessibility analysis using DAISY Ace.
      </p>

      <form className="epub-checker-form" onSubmit={handleSubmit}>
        <div className="epub-checker-file-input">
          <label className="epub-checker-label" htmlFor="epub-file-input">
            Select EPUB file
          </label>
          <input
            id="epub-file-input"
            type="file"
            accept=".epub,application/epub+zip"
            onChange={handleFileChange}
            disabled={loading}
          />
          {file && (
            <div className="epub-checker-file-name">
              Selected: <span>{file.name}</span>
            </div>
          )}
        </div>

        {error && <div className="epub-checker-error">{error}</div>}

        <button
          type="submit"
          className="epub-checker-button"
          disabled={loading || !file}
        >
          {loading
            ? 'Analyzing Accessibility... this may take a moment'
            : 'Run Accessibility Check'}
        </button>
      </form>

      {(summary.totalViolations > 0 || metadata || reportUrl) && (
        <div className="epub-checker-results">
          <h3>Accessibility Summary</h3>

          {metadata && (
            <div className="epub-checker-metadata">
              {metadata.title && (
                <div>
                  <span className="epub-checker-meta-label">Title:</span>{' '}
                  <span>{metadata.title}</span>
                </div>
              )}
              {metadata.identifier && (
                <div>
                  <span className="epub-checker-meta-label">Identifier:</span>{' '}
                  <span>{metadata.identifier}</span>
                </div>
              )}
              {metadata.language && (
                <div>
                  <span className="epub-checker-meta-label">Language:</span>{' '}
                  <span>{metadata.language}</span>
                </div>
              )}
            </div>
          )}

          <div className="epub-checker-summary-grid">
            <div className="epub-checker-summary-card critical">
              <div className="label">Critical</div>
              <div className="value">
                {summary.bySeverity.critical ?? 0}
              </div>
            </div>
            <div className="epub-checker-summary-card serious">
              <div className="label">Serious</div>
              <div className="value">
                {summary.bySeverity.serious ?? 0}
              </div>
            </div>
            <div className="epub-checker-summary-card moderate">
              <div className="label">Moderate</div>
              <div className="value">
                {summary.bySeverity.moderate ?? 0}
              </div>
            </div>
          </div>

          {reportUrl && (
            <div className="epub-checker-actions">
              <button
                type="button"
                className="epub-checker-view-button"
                onClick={handleOpenReport}
              >
                View Full Report (HTML)
              </button>
              <button
                type="button"
                className="epub-checker-download-button"
                onClick={handleDownloadPdf}
              >
                Download PDF
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EpubChecker;

