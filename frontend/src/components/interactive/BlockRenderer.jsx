import React, { useState } from 'react';

export default function BlockRenderer({ block, onDelete, onEdit }) {
  const [userAnswer, setUserAnswer] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [draggedItem, setDraggedItem] = useState(null);
  const [dropMatches, setDropMatches] = useState({});

  const renderTextBlock = () => {
    return (
      <div
        className="text-block"
        dangerouslySetInnerHTML={{ __html: block.content }}
        style={{
          padding: 16,
          background: '#fff',
          borderRadius: 8,
          lineHeight: 1.6
        }}
      />
    );
  };

  const renderQuizBlock = () => {
    const { question, options, answer } = block.data;
    const isAnswered = userAnswer !== null;
    const isCorrect = userAnswer === answer;

    return (
      <div style={{
        padding: 20,
        background: '#f8f4ff',
        border: '2px solid #9c27b0',
        borderRadius: 12
      }}>
        <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 16, color: '#6a1b9a' }}>
          ❓ Quiz Question
        </div>
        <div style={{ fontSize: 16, marginBottom: 16, fontWeight: 500 }}>
          {question}
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => {
                setUserAnswer(i);
                setFeedback(i === answer ? '✓ Correct!' : '✗ Incorrect. Try again!');
              }}
              disabled={isAnswered}
              style={{
                padding: 12,
                border: '2px solid',
                borderColor: isAnswered
                  ? i === answer
                    ? '#4caf50'
                    : i === userAnswer
                    ? '#f44336'
                    : '#e0e0e0'
                  : '#9c27b0',
                borderRadius: 8,
                background: isAnswered
                  ? i === answer
                    ? '#e8f5e9'
                    : i === userAnswer
                    ? '#ffebee'
                    : '#fff'
                  : '#fff',
                cursor: isAnswered ? 'default' : 'pointer',
                textAlign: 'left',
                fontSize: 15,
                fontWeight: 500,
                transition: 'all 0.2s'
              }}
            >
              {opt}
            </button>
          ))}
        </div>
        {feedback && (
          <div style={{
            marginTop: 16,
            padding: 12,
            background: isCorrect ? '#e8f5e9' : '#ffebee',
            color: isCorrect ? '#2e7d32' : '#c62828',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 15
          }}>
            {feedback}
          </div>
        )}
        {isAnswered && (
          <button
            onClick={() => {
              setUserAnswer(null);
              setFeedback('');
            }}
            style={{
              marginTop: 12,
              padding: '8px 16px',
              background: '#9c27b0',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Try Again
          </button>
        )}
      </div>
    );
  };

  const renderImageBlock = () => {
    const { url, alt, caption, width } = block.data;
    return (
      <div style={{
        padding: 16,
        background: '#fff',
        borderRadius: 8,
        textAlign: 'center'
      }}>
        <img
          src={url}
          alt={alt || 'Image'}
          style={{
            maxWidth: width || '100%',
            height: 'auto',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
        />
        {caption && (
          <div style={{
            marginTop: 12,
            fontSize: 14,
            color: '#666',
            fontStyle: 'italic'
          }}>
            {caption}
          </div>
        )}
      </div>
    );
  };

  const renderAudioBlock = () => {
    const { src, title } = block.data;
    return (
      <div style={{
        padding: 20,
        background: '#fff3e0',
        border: '2px solid #ff9800',
        borderRadius: 12
      }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 12, color: '#e65100' }}>
          🔊 {title || 'Audio'}
        </div>
        <audio
          controls
          src={src}
          style={{
            width: '100%',
            borderRadius: 8
          }}
        />
      </div>
    );
  };

  const renderDragDropBlock = () => {
    const { question, items, targets, correct } = block.data;
    const allMatched = items.every(item => dropMatches[item]);
    const isCorrect = allMatched && items.every(item => dropMatches[item] === correct[item]);

    return (
      <div style={{
        padding: 20,
        background: '#e3f2fd',
        border: '2px solid #2196f3',
        borderRadius: 12
      }}>
        <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 16, color: '#1565c0' }}>
          🎯 Drag & Drop Activity
        </div>
        <div style={{ fontSize: 16, marginBottom: 20, fontWeight: 500 }}>
          {question}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Items */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Drag these:</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {items.filter(item => !dropMatches[item]).map((item, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={() => setDraggedItem(item)}
                  onDragEnd={() => setDraggedItem(null)}
                  style={{
                    padding: 12,
                    background: '#fff',
                    border: '2px solid #2196f3',
                    borderRadius: 8,
                    cursor: 'grab',
                    fontWeight: 500,
                    textAlign: 'center',
                    transition: 'all 0.2s'
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Targets */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Drop here:</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {targets.map((target, i) => {
                const matchedItem = Object.keys(dropMatches).find(
                  item => dropMatches[item] === target
                );
                return (
                  <div
                    key={i}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (draggedItem) {
                        setDropMatches({ ...dropMatches, [draggedItem]: target });
                      }
                    }}
                    style={{
                      padding: 12,
                      background: matchedItem ? '#e8f5e9' : '#f5f5f5',
                      border: '2px dashed',
                      borderColor: matchedItem ? '#4caf50' : '#bdbdbd',
                      borderRadius: 8,
                      minHeight: 48,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 500,
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
                      {target}
                    </div>
                    {matchedItem && (
                      <div style={{
                        marginTop: 8,
                        padding: 8,
                        background: '#fff',
                        borderRadius: 6,
                        fontWeight: 600,
                        color: '#2e7d32'
                      }}>
                        {matchedItem}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {allMatched && (
          <div style={{
            marginTop: 20,
            padding: 12,
            background: isCorrect ? '#e8f5e9' : '#ffebee',
            color: isCorrect ? '#2e7d32' : '#c62828',
            borderRadius: 8,
            fontWeight: 600,
            textAlign: 'center'
          }}>
            {isCorrect ? '✓ Perfect! All matches are correct!' : '✗ Some matches are incorrect. Try again!'}
          </div>
        )}

        {allMatched && (
          <button
            onClick={() => setDropMatches({})}
            style={{
              marginTop: 12,
              padding: '8px 16px',
              background: '#2196f3',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 500,
              width: '100%'
            }}
          >
            Reset
          </button>
        )}
      </div>
    );
  };

  const renderBlock = () => {
    switch (block.type) {
      case 'text':
        return renderTextBlock();
      case 'quiz':
        return renderQuizBlock();
      case 'image':
        return renderImageBlock();
      case 'audio':
        return renderAudioBlock();
      case 'dragdrop':
        return renderDragDropBlock();
      default:
        return (
          <div style={{ padding: 16, color: '#666', fontStyle: 'italic' }}>
            Unknown block type: {block.type}
          </div>
        );
    }
  };

  return (
    <div style={{
      marginBottom: 16,
      border: '1px solid #e0e0e0',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    }}>
      {renderBlock()}
      
      {(onDelete || onEdit) && (
        <div style={{
          padding: 12,
          background: '#fafafa',
          borderTop: '1px solid #e0e0e0',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end'
        }}>
          {onEdit && (
            <button
              onClick={() => onEdit(block)}
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: 14 }}
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(block)}
              className="btn btn-danger"
              style={{ padding: '6px 12px', fontSize: 14 }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
