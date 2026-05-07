import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  FileText,
  BookOpen,
  CheckCircle,
  Zap,
  Search,
  Eye,
  Pencil,
  Trash2,
  MoreVertical,
  Globe,
  Download,
  X,
} from 'lucide-react';
import { interactiveService } from '../../services/interactiveService';
import { useAuth } from '../../context/AuthContext';
import ConfirmModal from '../../components/Loadingmodal';
import './InteractiveBooks.css';

/* ─── helpers ─────────────────────────────────────────────── */
function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/* ─── StatCard ────────────────────────────────────────────── */
const StatCard = ({ icon, label, value, accent }) => (
  <div className="ib-stat-card" style={{ '--accent': accent }}>
    <div className="ib-stat-icon">{icon}</div>
    <div className="ib-stat-body">
      <span className="ib-stat-label">{label}</span>
      <span className="ib-stat-value">{value}</span>
    </div>
  </div>
);

/* ─── Row actions dropdown ────────────────────────────────── */
const RowMenu = ({ book, canEdit, onExport, onDelete, busyId }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="ib-row-menu" ref={ref}>
      <button
        className="ib-icon-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-haspopup="true"
        aria-expanded={open}
        title="More options"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="ib-dropdown" onClick={(e) => e.stopPropagation()}>
          <button className="ib-dropdown-item" onClick={() => { setOpen(false); onExport(book, false); }}>
            <Download size={15} /> Export EPUB (Strict)
          </button>
          <button className="ib-dropdown-item" onClick={() => { setOpen(false); onExport(book, true); }}>
            <Download size={15} /> Export EPUB (JS Interactive)
          </button>
          {canEdit && (
            <>
              <div className="ib-dropdown-divider" />
              <button
                className="ib-dropdown-item ib-dropdown-item--danger"
                onClick={() => { setOpen(false); onDelete(book); }}
                disabled={busyId === book.id}
              >
                <Trash2 size={15} /> Delete book
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Main page ───────────────────────────────────────────── */
export default function InteractiveBooks() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, book: null, loading: false });

  const canEdit = useMemo(() => user?.role === 'org_admin', [user]);

  /* derived stats */
  const totalBooks = books.length;
  const publishedBooks = books.filter((b) => b.status === 'published').length;
  const totalInteractions = books.reduce((s, b) => s + (b.interaction_count ?? b.interactions ?? 0), 0);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const rows = await interactiveService.listBooks();
      setBooks(rows);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load books');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function createBook() {
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    setCreating(true);
    try {
      await interactiveService.createBook({ title: title.trim(), description: description || null });
      setTitle('');
      setDescription('');
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to create book');
    } finally {
      setCreating(false);
    }
  }

  async function exportEpub(book, interactiveEpub) {
    const key = `${book.id}:${interactiveEpub ? 'js' : 'strict'}`;
    setBusyId(key);
    setError('');
    try {
      const blob = await interactiveService.exportEpub(book.id, { interactiveEpub });
      const safe = String(book.title || `book_${book.id}`)
        .trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 80) || `book_${book.id}`;
      const suffix = interactiveEpub ? 'interactive_js' : 'strict_fallback';
      downloadBlob(blob, `interactive_${book.id}_${safe}_${suffix}.epub`);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to export EPUB');
    } finally {
      setBusyId(null);
    }
  }

  function deleteBook(book) {
    setDeleteModal({ open: true, book, loading: false });
  }

  async function confirmDeleteBook() {
    const { book } = deleteModal;
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    setBusyId(book.id);
    setError('');
    try {
      await interactiveService.deleteBook(book.id);
      setDeleteModal({ open: false, book: null, loading: false });
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to delete book');
      setDeleteModal({ open: false, book: null, loading: false });
    } finally {
      setBusyId(null);
    }
  }

  const filtered = books.filter((b) =>
    !search || (b.title || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="ib-page">

      {/* ── Header ── */}
      <div className="ib-header">
        <div className="ib-header-left">
          <div className="ib-header-icon"><BookOpen size={22} /></div>
          <div>
            <h1 className="ib-title">Interactive Books</h1>
            <p className="ib-subtitle">
              Kotobee-like interactive content. Web reader is fully interactive; EPUB export is provided as a fallback (non-interactive).
            </p>
          </div>
        </div>
        <div className="ib-header-actions">
          <button className="ib-btn-secondary" onClick={refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'ib-spin' : ''} /> Refresh
          </button>
          {canEdit && (
            <button className="ib-btn-primary" onClick={() => document.getElementById('ib-create-section')?.scrollIntoView({ behavior: 'smooth' })}>
              <FileText size={15} /> New from template
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="ib-error">
          <span>{error}</span>
          <button className="ib-error-close" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="ib-stats">
        <StatCard
          icon={<BookOpen size={20} />}
          label="TOTAL BOOKS"
          value={loading ? '—' : totalBooks}
          accent="#6366f1"
        />
        <StatCard
          icon={<CheckCircle size={20} />}
          label="PUBLISHED"
          value={loading ? '—' : publishedBooks}
          accent="#10b981"
        />
        <StatCard
          icon={<Zap size={20} />}
          label="INTERACTIONS"
          value={loading ? '—' : totalInteractions.toLocaleString()}
          accent="#f59e0b"
        />
      </div>

      {/* ── Two-column layout ── */}
      <div className="ib-body">

        {/* ── Left column ── */}
        <div className="ib-main">

          {/* Create book form */}
          {canEdit && (
            <div className="ib-card" id="ib-create-section">
              <div className="ib-card-header">
                <div>
                  <div className="ib-card-title">Create book</div>
                  <div className="ib-card-subtitle">Start a new interactive book and add chapters next.</div>
                </div>
                <span className="ib-badge-draft">DRAFT</span>
              </div>

              <div className="ib-form-group">
                <label className="ib-label">Title <span className="ib-required">*</span></label>
                <input
                  className="ib-input"
                  placeholder="e.g. The Solar System — Interactive Edition"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createBook()}
                />
              </div>

              <div className="ib-form-group">
                <label className="ib-label">
                  Description <span className="ib-optional">Optional</span>
                </label>
                <textarea
                  className="ib-textarea"
                  placeholder="Briefly describe the book and its interactive features…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </div>

              <div className="ib-form-footer">
                <div className="ib-form-hints">
                  <span className="ib-hint-tag"><Globe size={12} /> Web reader interactive</span>
                  <span className="ib-hint-tag"><Download size={12} /> EPUB export fallback</span>
                </div>
                <div className="ib-form-btns">
                  <button
                    className="ib-btn-ghost"
                    type="button"
                    onClick={() => { setTitle(''); setDescription(''); setError(''); }}
                  >
                    Reset
                  </button>
                  <button
                    className="ib-btn-primary"
                    type="button"
                    onClick={createBook}
                    disabled={creating || !title.trim()}
                  >
                    {creating ? 'Creating…' : '+ Create book'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Books table */}
          <div className="ib-card ib-card--table">
            <div className="ib-table-header">
              <div>
                <div className="ib-card-title">Your books</div>
                <div className="ib-card-subtitle">{filtered.length} of {totalBooks} books</div>
              </div>
              <div className="ib-search-wrap">
                <Search className="ib-search-icon" size={14} />
                <input
                  className="ib-search"
                  placeholder="Search books…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {loading ? (
              <div className="ib-skeleton-rows">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="ib-skeleton-row">
                    <div style={{ flex: 1 }}>
                      <div className="ib-shimmer" style={{ width: '55%', height: 14, borderRadius: 6, marginBottom: 8 }} />
                      <div className="ib-shimmer" style={{ width: '35%', height: 11, borderRadius: 6 }} />
                    </div>
                    <div className="ib-shimmer" style={{ width: 80, height: 22, borderRadius: 20 }} />
                    <div className="ib-shimmer" style={{ width: 32, height: 14, borderRadius: 6 }} />
                    <div className="ib-shimmer" style={{ width: 32, height: 14, borderRadius: 6 }} />
                    <div className="ib-shimmer" style={{ width: 72, height: 14, borderRadius: 6 }} />
                    <div className="ib-shimmer" style={{ width: 96, height: 28, borderRadius: 8 }} />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="ib-empty">
                <BookOpen size={40} />
                <p>{search ? 'No books match your search.' : 'No books yet. Create your first one above.'}</p>
              </div>
            ) : (
              <table className="ib-table">
                <thead>
                  <tr>
                    <th>TITLE</th>
                    <th>STATUS</th>
                    <th>CHAPTERS</th>
                    <th>INTERACTIONS</th>
                    <th>CREATED</th>
                    <th className="ib-th-actions">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => {
                    const isPublished = b.status === 'published';
                    const chapters = b.chapter_count ?? b.chapters ?? 0;
                    const interactions = b.interaction_count ?? b.interactions ?? 0;
                    const isBusy = busyId === b.id || busyId === `${b.id}:strict` || busyId === `${b.id}:js`;

                    return (
                      <tr key={b.id} className={`ib-book-row${isBusy ? ' ib-row--busy' : ''}`}>
                        <td className="ib-td-title">
                          <div className="ib-book-title">{b.title}</div>
                          {b.description && (
                            <div className="ib-book-desc">{b.description}</div>
                          )}
                        </td>
                        <td className="ib-td-status">
                          <span className={`ib-status-badge ${isPublished ? 'ib-status-published' : 'ib-status-draft'}`}>
                            {isPublished
                              ? <><CheckCircle size={11} strokeWidth={2.5} /> PUBLISHED</>
                              : 'DRAFT'
                            }
                          </span>
                        </td>
                        <td className="ib-td-num">{chapters}</td>
                        <td className="ib-td-num">{interactions}</td>
                        <td className="ib-td-date">{fmtDate(b.created_at)}</td>
                        <td className="ib-td-actions">
                          <div className="ib-row-actions">
                            <Link
                              className="ib-action-icon"
                              to={`/interactive/reader/${b.id}`}
                              title="Preview"
                            >
                              <Eye size={15} />
                            </Link>
                            {canEdit && (
                              <Link
                                className="ib-action-icon"
                                to={`/interactive/editor/${b.id}`}
                                title="Edit"
                              >
                                <Pencil size={15} />
                              </Link>
                            )}
                            {canEdit && (
                              <button
                                className="ib-action-icon ib-action-icon--danger"
                                onClick={() => deleteBook(b)}
                                disabled={isBusy}
                                title="Delete"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                            <RowMenu
                              book={b}
                              canEdit={canEdit}
                              onExport={exportEpub}
                              onDelete={deleteBook}
                              busyId={busyId}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <aside className="ib-sidebar">

          {/* What's interactive */}
          <div className="ib-sidebar-card">
            <div className="ib-sidebar-title">What's interactive?</div>
            <ul className="ib-feature-list">
              {[
                'Quizzes with instant feedback',
                'Popovers, tooltips and glossaries',
                'Embedded audio & video clips',
                'Branching scenarios & bookmarks',
                'Notes, highlights and search',
              ].map((f) => (
                <li key={f}>
                  <span className="ib-feature-dot" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Web reader vs EPUB */}
          <div className="ib-sidebar-card ib-sidebar-card--blue">
            <div className="ib-sidebar-card-header">
              <Globe size={16} />
              <span className="ib-sidebar-title">Web reader vs EPUB</span>
            </div>
            <p className="ib-sidebar-text">
              The hosted web reader supports every interactive element. When you export to EPUB,
              interactive features fall back to static equivalents to remain compatible with all readers.
            </p>
          </div>

          {/* Tips */}
          <div className="ib-sidebar-card">
            <div className="ib-sidebar-title">Tips</div>
            <ol className="ib-tips-list">
              <li>Keep chapters under ~10k words for best reader performance.</li>
              <li>Add 2–3 interactions per chapter to boost engagement.</li>
              <li>Preview before publishing to test on mobile.</li>
            </ol>
          </div>

        </aside>
      </div>

      {/* ── Delete confirmation modal ── */}
      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, book: null, loading: false })}
        onConfirm={confirmDeleteBook}
        title="Confirm Deletion"
        subtitle="This action cannot be undone."
        message={
          deleteModal.book
            ? `Delete "${deleteModal.book.title}"? This will delete its chapters and blocks.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteModal.loading}
      />
    </div>
  );
}
