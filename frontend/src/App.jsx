import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import PdfList from './pages/PdfList';
import PdfUpload from './pages/PdfUpload';
import Conversions from './pages/Conversions';
import SyncStudio from './pages/SyncStudio';
import MediaOverlaySyncEditor from './pages/MediaOverlaySyncEditor';
import AudioScript from './pages/AudioScript';
import AiConfig from './pages/AiConfig';
import TtsManagement from './pages/TtsManagement';
import EpubImageEditorPage from './pages/EpubImageEditorPage';
import ChapterSelector from './pages/ChapterSelector';
import KitabooZoningStudio from './pages/KitabooZoningStudio';
import FxlSyncStudio from './pages/FxlSyncStudio';
import ClassicFxlStudio from './pages/ClassicFxlStudio';
import ApiDebugger from './components/ApiDebugger';
import Accessibility from './pages/Accessibility';
import EpubCheckerPage from './pages/EpubCheckerPage';
import EpubSyncImport from './pages/EpubSyncImport';
import EpubReaderPage from './pages/EpubReaderPage';

function RequireAuthLayout() {
  const [status, setStatus] = useState('checking'); // 'checking' | 'authed' | 'unauth'

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setStatus('unauth');
      return;
    }

    let cancelled = false;
    const checkAuth = async () => {
      try {
        // Uses axios interceptors from api.js (Authorization header is added automatically)
        // eslint-disable-next-line import/no-named-as-default
        const apiModule = await import('./services/api');
        const api = apiModule.default;
        await api.get('/auth/me');
        if (!cancelled) setStatus('authed');
      } catch (_e) {
        localStorage.removeItem('token');
        if (!cancelled) setStatus('unauth');
      }
    };

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'checking') return null;
  if (status === 'unauth') return <Navigate to="/login" replace />;
  return <Layout />;
}

function App() {
  return (
    <ErrorBoundary>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<RequireAuthLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="pdfs" element={<PdfList />} />
            <Route path="chapter-plan/:pdfId" element={<ChapterSelector />} />
            <Route path="pdfs/upload" element={<PdfUpload />} />
            <Route path="conversions" element={<Conversions />} />
            <Route path="reader/epub/:jobId" element={<EpubReaderPage />} />
            <Route path="sync-studio/:jobId" element={<SyncStudio />} />
            <Route path="audio-script/:jobId" element={<AudioScript />} />
            <Route path="media-overlay-sync/:jobId/:pageNumber" element={<MediaOverlaySyncEditor />} />
            <Route path="epub-image-editor/:jobId" element={<EpubImageEditorPage />} />
            <Route path="ai-config" element={<AiConfig />} />
            <Route path="tts-management" element={<TtsManagement />} />
            <Route path="kitaboo-studio/:jobId" element={<KitabooZoningStudio />} />
            <Route path="fxl-sync-studio/:jobId" element={<FxlSyncStudio />} />
            <Route path="classic-fxl/:jobId" element={<ClassicFxlStudio />} />
            <Route path="api-debugger" element={<ApiDebugger />} />
            <Route path="accessibility" element={<Accessibility />} />
            <Route path="epub-checker" element={<EpubCheckerPage />} />
            <Route path="epub-sync-import" element={<EpubSyncImport />} />
          </Route>
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

export default App;

