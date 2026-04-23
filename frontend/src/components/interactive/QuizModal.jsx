import React, { useState } from 'react';

export default function QuizModal({ onAdd, onClose }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState([
    { text: '', correct: false },
    { text: '', correct: false }
  ]);

  const updateOption = (index, key, value) => {
    const newOptions = [...options];
    newOptions[index][key] = value;
    
    // If marking as correct, unmark others
    if (key === 'correct' && value === true) {
      newOptions.forEach((opt, i) => {
        if (i !== index) opt.correct = false;
      });
    }
    
    setOptions(newOptions);
  };

  const addOption = () => {
    setOptions([...options, { text: '', correct: false }]);
  };

  const removeOption = (index) => {
    if (options.length <= 2) {
      alert('Quiz must have at least 2 options');
      return;
    }
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!question.trim()) {
      alert('Please enter a question');
      return;
    }

    if (options.some(opt => !opt.text.trim())) {
      alert('All options must have text');
      return;
    }

    if (!options.some(opt => opt.correct)) {
      alert('Please mark one option as correct');
      return;
    }

    // Convert to format expected by backend
    const correctIndex = options.findIndex(opt => opt.correct);
    onAdd({
      question: question.trim(),
      options: options.map(opt => opt.text.trim()),
      answer: correctIndex
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
        maxWidth: 600,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}>
        <h2 style={{ margin: '0 0 20px 0', fontSize: 24, fontWeight: 700 }}>
          Create Quiz Question
        </h2>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Question
          </label>
          <textarea
            className="form-control"
            placeholder="Enter your question here..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Options
          </label>
          <div style={{ display: 'grid', gap: 12 }}>
            {options.map((opt, index) => (
              <div key={index} style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 8,
                alignItems: 'center',
                padding: 12,
                border: opt.correct ? '2px solid #4caf50' : '1px solid #e0e0e0',
                borderRadius: 8,
                background: opt.correct ? '#f1f8f4' : '#fff'
              }}>
                <input
                  type="checkbox"
                  checked={opt.correct}
                  onChange={(e) => updateOption(index, 'correct', e.target.checked)}
                  title="Mark as correct answer"
                  style={{ width: 20, height: 20, cursor: 'pointer' }}
                />
                <input
                  className="form-control"
                  placeholder={`Option ${index + 1}`}
                  value={opt.text}
                  onChange={(e) => updateOption(index, 'text', e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeOption(index)}
                  disabled={options.length <= 2}
                  style={{ padding: '6px 12px' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={addOption}
            style={{ marginTop: 12, width: '100%' }}
          >
            + Add Option
          </button>
        </div>

        <div style={{
          padding: 12,
          background: '#e3f2fd',
          borderRadius: 8,
          marginBottom: 20,
          fontSize: 14,
          color: '#1565c0'
        }}>
          💡 <strong>Tip:</strong> Check the box next to the correct answer
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
            style={{ padding: '8px 20px' }}
          >
            Add Quiz
          </button>
        </div>
      </div>
    </div>
  );
}
