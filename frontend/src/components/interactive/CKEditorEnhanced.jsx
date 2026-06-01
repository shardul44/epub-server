import React, { useState, useRef } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';
import {
  Check,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Volume2,
} from 'lucide-react';
import QuizModal from './QuizModal';
import ImageModal from './ImageModal';
import AudioModal from './AudioModal';
import DragDropModal from './DragDropModal';
import './CKEditorEnhanced.css';

const toolbarIcon = { size: 16, strokeWidth: 2, 'aria-hidden': true };

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
      if (editorRef.current) {
        editorRef.current.setData('');
      }
      setEditorData('');
    }
  };

  const handleEditorReady = (editor) => {
    editorRef.current = editor;

    editor.editing.view.document.on(
      'clipboardInput',
      (evt, data) => {
        const dataTransfer = data.dataTransfer;
        if (dataTransfer.files && dataTransfer.files.length > 0) {
          const file = dataTransfer.files[0];
          if (file.type.startsWith('image/')) {
            evt.stop();
            if (file.size > 5 * 1024 * 1024) {
              alert('Image size must be less than 5MB');
              return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
              onAddBlock({
                type: 'image',
                data: {
                  url: e.target.result,
                  alt: 'Pasted image',
                  caption: '',
                  width: '100%',
                },
              });
            };
            reader.readAsDataURL(file);
          }
        }
      },
      { priority: 'high' },
    );

    editor.editing.view.document.on(
      'drop',
      (evt, data) => {
        const dataTransfer = data.dataTransfer;
        if (dataTransfer.files && dataTransfer.files.length > 0) {
          const file = dataTransfer.files[0];
          if (file.type.startsWith('image/')) {
            evt.stop();
            if (file.size > 5 * 1024 * 1024) {
              alert('Image size must be less than 5MB');
              return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
              onAddBlock({
                type: 'image',
                data: {
                  url: e.target.result,
                  alt: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
                  caption: '',
                  width: '100%',
                },
              });
            };
            reader.readAsDataURL(file);
          }
        }
      },
      { priority: 'high' },
    );
  };

  return (
    <div className="cke-panel">
      <div className="cke-panel__toolbar">
        <span className="cke-panel__toolbar-label">Quick blocks</span>
        <div className="cke-panel__toolbar-actions">
          <button
            type="button"
            className="cke-tool-btn cke-tool-btn--quiz"
            onClick={() => setShowQuizModal(true)}
            title="Add Quiz"
          >
            <HelpCircle {...toolbarIcon} />
            Quiz
          </button>
          <button
            type="button"
            className="cke-tool-btn cke-tool-btn--image"
            onClick={() => setShowImageModal(true)}
            title="Add Image"
          >
            <ImageIcon {...toolbarIcon} />
            Image
          </button>
          <button
            type="button"
            className="cke-tool-btn cke-tool-btn--audio"
            onClick={() => setShowAudioModal(true)}
            title="Add Audio"
          >
            <Volume2 {...toolbarIcon} />
            Audio
          </button>
          <button
            type="button"
            className="cke-tool-btn cke-tool-btn--drag"
            onClick={() => setShowDragDropModal(true)}
            title="Add Drag & Drop"
          >
            <Layers {...toolbarIcon} />
            Drag-Drop
          </button>
          <button
            type="button"
            className="cke-tool-btn cke-tool-btn--primary"
            onClick={handleAddTextBlock}
            title="Add Text Block"
          >
            <Check {...toolbarIcon} />
            Add text block
          </button>
        </div>
      </div>

      <div className="cke-panel__editor">
        <CKEditor
          editor={ClassicEditor}
          data={editorData}
          onReady={handleEditorReady}
          onChange={(event, editor) => {
            setEditorData(editor.getData());
          }}
          config={{
            placeholder: 'Write lesson content here, then click “Add text block”…',
          }}
        />

        {(!editorData || editorData === '') && (
          <div className="cke-panel__hint">
            <Lightbulb size={16} strokeWidth={2} aria-hidden />
            <span>Tip: Paste images with Ctrl+V</span>
          </div>
        )}
      </div>

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
