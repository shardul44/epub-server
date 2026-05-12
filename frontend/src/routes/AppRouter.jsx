/**
 * AppRouter — central route definition for the entire app.
 *
 * Structure (React Router v6 nested layout routes):
 *
 *   /login, /register                          → no layout (public)
 *
 *   /  (RequireAuth → RootLayout)              → role-based shell
 *     index                                    → Dashboard
 *     pdfs, conversions, exports, …            → normal pages
 *     conversions/fxl-editor (no :jobId)       → ImageFxlEditor selector
 *     audio-sync, download, …                  → standard pages
 *     admin/*  (RequireRole platform_admin)
 *     org/team (RequireRole org_admin)
 *     interactive/*  (RequireFeature)
 *
 *   /studios (RequireAuth → StudioLayout)      → full-screen-only tools
 *     classic-fxl/:jobId, media-overlay-sync/… (no org sidebar)
 *
 *   Job studios under RootLayout (sidebar + workflow chrome on each page):
 *     conversions/fxl-editor/:jobId, image-editor/:jobId, kitaboo-studio/:jobId,
 *     epub-image-editor/:jobId, fxl-studio/:jobId, audio-sync/fxl and reflow :jobId,
 *     fxl-sync-studio/:jobId, sync-studio/:jobId (legacy /audio-sync/fxl|reflow/:jobId → Navigate)
 *
 * Heavy studio pages are lazy-loaded so the initial bundle stays small.
 * Legacy `/audio-sync/fxl|reflow/:jobId` URLs redirect (replace) to the canonical studio paths.
 */
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import RootLayout from '../layouts/RootLayout';
import StudioLayout from '../layouts/StudioLayout';
import RouteFallback from '../layouts/RouteFallback';
import {
  RequireAuth,
  RequirePlatformAdmin,
  RequireOrgAdmin,
  RequirePlanFeature,
} from './guards';

/* ─── Eagerly-loaded "shell" pages ────────────────────────────── */
import Dashboard from '../pages/Dashboard';
import Login from '../pages/Login';
import Register from '../pages/Register';

/* ─── Lazy-loaded pages (one chunk per page) ──────────────────── */
const PdfList                 = lazy(() => import('../pages/PdfList'));
const PdfUpload               = lazy(() => import('../pages/PdfUpload'));
const ChapterSelector         = lazy(() => import('../pages/ChapterSelector'));
const ConversionJobs          = lazy(() => import('../pages/org/ConversionJobs'));
const ImageFxlEditor          = lazy(() => import('../pages/org/ImageFxlEditor'));
const AudioSyncStudio         = lazy(() => import('../pages/org/AudioSyncStudio'));
const DownloadEpub            = lazy(() => import('../pages/org/DownloadEpub'));
const SyncStudio              = lazy(() => import('../pages/SyncStudio'));
const MediaOverlaySyncEditor  = lazy(() => import('../pages/MediaOverlaySyncEditor'));
const AudioScript             = lazy(() => import('../pages/AudioScript'));
const AiConfig                = lazy(() => import('../pages/AiConfig'));
const TtsManagement           = lazy(() => import('../pages/TtsManagement'));
const EpubImageEditorPage     = lazy(() => import('../pages/EpubImageEditorPage'));
const KitabooZoningStudio     = lazy(() => import('../pages/KitabooZoningStudio'));
const FxlSyncStudio           = lazy(() => import('../pages/FxlSyncStudio'));
const ClassicFxlStudio        = lazy(() => import('../pages/ClassicFxlStudio'));
const Accessibility           = lazy(() => import('../pages/Accessibility'));
const EpubCheckerPage         = lazy(() => import('../pages/EpubCheckerPage'));
const EpubSyncImport          = lazy(() => import('../pages/EpubSyncImport'));
const Exports                 = lazy(() => import('../pages/Exports'));
const EpubReaderPage          = lazy(() => import('../pages/EpubReaderPage'));
const AdminOrganizations      = lazy(() => import('../pages/admin/AdminOrganizations'));
const AdminPlans              = lazy(() => import('../pages/admin/AdminPlans'));
const UsersManagement         = lazy(() => import('../pages/admin/UsersManagement'));
const AdminStubPage           = lazy(() => import('../pages/admin/AdminStubPage'));
const PlatformAnalytics       = lazy(() => import('../pages/admin/PlatformAnalytics'));
const OrgTeam                 = lazy(() => import('../pages/org/OrgTeam'));
const MediaLibrary            = lazy(() => import('../pages/org/MediaLibrary'));
const Usage                   = lazy(() => import('../pages/org/usage'));
const InteractiveBooks        = lazy(() => import('../pages/interactive/InteractiveBooks'));
const InteractiveEditor       = lazy(() => import('../pages/interactive/InteractiveEditor'));
const InteractiveEditorEnhanced = lazy(() => import('../pages/interactive/InteractiveEditorEnhanced'));
const InteractiveReader       = lazy(() => import('../pages/interactive/InteractiveReader'));
const Activity                = lazy(() => import('../pages/Activity'));
const ActivityPage            = lazy(() => import('../pages/admin/ActivityPage'));
const ApiDebugger             = lazy(() => import('../components/ApiDebugger'));

/* ─── Helper: wrap a lazy element in a local Suspense fallback ── */
const lazyEl = (Component, props) => (
  <Suspense fallback={<RouteFallback />}>
    <Component {...(props || {})} />
  </Suspense>
);

/** Legacy /audio-sync/reflow/:jobId → canonical /sync-studio/:jobId */
function LegacyReflowSyncRedirect() {
  const { jobId } = useParams();
  if (jobId == null || jobId === '') return <Navigate to="/conversions/audio-sync" replace />;
  return <Navigate to={`/sync-studio/${jobId}`} replace />;
}

/** Legacy /audio-sync/fxl/:jobId → canonical /fxl-sync-studio/:jobId */
function LegacyFxlSyncRedirect() {
  const { jobId } = useParams();
  if (jobId == null || jobId === '') return <Navigate to="/conversions/audio-sync" replace />;
  return <Navigate to={`/fxl-sync-studio/${jobId}`} replace />;
}

export default function AppRouter() {
  return (
    <Routes>
      {/* ── Public routes ────────────────────────────────────────── */}
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* ── Authenticated full-screen routes (no workflow sidebar shell) ─ */}
      <Route element={<RequireAuth />}>
        <Route element={<StudioLayout />}>
          <Route path="/classic-fxl/:jobId"              element={lazyEl(ClassicFxlStudio)} />
          <Route path="/media-overlay-sync/:jobId/:pageNumber" element={lazyEl(MediaOverlaySyncEditor)} />
        </Route>
      </Route>

      {/* ── Authenticated standard routes (sidebar shell) ──────── */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<RootLayout />}>
          <Route index element={<Dashboard />} />

          <Route path="pdfs"                element={lazyEl(PdfList)} />
          <Route path="pdfs/upload"         element={lazyEl(PdfUpload)} />
          <Route path="chapter-plan/:pdfId" element={lazyEl(ChapterSelector)} />

          {/* Conversion workflow */}
          <Route path="conversions"                          element={lazyEl(ConversionJobs)} />
          <Route path="conversions/fxl-editor"               element={lazyEl(ImageFxlEditor)} />
          <Route path="conversions/audio-sync"               element={lazyEl(AudioSyncStudio)} />
          <Route path="conversions/audio-sync/:jobId"        element={lazyEl(AudioSyncStudio)} />
          <Route path="conversions/download"                 element={lazyEl(DownloadEpub)} />
          <Route path="conversions/download/:jobId"          element={lazyEl(DownloadEpub)} />

          {/* In-job studios — same shell as other org pages (sidebar + workflow chrome inside each page) */}
          <Route path="conversions/fxl-editor/:jobId"   element={lazyEl(KitabooZoningStudio)} />
          <Route path="conversions/image-editor/:jobId" element={lazyEl(EpubImageEditorPage)} />
          <Route path="image-editor/:jobId"             element={lazyEl(EpubImageEditorPage)} />
          <Route path="fxl-studio/:jobId"               element={lazyEl(KitabooZoningStudio)} />
          <Route path="audio-sync/fxl/:jobId"           element={<LegacyFxlSyncRedirect />} />
          <Route path="audio-sync/reflow/:jobId"        element={<LegacyReflowSyncRedirect />} />
          <Route path="sync-studio/:jobId"              element={lazyEl(SyncStudio)} />
          <Route path="kitaboo-studio/:jobId"           element={lazyEl(KitabooZoningStudio)} />
          <Route path="fxl-sync-studio/:jobId"          element={lazyEl(FxlSyncStudio)} />
          <Route path="epub-image-editor/:jobId"        element={lazyEl(EpubImageEditorPage)} />

          {/* Reader & scripts */}
          <Route path="reader/epub/:jobId" element={lazyEl(EpubReaderPage)} />
          <Route path="audio-script/:jobId" element={lazyEl(AudioScript)} />

          {/* Tools */}
          <Route path="ai-config"        element={lazyEl(AiConfig)} />
          <Route path="tts-management"   element={lazyEl(TtsManagement)} />
          <Route path="api-debugger"     element={lazyEl(ApiDebugger)} />
          <Route path="accessibility"    element={lazyEl(Accessibility)} />
          <Route path="epub-checker"     element={lazyEl(EpubCheckerPage)} />
          <Route path="epub-sync-import" element={lazyEl(EpubSyncImport)} />
          <Route path="exports"          element={lazyEl(Exports)} />

          {/* Org */}
          <Route path="org/media-library" element={lazyEl(MediaLibrary)} />
          <Route path="org/usage"         element={lazyEl(Usage)} />
          <Route path="activity"          element={lazyEl(Activity)} />

          <Route
            path="admin/activity"
            element={<RequirePlatformAdmin>{lazyEl(ActivityPage)}</RequirePlatformAdmin>}
          />

          {/* Platform-admin gated */}
          <Route
            path="admin/organizations"
            element={<RequirePlatformAdmin>{lazyEl(AdminOrganizations)}</RequirePlatformAdmin>}
          />
          <Route
            path="admin/plans"
            element={<RequirePlatformAdmin>{lazyEl(AdminPlans)}</RequirePlatformAdmin>}
          />
          <Route
            path="admin/analytics"
            element={<RequirePlatformAdmin>{lazyEl(PlatformAnalytics)}</RequirePlatformAdmin>}
          />
          <Route
            path="admin/users"
            element={<RequirePlatformAdmin>{lazyEl(UsersManagement)}</RequirePlatformAdmin>}
          />
          <Route
            path="admin/settings"
            element={<RequirePlatformAdmin>{lazyEl(AdminStubPage)}</RequirePlatformAdmin>}
          />
          <Route
            path="admin/billing"
            element={<RequirePlatformAdmin>{lazyEl(AdminStubPage)}</RequirePlatformAdmin>}
          />
          <Route
            path="admin/security"
            element={<RequirePlatformAdmin>{lazyEl(AdminStubPage)}</RequirePlatformAdmin>}
          />
          <Route
            path="admin/system-logs"
            element={<RequirePlatformAdmin>{lazyEl(AdminStubPage)}</RequirePlatformAdmin>}
          />

          {/* Org-admin gated */}
          <Route
            path="org/team"
            element={<RequireOrgAdmin>{lazyEl(OrgTeam)}</RequireOrgAdmin>}
          />

          {/* Plan-feature gated */}
          <Route
            path="interactive"
            element={
              <RequirePlanFeature featureKey="interactive.content">
                {lazyEl(InteractiveBooks)}
              </RequirePlanFeature>
            }
          />
          <Route
            path="interactive/reader/:bookId"
            element={
              <RequirePlanFeature featureKey="interactive.content">
                {lazyEl(InteractiveReader)}
              </RequirePlanFeature>
            }
          />
          <Route
            path="interactive/editor/:bookId"
            element={
              <RequireOrgAdmin>
                <RequirePlanFeature featureKey="interactive.content">
                  {lazyEl(InteractiveEditorEnhanced)}
                </RequirePlanFeature>
              </RequireOrgAdmin>
            }
          />
          <Route
            path="interactive/editor-classic/:bookId"
            element={
              <RequireOrgAdmin>
                <RequirePlanFeature featureKey="interactive.content">
                  {lazyEl(InteractiveEditor)}
                </RequirePlanFeature>
              </RequireOrgAdmin>
            }
          />
        </Route>
      </Route>
    </Routes>
  );
}
