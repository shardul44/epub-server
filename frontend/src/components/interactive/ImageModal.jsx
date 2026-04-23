import React, { useState, useRef, useEffect } from 'react';

export default function ImageModal({ onAdd, onClose }) {
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [width, setWidth] = useState('100%');
  const [uploadMode, setUploadMode] = useState('url'); // 'url' or 'upload'
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const modalRef = useRef(null);

  // Handle paste from clipboard (only within modal)
  useEffect(() => {
    const handlePaste = (e) => {
      // Only handle if modal is the target or contains the target
      if (!modalRef.current?.contains(e.target)) return;
      
      // Only handle paste if we're in upload mode
      if (uploadMode !== 'upload') return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          e.stopPropagation();
          const file = items[i].getAsFile();
          handleImageFile(file);
          break;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [uploadMode]); // Re-run when uploadMode changes

  // Convert image file to base64
  const handleImageFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size must be less than 5MB');
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const base64 = e.target.result;
      setUrl(base64);
      setPreviewUrl(base64);
      setUploadMode('upload');
      setUploading(false);
      
      // Auto-generate alt text from filename
      if (!alt && file.name) {
        const filename = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setAlt(filename);
      }
    };

    reader.onerror = () => {
      alert('Failed to read image file');
      setUploading(false);
    };

    reader.readAsDataURL(file);
  };

  // Handle file input change
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageFile(file);
    }
  };

  // Handle drag and drop
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) {
      dropZoneRef.current.style.borderColor = '#4caf50';
      dropZoneRef.current.style.background = '#f1f8f4';
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) {
      dropZoneRef.current.style.borderColor = '#e0e0e0';
      dropZoneRef.current.style.background = '#fafafa';
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dropZoneRef.current) {
      dropZoneRef.current.style.borderColor = '#e0e0e0';
      dropZoneRef.current.style.background = '#fafafa';
    }

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleImageFile(file);
    }
  };

  const handleSubmit = () => {
    if (!url.trim()) {
      alert('Please provide an image (URL, upload, or paste)');
      return;
    }

    onAdd({
      url: url.trim(),
      alt: alt.trim() || 'Image',
      caption: caption.trim(),
      width: width || '100%'
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
      <div 
        ref={modalRef}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          width: '90%',
          maxWidth: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
        }}
      >
        <h2 style={{ margin: '0 0 20px 0', fontSize: 24, fontWeight: 700 }}>
          Add Image
        </h2>

        {/* Tab Selection */}
        <div style={{ 
          display: 'flex', 
          gap: 8, 
          marginBottom: 20,
          borderBottom: '2px solid #e0e0e0'
        }}>
          <button
            type="button"
            onClick={() => setUploadMode('url')}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: uploadMode === 'url' ? '3px solid #4caf50' : '3px solid transparent',
              fontWeight: uploadMode === 'url' ? 600 : 400,
              color: uploadMode === 'url' ? '#4caf50' : '#666',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            🔗 URL
          </button>
          <button
            type="button"
            onClick={() => setUploadMode('upload')}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: uploadMode === 'upload' ? '3px solid #4caf50' : '3px solid transparent',
              fontWeight: uploadMode === 'upload' ? 600 : 400,
              color: uploadMode === 'upload' ? '#4caf50' : '#666',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            📤 Upload
          </button>
        </div>

        {/* URL Input */}
        {uploadMode === 'url' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
              Image URL *
            </label>
            <input
              type="url"
              className="form-control"
              placeholder="https://example.com/image.jpg"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreviewUrl(e.target.value);
              }}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {/* Upload/Paste/Drop Zone */}
        {uploadMode === 'upload' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
              Upload Image
            </label>
            
            {/* Drop Zone */}
            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: '2px dashed #e0e0e0',
                borderRadius: 8,
                padding: 30,
                textAlign: 'center',
                background: '#fafafa',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <div>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
                  <div style={{ color: '#666' }}>Processing image...</div>
                </div>
              ) : url ? (
                <div>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
                  <div style={{ color: '#4caf50', fontWeight: 600 }}>Image loaded!</div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                    Click to change
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 48, marginBottom: 10 }}>📁</div>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    Drop image here, paste (Ctrl+V), or click to browse
                  </div>
                  <div style={{ fontSize: 14, color: '#666' }}>
                    Supports: JPG, PNG, GIF, SVG (max 5MB)
                  </div>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            <div style={{
              marginTop: 12,
              padding: 10,
              background: '#e3f2fd',
              borderRadius: 6,
              fontSize: 13,
              color: '#1565c0'
            }}>
              💡 <strong>Tip:</strong> You can paste images directly from clipboard (Ctrl+V)
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Alt Text (for accessibility)
          </label>
          <input
            type="text"
            className="form-control"
            placeholder="Describe the image"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Caption (optional)
          </label>
          <input
            type="text"
            className="form-control"
            placeholder="Image caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Width
          </label>
          <select
            className="form-control"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="100%">Full Width (100%)</option>
            <option value="75%">Large (75%)</option>
            <option value="50%">Medium (50%)</option>
            <option value="25%">Small (25%)</option>
          </select>
        </div>

        {(previewUrl || url) && (
          <div style={{
            marginBottom: 20,
            padding: 12,
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            background: '#fafafa'
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Preview:</div>
            <img
              src={previewUrl || url}
              alt={alt || 'Preview'}
              style={{ maxWidth: '100%', maxHeight: 200, display: 'block', margin: '0 auto' }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <div style={{ display: 'none', color: '#f44336', fontSize: 14, marginTop: 8 }}>
              ⚠️ Failed to load image. Check the URL.
            </div>
          </div>
        )}

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
            style={{ padding: '8px 20px', background: '#4caf50', border: 'none' }}
          >
            Add Image
          </button>
        </div>
      </div>
    </div>
  );
}
