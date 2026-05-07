import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import * as fabric from 'fabric';
import api, { API_BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import OrgAdminSidebar from '../components/layout/OrgAdminSidebar';
import {
  ArrowLeft,
  BookOpen,
  LayoutGrid,
  Film,
  FolderOpen,
  Gauge,
  Users,
  RefreshCw,
  FileText,
  LogOut,
} from 'lucide-react';
import './KitabooZoningStudio.css';

const KitabooZoningStudio = () => {
  const { jobId: routeJobId } = useParams();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
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
  const [selectedZone, setSelectedZone] = useState(null);
  const [selectedObjects, setSelectedObjects] = useState([]); // multiple selection for Merge
  const [jobId, setJobId] = useState(routeJobId || null);
  const [syncLevel, setSyncLevel] = useState('sentence'); // from Convert modal (word/sentence) — applied automatically, no Sync dropdown
  const useAI = true; // Always use AI for exact word/sentence box positions (backend default)
  const [splitting, setSplitting] = useState(false);
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [zonePropsVersion, setZonePropsVersion] = useState(0); // bump to force Zone Properties panel to re-render after edits
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
  const [useAbsoluteHtml, setUseAbsoluteHtml] = useState(false); // pdf2htmlEX-style text layer (no SVG)
  const [bodyFontFamily, setBodyFontFamily] = useState(''); // Optional override font for all FXL pages
  const polygonPreviewRef = useRef(null); // Fabric group showing points + lines while drawing
  const polygonModeRestoreEventedRef = useRef([]); // restore evented on exit
  const cleanPageInputRef = useRef(null);
  const pollTimerRef = useRef(null);
  const skipCanvasReinitUntil = useRef(0);
  const canvasInitScheduled = useRef(false);
  const canvasContainerRef = useRef(null); // scroll reset on page change

  // Derive backend origin from API_BASE_URL (e.g., http://localhost:8081)
  const backendOrigin = API_BASE_URL.replace('/api', '');

  useEffect(() => {
    let cancelled = false;

    const pollJobStatus = async () => {
      if (cancelled) return;
      try {
        const res = await api.get(`/kitaboo/job/${routeJobId}`);
        const d = res.data?.data || res.data;
        setProgressPercentage(d.progressPercentage ?? 0);
        setCurrentStep(d.currentStep ?? '');
        if (d.status === 'COMPLETED' && Array.isArray(d.pages) && d.pages.length > 0) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setPages(d.pages);
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
        if (e.response?.status === 404) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setLoadError('Job not found');
          setLoading(false);
        }
      }
    };

    const initWorkflow = async () => {
      if (processingStarted.current || !routeJobId) return;
      processingStarted.current = true;
      setLoadError(null);
      setProgressPercentage(0);
      setCurrentStep('Checking...');

      try {
        setLoading(true);
        const readyRes = await api.get(`/kitaboo/ready/${routeJobId}`).catch(() => null);
        const readyData = readyRes?.data?.data ?? readyRes?.data;
        if (readyData?.ready && Array.isArray(readyData.pages) && readyData.pages.length > 0) {
          setPages(readyData.pages);
          setJobId(readyData.jobId || routeJobId);
          const level = readyData.zoneLevel || readyData.extractionLevel;
          if (level === 'word' || level === 'sentence') setSyncLevel(level);
          setLoading(false);
          return;
        }

        const jobRes = await api.get(`/kitaboo/job/${routeJobId}`).catch((e) => (e.response?.status === 404 ? null : Promise.reject(e)));
        if (jobRes) {
          const jobData = jobRes.data?.data ?? jobRes.data;
          if (jobData.status === 'COMPLETED' && Array.isArray(jobData.pages) && jobData.pages.length > 0) {
            setPages(jobData.pages);
            setJobId(jobData.jobId);
            const level = jobData.zoneLevel || jobData.extractionLevel;
            if (level === 'word' || level === 'sentence') setSyncLevel(level);
            setLoading(false);
            return;
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
        }

        setLoadError('Job not found');
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

  useEffect(() => {
    if (!loading && pages.length > 0) {
      if (Date.now() < skipCanvasReinitUntil.current) return;
      setSelectedZone(null);
      setSelectedObjects([]);
      // Scroll the canvas container back to the top so changing pages always
      // starts at the top-left of the new page, not where the previous page left off.
      if (canvasContainerRef.current) {
        canvasContainerRef.current.scrollTop = 0;
        canvasContainerRef.current.scrollLeft = 0;
      }
      initCanvas(pages[currentPage]);
    }
  }, [loading, currentPage, pages]);

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
    const canvasZones = fabricCanvas.getObjects()
      .filter(obj => obj.type === 'group')
      .map(group => {
        const rect = group.item(0);
        const data = group.get('data') || group.data || {};
        return {
          ...data,
          x: Math.round(group.left),
          y: Math.round(group.top),
          w: Math.round((rect?.width || 0) * (group.scaleX || 1)),
          h: Math.round((rect?.height || 0) * (group.scaleY || 1)),
          readingOrder: data.readingOrder
        };
      })
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

  /** When 2+ zones are selected, show one combined highlight (one block); text positions stay as in PDF. */
  const updateMultiSelectHighlight = (canvas, sel) => {
    if (!canvas) return;
    multiSelectedRestoreRef.current.forEach(({ group, stroke }) => {
      const rect = group.item?.(0);
      if (rect) rect.set('stroke', stroke);
    });
    multiSelectedRestoreRef.current = [];

    const rectRef = combinedSelectionRectRef.current;
    if (rectRef && rectRef.canvas === canvas) {
      canvas.remove(rectRef);
      combinedSelectionRectRef.current = null;
    }

    if (sel.length >= 2) {
      let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
      sel.forEach(obj => {
        const r = obj.item?.(0);
        let l, t, w, h;
        if (r && r.type === 'polygon' && r.points && r.points.length >= 3) {
          const scaleX = obj.scaleX ?? 1;
          const scaleY = obj.scaleY ?? 1;
          r.points.forEach(p => {
            const px = obj.left + (p.x ?? p[0]) * scaleX;
            const py = obj.top + (p.y ?? p[1]) * scaleY;
            xMin = Math.min(xMin, px);
            yMin = Math.min(yMin, py);
            xMax = Math.max(xMax, px);
            yMax = Math.max(yMax, py);
          });
          return;
        }
        l = obj.left ?? 0;
        t = obj.top ?? 0;
        w = (r?.width ?? 0) * (obj.scaleX ?? 1);
        h = (r?.height ?? 0) * (obj.scaleY ?? 1);
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
      sel.forEach(obj => {
        const rect = obj.item?.(0);
        if (rect) {
          multiSelectedRestoreRef.current.push({ group: obj, stroke: rect.get('stroke') });
          rect.set('stroke', 'transparent');
        }
      });
    }
    canvas.renderAll();
  };

  const initCanvas = (pageData) => {
    if (canvasInitScheduled.current) return;
    canvasInitScheduled.current = true;
    const doInit = () => {
      if (fabricCanvas) {
        try {
          fabricCanvas.dispose();
        } catch (e) {
          console.warn('[Studio] Canvas dispose:', e?.message);
        }
        setFabricCanvas(null);
      }
      requestAnimationFrame(() => createCanvas(pageData));
    };
    const createCanvas = (pageData) => {
      try {
        // 1. Lock canvas to the ACTUAL image dimensions from the backend
        // This ensures saved coordinates (x, y, w, h) match the EPUB viewport 1:1
        const canvas = new fabric.Canvas('kitaboo-canvas', {
          width: pageData.dimensions.width,
          height: pageData.dimensions.height,
          backgroundColor: '#ffffff',
          selection: true,
          preserveObjectStacking: true,
          selectionKey: 'shiftKey',
          altSelectionKey: 'ctrlKey'
        });

        const imageUrl = `${backendOrigin}${pageData.imagePath}`;
        console.log('[Studio] Loading background:', imageUrl);

        fabric.Image.fromURL(imageUrl, {
          crossOrigin: 'anonymous'
        }).then((img) => {
          // 1. Force the canvas to match the image dimensions exactly
          canvas.setDimensions({
            width: img.width,
            height: img.height
          }, { backstoreOnly: false });

          // 2. Ensure image is at 0,0 and origin is top-left
          img.set({
            left: 0,
            top: 0,
            originX: 'left',
            originY: 'top',
            scaleX: 1,
            scaleY: 1
          });

          canvas.backgroundImage = img;
          canvas.renderAll();
          console.log('[Studio] Background applied 1:1:', img.width, 'x', img.height);

          // 3. Fit canvas to the visible container using Fabric's own zoom.
          //    This resizes the actual canvas element (no CSS transform tricks)
          //    so the container scrolls correctly and zone hit-testing stays accurate.
          requestAnimationFrame(() => {
            const scrollEl = canvasContainerRef.current;
            if (!scrollEl) return;
            const padding = 48; // 24px each side
            const availW = scrollEl.clientWidth  - padding;
            const availH = scrollEl.clientHeight - padding;
            const scale  = Math.min(availW / img.width, availH / img.height, 1);
            canvas.setZoom(scale);
            canvas.setDimensions({
              width:  Math.round(img.width  * scale),
              height: Math.round(img.height * scale),
            });
            canvas.renderAll();
          });
        }).catch(err => {
          console.error('[Studio] Background load failed:', err);
        });

        // Render Gemini Zones (rect or polygon)
        pageData.zones.forEach((zone, index) => {
          const rOrder = zone.readingOrder || index + 1;
          const text = new fabric.IText(rOrder.toString(), {
            left: 5,
            top: 5,
            fontSize: 16,
            fill: '#fff',
            backgroundColor: '#0078ff',
            selectable: false,
          });
          const commonShapeOpts = {
            fill: 'rgba(0, 120, 255, 0.2)',
            stroke: '#0078ff',
            strokeWidth: 2,
            cornerColor: '#0078ff',
            cornerSize: 10,
            transparentCorners: false
          };
          let shape;
          let groupLeft, groupTop;
          // Track whether points came from stored zone.points (already went through at least
          // one init cycle) vs freshly derived from x,y,w,h.  The EXTRA_RIGHT_PAD is a
          // display-only tweak that must only be applied once, and must NOT be saved back into
          // data.points — otherwise every reinit adds another 8 px and zones grow forever.
          const hadStoredPoints = Array.isArray(zone.points) && zone.points.length >= 3;
          let zonePoints = hadStoredPoints
            ? zone.points.map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.x), Number(p.y)])
            : null;
          // Default rect zones (x,y,w,h): represent as 4-point polygon so all zones are polygons
          if (!zonePoints && zone.x != null && zone.y != null && zone.w != null && zone.h != null) {
            const x = Number(zone.x), y = Number(zone.y), w = Number(zone.w), h = Number(zone.h);
            zonePoints = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
          }
          // The canonical (un-padded) points that get stored in data.points.
          // Saved separately so the display polygon can be padded without mutating the stored coords.
          const canonicalPoints = zonePoints ? zonePoints.map(p => [...p]) : null;
          // UI-only padding: some PDFs have very tight bboxes, so the last glyph can look "cut"
          // by the right edge of the zone.  Only apply to zones freshly derived from x,y,w,h
          // (hadStoredPoints === false).  Never apply to already-stored polygon points so we
          // don't accumulate +8 px on every save/navigate cycle.
          if (!hadStoredPoints && zonePoints && zonePoints.length === 4) {
            const xs = zonePoints.map(p => p[0]);
            const ys = zonePoints.map(p => p[1]);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const isAxisAlignedRect =
              zonePoints.some(p => p[0] === minX && p[1] === minY) &&
              zonePoints.some(p => p[0] === maxX && p[1] === minY) &&
              zonePoints.some(p => p[0] === maxX && p[1] === maxY) &&
              zonePoints.some(p => p[0] === minX && p[1] === maxY);
            if (isAxisAlignedRect) {
              const EXTRA_RIGHT_PAD = 8;
              zonePoints = zonePoints.map(([x, y]) => [x === maxX ? (x + EXTRA_RIGHT_PAD) : x, y]);
            }
          }
          if (zonePoints && zonePoints.length >= 3) {
            const minX = Math.min(...zonePoints.map(p => p[0]));
            const minY = Math.min(...zonePoints.map(p => p[1]));
            const relativePoints = zonePoints.map(p => ({ x: p[0] - minX, y: p[1] - minY }));
            shape = new fabric.Polygon(relativePoints, commonShapeOpts);
            groupLeft = minX;
            groupTop = minY;
          } else {
            shape = new fabric.Rect({
              width: zone.w,
              height: zone.h,
              ...commonShapeOpts
            });
            groupLeft = zone.x;
            groupTop = zone.y;
          }
          const group = new fabric.Group([shape, text], {
            left: groupLeft,
            top: groupTop,
            id: zone.id,
            originX: 'left',
            originY: 'top',
            data: {
              ...zone,
              // Store the UN-PADDED canonical points so future reinits start from the true
              // coordinates and the display-only EXTRA_RIGHT_PAD is never accumulated.
              ...(canonicalPoints && canonicalPoints.length >= 3 && { points: canonicalPoints }),
              readingOrder: rOrder,
              altText: zone.altText || '',
              syncId: zone.syncId || `${zone.id}_sync`
            }
          });
          canvas.add(group);
        });

        canvas.on('selection:created', (e) => {
          const sel = e.selected || [];
          setSelectedObjects(sel);
          setSelectedZone(sel[0] || null);
          updateMultiSelectHighlight(canvas, sel);
        });
        canvas.on('selection:updated', (e) => {
          const sel = e.selected || [];
          updateMultiSelectHighlight(canvas, sel);
        });
        canvas.on('selection:cleared', () => {
          setSelectedObjects([]);
          setSelectedZone(null);
          updateMultiSelectHighlight(canvas, []);
        });

        setFabricCanvas(canvas);
      } finally {
        canvasInitScheduled.current = false;
      }
    };
    requestAnimationFrame(doInit);
  };

  const handleEnrichmentUpdate = (field, value) => {
    if (!selectedZone) return;
    const currentData = selectedZone.get('data') || selectedZone.data;

    let newData = { ...currentData };

    if (['Audio', 'Video', 'Popup'].includes(field)) {
      newData.enrichmentType = field;
      newData.enrichmentValue = value;
    } else {
      // Handle base fields like altText, syncId, etc.
      newData[field] = value;
    }

    selectedZone.set('data', newData);
    if (newData.enrichmentValue || newData.altText) {
      selectedZone.item(0).set('stroke', '#4caf50');
    }
    fabricCanvas.renderAll();
    setZonePropsVersion(v => v + 1); // force Zone Properties panel to re-render and show new values
  };

  // Word-level styles within a sentence zone (e.g. bold "mane"). Selection is [start, end] character indices.
  const [wordStyleSelection, setWordStyleSelection] = useState({ start: null, end: null });
  useEffect(() => {
    setWordStyleSelection({ start: null, end: null });
  }, [selectedZone]);

  const applyWordStyle = (zone, start, end, styleDelta) => {
    if (!zone || start == null || end == null || start >= end) return;
    const data = zone.get('data') || zone.data || {};
    const content = (data.content || '').trim();
    if (end > content.length) return;
    let runs = Array.isArray(data.styleRuns) && data.styleRuns.length > 0
      ? data.styleRuns.map(r => ({ ...r }))
      : [{ start: 0, end: content.length, bold: !!data.bold, italic: !!data.italic, color: data.color || '#000000' }];
    const getStyleAt = (pos) => {
      const r = runs.find(r => pos >= r.start && pos < r.end);
      return r ? { bold: r.bold, italic: r.italic, color: r.color || '#000000' } : { bold: false, italic: false, color: '#000000' };
    };
    const newRuns = [];
    for (const r of runs) {
      if (r.end <= start || r.start >= end) {
        newRuns.push(r);
        continue;
      }
      if (r.start < start) newRuns.push({ ...r, end: start });
      const midStart = Math.max(r.start, start);
      const midEnd = Math.min(r.end, end);
      const base = getStyleAt(midStart);
      newRuns.push({
        start: midStart,
        end: midEnd,
        bold: styleDelta.bold !== undefined ? !!styleDelta.bold : base.bold,
        italic: styleDelta.italic !== undefined ? !!styleDelta.italic : base.italic,
        color: styleDelta.color !== undefined ? styleDelta.color : base.color
      });
      if (r.end > end) newRuns.push({ ...r, start: end });
    }
    newRuns.sort((a, b) => a.start - b.start);
    const coalesced = [];
    for (const r of newRuns) {
      const last = coalesced[coalesced.length - 1];
      if (last && last.end === r.start && last.bold === r.bold && last.italic === r.italic && last.color === r.color) {
        last.end = r.end;
      } else {
        coalesced.push({ ...r });
      }
    }
    zone.set('data', { ...data, styleRuns: coalesced });
    fabricCanvas.renderAll();
    setZonePropsVersion(v => v + 1);
  };

  const handleSave = async () => {
    try {
      if (!fabricCanvas) return;
      setSaving(true);

      const currentZones = fabricCanvas.getObjects()
        .filter(obj => obj.type === 'group')
        .map(group => {
          const shape = group.item(0);
          const data = group.get('data') || group.data || {};
          const isPolygon = shape.type === 'polygon';
          let x, y, w, h, points;
          if (isPolygon && shape.points && shape.points.length >= 3) {
            const scaleX = group.scaleX ?? 1;
            const scaleY = group.scaleY ?? 1;
            points = shape.points.map(p => [
              Math.round(group.left + (p.x ?? p[0]) * scaleX),
              Math.round(group.top + (p.y ?? p[1]) * scaleY)
            ]);
            const xs = points.map(p => p[0]);
            const ys = points.map(p => p[1]);
            x = Math.min(...xs);
            y = Math.min(...ys);
            w = Math.max(...xs) - x;
            h = Math.max(...ys) - y;
          } else {
            x = Math.round(group.left);
            y = Math.round(group.top);
            w = Math.round((shape.width || 0) * (group.scaleX ?? 1));
            h = Math.round((shape.height || 0) * (group.scaleY ?? 1));
          }
          const contentFromLines = Array.isArray(data.lines) && data.lines.length > 0
            ? data.lines.map((l) => (l.text || '').trim()).filter(Boolean).join(' ')
            : '';
          const rawContent = (data.content != null ? String(data.content) : '').trim();
          // Always prefer explicitly set content; only fall back to lines when content is empty
          const content = rawContent || contentFromLines;
          return {
            ...data,
            id: data.id,
            type: data.type || 'text',
            content,
            x, y, w, h,
            readingOrder: data.readingOrder,
            enrichmentType: data.enrichmentType,
            enrichmentValue: data.enrichmentValue,
            altText: data.altText,
            syncId: data.syncId,
            lines: Array.isArray(data.lines) && data.lines.length > 0 ? data.lines : undefined,
            points: isPolygon && points && points.length >= 3 ? points : undefined
          };
        })
        .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));

      console.log(`Saving ${currentZones.length} sorted zones for page ${currentPage + 1}`);

      const res = await api.post(`/kitaboo/save-zones/${jobId}/${currentPage + 1}`, {
        zones: currentZones
      });
      const savedZones = res.data?.data?.zones ?? res.data?.zones ?? currentZones;

      if (fabricCanvas && savedZones.length > 0) {
        const groups = fabricCanvas.getObjects().filter(obj => obj.type === 'group');
        groups.sort((a, b) => ((a.get?.('data') || a.data)?.readingOrder ?? 0) - ((b.get?.('data') || b.data)?.readingOrder ?? 0));
        savedZones.forEach((z, i) => {
          if (groups[i]) {
            const rect = groups[i].item(0);
            const existing = groups[i].get?.('data') || groups[i].data || {};
            // Sync full saved zone back so canvas (and future exports) match DB, including updated content
            groups[i].set?.('data', {
              ...existing,
              ...z,
              x: Math.round(groups[i].left),
              y: Math.round(groups[i].top),
              w: rect ? Math.round((rect.width || 0) * (groups[i].scaleX || 1)) : (z.w || existing.w),
              h: rect ? Math.round((rect.height || 0) * (groups[i].scaleY || 1)) : (z.h || existing.h),
              readingOrder: z.readingOrder ?? existing.readingOrder
            });
          }
        });
      }

      setPages(prev => {
        const newPages = [...prev];
        newPages[currentPage] = { ...newPages[currentPage], zones: savedZones };
        return newPages;
      });

      alert('Page zones saved successfully!');
    } catch (err) {
      console.error('Failed to save zones:', err);
      alert('Error saving zones: ' + (err.response?.data?.message || err.message));
    } finally {
      setSaving(false);
    }
  };

  const publishEpub = async () => {
    try {
      setExporting(true);
      const voicePayload = ttsVoice
        ? { languageCode: ttsLanguageCode, name: ttsVoice.name, ssmlGender: ttsVoice.gender }
        : undefined;
      console.log(`[Publish] Triggering export with Sync Level: ${syncLevel}, Voice: ${ttsVoice?.name ?? 'default'}`);
      const response = await api.post(`/kitaboo/publish/${jobId}`, {
        syncLevel: syncLevel || 'word',
        voice: voicePayload,
        ...(useAbsoluteHtml ? { renderMode: 'absolute-html' } : {}),
        ...(bodyFontFamily && bodyFontFamily.trim() ? { bodyFontFamily: bodyFontFamily.trim() } : {})
      });
      const data = response.data?.data ?? response.data;
      const epubPath = data?.epubPath ?? `kitaboo_fxl_${jobId}.epub`;
      const usedSyncLevel = (data?.syncLevel || syncLevel || 'word').toUpperCase();
      const downloadUrl = data?.downloadUrl ?? `/api/kitaboo/download/${jobId}`;
      const baseUrl = api.defaults.baseURL ?? '';
      const pathOnly = downloadUrl.startsWith('/api') ? downloadUrl.slice(4) : downloadUrl.replace(/^\//, '');
      const fullDownloadUrl = downloadUrl.startsWith('http') ? downloadUrl : `${baseUrl.replace(/\/$/, '')}/${pathOnly.replace(/^\//, '')}`;
      const blobRes = await api.get(fullDownloadUrl, { responseType: 'blob' });
      if (blobRes.status < 200 || blobRes.status >= 300) throw new Error(blobRes.status === 404 ? 'EPUB file not found' : `Download failed (${blobRes.status})`);
      const blob = blobRes.data;

      const downloadName = epubPath?.endsWith('.epub') ? epubPath : `${epubPath || `kitaboo_fxl_${jobId}`}.epub`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      skipCanvasReinitUntil.current = Date.now() + 1500;
      alert(`FXL EPUB published (${usedSyncLevel} sync${useAbsoluteHtml ? ', absolute HTML text layer' : ''}). Download started: ${downloadName}`);
      navigate('/');
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
      const zonesToSplit = fabricCanvas.getObjects()
        .filter(obj => obj.type === 'group')
        .map(group => {
          const rect = group.item(0);
          const data = group.get('data') || group.data || {};
          return {
            ...data,
            x: Math.round(group.left),
            y: Math.round(group.top),
            w: Math.round((rect?.width || 0) * (group.scaleX || 1)),
            h: Math.round((rect?.height || 0) * (group.scaleY || 1)),
            content: data.content,
            id: data.id,
            type: data.type || 'text',
            readingOrder: data.readingOrder
          };
        })
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
      return fabricCanvas.getObjects()
        .filter(obj => obj.type === 'group')
        .map(group => {
          const shape = group.item(0);
          const data = group.get('data') || group.data || {};
          const isPolygon = shape?.type === 'polygon' && shape?.points?.length >= 3;
          let x, y, w, h, points;
          if (isPolygon) {
            const scaleX = group.scaleX ?? 1;
            const scaleY = group.scaleY ?? 1;
            points = shape.points.map(p => [
              Math.round(group.left + (p.x ?? p[0]) * scaleX),
              Math.round(group.top + (p.y ?? p[1]) * scaleY)
            ]);
            const xs = points.map(p => p[0]);
            const ys = points.map(p => p[1]);
            x = Math.min(...xs);
            y = Math.min(...ys);
            w = Math.max(...xs) - x;
            h = Math.max(...ys) - y;
          } else {
            x = Math.round(group.left);
            y = Math.round(group.top);
            w = Math.round((shape?.width || 0) * (group.scaleX ?? 1));
            h = Math.round((shape?.height || 0) * (group.scaleY ?? 1));
          }
          return {
            ...data,
            x,
            y,
            w,
            h,
            content: data.content,
            id: data.id,
            type: data.type || 'text',
            readingOrder: data.readingOrder,
            lines: Array.isArray(data.lines) && data.lines.length > 0 ? data.lines : undefined,
            points: isPolygon && points?.length >= 3 ? points : undefined
          };
        })
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
    const groups = [...selectedObjects]
      .filter(obj => obj.type === 'group' && (obj.get?.('data') || obj.data))
      .sort((a, b) => (a.get?.('data')?.readingOrder ?? a.data?.readingOrder ?? 999) - (b.get?.('data')?.readingOrder ?? b.data?.readingOrder ?? 999));
    if (groups.length < 2) return;

    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    const mergedLines = [];
    const firstData = groups[0].get?.('data') || groups[0].data || {};
    const existingId = firstData.id;
    let baseId = existingId ? String(existingId) : `p${pageNum}_z1`;
    baseId = String(baseId).replace(/_w\d+$/, '').replace(/_s\d+$/, '');
    const readingOrder = Math.min(...groups.map(g => g.get?.('data')?.readingOrder ?? g.data?.readingOrder ?? 999));

    groups.forEach(g => {
      const d = g.get?.('data') || g.data || {};
      const rect = g.item?.(0);
      const l = g.left ?? 0, t = g.top ?? 0;
      const sx = g.scaleX ?? 1, sy = g.scaleY ?? 1;
      let w, h;
      if (rect && rect.type === 'polygon' && rect.points && rect.points.length >= 3) {
        let pxMin = Infinity, pyMin = Infinity, pxMax = -Infinity, pyMax = -Infinity;
        rect.points.forEach(p => {
          const px = l + (p.x ?? p[0]) * sx;
          const py = t + (p.y ?? p[1]) * sy;
          pxMin = Math.min(pxMin, px); pyMin = Math.min(pyMin, py);
          pxMax = Math.max(pxMax, px); pyMax = Math.max(pyMax, py);
        });
        w = pxMax - pxMin;
        h = pyMax - pyMin;
        xMin = Math.min(xMin, pxMin);
        yMin = Math.min(yMin, pyMin);
        xMax = Math.max(xMax, pxMax);
        yMax = Math.max(yMax, pyMax);
      } else {
        w = (rect?.width ?? d.w ?? 0) * sx;
        h = (rect?.height ?? d.h ?? 0) * sy;
        xMin = Math.min(xMin, l);
        yMin = Math.min(yMin, t);
        xMax = Math.max(xMax, l + w);
        yMax = Math.max(yMax, t + h);
      }

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

    // Always create a rectangular merged zone that covers all selected zones
    const shape = new fabric.Rect({
      width: mergedW,
      height: mergedH,
      fill: 'rgba(0, 120, 255, 0.2)',
      stroke: '#0078ff',
      strokeWidth: 2,
      cornerColor: '#0078ff',
      cornerSize: 10,
      transparentCorners: false
    });
    const text = new fabric.IText(readingOrder.toString(), {
      left: 5, top: 5, fontSize: 16, fill: '#fff', backgroundColor: '#0078ff', selectable: false
    });
    const mergedGroup = new fabric.Group([shape, text], {
      left: mergedX,
      top: mergedY,
      originX: 'left',
      originY: 'top',
      data: {
        id: baseId,
        x: mergedX, y: mergedY, w: mergedW, h: mergedH,
        content: mergedContent,
        type: 'text',
        readingOrder,
        altText: firstData.altText ?? '', syncId: `${baseId}_sync`,
        lines: consolidatedLines.length > 0 ? consolidatedLines : undefined,
        ...preservedStyle
      }
    });

    try {
      groups.forEach(g => fabricCanvas.remove(g));
      fabricCanvas.add(mergedGroup);
      fabricCanvas.setActiveObject(mergedGroup);
      setSelectedZone(mergedGroup);
      setSelectedObjects([mergedGroup]);
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
    const groups = fabricCanvas.getObjects().filter(obj => obj.type === 'group');
    const zIndices = groups.map(g => {
      const id = (g.get?.('data') || g.data)?.id;
      const m = String(id || '').match(/^p(\d+)_z(\d+)/);
      return m && parseInt(m[1], 10) === pageNum ? parseInt(m[2], 10) : 0;
    });
    const nextZ = zIndices.length ? Math.max(0, ...zIndices) + 1 : 1;
    const maxOrder = groups.length === 0 ? 0 : Math.max(...groups.map(g => (g.get?.('data') || g.data)?.readingOrder ?? 0));
    const nextOrder = maxOrder + 1;
    const baseId = `p${pageNum}_z${nextZ}`;
    const pts = polygonPoints.map(p => [Math.round(p.x), Math.round(p.y)]);
    const minX = Math.min(...pts.map(p => p[0]));
    const minY = Math.min(...pts.map(p => p[1]));
    const relativePoints = pts.map(p => ({ x: p[0] - minX, y: p[1] - minY }));
    const polygon = new fabric.Polygon(relativePoints, {
      fill: 'rgba(0, 120, 255, 0.2)',
      stroke: '#0078ff',
      strokeWidth: 2,
      cornerColor: '#0078ff',
      cornerSize: 10,
      transparentCorners: false
    });
    const text = new fabric.IText(nextOrder.toString(), {
      left: 5, top: 5, fontSize: 16, fill: '#fff', backgroundColor: '#0078ff', selectable: false
    });
    const w = Math.max(1, Math.max(...pts.map(p => p[0])) - minX);
    const h = Math.max(1, Math.max(...pts.map(p => p[1])) - minY);
    const group = new fabric.Group([polygon, text], {
      left: minX,
      top: minY,
      originX: 'left',
      originY: 'top',
      data: {
        id: baseId,
        type: 'text',
        content: '',
        x: minX, y: minY, w, h,
        readingOrder: nextOrder,
        altText: '', syncId: `${baseId}_sync`,
        points: pts
      }
    });
    fabricCanvas.add(group);
    fabricCanvas.setActiveObject(group);
    setSelectedZone(group);
    setSelectedObjects([group]);
    setPolygonPoints([]);
    setPolygonDrawingMode(false);
    fabricCanvas.selection = true;
    fabricCanvas.renderAll();
    setZonePropsVersion(v => v + 1);
  };

  const addZone = () => {
    if (!fabricCanvas) return;
    const pageNum = currentPage + 1;
    const groups = fabricCanvas.getObjects().filter(obj => obj.type === 'group');
    const ids = groups.map(g => (g.get?.('data') || g.data)?.id).filter(Boolean);
    const zIndices = ids.map(id => {
      const m = String(id).match(/^p(\d+)_z(\d+)/);
      return m && parseInt(m[1], 10) === pageNum ? parseInt(m[2], 10) : 0;
    });
    const nextZ = zIndices.length ? Math.max(0, ...zIndices) + 1 : 1;
    const maxOrder = groups.length === 0 ? 0 : Math.max(...groups.map(g => (g.get?.('data') || g.data)?.readingOrder ?? 0));
    const nextOrder = maxOrder + 1;
    const baseId = `p${pageNum}_z${nextZ}`;
    const newId = syncLevel === 'word'
      ? `${baseId}_w0`
      : syncLevel === 'sentence'
        ? `${baseId}_s0`
        : baseId;
    const defaultW = 180;
    const defaultH = 32;
    const rect = new fabric.Rect({
      width: defaultW,
      height: defaultH,
      fill: 'rgba(0, 120, 255, 0.2)',
      stroke: '#0078ff',
      strokeWidth: 2,
      cornerColor: '#0078ff',
      cornerSize: 10,
      transparentCorners: false
    });
    const text = new fabric.IText(nextOrder.toString(), {
      left: 5,
      top: 5,
      fontSize: 16,
      fill: '#fff',
      backgroundColor: '#0078ff',
      selectable: false
    });
    const zoneData = {
      id: newId,
      type: 'text',
      content: '',
      readingOrder: nextOrder,
      altText: '',
      syncId: `${newId}_sync`
    };
    const group = new fabric.Group([rect, text], {
      left: 40 + (groups.length % 4) * (defaultW + 20),
      top: 40 + Math.floor(groups.length / 4) * (defaultH + 16),
      originX: 'left',
      originY: 'top',
      data: zoneData
    });
    fabricCanvas.add(group);
    fabricCanvas.setActiveObject(group);
    setSelectedZone(group);
    setSelectedObjects([group]);
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
    toRemove.forEach(obj => fabricCanvas.remove(obj));
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
      <div className={`kitaboo-studio${isOrgAdmin ? ' kitaboo-studio--with-sidebar' : ''}`}>
        {isOrgAdmin && (
          <OrgAdminSidebar onCollapse={setSidebarCollapsed} />
        )}
        <div className={`kitaboo-studio-body${isOrgAdmin ? (sidebarCollapsed ? ' kitaboo-studio-body--sb-collapsed' : ' kitaboo-studio-body--with-sidebar') : ''}`}>
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
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`kitaboo-studio${isOrgAdmin ? ' kitaboo-studio--with-sidebar' : ''}`}>
        {isOrgAdmin && (
          <OrgAdminSidebar onCollapse={setSidebarCollapsed} />
        )}
        <div className={`kitaboo-studio-body${isOrgAdmin ? (sidebarCollapsed ? ' kitaboo-studio-body--sb-collapsed' : ' kitaboo-studio-body--with-sidebar') : ''}`}>
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

  return (
    <div className={`kitaboo-studio${isOrgAdmin ? ' kitaboo-studio--with-sidebar' : ''}`}>
      {/* ── Org Admin Sidebar ── */}
      {isOrgAdmin && (
        <OrgAdminSidebar onCollapse={setSidebarCollapsed} />
      )}

      <div className={`kitaboo-studio-body${isOrgAdmin ? (sidebarCollapsed ? ' kitaboo-studio-body--sb-collapsed' : ' kitaboo-studio-body--with-sidebar') : ''}`}>

        {/* ── Top Header ── */}
        <header className="ife-selector-header-bar">
          <div className="kz-topbar-left">
            <button
              type="button"
              className="ife-selector-back-btn"
              onClick={() => navigate('/conversions')}
              title="Back to Conversions"
            >
              <ArrowLeft size={16} />
              <span>Back</span>
            </button>
            <div className="ife-selector-header-title">
              <BookOpen size={18} />
              <span>FXL Zoning Studio</span>
              {jobId && <span className="ife-selector-job-badge">Job #{jobId}</span>}
            </div>
          </div>
          <div className="kz-topbar-right">
            <button className="kz-btn kz-btn--ghost" onClick={() => navigate(`/fxl-sync-studio/${jobId}`)} title="Audio sync studio">
              Sync Studio
            </button>
            <button className="kz-btn kz-btn--primary" onClick={publishEpub} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export FXL EPUB 3'}
            </button>
            <button className="kz-btn kz-btn--save" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Page'}
            </button>
          </div>
        </header>

        {/* ── Studio: canvas + right panel ── */}
        <div className="kitaboo-workspace">

          {/* ── CENTER: canvas area ── */}
          <main className="kitaboo-canvas-area">

            {/* ── Toolbar ── */}
            <div className="kz-toolbar">
              {/* Page navigation */}
              <div className="kz-toolbar-pager">
                <button className="kz-pager-btn" onClick={() => handlePageChange('prev')} disabled={currentPage === 0}>‹</button>
                <span className="kz-pager-label">Page {currentPage + 1} <span className="kz-pager-sep">/ {pages.length}</span></span>
                <button className="kz-pager-btn" onClick={() => handlePageChange('next')} disabled={currentPage === pages.length - 1}>›</button>
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
              <div className="kz-toolbar-divider" />

              {/* Settings */}
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
                        if (jobId) { try { localStorage.setItem(`kitaboo_ttsVoice_${jobId}`, JSON.stringify({ name: v.name, gender: v.gender })); } catch (err) { /* ignore */ } }
                      } else {
                        setTtsVoice(null);
                        if (jobId) { try { localStorage.removeItem(`kitaboo_ttsVoice_${jobId}`); } catch (err) { /* ignore */ } }
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

              {/* Upload clean page — right-aligned */}
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
            </div>

            {/* ── Canvas ── */}
            <div className="kitaboo-canvas-container" ref={canvasContainerRef}>
              <canvas id="kitaboo-canvas" />
            </div>
          </main>

          {/* ── RIGHT: zone properties panel ── */}
          <aside className="kitaboo-sidebar">
          <h3>Zone Properties</h3>
          {selectedZone ? (
            <div className="tagging-panel">
              {selectedObjects.length > 1 && (
                <p style={{ fontSize: '12px', color: '#1976d2', marginBottom: 12, fontWeight: 500 }}>
                  {selectedObjects.length} zones selected. Use <strong>Merge</strong> to combine, or click one zone to edit.
                </p>
              )}
              {syncLevel === 'word' && selectedObjects.length === 1 && (
                <div className="word-level-tip" style={{ fontSize: '12px', color: '#81d4fa', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '6px', marginBottom: '12px' }}>
                  <strong>Word-level:</strong> Zones match the level chosen at Convert. Edit <em>Text Content (OCR)</em> below if needed.
                </div>
              )}
              {syncLevel === 'sentence' && selectedObjects.length === 1 && (
                <div className="sentence-level-tip" style={{ fontSize: '12px', color: '#81d4fa', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '6px', marginBottom: '12px' }}>
                  <strong>Sentence-level:</strong> Zones match the level chosen at Convert. Edit <em>Text Content (OCR)</em> below if needed. Click a box on the canvas to select it.
                </div>
              )}
              <div className="prop-group" style={{ display: 'none', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={deleteSelectedZones}
                  style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #dc3545', background: '#dc3545', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: '13px' }}
                  title="Delete selected zone(s)"
                >
                  Delete zone
                </button>
              </div>
              <div className="prop-group">
                <label>Zone ID</label>
                <input type="text" value={selectedZone.get('data')?.id || ''} readOnly />
              </div>

              <div className="prop-group">
                <label>Reading Order</label>
                <input
                  type="number"
                  value={selectedZone.get('data')?.readingOrder || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const newData = { ...selectedZone.get('data'), readingOrder: val };
                    selectedZone.set('data', newData);
                    const label = selectedZone.item(1);
                    if (label) label.set('text', val.toString());
                    fabricCanvas.renderAll();
                    setZonePropsVersion(v => v + 1);
                  }}
                />
              </div>

              <div className="prop-group">
                <label>Type</label>
                <select
                  value={selectedZone.get('data')?.type || 'text'}
                  onChange={(e) => {
                    const newData = { ...selectedZone.get('data'), type: e.target.value };
                    selectedZone.set('data', newData);
                    fabricCanvas.renderAll();
                    setZonePropsVersion(v => v + 1);
                  }}
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
                  value={selectedZone.get('data')?.altText || ''}
                  onChange={(e) => handleEnrichmentUpdate('altText', e.target.value)}
                />
              </div>

              <div className="prop-group">
                <label>Sync-ID (Read-Aloud)</label>
                <input
                  type="text"
                  placeholder="e.g., p1_w20"
                  value={selectedZone.get('data')?.syncId || ''}
                  onChange={(e) => handleEnrichmentUpdate('syncId', e.target.value)}
                />
              </div>

              <div className="prop-group">
                <label>Text Content (OCR)</label>
                <textarea
                  placeholder="Actual text in this zone..."
                  value={(() => {
                    const data = selectedZone.get('data') || {};
                    const content = (data.content || '').trim();
                    if (content) return content;
                    // RCA: If content missing/truncated, derive from zone lines so Studio shows full OCR text
                    const lines = Array.isArray(data.lines) && data.lines.length > 0 ? data.lines : [];
                    return lines.map((l) => (l.text || '').trim()).filter(Boolean).join(' ') || '';
                  })()}
                  onChange={(e) => handleEnrichmentUpdate('content', e.target.value)}
                />
              </div>

              <div className="prop-group" style={{ marginTop: '12px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>Word-level styles (sentence sync)</h4>
                <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#666' }}>Click a word below to select it, then apply Bold / Italic / Color. Exported EPUB will keep these styles within the sentence.</p>
                {(() => {
                  const content = (selectedZone.get('data')?.content || '').trim();
                  const tokens = [];
                  const re = /\s+|\S+/g;
                  let m;
                  while ((m = re.exec(content)) !== null) {
                    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
                  }
                  const sel = wordStyleSelection;
                  const hasSelection = sel.start != null && sel.end != null && sel.start < sel.end;
                  return (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', marginBottom: '8px', lineHeight: 1.6 }}>
                        {tokens.map((t, i) => {
                          const selected = hasSelection && t.start >= sel.start && t.end <= sel.end;
                          return (
                            <span
                              key={i}
                              role="button"
                              tabIndex={0}
                              onClick={() => setWordStyleSelection({ start: t.start, end: t.end })}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWordStyleSelection({ start: t.start, end: t.end }); } }}
                              style={{
                                padding: '2px 4px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                background: selected ? 'rgba(33, 150, 243, 0.3)' : 'transparent'
                              }}
                            >
                              {t.text}
                            </span>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: '#666' }}>
                          {hasSelection ? `Selection: ${sel.start}–${sel.end}` : 'Select a word above'}
                        </span>
                        <button
                          type="button"
                          disabled={!hasSelection}
                          onClick={() => hasSelection && applyWordStyle(selectedZone, sel.start, sel.end, { bold: true })}
                          style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 'bold', cursor: hasSelection ? 'pointer' : 'not-allowed', opacity: hasSelection ? 1 : 0.6 }}
                          title="Make selection bold"
                        >
                          Bold
                        </button>
                        <button
                          type="button"
                          disabled={!hasSelection}
                          onClick={() => hasSelection && applyWordStyle(selectedZone, sel.start, sel.end, { italic: true })}
                          style={{ padding: '4px 10px', fontSize: '12px', fontStyle: 'italic', cursor: hasSelection ? 'pointer' : 'not-allowed', opacity: hasSelection ? 1 : 0.6 }}
                          title="Make selection italic"
                        >
                          Italic
                        </button>
                        <input
                          type="color"
                          disabled={!hasSelection}
                          title="Set selection color"
                          style={{ width: '28px', height: '28px', padding: 0, cursor: hasSelection ? 'pointer' : 'not-allowed', opacity: hasSelection ? 1 : 0.6 }}
                          onChange={(e) => hasSelection && applyWordStyle(selectedZone, sel.start, sel.end, { color: e.target.value })}
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
        </aside>
        </div>
      </div>
    </div>
  );
};

export default KitabooZoningStudio;

