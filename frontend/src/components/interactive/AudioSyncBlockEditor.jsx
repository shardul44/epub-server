import React, { useEffect, useMemo, useState } from 'react';

function normalize(value) {
  const v = value && typeof value === 'object' ? value : {};
  const words = Array.isArray(v.words) ? v.words : [];
  return {
    audio: v.audio != null ? String(v.audio) : '',
    words: words.map((w, idx) => ({
      id: w?.id != null ? String(w.id) : `w${idx}`,
      text: w?.text != null ? String(w.text) : '',
      start: Number.isFinite(Number(w?.start)) ? Number(w.start) : 0,
      end: Number.isFinite(Number(w?.end)) ? Number(w.end) : 0
    }))
  };
}

export default function AudioSyncBlockEditor({ value, onChange }) {
  const norm = useMemo(() => normalize(value), [value]);
  const [audio, setAudio] = useState(norm.audio);
  const [words, setWords] = useState(norm.words.length ? norm.words : [{ id: 'w0', text: 'Hello', start: 0, end: 0.5 }]);
  const [importText, setImportText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setAudio(norm.audio), [norm.audio]);
  useEffect(() => setWords(norm.words.length ? norm.words : [{ id: 'w0', text: 'Hello', start: 0, end: 0.5 }]), [norm.words]);

  useEffect(() => {
    onChange({ audio, words });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, words]);

  function addWord() {
    const nextIdx = words.length;
    const prevEnd = Number(words[words.length - 1]?.end ?? 0);
    const start = Number.isFinite(prevEnd) ? prevEnd : 0;
    const end = Number((start + 0.5).toFixed(3));
    setWords([...words, { id: `w${nextIdx}`, text: '', start, end }]);
  }

  function applyImport() {
    setError('');
    try {
      const parsed = JSON.parse(importText);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.words)) {
        setError('JSON must contain { "words": [...] }');
        return;
      }
      const normalized = normalize(parsed);
      setAudio(normalized.audio || audio);
      setWords(normalized.words);
      setImportText('');
    } catch {
      setError('Invalid JSON');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Audio source URL</div>
        <input
          className="form-control"
          value={audio}
          onChange={(e) => setAudio(e.target.value)}
          placeholder="https://.../ch1.mp3 or /uploads/..."
        />
      </div>

      <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 650 }}>Word timings</div>
          <button type="button" className="btn btn-secondary" onClick={addWord}>
            Add word
          </button>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {words.map((w, idx) => (
            <div key={`${w.id}_${idx}`} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 110px 110px auto', gap: 8, alignItems: 'center' }}>
              <input
                className="form-control"
                value={w.id}
                onChange={(e) => {
                  const next = words.slice();
                  next[idx] = { ...next[idx], id: e.target.value };
                  setWords(next);
                }}
                placeholder="id"
              />
              <input
                className="form-control"
                value={w.text}
                onChange={(e) => {
                  const next = words.slice();
                  next[idx] = { ...next[idx], text: e.target.value };
                  setWords(next);
                }}
                placeholder="word text"
              />
              <input
                className="form-control"
                type="number"
                step="0.001"
                value={w.start}
                onChange={(e) => {
                  const next = words.slice();
                  next[idx] = { ...next[idx], start: Number(e.target.value) || 0 };
                  setWords(next);
                }}
                placeholder="start"
              />
              <input
                className="form-control"
                type="number"
                step="0.001"
                value={w.end}
                onChange={(e) => {
                  const next = words.slice();
                  next[idx] = { ...next[idx], end: Number(e.target.value) || 0 };
                  setWords(next);
                }}
                placeholder="end"
              />
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const next = words.filter((_, i) => i !== idx);
                  setWords(next.length ? next : [{ id: 'w0', text: '', start: 0, end: 0.5 }]);
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }}>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Import words JSON (optional)</div>
        {error ? (
          <div style={{ marginBottom: 8, background: '#fee', border: '1px solid #fbb', padding: 8, borderRadius: 6 }}>
            {error}
          </div>
        ) : null}
        <textarea
          className="form-control"
          rows={5}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='{"audio":"/audio/ch1.mp3","words":[{"id":"w0","text":"Hello","start":0,"end":0.5}]}'
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
        />
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={applyImport} disabled={!importText.trim()}>
            Apply import
          </button>
        </div>
      </div>
    </div>
  );
}

