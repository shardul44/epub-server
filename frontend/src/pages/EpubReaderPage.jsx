import React from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import SyncStudioEpubReader from '../components/SyncStudioEpubReader';
import './EpubReaderPage.css';

/**
 * Full-page EPUB player (epub.js). Opened from Sync Studio or FXL Sync Studio.
 */
export default function EpubReaderPage() {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const source = searchParams.get('source') === 'kitaboo' ? 'kitaboo' : 'conversion';
  const fixedLayout =
    searchParams.get('fixedLayout') === '1' || searchParams.get('fixedLayout') === 'true';
  const spine = searchParams.get('spine') || undefined;
  const anchorId = searchParams.get('anchorId') || undefined;

  const backPath = source === 'kitaboo' ? `/fxl-sync-studio/${jobId}` : `/sync-studio/${jobId}`;

  const openInNewTab = () => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="epub-reader-page">
      <header className="epub-reader-page-header">
        <button type="button" className="epub-reader-back" onClick={() => navigate(backPath)}>
          <ChevronLeft size={20} />
          {source === 'kitaboo' ? 'Back to FXL Sync Studio' : 'Back to Sync Studio'}
        </button>
        <div className="epub-reader-page-title">
          <span className="epub-reader-badge">{source === 'kitaboo' ? 'FXL' : 'Reflowable'}</span>
          <span className="epub-reader-job">Job {jobId}</span>
        </div>
        <button type="button" className="epub-reader-newtab" onClick={openInNewTab} title="Open this reader in a new browser tab">
          <ExternalLink size={18} />
          New tab
        </button>
      </header>
      <main className="epub-reader-page-main">
        <SyncStudioEpubReader
          jobId={jobId}
          spineHref={spine}
          anchorId={anchorId}
          epubSource={source}
          fixedLayout={fixedLayout}
        />
      </main>
    </div>
  );
}
