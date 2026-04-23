import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { interactiveService } from '../../services/interactiveService';
import InteractiveBlockEditorCard from '../../components/interactive/InteractiveBlockEditorCard';
import TextBlockEditor from '../../components/interactive/TextBlockEditor';
import QuizBlockEditor from '../../components/interactive/QuizBlockEditor';
import AudioBlockEditor from '../../components/interactive/AudioBlockEditor';
import DragDropBlockEditor from '../../components/interactive/DragDropBlockEditor';
import AdvancedJsonEditor from '../../components/interactive/AdvancedJsonEditor';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { SortableItem } from '../../components/SortableItem';
import { HiOutlineSelector } from 'react-icons/hi';

function defaultContentForType(type) {
  const t = String(type || '').trim();
  if (t === 'text') return { html: '<p>Hello</p>' };
  if (t === 'quiz') return { question: 'What is 2+2?', options: ['2', '3', '4'], answer: 2 };
  if (t === 'audio') return { src: '', start: 0, end: 5 };
  if (t === 'dragdrop') return { question: 'Match items', items: ['Dog', 'Cat'], targets: ['Bark', 'Meow'], correct: { Dog: 'Bark', Cat: 'Meow' } };
  if (t === 'audio_sync' || t === 'readalong') {
    return {
      audio: '',
      words: [
        { id: 'w0', text: 'Hello', start: 0.0, end: 0.5 },
        { id: 'w1', text: 'world', start: 0.5, end: 1.0 }
      ]
    };
  }
  return {};
}

function nextPositionFromList(list) {
  const max = (list || []).reduce((m, it) => Math.max(m, Number(it.position ?? 0)), -1);
  return max + 1;
}

export default function InteractiveEditor() {
  const { bookId } = useParams();
  const id = useMemo(() => Number(bookId), [bookId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [activeChapterId, setActiveChapterId] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [savingOrder, setSavingOrder] = useState(false);

  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newBlockType, setNewBlockType] = useState('text');
  const [newBlockContent, setNewBlockContent] = useState(defaultContentForType('text'));
  const [newBlockPosition, setNewBlockPosition] = useState(0);
  const [showAdvancedNew, setShowAdvancedNew] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState(null);
  const [editingChapterTitle, setEditingChapterTitle] = useState('');

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const b = await interactiveService.getBook(id);
      const ch = await interactiveService.listChapters(id);
      setBook(b);
      setChapters(ch);
      const first = ch[0]?.id ?? null;
      setActiveChapterId((prev) => (prev != null ? prev : first));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function loadBlocks(chapterId) {
    if (!chapterId) {
      setBlocks([]);
      return;
    }
    setError('');
    try {
      const bl = await interactiveService.listBlocks(chapterId);
      setBlocks(bl);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load blocks');
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    loadAll();
  }, [id]);

  useEffect(() => {
    loadBlocks(activeChapterId);
  }, [activeChapterId]);

  async function createChapter() {
    setError('');
    if (!newChapterTitle.trim()) {
      setError('Chapter title is required');
      return;
    }
    try {
      const created = await interactiveService.createChapter(id, {
        title: newChapterTitle.trim(),
        position: nextPositionFromList(chapters)
      });
      setNewChapterTitle('');
      const next = [...chapters, created].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      setChapters(next);
      setActiveChapterId(created.id);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to create chapter');
    }
  }

  async function persistChapterOrder(nextChapters) {
    setSavingOrder(true);
    setError('');
    try {
      await interactiveService.reorderChapters(id, nextChapters.map((c) => c.id));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to save chapter order');
    } finally {
      setSavingOrder(false);
    }
  }

  async function persistBlockOrder(nextBlocks) {
    setSavingOrder(true);
    setError('');
    try {
      await interactiveService.reorderBlocks(activeChapterId, nextBlocks.map((b) => b.id));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to save block order');
    } finally {
      setSavingOrder(false);
    }
  }

  async function saveChapterTitle(chapterId) {
    const title = String(editingChapterTitle || '').trim();
    if (!title) {
      setError('Chapter title cannot be empty');
      return;
    }
    try {
      const updated = await interactiveService.updateChapter(chapterId, { title });
      setChapters((prev) => prev.map((c) => (c.id === chapterId ? updated : c)));
      setEditingChapterId(null);
      setEditingChapterTitle('');
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to rename chapter');
    }
  }

  async function deleteChapter(chapterId) {
    const ch = chapters.find((c) => c.id === chapterId);
    const ok = window.confirm(`Delete chapter "${ch?.title || chapterId}"?`);
    if (!ok) return;
    setError('');
    try {
      await interactiveService.deleteChapter(chapterId);
      const next = chapters.filter((c) => c.id !== chapterId);
      setChapters(next);
      if (activeChapterId === chapterId) {
        setActiveChapterId(next[0]?.id ?? null);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to delete chapter');
    }
  }

  async function createBlock() {
    setError('');
    if (!activeChapterId) {
      setError('Select a chapter first');
      return;
    }
    try {
      await interactiveService.createBlock(activeChapterId, {
        type: String(newBlockType).trim(),
        contentJson: newBlockContent,
        position: Number(newBlockPosition) || 0
      });
      await loadBlocks(activeChapterId);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to create block');
    }
  }

  async function saveBlock(blockId, payload) {
    await interactiveService.updateBlock(blockId, payload);
    await loadBlocks(activeChapterId);
  }

  async function deleteBlock(blockId) {
    const ok = window.confirm(`Delete block #${blockId}?`);
    if (!ok) return;
    setError('');
    await interactiveService.deleteBlock(blockId);
    await loadBlocks(activeChapterId);
  }

  async function duplicateBlock(block) {
    try {
      await interactiveService.createBlock(activeChapterId, {
        type: block.type,
        contentJson: block.content_json,
        position: nextPositionFromList(blocks)
      });
      await loadBlocks(activeChapterId);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to duplicate block');
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (!book) return <div style={{ padding: 16 }}>Book not found.</div>;

  return (
    <div style={{ padding: 16, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Editor — {book.title}</h2>
          <div style={{ color: '#666', marginTop: 4 }}>
            <Link to="/interactive">← Back to books</Link>
          </div>
        </div>
        <Link className="btn btn-secondary" to={`/interactive/reader/${book.id}`}>
          Preview reader
        </Link>
      </div>

      {error ? (
        <div style={{ marginTop: 12, background: '#fee', border: '1px solid #fbb', padding: 10, borderRadius: 6 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14, marginTop: 14 }}>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Chapters</div>
            {savingOrder ? <div style={{ color: '#666', fontSize: 13 }}>Saving order…</div> : null}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-control"
              placeholder="New chapter title"
              value={newChapterTitle}
              onChange={(e) => setNewChapterTitle(e.target.value)}
            />
            <button className="btn btn-primary" type="button" onClick={createChapter}>
              Add
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            {chapters.length === 0 ? (
              <div style={{ color: '#666' }}>No chapters yet.</div>
            ) : (
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={async ({ active, over }) => {
                  if (!over || active.id === over.id) return;
                  const ordered = chapters.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                  const oldIndex = ordered.findIndex((c) => c.id === active.id);
                  const newIndex = ordered.findIndex((c) => c.id === over.id);
                  if (oldIndex < 0 || newIndex < 0) return;
                  const nextOrdered = arrayMove(ordered, oldIndex, newIndex).map((c, idx) => ({ ...c, position: idx }));
                  setChapters(nextOrdered);
                  await persistChapterOrder(nextOrdered);
                }}
              >
                <SortableContext
                  items={chapters.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {chapters
                    .slice()
                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                    .map((c) => (
                      <SortableItem key={c.id} id={c.id}>
                        {({ attributes, listeners }) => (
                          <div
                            style={{
                              border: '1px solid #eee',
                              borderRadius: 10,
                              padding: 10,
                              marginBottom: 8,
                              background: c.id === activeChapterId ? '#f6fbff' : '#fff'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '6px 8px', display: 'flex', alignItems: 'center' }}
                                title="Drag to reorder"
                                {...attributes}
                                {...listeners}
                                disabled={savingOrder}
                              >
                                <HiOutlineSelector />
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setActiveChapterId(c.id)}
                                style={{ flex: 1, textAlign: 'left' }}
                              >
                                {editingChapterId === c.id ? (
                                  <span style={{ display: 'flex', gap: 6 }}>
                                    <input
                                      className="form-control"
                                      value={editingChapterTitle}
                                      onChange={(e) => setEditingChapterTitle(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          saveChapterTitle(c.id);
                                        } else if (e.key === 'Escape') {
                                          setEditingChapterId(null);
                                          setEditingChapterTitle('');
                                        }
                                      }}
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        saveChapterTitle(c.id);
                                      }}
                                    >
                                      Save
                                    </button>
                                  </span>
                                ) : (
                                  c.title
                                )}
                              </button>
                              {editingChapterId !== c.id ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingChapterId(c.id);
                                    setEditingChapterTitle(c.title || '');
                                  }}
                                  disabled={savingOrder}
                                >
                                  Rename
                                </button>
                              ) : null}
                              <button type="button" className="btn btn-danger" onClick={() => deleteChapter(c.id)} disabled={savingOrder}>
                                ×
                              </button>
                            </div>
                          </div>
                        )}
                      </SortableItem>
                    ))}
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        <div>
          <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, background: '#fff' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Add block</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {['text', 'quiz', 'audio', 'dragdrop', 'audio_sync'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={newBlockType === t ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => {
                    setNewBlockType(t);
                    setNewBlockContent(defaultContentForType(t));
                    setShowAdvancedNew(false);
                    setNewBlockPosition(nextPositionFromList(blocks));
                  }}
                >
                  + {t}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <input
                className="form-control"
                style={{ width: 140 }}
                type="number"
                value={newBlockPosition}
                onChange={(e) => setNewBlockPosition(e.target.value)}
                placeholder="position"
              />
              <button className="btn btn-primary" type="button" onClick={createBlock} disabled={!activeChapterId}>
                Add
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              {newBlockType === 'text' ? <TextBlockEditor value={newBlockContent} onChange={setNewBlockContent} /> : null}
              {newBlockType === 'quiz' ? <QuizBlockEditor value={newBlockContent} onChange={setNewBlockContent} /> : null}
              {newBlockType === 'audio' ? <AudioBlockEditor value={newBlockContent} onChange={setNewBlockContent} /> : null}
              {newBlockType === 'dragdrop' ? <DragDropBlockEditor value={newBlockContent} onChange={setNewBlockContent} /> : null}

              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAdvancedNew((v) => !v)}>
                  {showAdvancedNew ? 'Hide JSON' : 'Advanced JSON'}
                </button>
              </div>
              {showAdvancedNew ? <AdvancedJsonEditor value={newBlockContent} onChange={setNewBlockContent} /> : null}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Blocks {activeChapterId ? `for chapter #${activeChapterId}` : ''}
            </div>
            {blocks.length === 0 ? (
              <div style={{ color: '#666' }}>{activeChapterId ? 'No blocks yet.' : 'Select a chapter to see blocks.'}</div>
            ) : (
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={async ({ active, over }) => {
                    if (!over || active.id === over.id) return;
                    const ordered = blocks.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                    const oldIndex = ordered.findIndex((b) => b.id === active.id);
                    const newIndex = ordered.findIndex((b) => b.id === over.id);
                    if (oldIndex < 0 || newIndex < 0) return;
                    const nextOrdered = arrayMove(ordered, oldIndex, newIndex).map((b, idx) => ({ ...b, position: idx }));
                    setBlocks(nextOrdered);
                    await persistBlockOrder(nextOrdered);
                  }}
                >
                  <SortableContext
                    items={blocks.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((b) => b.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {blocks
                      .slice()
                      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                      .map((bl) => (
                        <SortableItem key={bl.id} id={bl.id}>
                          {({ attributes, listeners }) => (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '6px 8px', display: 'flex', alignItems: 'center' }}
                                  title="Drag to reorder"
                                  {...attributes}
                                  {...listeners}
                                  disabled={savingOrder}
                                >
                                  <HiOutlineSelector />
                                </button>
                                <div style={{ color: '#666', fontSize: 13 }}>Drag to reorder</div>
                              </div>
                              <InteractiveBlockEditorCard
                                block={bl}
                                onSave={saveBlock}
                                onDelete={deleteBlock}
                                onDuplicate={duplicateBlock}
                              />
                            </div>
                          )}
                        </SortableItem>
                      ))}
                  </SortableContext>
                </DndContext>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

