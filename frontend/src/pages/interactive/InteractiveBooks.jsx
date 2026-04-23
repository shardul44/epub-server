import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { interactiveService } from '../../services/interactiveService';
import { useAuth } from '../../context/AuthContext';

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

export default function InteractiveBooks() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const canEdit = useMemo(() => user?.role === 'org_admin', [user]);

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

  useEffect(() => {
    refresh();
  }, []);

  async function createBook() {
    setError('');
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    try {
      await interactiveService.createBook({ title: title.trim(), description: description || null });
      setTitle('');
      setDescription('');
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to create book');
    }
  }

  async function exportEpub(book, interactiveEpub) {
    setBusyId(`${book.id}:${interactiveEpub ? 'js' : 'strict'}`);
    setError('');
    try {
      const blob = await interactiveService.exportEpub(book.id, { interactiveEpub });
      const safe = String(book.title || `book_${book.id}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .slice(0, 80) || `book_${book.id}`;
      const suffix = interactiveEpub ? 'interactive_js' : 'strict_fallback';
      downloadBlob(blob, `interactive_${book.id}_${safe}_${suffix}.epub`);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to export EPUB');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBook(book) {
    const ok = window.confirm(`Delete "${book.title}"? This will delete its chapters and blocks.`);
    if (!ok) return;
    setBusyId(book.id);
    setError('');
    try {
      await interactiveService.deleteBook(book.id);
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to delete book');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <div style={{ padding: 16, maxWidth: 1100 }}>
      <h2 style={{ marginTop: 0 }}>Interactive Books</h2>
      <div style={{ color: '#666', marginBottom: 12 }}>
        Kotobee-like interactive content. Web reader is interactive; EPUB export is fallback (non-interactive).
      </div>

      {error ? (
        <div style={{ background: '#fee', border: '1px solid #fbb', padding: 10, borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {canEdit ? (
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Create book</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            <input
              className="form-control"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="form-control"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
            <div>
              <button className="btn btn-primary" type="button" onClick={createBook}>
                Create
              </button>
              <button className="btn btn-secondary" type="button" onClick={refresh} style={{ marginLeft: 8 }}>
                Refresh
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 12, color: '#666' }}>
          You have read-only access.
        </div>
      )}

      <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #eee' }}>Title</th>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #eee' }}>Created</th>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #eee', width: 360 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {books.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 12, color: '#666' }}>
                  No books yet.
                </td>
              </tr>
            ) : (
              books.map((b) => (
                <tr key={b.id}>
                  <td style={{ padding: 10, borderBottom: '1px solid #f2f2f2' }}>
                    <div style={{ fontWeight: 650 }}>{b.title}</div>
                    {b.description ? <div style={{ color: '#666', fontSize: 13 }}>{b.description}</div> : null}
                  </td>
                  <td style={{ padding: 10, borderBottom: '1px solid #f2f2f2', color: '#666' }}>
                    {b.created_at ? new Date(b.created_at).toLocaleString() : ''}
                  </td>
                  <td style={{ padding: 10, borderBottom: '1px solid #f2f2f2' }}>
                    <Link className="btn btn-secondary" to={`/interactive/reader/${b.id}`}>
                      Read
                    </Link>
                    {canEdit ? (
                      <Link className="btn btn-primary" to={`/interactive/editor/${b.id}`} style={{ marginLeft: 8 }}>
                        Edit
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginLeft: 8 }}
                      onClick={() => exportEpub(b, false)}
                      disabled={busyId === `${b.id}:strict` || busyId === `${b.id}:js`}
                    >
                      {busyId === `${b.id}:strict` ? 'Exporting…' : 'Export EPUB (Strict)'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginLeft: 8 }}
                      onClick={() => exportEpub(b, true)}
                      disabled={busyId === `${b.id}:strict` || busyId === `${b.id}:js`}
                      title="Experimental: many EPUB readers block JavaScript"
                    >
                      {busyId === `${b.id}:js` ? 'Exporting…' : 'Export EPUB (JS Interactive)'}
                    </button>
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ marginLeft: 8 }}
                        onClick={() => deleteBook(b)}
                        disabled={busyId === b.id}
                      >
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

