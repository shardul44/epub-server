import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { conversionService } from '../services/conversionService';

/**
 * Upload an EPUB and jump straight to audio sync (reflowable Sync Studio or FXL Sync Studio).
 */
const EpubSyncImport = () => {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please choose an EPUB file.');
      return;
    }
    const name = (file.name || '').toLowerCase();
    if (!name.endsWith('.epub')) {
      setError('File must be a .epub package.');
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setError('File size must be under 200MB.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const result = await conversionService.importEpubForSync(file, mode);
      if (result.kind === 'fxl' && result.fxlSyncStudioPath) {
        navigate(result.fxlSyncStudioPath);
        return;
      }
      if (result.kind === 'reflowable' && result.syncStudioPath) {
        navigate(result.syncStudioPath);
        return;
      }
      setError('Unexpected server response. Try again or pick a different layout mode.');
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Import failed.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <h1>EPUB → audio sync</h1>
      <p style={{ color: '#555', maxWidth: '42rem', lineHeight: 1.5 }}>
        Skip PDF conversion and zoning when you already have an EPUB. Reflowable books open in{' '}
        <strong>Sync Studio</strong>; fixed-layout (FXL) books open in <strong>FXL Sync Studio</strong> when the EPUB
        uses the usual page structure (background image plus sync zones). For FXL from other tools, try{' '}
        <strong>Reflowable</strong> if auto-detect fails.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ marginTop: '1rem' }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>EPUB file</label>
            <input type="file" accept=".epub,application/epub+zip" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
          </div>

          <div className="form-group">
            <label>Layout</label>
            <select className="form-control" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="auto">Auto (from EPUB metadata)</option>
              <option value="reflowable">Reflowable — Sync Studio</option>
              <option value="fxl">Fixed layout — FXL Sync Studio</option>
            </select>
            <p style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
              Auto uses <code>rendition:layout</code> in the package. Choose manually if the wrong studio opens.
            </p>
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Importing…' : 'Import and open sync'}
          </button>
        </form>
      </div>

      <p style={{ marginTop: '1.5rem', fontSize: '14px' }}>
        <Link to="/conversions">Back to conversions</Link>
      </p>
    </div>
  );
};

export default EpubSyncImport;
