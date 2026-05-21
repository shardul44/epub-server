import React, { useEffect, useMemo, useState } from 'react';

function normalizeDragDrop(value) {
  const v = value && typeof value === 'object' ? value : {};
  const items = Array.isArray(v.items) ? v.items.map(String) : [];
  const targets = Array.isArray(v.targets) ? v.targets.map(String) : [];
  const correct = v.correct && typeof v.correct === 'object' ? v.correct : {};
  return {
    question: v.question != null ? String(v.question) : '',
    items: items.length ? items : ['Item 1', 'Item 2'],
    targets: targets.length ? targets : ['Target 1', 'Target 2'],
    correct
  };
}

export default function DragDropBlockEditor({ value, onChange }) {
  const norm = useMemo(() => normalizeDragDrop(value), [value]);
  const [question, setQuestion] = useState(norm.question);
  const [items, setItems] = useState(norm.items);
  const [targets, setTargets] = useState(norm.targets);
  const [correct, setCorrect] = useState(norm.correct);

  useEffect(() => setQuestion(norm.question), [norm.question]);
  useEffect(() => setItems(norm.items), [norm.items]);
  useEffect(() => setTargets(norm.targets), [norm.targets]);
  useEffect(() => setCorrect(norm.correct), [norm.correct]);

  useEffect(() => {
    onChange({ question, items, targets, correct });
     
  }, [question, items, targets, correct]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Question</div>
        <input className="form-control" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Match items to targets" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 650, marginBottom: 6 }}>Items</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {items.map((it, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <input
                  className="form-control"
                  value={it}
                  onChange={(e) => {
                    const next = items.slice();
                    const prevKey = next[idx];
                    next[idx] = e.target.value;
                    setItems(next);
                    if (prevKey && correct[prevKey] != null) {
                      const mapped = correct[prevKey];
                      const nextCorrect = { ...correct };
                      delete nextCorrect[prevKey];
                      nextCorrect[e.target.value] = mapped;
                      setCorrect(nextCorrect);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const key = items[idx];
                    const next = items.filter((_, i) => i !== idx);
                    setItems(next.length ? next : ['Item 1']);
                    if (key && correct[key] != null) {
                      const nextCorrect = { ...correct };
                      delete nextCorrect[key];
                      setCorrect(nextCorrect);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setItems([...items, `Item ${items.length + 1}`])}>
              Add item
            </button>
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 650, marginBottom: 6 }}>Targets</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {targets.map((t, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <input
                  className="form-control"
                  value={t}
                  onChange={(e) => {
                    const next = targets.slice();
                    const prevTarget = next[idx];
                    next[idx] = e.target.value;
                    setTargets(next);
                    if (prevTarget) {
                      const nextCorrect = { ...correct };
                      Object.keys(nextCorrect).forEach((k) => {
                        if (nextCorrect[k] === prevTarget) nextCorrect[k] = e.target.value;
                      });
                      setCorrect(nextCorrect);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const target = targets[idx];
                    const next = targets.filter((_, i) => i !== idx);
                    setTargets(next.length ? next : ['Target 1']);
                    if (target) {
                      const nextCorrect = { ...correct };
                      Object.keys(nextCorrect).forEach((k) => {
                        if (nextCorrect[k] === target) delete nextCorrect[k];
                      });
                      setCorrect(nextCorrect);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setTargets([...targets, `Target ${targets.length + 1}`])}>
              Add target
            </button>
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #eee', paddingTop: 10 }}>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Correct mapping</div>
        <div style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>
          Choose which target is correct for each item.
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((it, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 600 }}>{it}</div>
              <select
                className="form-control"
                value={correct[it] || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setCorrect((prev) => ({ ...prev, [it]: v || undefined }));
                }}
              >
                <option value="">(not set)</option>
                {targets.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

