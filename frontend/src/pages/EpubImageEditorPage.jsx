import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { conversionService } from '../services/conversionService';
import EpubImageEditor from '../components/EpubImageEditor';
import { HiOutlineVolumeUp } from 'react-icons/hi';

const EpubImageEditorPage = () => {
  const { jobId } = useParams();
  const [pages, setPages] = useState([]);
  const [selectedPage, setSelectedPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (jobId) {
      loadPages();
    }
  }, [jobId]);

  const loadPages = async () => {
    try {
      setLoading(true);
      const pagesList = await conversionService.getJobPages(parseInt(jobId));
      setPages(pagesList || []);
      
      // Set first page as default
      if (pagesList && pagesList.length > 0) {
        setSelectedPage(pagesList[0].pageNumber);
      }
    } catch (err) {
      console.error('Error loading pages:', err);
      setError(err.response?.data?.message || err.message || 'Failed to load pages');
    } finally {
      setLoading(false);
    }
  };

  const [editorState, setEditorState] = useState(null);
  const [regenerating, setRegenerating] = useState(false);

  const handleSave = (xhtml) => {
    console.log('XHTML saved:', xhtml);
  };
  
  const handleEditorStateChange = useCallback((state) => {
    setEditorState(state);
  }, []);

  const handleSyncStudio = async () => {
    try {
      setRegenerating(true);
      await conversionService.regenerateEpub(parseInt(jobId));
    } catch (err) {
      console.error('Regeneration error (proceeding anyway):', err);
    } finally {
      // Use full-page navigation — React Router's navigate() does not reliably unmount
      // the heavy EpubImageEditor component, leaving the old UI visible even after the
      // URL changes. window.location.href forces a clean load of Sync Studio.
      window.location.href = `/sync-studio/${jobId}`;
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2em', textAlign: 'center' }}>
        <p>Loading pages...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2em' }}>
        <div style={{ color: 'red', marginBottom: '1em' }}>{error}</div>
        <button onClick={() => { window.location.href = '/conversions'; }}>Back to Conversions</button>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div style={{ padding: '2em', textAlign: 'center' }}>
        <p>No pages found for this conversion job.</p>
        <button onClick={() => { window.location.href = '/conversions'; }}>Back to Conversions</button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '1em', background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>EPUB Image Editor - Job {jobId}</h1>
          <div style={{ display: 'flex', gap: '1em', alignItems: 'center' }}>
            <label>
              Select Page:
              <select
                value={selectedPage || ''}
                onChange={(e) => setSelectedPage(parseInt(e.target.value))}
                style={{ marginLeft: '0.5em', padding: '0.5em' }}
              >
                {pages.map((page) => (
                  <option key={page.pageNumber} value={page.pageNumber}>
                    Page {page.pageNumber}
                  </option>
                ))}
              </select>
            </label>
            {editorState && (
              <>
                <button
                  onClick={() => editorState.setEditMode(!editorState.editMode)}
                  style={{
                    padding: '0.5em 1em',
                    backgroundColor: editorState.editMode ? '#2196F3' : '#f5f5f5',
                    color: editorState.editMode ? 'white' : '#666',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  {editorState.editMode ? '✏️ Edit Mode ON' : '✏️ Edit Mode OFF'}
                </button>
                {editorState.modified && (
                  <span style={{ color: '#ff9800', fontWeight: 'bold', fontSize: '0.9em' }}>Modified</span>
                )}
                <button
                  onClick={editorState.handleReset}
                  disabled={!editorState.modified || !editorState.editMode}
                  style={{
                    padding: '0.5em 1.5em',
                    backgroundColor: '#f5f5f5',
                    color: '#666',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (!editorState.modified || !editorState.editMode) ? 'not-allowed' : 'pointer',
                    opacity: (!editorState.modified || !editorState.editMode) ? 0.5 : 1
                  }}
                >
                  Reset
                </button>
                <button
                  onClick={editorState.handleSave}
                  disabled={editorState.saving || !editorState.modified || !editorState.editMode}
                  style={{
                    padding: '0.5em 1.5em',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (editorState.saving || !editorState.modified || !editorState.editMode) ? 'not-allowed' : 'pointer',
                    opacity: (editorState.saving || !editorState.modified || !editorState.editMode) ? 0.6 : 1,
                    minWidth: '120px'
                  }}
                >
                  {editorState.saving ? 'Saving...' : 'Save XHTML'}
                </button>
              </>
            )}
            <button
              onClick={handleSyncStudio}
              disabled={regenerating}
              style={{
                padding: '0.5em 1em',
                backgroundColor: regenerating ? '#7B1FA2' : '#9C27B0',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: regenerating ? 'not-allowed' : 'pointer',
                opacity: regenerating ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5em'
              }}
            >
              <HiOutlineVolumeUp size={18} />
              {regenerating ? 'Regenerating...' : 'Sync Studio'}
            </button>
            {editorState?.handleRegenerateChapter && (
              <button
                onClick={editorState.handleRegenerateChapter}
                disabled={editorState.regenerating}
                style={{
                  padding: '0.5em 1em',
                  backgroundColor: editorState.regenerating ? '#999' : '#E91E63',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: editorState.regenerating ? 'not-allowed' : 'pointer',
                  opacity: editorState.regenerating ? 0.6 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5em'
                }}
                title={editorState.regenerating ? 'Regenerating chapter...' : `Regenerate chapter containing current page using Gemini AI`}
              >
                {editorState.regenerating ? '🔄 Regenerating...' : '📚 Regenerate Chapter'}
              </button>
            )}
            {editorState?.openCodeViewer && (
              <button
                onClick={editorState.openCodeViewer}
                style={{
                  padding: '0.5em 1em',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5em'
                }}
                title="View XHTML Code"
              >
                📄 View Code
              </button>
            )}
            <button onClick={() => { window.location.href = '/conversions'; }}>Back to Conversions</button>
          </div>
        </div>
      </div>
      
      {selectedPage && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <EpubImageEditor
            jobId={parseInt(jobId)}
            pageNumber={selectedPage}
            onSave={handleSave}
            onStateChange={handleEditorStateChange}
            onRequestPageChange={(nextPage) => setSelectedPage(nextPage)}
          />
        </div>
      )}
    </div>
  );
};

export default EpubImageEditorPage;

