import React, { useEffect, useState } from 'react';

export default function AdvancedJsonEditor({ value, onChange }) {
  const [text, setText] = useState(JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState('');

  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2));
    setError('');
  }, [value]);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>Advanced JSON</div>
      {error ? (
        <div style={{ marginBottom: 8, background: '#fee', border: '1px solid #fbb', padding: 8, borderRadius: 6 }}>
          {error}
        </div>
      ) : null}
      <textarea
        className="form-control"
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
        rows={8}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            const parsed = JSON.parse(next);
            setError('');
            onChange(parsed);
          } catch (err) {
            setError('Invalid JSON');
          }
        }}
      />
    </div>
  );
}

