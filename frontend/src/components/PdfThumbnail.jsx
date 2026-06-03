/**
 * PdfThumbnail — client-side PDF first-page thumbnail renderer
 *
 * Generates thumbnails in the browser using pdfjs-dist after fetching the PDF
 * bytes (e.g. GET …/pdfs/:id/view). Uses in-memory + localStorage cache and
 * dedupes in-flight fetches so job-list polling does not re-download PDFs.
 *
 * Usage:
 *   <PdfThumbnail file={file} width={200} height={280} />
 *   <PdfThumbnail url="/path/to/file.pdf" pdfId={12} cacheKey="pdf-thumb-12" />
 */

import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { generatePdfThumbnail } from '../utils/pdfThumbnail';
import {
  getMemoryThumbnail,
  setMemoryThumbnail,
  fetchPdfViewBlobOnce,
  loadThumbnailDataUrlOnce,
} from '../lib/pdfThumbnailCache';
import './PdfThumbnail.css';

function readLocalThumbnail(cacheKey) {
  if (!cacheKey) return null;
  try {
    return localStorage.getItem(cacheKey);
  } catch {
    return null;
  }
}

function writeLocalThumbnail(cacheKey, dataUrl) {
  if (!cacheKey || !dataUrl) return;
  try {
    localStorage.setItem(cacheKey, dataUrl);
  } catch {
    /* storage full */
  }
}

const PdfThumbnail = memo(({
  file,
  url,
  pdfId,
  width  = 200,
  height = 280,
  scale   = 2,
  quality = 0.92,
  format  = 'image/png',
  cacheKey,
  className = '',
  alt       = 'PDF preview',
  fallback  = null,
  onLoad,
  onError,
  onAbsent,
  debugLabel,
}) => {
  const [thumbSrc, setThumbSrc]   = useState(null);
  const [status, setStatus]       = useState('idle');
  const [errorMsg, setErrorMsg]   = useState('');
  const objectUrlRef              = useRef(null);
  const onLoadRef   = useRef(onLoad);
  const onErrorRef  = useRef(onError);
  const onAbsentRef = useRef(onAbsent);

  onLoadRef.current   = onLoad;
  onErrorRef.current  = onError;
  onAbsentRef.current = onAbsent;

  const fetchUrl = useMemo(() => (typeof url === 'string' && url ? url : null), [url]);

  const storageKey = useMemo(() => {
    if (cacheKey) return cacheKey;
    if (pdfId != null && pdfId !== '') {
      return `pdf-thumb-${pdfId}-${width}x${height}@${scale}-${format}`;
    }
    return fetchUrl;
  }, [cacheKey, pdfId, fetchUrl, width, height, scale, format]);

  useEffect(() => {
    let cancelled = false;

    const applyReady = (dataUrl) => {
      if (cancelled || !dataUrl) return;
      setThumbSrc(dataUrl);
      setStatus('ready');
      onLoadRef.current?.();
    };

    const memoryHit = getMemoryThumbnail(storageKey);
    if (memoryHit) {
      applyReady(memoryHit);
      return () => {
        cancelled = true;
      };
    }

    const localHit = readLocalThumbnail(storageKey);
    if (localHit) {
      setMemoryThumbnail(storageKey, localHit);
      applyReady(localHit);
      return () => {
        cancelled = true;
      };
    }

    if (!file && !fetchUrl) {
      setStatus('idle');
      return () => {
        cancelled = true;
      };
    }

    setStatus('loading');
    setThumbSrc(null);
    setErrorMsg('');

    const renderOpts = { width, height, scale, format, quality, pageNumber: 1 };

    loadThumbnailDataUrlOnce(storageKey, async () => {
      let pdfBlob;

      if (file) {
        pdfBlob = file;
      } else {
        if (import.meta.env.DEV && debugLabel) {
          // eslint-disable-next-line no-console
          console.debug('[pdf-thumb] GET /pdfs/view', { pdfId, source: debugLabel });
        }
        pdfBlob = await fetchPdfViewBlobOnce(fetchUrl);
      }

      const dataUrl = await generatePdfThumbnail(pdfBlob, renderOpts);
      writeLocalThumbnail(storageKey, dataUrl);
      return dataUrl;
    })
      .then((dataUrl) => {
        if (cancelled) return;
        applyReady(dataUrl);
      })
      .catch((err) => {
        if (cancelled) return;

        const httpStatus = err?.response?.status ?? err?.httpStatus;
        const msg = String(err?.message || '');
        const errName = String(err?.name || '');
        const is404 = httpStatus === 404 || msg.includes('404');

        if (err?.code === 'NOT_PDF' || is404) {
          setStatus('absent');
          onAbsentRef.current?.();
          return;
        }

        if (errName === 'InvalidPDFException' || msg.toLowerCase().includes('invalid pdf')) {
          setStatus('absent');
          onAbsentRef.current?.();
          return;
        }

        console.warn('[PdfThumbnail] thumbnail generation failed:', err);
        setErrorMsg(err.message || 'Failed to generate thumbnail');
        setStatus('error');
        onErrorRef.current?.(err);
      });

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [file, fetchUrl, storageKey, width, height, scale, format, quality, pdfId, debugLabel]);

  if (status === 'absent') {
    if (fallback) return fallback;
    return (
      <div
        className={`pdf-thumb pdf-thumb--absent ${className}`}
        style={{ width, height }}
        role="img"
        aria-label={alt || 'Preview unavailable'}
      >
        <span className="pdf-thumb-absent-label">epub</span>
      </div>
    );
  }

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

  return (
    <img
      src={thumbSrc}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={`pdf-thumb pdf-thumb--ready ${className}`}
      draggable={false}
    />
  );
});

PdfThumbnail.displayName = 'PdfThumbnail';
export default PdfThumbnail;
