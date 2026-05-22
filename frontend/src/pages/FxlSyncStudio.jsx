/**
 * FXL Sync Studio — same UX as reflowable Sync Studio, for FXL + human narration.
 * Loads pages/zones, single-book audio, and alignment; waveform + regions; edit timings; Run alignment; Save.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import {
  AlertCircle,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  Minus,
  MousePointerClick,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import api, { API_BASE_URL } from '../services/api';
import { withAuthImageQuery } from '../utils/authImageUrl';
import { buildEpubReaderPath } from '../utils/epubReaderUrl';
import { getPageNumFromZoneId, buildZoneIdToPageMap } from '../utils/kitabooZonePageId';
import { useWorkflowNavigation } from '../hooks/useWorkflowNavigation';
import './FxlSyncStudio.css';

const fxlIc = { strokeWidth: 2, 'aria-hidden': true };

const FXL_ZONE_COLORS = [
  { bar: '#3b82f6', chip: '#2563eb', region: 'rgba(59, 130, 246, 0.45)' },
  { bar: '#8b5cf6', chip: '#7c3aed', region: 'rgba(139, 92, 246, 0.45)' },
  { bar: '#ec4899', chip: '#db2777', region: 'rgba(236, 72, 153, 0.45)' },
  { bar: '#f59e0b', chip: '#d97706', region: 'rgba(245, 158, 11, 0.45)' },
  { bar: '#14b8a6', chip: '#0d9488', region: 'rgba(20, 184, 166, 0.45)' },
  { bar: '#22c55e', chip: '#16a34a', region: 'rgba(34, 197, 94, 0.45)' },
];

function zonePaletteIndex(zoneId, zones) {
  const i = zones.findIndex((z) => z.id === zoneId);
  return i >= 0 ? i % FXL_ZONE_COLORS.length : 0;
}

const backendOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
const apiBaseEndsWithApi = /\/api\/?$/.test(API_BASE_URL);

// Backend responses sometimes return URLs with a leading `/api/...`.
// In local dev, backend routes are mounted without `/api`, so we strip it.
// In production, `/api` may exist behind a reverse proxy, so we keep it.
const resolveBackendUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/api/')) {
    return apiBaseEndsWithApi ? `${backendOrigin}${url}` : `${backendOrigin}${url.slice(4)}`;
  }
  if (url.startsWith('/')) return `${backendOrigin}${url}`;
  return `${backendOrigin}/${url}`;
};

export default function FxlSyncStudio() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { goToDownload } = useWorkflowNavigation();
  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const regionsPluginRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pages, setPages] = useState([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [perPageAudioUrls, setPerPageAudioUrls] = useState({}); // { pageNumber: relativeUrl }
  const [segments, setSegments] = useState([]);
  const [isReady, setIsReady] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [zoom, setZoom] = useState(50);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showManualConfig, setShowManualConfig] = useState(false);
  const [manualConfig, setManualConfig] = useState({ skipPages: [] });
  const [perPageFiles, setPerPageFiles] = useState({}); // { pageNumber: File }
  const [pagesWithPerPageAudio, setPagesWithPerPageAudio] = useState([]); // page numbers that already have page_N.mp3
  const [uploadingPerPage, setUploadingPerPage] = useState(false);
  /** Bumped after per-page upload/align so WaveSurfer reloads the same URL (browser cache bust). */
  const [audioStreamNonce, setAudioStreamNonce] = useState(0);
  const [zoneNotes, setZoneNotes] = useState({});
  const tapSyncStartRef = useRef(null);
  const segmentsRef = useRef(segments);
  const selectedZoneIdRef = useRef(selectedZoneId);
  const pageTimeOffsetRef = useRef(0);
  const skipRegionsRefreshRef = useRef(false);
  const displayOffsetByPageRef = useRef({});
  // Keep ref in sync with state, but don't overwrite with empty once we have loaded data
  if (segments.length > 0 || segmentsRef.current.length === 0) segmentsRef.current = segments;
  selectedZoneIdRef.current = selectedZoneId;

  const currentPage = pages[currentPageIndex] || null;
  const currentPageZones = currentPage?.zones || [];
  const perPageUrlForCurrentPage = currentPage && perPageAudioUrls[currentPage.pageNumber];
  const resolvedMediaBase = perPageUrlForCurrentPage ? resolveBackendUrl(perPageUrlForCurrentPage) : audioUrl;
  const cacheBustedMediaBase = resolvedMediaBase
    ? `${resolvedMediaBase}${resolvedMediaBase.includes('?') ? '&' : '?'}_cv=${audioStreamNonce}`
    : null;
  // WaveSurfer / fetch cannot send Authorization; backend accepts ?token= on GET (see authenticate middleware).
  const effectiveAudioUrl = cacheBustedMediaBase ? withAuthImageQuery(cacheBustedMediaBase) : null;
  const usePerPageAudioForWaveform = Boolean(perPageUrlForCurrentPage);
  const alignmentMap = useMemo(() => {
    const m = {};
    segments.forEach(s => { m[s.id] = s; });
    return m;
  }, [segments]);

  const zoneIdToPageMap = useMemo(() => buildZoneIdToPageMap(pages), [pages]);

  const displaySegments = currentPage
    ? segments.filter(s => getPageNumFromZoneId(s.id, zoneIdToPageMap) === currentPage.pageNumber)
    : segments;

  const currentPageTimeOffset = useMemo(() => {
    if (!usePerPageAudioForWaveform || !displaySegments.length) return 0;
    return Math.min(...displaySegments.map(s => Number(s.startTime) || 0));
  }, [usePerPageAudioForWaveform, displaySegments]);
  pageTimeOffsetRef.current = currentPageTimeOffset;

  useEffect(() => {
    const pageNum = currentPage?.pageNumber;
    if (pageNum == null || !usePerPageAudioForWaveform) return;
    const pageSegs = segmentsRef.current.filter(s => getPageNumFromZoneId(s.id, zoneIdToPageMap) === pageNum);
    const offset = pageSegs.length ? Math.min(...pageSegs.map(s => Number(s.startTime) || 0)) : 0;
    displayOffsetByPageRef.current[pageNum] = offset;
  }, [currentPage?.pageNumber, usePerPageAudioForWaveform, zoneIdToPageMap]);

  // Saving is done only via the "Save alignment" button (no auto-save / no "Saved" message).

  const loadSyncStudioData = useCallback(async (opts = {}) => {
    const showLoading = opts.showLoading !== false;
    const preservePageIndex = opts.preservePageIndex === true;
    const bumpAudioCache = opts.bumpAudioCache === true;
    if (showLoading) setLoading(true);
    setError('');
    const numericJobId = parseInt(String(jobId), 10);
    if (jobId == null || jobId === '' || Number.isNaN(numericJobId)) {
      setError('Invalid job ID in the URL.');
      if (showLoading) setLoading(false);
      return;
    }
    try {
      const res = await api.get(`/kitaboo/sync-studio/${jobId}`, {
        params: { _t: Date.now() },
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
      });
      const data = res.data?.data ?? res.data;
      const nextPages = data.pages || [];
      setPages(nextPages);
      if (nextPages.length) {
        if (preservePageIndex) {
          setCurrentPageIndex(i => Math.min(Math.max(0, i), nextPages.length - 1));
        } else {
          setCurrentPageIndex(0);
        }
      }
      if (data.audioUrl) {
        setAudioUrl(resolveBackendUrl(data.audioUrl));
      } else {
        setAudioUrl(null);
      }
      setAudioDuration(Number(data.audioDuration) || 0);
      const pp = data.perPageAudioUrls || {};
      setPerPageAudioUrls(pp);
      const pageNumsFromUrls = Object.keys(pp)
        .map(n => parseInt(n, 10))
        .filter(n => !Number.isNaN(n) && n > 0)
        .sort((a, b) => a - b);
      setPagesWithPerPageAudio(pageNumsFromUrls);
      const alignment = data.alignment || [];
      segmentsRef.current = alignment;
      setSegments(alignment);
      if (bumpAudioCache) setAudioStreamNonce(n => n + 1);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load Sync Studio data');
      setPages([]);
      setSegments([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { loadSyncStudioData(); }, [loadSyncStudioData]);

  useEffect(() => {
    if (!effectiveAudioUrl || !waveformRef.current) return;
    setIsReady(false);
    const regionsPlugin = RegionsPlugin.create();
    regionsPluginRef.current = regionsPlugin;
    const timelinePlugin = TimelinePlugin.create({ height: 24, insertPosition: 'beforebegin' });
    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#4a7b54',
      progressColor: '#ffd43b',
      cursorColor: '#ffd43b',
      height: 120,
      minPxPerSec: zoom,
      fillParent: true,
      plugins: [regionsPlugin, timelinePlugin],
      url: effectiveAudioUrl
    });
    wavesurferRef.current = ws;
    ws.on('ready', () => {
      setIsReady(true);
      setCurrentTime(ws.getCurrentTime() ?? 0);
    });
    ws.on('error', e => setError(e.message || 'Audio load failed'));
    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => {
      setIsPlaying(false);
      setCurrentTime(ws.getCurrentTime() ?? 0);
    });
    ws.on('finish', () => {
      setIsPlaying(false);
      setCurrentTime(ws.getCurrentTime() ?? 0);
    });
    ws.on('timeupdate', (t) => setCurrentTime(t));
    try {
      ws.on('interaction', (newTime) => setCurrentTime(newTime));
    } catch (_) { /* v6 or different API */ }
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
      regionsPluginRef.current = null;
    };
  }, [effectiveAudioUrl]);

  useEffect(() => {
    if (!isReady || !wavesurferRef.current) return;
    const syncTime = () => {
      if (wavesurferRef.current) setCurrentTime(wavesurferRef.current.getCurrentTime() ?? 0);
    };
    const id = setInterval(syncTime, 150);
    return () => clearInterval(id);
  }, [isReady]);

  useEffect(() => {
    if (!wavesurferRef.current || !waveformRef.current || !isReady) return;
    const ws = wavesurferRef.current;
    if (typeof ws.zoom !== 'function') return;
    const applyZoom = () => {
      try {
        const duration = ws.getDuration();
        const containerWidth = waveformRef.current?.clientWidth ?? 800;
        if (!duration || duration <= 0) {
          ws.zoom(zoom);
          return;
        }
        // Base: 1x = fill container. Zoom 50 = fill; zoom 100 = 2x width (scrollable); zoom 10 = still fill (no narrower than container).
        const basePxPerSec = containerWidth / duration;
        const minPxPerSec = Math.max(basePxPerSec, basePxPerSec * (zoom / 50));
        ws.zoom(minPxPerSec);
      } catch (err) {
        console.warn('[FxlSyncStudio] Zoom failed:', err?.message || err);
      }
    };
    const id = requestAnimationFrame(applyZoom);
    return () => cancelAnimationFrame(id);
  }, [zoom, isReady]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    const regionsPlugin = regionsPluginRef.current;
    if (!ws || !regionsPlugin || !isReady) return;

    const onRegionUpdated = (region) => {
      skipRegionsRefreshRef.current = true;
      const regionId = region.id;
      // Defer so we read the region's final position after the plugin has updated (sidebar then matches waveform)
      requestAnimationFrame(() => {
        const plugin = regionsPluginRef.current;
        const reg = plugin?.getRegions?.().find(r => r.id === regionId) || region;
        const start = Number(reg.start);
        const end = Number(reg.end);
        if (Number.isNaN(start) || Number.isNaN(end)) return;
        const prev = segmentsRef.current || [];
        // Waveform time = stored time (per-page: 0→duration; single: global). Store as-is.
        let startTime = start;
        let endTime = end;
        if (startTime > endTime) [startTime, endTime] = [endTime, startTime];
        const finalStart = startTime;
        const finalEnd = Math.max(endTime, startTime + 0.05);
        const existing = prev.find(s => s.id === regionId);
        const next = existing
          ? prev.map(s => s.id === regionId ? { ...s, startTime: finalStart, endTime: finalEnd } : s)
          : [...prev, { id: regionId, startTime: finalStart, endTime: finalEnd }];
        segmentsRef.current = next;
        setSegments(next);
      });
    };
    regionsPlugin.on('region-updated', onRegionUpdated);

    if (skipRegionsRefreshRef.current) {
      skipRegionsRefreshRef.current = false;
      return () => { regionsPlugin.un('region-updated', onRegionUpdated); };
    }

    regionsPlugin.clearRegions();
    const currentPageNum = currentPage?.pageNumber;
    const isPerPageWaveform = usePerPageAudioForWaveform && currentPageNum != null;
    // Defer draw to next tick and use ref so we always draw what was loaded (avoids stale closure when isReady flips before state has alignment)
    const drawId = setTimeout(() => {
      const latest = segmentsRef.current || [];
      if (!latest.length) return;
      const pageSegments = isPerPageWaveform
        ? latest.filter(s => getPageNumFromZoneId(s.id, zoneIdToPageMap) === currentPageNum)
        : latest;
      // Per-page: backend stores 0→duration for this page; draw as-is. Single audio: subtract page start so first segment at 0.
      const pageOffset = !isPerPageWaveform && pageSegments.length
        ? Math.min(...pageSegments.map(s => Number(s.startTime) || 0))
        : 0;
      const plugin = regionsPluginRef.current;
      if (!plugin) return;
      pageSegments.forEach(seg => {
        let start = Number(seg.startTime) || 0;
        let end = Number(seg.endTime) || start + 0.2;
        if (!isPerPageWaveform) {
          start = Math.max(0, start - pageOffset);
          end = Math.max(start + 0.05, end - pageOffset);
        }
        if (end <= start) return;
        const ci = zonePaletteIndex(seg.id, currentPageZones);
        plugin.addRegion({
          id: seg.id,
          start,
          end,
          color: FXL_ZONE_COLORS[ci].region,
          drag: true,
          resize: true
        });
      });
    }, 0);

    return () => {
      clearTimeout(drawId);
      regionsPlugin.un('region-updated', onRegionUpdated);
    };
  // Intentionally omit segments: redraw only when waveform/page/audio mode changes, not on every segment change (e.g. region edit).
  // This prevents the effect from clearing and redrawing over the user's drag/resize. We always read latest from segmentsRef in the timeout.
  }, [isReady, currentPage?.pageNumber, usePerPageAudioForWaveform, zoneIdToPageMap]);

  const handleRunAlignment = async (useManual = false, config = null, opts = {}) => {
    const { closeModal = true } = opts;
    setAligning(true);
    setError('');
    try {
      const body = {};
      if (useManual && config) {
        body.skipPages = config.skipPages || [];
        if (config.usePerPageAudio) {
          body.usePerPageAudio = true;
        }
      }
      const res = await api.post(`/kitaboo/sync-studio/${jobId}/align`, body, { timeout: 600000 });
      const data = res.data?.data ?? res.data;
      const newSegments = data.segments || [];
      setSegments(newSegments);
      segmentsRef.current = newSegments;
      if (config?.usePerPageAudio) {
        await loadSyncStudioData({
          showLoading: false,
          preservePageIndex: true,
          bumpAudioCache: true,
        });
      }
      setSuccess('Alignment complete. Waveform and segments updated.');
      if (closeModal) setShowManualConfig(false);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Alignment failed');
      setSuccess('');
    } finally {
      setAligning(false);
    }
  };

  const handlePerPageUploadAndAlign = () => {
    const filesToUpload = Object.entries(perPageFiles).filter(([, file]) => file instanceof File);
    const skipPages = [...(manualConfig.skipPages || [])];
    const hasExistingPerPageAudio = pagesWithPerPageAudio.length > 0;

    if (!hasExistingPerPageAudio && filesToUpload.length === 0) {
      setError('Choose at least one MP3 file for a page.');
      return;
    }

    setShowManualConfig(false);
    setPerPageFiles({});
    setError('');
    setSuccess(
      filesToUpload.length > 0
        ? 'Uploading audio and running alignment… You can keep working; this page will update when finished.'
        : 'Running alignment… You can keep working; this page will update when finished.'
    );
    setUploadingPerPage(true);
    setAligning(true);

    void (async () => {
      try {
        for (const [pageNum, file] of filesToUpload) {
          const form = new FormData();
          form.append('audio', file);
          await api.post(`/kitaboo/human-audio/${jobId}/${pageNum}`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
          });
        }
        await handleRunAlignment(
          true,
          { skipPages, usePerPageAudio: true },
          { closeModal: false }
        );
      } catch (e) {
        setError(e.response?.data?.message || e.message || 'Upload or alignment failed');
        setSuccess('');
      } finally {
        setUploadingPerPage(false);
      }
    })();
  };

  const openManualConfig = async () => {
    setManualConfig({ skipPages: [] });
    setPerPageFiles({});
    setShowManualConfig(true);
    try {
      const res = await api.get(`/kitaboo/human-audio/${jobId}`);
      const data = res.data?.data ?? res.data;
      setPagesWithPerPageAudio(data.pages || []);
    } catch (_) {
      setPagesWithPerPageAudio([]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const toSave = segmentsRef.current || segments;
      const normalized = (Array.isArray(toSave) ? toSave : []).map(s => ({
        id: s.id,
        startTime: Number(s.startTime) || 0,
        endTime: Number(s.endTime) || 0
      }));
      await api.put(`/kitaboo/sync-studio/${jobId}`, { segments: normalized });
      setSaveSuccess(true);
      setSuccess('Alignment saved. Re-export FXL EPUB in Zoning Studio to apply.');
      return true;
    } catch (e) {
      setError(e.response?.data?.error || e.response?.data?.message || e.message || 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndGoToDownload = async () => {
    const ok = await handleSave();
    if (ok) goToDownload({ id: jobId, jobType: 'FXL' });
  };

  const handleClearAll = async () => {
    if (!window.confirm('Clear all alignment data? You can run alignment again anytime.')) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.put(`/kitaboo/sync-studio/${jobId}`, { segments: [] });
      setSegments([]);
      setSuccess('All alignment data cleared.');
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Clear failed');
    } finally {
      setSaving(false);
    }
  };

  const getCurrentTime = () => wavesurferRef.current?.getCurrentTime() ?? 0;

  const waveformDuration = wavesurferRef.current?.getDuration?.() || audioDuration || 0;

  const refreshWaveformRegion = useCallback((zoneId, startTime, endTime) => {
    const plugin = regionsPluginRef.current;
    if (!plugin || !isReady) return;
    const isPerPage = usePerPageAudioForWaveform && currentPage?.pageNumber != null;
    let start = Number(startTime) || 0;
    let end = Number(endTime) || start + 0.2;
    if (!isPerPage && displaySegments.length) {
      const pageOffset = Math.min(...displaySegments.map((s) => Number(s.startTime) || 0));
      start = Math.max(0, start - pageOffset);
      end = Math.max(start + 0.05, end - pageOffset);
    }
    skipRegionsRefreshRef.current = true;
    const existing = plugin.getRegions?.().find((r) => r.id === zoneId);
    if (existing?.remove) existing.remove();
    const ci = zonePaletteIndex(zoneId, currentPageZones);
    plugin.addRegion({
      id: zoneId,
      start,
      end,
      color: FXL_ZONE_COLORS[ci].region,
      drag: true,
      resize: true,
    });
  }, [isReady, usePerPageAudioForWaveform, currentPage?.pageNumber, displaySegments, currentPageZones]);

  const applySegmentTimes = useCallback((zoneId, startTime, endTime) => {
    const MIN_DUR = 0.2;
    let st = Number(startTime) || 0;
    let en = Number(endTime) ?? st + MIN_DUR;
    if (en <= st) en = st + MIN_DUR;
    const prev = segmentsRef.current;
    const existing = prev.find((s) => s.id === zoneId);
    const next = existing
      ? prev.map((s) => (s.id === zoneId ? { ...s, startTime: st, endTime: en } : s))
      : [...prev, { id: zoneId, startTime: st, endTime: en }];
    segmentsRef.current = next;
    setSegments(next);
    refreshWaveformRegion(zoneId, st, en);
  }, [refreshWaveformRegion]);

  const nudgeSegmentTime = (zoneId, field, delta) => {
    const seg = segmentsRef.current.find((s) => s.id === zoneId);
    if (!seg) return;
    const st = Number(seg.startTime) || 0;
    const en = Number(seg.endTime) || st + 0.2;
    if (field === 'start') applySegmentTimes(zoneId, Math.max(0, st + delta), en);
    else applySegmentTimes(zoneId, st, Math.max(st + 0.2, en + delta));
  };

  const setStartAtPlayhead = () => {
    if (!selectedZoneId || !effectiveAudioUrl) return;
    const t = getCurrentTime();
    const existing = segmentsRef.current.find((s) => s.id === selectedZoneId);
    const MIN_DUR = 0.2;
    const end = existing
      ? Math.max(Number(existing.endTime) || t + MIN_DUR, t + MIN_DUR)
      : t + 2;
    applySegmentTimes(selectedZoneId, t, end);
    setSuccess(`Start set to ${t.toFixed(2)}s for ${selectedZoneId}`);
    tapSyncStartRef.current = null;
  };

  const setEndAtPlayhead = () => {
    if (!selectedZoneId || !effectiveAudioUrl) return;
    const t = getCurrentTime();
    const existing = segmentsRef.current.find((s) => s.id === selectedZoneId);
    const MIN_DUR = 0.2;
    const start = existing
      ? Math.min(Number(existing.startTime) ?? 0, Math.max(0, t - MIN_DUR))
      : Math.max(0, t - 2);
    applySegmentTimes(selectedZoneId, start, t);
    setSuccess(`End set to ${t.toFixed(2)}s for ${selectedZoneId}`);
    tapSyncStartRef.current = null;
  };

  const selectedZone = currentPageZones.find((z) => z.id === selectedZoneId) || null;
  const selectedSegment = selectedZoneId ? alignmentMap[selectedZoneId] : null;
  const selectedDisplayOffset = usePerPageAudioForWaveform ? 0 : currentPageTimeOffset;
  const selectedStartDisp = selectedSegment
    ? (Number(selectedSegment.startTime) || 0) - selectedDisplayOffset
    : 0;
  const selectedEndDisp = selectedSegment
    ? (Number(selectedSegment.endTime) || 0) - selectedDisplayOffset
    : 0;
  const selectedDuration = Math.max(0, selectedEndDisp - selectedStartDisp);
  const overviewDuration = waveformDuration || audioDuration || 1;
  const overviewPlayheadPct = Math.min(100, Math.max(0, (currentTime / overviewDuration) * 100));
  const overviewViewPct = Math.min(100, Math.max(12, (50 / Math.max(zoom, 10)) * 100));

  const handleManualTap = useCallback(() => {
    const zoneId = selectedZoneIdRef.current;
    const segs = segmentsRef.current;
    if (!zoneId || !effectiveAudioUrl) return;
    let t = wavesurferRef.current?.getCurrentTime() ?? 0;
    if (tapSyncStartRef.current === null) {
      tapSyncStartRef.current = t;
      setSuccess(`Start marked at ${t.toFixed(2)}s. Press Space again to set end.`);
      return;
    }
    const startTime = tapSyncStartRef.current;
    const endTime = t;
    tapSyncStartRef.current = null;
    if (endTime <= startTime) {
      setError('End must be after start. Try again.');
      return;
    }
    if (endTime - startTime < 0.2) {
      setError('Duration too short (min 0.2s). Try again.');
      return;
    }
    const existing = segs.find(s => s.id === zoneId);
    const next = existing
      ? segs.map(s => (s.id === zoneId ? { ...s, startTime, endTime } : s))
      : [...segs, { id: zoneId, startTime, endTime }];
    segmentsRef.current = next;
    setSegments(next);
    setSuccess(`Manual sync: ${zoneId} ${startTime.toFixed(2)}s – ${endTime.toFixed(2)}s`);
  }, [effectiveAudioUrl, usePerPageAudioForWaveform]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const target = e.target;
      if (target?.closest?.('input') || target?.closest?.('textarea')) return;
      e.preventDefault();
      handleManualTap();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleManualTap]);

  const playSegment = (segOrId) => {
    const ws = wavesurferRef.current;
    const regionsPlugin = regionsPluginRef.current;
    if (!ws) return;
    const segmentId = typeof segOrId === 'string' ? segOrId : segOrId?.id;
    if (!segmentId) return;

    const currentSegments = segmentsRef.current;
    let start;
    let end;
    // Prefer the region's current position (reflects drag/resize) so playback matches what you see
    const region = regionsPlugin?.getRegions?.().find(r => r.id === segmentId);
    if (region != null && typeof region.start === 'number' && typeof region.end === 'number') {
      start = region.start;
      end = region.end;
      // region times are already page-relative when using per-page waveform; no conversion needed
    } else {
      const seg = typeof segOrId === 'object' && segOrId?.startTime != null ? segOrId : currentSegments.find(s => s.id === segmentId);
      if (!seg || (seg.startTime == null && seg.endTime == null)) return;
      start = Number(seg.startTime) ?? 0;
      end = Number(seg.endTime) ?? start + 0.2;
      if (start > end) [start, end] = [end, start];
      // Per-page: segment times are already 0→duration; use as-is for playback
    }

    if (end <= start) end = start + 0.2;
    const durationMs = Math.max(50, (end - start) * 1000);
    ws.setTime(start);
    ws.play();
    ws.once('pause', () => {});
    setTimeout(() => {
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(end);
        wavesurferRef.current.pause();
      }
    }, durationMs + 50);
  };

  if (loading && pages.length === 0) {
    return (
      <div className="fxl-sync-studio-loading">
        <Loader2 size={48} strokeWidth={2} className="fxl-lucide-spin" aria-hidden />
        <p>Loading FXL Sync Studio...</p>
      </div>
    );
  }

  return (
    <div className="fxl-sync-studio">
      <header className="studio-header">
        <div className="header-left">
          <button
            type="button"
            className="btn-back"
            onClick={() => navigate('/conversions/audio-sync')}
            title="Back to Audio Sync Studio (job list)"
          >
            <ChevronLeft size={18} {...fxlIc} />
            Back
          </button>
          <h1>FXL Sync Studio</h1>
          <span className="job-badge">Job #{jobId}</span>
          <button
            type="button"
            className="btn-download-epub"
            onClick={handleSaveAndGoToDownload}
            disabled={saving || !segments.length}
            title="Save alignment, then open Download EPUB for this job"
          >
            {saving ? (
              <><Loader2 size={18} strokeWidth={2.25} className="fxl-lucide-spin" aria-hidden /> Saving…</>
            ) : (
              <><Download size={18} {...fxlIc} /> Save & Next</>
            )}
          </button>
        </div>
      </header>
      <div className="studio-content-header">
        {/* {!effectiveAudioUrl && (
          <span className="no-audio-hint">Upload narration.mp3 in Zoning Studio (one file for all pages) or use Configure page boundaries → MP3 per page.</span>
        )} */}

        <button
          type="button"
          onClick={() => handleRunAlignment(false)}
          disabled={!audioUrl || aligning}
          className="btn-align"
          title="Run automatic alignment (requires single narration file)"
          style={{ display: 'none' }}
        >
          {aligning ? <Loader2 size={18} strokeWidth={2.25} className="fxl-lucide-spin" aria-hidden /> : <Calculator size={18} {...fxlIc} />}
          {aligning ? 'Aligning...' : 'Run alignment (auto)'}
        </button>
        <button
          type="button"
          onClick={openManualConfig}
          disabled={!pages.length || aligning || uploadingPerPage}
          className="btn-align btn-manual-config"
          title="Configure page boundaries or upload MP3 per page"
        >
          {aligning || uploadingPerPage ? (
            <>
              <Loader2 size={18} strokeWidth={2.25} className="fxl-lucide-spin" aria-hidden />
              {uploadingPerPage ? 'Uploading…' : 'Aligning…'}
            </>
          ) : (
            'Configure page boundaries'
          )}
        </button>
        <button type="button" onClick={handleSave} disabled={saving || !segments.length} className="btn-save">
          {saving ? <Loader2 size={18} strokeWidth={2.25} className="fxl-lucide-spin" aria-hidden /> : <Save size={18} {...fxlIc} />}
          {saving ? 'Saving...' : 'Save alignment'}
        </button>
        <button type="button" onClick={handleClearAll} disabled={saving || !segments.length} className="btn-clear" title="Clear all alignment data">
          <Trash2 size={18} {...fxlIc} /> Clear all data
        </button>
        <div className="manual-sync-group">
          <span className="manual-sync-label"><MousePointerClick size={18} {...fxlIc} /> Manual sync</span>
          <button type="button" onClick={setStartAtPlayhead} disabled={!effectiveAudioUrl || !selectedZoneId} className="btn-manual" title="Set selected zone start to current playhead">
            Set start
          </button>
          <button type="button" onClick={setEndAtPlayhead} disabled={!effectiveAudioUrl || !selectedZoneId} className="btn-manual" title="Set selected zone end to current playhead">
            Set end
          </button>
          <span className="manual-sync-hint">or Space ×2</span>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} {...fxlIc} />
          <span>{error}</span>
        </div>
      )}
      {(success || aligning || uploadingPerPage) && (
        <div
          className={`success-banner${aligning || uploadingPerPage ? ' success-banner--progress' : ''}`}
          role="status"
        >
          {aligning || uploadingPerPage ? (
            <Loader2 size={18} strokeWidth={2.25} className="fxl-lucide-spin" aria-hidden />
          ) : (
            <Check size={18} {...fxlIc} />
          )}
          <span>
            {aligning || uploadingPerPage
              ? success || 'Processing audio alignment…'
              : success}
          </span>
        </div>
      )}

      <div className="studio-layout">
        <aside className="fxl-col fxl-col--left viewer-panel left-panel">
          <div className="fxl-panel-top">
            <h3 className="fxl-panel-title">
              <FileText size={18} {...fxlIc} />
              Pages
            </h3>
            <div className="fxl-reader-actions">
              <button
                type="button"
                className="fxl-reader-toggle"
                title="Open EPUB reader (requires Export FXL EPUB 3 in Zoning Studio first)"
                onClick={() => {
                  const spine = currentPage ? `page${currentPage.pageNumber}.xhtml` : 'page1.xhtml';
                  navigate(buildEpubReaderPath(jobId, { source: 'kitaboo', fixedLayout: true, spine }));
                }}
              >
                <BookOpen size={15} {...fxlIc} />
                Reader
              </button>
              <button
                type="button"
                className="fxl-reader-toggle fxl-reader-newtab"
                title="Open reader in a new tab"
                aria-label="Open reader in a new browser tab"
                onClick={() => {
                  const spine = currentPage ? `page${currentPage.pageNumber}.xhtml` : 'page1.xhtml';
                  const path = buildEpubReaderPath(jobId, { source: 'kitaboo', fixedLayout: true, spine });
                  window.open(`${window.location.origin}${path}`, '_blank', 'noopener,noreferrer');
                }}
              >
                <ExternalLink size={15} {...fxlIc} />
              </button>
            </div>
          </div>
          <div className="page-selector">
            <label htmlFor="page-select">Jump to page</label>
            <select
              id="page-select"
              value={currentPageIndex}
              onChange={(e) => setCurrentPageIndex(Number(e.target.value))}
              className="page-select-dropdown"
            >
              {pages.map((p, i) => (
                <option key={p.pageNumber} value={i}>
                  Page {p.pageNumber} ({p.zones?.length || 0} zones)
                </option>
              ))}
            </select>
          </div>
          {currentPage && (
            <div className="fxl-zones-scroll">
              <div className="fxl-zones-heading">
                Zones (Page {currentPage.pageNumber})
              </div>
              <ul className="zone-list">
                {currentPageZones.map((z) => {
                  const seg = alignmentMap[z.id];
                  const ci = zonePaletteIndex(z.id, currentPageZones);
                  const palette = FXL_ZONE_COLORS[ci];
                  return (
                    <li
                      key={z.id}
                      className={`zone-item${selectedZoneId === z.id ? ' selected' : ''}`}
                      style={{ '--zone-bar': palette.bar, '--zone-chip': palette.chip }}
                      onClick={() => {
                        const selecting = selectedZoneId !== z.id;
                        setSelectedZoneId((prev) => (prev === z.id ? null : z.id));
                        if (selecting && seg && wavesurferRef.current && effectiveAudioUrl) {
                          playSegment(seg.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const selecting = selectedZoneId !== z.id;
                          setSelectedZoneId((prev) => (prev === z.id ? null : z.id));
                          if (selecting && seg && wavesurferRef.current && effectiveAudioUrl) {
                            playSegment(seg.id);
                          }
                        }
                      }}
                    >
                      <span className="zone-item-bar" aria-hidden />
                      <div className="zone-item-body">
                        <span className="zone-id">{z.id}</span>
                        <span className="zone-text">
                          {String(z.content || '').trim().slice(0, 48)}
                          {(z.content || '').length > 48 ? '…' : ''}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="fxl-left-foot">
            <button
              type="button"
              className="fxl-open-tab-btn"
              onClick={() => {
                const spine = currentPage ? `page${currentPage.pageNumber}.xhtml` : 'page1.xhtml';
                const path = buildEpubReaderPath(jobId, { source: 'kitaboo', fixedLayout: true, spine });
                window.open(`${window.location.origin}${path}`, '_blank', 'noopener,noreferrer');
              }}
            >
              <Plus size={14} aria-hidden />
              Open in new tab
            </button>
          </div>
        </aside>

        <main className="fxl-col fxl-col--center waveform-panel">
          <section className="fxl-card fxl-timeline-card">
            <div className="waveform-panel-header">
              <span className="waveform-panel-title">Timeline</span>
              <div className="waveform-toolbar">
                <div className="playback-controls">
                  <button
                    type="button"
                    onClick={() => wavesurferRef.current?.play()}
                    disabled={!effectiveAudioUrl || !isReady || isPlaying}
                    className="btn-playback btn-playback--primary"
                    title="Play"
                  >
                    <Play size={18} {...fxlIc} />
                  </button>
                  <button
                    type="button"
                    onClick={() => wavesurferRef.current?.pause()}
                    disabled={!effectiveAudioUrl || !isReady || !isPlaying}
                    className="btn-playback"
                    title="Pause"
                  >
                    <Pause size={18} {...fxlIc} />
                  </button>
                  <span className="playback-time">
                    {typeof currentTime === 'number' ? currentTime.toFixed(2) : '0.00'} s
                  </span>
                </div>
                <div className="zoom-controls">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(10, z - 20))}
                    disabled={!effectiveAudioUrl || zoom <= 10}
                    className="btn-zoom"
                    title="Zoom out"
                  >
                    <ZoomOut size={16} {...fxlIc} />
                  </button>
                  <span className="zoom-label">{zoom}×</span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(200, z + 20))}
                    disabled={!effectiveAudioUrl || zoom >= 200}
                    className="btn-zoom"
                    title="Zoom in"
                  >
                    <ZoomIn size={16} {...fxlIc} />
                  </button>
                  <button
                    type="button"
                    className="btn-zoom"
                    title="Reset zoom"
                    onClick={() => setZoom(50)}
                    disabled={!effectiveAudioUrl}
                  >
                    <Maximize2 size={16} {...fxlIc} />
                  </button>
                </div>
              </div>
            </div>
            <div className="waveform-panel-body">
              {effectiveAudioUrl ? (
                <>
                  <div ref={waveformRef} className="waveform-container" />
                  {displaySegments.length > 0 && (
                    <div className="fxl-region-chips" aria-hidden>
                      {displaySegments.map((seg) => {
                        const ci = zonePaletteIndex(seg.id, currentPageZones);
                        const p = FXL_ZONE_COLORS[ci];
                        return (
                          <span
                            key={seg.id}
                            className="fxl-region-chip"
                            style={{ background: p.chip }}
                          >
                            {seg.id}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="no-audio">
                  Upload narration in Zoning Studio or use Configure page boundaries → MP3 per page.
                </div>
              )}
            </div>
          </section>

          {selectedZone && (
            <section className="fxl-card fxl-zone-detail-card">
              <div className="fxl-zone-detail-head">
                <h4 className="fxl-zone-detail-title">
                  {selectedZone.id}
                  <button type="button" className="fxl-icon-ghost" aria-label="Edit zone label">
                    <Pencil size={14} />
                  </button>
                </h4>
              </div>
              <div className="fxl-zone-detail-grid">
                <div className="fxl-time-fields">
                  <div className="fxl-time-field">
                    <label>Start time</label>
                    <div className="fxl-time-stepper">
                      <button
                        type="button"
                        className="fxl-step-btn"
                        disabled={!selectedSegment}
                        onClick={() => nudgeSegmentTime(selectedZone.id, 'start', -0.05)}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="fxl-time-value">{selectedStartDisp.toFixed(2)} s</span>
                      <button
                        type="button"
                        className="fxl-step-btn"
                        disabled={!selectedSegment}
                        onClick={() => nudgeSegmentTime(selectedZone.id, 'start', 0.05)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="fxl-time-field">
                    <label>End time</label>
                    <div className="fxl-time-stepper">
                      <button
                        type="button"
                        className="fxl-step-btn"
                        disabled={!selectedSegment}
                        onClick={() => nudgeSegmentTime(selectedZone.id, 'end', -0.05)}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="fxl-time-value">{selectedEndDisp.toFixed(2)} s</span>
                      <button
                        type="button"
                        className="fxl-step-btn"
                        disabled={!selectedSegment}
                        onClick={() => nudgeSegmentTime(selectedZone.id, 'end', 0.05)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="fxl-time-field fxl-time-field--duration">
                    <label>Duration</label>
                    <span className="fxl-duration-value">{selectedDuration.toFixed(2)} s</span>
                  </div>
                </div>
                <div className="fxl-zone-preview">
                  <span className="fxl-zone-preview-label">Waveform preview</span>
                  <div className="fxl-zone-preview-bars" aria-hidden>
                    {Array.from({ length: 24 }).map((_, i) => (
                      <span
                        key={i}
                        className="fxl-zone-preview-bar"
                        style={{ height: `${30 + ((i * 17) % 55)}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="fxl-notes-block">
                  <label htmlFor={`zone-note-${selectedZone.id}`}>Notes</label>
                  <textarea
                    id={`zone-note-${selectedZone.id}`}
                    className="fxl-notes-input"
                    rows={3}
                    maxLength={200}
                    placeholder="Optional notes for this zone…"
                    value={zoneNotes[selectedZone.id] || ''}
                    onChange={(e) =>
                      setZoneNotes((prev) => ({ ...prev, [selectedZone.id]: e.target.value }))
                    }
                  />
                  <span className="fxl-notes-count">
                    {(zoneNotes[selectedZone.id] || '').length}/200
                  </span>
                </div>
              </div>
            </section>
          )}

          <section className="fxl-card fxl-overview-card">
            <div className="fxl-overview-head">
              <span className="fxl-overview-title">Audio overview</span>
              <button
                type="button"
                className="fxl-fit-btn"
                onClick={() => setZoom(50)}
                disabled={!effectiveAudioUrl}
              >
                Fit to selection
              </button>
            </div>
            <div className="fxl-overview-track" aria-hidden>
              <div className="fxl-overview-wave">
                {Array.from({ length: 80 }).map((_, i) => (
                  <span
                    key={i}
                    className="fxl-overview-bar"
                    style={{ height: `${22 + ((i * 13) % 68)}%` }}
                  />
                ))}
              </div>
              <div
                className="fxl-overview-window"
                style={{ width: `${overviewViewPct}%`, left: `${Math.min(overviewPlayheadPct, 100 - overviewViewPct)}%` }}
              />
              <div
                className="fxl-overview-playhead"
                style={{ left: `${overviewPlayheadPct}%` }}
              />
            </div>
          </section>
        </main>

        <aside className="fxl-col fxl-col--right right-panel">
          <div className="fxl-segments-head">
            <h3 className="fxl-panel-title">
              Segments {currentPage ? `(Page ${currentPage.pageNumber})` : ''}
            </h3>
            <span className="fxl-segments-count">{displaySegments.length} total</span>
          </div>
          <div className="segment-list">
            {displaySegments.length === 0 ? (
              <p className="no-segments">
                {currentPage && currentPage.zones?.length > 0 && usePerPageAudioForWaveform
                  ? `No alignment for Page ${currentPage.pageNumber}. Configure page boundaries and run alignment.`
                  : 'No segments. Run alignment first.'}
              </p>
            ) : (
              displaySegments.map((seg) => {
                const displayOffset = usePerPageAudioForWaveform ? 0 : currentPageTimeOffset;
                const start = (Number(seg.startTime) || 0) - displayOffset;
                const end = (Number(seg.endTime) || 0) - displayOffset;
                const dur = Math.max(0, end - start);
                const ci = zonePaletteIndex(seg.id, currentPageZones);
                const palette = FXL_ZONE_COLORS[ci];
                return (
                  <div
                    key={seg.id}
                    className={`segment-row${selectedZoneId === seg.id ? ' segment-row--active' : ''}`}
                    onClick={() => setSelectedZoneId(seg.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedZoneId(seg.id);
                      }
                    }}
                  >
                    <span className="segment-dot" style={{ background: palette.bar }} aria-hidden />
                    <div className="segment-main">
                      <span className="segment-id">{seg.id}</span>
                      <span className="segment-time">
                        {start.toFixed(2)}s → {end.toFixed(2)}s
                      </span>
                    </div>
                    <span className="segment-dur-badge" style={{ color: palette.chip, borderColor: `${palette.bar}33`, background: `${palette.bar}14` }}>
                      {dur.toFixed(2)}s
                    </span>
                    <button
                      type="button"
                      className="btn-play-segment"
                      onClick={(e) => {
                        e.stopPropagation();
                        playSegment(seg.id);
                      }}
                      title="Play segment"
                    >
                      <Play size={14} {...fxlIc} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>

      <footer className="fxl-studio-footer">
        <div className="fxl-footer-status">
          {saveSuccess ? (
            <>
              <CheckCircle2 size={16} className="fxl-footer-status-icon" />
              All changes saved
            </>
          ) : saving ? (
            <>
              <Loader2 size={16} className="fxl-lucide-spin" />
              Saving…
            </>
          ) : (
            <span className="fxl-footer-status-muted">Unsaved changes — use Save alignment</span>
          )}
        </div>
        <div className="fxl-footer-pagination">
          <button
            type="button"
            className="fxl-page-nav"
            disabled={currentPageIndex <= 0}
            onClick={() => setCurrentPageIndex((i) => Math.max(0, i - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="fxl-page-label">
            Page {currentPage?.pageNumber ?? '—'} of {pages.length || '—'}
          </span>
          <button
            type="button"
            className="fxl-page-nav"
            disabled={currentPageIndex >= pages.length - 1}
            onClick={() => setCurrentPageIndex((i) => Math.min(pages.length - 1, i + 1))}
            aria-label="Next page"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="fxl-footer-utils" aria-hidden>
          <span className="fxl-footer-hint">⌘ K</span>
        </div>
      </footer>

      {showManualConfig && (
        <div className="manual-config-overlay" onClick={() => setShowManualConfig(false)}>
          <div className="manual-config-modal" onClick={e => e.stopPropagation()}>
            <h3>Manual Page Boundaries</h3>
            <p className="manual-config-hint">
              Upload an MP3 (or WAV/M4A) for each page. Pages with a file will be aligned individually. Skip pages that have no narration.
            </p>
            <div className="manual-config-table-wrap">
              <table className="manual-config-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Skip</th>
                    <th>MP3 file</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map(p => (
                    <tr key={p.pageNumber}>
                      <td>Page {p.pageNumber} ({p.zones?.length || 0} zones)</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={(manualConfig.skipPages || []).includes(p.pageNumber)}
                          onChange={e => {
                            const skip = manualConfig.skipPages || [];
                            setManualConfig(prev => ({
                              ...prev,
                              skipPages: e.target.checked
                                ? [...skip, p.pageNumber]
                                : skip.filter(n => n !== p.pageNumber)
                            }));
                          }}
                        />
                      </td>
                      <td>
                        {pagesWithPerPageAudio.includes(p.pageNumber) && !perPageFiles[p.pageNumber] ? (
                          <span className="per-page-uploaded-cell">
                            <span className="per-page-uploaded">
                              <Check size={14} strokeWidth={2.5} aria-hidden />
                              Uploaded
                            </span>
                            <label className="per-page-upload-label per-page-replace-label">
                              <input
                                type="file"
                                accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"
                                onChange={e => {
                                  const file = e.target.files?.[0];
                                  setPerPageFiles(prev => (file ? { ...prev, [p.pageNumber]: file } : { ...prev, [p.pageNumber]: undefined }));
                                }}
                              />
                              <span className="per-page-upload-btn">Replace</span>
                            </label>
                          </span>
                        ) : (
                          <label className="per-page-upload-label">
                            <input
                              type="file"
                              accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                setPerPageFiles(prev => (file ? { ...prev, [p.pageNumber]: file } : { ...prev, [p.pageNumber]: undefined }));
                              }}
                            />
                            <span className="per-page-upload-btn">
                              {perPageFiles[p.pageNumber] ? perPageFiles[p.pageNumber].name : 'Choose file'}
                            </span>
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="manual-config-actions">
              <button type="button" onClick={() => setShowManualConfig(false)}>Cancel</button>
              <button
                type="button"
                className="btn-align"
                disabled={pagesWithPerPageAudio.length === 0 && !Object.values(perPageFiles).some(f => f instanceof File)}
                onClick={handlePerPageUploadAndAlign}
              >
                <Upload size={18} {...fxlIc} />
                Upload & run alignment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
