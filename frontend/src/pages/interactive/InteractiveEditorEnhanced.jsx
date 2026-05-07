import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Eye,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  ListOrdered,
  Loader2,
  Music,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { interactiveService } from '../../services/interactiveService';
import CKEditorEnhanced from '../../components/interactive/CKEditorEnhanced';
import './InteractiveEditorEnhanced.css';

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
}

function getBlockContent(block) {
  return block.content_json ?? block.contentJson ?? {};
}

function blockPreview(block) {
  const j = getBlockContent(block);
  if (j == null) return '—';
  switch (block.type) {
    case 'text':
      return stripHtml(j.html) || 'Empty text';
    case 'image':
      return j.caption || j.alt || (typeof j.url === 'string' && j.url.startsWith('data:') ? 'Image (embedded)' : 'Image');
    case 'audio':
      return j.title || j.label || 'Audio block';
    case 'quiz':
      return j.title || j.question || 'Quiz';
    case 'dragdrop':
      return j.title || j.instruction || 'Drag & drop';
    default:
      try {
        return JSON.stringify(j).slice(0, 160);
      } catch {
        return String(block.type);
      }
  }
}

function BlockTypeIcon({ type }) {
  const common = { size: 18, strokeWidth: 2, 'aria-hidden': true };
  switch (type) {
    case 'text':
      return <FileText {...common} />;
    case 'image':
      return <ImageIcon {...common} />;
    case 'audio':
      return <Music {...common} />;
    case 'quiz':
      return <HelpCircle {...common} />;
    case 'dragdrop':
      return <Layers {...common} />;
    default:
      return <ListOrdered {...common} />;
  }
}

export default function InteractiveEditorEnhanced() {
  const { bookId } = useParams();
  const [loading, setLoading] = useState(true);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [error, setError] = useState('');
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [activeChapterId, setActiveChapterId] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [newChapterTitle, setNewChapterTitle] = useState('');

  useEffect(() => {
    loadBook();
  }, [bookId]);

  useEffect(() => {
    if (activeChapterId) {
      loadBlocks(activeChapterId);
    }
  }, [activeChapterId]);

  const sortedBlocks = useMemo(
    () => [...blocks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [blocks],
  );

  const activeChapter = useMemo(
    () => chapters.find((c) => c.id === activeChapterId) || null,
    [chapters, activeChapterId],
  );

  async function loadBook() {
    setLoading(true);
    setError('');
    try {
      const b = await interactiveService.getBook(bookId);
      const ch = await interactiveService.listChapters(bookId);
      setBook(b);
      setChapters(ch);
      setBlocks([]);
      if (ch.length === 0) {
        setActiveChapterId(null);
      } else {
        setActiveChapterId((prev) => (prev && ch.some((c) => c.id === prev) ? prev : ch[0].id));
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load book');
    } finally {
      setLoading(false);
    }
  }

  async function loadBlocks(chapterId) {
    if (!chapterId) {
      setBlocks([]);
      return;
    }
    setBlocksLoading(true);
    setError('');
    try {
      const bl = await interactiveService.listBlocks(chapterId);
      setBlocks(bl);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load blocks');
    } finally {
      setBlocksLoading(false);
    }
  }

  async function createChapter() {
    if (!newChapterTitle.trim()) {
      setError('Chapter title is required');
      return;
    }
    setError('');
    try {
      const position = chapters.length;
      const created = await interactiveService.createChapter(bookId, {
        title: newChapterTitle.trim(),
        position,
      });
      setNewChapterTitle('');
      setChapters([...chapters, created]);
      setActiveChapterId(created.id);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to create chapter');
    }
  }

  async function deleteChapter(chapterId) {
    const ch = chapters.find((c) => c.id === chapterId);
    if (!window.confirm(`Delete chapter "${ch?.title}"?`)) return;

    setError('');
    try {
      await interactiveService.deleteChapter(chapterId);
      const remaining = chapters.filter((c) => c.id !== chapterId);
      setChapters(remaining);
      if (activeChapterId === chapterId) {
        setActiveChapterId(remaining[0]?.id || null);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to delete chapter');
    }
  }

  async function handleAddBlock(blockData) {
    if (!activeChapterId) {
      setError('Please select a chapter first');
      return;
    }

    setError('');
    try {
      const position = blocks.length;
      let contentJson;

      if (blockData.type === 'text') {
        contentJson = { html: blockData.content };
      } else {
        contentJson = blockData.data;
      }

      await interactiveService.createBlock(activeChapterId, {
        type: blockData.type,
        contentJson,
        position,
      });

      await loadBlocks(activeChapterId);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to add block');
    }
  }

  async function deleteBlock(block) {
    if (!window.confirm(`Delete this ${block.type} block?`)) return;

    setError('');
    try {
      await interactiveService.deleteBlock(block.id);
      await loadBlocks(activeChapterId);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to delete block');
    }
  }

  if (loading) {
    return (
      <div className="iee-shell">
        <div className="iee-loading">
          <Loader2 size={40} strokeWidth={2.25} className="iee-spinner" aria-hidden />
          <p>Loading book…</p>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="iee-shell">
        <div className="iee-layout">
          <div className="iee-card" style={{ gridColumn: '1 / -1' }}>
            <p style={{ margin: 0, color: '#6b7280' }}>Book not found.</p>
            <Link to="/interactive" className="iee-back" style={{ marginTop: 12 }}>
              <ArrowLeft size={16} strokeWidth={2} aria-hidden /> Back to books
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="iee-shell">
      <header className="iee-header">
        <div className="iee-header-inner">
          <div>
            <Link to="/interactive" className="iee-back">
              <ArrowLeft size={16} strokeWidth={2} aria-hidden />
              Back to books
            </Link>
            <div className="iee-title-row">
              <div className="iee-title-icon" aria-hidden>
                <BookOpen size={22} strokeWidth={2} />
              </div>
              <div>
                <h1 className="iee-title">{book.title}</h1>
                <p className="iee-meta">
                  Interactive editor · {chapters.length} chapter{chapters.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </div>
          <div className="iee-header-actions">
            <Link to={`/interactive/reader/${book.id}`} className="iee-btn iee-btn-primary">
              <Eye size={18} strokeWidth={2} aria-hidden />
              Preview reader
            </Link>
          </div>
        </div>
      </header>

      {error && (
        <div className="iee-alert" role="alert">
          <div className="iee-alert-inner">
            <AlertCircle size={20} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="iee-layout">
        <aside className="iee-sidebar">
          <div className="iee-card">
            <h2 className="iee-card-title">Chapters</h2>

            <div className="iee-new-chapter">
              <input
                type="text"
                className="iee-input"
                placeholder="New chapter title…"
                value={newChapterTitle}
                onChange={(e) => setNewChapterTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createChapter();
                }}
                aria-label="New chapter title"
              />
              <button type="button" className="iee-btn iee-btn-primary" onClick={createChapter}>
                <Plus size={18} strokeWidth={2} aria-hidden />
                Add chapter
              </button>
            </div>

            {chapters.length === 0 ? (
              <div className="iee-empty-sidebar">No chapters yet — add one above.</div>
            ) : (
              <ul className="iee-chapter-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {chapters.map((ch, idx) => {
                  const isActive = ch.id === activeChapterId;
                  return (
                    <li key={ch.id} className="iee-chapter-wrap">
                      <button
                        type="button"
                        className={`iee-chapter-item${isActive ? ' is-active' : ''}`}
                        onClick={() => setActiveChapterId(ch.id)}
                        aria-current={isActive ? 'true' : undefined}
                      >
                        <div className="iee-chapter-body">
                          <div className="iee-chapter-name">{ch.title}</div>
                          <div className="iee-chapter-sub">Chapter {idx + 1}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="iee-chapter-delete"
                        title="Delete chapter"
                        aria-label={`Delete chapter ${ch.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteChapter(ch.id);
                        }}
                      >
                        <Trash2 size={18} strokeWidth={2} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <main className="iee-main-stack">
          {!activeChapterId ? (
            <div className="iee-card iee-empty-main">
              <div className="iee-empty-icon">
                <Layers size={32} strokeWidth={2} aria-hidden />
              </div>
              <h2>Choose a chapter</h2>
              <p>Create a chapter in the sidebar, then add text, quizzes, images, and more.</p>
            </div>
          ) : (
            <>
              <div className="iee-card">
                <div className="iee-editor-header">
                  <div>
                    <h2 className="iee-editor-heading">
                      <Sparkles size={22} strokeWidth={2} className="iee-heading-sparkles" aria-hidden />
                      Content for “{activeChapter?.title || 'Chapter'}”
                    </h2>
                    <span className="iee-badge">Block editor</span>
                  </div>
                </div>

                <section className="iee-blocks" aria-labelledby="blocks-heading">
                  <div className="iee-blocks-head">
                    <h3 id="blocks-heading" className="iee-blocks-title">
                      <Layers size={16} strokeWidth={2} aria-hidden />
                      Blocks on this page
                      {!blocksLoading && (
                        <span style={{ fontWeight: 600, color: '#6366f1' }}>({sortedBlocks.length})</span>
                      )}
                    </h3>
                  </div>
                  {blocksLoading ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '20px',
                        color: '#6b7280',
                        fontSize: 14,
                      }}
                    >
                      <Loader2 size={20} strokeWidth={2.25} className="iee-spinner" aria-hidden />
                      Loading blocks…
                    </div>
                  ) : sortedBlocks.length === 0 ? (
                    <div className="iee-empty-sidebar" style={{ textAlign: 'left' }}>
                      No blocks yet. Write below and use <strong>Add text block</strong> or the quiz / image / audio tools.
                    </div>
                  ) : (
                    <div className="iee-blocks-grid">
                      {sortedBlocks.map((block, index) => (
                        <div key={block.id} className="iee-block-row">
                          <div className="iee-block-icon" aria-hidden>
                            <BlockTypeIcon type={block.type} />
                          </div>
                          <div className="iee-block-body">
                            <div className="iee-block-type">
                              {block.type} · #{index + 1}
                            </div>
                            <div className="iee-block-preview">{blockPreview(block)}</div>
                          </div>
                          <div className="iee-block-actions">
                            <button
                              type="button"
                              className="iee-btn iee-btn-danger"
                              title="Delete block"
                              onClick={() => deleteBlock(block)}
                            >
                              <Trash2 size={16} strokeWidth={2} aria-hidden />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <CKEditorEnhanced onAddBlock={handleAddBlock} />

                <div className="iee-tip" style={{ marginTop: 24 }}>
                  <div className="iee-tip-icon" aria-hidden>
                    <Eye size={20} strokeWidth={2} aria-hidden />
                  </div>
                  <div>
                    <h4>Preview your lesson</h4>
                    <p>
                      Use <strong>Preview reader</strong> in the header to see how blocks render with all interactive
                      elements.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
