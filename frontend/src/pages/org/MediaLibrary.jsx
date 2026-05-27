import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Image,
  Search,
  Upload,
  Film,
  Music,
  MoreVertical,
  Download,
  Trash2,
  Eye,
  X,
  CloudUpload,
  LayoutGrid,
  List,
  RefreshCw,
  Heart,
} from 'lucide-react';
import { useMediaAssetsQuery } from '../../hooks/queries/useMediaAssetsQuery';
import { useMediaActions } from '../../hooks/useMediaActions';
import { useListScope } from '../../context/ListScopeContext';
import useAppDispatch from '../../hooks/useAppDispatch';
import useAppSelector from '../../hooks/useAppSelector';
import {
  selectMLViewMode,
  selectMLActiveTab,
  selectMLSearch,
  selectMLSort,
  selectMLShowUpload,
  selectMLUploadError,
  setViewMode,
  setActiveTab,
  setSearch,
  setSort,
  toggleUpload,
  setShowUpload,
  clearUploadError,
} from '../../features/mediaLibrary/mediaLibrarySlice';
import ConfirmModal from '../../components/Loadingmodal';
import './MediaLibrary.css';

/* ─── Asset type tabs ─────────────────────────────────────────── */
const TYPE_TABS = [
  { key: 'All',    label: 'All',    icon: null },
  { key: 'Images', label: 'Images', icon: <Image size={14} /> },
  { key: 'Videos', label: 'Videos', icon: <Film size={14} /> },
  { key: 'Audio',  label: 'Audio',  icon: <Music size={14} /> },
  { key: 'GIFs',   label: 'GIFs',   icon: <Image size={14} /> },
];

const SORT_OPTIONS = [
  { key: 'newest',   label: 'Newest first' },
  { key: 'oldest',   label: 'Oldest first' },
  { key: 'name_asc', label: 'Name A–Z' },
  { key: 'name_desc',label: 'Name Z–A' },
  { key: 'size_desc',label: 'Largest first' },
];

/* ─── Helpers ─────────────────────────────────────────────────── */
const fmtSize = (bytes) => {
  if (!bytes && bytes !== 0) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  const now  = new Date();
  const diff = now - date;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtCardDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const typeBadgeLabel = (type) => {
  switch (type) {
    case 'Images': return 'Image';
    case 'Videos': return 'Video';
    case 'GIFs':   return 'GIF';
    default:       return type;
  }
};

const getAssetType = (asset) => {
  const mime = (asset.mimeType || asset.type || '').toLowerCase();
  const name = (asset.filename || asset.name || '').toLowerCase();
  if (mime.startsWith('image/gif') || name.endsWith('.gif')) return 'GIFs';
  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|webp|svg|bmp|tiff)$/.test(name)) return 'Images';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/.test(name)) return 'Videos';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|aac|flac|m4a)$/.test(name)) return 'Audio';
  return 'Images'; // default fallback
};

const getTypeIcon = (type) => {
  switch (type) {
    case 'Videos': return <Film size={20} />;
    case 'Audio':  return <Music size={20} />;
    case 'GIFs':   return <Image size={20} />;
    default:       return <Image size={20} />;
  }
};

const THUMB_GRADIENTS = [
  'linear-gradient(165deg, #dceefb 0%, #cce8f6 50%, #b8dff0 100%)',
  'linear-gradient(165deg, #e0ecf8 0%, #d4e6f4 50%, #c5dff0 100%)',
  'linear-gradient(165deg, #d8eaf6 0%, #cae4f2 50%, #b6ddf0 100%)',
  'linear-gradient(165deg, #e4eef8 0%, #d6e8f4 50%, #c8e2f0 100%)',
];
const pickGradient = (id) => THUMB_GRADIENTS[(id ?? 0) % THUMB_GRADIENTS.length];

/* ─── Dot menu ────────────────────────────────────────────────── */
const MENU_WIDTH  = 152;
const MENU_HEIGHT = 112; // approx

const AssetMenu = ({ asset, onPreview, onDownload, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top: 0, left: 0 });
  const btnRef  = useRef(null);
  const menuRef = useRef(null);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        btnRef.current  && !btnRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', () => setOpen(false), true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', () => setOpen(false), true);
    };
  }, [open]);

  const handleToggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const rect       = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top        = spaceBelow < MENU_HEIGHT + 8
      ? rect.top - MENU_HEIGHT - 4
      : rect.bottom + 4;
    const left = Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8);
    setPos({ top, left });
    setOpen(true);
  };

  return (
    <div className="ml-dot-wrap" ref={btnRef}>
      <button
        className="ml-dot-btn"
        onClick={handleToggle}
        aria-label="More options"
        aria-expanded={open}
      >
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="ml-dot-menu"
          style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button className="ml-dot-item" role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onPreview?.(asset); }}>
            <Eye size={14} /> Preview
          </button>
          <button className="ml-dot-item" role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDownload?.(asset); }}>
            <Download size={14} /> Download
          </button>
          <button className="ml-dot-item ml-dot-item--danger" role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete?.(asset); }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};

/* ─── Asset Card (grid view) ──────────────────────────────────── */
const AssetCard = ({ asset, index, onPreview, onDownload, onDelete }) => {
  const [favorited, setFavorited] = useState(false);
  const type     = getAssetType(asset);
  const gradient = pickGradient(index);
  const name     = asset.filename || asset.name || `Asset #${asset.id}`;
  const size     = fmtSize(asset.fileSizeBytes ?? asset.fileSize ?? asset.size);
  const date     = fmtCardDate(asset.createdAt ?? asset.uploadedAt);
  const thumbUrl = asset.thumbnailUrl || asset.url;

  return (
    <article className="ml-card" aria-label={`Asset: ${name}`}>
      <div className="ml-card-thumb" style={{ background: gradient }}>
        {thumbUrl && (type === 'Images' || type === 'GIFs') ? (
          <img
            src={thumbUrl}
            alt=""
            className="ml-card-img"
            loading="lazy"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="ml-card-type-icon">{getTypeIcon(type)}</div>
        )}
        <div className="ml-card-thumb-actions">
          <button
            type="button"
            className="ml-card-del-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(asset);
            }}
            title="Delete asset"
            aria-label={`Delete ${name}`}
          >
            <Trash2 size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      <div className="ml-card-body">
        <h3 className="ml-card-title" title={name}>{name}</h3>
        <p className="ml-card-meta">
          <span>{size}</span>
          <span className="ml-card-dot" aria-hidden>·</span>
          <span>{date}</span>
        </p>
        <div className="ml-card-actions">
          <button
            type="button"
            className="ml-card-btn ml-card-btn--preview"
            onClick={() => onPreview?.(asset)}
          >
            <Eye size={15} strokeWidth={2} aria-hidden />
            Preview
          </button>
          <button
            type="button"
            className="ml-card-btn ml-card-btn--download"
            onClick={(e) => {
              e.stopPropagation();
              onDownload?.(asset);
            }}
          >
            <Download size={15} strokeWidth={2} aria-hidden />
            Download
          </button>
        </div>
      </div>
    </article>
  );
};

/* ─── Asset Row (list view) ───────────────────────────────────── */
const AssetRow = ({ asset, index, onPreview, onDownload, onDelete }) => {
  const type  = getAssetType(asset);
  const name  = asset.filename || asset.name || `Asset #${asset.id}`;
  const size  = fmtSize(asset.fileSizeBytes ?? asset.fileSize ?? asset.size);
  const date  = fmtDate(asset.createdAt ?? asset.uploadedAt);
  const thumbUrl = asset.thumbnailUrl || asset.url;
  const gradient = pickGradient(index);

  return (
    <div
      className="ml-row"
      role="button"
      tabIndex={0}
      onClick={() => onPreview?.(asset)}
      onKeyDown={(e) => e.key === 'Enter' && onPreview?.(asset)}
      aria-label={`Asset: ${name}`}
    >
      <div className="ml-row-thumb" style={{ background: gradient }}>
        {thumbUrl && (type === 'Images' || type === 'GIFs') ? (
          <img src={thumbUrl} alt={name} className="ml-row-img"
            loading="lazy"
            onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="ml-row-type-icon">{getTypeIcon(type)}</div>
        )}
      </div>
      <div className="ml-row-name">
        <span className="ml-row-title" title={name}>{name}</span>
        <span className="ml-row-type">{type}</span>
      </div>
      <div className="ml-row-size">{size}</div>
      <div className="ml-row-date">{date}</div>
      <div className="ml-row-actions">
        <AssetMenu asset={asset} onPreview={onPreview} onDownload={onDownload} onDelete={onDelete} />
      </div>
    </div>
  );
};

/* ─── Skeleton ────────────────────────────────────────────────── */
const CardSkeleton = () => (
  <div className="ml-skeleton" aria-hidden="true">
    <div className="ml-skeleton-thumb" />
    <div className="ml-skeleton-body">
      <div className="ml-skeleton-line" style={{ width: '78%' }} />
      <div className="ml-skeleton-line" style={{ width: '52%' }} />
      <div className="ml-skeleton-actions">
        <div className="ml-skeleton-btn" />
        <div className="ml-skeleton-btn ml-skeleton-btn--wide" />
      </div>
    </div>
  </div>
);

/* ─── Preview Modal ───────────────────────────────────────────── */
const PreviewModal = ({ asset, onClose }) => {
  const type = getAssetType(asset);
  const name = asset.filename || asset.name || 'Asset';
  const url  = asset.url || asset.thumbnailUrl;
  const size = fmtSize(asset.fileSizeBytes ?? asset.fileSize ?? asset.size);
  const date = fmtDate(asset.createdAt ?? asset.uploadedAt);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    // lock body scroll
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const typeColors = {
    Images: { bg: '#eff6ff', color: '#2563eb', icon: <Image size={14} /> },
    Videos: { bg: '#fdf4ff', color: '#9333ea', icon: <Film size={14} /> },
    Audio:  { bg: '#f0fdf4', color: '#16a34a', icon: <Music size={14} /> },
    GIFs:   { bg: '#fff7ed', color: '#ea580c', icon: <Image size={14} /> },
  };
  const tc = typeColors[type] || typeColors.Images;

  return createPortal(
    <div
      className="ml-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${name}`}
    >
      <div className="ml-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="ml-modal-header">
          <div className="ml-modal-header-left">
            <span className="ml-modal-type-chip" style={{ background: tc.bg, color: tc.color }}>
              {tc.icon} {type}
            </span>
            <span className="ml-modal-title" title={name}>{name}</span>
          </div>
          <div className="ml-modal-header-right">
           
            <button className="ml-modal-close" onClick={onClose} aria-label="Close preview">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Content area ── */}
        <div className="ml-modal-content">

          {/* Media viewer */}
          <div className="ml-modal-viewer">
            {url && (type === 'Images' || type === 'GIFs') ? (
              <>
                {!imgLoaded && <div className="ml-modal-img-skeleton" />}
                <img
                  src={url}
                  alt={name}
                  className={`ml-modal-img${imgLoaded ? ' ml-modal-img--loaded' : ''}`}
                  onLoad={() => setImgLoaded(true)}
                />
              </>
            ) : url && type === 'Videos' ? (
              <video src={url} controls className="ml-modal-video" />
            ) : url && type === 'Audio' ? (
              <div className="ml-modal-audio-wrap">
                <div className="ml-modal-audio-icon" style={{ background: tc.bg, color: tc.color }}>
                  <Music size={40} />
                </div>
                <p className="ml-modal-audio-name">{name}</p>
                <audio src={url} controls className="ml-modal-audio" />
              </div>
            ) : (
              <div className="ml-modal-no-preview">
                <div className="ml-modal-no-preview-icon" style={{ background: tc.bg, color: tc.color }}>
                  {getTypeIcon(type)}
                </div>
                <p>No preview available</p>
              </div>
            )}
          </div>

          {/* Info sidebar */}
          <div className="ml-modal-info">
            <p className="ml-modal-info-heading">File details</p>

            <div className="ml-modal-info-row">
              <span className="ml-modal-info-label">Name</span>
              <span className="ml-modal-info-value ml-modal-info-value--name">{name}</span>
            </div>
            <div className="ml-modal-info-row">
              <span className="ml-modal-info-label">Type</span>
              <span className="ml-modal-info-value">
                <span className="ml-modal-type-chip ml-modal-type-chip--sm" style={{ background: tc.bg, color: tc.color }}>
                  {tc.icon} {type}
                </span>
              </span>
            </div>
            <div className="ml-modal-info-row">
              <span className="ml-modal-info-label">Size</span>
              <span className="ml-modal-info-value">{size}</span>
            </div>
            <div className="ml-modal-info-row">
              <span className="ml-modal-info-label">Uploaded</span>
              <span className="ml-modal-info-value">{date}</span>
            </div>
            {asset.mimeType && (
              <div className="ml-modal-info-row">
                <span className="ml-modal-info-label">MIME</span>
                <span className="ml-modal-info-value ml-modal-info-value--mono">{asset.mimeType}</span>
              </div>
            )}

            {url && (
              <a
                href={url}
                download={name}
                className="ml-modal-dl-full"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <Download size={15} /> Download file
              </a>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};

/* ─── Upload Drop Zone ────────────────────────────────────────── */
const UploadZone = ({ onUpload, uploading }) => {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onUpload(files);
  };

  return (
    <div
      className={`ml-upload-zone${dragging ? ' ml-upload-zone--drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      aria-label="Upload assets"
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        className="ml-upload-input"
        onChange={(e) => { if (e.target.files?.length) onUpload(Array.from(e.target.files)); }}
      />
      <div className="ml-upload-icon">
        <CloudUpload size={28} />
      </div>
      <p className="ml-upload-text">
        {uploading ? 'Uploading…' : 'Drop files here or click to upload'}
      </p>
      <p className="ml-upload-sub">Images, Videos, Audio · Max 50 MB each</p>
    </div>
  );
};

/* ─── MediaLibrary page ───────────────────────────────────────── */
const MediaLibrary = () => {
  const dispatch = useAppDispatch();
  const listScope = useListScope();

  // ── Redux UI state ────────────────────────────────────────────
  const viewMode    = useAppSelector(selectMLViewMode);
  const activeTab   = useAppSelector(selectMLActiveTab);
  const search      = useAppSelector(selectMLSearch);
  const sort        = useAppSelector(selectMLSort);
  const showUpload  = useAppSelector(selectMLShowUpload);
  const uploadError = useAppSelector(selectMLUploadError);

  // ── Local UI state (ephemeral — not worth persisting) ─────────
  const [preview, setPreview]       = useState(null);
  const [uploading, setUploading]   = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, asset: null, loading: false });

  // ── React Query (server state) ────────────────────────────────
  const { assets, isLoading, error: fetchError, refresh } = useMediaAssetsQuery();

  // ── Action hook (upload / delete / download) ──────────────────
  const { handleUpload: runUpload, handleDelete: runDelete, handleDownload } = useMediaActions();

  const error = uploadError || fetchError;

  /* ── Tab counts ── */
  const tabCounts = useMemo(() => {
    const counts = { All: assets.length };
    ['Images', 'Videos', 'Audio', 'GIFs'].forEach((t) => {
      counts[t] = assets.filter((a) => getAssetType(a) === t).length;
    });
    return counts;
  }, [assets]);

  /* ── Filtered + sorted list ── */
  const filtered = useMemo(() => {
    let list = assets;

    if (activeTab !== 'All') {
      list = list.filter((a) => getAssetType(a) === activeTab);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        (a.filename || a.name || '').toLowerCase().includes(q)
      );
    }

    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'oldest':    return new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0);
        case 'name_asc':  return (a.filename || '').localeCompare(b.filename || '');
        case 'name_desc': return (b.filename || '').localeCompare(a.filename || '');
        case 'size_desc': return (b.fileSizeBytes ?? 0) - (a.fileSizeBytes ?? 0);
        default:          return new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
      }
    });

    return list;
  }, [assets, activeTab, search, sort]);

  /* ── Upload handler ── */
  const handleUpload = async (files) => {
    setUploading(true);
    dispatch(clearUploadError());
    await runUpload(files);
    setUploading(false);
    dispatch(setShowUpload(false));
  };

  /* ── Delete handler ── */
  const handleDelete = (asset) => {
    setDeleteModal({ open: true, asset, loading: false });
  };

  const confirmDelete = async () => {
    const { asset } = deleteModal;
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    await runDelete(asset);
    setDeleteModal({ open: false, asset: null, loading: false });
  };

  /* ── Render ── */
  return (
    <div className="ml-root">

      {/* ── Page header ── */}
      <header className="ml-page-header">
        <h1 className="ml-page-title">Media Library</h1>
      </header>

      {/* ── Section banner ── */}
      <div className="ml-section-inner">
        <div className="ml-section-icon">
          <Image size={20} />
        </div>
        <div className="ml-section-text">
          <h2 className="ml-section-title">Media Library</h2>
          <p className="ml-section-sub">
            {listScope === 'own'
              ? 'Browse and manage your uploaded assets'
              : 'Browse and manage media assets across your organization'}
          </p>
        </div>
        <button
          className="ml-upload-btn"
          onClick={() => dispatch(toggleUpload())}
          aria-label="Upload asset"
        >
          <Upload size={15} />
          Upload asset
        </button>
      </div>

      {/* ── Upload zone (collapsible) ── */}
      {showUpload && (
        <div className="ml-upload-panel">
          <UploadZone onUpload={handleUpload} uploading={uploading} />
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="ml-toolbar">
        {/* Search */}
        <div className="ml-search-box">
          <Search size={15} className="ml-search-icon" />
          <input
            type="search"
            className="ml-search-input"
            placeholder="Search assets…"
            value={search}
            onChange={(e) => dispatch(setSearch(e.target.value))}
            aria-label="Search assets"
          />
          {search && (
            <button className="ml-search-clear" onClick={() => dispatch(setSearch(''))} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Type tabs */}
        <div className="ml-tabs" role="tablist" aria-label="Filter by type">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`ml-tab${activeTab === tab.key ? ' ml-tab--active' : ''}`}
              onClick={() => dispatch(setActiveTab(tab.key))}
            >
              {tab.icon && <span className="ml-tab-icon">{tab.icon}</span>}
              {tab.label}
              {!isLoading && tabCounts[tab.key] > 0 && (
                <span className="ml-tab-count">{tabCounts[tab.key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Sort + view toggle */}
        <div className="ml-toolbar-right">
          <select
            className="ml-sort-select"
            value={sort}
            onChange={(e) => dispatch(setSort(e.target.value))}
            aria-label="Sort assets"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>

          <div className="ml-view-toggle" role="group" aria-label="View mode">
            <button
              className={`ml-view-btn${viewMode === 'grid' ? ' ml-view-btn--active' : ''}`}
              onClick={() => dispatch(setViewMode('grid'))}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`ml-view-btn${viewMode === 'list' ? ' ml-view-btn--active' : ''}`}
              onClick={() => dispatch(setViewMode('list'))}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <List size={16} />
            </button>
          </div>

          <button
            className="ml-refresh-btn"
            onClick={refresh}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="ml-error" role="alert">
          {error}
          <button className="ml-error-close" onClick={() => dispatch(clearUploadError())} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="ml-body">
        {isLoading ? (
          <div className="ml-grid">
            {Array.from({ length: 12 }, (_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="ml-empty">
            <div className="ml-empty-icon">
              <Image size={28} />
            </div>
            <p className="ml-empty-title">No assets found</p>
            <p className="ml-empty-sub">
              {search || activeTab !== 'All'
                ? 'Try adjusting your filters'
                : 'Upload your first asset to get started'}
            </p>
            {!search && activeTab === 'All' && (
              <button
                className="ml-empty-cta"
                onClick={() => dispatch(setShowUpload(true))}
              >
                <Upload size={15} /> Upload your first asset
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Count label */}
            <div className="ml-count-label">
              {activeTab === 'All' ? 'All assets' : activeTab}
              <span className="ml-count-num">· {filtered.length}</span>
            </div>

            {/* Grid view */}
            {viewMode === 'grid' && (
              <div className="ml-grid">
                {filtered.map((asset, i) => (
                  <AssetCard
                    key={asset.id ?? i}
                    asset={asset}
                    index={i}
                    onPreview={setPreview}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}

            {/* List view */}
            {viewMode === 'list' && (
              <div className="ml-list">
                <div className="ml-list-header">
                  <span className="ml-list-col ml-list-col--name">Name</span>
                  <span className="ml-list-col ml-list-col--size">Size</span>
                  <span className="ml-list-col ml-list-col--date">Uploaded</span>
                  <span className="ml-list-col ml-list-col--actions" />
                </div>
                {filtered.map((asset, i) => (
                  <AssetRow
                    key={asset.id ?? i}
                    asset={asset}
                    index={i}
                    onPreview={setPreview}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Preview modal ── */}
      {preview && (
        <PreviewModal asset={preview} onClose={() => setPreview(null)} />
      )}

      {/* ── Delete confirmation modal ── */}
      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, asset: null, loading: false })}
        onConfirm={confirmDelete}
        title="Confirm Deletion"
        subtitle="This action cannot be undone."
        message={
          deleteModal.asset
            ? `Delete "${deleteModal.asset.filename || deleteModal.asset.name}"? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteModal.loading}
      />
    </div>
  );
};

export default MediaLibrary;
