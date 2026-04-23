import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { interactiveService } from '../../services/interactiveService';
import CKEditorEnhanced from '../../components/interactive/CKEditorEnhanced';

export default function InteractiveEditorEnhanced() {
  const { bookId } = useParams();
  const [loading, setLoading] = useState(true);
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

  async function loadBook() {
    setLoading(true);
    setError('');
    try {
      const b = await interactiveService.getBook(bookId);
      const ch = await interactiveService.listChapters(bookId);
      setBook(b);
      setChapters(ch);
      if (ch.length > 0 && !activeChapterId) {
        setActiveChapterId(ch[0].id);
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
    setError('');
    try {
      const bl = await interactiveService.listBlocks(chapterId);
      setBlocks(bl);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load blocks');
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
        position
      });
      setNewChapterTitle('');
      setChapters([...chapters, created]);
      setActiveChapterId(created.id);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to create chapter');
    }
  }

  async function deleteChapter(chapterId) {
    const ch = chapters.find(c => c.id === chapterId);
    if (!window.confirm(`Delete chapter "${ch?.title}"?`)) return;
    
    setError('');
    try {
      await interactiveService.deleteChapter(chapterId);
      const remaining = chapters.filter(c => c.id !== chapterId);
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
        position
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

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!book) return <div style={{ padding: 20 }}>Book not found</div>;

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e0e0e0',
        padding: '16px 24px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
      }}>
        <div style={{
          maxWidth: 1400,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
              📚 {book.title}
            </h1>
            <div style={{ marginTop: 4, fontSize: 14, color: '#666' }}>
              <Link to="/interactive" style={{ color: '#2196f3', textDecoration: 'none' }}>
                ← Back to books
              </Link>
            </div>
          </div>
          <Link
            to={`/interactive/reader/${book.id}`}
            className="btn btn-primary"
            style={{ padding: '10px 20px', fontSize: 16 }}
          >
            👁️ Preview Reader
          </Link>
        </div>
      </div>

      {error && (
        <div style={{
          maxWidth: 1400,
          margin: '16px auto',
          padding: 16,
          background: '#ffebee',
          border: '1px solid #f44336',
          borderRadius: 8,
          color: '#c62828'
        }}>
          {error}
        </div>
      )}

      <div style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: 24,
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        gap: 24
      }}>
        {/* Sidebar - Chapters */}
        <div>
          <div style={{
            background: '#fff',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            position: 'sticky',
            top: 100
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 700 }}>
              Chapters
            </h3>

            <div style={{ marginBottom: 16 }}>
              <input
                className="form-control"
                placeholder="New chapter..."
                value={newChapterTitle}
                onChange={(e) => setNewChapterTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createChapter();
                }}
                style={{ marginBottom: 8 }}
              />
              <button
                className="btn btn-primary"
                onClick={createChapter}
                style={{ width: '100%' }}
              >
                + Add Chapter
              </button>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {chapters.length === 0 ? (
                <div style={{ color: '#666', fontSize: 14, textAlign: 'center', padding: 16 }}>
                  No chapters yet
                </div>
              ) : (
                chapters.map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      padding: 12,
                      background: ch.id === activeChapterId ? '#e3f2fd' : '#f5f5f5',
                      border: ch.id === activeChapterId ? '2px solid #2196f3' : '1px solid #e0e0e0',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onClick={() => setActiveChapterId(ch.id)}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                      {ch.title}
                    </div>
                    <button
                      className="btn btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChapter(ch.id);
                      }}
                      style={{ padding: '4px 8px', fontSize: 12, width: '100%', marginTop: 8 }}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div>
          {!activeChapterId ? (
            <div style={{
              background: '#fff',
              borderRadius: 12,
              padding: 40,
              textAlign: 'center',
              color: '#666',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
              <div style={{ fontSize: 18 }}>Select or create a chapter to start editing</div>
            </div>
          ) : (
            <div style={{
              background: '#fff',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
            }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: 20, fontWeight: 700 }}>
                ✏️ Content Editor
              </h3>
              <CKEditorEnhanced onAddBlock={handleAddBlock} />
              
              <div style={{
                marginTop: 20,
                padding: 16,
                background: '#e3f2fd',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 12
              }}>
                <div style={{ fontSize: 24 }}>💡</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#1565c0', marginBottom: 4 }}>
                    Preview Your Content
                  </div>
                  <div style={{ fontSize: 14, color: '#1976d2' }}>
                    Click the "Preview Reader" button at the top to see how your content looks with all interactive elements.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
