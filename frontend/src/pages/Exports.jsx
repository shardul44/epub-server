import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildEpubReaderPath } from '../utils/epubReaderUrl';
import { conversionService } from '../services/conversionService';
import api from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { useConversionsQuery } from '../hooks/queries/useConversionsQuery';
import { useListScope } from '../context/ListScopeContext';
import {
  Download,
  Search,
  FileText,
  ChevronDown,
  CheckCircle,
  Clock,
  Hourglass,
  AlertCircle,
  LayoutGrid,
  List,
} from 'lucide-react';
import ExportCard, { ExportGrid, ExportCardSkeleton } from '../components/ExportCard';
import { formatFileSize } from '../components/PdfCard';
import './Exports.css';

const STATUS_TABS = [
  { key: 'All',       label: 'All'       },
  { key: 'Completed', label: 'Completed' },
  { key: 'Rendering', label: 'Rendering' },
  { key: 'Queued',    label: 'Queued'    },
  { key: 'Failed',    label: 'Failed'    },
];

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

const SORT_OPTIONS = [
  { value: 'latest', label: 'Latest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name A–Z' },
];

const STAT_CARDS = [
  { key: 'total', label: 'Total Exports', icon: FileText, tone: 'blue' },
  { key: 'completed', label: 'Completed', icon: CheckCircle, tone: 'green' },
  { key: 'rendering', label: 'Rendering', icon: Clock, tone: 'orange' },
  { key: 'queued', label: 'Queued', icon: Hourglass, tone: 'purple' },
  { key: 'failed', label: 'Failed', icon: AlertCircle, tone: 'red' },
];

function jobSortTime(job) {
  const raw = job.completedAt ?? job.updatedAt ?? job.createdAt;
  return raw ? new Date(raw).getTime() : 0;
}

function jobTitle(job) {
  const name = String(job.originalFileName ?? job.pdfFilename ?? '');
  return name.replace(/\.(pdf|epub)$/i, '') || `Job #${job.id ?? job.jobId}`;
}

const Exports = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listScope = useListScope();

  const { jobs, isLoading: loading, error: fetchError } = useConversionsQuery({ statusFilter: 'all' });

  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('All Languages');
  const [searchField, setSearchField] = useState('all');
  const [searchFieldOpen, setSearchFieldOpen] = useState(false);
  const [sortBy, setSortBy] = useState('latest');
  const [viewMode, setViewMode] = useState('grid');

  const stats = useMemo(() => ({
    total: jobs.length,
    completed: jobs.filter((j) => j.status === 'COMPLETED').length,
    rendering: jobs.filter((j) => j.status === 'IN_PROGRESS').length,
    queued: jobs.filter((j) => j.status === 'PENDING').length,
    failed: jobs.filter((j) => ['FAILED', 'CANCELLED'].includes(j.status)).length,
  }), [jobs]);

  const tabCounts = useMemo(() => {
    const counts = {};
    STATUS_TABS.forEach((tab) => {
      const statuses = TAB_STATUS_MAP[tab.key];
      counts[tab.key] = statuses
        ? jobs.filter((j) => statuses.includes(j.status)).length
        : jobs.length;
    });
    return counts;
  }, [jobs]);

  const filtered = useMemo(() => {
    let list = jobs;

    const statuses = TAB_STATUS_MAP[activeTab];
    if (statuses) {
      list = list.filter((j) => statuses.includes(j.status));
    }

    if (language !== 'All Languages') {
      list = list.filter((j) => (j.language ?? 'English') === language);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((j) => {
        const id = String(j.id ?? j.jobId ?? '');
        const name = (j.originalFileName).toLowerCase();
        const owner = (j.ownerName ?? j.createdBy ?? j.owner ?? '').toLowerCase();
        if (searchField === 'title') return name.includes(q);
        if (searchField === 'owner') return owner.includes(q) || id.includes(q);
        return id.includes(q) || name.includes(q) || owner.includes(q);
      });
    }

    const sorted = [...list];
    if (sortBy === 'latest') {
      sorted.sort((a, b) => jobSortTime(b) - jobSortTime(a));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => jobSortTime(a) - jobSortTime(b));
    } else {
      sorted.sort((a, b) => jobTitle(a).localeCompare(jobTitle(b)));
    }

    return sorted;
  }, [jobs, activeTab, search, language, searchField, sortBy]);

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

  const handleViewDetails = (job) => {
    const jobId = job.id ?? job.jobId;
    if (job.status === 'COMPLETED') {
      if (job.jobType === 'FXL') {
        navigate(`/conversions/fxl-editor/${jobId}`);
      } else {
        navigate(`/image-editor/${jobId}`);
      }
      return;
    }
    navigate('/conversions', { state: { focusJobId: jobId } });
  };

  const handleDelete = async (job) => {
    const jobId = job.id ?? job.jobId;
    try {
      if (job.jobType === 'FXL') {
        try {
          await api.delete(`/kitaboo/jobs/${jobId}`);
        } catch (err) {
          if (err.response?.status !== 404) throw err;
        }
      } else {
        await conversionService.deleteConversionJob(jobId);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.conversions.all() });
    } catch (err) {
      setError(err.message || 'Failed to delete export');
    }
  };

  const handleCardClick = (job) => {
    if (job.status === 'COMPLETED') {
      handleViewDetails(job);
    }
  };

  const searchFieldRef = useRef(null);

  useEffect(() => {
    if (listScope === 'own' && searchField === 'owner') setSearchField('all');
  }, [listScope, searchField]);

  useEffect(() => {
    if (!searchFieldOpen) return undefined;
    const handler = (e) => {
      if (searchFieldRef.current && !searchFieldRef.current.contains(e.target)) {
        setSearchFieldOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchFieldOpen]);

  const SEARCH_FIELDS = [
    { key: 'all', label: 'Search All' },
    { key: 'title', label: 'Title' },
    ...(listScope === 'org' ? [{ key: 'owner', label: 'Owner' }] : []),
  ];

  const activeFieldLabel = SEARCH_FIELDS.find((f) => f.key === searchField)?.label ?? 'Title';

  const listLabel =
    activeTab === 'All'
      ? `All Exports · ${filtered.length} item${filtered.length === 1 ? '' : 's'}`
      : `${activeTab} · ${filtered.length} item${filtered.length === 1 ? '' : 's'}`;

  const copyJobId = useCallback(async (jobId) => {
    try {
      await navigator.clipboard.writeText(String(jobId));
    } catch {
      setError('Could not copy job ID.');
      setTimeout(() => setError(''), 4000);
    }
  }, []);

  return (
    <div className="exp-root">
      <header className="exp-page-header">
        <h1 className="exp-page-title">Exports</h1>
      </header>

      <div className="exp-page">
        {/* Stats strip */}
        <div className="exp-stats-bar">

          <div className="exp-stats-cards">
            {STAT_CARDS.map(({ key, label, icon: Icon, tone }) => (
              <div key={key} className={`exp-stat-card exp-stat-card--${tone}`}>
                <span className={`exp-stat-icon exp-stat-icon--${tone}`}>
                  <Icon size={18} />
                </span>
                <div className="exp-stat-body">
                  <span className="exp-stat-label">{label}</span>
                  <span className="exp-stat-value">
                    {loading ? '—' : stats[key]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Search + filters */}
        <div className="exp-toolbar">
          <div className="exp-search-group" ref={searchFieldRef}>
            <button
              type="button"
              className="exp-search-field-btn"
              onClick={() => setSearchFieldOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={searchFieldOpen}
            >
              <span>{activeFieldLabel}</span>
              <ChevronDown
                size={13}
                className={`exp-search-chevron${searchFieldOpen ? ' exp-search-chevron--open' : ''}`}
              />
            </button>
            {searchFieldOpen && (
              <div className="exp-search-field-dropdown" role="listbox">
                {SEARCH_FIELDS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="option"
                    aria-selected={searchField === f.key}
                    className={`exp-search-field-option${searchField === f.key ? ' exp-search-field-option--active' : ''}`}
                    onClick={() => {
                      setSearchField(f.key);
                      setSearchFieldOpen(false);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            <div className="exp-search-divider" />
            <div className="exp-search-box">
              <Search size={15} className="exp-search-icon" />
              <input
                type="search"
                className="exp-search-input"
                placeholder={`Search by ${activeFieldLabel.toLowerCase()}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search exports"
              />
              <kbd className="exp-search-kbd" aria-hidden="true">⌘ K</kbd>
            </div>
          </div>

          <div className="exp-tabs" role="tablist" aria-label="Filter by status">
            {STATUS_TABS.map((tab) => {
              const count = loading ? null : tabCounts[tab.key];
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  className={`exp-tab${activeTab === tab.key ? ' exp-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                  {count != null && <span className="exp-tab-paren"> ({count})</span>}
                </button>
              );
            })}
          </div>

          <select
            className="exp-lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Filter by language"
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        {(error || fetchError) && (
          <div className="exp-error" role="alert">
            {error || fetchError}
            <button
              type="button"
              className="exp-error-close"
              onClick={() => setError('')}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Grid toolbar */}
        {!loading && filtered.length > 0 && (
          <div className="exp-grid-bar">
            <p className="exp-grid-bar-label">{listLabel}</p>
            <div className="exp-grid-bar-right">
              <label className="exp-sort">
                Sort by:
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort exports"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <div className="exp-view-toggle">
                <button
                  type="button"
                  className={`exp-view-btn${viewMode === 'grid' ? ' exp-view-btn--active' : ''}`}
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                  aria-pressed={viewMode === 'grid'}
                >
                  <LayoutGrid size={17} />
                </button>
                <button
                  type="button"
                  className={`exp-view-btn${viewMode === 'list' ? ' exp-view-btn--active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title="List view"
                  aria-pressed={viewMode === 'list'}
                >
                  <List size={17} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main grid / list */}
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
              <h3>
                {search || activeTab !== 'All'
                  ? 'No exports match your filters'
                  : 'No exports yet'}
              </h3>
              <p>
                {search || activeTab !== 'All'
                  ? 'Try a different search or filter.'
                  : listScope === 'own'
                    ? 'Complete a conversion to see your EPUBs here, or upload a PDF to get started.'
                    : 'Your team has not completed any conversions yet.'}
              </p>
              {!search && activeTab === 'All' && (
                <button
                  type="button"
                  className="exp-empty-cta"
                  onClick={() => navigate('/pdfs/upload')}
                >
                  Upload PDF
                </button>
              )}
            </div>
          ) : viewMode === 'list' ? (
            <div className="exp-list">
              {filtered.map((job) => {
                const jobId = job.id ?? job.jobId;
                const title = jobTitle(job);
                const isFxl = job.jobType === 'FXL';
                const canDownload = job.status === 'COMPLETED';
                return (
                  <div key={`${job.jobType ?? 'REFLOW'}-${jobId}`} className="exp-list-row">
                    <div className="exp-list-main">
                      <span className="exp-list-title">{title}</span>
                      <span className="exp-list-meta">
                        Job #{jobId} · {isFxl ? 'FXL EPUB' : 'Reflow EPUB'}
                        {formatFileSize(job.fileSizeBytes ?? job.fileSize)
                          ? ` · ${formatFileSize(job.fileSizeBytes ?? job.fileSize)}`
                          : ''}
                      </span>
                    </div>
                    <span className={`exp-list-status exp-list-status--${(job.status || 'pending').toLowerCase()}`}>
                      {job.status === 'COMPLETED' ? 'Completed' : job.status === 'IN_PROGRESS' ? 'Rendering' : job.status === 'PENDING' ? 'Queued' : 'Failed'}
                    </span>
                    <div className="exp-list-actions">
                      {canDownload && (
                        <button type="button" className="exp-list-action" onClick={() => handleDownload(job)}>
                          Download
                        </button>
                      )}
                      <button type="button" className="exp-list-action" onClick={() => handleViewDetails(job)}>
                        Details
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <ExportGrid>
              {filtered.map((job) => (
                <ExportCard
                  key={`${job.jobType ?? 'REFLOW'}-${job.id ?? job.jobId}`}
                  job={job}
                  onClick={handleCardClick}
                  onDownload={() => handleDownload(job)}
                  onPreview={() => handlePreview(job)}
                  onViewDetails={() => handleViewDetails(job)}
                  onCopyJobId={() => copyJobId(job.id ?? job.jobId)}
                  onDelete={() => handleDelete(job)}
                />
              ))}
            </ExportGrid>
          )}
        </div>

      </div>
    </div>
  );
};

export default Exports;
