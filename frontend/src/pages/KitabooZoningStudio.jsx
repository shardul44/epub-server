import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import * as fabric from 'fabric';
import api, { API_BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useWorkflowNavigation } from '../hooks/useWorkflowNavigation';
import {
  LayoutGrid,
  Film,
  FolderOpen,
  Gauge,
  Users,
  RefreshCw,
  FileText,
  LogOut,
  ZoomOut,
  ZoomIn,
  Maximize2,
  Eye,
} from 'lucide-react';
import './KitabooZoningStudio.css';
import WorkflowStudioChrome from '../components/WorkflowStudioChrome';

/** Merge paginated Kitaboo payloads by pageNumber (later poll wins). */
function mergeKitabooPages(prev, next) {
  const map = new Map();
  (prev || []).forEach((p) => {
    if (p?.pageNumber != null) map.set(p.pageNumber, p);
  });
  (next || []).forEach((p) => {
    if (p?.pageNumber != null) map.set(p.pageNumber, p);
  });
  return [...map.values()].sort((a, b) => a.pageNumber - b.pageNumber);
}

/** Page photo is a locked Fabric Image (not `backgroundImage`) so it shares the same render path as zone groups — avoids Y drift vs overlays with retina/cache. */
const KITABOO_PAGE_BG = '__kitabooPageBg';

function getKitabooPageFabricImage(canvas) {
  if (!canvas?.getObjects) return null;
  return canvas.getObjects().find((o) => o.type === 'image' && o[KITABOO_PAGE_BG] === true) || null;
}

/** Zone overlay markers — flat canvas objects (no fabric.Group; Fabric 7 groups break PDF placement). */
const KITABOO_ZONE_SHAPE = '__kitabooZoneShape';
const KITABOO_ZONE_LABEL = '__kitabooZoneLabel';

const ZONE_SHAPE_ORIGIN = { originX: 'left', originY: 'top', objectCaching: false };
const READING_ORDER_LABEL_SIZE = 40;

function isKitabooZoneShape(obj) {
  return !!obj && obj[KITABOO_ZONE_SHAPE] === true;
}

function getKitabooZoneShapes(canvas) {
  if (!canvas?.getObjects) return [];
  return canvas.getObjects().filter(isKitabooZoneShape);
}

function getKitabooZoneLabel(canvas, zoneId) {
  if (!canvas?.getObjects || !zoneId) return null;
  return canvas.getObjects().find((o) => o[KITABOO_ZONE_LABEL] && o.kitabooZoneId === zoneId) || null;
}

function syncZoneLabelToShape(shape, label) {
  if (!shape || !label) return;
  label.set({
    left: (Number(shape.left) || 0) + 5,
    top: (Number(shape.top) || 0) + 5,
  });
  label.setCoords?.();
}

/** Build shape + label at absolute page pixel coordinates from backend zone JSON. */
function buildKitabooZoneObjects(zoneSnapshot, index, previewMode) {
  const rOrder = zoneSnapshot.readingOrder || index + 1;
  const zoneId = zoneSnapshot.id || `zone_${index}`;
  const commonShapeOpts = {
    fill: 'rgba(0, 120, 255, 0.2)',
    stroke: '#0078ff',
    strokeWidth: 2,
    cornerColor: '#0078ff',
    cornerSize: 10,
    transparentCorners: false,
    visible: !previewMode,
    selectable: true,
    evented: true,
    ...ZONE_SHAPE_ORIGIN,
  };
  const hadStoredPoints = Array.isArray(zoneSnapshot.points) && zoneSnapshot.points.length >= 3;
  let zonePoints = hadStoredPoints
    ? zoneSnapshot.points.map((p) => [Number(p[0]), Number(p[1])])
    : null;
  if (!zonePoints && zoneSnapshot.x != null && zoneSnapshot.y != null && zoneSnapshot.w != null && zoneSnapshot.h != null) {
    const x = Number(zoneSnapshot.x);
    const y = Number(zoneSnapshot.y);
    const w = Number(zoneSnapshot.w);
    const h = Number(zoneSnapshot.h);
    zonePoints = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  const canonicalPoints = zonePoints ? zonePoints.map((p) => [...p]) : null;
  let shape;
  let zoneLeft;
  let zoneTop;

  if (!hadStoredPoints && zonePoints && zonePoints.length === 4) {
    const xs = zonePoints.map((p) => p[0]);
    const ys = zonePoints.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const isAxisAlignedRect =
      zonePoints.some((p) => p[0] === minX && p[1] === minY) &&
      zonePoints.some((p) => p[0] === maxX && p[1] === minY) &&
      zonePoints.some((p) => p[0] === maxX && p[1] === maxY) &&
      zonePoints.some((p) => p[0] === minX && p[1] === maxY);
    if (isAxisAlignedRect) {
      const EXTRA_RIGHT_PAD = 8;
      zoneLeft = minX;
      zoneTop = minY;
      shape = new fabric.Rect({
        left: zoneLeft,
        top: zoneTop,
        width: Math.max(1, maxX - minX + EXTRA_RIGHT_PAD),
        height: Math.max(1, maxY - minY),
        ...commonShapeOpts,
      });
    }
  }

  if (!shape && zonePoints && zonePoints.length >= 3) {
    zoneLeft = Math.min(...zonePoints.map((p) => p[0]));
    zoneTop = Math.min(...zonePoints.map((p) => p[1]));
    const relativePoints = zonePoints.map((p) => ({ x: p[0] - zoneLeft, y: p[1] - zoneTop }));
    shape = new fabric.Polygon(relativePoints, {
      ...commonShapeOpts,
      left: zoneLeft,
      top: zoneTop,
    });
  } else if (!shape) {
    zoneLeft = Number(zoneSnapshot.x) || 0;
    zoneTop = Number(zoneSnapshot.y) || 0;
    shape = new fabric.Rect({
      left: zoneLeft,
      top: zoneTop,
      width: Math.max(1, Number(zoneSnapshot.w) || 1),
      height: Math.max(1, Number(zoneSnapshot.h) || 1),
      ...commonShapeOpts,
    });
  }

  const zoneData = {
    ...zoneSnapshot,
    id: zoneId,
    ...(canonicalPoints && canonicalPoints.length >= 3 && { points: canonicalPoints }),
    readingOrder: rOrder,
    altText: zoneSnapshot.altText || '',
    syncId: zoneSnapshot.syncId || `${zoneId}_sync`,
  };

  const label = new fabric.IText(String(rOrder), {
    left: zoneLeft + 5,
    top: zoneTop + 5,
    fontSize: READING_ORDER_LABEL_SIZE,
    fill: '#fff',
    backgroundColor: '#0078ff',
    selectable: false,
    evented: false,
    visible: !previewMode,
    originX: 'left',
    originY: 'top',
  });

  return { shape, label, zoneData, zoneId };
}

function addKitabooZoneToCanvas(canvas, zoneSnapshot, index, previewMode) {
  const { shape, label, zoneData, zoneId } = buildKitabooZoneObjects(zoneSnapshot, index, previewMode);
  shape[KITABOO_ZONE_SHAPE] = true;
  shape.kitabooZoneId = zoneId;
  label[KITABOO_ZONE_LABEL] = true;
  label.kitabooZoneId = zoneId;
  setZoneData(shape, zoneData);
  canvas.add(shape);
  canvas.add(label);
  shape.setCoords?.();
  return shape;
}

function removeKitabooZoneFromCanvas(canvas, shape) {
  if (!canvas || !shape) return;
  const label = getKitabooZoneLabel(canvas, shape.kitabooZoneId);
  if (label) canvas.remove(label);
  canvas.remove(shape);
}

/** Serialize flat zone shape to backend { x, y, w, h, points? }. */
function serializeFabricZone(shapeOrGroup) {
  const shape = shapeOrGroup?.type === 'group' ? shapeOrGroup.item?.(0) : shapeOrGroup;
  const host = shapeOrGroup?.type === 'group' ? shapeOrGroup : shape;
  const data = (host?.get?.('data') || host?.data || shape?.get?.('data') || shape?.data) || {};
  if (!shape) {
    return {
      ...data,
      id: data.id,
      type: data.type || 'text',
      content: (data.content != null ? String(data.content) : '').trim(),
      x: Math.round(host?.left ?? 0),
      y: Math.round(host?.top ?? 0),
      w: 1,
      h: 1,
      readingOrder: data.readingOrder,
    };
  }
  shape.setCoords?.();
  host?.setCoords?.();
  const isPolygon =
    String(shape.type || '').toLowerCase() === 'polygon' &&
    shape.points &&
    shape.points.length >= 3;
  let x;
  let y;
  let w;
  let h;
  let points;

  if (isPolygon) {
    const m = shape.calcTransformMatrix();
    const ox = shape.pathOffset?.x ?? 0;
    const oy = shape.pathOffset?.y ?? 0;
    points = shape.points.map((p) => {
      const lx = (typeof p.x === 'number' ? p.x : Number(p[0])) - ox;
      const ly = (typeof p.y === 'number' ? p.y : Number(p[1])) - oy;
      const tp = fabric.util.transformPoint({ x: lx, y: ly }, m);
      return [Math.round(tp.x), Math.round(tp.y)];
    });
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    x = Math.round(Math.min(...xs));
    y = Math.round(Math.min(...ys));
    w = Math.max(1, Math.round(Math.max(...xs) - x));
    h = Math.max(1, Math.round(Math.max(...ys) - y));
  } else {
    x = Math.round(shape.left ?? host?.left ?? 0);
    y = Math.round(shape.top ?? host?.top ?? 0);
    w = Math.max(1, Math.round((Number(shape.width) || 0) * (shape.scaleX ?? 1)));
    h = Math.max(1, Math.round((Number(shape.height) || 0) * (shape.scaleY ?? 1)));
  }
  const contentFromLines =
    Array.isArray(data.lines) && data.lines.length > 0
      ? data.lines.map((l) => (l.text || '').trim()).filter(Boolean).join(' ')
      : '';
  const hasStyleRuns = Array.isArray(data.styleRuns) && data.styleRuns.length > 0;
  const rawContent = data.content != null ? String(data.content) : '';
  const content = hasStyleRuns
    ? rawContent || contentFromLines
    : rawContent.trim() || contentFromLines;
  return {
    ...data,
    id: data.id,
    type: data.type || 'text',
    content,
    styleRuns: hasStyleRuns ? data.styleRuns : undefined,
    x,
    y,
    w,
    h,
    readingOrder: data.readingOrder,
    enrichmentType: data.enrichmentType,
    enrichmentValue: data.enrichmentValue,
    altText: data.altText,
    syncId: data.syncId,
    lines: Array.isArray(data.lines) && data.lines.length > 0 ? data.lines : undefined,
    points: isPolygon && points && points.length >= 3 ? points.map((p) => [p[0], p[1]]) : undefined,
  };
}

function filterZoneSelection(sel) {
  const list = Array.isArray(sel) ? sel : sel ? [sel] : [];
  const shapes = list.filter(isKitabooZoneShape);
  return shapes.length > 0 ? shapes : list.filter((o) => o?.type === 'group');
}

/** Read/write zone metadata on flat Fabric shapes (panel + save must use the same accessors). */
function getZoneData(shape) {
  if (!shape) return {};
  return shape.get?.('data') || shape.data || {};
}

function setZoneData(shape, data) {
  if (!shape || !data) return;
  shape.set?.('data', data);
  shape.data = data;
}

/** OCR text for the panel: prefer stored content; fall back to line OCR only when content was never set. */
function getZoneTextContent(data) {
  if (!data) return '';
  if (data.content != null && String(data.content).length > 0) {
    return String(data.content);
  }
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (lines.length > 0) {
    return lines.map((l) => (l.text || '').trim()).filter(Boolean).join(' ');
  }
  return data.content != null ? String(data.content) : '';
}

/** Character style at index (styleRuns from Studio bold/italic/color). */
function getStyleAtIndex(styleRuns, pos, zoneFallback = {}) {
  const runs =
    Array.isArray(styleRuns) && styleRuns.length > 0
      ? styleRuns
      : [
          {
            start: 0,
            end: Number.MAX_SAFE_INTEGER,
            bold: !!zoneFallback.bold,
            italic: !!zoneFallback.italic,
            color: zoneFallback.color || '#000000',
          },
        ];
  const r = runs.find((run) => pos >= run.start && pos < run.end);
  return r
    ? { bold: !!r.bold, italic: !!r.italic, color: r.color || '#000000' }
    : {
        bold: !!zoneFallback.bold,
        italic: !!zoneFallback.italic,
        color: zoneFallback.color || '#000000',
      };
}

function tokenStyleFromRuns(styleRuns, token, zoneData = {}) {
  const at = getStyleAtIndex(styleRuns, token.start, zoneData);
  return {
    fontWeight: at.bold ? 'bold' : 'normal',
    fontStyle: at.italic ? 'italic' : 'normal',
    color: at.color,
  };
}

/** Split zone text into word/whitespace tokens with stable indices into `content`. */
function tokenizeZoneContent(content) {
  const tokens = [];
  const re = /\s+|\S+/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

// Persist custom zone payload through Fabric 7 get/set/clone
if (fabric.FabricObject && !fabric.FabricObject.customProperties.includes('data')) {
  fabric.FabricObject.customProperties = [...fabric.FabricObject.customProperties, 'data'];
}

const KitabooZoningStudio = () => {
  const { jobId: routeJobId } = useParams();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const { goToDownload } = useWorkflowNavigation();
  const isOrgAdmin = user?.role === 'org_admin';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const canvasRef = useRef(null);
  const isInitialMount = useRef(true);
  const processingStarted = useRef(false);
  const combinedSelectionRectRef = useRef(null); // one block highlight when 2+ zones selected
  const multiSelectedRestoreRef = useRef([]);   // { group, stroke } to restore when selection changes
  const [fabricCanvas, setFabricCanvas] = useState(null);
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState(null); // { type: 'success' | 'error', message: string }
  const [selectedZone, setSelectedZone] = useState(null);
  const [selectedObjects, setSelectedObjects] = useState([]); // multiple selection for Merge
  const [jobId, setJobId] = useState(routeJobId || null);
  const [syncLevel, setSyncLevel] = useState('sentence'); // from Convert modal (word/sentence) — applied automatically, no Sync dropdown
  const useAI = true; // Always use AI for exact word/sentence box positions (backend default)
  const [splitting, setSplitting] = useState(false);
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [jobDeleted, setJobDeleted] = useState(false); // true when 404 confirms job no longer exists
  const [retryKey, setRetryKey] = useState(0);
  const [zonePropsVersion, setZonePropsVersion] = useState(0); // bump to force Zone Properties panel to re-render after edits

  useEffect(() => {
    if (!saveToast) return;
    const t = window.setTimeout(() => setSaveToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [saveToast]);
  const [exporting, setExporting] = useState(false);
  const [applyingToAllPages, setApplyingToAllPages] = useState(false);
  const [toolbarHidden, setToolbarHidden] = useState(true); // hide page header/toolbar by default for focus on canvas
  const [ttsVoices, setTtsVoices] = useState([]); // { name, gender, description }[]
  const [ttsVoice, setTtsVoice] = useState(null); // selected voice for FXL export
  const [ttsLanguageCode, setTtsLanguageCode] = useState('en-US');
  const [ttsStatus, setTtsStatus] = useState(null); // { clientStatus: 'free-tts' | 'google-cloud' | 'disabled', message }
  const [humanAudioPages, setHumanAudioPages] = useState([]); // page numbers that have human narration
  const [singleBookAudio, setSingleBookAudio] = useState(false); // one long audio for all pages (narration.mp3)
  const [uploadingHumanPage, setUploadingHumanPage] = useState(null); // page number being uploaded
  const [uploadingSingleBook, setUploadingSingleBook] = useState(false);
  const [uploadingCleanPage, setUploadingCleanPage] = useState(false);
  const [polygonDrawingMode, setPolygonDrawingMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [activeQuickTool, setActiveQuickTool] = useState(null);
  const [zoomRatio, setZoomRatio] = useState(1); // 1 = fit-to-view (100%)
  const [previewMode, setPreviewMode] = useState(false); // hide overlays when true
  const [useAbsoluteHtml, setUseAbsoluteHtml] = useState(false); // pdf2htmlEX-style text layer (no SVG)
  const [bodyFontFamily, setBodyFontFamily] = useState(''); // Optional override font for all FXL pages
  const polygonPreviewRef = useRef(null); // Fabric group showing points + lines while drawing
  const polygonModeRestoreEventedRef = useRef([]); // restore evented on exit
  const cleanPageInputRef = useRef(null);
  const pollTimerRef = useRef(null);
  const skipCanvasReinitUntil = useRef(0);
  const canvasInitScheduled = useRef(false);
  /** Live Fabric instance for dispose (covers in-flight canvas before setFabricCanvas runs). */
  const fabricLiveCanvasRef = useRef(null);
  /** Bumped on cleanup / new init so stale Image.fromURL callbacks cannot finishInit or replace state. */
  const canvasInitGenerationRef = useRef(0);
  const canvasContainerRef = useRef(null); // scroll reset on page change
  const fitScaleRef = useRef(1);
  const zoomRatioRef = useRef(1);
  const [hdBackgroundActive, setHdBackgroundActive] = useState(false);
  const [slowStepHint, setSlowStepHint] = useState(false);
  const lastProgressRef = useRef({ pct: 0, at: Date.now() });

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  useEffect(() => {
    fabricLiveCanvasRef.current = fabricCanvas;
  }, [fabricCanvas]);

  // Derive backend origin from API_BASE_URL (e.g., http://localhost:8081)
  const backendOrigin = API_BASE_URL.replace('/api', '');

  useEffect(() => {
    let cancelled = false;

    const pollJobStatus = async () => {
      if (cancelled) return;
      try {
        const res = await api.get(`/kitaboo/job/${routeJobId}`);
        const d = res.data?.data || res.data;
        const pct = d.progressPercentage ?? 0;
        setProgressPercentage(pct);
        setCurrentStep(d.currentStep ?? '');
        if (pct !== lastProgressRef.current.pct) {
          lastProgressRef.current = { pct, at: Date.now() };
          setSlowStepHint(false);
        } else if (
          (d.status === 'IN_PROGRESS' || d.status === 'PENDING') &&
          pct > 0 &&
          pct < 48 &&
          Date.now() - lastProgressRef.current.at > 90000
        ) {
          setSlowStepHint(true);
        }
        if (d.status === 'COMPLETED' && Array.isArray(d.pages) && d.pages.length > 0) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setPages(d.pages);
          setHdBackgroundActive(false);
          setJobId(d.jobId);
          const level = d.zoneLevel || d.extractionLevel;
          if (level === 'word' || level === 'sentence') setSyncLevel(level);
          setLoading(false);
          setLoadError(null);
          return;
        }
        if (
          (d.status === 'IN_PROGRESS' || d.status === 'PENDING') &&
          d.previewReady &&
          Array.isArray(d.pages) &&
          d.pages.length > 0
        ) {
          setPages((prev) => mergeKitabooPages(prev, d.pages));
          setHdBackgroundActive(true);
          setJobId(d.jobId);
          const level = d.zoneLevel || d.extractionLevel;
          if (level === 'word' || level === 'sentence') setSyncLevel(level);
          setLoading(false);
          setLoadError(null);
          return;
        }
        if (d.status === 'FAILED') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setLoadError(d.error || 'Conversion failed');
          setLoading(false);
        }
      } catch (e) {
        if (cancelled) return;
        if (e.response?.status === 404) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setJobDeleted(true);
          setLoading(false);
          // Auto-redirect after a short delay so the user sees the message
          setTimeout(() => { if (!cancelled) navigate('/conversions'); }, 2500);
        }
        // Other errors (network, 5xx): keep polling — transient failures shouldn't abort
      }
    };

    const initWorkflow = async () => {
      if (processingStarted.current || !routeJobId) return;
      processingStarted.current = true;
      setLoadError(null);
      setJobDeleted(false);
      setProgressPercentage(0);
      setCurrentStep('Checking...');

      try {
        setLoading(true);

        // Fast path: check if data is already ready (avoids a second round-trip)
        const readyRes = await api.get(`/kitaboo/ready/${routeJobId}`).catch(() => null);
        const readyData = readyRes?.data?.data ?? readyRes?.data;
        if (readyData?.ready && Array.isArray(readyData.pages) && readyData.pages.length > 0) {
          setPages(readyData.pages);
          setJobId(readyData.jobId || routeJobId);
          const level = readyData.zoneLevel || readyData.extractionLevel;
          if (level === 'word' || level === 'sentence') setSyncLevel(level);
          setLoading(false);
          try {
            const jr = await api.get(`/kitaboo/job/${routeJobId}`);
            const jd = jr.data?.data ?? jr.data;
            if (jd.status === 'IN_PROGRESS' || jd.status === 'PENDING') {
              setHdBackgroundActive(!!jd.previewReady);
              if (!pollTimerRef.current) {
                pollTimerRef.current = setInterval(pollJobStatus, 1500);
              }
            } else {
              setHdBackgroundActive(false);
            }
          } catch (_) {
            setHdBackgroundActive(false);
          }
          return;
        }

        // Fetch job status — treat 404 as "deleted", re-throw everything else
        let jobRes;
        try {
          jobRes = await api.get(`/kitaboo/job/${routeJobId}`);
        } catch (e) {
          if (e.response?.status === 404) {
            setJobDeleted(true);
            setLoading(false);
            setTimeout(() => { if (!cancelled) navigate('/conversions'); }, 2500);
            return;
          }
          throw e; // re-throw 5xx / network errors
        }

        const jobData = jobRes.data?.data ?? jobRes.data;

        if (jobData.status === 'COMPLETED' && Array.isArray(jobData.pages) && jobData.pages.length > 0) {
          setPages(jobData.pages);
          setJobId(jobData.jobId);
          const level = jobData.zoneLevel || jobData.extractionLevel;
          if (level === 'word' || level === 'sentence') setSyncLevel(level);
          setHdBackgroundActive(false);
          setLoading(false);
          return;
        }
        if (
          (jobData.status === 'IN_PROGRESS' || jobData.status === 'PENDING') &&
          jobData.previewReady &&
          Array.isArray(jobData.pages) &&
          jobData.pages.length > 0
        ) {
          setPages(jobData.pages);
          setJobId(jobData.jobId);
          const level = jobData.zoneLevel || jobData.extractionLevel;
          if (level === 'word' || level === 'sentence') setSyncLevel(level);
          setHdBackgroundActive(true);
          setLoading(false);
        }
        if (jobData.status === 'IN_PROGRESS' || jobData.status === 'PENDING') {
          setProgressPercentage(jobData.progressPercentage ?? 0);
          setCurrentStep(jobData.currentStep ?? 'In progress...');
          pollTimerRef.current = setInterval(pollJobStatus, 1500);
          return;
        }
        if (jobData.status === 'FAILED') {
          setLoadError(jobData.error || 'Conversion failed');
          setLoading(false);
          return;
        }

        // Unexpected state
        setLoadError('Job is in an unexpected state. Please go back and try again.');
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load FXL job:', err);
        setLoadError(err.response?.data?.message || err.message || 'Failed to load job');
        setLoading(false);
      }
    };

    initWorkflow();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [routeJobId, retryKey]);

  /**
   * Only rebuild the Fabric canvas when the *page shell* changes (page index, image URL,
   * dimensions, or zone count). Saving zone geometry updates `pages` but must NOT dispose
   * the canvas — full re-init was the main cause of overlays "jumping" after Save.
   */
  const studioCanvasInitKey = useMemo(() => {
    if (loading || pages.length === 0 || !pages[currentPage]) return '';
    const p = pages[currentPage];
    const dw = p.dimensions?.width ?? '';
    const dh = p.dimensions?.height ?? '';
    const zc = Array.isArray(p.zones) ? p.zones.length : 0;
    return `${currentPage}|${p.imagePath || ''}|${dw}x${dh}|z${zc}`;
  }, [loading, currentPage, pages]);

  useEffect(() => {
    if (!studioCanvasInitKey) return;
    if (Date.now() < skipCanvasReinitUntil.current) return;
    const pageData = pagesRef.current[currentPageRef.current];
    if (!pageData) return;
    setSelectedZone(null);
    setSelectedObjects([]);
    if (canvasContainerRef.current) {
      canvasContainerRef.current.scrollTop = 0;
      canvasContainerRef.current.scrollLeft = 0;
    }
    initCanvas(pageData);
    return () => {
      canvasInitGenerationRef.current += 1;
      canvasInitScheduled.current = false;
      const live = fabricLiveCanvasRef.current;
      if (live) {
        try {
          live.dispose();
        } catch (e) {
          console.warn('[Studio] Canvas dispose (cleanup):', e?.message);
        }
        fabricLiveCanvasRef.current = null;
      }
    };
  }, [studioCanvasInitKey]);

  // syncLevel is set from job extractionLevel (Convert modal choice); no Sync dropdown

  // Fetch TTS status and voices when studio is ready
  useEffect(() => {
    let cancelled = false;
    const loadTtsStatus = async () => {
      try {
        const statusRes = await api.get('/tts/status').catch(() => null);
        const statusData = statusRes?.data?.data ?? statusRes?.data;
        if (!cancelled && statusData) setTtsStatus(statusData);
      } catch (e) {
        if (!cancelled) setTtsStatus(null);
      }
    };
    const loadVoices = async () => {
      try {
        const res = await api.get('/tts/voices', { params: { languageCode: ttsLanguageCode } });
        const data = res.data?.data ?? res.data;
        const list = Array.isArray(data) ? data : (data?.voices ?? []);
        if (!cancelled) setTtsVoices(list);
        if (!cancelled && list.length > 0 && !ttsVoice) {
          const first = list[0];
          setTtsVoice({ name: first.name, gender: first.gender, description: first.description });
        }
      } catch (e) {
        if (!cancelled) setTtsVoices([]);
      }
    };
    if (!loading) {
      loadTtsStatus();
      loadVoices();
    }
    return () => { cancelled = true; };
  }, [loading, ttsLanguageCode]);

  // Restore saved TTS voice when job has loaded
  useEffect(() => {
    if (!jobId || loading || ttsVoices.length === 0) return;
    try {
      const saved = localStorage.getItem(`kitaboo_ttsVoice_${jobId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        const match = ttsVoices.find(v => v.name === parsed.name);
        if (match) setTtsVoice({ name: match.name, gender: match.gender, description: match.description });
      }
    } catch (e) {
      // ignore
    }
  }, [jobId, loading, ttsVoices]);

  // Fetch which pages have human narration and whether single book audio exists
  useEffect(() => {
    if (!jobId || loading) return;
    let cancelled = false;
    api.get(`/kitaboo/human-audio/${jobId}`)
      .then(res => {
        const data = res.data?.data ?? res.data;
        if (cancelled) return;
        if (data?.pages) setHumanAudioPages(Array.isArray(data.pages) ? data.pages : []);
        setSingleBookAudio(!!data?.singleBookAudio);
      })
      .catch(() => { if (!cancelled) { setHumanAudioPages([]); setSingleBookAudio(false); } });
    return () => { cancelled = true; };
  }, [jobId, loading]);

  const saveCurrentPageToState = () => {
    if (!fabricCanvas) return;
    // IMPORTANT: use the same robust serializer as "Save Current Page" so
    // switching pages doesn't lose polygon points / transforms (causes "jump").
    const canvasZones = getKitabooZoneShapes(fabricCanvas)
      .map(serializeFabricZone)
      .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
    setPages(prev => {
      const newPages = [...prev];
      newPages[currentPage] = { ...newPages[currentPage], zones: canvasZones };
      return newPages;
    });
  };

  const handlePageChange = (direction) => {
    saveCurrentPageToState();
    if (direction === 'next') {
      setCurrentPage(prev => Math.min(pages.length - 1, prev + 1));
    } else {
      setCurrentPage(prev => Math.max(0, prev - 1));
    }
  };

  const handlePageSelect = (pageIndex) => {
    if (pageIndex === currentPage) return;
    saveCurrentPageToState();
    setCurrentPage(pageIndex);
  };

  useEffect(() => {
    zoomRatioRef.current = zoomRatio;
  }, [zoomRatio]);

  /**
   * Fit the canvas visually inside the scroll container while keeping the **backing store**
   * at natural image pixel size (same space as saved zone x/y). Mixing setZoom(s) with
   * backing dimensions iw*s caused systematic Y drift between the page bitmap and groups.
   */
  const refitFabricToContainer = useCallback(() => {
    const canvas = fabricLiveCanvasRef.current;
    if (!canvas) return;
    const img = getKitabooPageFabricImage(canvas);
    const scrollEl = canvasContainerRef.current;
    if (!img || !scrollEl) return;
    const iw = Math.max(1, Number(img.width) || 1);
    const ih = Math.max(1, Number(img.height) || 1);
    const padding = 48;
    const availW = scrollEl.clientWidth - padding;
    const availH = scrollEl.clientHeight - padding;
    // Skip until the flex layout gives a real size (avoids fitScale=0 and wrong first paint).
    if (availW < 32 || availH < 32) return;
    const fitScale = Math.min(availW / iw, availH / ih, 1);
    fitScaleRef.current = Math.max(0.01, fitScale);
    const ratio = Math.max(0.25, Math.min(4, zoomRatioRef.current));
    const effectiveScale = fitScaleRef.current * ratio;
    const dispW = Math.round(iw * effectiveScale);
    const dispH = Math.round(ih * effectiveScale);

    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.setZoom(1);
    // Backing store = PDF / image pixel space (zone coords). CSS = on-screen size only.
    canvas.setDimensions({ width: iw, height: ih });
    canvas.setDimensions({ width: dispW, height: dispH }, { cssOnly: true });
    canvas.calcOffset();
    canvas.renderAll();
  }, []);

  const applyCanvasScale = useCallback((nextZoomRatio) => {
    if (!fabricLiveCanvasRef.current) return;
    const clampedRatio = Math.max(0.25, Math.min(4, nextZoomRatio));
    zoomRatioRef.current = clampedRatio;
    refitFabricToContainer();
    setZoomRatio(clampedRatio);
  }, [refitFabricToContainer]);

  const handleZoomIn = useCallback(() => {
    applyCanvasScale(zoomRatioRef.current + 0.1);
  }, [applyCanvasScale]);

  const handleZoomOut = useCallback(() => {
    applyCanvasScale(zoomRatioRef.current - 0.1);
  }, [applyCanvasScale]);

  const handleFitToView = useCallback(() => {
    applyCanvasScale(1);
  }, [applyCanvasScale]);

  // Refit when the scroll container actually resizes (sidebar, window, fonts) — avoids stuck wrong fitScale.
  useEffect(() => {
    if (!fabricCanvas) return;
    const el = canvasContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let debounce = 0;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        debounce = 0;
        refitFabricToContainer();
      }, 48);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => {
      ro.disconnect();
      if (debounce) clearTimeout(debounce);
    };
  }, [fabricCanvas, refitFabricToContainer]);

  const handleTogglePreviewMode = useCallback(() => {
    setPreviewMode((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!fabricCanvas) return;
    getKitabooZoneShapes(fabricCanvas).forEach((shape) => {
      shape.set('visible', !previewMode);
      const label = getKitabooZoneLabel(fabricCanvas, shape.kitabooZoneId);
      if (label) label.set('visible', !previewMode);
    });
    if (previewMode) {
      fabricCanvas.discardActiveObject();
      setSelectedZone(null);
      setSelectedObjects([]);
    }
    fabricCanvas.renderAll();
  }, [fabricCanvas, previewMode]);

  const focusZoneById = useCallback((zoneId) => {
    if (!fabricCanvas || !zoneId) return;
    const target = getKitabooZoneShapes(fabricCanvas).find((shape) => {
      const data = shape.get('data') || shape.data || {};
      return data.id === zoneId;
    });
    if (!target) return;
    fabricCanvas.discardActiveObject();
    fabricCanvas.setActiveObject(target);
    setSelectedZone(target);
    setSelectedObjects([target]);
    fabricCanvas.renderAll();
  }, [fabricCanvas]);

  /** When 2+ zones are selected, show one combined highlight (one block); text positions stay as in PDF. */
  const updateMultiSelectHighlight = (canvas, sel) => {
    if (!canvas) return;
    multiSelectedRestoreRef.current.forEach(({ group, stroke }) => {
      const target = isKitabooZoneShape(group) ? group : group.item?.(0);
      if (target) target.set('stroke', stroke);
    });
    multiSelectedRestoreRef.current = [];

    const rectRef = combinedSelectionRectRef.current;
    if (rectRef && rectRef.canvas === canvas) {
      canvas.remove(rectRef);
      combinedSelectionRectRef.current = null;
    }

    const zoneSel = filterZoneSelection(sel);
    if (zoneSel.length >= 2) {
      let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
      zoneSel.forEach((obj) => {
        obj.setCoords?.();
        const br = obj.getBoundingRect?.();
        if (br) {
          xMin = Math.min(xMin, br.left);
          yMin = Math.min(yMin, br.top);
          xMax = Math.max(xMax, br.left + br.width);
          yMax = Math.max(yMax, br.top + br.height);
          return;
        }
        const l = obj.left ?? 0;
        const t = obj.top ?? 0;
        const w = (obj.width ?? 0) * (obj.scaleX ?? 1);
        const h = (obj.height ?? 0) * (obj.scaleY ?? 1);
        xMin = Math.min(xMin, l);
        yMin = Math.min(yMin, t);
        xMax = Math.max(xMax, l + w);
        yMax = Math.max(yMax, t + h);
      });
      const width = Math.max(1, xMax - xMin);
      const height = Math.max(1, yMax - yMin);
      if (rectRef && rectRef.canvas === canvas) {
        rectRef.set({ left: xMin, top: yMin, width, height });
      } else {
        const combinedRect = new fabric.Rect({
          left: xMin,
          top: yMin,
          width,
          height,
          fill: 'rgba(0, 120, 255, 0.15)',
          stroke: '#0078ff',
          strokeWidth: 2,
          selectable: false,
          evented: false
        });
        canvas.add(combinedRect);
        // Fabric 7: layering is on the canvas, not the object
        if (typeof canvas.bringObjectToFront === 'function') {
          canvas.bringObjectToFront(combinedRect);
        }
        combinedSelectionRectRef.current = combinedRect;
      }
      zoneSel.forEach((obj) => {
        const target = isKitabooZoneShape(obj) ? obj : obj.item?.(0);
        if (target) {
          multiSelectedRestoreRef.current.push({ group: obj, stroke: target.get('stroke') });
          target.set('stroke', 'transparent');
        }
      });
    }
    canvas.renderAll();
  };

  const initCanvas = (pageData) => {
    if (canvasInitScheduled.current) return;
    canvasInitScheduled.current = true;
    const doInit = () => {
      const live = fabricLiveCanvasRef.current;
      if (live) {
        try {
          live.dispose();
        } catch (e) {
          console.warn('[Studio] Canvas dispose:', e?.message);
        }
        fabricLiveCanvasRef.current = null;
      }
      setFabricCanvas(null);
      requestAnimationFrame(() => createCanvas(pageData));
    };
    const createCanvas = (pageData) => {
      const myGen = ++canvasInitGenerationRef.current;
      const addZonesToCanvas = (canvas) => {
        (pageData.zones || []).forEach((zone, index) => {
          const zoneSnapshot = {
            ...zone,
            points: Array.isArray(zone.points)
              ? zone.points.map((p) =>
                  Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.x), Number(p.y)]
                )
              : undefined,
          };
          addKitabooZoneToCanvas(canvas, zoneSnapshot, index, previewMode);
        });
      };

      const wireSelectionHandlers = (canvas) => {
        const applySelection = (sel) => {
          const zoneSel = filterZoneSelection(sel);
          setSelectedObjects(zoneSel);
          setSelectedZone(zoneSel[0] || null);
          updateMultiSelectHighlight(canvas, sel);
        };
        canvas.on('selection:created', (e) => applySelection(e.selected || []));
        canvas.on('selection:updated', (e) => applySelection(e.selected || []));
        canvas.on('selection:cleared', () => {
          setSelectedObjects([]);
          setSelectedZone(null);
          updateMultiSelectHighlight(canvas, []);
        });
        canvas.on('object:modified', (e) => {
          const target = e.target;
          if (!isKitabooZoneShape(target)) return;
          const label = getKitabooZoneLabel(canvas, target.kitabooZoneId);
          syncZoneLabelToShape(target, label);
          canvas.requestRenderAll?.() || canvas.renderAll();
        });
      };

      const finishInit = (canvas, img) => {
        if (myGen !== canvasInitGenerationRef.current) {
          try {
            canvas.dispose();
          } catch (_) {
            /* ignore */
          }
          canvasInitScheduled.current = false;
          return;
        }
        addZonesToCanvas(canvas);
        const pageBg = getKitabooPageFabricImage(canvas);
        getKitabooZoneShapes(canvas).forEach((shape) => {
          if (typeof canvas.bringObjectToFront === 'function') canvas.bringObjectToFront(shape);
          const label = getKitabooZoneLabel(canvas, shape.kitabooZoneId);
          if (label && typeof canvas.bringObjectToFront === 'function') canvas.bringObjectToFront(label);
        });
        if (pageBg && typeof canvas.sendObjectToBack === 'function') {
          canvas.sendObjectToBack(pageBg);
        }
        canvas.renderAll();
        wireSelectionHandlers(canvas);
        fabricLiveCanvasRef.current = canvas;
        setFabricCanvas(canvas);
        requestAnimationFrame(() => {
          if (myGen !== canvasInitGenerationRef.current) {
            canvasInitScheduled.current = false;
            return;
          }
          const scrollEl = canvasContainerRef.current;
          if (!scrollEl || !img) {
            canvasInitScheduled.current = false;
            return;
          }
          // First pass after paint; second pass after flex/sidebar layout settles (fixes wrong fitScale).
          refitFabricToContainer();
          requestAnimationFrame(() => {
            if (myGen !== canvasInitGenerationRef.current) {
              canvasInitScheduled.current = false;
              return;
            }
            refitFabricToContainer();
            canvasInitScheduled.current = false;
          });
        });
      };

      try {
        const canvas = new fabric.Canvas('kitaboo-canvas', {
          width: pageData.dimensions.width,
          height: pageData.dimensions.height,
          backgroundColor: '#ffffff',
          selection: true,
          preserveObjectStacking: true,
          selectionKey: 'shiftKey',
          altSelectionKey: 'ctrlKey',
          // Retina backing store can desync backgroundImage vs vector overlays; page is a normal Image layer instead.
          enableRetinaScaling: false,
        });
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

        const imageUrl = `${backendOrigin}${pageData.imagePath}`;
        console.log('[Studio] Loading background:', imageUrl);

        fabric.Image.fromURL(imageUrl, {
          crossOrigin: 'anonymous'
        }).then((img) => {
          if (myGen !== canvasInitGenerationRef.current) {
            try {
              canvas.dispose();
            } catch (_) {
              /* ignore */
            }
            canvasInitScheduled.current = false;
            return;
          }
          canvas.setDimensions({
            width: img.width,
            height: img.height
          }, { backstoreOnly: false });

          img.set({
            left: 0,
            top: 0,
            originX: 'left',
            originY: 'top',
            scaleX: 1,
            scaleY: 1,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            objectCaching: false,
          });
          img[KITABOO_PAGE_BG] = true;
          canvas.backgroundImage = undefined;
          canvas.add(img);
          canvas.renderAll();
          console.log('[Studio] Page image layer 1:1:', img.width, 'x', img.height);

          // Zones MUST be added after the real image size is known. Previously zones were
          // created while fromURL was still pending; then the canvas resized to img — saved
          // coords stayed correct but re-init after "Save current page" left overlays shifted.
          finishInit(canvas, img);
        }).catch((err) => {
          console.error('[Studio] Background load failed:', err);
          if (myGen !== canvasInitGenerationRef.current) {
            try {
              canvas.dispose();
            } catch (_) {
              /* ignore */
            }
            canvasInitScheduled.current = false;
            return;
          }
          const dw = Number(pageData.dimensions?.width) || 800;
          const dh = Number(pageData.dimensions?.height) || 1200;
          canvas.setDimensions({ width: dw, height: dh }, { backstoreOnly: false });
          finishInit(canvas, { width: dw, height: dh });
        });
      } catch (e) {
        console.warn('[Studio] createCanvas:', e?.message);
        canvasInitScheduled.current = false;
      }
    };
    requestAnimationFrame(doInit);
  };

  const patchSelectedZoneData = useCallback(
    (patch) => {
      if (!selectedZone) return;
      const currentData = getZoneData(selectedZone);
      let newData = { ...currentData, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'content')) {
        delete newData.lines;
      }
      setZoneData(selectedZone, newData);
      if (newData.enrichmentValue || newData.altText) {
        const strokeTarget = isKitabooZoneShape(selectedZone) ? selectedZone : selectedZone.item?.(0);
        if (strokeTarget) strokeTarget.set('stroke', '#4caf50');
      }
      fabricCanvas?.requestRenderAll?.() || fabricCanvas?.renderAll?.();
      setZonePropsVersion((v) => v + 1);
    },
    [selectedZone, fabricCanvas]
  );

  const handleEnrichmentUpdate = useCallback(
    (field, value) => {
      if (!selectedZone) return;
      if (['Audio', 'Video', 'Popup'].includes(field)) {
        patchSelectedZoneData({ enrichmentType: field, enrichmentValue: value });
      } else {
        patchSelectedZoneData({ [field]: value });
      }
    },
    [selectedZone, patchSelectedZoneData]
  );

  const selectedZoneData = useMemo(() => {
    if (!selectedZone) return null;
    return { ...getZoneData(selectedZone) };
    // zonePropsVersion: Fabric object is mutable; bump forces panel to re-read after edits
  }, [selectedZone, zonePropsVersion]);

  // Word-level styles within a sentence zone (e.g. bold "mane"). Selection is [start, end] character indices.
  const [wordStyleSelection, setWordStyleSelection] = useState({ start: null, end: null });
  useEffect(() => {
    setWordStyleSelection({ start: null, end: null });
  }, [selectedZone]);

  const applyWordStyle = useCallback(
    (zone, start, end, styleDelta) => {
      if (!zone || start == null || end == null || start >= end) return;
      const data = getZoneData(zone);
      const content = getZoneTextContent(data);
      if (!content.length || end > content.length) return;

      let runs =
        Array.isArray(data.styleRuns) && data.styleRuns.length > 0
          ? data.styleRuns.map((r) => ({ ...r }))
          : [
              {
                start: 0,
                end: content.length,
                bold: !!data.bold,
                italic: !!data.italic,
                color: data.color || '#000000',
              },
            ];

      const newRuns = [];
      for (const r of runs) {
        if (r.end <= start || r.start >= end) {
          newRuns.push(r);
          continue;
        }
        if (r.start < start) newRuns.push({ ...r, end: start });
        const midStart = Math.max(r.start, start);
        const midEnd = Math.min(r.end, end);
        const base = getStyleAtIndex(runs, midStart, data);
        newRuns.push({
          start: midStart,
          end: midEnd,
          bold: styleDelta.bold !== undefined ? !!styleDelta.bold : base.bold,
          italic: styleDelta.italic !== undefined ? !!styleDelta.italic : base.italic,
          color: styleDelta.color !== undefined ? styleDelta.color : base.color,
        });
        if (r.end > end) newRuns.push({ ...r, start: end });
      }

      newRuns.sort((a, b) => a.start - b.start);
      const coalesced = [];
      for (const r of newRuns) {
        const last = coalesced[coalesced.length - 1];
        if (
          last &&
          last.end === r.start &&
          last.bold === r.bold &&
          last.italic === r.italic &&
          last.color === r.color
        ) {
          last.end = r.end;
        } else {
          coalesced.push({ ...r });
        }
      }

      const nextData = { ...data, content, styleRuns: coalesced };
      delete nextData.lines;
      setZoneData(zone, nextData);
      fabricCanvas?.requestRenderAll?.() || fabricCanvas?.renderAll?.();
      setZonePropsVersion((v) => v + 1);
    },
    [fabricCanvas]
  );

  const savePageZones = async ({ showSuccessAlert = true } = {}) => {
    try {
      if (!fabricCanvas) return;
      setSaving(true);

      const currentZones = getKitabooZoneShapes(fabricCanvas)
        .map(serializeFabricZone)
        .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));

      console.log(`Saving ${currentZones.length} sorted zones for page ${currentPage + 1}`);

      const res = await api.post(`/kitaboo/save-zones/${jobId}/${currentPage + 1}`, {
        zones: currentZones
      });
      const savedZones = res.data?.data?.zones ?? res.data?.zones ?? currentZones;

      // Keep on-canvas geometry in React state/DB — server only normalizes ids/readingOrder.
      const zonesForPageState = savedZones.map((z, i) => {
        const fromCanvas = currentZones.find((cz) => cz.id === z.id) ?? currentZones[i];
        if (!fromCanvas) return z;
        return {
          ...z,
          x: fromCanvas.x,
          y: fromCanvas.y,
          w: fromCanvas.w,
          h: fromCanvas.h,
          points: fromCanvas.points,
        };
      });

      if (fabricCanvas && zonesForPageState.length > 0) {
        const shapes = getKitabooZoneShapes(fabricCanvas).sort(
          (a, b) => ((a.get?.('data') || a.data)?.readingOrder ?? 0) - ((b.get?.('data') || b.data)?.readingOrder ?? 0)
        );
        zonesForPageState.forEach((z, i) => {
          if (shapes[i]) {
            const existing = shapes[i].get?.('data') || shapes[i].data || {};
            shapes[i].set?.('data', {
              ...existing,
              ...z,
              readingOrder: z.readingOrder ?? existing.readingOrder,
            });
          }
        });
      }

      // Prevent full canvas dispose/rebuild after save (main cause of visible zone jumps).
      skipCanvasReinitUntil.current = Date.now() + 3000;

      setPages(prev => {
        const newPages = [...prev];
        newPages[currentPage] = { ...newPages[currentPage], zones: zonesForPageState };
        return newPages;
      });

      if (showSuccessAlert) {
        setSaveToast({ type: 'success', message: 'Page updated' });
      }
      return true;
    } catch (err) {
      console.error('Failed to save zones:', err);
      setSaveToast({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Could not save page',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await savePageZones({ showSuccessAlert: true });
  };

  const handleSaveAndGoToSyncStudio = async () => {
    const saved = await savePageZones({ showSuccessAlert: false });
    if (!saved) return;
    navigate(`/fxl-sync-studio/${jobId}`);
  };

  const publishEpub = async () => {
    try {
      setExporting(true);
      const voicePayload = ttsVoice
        ? { languageCode: ttsLanguageCode, name: ttsVoice.name, ssmlGender: ttsVoice.gender }
        : undefined;
      console.log(`[Publish] Triggering export with Sync Level: ${syncLevel}, Voice: ${ttsVoice?.name ?? 'default'}`);
      await api.post(`/kitaboo/publish/${jobId}`, {
        syncLevel: syncLevel === 'word' || syncLevel === 'sentence' ? syncLevel : 'sentence',
        voice: voicePayload,
        ...(useAbsoluteHtml ? { renderMode: 'absolute-html' } : {}),
        ...(bodyFontFamily && bodyFontFamily.trim() ? { bodyFontFamily: bodyFontFamily.trim() } : {})
      });

      // Navigate to Download EPUB page with this job pre-selected
      goToDownload({ id: jobId, jobType: 'FXL' });
    } catch (err) {
      console.error('Publish failed:', err);
      alert('Failed to publish EPUB');
    } finally {
      setExporting(false);
    }
  };

  const drawAtSelectedLevel = async () => {
    if (!fabricCanvas || pages.length === 0) return;
    try {
      setSplitting(true);
      const page = pages[currentPage];
      let selectedIdsToSend = undefined;
      // If 2+ zones are selected, merge them first so one zone covers the phrase, then split by word/sentence
      if (selectedObjects.length >= 2) {
        mergeZones();
        const active = fabricCanvas.getActiveObject();
        const activeData = active?.get?.('data') || active?.data;
        if (activeData?.id) selectedIdsToSend = [activeData.id];
      } else if (selectedObjects.length === 1) {
        const id = (selectedObjects[0].get?.('data') || selectedObjects[0].data)?.id;
        if (id) selectedIdsToSend = [id];
      }
      // Use zones currently on canvas (same format as Save) so positions match what you see
      const zonesToSplit = getKitabooZoneShapes(fabricCanvas)
        .map(serializeFabricZone)
        .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
      const res = await api.post(
        `/kitaboo/split-zones-by-level/${jobId}/${currentPage + 1}`,
        { syncLevel, useAI, zones: zonesToSplit, selectedIds: selectedIdsToSend },
        { timeout: useAI ? 300000 : 10000 }
      );
      const newZones = res.data?.data?.zones ?? res.data?.zones ?? [];
      const newPage = { ...page, zones: newZones };
      setPages(prev => {
        const next = [...prev];
        next[currentPage] = newPage;
        return next;
      });
      initCanvas(newPage);
    } catch (err) {
      console.error('Draw at level failed:', err);
      alert((useAI ? 'AI could not draw boxes. ' : '') + (err.response?.data?.message || err.message));
    } finally {
      setSplitting(false);
    }
  };

  const getZonesInBackendFormat = (pageIndex) => {
    if (pageIndex === currentPage && fabricCanvas) {
      return getKitabooZoneShapes(fabricCanvas)
        .map(serializeFabricZone)
        .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
    }
    return pages[pageIndex]?.zones || [];
  };

  const applyToAllPages = async (newLevel) => {
    if (!jobId || pages.length === 0) return;
    try {
      setApplyingToAllPages(true);
      const nextPages = [...pages];
      for (let i = 0; i < pages.length; i++) {
        const zonesToSend = getZonesInBackendFormat(i);
        const res = await api.post(
          `/kitaboo/split-zones-by-level/${jobId}/${i + 1}`,
          { syncLevel: newLevel, useAI, zones: zonesToSend },
          { timeout: useAI ? 300000 : 10000 }
        );
        const newZones = res.data?.data?.zones ?? res.data?.zones ?? [];
        await api.post(`/kitaboo/save-zones/${jobId}/${i + 1}`, { zones: newZones });
        nextPages[i] = { ...nextPages[i], zones: newZones };
      }
      setPages(nextPages);
      initCanvas(nextPages[currentPage]);
      alert(`${newLevel === 'sentence' ? 'Sentence' : 'Word'} level applied to all ${pages.length} page(s) and saved.`);
    } catch (err) {
      console.error('Apply to all pages failed:', err);
      alert('Failed to apply to all pages: ' + (err.response?.data?.message || err.message));
    } finally {
      setApplyingToAllPages(false);
    }
  };

  const handleHumanAudioUpload = async (e, pageNumber) => {
    const file = e?.target?.files?.[0];
    if (!file || !jobId) return;
    if (!file.name.toLowerCase().endsWith('.mp3')) {
      alert('Please upload an MP3 file.');
      return;
    }
    try {
      setUploadingHumanPage(pageNumber);
      const formData = new FormData();
      formData.append('audio', file);
      await api.post(`/kitaboo/human-audio/${jobId}/${pageNumber}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const listRes = await api.get(`/kitaboo/human-audio/${jobId}`);
      const listData = listRes.data?.data ?? listRes.data;
      if (listData?.pages) setHumanAudioPages(Array.isArray(listData.pages) ? listData.pages : []);
      setSingleBookAudio(!!listData?.singleBookAudio);
      alert(`Human narration uploaded for page ${pageNumber}. Export FXL EPUB will use forced alignment for this page.`);
    } catch (err) {
      console.error('Human audio upload failed:', err);
      alert('Upload failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setUploadingHumanPage(null);
      e.target.value = '';
    }
  };

  const handleSingleBookAudioUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file || !jobId) return;
    if (!file.name.toLowerCase().endsWith('.mp3')) {
      alert('Please upload an MP3 file.');
      return;
    }
    try {
      setUploadingSingleBook(true);
      const formData = new FormData();
      formData.append('audio', file);
      await api.post(`/kitaboo/human-audio/${jobId}/full`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const listRes = await api.get(`/kitaboo/human-audio/${jobId}`);
      const listData = listRes.data?.data ?? listRes.data;
      setSingleBookAudio(!!listData?.singleBookAudio);
      if (listData?.pages) setHumanAudioPages(Array.isArray(listData.pages) ? listData.pages : []);
      alert('Single long audio uploaded for all pages. Export FXL EPUB will use global offset mapping.');
    } catch (err) {
      console.error('Single book audio upload failed:', err);
      alert('Upload failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setUploadingSingleBook(false);
      e.target.value = '';
    }
  };

  const handleCleanPageUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file || !jobId || pages.length === 0) return;
    const pageNumber = currentPage + 1;
    try {
      setUploadingCleanPage(true);
      const formData = new FormData();
      formData.append('image', file);
      await api.post(`/kitaboo/clean-page/${jobId}/${pageNumber}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      alert(`Clean page image uploaded for page ${pageNumber}. Export will use this image.`);
    } catch (err) {
      console.error('Clean page upload failed:', err);
      alert('Upload failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setUploadingCleanPage(false);
      e.target.value = '';
    }
  };

  /** Style keys to preserve from the first zone when merging (font, color, size, stroke, etc.) */
  const ZONE_STYLE_KEYS = [
    'fontSize', 'fontFamily', 'color', 'bold', 'italic', 'origin',
    'strokeColor', 'strokeWidth', 'letterSpacing', 'textShadow',
    'font', 'size', 'ascender', 'descender', 'rotation', 'fontFile',
    'textAlign',
    'enrichmentType', 'enrichmentValue'
  ];

  /** Convex hull of points (Graham scan). Returns array of [x,y] in counter-clockwise order. */
  const convexHull = (points) => {
    if (!points || points.length < 3) return points || [];
    const pts = points.map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.x), Number(p.y)]);
    const start = pts.reduce((min, p) => (p[1] < min[1] || (p[1] === min[1] && p[0] < min[0])) ? p : min);
    const byAngle = pts.filter(p => p[0] !== start[0] || p[1] !== start[1]).sort((a, b) => {
      const ax = a[0] - start[0], ay = a[1] - start[1];
      const bx = b[0] - start[0], by = b[1] - start[1];
      const cross = ax * by - ay * bx;
      if (cross !== 0) return cross > 0 ? 1 : -1;
      return (ax * ax + ay * ay) - (bx * bx + by * by);
    });
    const hull = [start];
    for (const p of byAngle) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2];
        const b = hull[hull.length - 1];
        const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        if (cross <= 0) hull.pop();
        else break;
      }
      hull.push(p);
    }
    return hull;
  };

  /**
   * Build polygon points that hug the text block (trace outline of lines so no gap between line ends).
   * Same logic as backend: top first line → right side step per line → bottom last line → left side back.
   * @param {Array<{bbox?: number[], origin?: number[]}>} lines - each with bbox [left, top, right, bottom] or origin
   * @param {{ defaultW?: number, defaultH?: number }} [opts]
   * @returns {number[][]} points [[x,y], ...] or null
   */
  const linesToOutlinePoints = (lines, opts = {}) => {
    const defaultW = opts.defaultW || 50;
    const defaultH = opts.defaultH || 14;
    if (!lines || lines.length === 0) return null;
    const getBounds = (ln) => {
      if (ln.bbox && ln.bbox.length >= 4) {
        return { left: ln.bbox[0], top: ln.bbox[1], right: ln.bbox[2], bottom: ln.bbox[3] };
      }
      const ox = Number(ln.origin?.[0]) || 0;
      const oy = Number(ln.origin?.[1]) || 0;
      return { left: ox, top: oy, right: ox + defaultW, bottom: oy + defaultH };
    };
    if (lines.length === 1) {
      const b = getBounds(lines[0]);
      return [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];
    }
    const pts = [];
    const b = lines.map(ln => getBounds(ln));
    pts.push([b[0].left, b[0].top]);
    pts.push([b[0].right, b[0].top]);
    pts.push([b[0].right, b[0].bottom]);
    for (let i = 1; i < b.length; i++) {
      pts.push([b[i].right, b[i].top]);
      pts.push([b[i].right, b[i].bottom]);
    }
    pts.push([b[b.length - 1].left, b[b.length - 1].bottom]);
    pts.push([b[b.length - 1].left, b[b.length - 1].top]);
    for (let i = b.length - 2; i >= 0; i--) {
      pts.push([b[i].left, b[i].top]);
    }
    return pts;
  };

  const mergeZones = () => {
    if (!fabricCanvas || selectedObjects.length < 2) return;
    const pageNum = currentPage + 1;
    const shapes = filterZoneSelection(selectedObjects)
      .filter((obj) => obj.get?.('data') || obj.data)
      .sort(
        (a, b) =>
          (a.get?.('data')?.readingOrder ?? a.data?.readingOrder ?? 999) -
          (b.get?.('data')?.readingOrder ?? b.data?.readingOrder ?? 999)
      );
    if (shapes.length < 2) return;

    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    const mergedLines = [];
    const firstData = shapes[0].get?.('data') || shapes[0].data || {};
    const existingId = firstData.id;
    let baseId = existingId ? String(existingId) : `p${pageNum}_z1`;
    baseId = String(baseId).replace(/_w\d+$/, '').replace(/_s\d+$/, '');
    const readingOrder = Math.min(...shapes.map((s) => s.get?.('data')?.readingOrder ?? s.data?.readingOrder ?? 999));

    shapes.forEach((shape) => {
      const d = shape.get?.('data') || shape.data || {};
      const serialized = serializeFabricZone(shape);
      const l = serialized.x ?? shape.left ?? 0;
      const t = serialized.y ?? shape.top ?? 0;
      const w = serialized.w ?? 0;
      const h = serialized.h ?? 0;
      xMin = Math.min(xMin, l);
      yMin = Math.min(yMin, t);
      xMax = Math.max(xMax, l + w);
      yMax = Math.max(yMax, t + h);

      const zoneStyle = {};
      ['fontSize', 'fontFamily', 'color', 'bold', 'italic', 'textAlign'].forEach(k => {
        if (d[k] !== undefined && d[k] !== null && d[k] !== '') zoneStyle[k] = d[k];
      });

      if (Array.isArray(d.lines) && d.lines.length > 0) {
        d.lines.forEach(line => {
          const bbox = line.bbox && line.bbox.length >= 4 ? line.bbox : [l, t, l + w, t + h];
          const origin = line.origin && line.origin.length >= 2 ? line.origin : [l, t];
          // Prefer line-level style (exact word/line position and style from PDF), fall back to zone style
          mergedLines.push({
            text: (line.text || '').trim(),
            bbox: bbox.map(Number),
            origin: origin.map(Number),
            align: line.align || d.textAlign || 'left',
            ...(line.fontSize != null ? { fontSize: line.fontSize } : zoneStyle.fontSize != null ? { fontSize: zoneStyle.fontSize } : {}),
            ...(line.fontFamily != null ? { fontFamily: line.fontFamily } : zoneStyle.fontFamily != null ? { fontFamily: zoneStyle.fontFamily } : {}),
            ...(line.color != null ? { color: line.color } : zoneStyle.color != null ? { color: zoneStyle.color } : {}),
            ...(line.bold != null ? { bold: line.bold } : zoneStyle.bold != null ? { bold: zoneStyle.bold } : {}),
            ...(line.italic != null ? { italic: line.italic } : zoneStyle.italic != null ? { italic: zoneStyle.italic } : {})
          });
        });
      } else {
        const content = (d.content || '').trim();
        if (content) {
          mergedLines.push({
            text: content,
            bbox: [l, t, l + w, t + h],
            origin: [l, t],
            align: d.textAlign || 'left',
            ...(zoneStyle.fontSize != null && { fontSize: zoneStyle.fontSize }),
            ...(zoneStyle.fontFamily != null && { fontFamily: zoneStyle.fontFamily }),
            ...(zoneStyle.color != null && { color: zoneStyle.color }),
            ...(zoneStyle.bold != null && { bold: zoneStyle.bold }),
            ...(zoneStyle.italic != null && { italic: zoneStyle.italic })
          });
        }
      }
    });

    mergedLines.sort((a, b) => {
      const ay = (a.bbox && a.bbox[1] != null) ? a.bbox[1] : (a.origin && a.origin[1] != null ? a.origin[1] : 0);
      const by = (b.bbox && b.bbox[1] != null) ? b.bbox[1] : (b.origin && b.origin[1] != null ? b.origin[1] : 0);
      if (Math.abs(ay - by) > 2) return ay - by;
      const ax = (a.bbox && a.bbox[0] != null) ? a.bbox[0] : (a.origin && a.origin[0] != null ? a.origin[0] : 0);
      const bx = (b.bbox && b.bbox[0] != null) ? b.bbox[0] : (b.origin && b.origin[0] != null ? b.origin[0] : 0);
      return ax - bx;
    });

    // Consolidate adjacent glyphs on the same baseline.
    // SVG text layers break each character into its own zone; after merge their lines array
    // will look like [{text:'C'},{text:'l'},{text:'o'},{text:'s'},{text:'e'}].
    // We join same-line adjacent entries: no space when bboxes are touching (glyphs of the
    // same word), a space when there is a visible gap between them (separate words).
    const estCharWidth = (firstData.fontSize || 12) * 0.65;
    const lineHeightTol = (firstData.fontSize || 12) * 1.4;
    const consolidatedLines = [];
    for (const ln of mergedLines) {
      const lY  = Array.isArray(ln.bbox) && ln.bbox.length >= 4 ? Number(ln.bbox[1]) : (Array.isArray(ln.origin) ? Number(ln.origin[1]) : 0);
      const lX1 = Array.isArray(ln.bbox) && ln.bbox.length >= 4 ? Number(ln.bbox[0]) : (Array.isArray(ln.origin) ? Number(ln.origin[0]) : 0);
      const lX2 = Array.isArray(ln.bbox) && ln.bbox.length >= 4 ? Number(ln.bbox[2]) : lX1 + estCharWidth;
      const lY2 = Array.isArray(ln.bbox) && ln.bbox.length >= 4 ? Number(ln.bbox[3]) : lY + (firstData.fontSize || 12) * 1.2;
      const last = consolidatedLines[consolidatedLines.length - 1];
      if (!last) {
        consolidatedLines.push({ ...ln, _x2: lX2, _y: lY, bbox: [lX1, lY, lX2, lY2] });
        continue;
      }
      const sameLine = Math.abs(lY - last._y) < lineHeightTol * 0.6;
      const gap = lX1 - last._x2;
      if (sameLine) {
        const sep = gap < estCharWidth * 0.7 ? '' : ' ';
        last.text = last.text + sep + ln.text;
        last.bbox = [last.bbox[0], Math.min(last.bbox[1], lY), lX2, Math.max(last.bbox[3], lY2)];
        if (Array.isArray(last.origin) && lX1 < last.origin[0]) last.origin = [lX1, last.origin[1]];
        last._x2 = lX2;
      } else {
        consolidatedLines.push({ ...ln, _x2: lX2, _y: lY, bbox: [lX1, lY, lX2, lY2] });
      }
    }
    consolidatedLines.forEach(ln => { delete ln._x2; delete ln._y; });

    const mergedW = Math.max(1, Math.round(xMax - xMin));
    const mergedH = Math.max(1, Math.round(yMax - yMin));
    const mergedX = Math.round(xMin);
    const mergedY = Math.round(yMin);
    const mergedContent = consolidatedLines.map(ln => ln.text).filter(Boolean).join(' ');

    const preservedStyle = {};
    ZONE_STYLE_KEYS.forEach(key => {
      const v = firstData[key];
      if (v !== undefined && v !== null && v !== '') preservedStyle[key] = v;
    });

    const mergedSnapshot = {
      id: baseId,
      x: mergedX,
      y: mergedY,
      w: mergedW,
      h: mergedH,
      content: mergedContent,
      type: 'text',
      readingOrder,
      altText: firstData.altText ?? '',
      syncId: `${baseId}_sync`,
      lines: consolidatedLines.length > 0 ? consolidatedLines : undefined,
      ...preservedStyle,
    };

    try {
      shapes.forEach((s) => removeKitabooZoneFromCanvas(fabricCanvas, s));
      const mergedShape = addKitabooZoneToCanvas(fabricCanvas, mergedSnapshot, readingOrder - 1, previewMode);
      fabricCanvas.setActiveObject(mergedShape);
      setSelectedZone(mergedShape);
      setSelectedObjects([mergedShape]);
      fabricCanvas.renderAll();
      setZonePropsVersion(v => v + 1);
    } catch (err) {
      console.error('Merge failed:', err);
      alert('Merge failed: ' + (err.message || 'unknown error') + '. Zones were not removed.');
      fabricCanvas.renderAll();
    }
  };

  const closePolygonZone = () => {
    if (!fabricCanvas || polygonPoints.length < 3) return;
    const pageNum = currentPage + 1;
    const shapes = getKitabooZoneShapes(fabricCanvas);
    const zIndices = shapes.map((s) => {
      const id = (s.get?.('data') || s.data)?.id;
      const m = String(id || '').match(/^p(\d+)_z(\d+)/);
      return m && parseInt(m[1], 10) === pageNum ? parseInt(m[2], 10) : 0;
    });
    const nextZ = zIndices.length ? Math.max(0, ...zIndices) + 1 : 1;
    const maxOrder = shapes.length === 0 ? 0 : Math.max(...shapes.map((s) => (s.get?.('data') || s.data)?.readingOrder ?? 0));
    const nextOrder = maxOrder + 1;
    const baseId = `p${pageNum}_z${nextZ}`;
    const pts = polygonPoints.map((p) => [Math.round(p.x), Math.round(p.y)]);
    const minX = Math.min(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1]));
    const w = Math.max(1, Math.max(...pts.map((p) => p[0])) - minX);
    const h = Math.max(1, Math.max(...pts.map((p) => p[1])) - minY);
    const zoneSnapshot = {
      id: baseId,
      type: 'text',
      content: '',
      x: minX,
      y: minY,
      w,
      h,
      readingOrder: nextOrder,
      altText: '',
      syncId: `${baseId}_sync`,
      points: pts,
    };
    const shape = addKitabooZoneToCanvas(fabricCanvas, zoneSnapshot, nextOrder - 1, previewMode);
    fabricCanvas.setActiveObject(shape);
    setSelectedZone(shape);
    setSelectedObjects([shape]);
    setPolygonPoints([]);
    setPolygonDrawingMode(false);
    fabricCanvas.selection = true;
    fabricCanvas.renderAll();
    setZonePropsVersion(v => v + 1);
  };

  const addZone = () => {
    if (!fabricCanvas) return;
    const pageNum = currentPage + 1;
    const shapes = getKitabooZoneShapes(fabricCanvas);
    const ids = shapes.map((s) => (s.get?.('data') || s.data)?.id).filter(Boolean);
    const zIndices = ids.map((id) => {
      const m = String(id).match(/^p(\d+)_z(\d+)/);
      return m && parseInt(m[1], 10) === pageNum ? parseInt(m[2], 10) : 0;
    });
    const nextZ = zIndices.length ? Math.max(0, ...zIndices) + 1 : 1;
    const maxOrder = shapes.length === 0 ? 0 : Math.max(...shapes.map((s) => (s.get?.('data') || s.data)?.readingOrder ?? 0));
    const nextOrder = maxOrder + 1;
    const baseId = `p${pageNum}_z${nextZ}`;
    const newId = syncLevel === 'word'
      ? `${baseId}_w0`
      : syncLevel === 'sentence'
        ? `${baseId}_s0`
        : baseId;
    const defaultW = 180;
    const defaultH = 32;
    const zoneSnapshot = {
      id: newId,
      type: 'text',
      content: '',
      x: 40 + (shapes.length % 4) * (defaultW + 20),
      y: 40 + Math.floor(shapes.length / 4) * (defaultH + 16),
      w: defaultW,
      h: defaultH,
      readingOrder: nextOrder,
      altText: '',
      syncId: `${newId}_sync`,
    };
    const shape = addKitabooZoneToCanvas(fabricCanvas, zoneSnapshot, nextOrder - 1, previewMode);
    fabricCanvas.setActiveObject(shape);
    setSelectedZone(shape);
    setSelectedObjects([shape]);
    fabricCanvas.renderAll();
    setZonePropsVersion(v => v + 1);
  };

  const deleteSelectedZones = useCallback(() => {
    if (!fabricCanvas) return;
    const toRemove = fabricCanvas.getActiveObjects?.()?.length > 0
      ? fabricCanvas.getActiveObjects()
      : selectedObjects.length > 0
        ? selectedObjects
        : fabricCanvas.getActiveObject()
          ? [fabricCanvas.getActiveObject()]
          : [];
    if (toRemove.length === 0) return;
    toRemove.forEach((obj) => {
      if (isKitabooZoneShape(obj)) removeKitabooZoneFromCanvas(fabricCanvas, obj);
      else if (obj[KITABOO_ZONE_LABEL]) {
        const shape = getKitabooZoneShapes(fabricCanvas).find((s) => s.kitabooZoneId === obj.kitabooZoneId);
        if (shape) removeKitabooZoneFromCanvas(fabricCanvas, shape);
        else fabricCanvas.remove(obj);
      } else fabricCanvas.remove(obj);
    });
    fabricCanvas.discardActiveObject();
    setSelectedZone(null);
    setSelectedObjects([]);
    fabricCanvas.renderAll();
    setZonePropsVersion(v => v + 1);
  }, [fabricCanvas, selectedObjects]);

  // Delete selected zone(s) on Delete or Backspace (when not typing in an input)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!fabricCanvas || selectedObjects.length === 0) return;
      e.preventDefault();
      deleteSelectedZones();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fabricCanvas, selectedObjects.length, deleteSelectedZones]);

  // Polygon drawing mode: disable selection, make zones non-interactive so clicks add points, add point on canvas click
  useEffect(() => {
    if (!fabricCanvas) return;
    fabricCanvas.selection = !polygonDrawingMode;
    if (!polygonDrawingMode) {
      setPolygonPoints([]);
      polygonPreviewRef.current && fabricCanvas.remove(polygonPreviewRef.current);
      polygonPreviewRef.current = null;
      polygonModeRestoreEventedRef.current.forEach(({ obj, evented }) => { if (obj && obj.set) obj.set('evented', evented); });
      polygonModeRestoreEventedRef.current = [];
      fabricCanvas.renderAll();
      return;
    }
    const objects = fabricCanvas.getObjects();
    polygonModeRestoreEventedRef.current = objects.map(obj => ({ obj, evented: obj.evented !== false }));
    objects.forEach(obj => obj.set('evented', false));
    const onMouseDown = (e) => {
      const domEvent = e && e.e;
      if (!domEvent) return;
      const pt = fabricCanvas.getScenePoint(domEvent);
      if (pt == null || typeof pt.x !== 'number' || typeof pt.y !== 'number') return;
      setPolygonPoints(prev => [...prev, { x: pt.x, y: pt.y }]);
      fabricCanvas.renderAll();
    };
    fabricCanvas.on('mouse:down', onMouseDown);
    return () => {
      fabricCanvas.off('mouse:down', onMouseDown);
      fabricCanvas.selection = true;
      polygonModeRestoreEventedRef.current.forEach(({ obj, evented }) => { if (obj && obj.set) obj.set('evented', evented); });
      polygonModeRestoreEventedRef.current = [];
    };
  }, [fabricCanvas, polygonDrawingMode]);

  // Draw preview of polygon points (circles + lines) when in polygon mode
  useEffect(() => {
    if (!fabricCanvas || !polygonDrawingMode) return;
    const pts = polygonPoints;
    if (pts.length === 0) {
      if (polygonPreviewRef.current) {
        fabricCanvas.remove(polygonPreviewRef.current);
        polygonPreviewRef.current = null;
      }
      fabricCanvas.renderAll();
      return;
    }
    const stroke = '#0078ff';
    const fill = 'rgba(0, 120, 255, 0.4)';
    const r = 6;
    const elements = [];
    pts.forEach((p, i) => {
      elements.push(new fabric.Circle({ left: p.x - r, top: p.y - r, radius: r, fill, stroke, strokeWidth: 2, selectable: false, evented: false }));
      if (i > 0) {
        const prev = pts[i - 1];
        const line = new fabric.Line([prev.x, prev.y, p.x, p.y], { stroke, strokeWidth: 2, selectable: false, evented: false });
        elements.push(line);
      }
    });
    const group = new fabric.Group(elements, { selectable: false, evented: false });
    if (polygonPreviewRef.current) fabricCanvas.remove(polygonPreviewRef.current);
    fabricCanvas.add(group);
    if (typeof fabricCanvas.bringObjectToFront === 'function') fabricCanvas.bringObjectToFront(group);
    polygonPreviewRef.current = group;
    fabricCanvas.renderAll();
    return () => {
      if (polygonPreviewRef.current && fabricCanvas.getObjects().includes(polygonPreviewRef.current)) {
        fabricCanvas.remove(polygonPreviewRef.current);
        polygonPreviewRef.current = null;
      }
    };
  }, [fabricCanvas, polygonDrawingMode, polygonPoints]);

  // Clear polygon mode when changing page
  useEffect(() => {
    setPolygonDrawingMode(false);
    setPolygonPoints([]);
  }, [currentPage]);

  if (loading) {
    return (
      <div className="kitaboo-studio">
        <div className="kitaboo-studio-body">
          <div className="kitaboo-loading kitaboo-loading-progress">
            <h3>Converting PDF to FXL (WebP)</h3>
            <p className="kitaboo-loading-step">{currentStep || 'Starting...'}</p>
            <div className="kitaboo-progress-bar-container">
              <div
                className="kitaboo-progress-bar-fill"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <span className="kitaboo-progress-percent">{progressPercentage}%</span>
            {slowStepHint ? (
              <p className="kitaboo-loading-hint" style={{ marginTop: 12, fontSize: 13, color: '#64748b', maxWidth: 420 }}>
                This step renders the first pages of your PDF with Python (150 DPI). Large books can take several minutes here — progress should update per page. If nothing changes for more than 15 minutes, check the backend terminal or start a new conversion.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (jobDeleted) {
    return (
      <div className="kitaboo-studio">
        <div className="kitaboo-studio-body">
          <div className="kitaboo-loading kitaboo-loading-error">
            <h3>Job no longer exists</h3>
            <p>This conversion job was deleted. Redirecting you back to Conversions…</p>
            <button className="btn-back" onClick={() => navigate('/conversions')}>← Back to Conversions</button>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="kitaboo-studio">
        <div className="kitaboo-studio-body">
          <div className="kitaboo-loading kitaboo-loading-error">
            <h3>Conversion failed</h3>
            <p>{loadError}</p>
            <button className="btn-back" onClick={() => navigate('/conversions')}>← Back to Conversions</button>
            <button className="btn-back" style={{ marginLeft: 8 }} onClick={() => { processingStarted.current = false; setLoadError(null); setRetryKey(k => k + 1); }}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const workflowJob = jobId
    ? { id: jobId, jobId, jobType: 'FXL' }
    : null;
  const zonesForSidebar = (pages[currentPage]?.zones || [])
    .slice()
    .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));

  return (
    <div className="kitaboo-studio">
      {workflowJob ? (
        <WorkflowStudioChrome
          activeStep={1}
          jobId={jobId}
          job={workflowJob}
          topTitle="FXL Zoning Studio"
          backTo="/conversions/fxl-editor"
        />
      ) : null}

      {hdBackgroundActive ? (
        <div className="kitaboo-hd-banner" role="status">
          Finishing the full book in the background (150 DPI). You can work on the pages shown; more pages appear when each is ready.
        </div>
      ) : null}

      {saveToast ? (
        <div
          className={`kz-save-toast kz-save-toast--${saveToast.type}`}
          role="status"
          aria-live="polite"
        >
          {saveToast.message}
        </div>
      ) : null}

      <div className="kitaboo-studio-body">
        {/* ── Studio: canvas + right panel ── */}
        <div className="kitaboo-workspace">
          {/* ── LEFT: all pages list ── */}
          <aside className="kitaboo-pages-sidebar">
            <div className="kitaboo-pages-sidebar-header">
              <h3>Pages</h3>
              <div className="kitaboo-pages-pager">
                <button type="button" className="kz-pager-btn" onClick={() => handlePageChange('prev')} disabled={currentPage === 0} aria-label="Previous page">‹</button>
                <span className="kz-pager-label">
                  Page {currentPage + 1} <span className="kz-pager-sep">/ {pages.length}</span>
                </span>
                <button type="button" className="kz-pager-btn" onClick={() => handlePageChange('next')} disabled={currentPage === pages.length - 1} aria-label="Next page">›</button>
              </div>
            </div>
            <div className="kitaboo-pages-list">
              {pages.map((page, idx) => {
                const isActive = idx === currentPage;
                const thumbSrc = page?.imagePath ? `${backendOrigin}${page.imagePath}` : '';
                return (
                  <button
                    key={page?.pageNumber ?? idx}
                    type="button"
                    className={`kitaboo-page-thumb${isActive ? ' kitaboo-page-thumb--active' : ''}`}
                    onClick={() => handlePageSelect(idx)}
                    title={`Go to page ${idx + 1}`}
                  >
                    <div className="kitaboo-page-thumb-image-wrap">
                      {thumbSrc ? (
                        <img
                          src={thumbSrc}
                          alt={`Page ${idx + 1}`}
                          className="kitaboo-page-thumb-image"
                          loading="lazy"
                        />
                      ) : (
                        <div className="kitaboo-page-thumb-placeholder">Page {idx + 1}</div>
                      )}
                    </div>
                    <div className="kitaboo-page-thumb-meta">
                      <span className="kitaboo-page-thumb-label">p.{idx + 1}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* ── CENTER: canvas area ── */}
          <main className="kitaboo-canvas-area">

            {/* ── Toolbar ── */}
            <div className="kz-toolbar">
              {/* Quick tools */}
              <div className="kz-toolbar-quick-tools">
                <button
                  type="button"
                  className={`kz-btn kz-btn--tool${activeQuickTool === 'zone' ? ' kz-btn--active' : ''}`}
                  title="Zone tool"
                  onClick={() => setActiveQuickTool(prev => (prev === 'zone' ? null : 'zone'))}
                >
                  Zone
                </button>
                <button
                  type="button"
                  className={`kz-btn kz-btn--tool${activeQuickTool === 'image' ? ' kz-btn--active' : ''}`}
                  title="Image tool"
                  onClick={() => setActiveQuickTool(prev => (prev === 'image' ? null : 'image'))}
                >
                  Image
                </button>
                <button
                  type="button"
                  className={`kz-btn kz-btn--tool${activeQuickTool === 'ocr' ? ' kz-btn--active' : ''}`}
                  title="Edit OCR text for the selected zone"
                  onClick={() => setActiveQuickTool((prev) => (prev === 'ocr' ? null : 'ocr'))}
                >
                  OCR
                </button>
              </div>

              {/* Divider */}
              <div className="kz-toolbar-divider" />

              {/* Zone actions */}
              <div className="kz-toolbar-actions">
                <button
                  type="button"
                  className={`kz-btn kz-btn--tool${selectedObjects.length >= 2 ? ' kz-btn--active' : ''}`}
                  onClick={mergeZones}
                  disabled={!fabricCanvas || selectedObjects.length < 2 || applyingToAllPages}
                  title="Select 2+ zones then merge"
                >
                  Merge {selectedObjects.length >= 2 ? `(${selectedObjects.length})` : ''}
                </button>
                <button
                  type="button"
                  className={`kz-btn kz-btn--tool${polygonDrawingMode ? ' kz-btn--active' : ''}`}
                  onClick={() => setPolygonDrawingMode(prev => !prev)}
                  disabled={!fabricCanvas}
                  title="Draw a multi-line polygon zone"
                >
                  {polygonDrawingMode ? `Polygon (${polygonPoints.length} pts)` : 'Add Polygon'}
                </button>
                {polygonDrawingMode && polygonPoints.length > 0 && (
                  <button type="button" className="kz-btn kz-btn--tool" onClick={() => setPolygonPoints(prev => prev.slice(0, -1))} title="Undo last point">
                    Undo point
                  </button>
                )}
                {polygonDrawingMode && polygonPoints.length >= 3 && (
                  <button type="button" className="kz-btn kz-btn--primary" onClick={closePolygonZone} title="Close polygon and create zone">
                    Close polygon
                  </button>
                )}
                {applyingToAllPages && <span className="kz-status-text">Applying to all pages…</span>}
              </div>

              {/* Divider */}
              {/* <div className="kz-toolbar-divider" /> */}

              {/* Settings
              <div className="kz-toolbar-settings">
                <label className="kz-setting-label">
                  <span>TTS Voice</span>
                  <select
                    className="kz-select"
                    value={ttsVoice ? ttsVoice.name : ''}
                    onChange={(e) => {
                      const name = e.target.value;
                      const v = ttsVoices.find(x => x.name === name);
                      if (v) {
                        setTtsVoice({ name: v.name, gender: v.gender, description: v.description });
                        if (jobId) { try { localStorage.setItem(`kitaboo_ttsVoice_${jobId}`, JSON.stringify({ name: v.name, gender: v.gender })); } catch (err) { ignore }
                      } else {
                        setTtsVoice(null);
                        if (jobId) { try { localStorage.removeItem(`kitaboo_ttsVoice_${jobId}`); } catch (err) { ignore }
                      }
                    }}
                    title="Voice used for read-aloud when exporting FXL EPUB"
                  >
                    <option value="">Default</option>
                    {ttsVoices.map((v) => (
                      <option key={v.name} value={v.name}>{v.description || v.name} ({v.gender || '—'})</option>
                    ))}
                  </select>
                </label>
                <label className="kz-setting-label">
                  <span>Font</span>
                  <input
                    type="text"
                    className="kz-input"
                    value={bodyFontFamily}
                    onChange={(e) => setBodyFontFamily(e.target.value)}
                    placeholder="e.g. Times New Roman, serif"
                  />
                </label>
                <label className="kz-setting-label kz-setting-label--muted" title="Sync level set at conversion time">
                  <span>Sync</span>
                  <select className="kz-select kz-select--disabled" value={syncLevel} disabled>
                    <option value="word">Word</option>
                    <option value="sentence">Sentence</option>
                  </select>
                </label>
              </div>
              */}

              {/* Upload clean page — right-aligned */}
              <div className="kz-canvas-controls" aria-label="Canvas view controls">
                <button type="button" className="kz-canvas-control-btn" title="Zoom out" onClick={handleZoomOut} disabled={!fabricCanvas}>
                  <ZoomOut size={14} />
                </button>
                <span className="kz-canvas-zoom-value">{Math.round(zoomRatio * 100)}%</span>
                <button type="button" className="kz-canvas-control-btn" title="Zoom in" onClick={handleZoomIn} disabled={!fabricCanvas}>
                  <ZoomIn size={14} />
                </button>
                <button type="button" className="kz-canvas-control-btn" title="Fit to screen" onClick={handleFitToView} disabled={!fabricCanvas}>
                  <Maximize2 size={14} />
                </button>
                <button
                  type="button"
                  className={`kz-canvas-control-btn${previewMode ? ' kz-canvas-control-btn--active' : ''}`}
                  title="Preview (hide/show zones)"
                  onClick={handleTogglePreviewMode}
                  disabled={!fabricCanvas}
                >
                  <Eye size={14} />
                </button>
              </div>

              <input ref={cleanPageInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleCleanPageUpload} />
              <button
                type="button"
                className="kz-btn kz-btn--ghost kz-toolbar-end"
                onClick={() => cleanPageInputRef.current?.click()}
                disabled={uploadingCleanPage || !jobId || pages.length === 0}
                title="Upload a clean (text-removed) image for this page"
              >
                {uploadingCleanPage ? 'Uploading…' : `Upload clean (p.${currentPage + 1})`}
              </button>
              <div className="kz-toolbar-workflow-actions">
                <button
                  type="button"
                  className="kz-btn kz-btn--primary"
                  onClick={handleSaveAndGoToSyncStudio}
                  disabled={saving || !jobId}
                  title="Save current page and continue to Sync Studio"
                >
                  {saving ? 'Saving…' : 'Save & Next'}
                </button>
                <button type="button" className="kz-btn kz-btn--save" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Current Page'}
                </button>
              </div>
            </div>

            {/* ── Canvas ── */}
            <div className="kitaboo-canvas-container" ref={canvasContainerRef}>
              <canvas id="kitaboo-canvas" />
            </div>
          </main>

          {/* ── RIGHT: zone properties panel ── */}
          <aside className="kitaboo-sidebar">
          {activeQuickTool === 'zone' ? (
            <>
              <h3>Zones on this page</h3>
              <div className="tagging-panel tagging-panel--zones-list">
                <div className="zone-list">
                  {zonesForSidebar.length === 0 ? (
                    <div className="empty-state">
                      <p>No zones found on this page.</p>
                    </div>
                  ) : zonesForSidebar.map((zone, idx) => {
                    const type = zone?.type || 'text';
                    const title = (zone?.content || '').trim() || `${type} zone`;
                    return (
                      <button
                        key={zone?.id || `zone-${idx}`}
                        type="button"
                        className="zone-list-item"
                        onClick={() => focusZoneById(zone?.id)}
                        title={`Select ${title}`}
                      >
                        <span className={`zone-list-icon zone-list-icon--${type === 'image' ? 'image' : 'text'}`}>
                          {type === 'image' ? 'I' : 'Z'}
                        </span>
                        <span className="zone-list-text">
                          <span className="zone-list-title">{title}</span>
                          <span className="zone-list-sub">{type} · page {currentPage + 1}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="zone-continue-btn"
                  onClick={handleSaveAndGoToSyncStudio}
                  disabled={saving || !jobId}
                >
                  {saving ? 'Saving…' : 'Continue to Audio Sync'}
                </button>
              </div>
            </>
          ) : activeQuickTool === 'ocr' ? (
            <>
              <h3>OCR — edit zone text</h3>
              <p style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
                Select a zone on the canvas, then correct the extracted text below. Text comes from the PDF at conversion time.
              </p>
              {selectedZone && selectedZoneData ? (
                <div className="tagging-panel">
                  <div className="prop-group">
                    <label>Zone ID</label>
                    <input type="text" value={selectedZoneData.id || ''} readOnly />
                  </div>
                  <div className="prop-group">
                    <label>Text Content (OCR)</label>
                    <textarea
                      rows={8}
                      placeholder="Actual text in this zone..."
                      value={getZoneTextContent(selectedZoneData)}
                      onChange={(e) => handleEnrichmentUpdate('content', e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <p>Click a zone on the canvas to edit its OCR text.</p>
                </div>
              )}
            </>
          ) : (
            <>
          <h3>Zone Properties</h3>
          {selectedZone && selectedZoneData ? (
            <div className="tagging-panel">
              {selectedObjects.length > 1 && (
                <p style={{ fontSize: '12px', color: '#1976d2', marginBottom: 12, fontWeight: 500 }}>
                  {selectedObjects.length} zones selected. Use <strong>Merge</strong> to combine, or click one zone to edit.
                </p>
              )}
              {syncLevel === 'word' && selectedObjects.length === 1 && (
                <div className="word-level-tip" style={{ fontSize: '12px', color: '#000000ff', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '6px', marginBottom: '12px' }}>
                  <strong>Word-level:</strong> Zones match the level chosen at Convert. Edit <em>Text Content (OCR)</em> below if needed.
                </div>
              )}
              {syncLevel === 'sentence' && selectedObjects.length === 1 && (
                <div className="sentence-level-tip" style={{ fontSize: '12px', color: '#000000ff', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '6px', marginBottom: '12px' }}>
                  <strong>Sentence-level:</strong> Zones match the level chosen at Convert. Edit <em>Text Content (OCR)</em> below if needed. Click a box on the canvas to select it.
                </div>
              )}
              <div className="prop-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="zone-remove-btn"
                  onClick={deleteSelectedZones}
                  title="Remove selected zone(s) from the canvas"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  Remove zone{selectedObjects.length > 1 ? `s (${selectedObjects.length})` : ''}
                </button>
              </div>
              <div className="prop-group">
                <label>Zone ID</label>
                <input type="text" value={selectedZoneData.id || ''} readOnly />
              </div>

              <div className="prop-group">
                <label>Reading Order</label>
                <input
                  type="number"
                  value={selectedZoneData.readingOrder ?? ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 0;
                    patchSelectedZoneData({ readingOrder: val });
                    const label = getKitabooZoneLabel(fabricCanvas, selectedZone.kitabooZoneId);
                    if (label) label.set('text', String(val));
                  }}
                />
              </div>

              <div className="prop-group">
                <label>Type</label>
                <select
                  value={selectedZoneData.type || 'text'}
                  onChange={(e) => patchSelectedZoneData({ type: e.target.value })}
                >
                  <option value="text">Text Block</option>
                  <option value="image">Image Asset</option>
                  <option value="button">Interactive Hotspot</option>
                  <option value="header">Heading/Header</option>
                </select>
              </div>

              <div className="prop-group">
                <label>Alt Text (Accessibility)</label>
                <input
                  type="text"
                  placeholder="Describe this element..."
                  value={selectedZoneData.altText || ''}
                  onChange={(e) => handleEnrichmentUpdate('altText', e.target.value)}
                />
              </div>

              <div className="prop-group">
                <label>Sync-ID (Read-Aloud)</label>
                <input
                  type="text"
                  placeholder="e.g., p1_w20"
                  value={selectedZoneData.syncId || ''}
                  onChange={(e) => handleEnrichmentUpdate('syncId', e.target.value)}
                />
              </div>

              <div className="prop-group">
                <label>Text Content (OCR)</label>
                <textarea
                  placeholder="Actual text in this zone..."
                  value={getZoneTextContent(selectedZoneData)}
                  onChange={(e) => handleEnrichmentUpdate('content', e.target.value)}
                />
              </div>

              <div className="prop-group" style={{ marginTop: '12px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>Word-level styles (sentence sync)</h4>
                <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#666' }}>Click a word below to select it, then apply Bold / Italic / Color. Exported EPUB will keep these styles within the sentence.</p>
                {(() => {
                  const content = getZoneTextContent(selectedZoneData);
                  const tokens = tokenizeZoneContent(content);
                  const sel = wordStyleSelection;
                  const hasSelection = sel.start != null && sel.end != null && sel.start < sel.end;
                  const selectionStyle = hasSelection
                    ? getStyleAtIndex(selectedZoneData.styleRuns, sel.start, selectedZoneData)
                    : null;
                  return (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', marginBottom: '8px', lineHeight: 1.6 }}>
                        {tokens.length === 0 ? (
                          <span style={{ fontSize: '12px', color: '#888' }}>Add OCR text above to style words.</span>
                        ) : (
                          tokens.map((t, i) => {
                            const selected = hasSelection && t.start >= sel.start && t.end <= sel.end;
                            const runStyle = tokenStyleFromRuns(selectedZoneData.styleRuns, t, selectedZoneData);
                            const isWhitespace = !/\S/.test(t.text);
                            return (
                              <span
                                key={i}
                                role={isWhitespace ? undefined : 'button'}
                                tabIndex={isWhitespace ? undefined : 0}
                                onClick={
                                  isWhitespace
                                    ? undefined
                                    : () => setWordStyleSelection({ start: t.start, end: t.end })
                                }
                                onKeyDown={
                                  isWhitespace
                                    ? undefined
                                    : (e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          setWordStyleSelection({ start: t.start, end: t.end });
                                        }
                                      }
                                }
                                style={{
                                  padding: isWhitespace ? 0 : '2px 4px',
                                  borderRadius: '4px',
                                  cursor: isWhitespace ? 'default' : 'pointer',
                                  background: selected ? 'rgba(33, 150, 243, 0.3)' : 'transparent',
                                  fontWeight: runStyle.fontWeight,
                                  fontStyle: runStyle.fontStyle,
                                  color: runStyle.color,
                                }}
                              >
                                {t.text}
                              </span>
                            );
                          })
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: '#666' }}>
                          {hasSelection ? `Selection: ${sel.start}–${sel.end}` : 'Select a word above'}
                        </span>
                        <button
                          type="button"
                          disabled={!hasSelection}
                          onClick={() => {
                            if (!hasSelection) return;
                            const nextBold = !(selectionStyle?.bold);
                            applyWordStyle(selectedZone, sel.start, sel.end, { bold: nextBold });
                          }}
                          className={selectionStyle?.bold ? 'word-style-btn word-style-btn--active' : 'word-style-btn'}
                          style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 'bold', cursor: hasSelection ? 'pointer' : 'not-allowed', opacity: hasSelection ? 1 : 0.6 }}
                          title={selectionStyle?.bold ? 'Remove bold from selection' : 'Make selection bold'}
                        >
                          Bold
                        </button>
                        <button
                          type="button"
                          disabled={!hasSelection}
                          onClick={() => {
                            if (!hasSelection) return;
                            const nextItalic = !(selectionStyle?.italic);
                            applyWordStyle(selectedZone, sel.start, sel.end, { italic: nextItalic });
                          }}
                          className={selectionStyle?.italic ? 'word-style-btn word-style-btn--active' : 'word-style-btn'}
                          style={{ padding: '4px 10px', fontSize: '12px', fontStyle: 'italic', cursor: hasSelection ? 'pointer' : 'not-allowed', opacity: hasSelection ? 1 : 0.6 }}
                          title={selectionStyle?.italic ? 'Remove italic from selection' : 'Make selection italic'}
                        >
                          Italic
                        </button>
                        <input
                          type="color"
                          disabled={!hasSelection}
                          title="Set selection color"
                          value={selectionStyle?.color || '#000000'}
                          style={{ width: '28px', height: '28px', padding: 0, cursor: hasSelection ? 'pointer' : 'not-allowed', opacity: hasSelection ? 1 : 0.6 }}
                          onChange={(e) => {
                            if (!hasSelection) return;
                            applyWordStyle(selectedZone, sel.start, sel.end, { color: e.target.value });
                          }}
                        />
                      </div>
                    </>
                  );
                })()}
              </div>

            </div>
          ) : (
            <div className="empty-state">
              <p>Select a zone on the canvas to configure properties and enrichments.</p>
            </div>
          )}
            </>
          )}
        </aside>
        </div>
      </div>
    </div>
  );
};

export default KitabooZoningStudio;