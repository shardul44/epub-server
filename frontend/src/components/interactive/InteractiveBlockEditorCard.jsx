import React, { useMemo, useState } from 'react';
import TextBlockEditor from './TextBlockEditor';
import QuizBlockEditor from './QuizBlockEditor';
import AudioBlockEditor from './AudioBlockEditor';
import AudioSyncBlockEditor from './AudioSyncBlockEditor';
import DragDropBlockEditor from './DragDropBlockEditor';
import AdvancedJsonEditor from './AdvancedJsonEditor';

function normalizeType(t) {
  return String(t || '').trim();
}

export default function InteractiveBlockEditorCard({ block, onSave, onDelete, onDuplicate }) {
  const [type, setType] = useState(normalizeType(block.type));
  const [position, setPosition] = useState(block.position ?? 0);
  const [content, setContent] = useState(block.content_json || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const header = useMemo(() => `Block #${block.id}`, [block.id]);

  function renderEditor() {
    const t = normalizeType(type);
    if (t === 'text') return <TextBlockEditor value={content} onChange={setContent} />;
    if (t === 'audio_sync' || t === 'readalong') return <AudioSyncBlockEditor value={content} onChange={setContent} />;
    if (t === 'quiz') return <QuizBlockEditor value={content} onChange={setContent} />;
    if (t === 'audio') return <AudioBlockEditor value={content} onChange={setContent} />;
    if (t === 'dragdrop') return <DragDropBlockEditor value={content} onChange={setContent} />;
    return (
      <div style={{ color: '#666' }}>
        Unknown type. Use Advanced JSON to edit the payload.
      </div>
    );
  }

  async function save() {
    setError('');
    const t = normalizeType(type);
    if (!t) {
      setError('type is required');
      return;
    }
    if (!content || typeof content !== 'object') {
      setError('content must be an object');
      return;
    }
    setBusy(true);
    try {
      await onSave(block.id, {
        type: t,
        position: Number(position) || 0,
        contentJson: content
      });
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 12, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <div style={{ fontWeight: 750 }}>{header}</div>
        <div style={{ color: '#666', fontSize: 13 }}>
          {block.updated_at ? `Updated: ${new Date(block.updated_at).toLocaleString()}` : ''}
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 10, background: '#fee', border: '1px solid #fbb', padding: 8, borderRadius: 6 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '180px 160px 1fr', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <select className="form-control" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="text">text</option>
          <option value="quiz">quiz</option>
          <option value="audio">audio</option>
          <option value="dragdrop">dragdrop</option>
          <option value="audio_sync">audio_sync</option>
          <option value="readalong">readalong</option>
          <option value={type}>{type || 'custom'}</option>
        </select>
        <input
          className="form-control"
          type="number"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="position"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Hide JSON' : 'Advanced JSON'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onDuplicate?.(block)} disabled={busy}>
            Duplicate
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => onDelete(block.id)} disabled={busy}>
            Delete
          </button>
        </div>
      </div>

      {!collapsed ? (
        <div style={{ marginTop: 10 }}>
          {renderEditor()}
          {showAdvanced ? <AdvancedJsonEditor value={content} onChange={setContent} /> : null}
        </div>
      ) : null}
    </div>
  );
}

