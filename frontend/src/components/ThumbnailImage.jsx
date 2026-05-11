/**
 * ThumbnailImage
 *
 * Reusable PDF page-1 thumbnail component used across all job/PDF cards.
 * Fetches via Authorization header (no token in URL), caches with React Query,
 * shows a shimmer skeleton while loading, and a clean fallback on error.
 *
 * Props:
 *   pdfId      — number | string | null
 *   className  — extra CSS class on the <img> (optional)
 *   style      — inline styles (optional)
 *   alt        — alt text (default "")
 *   fallback   — React node shown on error (default: built-in placeholder)
 */

import { memo } from 'react';
import { FileText } from 'lucide-react';
import { useThumbnail } from '../hooks/useThumbnail';
import './ThumbnailImage.css';

const ThumbnailImage = memo(({
  pdfId,
  className = '',
  style,
  alt = '',
  fallback,
}) => {
  const { src, isLoading, isError } = useThumbnail(pdfId);

  if (!pdfId) return fallback ?? <DefaultFallback />;

  if (isLoading) {
    return (
      <div className={`thumb-skeleton ${className}`} style={style} aria-hidden="true">
        <div className="thumb-skeleton__shimmer" />
      </div>
    );
  }

  if (isError || !src) {
    return fallback ?? <DefaultFallback className={className} style={style} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`thumb-img ${className}`}
      style={style}
      draggable={false}
    />
  );
});

ThumbnailImage.displayName = 'ThumbnailImage';

const DefaultFallback = ({ className = '', style }) => (
  <div className={`thumb-fallback ${className}`} style={style} aria-hidden="true">
    <FileText size={32} />
  </div>
);

export default ThumbnailImage;
