/**
 * PdfThumbnail — client-side PDF first-page thumbnail renderer
 *
 * Generates thumbnails in the browser using pdfjs-dist after fetching the PDF
 * bytes (e.g. GET …/pdfs/:id/view).
 *
 * Usage:
 *   <PdfThumbnail file={file} width={200} height={280} />
 *   <PdfThumbnail url="/path/to/file.pdf" width={200} height={280} />
 */

import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { generatePdfThumbnail } from '../utils/pdfThumbnail';
import './PdfThumbnail.css';

const PdfThumbnail = memo(({
  file,
  url,
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
  /** Called when the PDF URL returns 404 (no visible error state). */
  onAbsent,
}) => {
  const [thumbSrc, setThumbSrc]   = useState(null);
  const [status, setStatus]       = useState('idle'); // idle | loading | ready | error | absent
  const [errorMsg, setErrorMsg]   = useState('');
  const objectUrlRef              = useRef(null);
  const onLoadRef   = useRef(onLoad);
  const onErrorRef  = useRef(onError);
  const onAbsentRef = useRef(onAbsent);

  onLoadRef.current   = onLoad;
  onErrorRef.current  = onError;
  onAbsentRef.current = onAbsent;

  const fetchUrl = useMemo(() => (typeof url === 'string' && url ? url : null), [url]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    if (cacheKey) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setThumbSrc(cached);
          setStatus('ready');
          onLoadRef.current?.();
          return () => {
            cancelled = true;
            ac.abort();
          };
        }
      } catch (_) { /* ignore */ }
    }

    if (!file && !fetchUrl) {
      setStatus('idle');
      return () => {
        cancelled = true;
        ac.abort();
      };
    }

    setStatus('loading');
    setThumbSrc(null);
    setErrorMsg('');

    async function generate() {
      try {
        let pdfBlob;

        if (file) {
          pdfBlob = file;
        } else {
          const response = await fetch(fetchUrl, { signal: ac.signal });
          if (cancelled) return;
          if (!response.ok) {
            const err = new Error(`HTTP ${response.status}`);
            err.httpStatus = response.status;
            throw err;
          }

          // Content-Type sniff — if the server returned HTML/JSON (login page,
          // error envelope, redirect, etc.) treat it as "absent" rather than
          // letting pdfjs throw the noisy "Invalid PDF structure" exception.
          const ct = (response.headers.get('content-type') || '').toLowerCase();
          const ctLooksWrong =
            ct.includes('text/html') ||
            ct.includes('application/json') ||
            ct.includes('text/plain');

          pdfBlob = await response.blob();
          if (cancelled) return;

          // Empty body is never a PDF.
          if (!pdfBlob || pdfBlob.size === 0) {
            if (!cancelled) {
              setStatus('absent');
              onAbsentRef.current?.();
            }
            return;
          }

          // Magic-byte check: every PDF starts with "%PDF-".
          const head = await pdfBlob.slice(0, 5).arrayBuffer();
          const bytes = new Uint8Array(head);
          const isPdf =
            bytes.length >= 5 &&
            bytes[0] === 0x25 && // %
            bytes[1] === 0x50 && // P
            bytes[2] === 0x44 && // D
            bytes[3] === 0x46 && // F
            bytes[4] === 0x2d;   // -

          if (!isPdf || ctLooksWrong) {
            if (!cancelled) {
              setStatus('absent');
              onAbsentRef.current?.();
            }
            return;
          }
        }

        const dataUrl = await generatePdfThumbnail(pdfBlob, {
          width,
          height,
          scale,
          format,
          quality,
          pageNumber: 1,
        });

        if (cancelled) return;

        if (cacheKey) {
          try {
            localStorage.setItem(cacheKey, dataUrl);
          } catch (_) { /* storage full */ }
        }

        setThumbSrc(dataUrl);
        setStatus('ready');
        onLoadRef.current?.();
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return;

        const httpStatus = err?.response?.status ?? err?.httpStatus;
        const msg = String(err?.message || '');
        const errName = String(err?.name || '');
        const is404 = httpStatus === 404 || msg.includes('404');

        if (is404) {
          if (!cancelled) {
            setStatus('absent');
            onAbsentRef.current?.();
          }
          return;
        }

        // pdfjs-dist InvalidPDFException → not a real PDF on disk. Treat as
        // absent silently so we don't spam the console for legitimately
        // non-PDF assets (EPUB stubs, partial uploads, etc.).
        if (errName === 'InvalidPDFException' || msg.toLowerCase().includes('invalid pdf')) {
          if (!cancelled) {
            setStatus('absent');
            onAbsentRef.current?.();
          }
          return;
        }

        console.warn('[PdfThumbnail] thumbnail generation failed:', err);
        setErrorMsg(err.message || 'Failed to generate thumbnail');
        setStatus('error');
        onErrorRef.current?.(err);
      }
    }

    generate();

    return () => {
      cancelled = true;
      ac.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [file, fetchUrl, width, height, scale, format, quality, cacheKey]);

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
