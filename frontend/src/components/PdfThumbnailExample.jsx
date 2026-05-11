/**
 * PdfThumbnailExample — comprehensive usage examples
 *
 * Demonstrates all features of the PdfThumbnail component:
 * - Upload and instant preview
 * - Multiple file handling
 * - Caching
 * - Error handling
 * - Custom dimensions
 * - Loading states
 */

import { useState, useCallback } from 'react';
import PdfThumbnail from './PdfThumbnail';
import { Upload, X, FileText } from 'lucide-react';
import './PdfThumbnailExample.css';

const PdfThumbnailExample = () => {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);

  /* ── File upload handler ── */
  const handleFileChange = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    
    if (pdfFiles.length === 0) {
      alert('Please select PDF files only');
      return;
    }

    const newFiles = pdfFiles.map(file => ({
      id: `${file.name}-${file.size}-${Date.now()}`,
      file,
      name: file.name,
      size: file.size,
      uploadedAt: new Date(),
    }));

    setUploadedFiles(prev => [...prev, ...newFiles]);
  }, []);

  /* ── Drag and drop handlers ── */
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files || []);
    const pdfFiles = files.filter(f => f.type === 'application/pdf');

    if (pdfFiles.length === 0) {
      alert('Please drop PDF files only');
      return;
    }

    const newFiles = pdfFiles.map(file => ({
      id: `${file.name}-${file.size}-${Date.now()}`,
      file,
      name: file.name,
      size: file.size,
      uploadedAt: new Date(),
    }));

    setUploadedFiles(prev => [...prev, ...newFiles]);
  }, []);

  /* ── Remove file ── */
  const handleRemove = useCallback((id) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  /* ── Format file size ── */
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="pdf-thumb-example">
      <div className="pte-header">
        <h2 className="pte-title">PDF Thumbnail Generator</h2>
        <p className="pte-subtitle">
          Upload PDFs and see instant client-side thumbnails — no backend required
        </p>
      </div>

      {/* ── Upload zone ── */}
      <div
        className={`pte-upload-zone ${dragActive ? 'pte-upload-zone--active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id="pdf-upload"
          accept="application/pdf"
          multiple
          onChange={handleFileChange}
          className="pte-upload-input"
        />
        <label htmlFor="pdf-upload" className="pte-upload-label">
          <Upload size={32} className="pte-upload-icon" />
          <span className="pte-upload-text">
            {dragActive ? 'Drop PDFs here' : 'Click to upload or drag & drop'}
          </span>
          <span className="pte-upload-hint">PDF files only · Multiple files supported</span>
        </label>
      </div>

      {/* ── Uploaded files grid ── */}
      {uploadedFiles.length > 0 && (
        <div className="pte-grid">
          {uploadedFiles.map((item) => (
            <div key={item.id} className="pte-card">
              {/* Remove button */}
              <button
                className="pte-card-remove"
                onClick={() => handleRemove(item.id)}
                aria-label="Remove file"
              >
                <X size={14} />
              </button>

              {/* Thumbnail */}
              <div className="pte-card-thumb">
                <PdfThumbnail
                  file={item.file}
                  width={200}
                  height={280}
                  cacheKey={`pdf-thumb-${item.name}-${item.size}`}
                  onLoad={() => console.log(`Thumbnail loaded: ${item.name}`)}
                  onError={(err) => console.error(`Thumbnail error: ${item.name}`, err)}
                  fallback={
                    <div className="pte-card-fallback">
                      <FileText size={24} />
                      <span>Preview unavailable</span>
                    </div>
                  }
                />
              </div>

              {/* File info */}
              <div className="pte-card-info">
                <p className="pte-card-name" title={item.name}>
                  {item.name}
                </p>
                <p className="pte-card-meta">
                  {formatSize(item.size)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {uploadedFiles.length === 0 && (
        <div className="pte-empty">
          <FileText size={48} className="pte-empty-icon" />
          <p className="pte-empty-text">No PDFs uploaded yet</p>
          <p className="pte-empty-hint">Upload a PDF to see instant thumbnail generation</p>
        </div>
      )}

      {/* ── Feature list ── */}
      <div className="pte-features">
        <h3 className="pte-features-title">Features</h3>
        <ul className="pte-features-list">
          <li>✓ Client-side rendering with pdfjs-dist</li>
          <li>✓ No backend API required</li>
          <li>✓ Instant preview after upload</li>
          <li>✓ Automatic caching in localStorage</li>
          <li>✓ Memory-efficient with proper cleanup</li>
          <li>✓ Drag & drop support</li>
          <li>✓ Multiple file handling</li>
          <li>✓ Retina-ready (2× scale)</li>
        </ul>
      </div>
    </div>
  );
};

export default PdfThumbnailExample;
