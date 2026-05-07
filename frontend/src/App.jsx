import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/layout/Layout';
import { AuthProvider, useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import PdfList from './pages/PdfList';
import PdfUpload from './pages/PdfUpload';
import Conversions from './pages/org/Conversions';
import ConversionJobs from './pages/org/ConversionJobs';
import ImageFxlEditor from './pages/org/ImageFxlEditor';
import AudioSyncStudio from './pages/org/AudioSyncStudio';
import DownloadEpub from './pages/org/DownloadEpub';
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
import Exports from './pages/Exports';
import EpubReaderPage from './pages/EpubReaderPage';
import AdminOrganizations from './pages/admin/AdminOrganizations';
import AdminPlans from './pages/admin/AdminPlans';
import OrgTeam from './pages/org/OrgTeam';
import MediaLibrary from './pages/org/MediaLibrary';
import Usage from './pages/org/usage';
import InteractiveBooks from './pages/interactive/InteractiveBooks';
import InteractiveEditor from './pages/interactive/InteractiveEditor';
import InteractiveEditorEnhanced from './pages/interactive/InteractiveEditorEnhanced';
import InteractiveReader from './pages/interactive/InteractiveReader';
import Activity from './pages/Activity';
import { hasFeature } from './utils/features';

function RequireAuthLayout() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

function RequirePlatformAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role !== 'platform_admin') return <Navigate to="/" replace />;
  return children;
}

function RequireOrgAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role !== 'org_admin') return <Navigate to="/" replace />;
  return children;
}

function RequirePlanFeature({ featureKey, children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!hasFeature(user, featureKey)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<RequireAuthLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="pdfs" element={<PdfList />} />
          <Route path="chapter-plan/:pdfId" element={<ChapterSelector />} />
          <Route path="pdfs/upload" element={<PdfUpload />} />
          <Route path="conversions" element={<ConversionJobs />} />
          <Route path="conversions/fxl-editor" element={<ImageFxlEditor />} />
          <Route path="conversions/fxl-editor/:jobId" element={<ImageFxlEditor />} />
          <Route path="image-editor/:jobId" element={<EpubImageEditorPage />} />
          <Route path="fxl-studio/:jobId" element={<KitabooZoningStudio />} />
          <Route path="conversions/audio-sync" element={<AudioSyncStudio />} />

          <Route path="conversions/audio-sync/:jobId" element={<AudioSyncStudio />} />
          <Route path="conversions/download" element={<DownloadEpub />} />
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
          <Route path="exports" element={<Exports />} />
          <Route path="org/media-library" element={<MediaLibrary />} />
          <Route path="org/usage" element={<Usage />} />
          
          <Route 
          path="activity" 
          element={<Activity />} 
          />
          <Route
            path="admin/organizations"
            element={
              <RequirePlatformAdmin>
                <AdminOrganizations />
              </RequirePlatformAdmin>
            }
          />
          <Route
            path="admin/plans"
            element={
              <RequirePlatformAdmin>
                <AdminPlans />
              </RequirePlatformAdmin>
            }
          />
          <Route
            path="org/team"
            element={
              <RequireOrgAdmin>
                <OrgTeam />
              </RequireOrgAdmin>
            }
          />
          <Route
            path="interactive"
            element={
              <RequirePlanFeature featureKey="interactive.content">
                <InteractiveBooks />
              </RequirePlanFeature>
            }
          />
          <Route
            path="interactive/reader/:bookId"
            element={
              <RequirePlanFeature featureKey="interactive.content">
                <InteractiveReader />
              </RequirePlanFeature>
            }
          />
          <Route
            path="interactive/editor/:bookId"
            element={
              <RequireOrgAdmin>
                <RequirePlanFeature featureKey="interactive.content">
                  <InteractiveEditorEnhanced />
                </RequirePlanFeature>
              </RequireOrgAdmin>
            }
          />
          <Route
            path="interactive/editor-classic/:bookId"
            element={
              <RequireOrgAdmin>
                <RequirePlanFeature featureKey="interactive.content">
                  <InteractiveEditor />
                </RequirePlanFeature>
              </RequireOrgAdmin>
            }
          />
        </Route>
      </Routes>
    </Router>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
