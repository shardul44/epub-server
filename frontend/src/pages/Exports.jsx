import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildEpubReaderPath } from '../utils/epubReaderUrl';
import { conversionService } from '../services/conversionService';
import api from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { useConversionsQuery } from '../hooks/queries/useConversionsQuery';
import {
  Download,
  Search,
  FileText,
  ChevronDown,
} from 'lucide-react';
import ExportCard, { ExportGrid, ExportCardSkeleton } from '../components/ExportCard';
import './Exports.css';

/* ─── Filter tabs ─────────────────────────────────────────────── */
const STATUS_TABS = [
  { key: 'All',       label: 'All'       },
  { key: 'Completed', label: 'Completed' },
  { key: 'Rendering', label: 'Rendering' },
  { key: 'Queued',    label: 'Queued'    },
  { key: 'Failed',    label: 'Failed'    },
];

/* Map UI tab key → raw job status values */
const TAB_STATUS_MAP = {
  All:       null,
  Completed: ['COMPLETED'],
  Rendering: ['IN_PROGRESS'],
  Queued:    ['PENDING'],
  Failed:    ['FAILED', 'CANCELLED'],
};

const LANGUAGE_OPTIONS = [
  'All Languages',
  'English',
  'French',
  'Spanish',
  'German',
  'Arabic',
];

/* ─── Exports page ────────────────────────────────────────────── */
const Exports = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Use React Query to fetch all jobs (replaces manual useEffect fetch)
  const { jobs, isLoading: loading, error: fetchError } = useConversionsQuery({ statusFilter: 'all' });

  const [error,     setError]     = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [search,    setSearch]    = useState('');
  const [language,  setLanguage]  = useState('All Languages');
  const [searchField, setSearchField] = useState('all');
  const [searchFieldOpen, setSearchFieldOpen] = useState(false);

  /* ── Per-tab counts (before search filter) ── */
  const tabCounts = useMemo(() => {
    const counts = {};
    STATUS_TABS.forEach(tab => {
      const statuses = TAB_STATUS_MAP[tab.key];
      counts[tab.key] = statuses
        ? jobs.filter(j => statuses.includes(j.status)).length
        : jobs.length;
    });
    return counts;
  }, [jobs]);

  /* ── Filtered list ── */
  const filtered = useMemo(() => {
    let list = jobs;

    const statuses = TAB_STATUS_MAP[activeTab];
    if (statuses) {
      list = list.filter(j => statuses.includes(j.status));
    }

    if (language !== 'All Languages') {
      list = list.filter(j => (j.language ?? 'English') === language);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(j => {
        const id   = String(j.id ?? j.jobId ?? '');
        const name = (j.pdfFilename ?? '').toLowerCase();
        const owner = (j.ownerName ?? j.createdBy ?? j.owner ?? '').toLowerCase();
        if (searchField === 'title') return name.includes(q);
        if (searchField === 'owner') return owner.includes(q) || id.includes(q);
        // 'all' — search everything
        return id.includes(q) || name.includes(q) || owner.includes(q);
      });
    }

    return list;
  }, [jobs, activeTab, search, language]);

  /* ── Actions ── */
  const handleDownload = async (job) => {
    const jobId = job.id ?? job.jobId;
    try {
      await conversionService.downloadEpub(jobId, { jobType: job.jobType });
    } catch {
      setError('Download failed. Please try again.');
    }
  };

  const handlePreview = (job) => {
    const jobId = job.id ?? job.jobId;
    const isFxl = job.jobType === 'FXL';
    navigate(
      buildEpubReaderPath(jobId, {
        source: isFxl ? 'kitaboo' : 'conversion',
        fixedLayout: isFxl,
      }),
    );
  };

  const handleDelete = async (job) => {
    const jobId = job.id ?? job.jobId;
    try {
      if (job.jobType === 'FXL') {
        try {
          await api.delete(`/kitaboo/jobs/${jobId}`);
        } catch (err) {
          if (err.response?.status !== 404) throw err;
          console.warn('Exports: FXL delete 404; treating as already removed.', jobId);
        }
      } else {
        await conversionService.deleteConversionJob(jobId);
      }
      // Invalidate React Query cache so next fetch returns fresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.conversions.all() });
    } catch (err) {
      setError(err.message || 'Failed to delete export');
    }
  };

  const handleCardClick = (job) => {
    const jobId = job.id ?? job.jobId;
    if (job.status === 'COMPLETED') {
      const path = job.jobType === 'FXL'
        ? `/conversions/fxl-editor/${jobId}`
        : `/image-editor/${jobId}`;
      navigate(path);
    }
  };

  const searchFieldRef = useRef(null);

  /* close dropdown on outside click */
  useEffect(() => {
    if (!searchFieldOpen) return;
    const handler = (e) => {
      if (searchFieldRef.current && !searchFieldRef.current.contains(e.target))
        setSearchFieldOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchFieldOpen]);

  const SEARCH_FIELDS = [
    { key: 'all',   label: 'Search All' },
    { key: 'title', label: 'Title'      },
    { key: 'owner', label: 'Owner'      },
  ];

  const activeFieldLabel = SEARCH_FIELDS.find(f => f.key === searchField)?.label ?? 'Title';

  const completedCount = jobs.filter(j => j.status === 'COMPLETED').length;

  /* ── Render ── */
  return (
    <div className="exp-root">

      {/* ── Page header ── */}
      <header className="exp-page-header">
        <h1 className="exp-page-title">Exports</h1>
      </header>

      {/* ── Section banner ── */}
      <div className="exp-section">
        <div className="exp-section-inner">
          <div className="exp-section-icon">
            <Download size={20} />
          </div>
          <div className="exp-section-text">
            <h2 className="exp-section-title">Your Exported EPUBs</h2>
            <p className="exp-section-sub">View and download your converted EPUB files</p>
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="exp-toolbar">
        {/* Search field selector + search box */}
        <div className="exp-search-group" ref={searchFieldRef}>
          {/* Field selector pill */}
          <button
            className="exp-search-field-btn"
            onClick={() => setSearchFieldOpen(v => !v)}
            aria-haspopup="listbox"
            aria-expanded={searchFieldOpen}
          >
            <span>{activeFieldLabel}</span>
            <ChevronDown size={13} className={`exp-search-chevron${searchFieldOpen ? ' exp-search-chevron--open' : ''}`} />
          </button>

          {/* Dropdown */}
          {searchFieldOpen && (
            <div className="exp-search-field-dropdown" role="listbox">
              {SEARCH_FIELDS.map(f => (
                <button
                  key={f.key}
                  role="option"
                  aria-selected={searchField === f.key}
                  className={`exp-search-field-option${searchField === f.key ? ' exp-search-field-option--active' : ''}`}
                  onClick={() => { setSearchField(f.key); setSearchFieldOpen(false); }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="exp-search-divider" />

          {/* Search input */}
          <div className="exp-search-box">
            <Search size={15} className="exp-search-icon" />
            <input
              type="search"
              className="exp-search-input"
              placeholder={`Search by ${activeFieldLabel.toLowerCase()}…`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search exports"
            />
          </div>
        </div>

        {/* Status tabs */}
        <div className="exp-tabs" role="tablist" aria-label="Filter by status">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`exp-tab${activeTab === tab.key ? ' exp-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {!loading && tabCounts[tab.key] > 0 && (
                <span className="exp-tab-count">{tabCounts[tab.key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Language filter */}
        <select
          className="exp-lang-select"
          value={language}
          onChange={e => setLanguage(e.target.value)}
          aria-label="Filter by language"
        >
          {LANGUAGE_OPTIONS.map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      {/* ── Error ── */}
      {(error || fetchError) && (
        <div className="exp-error" role="alert">
          {error || fetchError}
          <button
            className="exp-error-close"
            onClick={() => setError('')}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="exp-body">
        {loading ? (
          <ExportGrid>
            {Array.from({ length: 8 }, (_, i) => (
              <ExportCardSkeleton key={i} />
            ))}
          </ExportGrid>
        ) : filtered.length === 0 ? (
          <div className="exp-empty">
            <div className="exp-empty-icon">
              <FileText size={28} />
            </div>
            <p>
              {search || activeTab !== 'All'
                ? 'No exports match your filters'
                : 'No exports yet — complete a conversion to see your EPUBs here'}
            </p>
            {!search && activeTab === 'All' && (
              <button
                className="exp-empty-cta"
                onClick={() => navigate('/pdfs/upload')}
              >
                Upload a PDF to get started
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="exp-count-label">
              {activeTab === 'All'
                ? `All exports · ${filtered.length}`
                : `${activeTab} · ${filtered.length}`}
              {completedCount > 0 && activeTab === 'All' && (
                <span className="exp-completed-badge">
                  ✓ {completedCount} ready to download
                </span>
              )}
            </div>


            
            <ExportGrid>
              {filtered.map(job => (
                <ExportCard
                  key={`${job.jobType ?? 'REFLOW'}-${job.id ?? job.jobId}`}
                  job={job}
                  onClick={handleCardClick}
                  onDownload={() => handleDownload(job)}
                  onPreview={() => handlePreview(job)}
                  onDelete={() => handleDelete(job)}
                />
              ))}
            </ExportGrid>
          </>
        )}
      </div>
    </div>
  );
};

export default Exports;