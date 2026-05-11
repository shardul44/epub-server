/**
 * PdfThumbnail — client-side PDF first-page thumbnail renderer
 *
 * Generates thumbnails entirely in the browser using pdfjs-dist.
 * No backend API call required.
 *
 * Usage:
 *   // From a File object (e.g. after upload)
 *   <PdfThumbnail file={file} width={200} height={280} />
 *
 *   // From a URL (fetches and renders client-side)
 *   <PdfThumbnail url="/path/to/file.pdf" width={200} height={280} />
 *
 *   // With custom fallback
 *   <PdfThumbnail file={file} fallback={<MyPlaceholder />} />
 */

import { useState, useEffect, useRef, memo } from 'react';
import { generatePdfThumbnail } from '../utils/pdfThumbnail';
import './PdfThumbnail.css';

/* ─── PdfThumbnail ────────────────────────────────────────────── */
const PdfThumbnail = memo(({
  // Source — provide one of these
  file,           // File | Blob — from <input type="file"> or drag-drop
  url,            // string — remote or local URL to fetch

  // Dimensions
  width  = 200,
  height = 280,

  // Rendering options
  scale   = 2,    // Render at 2× for crisp display on retina screens
  quality = 0.92, // JPEG quality (only used when format='image/jpeg')
  format  = 'image/png',

  // Caching — set a stable key to avoid re-rendering on re-mount
  cacheKey,

  // UI
  className = '',
  alt       = 'PDF preview',
  fallback  = null,   // React node shown on error
  onLoad,             // () => void
  onError,            // (error: Error) => void
}) => {
  const [thumbSrc, setThumbSrc]   = useState(null);
  const [status, setStatus]       = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [errorMsg, setErrorMsg]   = useState('');
  const objectUrlRef              = useRef(null);
  const cancelledRef              = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    // Check in-memory cache first (avoids re-generating on re-render)
    if (cacheKey) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setThumbSrc(cached);
          setStatus('ready');
          onLoad?.();
          return;
        }
      } catch (_) { /* ignore */ }
    }

    if (!file && !url) {
      setStatus('idle');
      return;
    }

    setStatus('loading');
    setThumbSrc(null);
    setErrorMsg('');

    async function generate() {
      try {
        let pdfBlob;

        if (file) {
          // Use the File/Blob directly
          pdfBlob = file;
        } else {
          // Fetch from URL — include auth token if present in the URL already
          // (the caller is responsible for appending ?token= if needed)
          const response = await fetch(url);
          if (!response.ok) {
            const err = new Error(`HTTP ${response.status}`);
            err.httpStatus = response.status;
            throw err;
          }
          pdfBlob = await response.blob();
        }

        const dataUrl = await generatePdfThumbnail(pdfBlob, {
          width,
          height,
          scale,
          format,
          quality,
          pageNumber: 1,
        });

        if (cancelledRef.current) return;

        // Cache the result
        if (cacheKey) {
          try { localStorage.setItem(cacheKey, dataUrl); } catch (_) { /* storage full */ }
        }

        setThumbSrc(dataUrl);
        setStatus('ready');
        onLoad?.();
      } catch (err) {
        if (cancelledRef.current) return;
        console.error('[PdfThumbnail] Error:', err);
        setErrorMsg(err.message || 'Failed to generate thumbnail');
        setStatus('error');
        onError?.(err);
      }
    }

    generate();

    return () => {
      cancelledRef.current = true;
      // Revoke any object URL we created
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [file, url, width, height, scale, format, quality, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Loading skeleton ── */
  if (status === 'loading' || status === 'idle') {
    return (
      <div
        className={`pdf-thumb pdf-thumb--loading ${className}`}
        style={{ width, height }}
        aria-label="Loading PDF preview"
        aria-busy="true"
      >
        <div className="pdf-thumb-shimmer" />
        <div className="pdf-thumb-loading-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (status === 'error') {
    if (fallback) return fallback;
    return (
      <div
        className={`pdf-thumb pdf-thumb--error ${className}`}
        style={{ width, height }}
        role="img"
        aria-label="PDF preview unavailable"
        title={errorMsg}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>No preview</span>
      </div>
    );
  }

  /* ── Thumbnail ready ── */
  return (
    <img
      src={thumbSrc}
      alt={alt}
      width={width}
      height={height}
      className={`pdf-thumb pdf-thumb--ready ${className}`}
      draggable={false}
    />
  );
});

PdfThumbnail.displayName = 'PdfThumbnail';
export default PdfThumbnail;
