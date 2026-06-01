import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Puzzle,
  Eye,
  FileText,
  GripVertical,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Loader2,
  Music,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { SortableItem } from '../../components/SortableItem';
import { interactiveService } from '../../services/interactiveService';
import InteractiveContentSidebar from '../../components/interactive/h5p/InteractiveContentSidebar';
import H5pEditorDialog from '../../components/interactive/h5p/H5pEditorDialog';
import H5pBlockCard from '../../components/interactive/h5p/H5pBlockCard';
import H5pFixedLayoutDialog from '../../components/interactive/h5p/H5pFixedLayoutDialog';
import ReaderCompatibilityBanner from '../../components/interactive/h5p/ReaderCompatibilityBanner';
import TextBlockEditDialog from '../../components/interactive/TextBlockEditDialog';
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
    case 'h5p':
      return j.title || j.displayTitle || j.libraryName || 'H5P activity';
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
    case 'h5p':
      return <Puzzle {...common} />;
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
  const [chapterSearch, setChapterSearch] = useState('');
  const [renamingChapterId, setRenamingChapterId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [creatingChapter, setCreatingChapter] = useState(false);
  const renameInputRef = useRef(null);
  const [h5pEditorOpen, setH5pEditorOpen] = useState(false);
  const [h5pContentType, setH5pContentType] = useState(null);
  const [editingH5pBlock, setEditingH5pBlock] = useState(null);
  const [textEditOpen, setTextEditOpen] = useState(false);
  const [editingTextBlock, setEditingTextBlock] = useState(null);
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false);
  const [pendingH5pSave, setPendingH5pSave] = useState(null);
  const [reordering, setReordering] = useState(false);

  const bookLayoutMode = useMemo(() => {
    const meta = book?.metadata_json ?? book?.metadataJson ?? {};
    return meta.layoutMode === 'fixed' ? 'fixed' : 'reflow';
  }, [book]);

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

  const filteredChapters = useMemo(() => {
    const q = chapterSearch.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter((ch) => ch.title?.toLowerCase().includes(q));
  }, [chapters, chapterSearch]);

  useEffect(() => {
    if (renamingChapterId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChapterId]);

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
    setError('');
    setCreatingChapter(true);
    try {
      const position = chapters.length;
      const defaultTitle = `Chapter ${chapters.length + 1}`;
      const created = await interactiveService.createChapter(bookId, {
        title: defaultTitle,
        position,
      });
      setChapters([...chapters, created]);
      setActiveChapterId(created.id);
      setRenamingChapterId(created.id);
      setRenameDraft(defaultTitle);
      setChapterSearch('');
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to create chapter');
    } finally {
      setCreatingChapter(false);
    }
  }

  async function saveChapterTitle(chapterId, title) {
    const ch = chapters.find((c) => c.id === chapterId);
    const index = chapters.findIndex((c) => c.id === chapterId);
    const trimmed = title.trim() || `Chapter ${index + 1}`;
    setError('');
    try {
      const updated = await interactiveService.updateChapter(chapterId, { title: trimmed });
      setChapters(chapters.map((c) => (c.id === chapterId ? { ...c, ...updated, title: trimmed } : c)));
      setRenamingChapterId(null);
      setRenameDraft('');
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to rename chapter');
      if (ch) setRenameDraft(ch.title);
    }
  }

  function cancelChapterRename() {
    setRenamingChapterId(null);
    setRenameDraft('');
  }

  function startChapterRename(chapterId, e) {
    e?.stopPropagation?.();
    const ch = chapters.find((c) => c.id === chapterId);
    if (!ch) return;
    setRenamingChapterId(chapterId);
    setRenameDraft(ch.title || '');
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

  async function duplicateBlock(block) {
    setError('');
    try {
      await interactiveService.duplicateBlock(block.id);
      await loadBlocks(activeChapterId);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to duplicate block');
    }
  }

  function openH5pEditor(contentType, block = null) {
    setH5pContentType(contentType);
    setEditingH5pBlock(block);
    setH5pEditorOpen(true);
  }

  async function insertH5pBlock(saved, layout = null) {
    const c = editingH5pBlock?.content_json ?? {};
    const contentJson = {
      // Keep JSON in sync with relational link used by blocks.
      h5pContentId: saved.dbId ?? saved.h5pContentId,
      title: saved.title,
      libraryName: saved.libraryName,
      machineName: saved.libraryName,
      categoryLabel: h5pContentType?.categoryLabel,
      layout: layout || c.layout || { mode: bookLayoutMode === 'fixed' ? 'fixed' : 'reflow' }
    };
    const layoutJson = layout || (bookLayoutMode === 'fixed' ? contentJson.layout : null);

    if (editingH5pBlock) {
      await interactiveService.updateBlock(editingH5pBlock.id, {
        contentJson,
        h5pContentId: saved.dbId,
        layoutJson
      });
    } else {
      await interactiveService.createBlock(activeChapterId, {
        type: 'h5p',
        contentJson,
        h5pContentId: saved.dbId,
        layoutJson,
        position: blocks.length
      });
    }
    await loadBlocks(activeChapterId);
    setEditingH5pBlock(null);
  }

  function handleH5pSaved(saved) {
    if (bookLayoutMode === 'fixed' && !editingH5pBlock) {
      setPendingH5pSave(saved);
      setLayoutDialogOpen(true);
      return;
    }
    void insertH5pBlock(saved);
  }

  async function handleLayoutConfirm(layout) {
    setLayoutDialogOpen(false);
    if (pendingH5pSave) {
      await insertH5pBlock(pendingH5pSave, { mode: 'fixed', ...layout });
      setPendingH5pSave(null);
    }
  }

  async function handleBlockDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedBlocks.findIndex((b) => b.id === active.id);
    const newIndex = sortedBlocks.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(sortedBlocks, oldIndex, newIndex);
    setBlocks(reordered);
    setReordering(true);
    try {
      await interactiveService.reorderBlocks(
        activeChapterId,
        reordered.map((b) => b.id)
      );
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to reorder blocks');
      await loadBlocks(activeChapterId);
    } finally {
      setReordering(false);
    }
  }

  function editH5pBlock(block) {
    const c = getBlockContent(block);
    openH5pEditor(
      {
        label: c.title || 'H5P',
        machineName: c.libraryName || c.machineName,
        categoryLabel: c.categoryLabel
      },
      block
    );
  }

  function editTextBlock(block) {
    setEditingTextBlock(block);
    setTextEditOpen(true);
  }

  function openNewTextBlock() {
    setEditingTextBlock(null);
    setTextEditOpen(true);
  }

  function handleActivitySelect(type) {
    if (type.nativeType === 'text') {
      openNewTextBlock();
      return;
    }
    openH5pEditor(type);
  }

  async function saveTextBlock(html) {
    const trimmed = (html || '').trim();
    const empty = !trimmed || trimmed === '<p></p>' || trimmed === '<p>&nbsp;</p>';

    if (editingTextBlock) {
      const prev = getBlockContent(editingTextBlock);
      await interactiveService.updateBlock(editingTextBlock.id, {
        contentJson: { ...prev, html },
      });
      await loadBlocks(activeChapterId);
      return;
    }

    if (empty) {
      throw new Error('Add some text before saving the block.');
    }
    await handleAddBlock({ type: 'text', content: html });
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
          <div className="iee-panel" style={{ gridColumn: '1 / -1' }}>
            <p style={{ margin: 0, color: 'var(--iee-muted)' }}>Book not found.</p>
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
                  <span>Interactive editor</span>
                  <span className="iee-meta-dot" aria-hidden />
                  <span>
                    {chapters.length} chapter{chapters.length === 1 ? '' : 's'}
                  </span>
                </p>
              </div>
            </div>
          </div>
          <div className="irr-header-actions">
            <Link to="/interactive" className="irr-btn irr-btn-secondary">
              <ArrowLeft size={18} strokeWidth={2} aria-hidden />
              Back to books
            </Link>
            <Link to={`/interactive/reader/${book.id}`} className="irr-btn irr-btn-primary">
              <Eye size={18} strokeWidth={2} aria-hidden />
              Preview reader
            </Link>
          </div>
        </div>
      </header>

      <div className="iee-scroll">
        {error && (
          <div className="iee-alert" role="alert">
            <div className="iee-alert-inner">
              <AlertCircle size={20} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="iee-layout iee-layout--studio">
        <aside className="iee-sidebar" aria-label="Chapters">
          <div className="iee-panel">
            <div className="iee-panel__head">
              <h2 className="iee-panel__title">Chapters</h2>
              <p className="iee-panel__subtitle">Structure your book into lessons.</p>
            </div>
            <div className="iee-panel__body">
              <div className="iee-chapter-toolbar">
                <button
                  type="button"
                  className="iee-btn iee-btn-primary iee-btn-block"
                  onClick={createChapter}
                  disabled={creatingChapter}
                >
                  {creatingChapter ? (
                    <Loader2 size={18} strokeWidth={2} className="iee-spinner" aria-hidden />
                  ) : (
                    <Plus size={18} strokeWidth={2} aria-hidden />
                  )}
                  Add chapter
                </button>
                <div className="iee-chapter-search-wrap">
                  <Search size={16} strokeWidth={2} className="iee-chapter-search-icon" aria-hidden />
                  <input
                    type="search"
                    className="iee-chapter-search"
                    placeholder="Search chapters…"
                    value={chapterSearch}
                    onChange={(e) => setChapterSearch(e.target.value)}
                    aria-label="Search chapters"
                  />
                </div>
              </div>

              {chapters.length === 0 ? (
                <div className="iee-empty-sidebar">No chapters yet — click Add chapter to start.</div>
              ) : filteredChapters.length === 0 ? (
                <div className="iee-empty-sidebar">No chapters match your search.</div>
              ) : (
                <ul className="iee-chapter-list">
                  {filteredChapters.map((ch) => {
                    const idx = chapters.findIndex((c) => c.id === ch.id);
                    const isActive = ch.id === activeChapterId;
                    const isRenaming = renamingChapterId === ch.id;
                    return (
                      <li key={ch.id} className="iee-chapter-wrap">
                        <div
                          className={`iee-chapter-item${isActive ? ' is-active' : ''}${isRenaming ? ' is-renaming' : ''}`}
                          role="button"
                          tabIndex={isRenaming ? -1 : 0}
                          onClick={() => {
                            if (!isRenaming) setActiveChapterId(ch.id);
                          }}
                          onKeyDown={(e) => {
                            if (isRenaming) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setActiveChapterId(ch.id);
                            }
                          }}
                          aria-current={isActive ? 'true' : undefined}
                        >
                          <span className="iee-chapter-num">{idx + 1}</span>
                          <div className="iee-chapter-body">
                            {isRenaming ? (
                              <input
                                ref={renameInputRef}
                                type="text"
                                className="iee-chapter-rename-input"
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void saveChapterTitle(ch.id, renameDraft);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelChapterRename();
                                  }
                                }}
                                onBlur={() => {
                                  void saveChapterTitle(ch.id, renameDraft);
                                }}
                                aria-label="Chapter name"
                              />
                            ) : (
                              <div
                                className="iee-chapter-name"
                                onDoubleClick={(e) => startChapterRename(ch.id, e)}
                                title="Double-click to rename"
                              >
                                {ch.title}
                              </div>
                            )}
                            <div className="iee-chapter-sub">
                              {isActive
                                ? `${sortedBlocks.length} block${sortedBlocks.length === 1 ? '' : 's'}`
                                : 'Chapter'}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="iee-chapter-delete"
                          title="Delete chapter"
                          aria-label={`Delete chapter ${ch.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (renamingChapterId === ch.id) cancelChapterRename();
                            deleteChapter(ch.id);
                          }}
                        >
                          <Trash2 size={16} strokeWidth={2} aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </aside>

        <main className="iee-main-stack">
          {!activeChapterId ? (
            <div className="iee-panel iee-empty-main">
              <div className="iee-empty-icon">
                <Layers size={32} strokeWidth={2} aria-hidden />
              </div>
              <h2>Choose a chapter</h2>
              <p>Create a chapter on the left, then add text, media, quizzes, and H5P activities.</p>
            </div>
          ) : (
            <div className="iee-panel">
              <header className="iee-chapter-bar">
                <div>
                  <h2 className="iee-chapter-bar__title">
                    <Sparkles size={20} strokeWidth={2} aria-hidden />
                    {activeChapter?.title || 'Chapter'}
                  </h2>
                  <p className="iee-chapter-bar__desc">
                    Build this page with blocks below. Drag to reorder. Add text or H5P activities from the panel on the
                    right.
                  </p>
                </div>
                <div className="iee-pill-row">
                  <span className="iee-pill iee-pill--accent">Block editor</span>
                  <span className="iee-pill iee-pill--muted">
                    Layout: {bookLayoutMode === 'fixed' ? 'Fixed' : 'Reflow'}
                  </span>
                </div>
              </header>

              <ReaderCompatibilityBanner compact />

              <section className="iee-section" aria-labelledby="blocks-heading">
                <div className="iee-section__head">
                  <h3 id="blocks-heading" className="iee-section__title">
                    <Layers size={16} strokeWidth={2} aria-hidden />
                    Page blocks
                    {!blocksLoading && (
                      <span className="iee-section__count">({sortedBlocks.length})</span>
                    )}
                  </h3>
                  {reordering ? (
                    <span className="iee-section__status">Saving order…</span>
                  ) : null}
                </div>

                {blocksLoading ? (
                  <div className="iee-blocks-loading">
                    <Loader2 size={20} strokeWidth={2.25} className="iee-spinner" aria-hidden />
                    Loading blocks…
                  </div>
                ) : sortedBlocks.length === 0 ? (
                  <div className="iee-empty-sidebar" style={{ textAlign: 'left' }}>
                    No blocks yet. Pick <strong>Text block</strong> or an H5P activity from the panel on the right.
                  </div>
                ) : (
                  <DndContext collisionDetection={closestCenter} onDragEnd={handleBlockDragEnd}>
                    <SortableContext items={sortedBlocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                      <div className="iee-blocks-grid">
                        {sortedBlocks.map((block, index) =>
                          block.type === 'h5p' ? (
                            <SortableItem key={block.id} id={block.id}>
                              {(dragHandleProps) => (
                                <H5pBlockCard
                                  block={block}
                                  index={index}
                                  dragHandleProps={dragHandleProps}
                                  bookLayoutMode={bookLayoutMode}
                                  onEdit={editH5pBlock}
                                  onDuplicate={duplicateBlock}
                                  onDelete={deleteBlock}
                                />
                              )}
                            </SortableItem>
                          ) : (
                            <SortableItem key={block.id} id={block.id}>
                              {(dragHandleProps) => (
                                <div className="iee-block-row">
                                  <button
                                    type="button"
                                    className="iee-block-drag"
                                    aria-label="Drag to reorder"
                                    {...Object.fromEntries(
                                      Object.entries(dragHandleProps || {}).filter(
                                        ([k]) => k !== 'isDragging',
                                      ),
                                    )}
                                  >
                                    <GripVertical size={16} aria-hidden />
                                  </button>
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
                                    {block.type === 'text' ? (
                                      <button
                                        type="button"
                                        className="iee-icon-btn"
                                        title="Edit text"
                                        onClick={() => editTextBlock(block)}
                                      >
                                        <Pencil size={16} strokeWidth={2} aria-hidden />
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="iee-icon-btn iee-icon-btn--danger"
                                      title="Delete block"
                                      onClick={() => deleteBlock(block)}
                                    >
                                      <Trash2 size={16} strokeWidth={2} aria-hidden />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </SortableItem>
                          ),
                        )}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </section>

              <div className="iee-tip">
                <div className="iee-tip-icon" aria-hidden>
                  <Eye size={18} strokeWidth={2} />
                </div>
                <div>
                  <h4>Preview your lesson</h4>
                  <p>
                    Use <strong>Preview reader</strong> in the header to see how blocks and H5P activities render together.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>

        <aside className="iee-rail" aria-label="H5P activities">
          {activeChapterId ? (
            <div className="iee-panel">
              <div className="iee-panel__body">
                <InteractiveContentSidebar onSelectType={handleActivitySelect} />
              </div>
            </div>
          ) : (
            <div className="iee-panel iee-rail-placeholder">
              <Puzzle size={32} strokeWidth={1.5} aria-hidden />
              <p>Select a chapter to browse H5P content types and add interactive activities.</p>
            </div>
          )}
        </aside>
        </div>
      </div>

      <H5pEditorDialog
        open={h5pEditorOpen}
        onClose={() => {
          setH5pEditorOpen(false);
          setEditingH5pBlock(null);
        }}
        contentType={h5pContentType}
        existingH5pContentId={
          editingH5pBlock
            ? editingH5pBlock.h5p_content_id ??
              editingH5pBlock.h5pContentId ??
              getBlockContent(editingH5pBlock).h5pContentId
            : null
        }
        existingDbId={editingH5pBlock?.h5p_content_id ?? null}
        onSaved={handleH5pSaved}
      />
      <H5pFixedLayoutDialog
        open={layoutDialogOpen}
        onClose={() => {
          setLayoutDialogOpen(false);
          setPendingH5pSave(null);
        }}
        onConfirm={handleLayoutConfirm}
      />
      <TextBlockEditDialog
        open={textEditOpen}
        block={editingTextBlock}
        onClose={() => {
          setTextEditOpen(false);
          setEditingTextBlock(null);
        }}
        onSave={saveTextBlock}
      />
    </div>
  );
}
