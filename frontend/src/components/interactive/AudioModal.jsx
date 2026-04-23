import React, { useState } from 'react';

export default function AudioModal({ onAdd, onClose }) {
  const [src, setSrc] = useState('');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [title, setTitle] = useState('');

  const handleSubmit = () => {
    if (!src.trim()) {
      alert('Please enter an audio URL');
      return;
    }

    onAdd({
      src: src.trim(),
      start: Number(start) || 0,
      end: Number(end) || 0,
      title: title.trim() || 'Audio'
    });
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        padding: 24,
        width: '90%',
        maxWidth: 500,
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}>
        <h2 style={{ margin: '0 0 20px 0', fontSize: 24, fontWeight: 700 }}>
          Add Audio
        </h2>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Audio URL *
          </label>
          <input
            type="url"
            className="form-control"
            placeholder="https://example.com/audio.mp3"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Supported formats: MP3, WAV, OGG
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Title
          </label>
          <input
            type="text"
            className="form-control"
            placeholder="Audio title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
              Start Time (seconds)
            </label>
            <input
              type="number"
              className="form-control"
              placeholder="0"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              min="0"
              step="0.1"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
              End Time (seconds)
            </label>
            <input
              type="number"
              className="form-control"
              placeholder="0 (full)"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              min="0"
              step="0.1"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {src && (
          <div style={{
            marginBottom: 20,
            padding: 12,
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            background: '#fafafa'
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Preview:</div>
            <audio
              controls
              src={src}
              style={{ width: '100%' }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <div style={{ display: 'none', color: '#f44336', fontSize: 14, marginTop: 8 }}>
              ⚠️ Failed to load audio. Check the URL.
            </div>
          </div>
        )}

        <div style={{
          padding: 12,
          background: '#fff3e0',
          borderRadius: 8,
          marginBottom: 20,
          fontSize: 14,
          color: '#e65100'
        }}>
          💡 <strong>Tip:</strong> Leave end time as 0 to play the full audio
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: '8px 20px' }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            style={{ padding: '8px 20px', background: '#ff9800', border: 'none' }}
          >
            Add Audio
          </button>
        </div>
      </div>
    </div>
  );
}
