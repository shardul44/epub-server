import React, { useState, useRef } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';
import QuizModal from './QuizModal';
import ImageModal from './ImageModal';
import AudioModal from './AudioModal';
import DragDropModal from './DragDropModal';
import './CKEditorEnhanced.css';

export default function CKEditorEnhanced({ onAddBlock }) {
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showDragDropModal, setShowDragDropModal] = useState(false);
  const [editorData, setEditorData] = useState('');
  const editorRef = useRef(null);

  const handleAddTextBlock = () => {
    if (editorData && editorData.trim() !== '' && editorData !== '<p>&nbsp;</p>') {
      onAddBlock({ type: 'text', content: editorData });
      // Clear editor
      if (editorRef.current) {
        editorRef.current.setData('');
      }
      setEditorData('');
    }
  };

  // Handle paste event for images
  const handleEditorReady = (editor) => {
    editorRef.current = editor;

    // Listen for paste events
    editor.editing.view.document.on('clipboardInput', (evt, data) => {
      const dataTransfer = data.dataTransfer;
      
      // Check if there are files
      if (dataTransfer.files && dataTransfer.files.length > 0) {
        const file = dataTransfer.files[0];
        
        // Check if it's an image
        if (file.type.startsWith('image/')) {
          evt.stop(); // Prevent default CKEditor handling
          
          // Check file size (max 5MB)
          if (file.size > 5 * 1024 * 1024) {
            alert('Image size must be less than 5MB');
            return;
          }
          
          // Convert to base64
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64 = e.target.result;
            onAddBlock({ 
              type: 'image', 
              data: {
                url: base64,
                alt: 'Pasted image',
                caption: '',
                width: '100%'
              }
            });
          };
          reader.readAsDataURL(file);
        }
      }
    }, { priority: 'high' });

    // Handle drop events
    editor.editing.view.document.on('drop', (evt, data) => {
      const dataTransfer = data.dataTransfer;
      
      if (dataTransfer.files && dataTransfer.files.length > 0) {
        const file = dataTransfer.files[0];
        
        if (file.type.startsWith('image/')) {
          evt.stop();
          
          // Check file size
          if (file.size > 5 * 1024 * 1024) {
            alert('Image size must be less than 5MB');
            return;
          }
          
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64 = e.target.result;
            onAddBlock({ 
              type: 'image', 
              data: {
                url: base64,
                alt: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
                caption: '',
                width: '100%'
              }
            });
          };
          reader.readAsDataURL(file);
        }
      }
    }, { priority: 'high' });
  };

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
      {/* Custom Toolbar */}
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid #e0e0e0', 
        background: 'linear-gradient(to bottom, #fafafa, #f5f5f5)',
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        {/* Interactive Blocks Section */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowQuizModal(true)}
            title="Add Quiz"
            style={{ padding: '6px 12px', background: '#9c27b0', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            ❓ Quiz
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowImageModal(true)}
            title="Add Image"
            style={{ padding: '6px 12px', background: '#4caf50', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            🖼️ Image
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowAudioModal(true)}
            title="Add Audio"
            style={{ padding: '6px 12px', background: '#ff9800', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            🔊 Audio
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowDragDropModal(true)}
            title="Add Drag & Drop"
            style={{ padding: '6px 12px', background: '#2196f3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            🎯 Drag-Drop
          </button>
        </div>

        {/* Save Text Block */}
        <button
          type="button"
          className="btn btn-success"
          onClick={handleAddTextBlock}
          title="Add Text Block"
          style={{ padding: '6px 16px', background: '#4caf50', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          ✓ Add Text Block
        </button>
      </div>

      {/* CKEditor */}
      <div style={{ 
        padding: '20px', 
        minHeight: '300px', 
        background: '#fff',
        position: 'relative'
      }}>
        <CKEditor
          editor={ClassicEditor}
          data={editorData}
          onReady={handleEditorReady}
          onChange={(event, editor) => {
            const data = editor.getData();
            setEditorData(data);
          }}
          config={{
            placeholder: 'Start writing your content...',
            toolbar: [
              'heading', '|',
              'bold', 'italic', 'strikethrough', '|',
              'link', '|',
              'bulletedList', 'numberedList', '|',
              'undo', 'redo'
            ]
          }}
        />
        
        {/* Paste hint */}
        {(!editorData || editorData === '') && (
          <div style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            padding: '8px 12px',
            background: '#e3f2fd',
            border: '1px solid #2196f3',
            borderRadius: 6,
            fontSize: 12,
            color: '#1565c0',
            pointerEvents: 'none'
          }}>
            💡 Tip: Paste images here with Ctrl+V
          </div>
        )}
      </div>

      {/* Modals */}
      {showQuizModal && (
        <QuizModal
          onAdd={(quizData) => {
            onAddBlock({ type: 'quiz', data: quizData });
            setShowQuizModal(false);
          }}
          onClose={() => setShowQuizModal(false)}
        />
      )}

      {showImageModal && (
        <ImageModal
          onAdd={(imageData) => {
            onAddBlock({ type: 'image', data: imageData });
            setShowImageModal(false);
          }}
          onClose={() => setShowImageModal(false)}
        />
      )}

      {showAudioModal && (
        <AudioModal
          onAdd={(audioData) => {
            onAddBlock({ type: 'audio', data: audioData });
            setShowAudioModal(false);
          }}
          onClose={() => setShowAudioModal(false)}
        />
      )}

      {showDragDropModal && (
        <DragDropModal
          onAdd={(dragDropData) => {
            onAddBlock({ type: 'dragdrop', data: dragDropData });
            setShowDragDropModal(false);
          }}
          onClose={() => setShowDragDropModal(false)}
        />
      )}
    </div>
  );
}
