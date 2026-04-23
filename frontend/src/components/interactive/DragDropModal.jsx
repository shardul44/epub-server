import React, { useState } from 'react';

export default function DragDropModal({ onAdd, onClose }) {
  const [question, setQuestion] = useState('');
  const [items, setItems] = useState(['Item 1', 'Item 2']);
  const [targets, setTargets] = useState(['Target 1', 'Target 2']);
  const [correct, setCorrect] = useState({ 'Item 1': 'Target 1', 'Item 2': 'Target 2' });

  const addItem = () => {
    const newItem = `Item ${items.length + 1}`;
    setItems([...items, newItem]);
    setCorrect({ ...correct, [newItem]: targets[0] || '' });
  };

  const removeItem = (index) => {
    if (items.length <= 1) {
      alert('Must have at least 1 item');
      return;
    }
    const item = items[index];
    const newItems = items.filter((_, i) => i !== index);
    const newCorrect = { ...correct };
    delete newCorrect[item];
    setItems(newItems);
    setCorrect(newCorrect);
  };

  const updateItem = (index, value) => {
    const oldItem = items[index];
    const newItems = [...items];
    newItems[index] = value;
    
    // Update correct mapping
    const newCorrect = { ...correct };
    if (oldItem !== value) {
      newCorrect[value] = newCorrect[oldItem] || targets[0] || '';
      delete newCorrect[oldItem];
    }
    
    setItems(newItems);
    setCorrect(newCorrect);
  };

  const addTarget = () => {
    setTargets([...targets, `Target ${targets.length + 1}`]);
  };

  const removeTarget = (index) => {
    if (targets.length <= 1) {
      alert('Must have at least 1 target');
      return;
    }
    const target = targets[index];
    const newTargets = targets.filter((_, i) => i !== index);
    
    // Update correct mappings that pointed to this target
    const newCorrect = { ...correct };
    Object.keys(newCorrect).forEach(item => {
      if (newCorrect[item] === target) {
        newCorrect[item] = newTargets[0] || '';
      }
    });
    
    setTargets(newTargets);
    setCorrect(newCorrect);
  };

  const updateTarget = (index, value) => {
    const oldTarget = targets[index];
    const newTargets = [...targets];
    newTargets[index] = value;
    
    // Update correct mappings
    const newCorrect = { ...correct };
    Object.keys(newCorrect).forEach(item => {
      if (newCorrect[item] === oldTarget) {
        newCorrect[item] = value;
      }
    });
    
    setTargets(newTargets);
    setCorrect(newCorrect);
  };

  const updateCorrectMapping = (item, target) => {
    setCorrect({ ...correct, [item]: target });
  };

  const handleSubmit = () => {
    if (!question.trim()) {
      alert('Please enter a question');
      return;
    }

    if (items.some(item => !item.trim())) {
      alert('All items must have text');
      return;
    }

    if (targets.some(target => !target.trim())) {
      alert('All targets must have text');
      return;
    }

    onAdd({
      question: question.trim(),
      items: items.map(i => i.trim()),
      targets: targets.map(t => t.trim()),
      correct
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
        maxWidth: 700,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}>
        <h2 style={{ margin: '0 0 20px 0', fontSize: 24, fontWeight: 700 }}>
          Create Drag & Drop Activity
        </h2>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Question
          </label>
          <textarea
            className="form-control"
            placeholder="e.g., Match each animal to its sound"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {/* Items Column */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
              Draggable Items
            </label>
            <div style={{ display: 'grid', gap: 8 }}>
              {items.map((item, index) => (
                <div key={index} style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="form-control"
                    placeholder={`Item ${index + 1}`}
                    value={item}
                    onChange={(e) => updateItem(index, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => removeItem(index)}
                    disabled={items.length <= 1}
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
              onClick={addItem}
              style={{ marginTop: 8, width: '100%' }}
            >
              + Add Item
            </button>
          </div>

          {/* Targets Column */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
              Drop Targets
            </label>
            <div style={{ display: 'grid', gap: 8 }}>
              {targets.map((target, index) => (
                <div key={index} style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="form-control"
                    placeholder={`Target ${index + 1}`}
                    value={target}
                    onChange={(e) => updateTarget(index, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => removeTarget(index)}
                    disabled={targets.length <= 1}
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
              onClick={addTarget}
              style={{ marginTop: 8, width: '100%' }}
            >
              + Add Target
            </button>
          </div>
        </div>

        {/* Correct Mappings */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Correct Matches
          </label>
          <div style={{
            padding: 16,
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            background: '#fafafa'
          }}>
            {items.map((item, index) => (
              <div key={index} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                gap: 12,
                alignItems: 'center',
                marginBottom: 8,
                padding: 8,
                background: '#fff',
                borderRadius: 6
              }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{item}</div>
                <div style={{ color: '#666' }}>→</div>
                <select
                  className="form-control"
                  value={correct[item] || ''}
                  onChange={(e) => updateCorrectMapping(item, e.target.value)}
                  style={{ width: '100%' }}
                >
                  {targets.map((target, i) => (
                    <option key={i} value={target}>{target}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          padding: 12,
          background: '#e1f5fe',
          borderRadius: 8,
          marginBottom: 20,
          fontSize: 14,
          color: '#01579b'
        }}>
          💡 <strong>Tip:</strong> Define which item should be dragged to which target
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
            style={{ padding: '8px 20px', background: '#2196f3', border: 'none' }}
          >
            Add Drag & Drop
          </button>
        </div>
      </div>
    </div>
  );
}
