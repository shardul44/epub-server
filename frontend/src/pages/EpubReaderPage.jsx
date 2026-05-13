import React from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ExternalLink, BookOpen } from 'lucide-react';
import SyncStudioEpubReader from '../components/SyncStudioEpubReader';
import './EpubReaderPage.css';

/**
 * Full-page EPUB player (epub.js). Opened from Sync Studio or FXL Sync Studio.
 * Renders inside the main Layout (with sidebar) — header matches FXL Sync Studio style.
 */
export default function EpubReaderPage() {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const rawSource = searchParams.get('source');
  const fixedLayout =
    searchParams.get('fixedLayout') === '1' || searchParams.get('fixedLayout') === 'true';
  // FXL reader links always send fixedLayout=1; tolerate bare /reader/epub/:id (e.g. old bookmarks).
  const source =
    rawSource === 'kitaboo'
      ? 'kitaboo'
      : rawSource === 'conversion'
        ? 'conversion'
        : fixedLayout
          ? 'kitaboo'
          : 'conversion';
  const spine = searchParams.get('spine') || undefined;
  const anchorId = searchParams.get('anchorId') || undefined;

  const backPath = source === 'kitaboo' ? `/fxl-sync-studio/${jobId}` : `/sync-studio/${jobId}`;
  const backLabel = source === 'kitaboo' ? 'Back to Zoning Studio' : 'Back to Sync Studio';

  const openInNewTab = () => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="erp-root">
      {/* ── Header — matches FXL Sync Studio style ── */}
      <header className="erp-header">
        <div className="erp-header-left">
          <button type="button" className="erp-btn-back" onClick={() => navigate(backPath)}>
            <ChevronLeft size={18} />
            {backLabel}
          </button>
          <h1 className="erp-title">
            <BookOpen size={18} className="erp-title-icon" />
            EPUB Reader
          </h1>
          <span className="erp-job-badge">Job #{jobId}</span>
          <span className={`erp-type-badge erp-type-badge--${source === 'kitaboo' ? 'fxl' : 'reflow'}`}>
            {source === 'kitaboo' ? 'FXL' : 'Reflowable'}
          </span>
        </div>
        <div className="erp-header-right">
          <button
            type="button"
            className="erp-btn-newtab"
            onClick={openInNewTab}
            title="Open this reader in a new browser tab"
          >
            <ExternalLink size={16} />
            Open in new tab
          </button>
        </div>
      </header>

      {/* ── Main reader area ── */}
      <div className="erp-body">
        <SyncStudioEpubReader
          jobId={jobId}
          spineHref={spine}
          anchorId={anchorId}
          epubSource={source}
          fixedLayout={fixedLayout}
        />
      </div>
    </div>
  );
}
