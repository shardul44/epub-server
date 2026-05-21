import React, { useEffect, useMemo, useState } from 'react';

function normalizeQuiz(value) {
  const v = value && typeof value === 'object' ? value : {};
  const options = Array.isArray(v.options) ? v.options.map(String) : [];
  return {
    question: v.question != null ? String(v.question) : '',
    options: options.length ? options : ['Option 1', 'Option 2', 'Option 3'],
    answer: Number.isInteger(v.answer) ? v.answer : 0
  };
}

export default function QuizBlockEditor({ value, onChange }) {
  const norm = useMemo(() => normalizeQuiz(value), [value]);
  const [question, setQuestion] = useState(norm.question);
  const [options, setOptions] = useState(norm.options);
  const [answer, setAnswer] = useState(norm.answer);

  useEffect(() => setQuestion(norm.question), [norm.question]);
  useEffect(() => setOptions(norm.options), [norm.options]);
  useEffect(() => setAnswer(norm.answer), [norm.answer]);

  useEffect(() => {
    onChange({ question, options, answer: Number(answer) || 0 });
     
  }, [question, options, answer]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Question</div>
        <input className="form-control" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Enter question" />
      </div>

      <div>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Options</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {options.map((opt, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 8, alignItems: 'center' }}>
              <input
                type="radio"
                name="quiz-answer"
                checked={Number(answer) === idx}
                onChange={() => setAnswer(idx)}
                aria-label={`Set answer ${idx + 1}`}
              />
              <input
                className="form-control"
                value={opt}
                onChange={(e) => {
                  const next = options.slice();
                  next[idx] = e.target.value;
                  setOptions(next);
                }}
                placeholder={`Option ${idx + 1}`}
              />
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const next = options.filter((_, i) => i !== idx);
                  setOptions(next.length ? next : ['Option 1']);
                  if (Number(answer) === idx) setAnswer(0);
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setOptions([...options, `Option ${options.length + 1}`])}>
            Add option
          </button>
        </div>
      </div>

      <div style={{ color: '#666', fontSize: 13 }}>
        Tip: select the correct option using the radio button.
      </div>
    </div>
  );
}

