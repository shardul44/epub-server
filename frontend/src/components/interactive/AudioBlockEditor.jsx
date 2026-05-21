import React, { useEffect, useMemo, useState } from 'react';

function normalizeAudio(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    src: v.src != null ? String(v.src) : '',
    start: v.start != null && v.start !== '' ? Number(v.start) : '',
    end: v.end != null && v.end !== '' ? Number(v.end) : ''
  };
}

export default function AudioBlockEditor({ value, onChange }) {
  const norm = useMemo(() => normalizeAudio(value), [value]);
  const [src, setSrc] = useState(norm.src);
  const [start, setStart] = useState(norm.start);
  const [end, setEnd] = useState(norm.end);

  useEffect(() => setSrc(norm.src), [norm.src]);
  useEffect(() => setStart(norm.start), [norm.start]);
  useEffect(() => setEnd(norm.end), [norm.end]);

  useEffect(() => {
    const payload = { src: src || '' };
    if (start !== '') payload.start = Number(start);
    if (end !== '') payload.end = Number(end);
    onChange(payload);
     
  }, [src, start, end]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Audio source URL</div>
        <input className="form-control" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="https://.../audio.mp3 or /uploads/..." />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 650, marginBottom: 6 }}>Start (sec)</div>
          <input className="form-control" type="number" value={start} onChange={(e) => setStart(e.target.value)} placeholder="0" />
        </div>
        <div>
          <div style={{ fontWeight: 650, marginBottom: 6 }}>End (sec)</div>
          <input className="form-control" type="number" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="5" />
        </div>
      </div>

      {src ? (
        <div style={{ marginTop: 4 }}>
          <audio controls style={{ width: '100%' }}>
            <source src={src} type="audio/mpeg" />
          </audio>
        </div>
      ) : null}
    </div>
  );
}

