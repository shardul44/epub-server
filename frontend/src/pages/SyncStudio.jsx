import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import {
  HiOutlineDownload,
  HiOutlineCheck,
  HiOutlinePencil,
  HiOutlineX,
  HiOutlineSave,
  HiOutlineDocument,
  HiOutlineCog,
  HiOutlineCheckCircle,
  HiOutlineCalculator,
  HiOutlineMicrophone,
  HiOutlineStop,
  HiOutlinePlay,
  HiOutlinePause,
  HiOutlineVolumeUp,
  HiOutlineClipboard,
  HiOutlineDocumentText,
  HiOutlineHashtag,
  HiOutlineArrowUp,
  HiOutlineStar,
  HiOutlineTrash,
  HiOutlineRefresh,
  HiOutlinePaperClip,
  HiOutlineSun,
  HiOutlineClock,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineInformationCircle,
  HiOutlineXCircle,
  HiOutlineBookOpen
} from 'react-icons/hi';
import { HiOutlineSparkles } from 'react-icons/hi2';
import { audioSyncService } from '../services/audioSyncService';
import { conversionService } from '../services/conversionService';
import api from '../services/api';
import { withAuthImageQuery } from '../utils/authImageUrl';
import { xhtmlFragmentForDivViewer } from '../utils/xhtmlViewerFragment';
import './SyncStudio.css';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableItem } from '../components/SortableItem';
import { HiOutlineSelector } from 'react-icons/hi';
import { buildEpubReaderPath } from '../utils/epubReaderUrl';

/** Parser-generated ids (not in client XHTML). Namespaced to avoid shadowing a publisher `ss_imp_*` id. */
const INJECTED_SYNC_ID_PREFIX = 'byline_ss_imp_';

/** Stable id → type when classnames omit sync-sentence / sync-word (typical client EPUBs). */
function inferSyncElementTypeFromId(id, explicitType) {
  if (explicitType === 'word' || explicitType === 'sentence' || explicitType === 'paragraph') return explicitType;
  const s = String(id || '');
  if (/_w\d+$/i.test(s)) return 'word';
  // pdf2htmlEX / InDesign FXL-style word spans (e.g. SML1, SML12)
  if (/^sml/i.test(s)) return 'word';
  if (/_s\d+$/i.test(s)) return 'sentence';
  // Line boxes: t1_15, t2_15 (one line per div)
  if (/^t\d+_/i.test(s)) return 'sentence';
  return 'paragraph';
}

/**
 * Paragraph wrapper + inner sentence spans (our XHTML pipeline): sentence export should use spans only,
 * not the parent paragraph id, to avoid duplicate TTS/sync rows.
 */
function paragraphSupersededByGranularSentenceId(paragraphId, allIds) {
  const pid = String(paragraphId || '');
  if (!pid) return false;
  const needle = `${pid}_s`;
  for (const oid of allIds) {
    if (oid !== pid && String(oid).startsWith(needle)) return true;
  }
  return false;
}

/** Whether a parsed block participates in UI + TTS for the selected export level. */
function parsedElementMatchesGranularityExport(granularity, el, allParsedElementIds) {
  if (!el || !el.id) return false;
  const id = String(el.id);
  if (el.text !== undefined && !String(el.text || '').trim().length) return false;
  const t = inferSyncElementTypeFromId(id, el.type);
  const idSet =
    allParsedElementIds instanceof Set ? allParsedElementIds : new Set(allParsedElementIds || []);
  if (granularity === 'word') return t === 'word' || /_w\d+$/i.test(id);
  if (granularity === 'sentence') {
    if (t === 'sentence' || /_s\d+$/i.test(id)) return true;
    if (t === 'paragraph' && !/_w\d+$/i.test(id) && !paragraphSupersededByGranularSentenceId(id, idSet)) {
      return true;
    }
    return false;
  }
  if (granularity === 'paragraph') return t === 'paragraph' || (!/_w\d+$/i.test(id) && !/_s\d+$/i.test(id));
  return true;
}

/** FXL / pdf2htmlEX: line divs often wrap only spans — do not treat span children as "nested blocks". */
const HEURISTIC_INLINE_CHILD_TAGS = new Set([
  'span',
  'a',
  'b',
  'i',
  'em',
  'strong',
  'u',
  'sub',
  'sup',
  'small',
  'mark',
  'br',
  'wbr',
  'abbr',
  'cite',
  'code',
  'dfn',
  'kbd',
  'q',
  's',
  'samp',
  'time',
  'var',
  'tt',
  'bdi',
  'bdo',
  'ruby',
  'rt',
  'rp',
  'img',
  'svg'
]);

function heuristicHasDirectBlockLevelChild(el) {
  const idStr = (el.getAttribute('id') || '').trim();
  const isPdf2LineBox =
    (el.classList && el.classList.contains('t')) || /^t\d+_/i.test(idStr);

  for (let i = 0; i < el.children.length; i++) {
    const tn = el.children[i].tagName.toLowerCase();
    if (HEURISTIC_INLINE_CHILD_TAGS.has(tn)) continue;
    // pdf2htmlEX often wraps spans in an extra positioned div; still one "line" box.
    if (isPdf2LineBox && tn === 'div') continue;
    return true;
  }
  return false;
}

/** pdf2htmlEX footer / page-number styling (e.g. class s3_15). */
function heuristicIsPdf2htmlFooterishClass(el) {
  const cl = el.classList;
  if (!cl || !cl.length) return false;
  for (let i = 0; i < cl.length; i++) {
    if (/^s\d+_\d+$/i.test(cl[i])) return true;
  }
  return false;
}

function heuristicIsStandaloneShortNumeric(text) {
  const t = String(text || '').trim();
  if (t.length === 0 || t.length > 2) return false;
  return /^\d+$/.test(t);
}

function heuristicElementLikelyHidden(el) {
  try {
    if (el.getAttribute('hidden') != null) return true;
    const st = el.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(st) || /visibility\s*:\s*hidden/i.test(st)) return true;
    const win = el.ownerDocument?.defaultView;
    if (win && typeof win.getComputedStyle === 'function') {
      const c = win.getComputedStyle(el);
      if (c.display === 'none' || c.visibility === 'hidden') return true;
    }
  } catch (_) {
    /* DOMParser docs have no view — style attr still checked above */
  }
  return false;
}

/**
 * Heuristic discovery for "wild" EPUBs: no data-read-aloud, arbitrary ids.
 * Prefers structure (semantic tags, text, leaf-ish blocks) over proprietary markers.
 * Ids missing in XHTML get parser-only `${INJECTED_SYNC_ID_PREFIX}*` ids (sidebar/TTS work; in-DOM highlight skips until XHTML carries the id).
 */
function collectHeuristicWildEpubBlocks(doc, sectionId, effectivePageNumber, existingIds) {
  const out = [];
  if (!doc?.body || !(existingIds instanceof Set)) return out;

  const HEURISTIC_SELECTOR = [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'blockquote',
    'figcaption',
    'span.text',
    'span[id]',
    'div[role="doc-text"]',
    // Fixed-layout / pdf2htmlEX: one div per line (.t), word spans (SML*), id t1_15 style
    '.t',
    'span[id^="SML"]',
    'span[id^="sml"]',
    'div[id^="t"]'
  ].join(', ');

  let injectCounter = 0;
  doc.body.querySelectorAll(HEURISTIC_SELECTOR).forEach((el) => {
    if (el.getAttribute('data-read-aloud') === 'true') return;
    if (el.closest('svg, code, pre, script, style, head, nav, [role="doc-toc"]')) return;
    const r = (el.getAttribute('role') || '').toLowerCase();
    const ariaHidden = (el.getAttribute('aria-hidden') || '').toLowerCase();
    if (r === 'presentation' || r === 'none' || ariaHidden === 'true') return;
    if (heuristicElementLikelyHidden(el)) return;
    if (heuristicIsPdf2htmlFooterishClass(el)) return;

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;
    if (heuristicIsStandaloneShortNumeric(text)) return;
    if (heuristicHasDirectBlockLevelChild(el)) return;

    let id = (el.getAttribute('id') || '').trim();
    let injectedId = false;
    if (!id) {
      id = `${INJECTED_SYNC_ID_PREFIX}${sectionId}_${injectCounter++}`;
      injectedId = true;
    }
    if (id.includes('div')) return;
    if (existingIds.has(id)) return;

    existingIds.add(id);
    const tagName = el.tagName.toLowerCase();
    const classList = el.className || '';
    const idForType = id;

    let type = 'sentence';
    const isClientWord =
      classList.includes('sync-word') ||
      (tagName === 'span' && /_w\d+$/i.test(idForType)) ||
      /^sml/i.test(idForType);
    const isClientLine =
      (el.classList && el.classList.contains('t')) ||
      /^t\d+_/i.test(idForType);

    if (isClientWord) {
      type = 'word';
    } else if (classList.includes('sync-sentence') || /_s\d+$/i.test(idForType) || isClientLine) {
      type = 'sentence';
    } else if (tagName === 'p' || tagName === 'div') {
      type = 'paragraph';
    }

    let parentId;
    if (type === 'word' && /^sml/i.test(idForType) && typeof el.closest === 'function') {
      const line = el.closest('.t[id], div[id^="t"]');
      const lid = (line?.getAttribute?.('id') || '').trim();
      if (lid) parentId = lid;
    } else if (type === 'word' && /_w\d+$/i.test(idForType)) {
      const parentMatch = idForType.match(/^((?:page\d+_)?p\d+_s\d+)_w\d+$/);
      parentId = parentMatch ? parentMatch[1] : idForType.replace(/_w\d+$/, '');
    }

    let elementPageNumber = effectivePageNumber;
    const pageMatch = id.match(/page(\d+)_/i);
    if (pageMatch) elementPageNumber = parseInt(pageMatch[1], 10);

    const row = {
      id,
      text,
      type,
      tagName,
      sectionId,
      sectionIndex: sectionId,
      pageNumber: elementPageNumber,
      ...(parentId ? { parentId } : {})
    };
    if (injectedId) row.injectedId = true;
    out.push(row);
  });
  return out;
}

const SyncStudio = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();

  // Refs
  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const regionsPluginRef = useRef(null);
  const viewerRef = useRef(null);
  const isSpaceDownRef = useRef(false);
  const spaceDownTimeRef = useRef(0);
  const lastSyncTimeRef = useRef(0);
  const tapSyncStartTimeRef = useRef(null); // Store start time for tap-to-sync (two-tap method)

  // State for content
  const [xhtmlContent, setXhtmlContent] = useState('');
  const [sections, setSections] = useState([]);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  // Helper to get the actual page number of the current section
  const currentPageNumber = useMemo(() => {
    if (sections && sections[currentSectionIndex]) {
      return sections[currentSectionIndex].pageNumber || currentSectionIndex + 1;
    }
    return currentSectionIndex + 1;
  }, [sections, currentSectionIndex]);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // State for audio
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioSource, setAudioSource] = useState(null); // 'uploaded' | 'tts' — so user knows what they're hearing
  const [audioFile, setAudioFile] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0); // Audio playback speed (1x, 1.25x, 1.5x)

  // WaveSurfer uses fetch/audio element without axios interceptors; ensure media URLs carry auth.
  useEffect(() => {
    if (!audioUrl) return;
    const nextUrl = withAuthImageQuery(audioUrl);
    if (nextUrl !== audioUrl) {
      setAudioUrl(nextUrl);
    }
  }, [audioUrl]);

  // State for sync data
  const [syncData, setSyncData] = useState({
    sentences: {}, // { id: { start, end, text, pageNumber } }
    words: {}      // { id: { parentId, start, end, text } }
  });
  const [activeRegionId, setActiveRegionId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false); // Ref to track recording state for event handlers
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [selectedBlockForSync, setSelectedBlockForSync] = useState(null); // Block ID selected for manual tap-to-sync
  const [parsedElements, setParsedElements] = useState([]);
  const [playingSegmentId, setPlayingSegmentId] = useState(null); // Track which segment is playing
  const [showAudioScript, setShowAudioScript] = useState(false); // Track if audio script modal is open
  const [audioScriptData, setAudioScriptData] = useState({ sentences: {}, words: {} }); // Audio script data from backend
  const [loadingAudioScript, setLoadingAudioScript] = useState(false); // Loading state for audio script
  const [editingScriptBlockId, setEditingScriptBlockId] = useState(null); // Track which script block is being edited
  const [editedScriptText, setEditedScriptText] = useState(''); // Edited text for script block
  const [playingScriptSegmentId, setPlayingScriptSegmentId] = useState(null); // Track which script segment is playing
  const [regeneratingScriptBlock, setRegeneratingScriptBlock] = useState(null); // Track which script block is regenerating

  // State for manual section boundaries (reflowable = FXL-style manual boundaries)
  const [showManualSectionBoundaries, setShowManualSectionBoundaries] = useState(false);
  const [manualSectionBoundaries, setManualSectionBoundaries] = useState([]); // [{ sectionIndex, start, end, audioFile?, audioUrl?, audioFileName? }, ...]

  // Per-section audio: each section can have its own audio file (uploaded or TTS-generated)
  // { [sectionIndex]: { url, fileName, source: 'uploaded'|'tts' } }
  const [perSectionAudioFiles, setPerSectionAudioFiles] = useState({});
  const [perSectionMode, setPerSectionMode] = useState(true); // Per-section audio is the default mode

  // State for diagnostic modal
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recognitionRef = useRef(null);

  // Ref to access latest syncData in event handlers
  const syncDataRef = useRef(syncData);
  const playingSegmentIdRef = useRef(null);
  const playingScriptSegmentIdRef = useRef(null);
  const isProgrammaticPlayRef = useRef(false); // Flag to prevent infinite loops during programmatic playback
  const audioScriptDataRef = useRef(audioScriptData);
  const pendingRegionUpdatesRef = useRef(new Map()); // Track regions that need to be recreated after audio reload
  const segmentEndIntervalRef = useRef(null); // Interval for checking segment end
  const isScrubbingRef = useRef(false); // Flag to prevent infinite loops during scrubbing
  const waveSurferDestroyingRef = useRef(false); // Suppress expected AbortError during destroy/re-init

  // Keep refs in sync with state
  useEffect(() => {
    syncDataRef.current = syncData;
  }, [syncData]);

  useEffect(() => {
    playingSegmentIdRef.current = playingSegmentId;
  }, [playingSegmentId]);

  useEffect(() => {
    playingScriptSegmentIdRef.current = playingScriptSegmentId;
  }, [playingScriptSegmentId]);

  useEffect(() => {
    audioScriptDataRef.current = audioScriptData;
  }, [audioScriptData]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Cleanup speech recognition when modal closes
  useEffect(() => {
    if (!showDiagnostics && recognitionRef.current) {
      stopSpeechRecognition();
      setTranscribedText('');
    }
  }, [showDiagnostics]);

  // State for settings
  const [snapToSilence, setSnapToSilence] = useState(true);
  const [showWordTrack, setShowWordTrack] = useState(true);
  const [scrubOnDrag, setScrubOnDrag] = useState(true);
  const [granularity, setGranularity] = useState('sentence');

  // State for TTS generation
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('standard');
  const [ttsSpeakingRate, setTtsSpeakingRate] = useState(1.25); // 1.25 = 25% faster TTS when using Google Cloud
  const [generating, setGenerating] = useState(false);
  const [pdfId, setPdfId] = useState(null);

  // State for Magic Sync
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [aeneasAvailable, setAeneasAvailable] = useState(null);
  const [autoSyncProgress, setAutoSyncProgress] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const appendQueryParams = useCallback((url, params = {}) => {
    if (!url) return url;
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (entries.length === 0) return url;
    const sep = url.includes('?') ? '&' : '?';
    const q = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${url}${sep}${q}`;
  }, []);

  // State for text block editing
  const [editingBlockId, setEditingBlockId] = useState(null);
  const [editedText, setEditedText] = useState('');
  const [regeneratingBlock, setRegeneratingBlock] = useState(null);

  // Drag and drop state
  const [sortedIds, setSortedIds] = useState([]);
  const sortedIdsRef = useRef([]);
  const [activeDragId, setActiveDragId] = useState(null);
  const [autoSaveIndicator, setAutoSaveIndicator] = useState(false); // Show "Reading order saved" indicator
  const [hasLoadedReadingOrder, setHasLoadedReadingOrder] = useState(false); // Track if we've loaded saved order
  const [hasManualOrder, setHasManualOrder] = useState(false); // Track if user has manually reordered items
  const [readingOrderByPage, setReadingOrderByPage] = useState({}); // Store per-page reading orders
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // In per-section mode, track the set of element IDs that belong to the currently-active section.
  // This is used to filter waveform regions and sync data so segments from other sections don't bleed
  // onto the current section's waveform (each per-section audio file has its own independent timeline).
  const currentSectionElementIds = useMemo(() => {
    if (!perSectionMode) return null; // null = no filtering
    const ids = new Set(
      parsedElements
        .filter(el => el.sectionIndex === currentSectionIndex)
        .map(el => el.id)
    );
    return ids;
  }, [perSectionMode, currentSectionIndex, parsedElements]);

  // Sync sortedIds with syncData/page changes while preserving manual order
  useEffect(() => {
    // Don't auto-compute if we have a saved/manual reading order
    if (hasLoadedReadingOrder || hasManualOrder) {
      console.log(`[SyncStudio useEffect] 🛑 Skipping auto-compute (hasLoadedReadingOrder=${hasLoadedReadingOrder}, hasManualOrder=${hasManualOrder})`);
      return;
    }
    
    const orderKey = `section:${currentSectionIndex}`;
    console.log(`[SyncStudio useEffect] 🔄 Computing order for section ${currentSectionIndex} (page ${currentPageNumber})`);
    
    const computeDerivedIds = () => {
      const allItems = [
        ...Object.entries(syncData.sentences).filter(([id]) => !id.includes('_w')).map(([id, data]) => ({ id, data })),
        ...Object.entries(syncData.words).filter(([id]) => id.includes('_w')).map(([id, data]) => ({ id, data }))
      ];

      const allParsedIds = parsedElements.map((el) => el.id);
      const filteredItems = allItems.filter(({ id, data }) => {
          const parsedElement = parsedElements.find(el => el.id === id);
          const isCorrectSection = parsedElement && parsedElement.sectionIndex === currentSectionIndex;
          const isCorrectPage = data.pageNumber === currentPageNumber;
          const show = parsedElement ? isCorrectSection : isCorrectPage;
          if (!show) return false;
          const el = parsedElement || { id, type: inferSyncElementTypeFromId(id) };
          return parsedElementMatchesGranularityExport(granularity, el, allParsedIds);
        });
      
      // Preferred scope: section/chapter order (single XHTML can include multiple logical pages)
      const savedOrderForSection = readingOrderByPage[orderKey];
      const savedOrderForPage = readingOrderByPage[String(currentPageNumber)];
      const savedOrder = Array.isArray(savedOrderForSection) && savedOrderForSection.length > 0
        ? savedOrderForSection
        : (Array.isArray(savedOrderForPage) ? savedOrderForPage : []);
      if (savedOrder.length > 0) {
        console.log(`[SyncStudio useEffect] 📋 Using saved reading order for ${orderKey} (${savedOrder.length} items)`);
        const validIds = new Set(filteredItems.map(item => item.id));
        const orderedIds = savedOrder.filter(id => validIds.has(id));
        // Add any new items that aren't in saved order (at the end)
        const orderedSet = new Set(orderedIds);
        const newItems = filteredItems.filter(item => !orderedSet.has(item.id));
        return [...orderedIds, ...newItems.map(item => item.id)];
      }
      
      // No saved order - use default sort
      return filteredItems
        .sort((a, b) => {
          // Default Sort Logic
          if (a.data.status === 'SKIPPED' && b.data.status !== 'SKIPPED') return 1;
          if (a.data.status !== 'SKIPPED' && b.data.status === 'SKIPPED') return -1;
          if (a.data.status === 'UNSYNCED' && b.data.status !== 'UNSYNCED' && b.data.status !== 'SKIPPED') return 1;
          if (a.data.status !== 'UNSYNCED' && b.data.status === 'UNSYNCED' && a.data.status !== 'SKIPPED') return -1;
          return (a.data.start || 0) - (b.data.start || 0);
        })
        .map(item => item.id);
    };

    const newIds = computeDerivedIds();
    setSortedIds(prevIds => {
      const prevSet = new Set(prevIds);
      const newSet = new Set(newIds);
      // If set content matches, preserve order
      if (prevSet.size === newSet.size && [...prevSet].every(x => newSet.has(x))) {
        return prevIds;
      }
      return newIds;
    });

  }, [syncData, currentSectionIndex, currentPageNumber, granularity, parsedElements, hasLoadedReadingOrder, hasManualOrder, readingOrderByPage]);

  // Keep a live ref so save/export always uses the latest reordered list,
  // even if React state batching delays sortedIds updates.
  useEffect(() => {
    sortedIdsRef.current = sortedIds;
  }, [sortedIds]);

  // Reset manual order flag when page/section changes (allow recompute for new page)
  useEffect(() => {
    console.log(`[SyncStudio] 🔄 Page/section changed (section: ${currentSectionIndex}, page: ${currentPageNumber}), resetting hasManualOrder`);
    setHasManualOrder(false);
    setHasLoadedReadingOrder(false); // Also reset loaded flag to allow fresh compute
  }, [currentSectionIndex, currentPageNumber]);

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      const currentOrder = Array.isArray(sortedIdsRef.current) ? sortedIdsRef.current : sortedIds;
      const oldIndex = currentOrder.indexOf(active.id);
      const newIndex = currentOrder.indexOf(over.id);
      if (oldIndex < 0 || newIndex < 0) {
        setActiveDragId(null);
        return;
      }
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
      sortedIdsRef.current = newOrder;
      setSortedIds(newOrder);
      console.log(`[SyncStudio handleDragEnd] 📦 New order for section ${currentSectionIndex}:`, newOrder);
      
      const orderKey = `section:${currentSectionIndex}`;

      // Merge page-local reorder into full section order (do not overwrite entire section order
      // with only currently visible IDs, otherwise export falls back to XHTML order for missing IDs).
      const mergeIntoSectionOrder = (existingOrder, pageOrder) => {
        const pageIds = Array.isArray(pageOrder) ? pageOrder : [];
        if (pageIds.length === 0) return Array.isArray(existingOrder) ? existingOrder : [];
        const existing = Array.isArray(existingOrder) ? existingOrder : [];
        if (existing.length === 0) return [...pageIds];

        const pageSet = new Set(pageIds);
        const merged = [];
        let inserted = false;
        for (const id of existing) {
          if (pageSet.has(id)) {
            if (!inserted) {
              merged.push(...pageIds);
              inserted = true;
            }
            continue;
          }
          merged.push(id);
        }
        if (!inserted) merged.push(...pageIds);
        return Array.from(new Set(merged));
      };

      const existingSectionOrder = readingOrderByPage[orderKey] || [];
      const mergedSectionOrder = mergeIntoSectionOrder(existingSectionOrder, newOrder);
      // Persist by section key (chapter scope), keep page key for backward compatibility.
      setReadingOrderByPage(prev => ({
        ...prev,
        [orderKey]: mergedSectionOrder,
        [String(currentPageNumber)]: newOrder
      }));
      
      // Set manual order flag to prevent useEffect from overwriting
      setHasManualOrder(true);
      console.log(`[SyncStudio handleDragEnd] 🔒 Set hasManualOrder=true for ${orderKey}`);
      
      // Auto-save reading order immediately after drag
      if (newOrder && jobId) {
        try {
          // Get current segments for the save (required by API)
          const segments = [];
          Object.entries(syncData.sentences).forEach(([id, data]) => {
            if (data.start != null && data.end != null) {
              segments.push({ id, startTime: data.start, endTime: data.end });
            }
          });
          Object.entries(syncData.words).forEach(([id, data]) => {
            if (data.start != null && data.end != null) {
              segments.push({ id, startTime: data.start, endTime: data.end });
            }
          });
          
          console.log(`[SyncStudio handleDragEnd] 💾 Saving ${segments.length} segments and ${mergedSectionOrder.length} reading order items for ${orderKey}`);
          
          // Save reading order scoped by section/chapter
          const result = await audioSyncService.saveSyncStudio(parseInt(jobId), segments, mergedSectionOrder, currentPageNumber, orderKey);
          console.log(`[SyncStudio handleDragEnd] ✅ Auto-saved reading order for ${orderKey}:`, result);
          
          // Show success indicator briefly
          setAutoSaveIndicator(true);
          setTimeout(() => setAutoSaveIndicator(false), 2000);
        } catch (err) {
          console.error('[SyncStudio handleDragEnd] ❌ Failed to auto-save reading order:', err);
          // Don't show error to user - this is a background save
        }
      }
    }
    setActiveDragId(null);
  };

  const handleDragStart = (event) => {
    setActiveDragId(event.active.id);
  };


  // State for resizable panels
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const saved = localStorage.getItem('sync-studio-left-panel-width');
    return saved ? parseInt(saved, 10) : 350;
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('sync-studio-right-panel-width');
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const resizeContainerRef = useRef(null);

  /**
   * Parse XHTML to extract syncable elements
   */
  const parseXhtmlElements = useCallback((xhtml, sectionId = 0, pageNumber = null) => {
    if (!xhtml) return [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtml, 'text/html');
      const elements = [];

      // Use provided pageNumber or fallback to sectionId + 1
      const effectivePageNumber = pageNumber !== null ? pageNumber : sectionId + 1;

      // Find all elements with data-read-aloud="true"
      const readAloudElements = doc.querySelectorAll('[data-read-aloud="true"]');
      // <img> alt text is not part of textContent; dedupe when nested read-aloud wraps the same image
      const seenImageAltKeys = new Set();

      const getBestImageAltId = (imgEl, fallbackBaseId, fallbackIdx) => {
        const rawImgId = (imgEl?.getAttribute('id') || '').trim();
        if (rawImgId) return rawImgId;

        // Prefer nearest semantic image container instead of generic page/div wrappers.
        let node = imgEl?.parentElement || null;
        while (node) {
          const nid = (node.getAttribute?.('id') || '').trim();
          const cls = (node.getAttribute?.('class') || '').toLowerCase();
          const isImageContainerClass =
            cls.includes('has-image') ||
            cls.includes('image-drop-zone') ||
            cls.includes('image-placeholder');
          const looksLikeImageId =
            /(?:_img\d+|_image\d+|captionheader\d+)$/i.test(nid);
          const looksLikeGenericDiv = /(?:^|_)div\d+$/i.test(nid);
          if (nid && (isImageContainerClass || (looksLikeImageId && !looksLikeGenericDiv))) {
            return nid;
          }
          node = node.parentElement;
        }

        return `${fallbackBaseId}_imgalt_${fallbackIdx}`;
      };

      readAloudElements.forEach((el, idx) => {
        const id = el.getAttribute('id') || `sync-${sectionId}-${idx}`;
        const tagName = el.tagName.toLowerCase();
        const imgAlt = tagName === 'img' ? (el.getAttribute('alt') || '').trim() : '';
        const text = tagName === 'img' ? imgAlt : el.textContent?.trim() || '';
        const classList = el.className || '';

        // Some container div ids include "div". We don't want to create sidebar segments for them,
        // but we still need to extract descendant <img alt="..."> descriptions inside them.
        const skipIdSegment = id.includes('div');

        // <img> uses alt for sync text, not textContent
        if (tagName === 'img' && !imgAlt) {
          return;
        }

        // NEW: Intelligently extract page number from ID for multi-page chapters
        let elementPageNumber = effectivePageNumber;
        const pageMatch = id.match(/page(\d+)_/i);
        if (pageMatch) {
          elementPageNumber = parseInt(pageMatch[1], 10);
        }

        // Determine element type
        let type = 'paragraph';
        if (classList.includes('sync-word') || tagName === 'span' && id.includes('_w')) {
          type = 'word';
        } else if (classList.includes('sync-sentence') || id.includes('_s')) {
          type = 'sentence';
        }
        if (tagName === 'img' && imgAlt) {
          type = 'sentence';
        }

        // Extract parentId for word-level elements
        let parentId = undefined;
        if (type === 'word' && id.includes('_w')) {
          const parentMatch = id.match(/^((?:page\d+_)?p\d+_s\d+)_w\d+$/);
          if (parentMatch) {
            parentId = parentMatch[1];
          } else {
            parentId = id.replace(/_w\d+$/, '');
          }
        }

        // Store section index for page filtering
        if (!skipIdSegment) {
          elements.push({
            id,
            text,
            type,
            tagName,
            sectionId,
            sectionIndex: sectionId, // Store section index for page filtering
            pageNumber: elementPageNumber, // Use extracted or effective page number
            parentId: parentId,
            ...(tagName === 'img' ? { isImageAlt: true } : {})
          });
        }

        // Also extract word elements nested inside this element (for word-level granularity)
        // Words don't have data-read-aloud="true" but are children of elements that do
        if (type !== 'word') {
          if (!skipIdSegment) {
            const wordElements = el.querySelectorAll('.sync-word[id], span[id*="_w"]');
            wordElements.forEach((wordEl) => {
              const wordId = wordEl.getAttribute('id');
              if (!wordId || wordId.includes('div')) return; // Skip if no ID or contains "div"

              const wordText = wordEl.textContent?.trim() || '';
              if (!wordText) return; // Skip empty words

              // NEW: Extract page number from word ID too
              let wordPageNumber = elementPageNumber;
              const wordPageMatch = wordId.match(/page(\d+)_/i);
              if (wordPageMatch) {
                wordPageNumber = parseInt(wordPageMatch[1], 10);
              }

              // Extract parentId for word elements
              const wordParentMatch = wordId.match(/^((?:page\d+_)?p\d+_s\d+)_w\d+$/);
              const wordParentId = wordParentMatch ? wordParentMatch[1] : wordId.replace(/_w\d+$/, '');

              elements.push({
                id: wordId,
                text: wordText,
                type: 'word',
                tagName: wordEl.tagName.toLowerCase(),
                sectionId,
                sectionIndex: sectionId,
                pageNumber: wordPageNumber,
                parentId: wordParentId
              });
            });
          }

          // Image descriptions: only when <img> is not already a read-aloud node (those are handled above)
          el.querySelectorAll('img[alt]').forEach((img, imgIdx) => {
            const alt = (img.getAttribute('alt') || '').trim();
            if (!alt) return;
            if (img.getAttribute('data-read-aloud') === 'true') return;

            const rawImgId = img.getAttribute('id');
            const dedupeKey = rawImgId
              ? `id:${rawImgId}`
              : `src:${img.getAttribute('src') || ''}\0${alt}`;
            if (seenImageAltKeys.has(dedupeKey)) return;
            seenImageAltKeys.add(dedupeKey);

            // Keep image-alt ids aligned with actual XHTML ids when possible.
            // Falls back to legacy synthetic id only if no suitable image container id exists.
            const imgId = getBestImageAltId(img, id, imgIdx);

            let imgPageNumber = elementPageNumber;
            const imgPageMatch = imgId.match(/page(\d+)_/i);
            if (imgPageMatch) {
              imgPageNumber = parseInt(imgPageMatch[1], 10);
            }

            elements.push({
              id: imgId,
              text: alt,
              type: 'sentence',
              tagName: 'img',
              sectionId,
              sectionIndex: sectionId,
              pageNumber: imgPageNumber,
              parentId: undefined,
              isImageAlt: true
            });

            // Word-level: create a synthetic single-word segment for the image alt text.
            // This is needed because the sidebar in Word granularity only shows entries where
            // `elementType === 'word'` (or ids include `_w`).
            elements.push({
              id: `${imgId}_w1`,
              text: alt,
              type: 'word',
              tagName: 'img',
              sectionId,
              sectionIndex: sectionId,
              pageNumber: imgPageNumber,
              parentId: imgId,
              isImageAlt: true
            });
          });
        }
      });

      // Fallback: some regenerated chapter XHTML places <img alt="..."> outside data-read-aloud nodes
      // (e.g., sibling .has-image blocks). Include those alts as syncable segments too.
      doc.querySelectorAll('img[alt]').forEach((img, imgIdx) => {
        const alt = (img.getAttribute('alt') || '').trim();
        if (!alt) return;

        const role = (img.getAttribute('role') || '').toLowerCase();
        const ariaHidden = (img.getAttribute('aria-hidden') || '').toLowerCase();
        if (role === 'presentation' || role === 'none' || ariaHidden === 'true') return;

        const rawImgId = img.getAttribute('id');
        const parentId = img.parentElement?.getAttribute('id') || '';
        const dedupeKey = rawImgId
          ? `id:${rawImgId}`
          : `src:${img.getAttribute('src') || ''}\0${alt}`;
        if (seenImageAltKeys.has(dedupeKey)) return;
        seenImageAltKeys.add(dedupeKey);

        let imgId = getBestImageAltId(img, parentId || `section${sectionId}`, imgIdx);

        let imgPageNumber = effectivePageNumber;
        const imgPageMatch = String(imgId).match(/page(\d+)_/i) || String(parentId).match(/page(\d+)_/i);
        if (imgPageMatch) {
          imgPageNumber = parseInt(imgPageMatch[1], 10);
        }

        elements.push({
          id: imgId,
          text: alt,
          type: 'sentence',
          tagName: 'img',
          sectionId,
          sectionIndex: sectionId,
          pageNumber: imgPageNumber,
          parentId: undefined,
          isImageAlt: true
        });

        elements.push({
          id: `${imgId}_w1`,
          text: alt,
          type: 'word',
          tagName: 'img',
          sectionId,
          sectionIndex: sectionId,
          pageNumber: imgPageNumber,
          parentId: imgId,
          isImageAlt: true
        });
      });

      // Wild / client EPUB heuristic layer (runs after proprietary read-aloud + image passes).
      const existingIds = new Set(elements.map((e) => e.id));
      elements.push(...collectHeuristicWildEpubBlocks(doc, sectionId, effectivePageNumber, existingIds));

      return elements;
    } catch (err) {
      console.error('Error parsing XHTML:', err);
      return [];
    }
  }, []);

  /**
   * Calculate proportional word timings from sentence timing
   */
  const calculateWordTimings = useCallback((sentenceId, sentenceStart, sentenceEnd) => {
    if (!xhtmlContent || sentenceEnd <= sentenceStart) return [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xhtmlContent, 'text/html');
      const sentenceEl = doc.getElementById(sentenceId);

      if (!sentenceEl) return [];

      const wordElements = sentenceEl.querySelectorAll('.sync-word');
      if (wordElements.length === 0) return [];

      const totalChars = Array.from(wordElements).reduce(
        (sum, el) => sum + (el.textContent?.trim().length || 0),
        0
      );

      if (totalChars === 0) return [];

      const totalDuration = sentenceEnd - sentenceStart;
      let runningTime = sentenceStart;
      const words = [];

      wordElements.forEach((el) => {
        const charLen = el.textContent?.trim().length || 1;
        const ratio = charLen / totalChars;
        const wordDuration = totalDuration * ratio;
        const start = runningTime;
        const end = runningTime + wordDuration;

        words.push({
          id: el.getAttribute('id'),
          parentId: sentenceId,
          text: el.textContent?.trim() || '',
          start: parseFloat(start.toFixed(3)),
          end: parseFloat(end.toFixed(3))
        });

        runningTime = end;
      });

      return words;
    } catch (err) {
      console.error('Error calculating word timings:', err);
      return [];
    }
  }, [xhtmlContent]);

  /**
   * Find nearest silence in waveform (zero-crossing detection)
   */
  const findNearestSilence = useCallback((targetTime, windowMs = 100) => {
    const t = Number(targetTime);
    if (Number.isNaN(t) || t < 0) return targetTime;
    if (!wavesurferRef.current || !snapToSilence) return t;

    try {
      const backend = wavesurferRef.current.getDecodedData();
      if (!backend) return targetTime;

      const sampleRate = backend.sampleRate;
      const channelData = backend.getChannelData(0);
      const audioDuration = wavesurferRef.current.getDuration();

      const sampleIndex = Math.floor(t * sampleRate);
      const windowSamples = Math.floor((windowMs / 1000) * sampleRate);
      const startSearch = Math.max(0, sampleIndex - windowSamples);
      const endSearch = Math.min(channelData.length, sampleIndex + windowSamples);

      let quietestIndex = sampleIndex;
      let minAmplitude = Math.abs(channelData[sampleIndex] || 0);

      // Find the point with the lowest amplitude (silence)
      for (let i = startSearch; i < endSearch; i++) {
        const amplitude = Math.abs(channelData[i]);
        if (amplitude < minAmplitude) {
          minAmplitude = amplitude;
          quietestIndex = i;
        }
      }

      const snappedTime = quietestIndex / sampleRate;

      // Only snap if we found a significantly quieter point
      if (minAmplitude < 0.1 && !Number.isNaN(snappedTime)) {
        console.log(`[Snap] ${t.toFixed(3)}s → ${snappedTime.toFixed(3)}s (amplitude: ${minAmplitude.toFixed(4)})`);
        return snappedTime;
      }

      return t;
    } catch (err) {
      console.warn('Error finding silence:', err);
      return t;
    }
  }, [snapToSilence]);

  /**
   * Scrub audio at specific time (play micro-loop)
   */
  const scrubAudio = useCallback((time, duration = 0.1) => {
    if (!wavesurferRef.current || !scrubOnDrag) return;

    // Prevent infinite loops - if already scrubbing, skip
    if (isScrubbingRef.current) {
      return;
    }

    try {
      isScrubbingRef.current = true;
      wavesurferRef.current.setTime(time);
      wavesurferRef.current.play();
      setTimeout(() => {
        if (wavesurferRef.current) {
          wavesurferRef.current.pause();
        }
        isScrubbingRef.current = false;
      }, duration * 1000);
    } catch (err) {
      console.warn('Error scrubbing:', err);
      isScrubbingRef.current = false;
    }
  }, [scrubOnDrag]);

  /**
   * Highlight element in XHTML viewer
   */
  const highlightElement = useCallback((elementId) => {
    if (!viewerRef.current) {
      console.warn('[Highlight] viewerRef.current is null');
      return;
    }

    // Remove previous highlights
    const highlighted = viewerRef.current.querySelectorAll('.studio-highlight');
    highlighted.forEach(el => el.classList.remove('studio-highlight'));

    // Add new highlight
    if (elementId) {
      if (String(elementId).startsWith(INJECTED_SYNC_ID_PREFIX)) {
        return;
      }
      // Try multiple selector strategies
      let el = viewerRef.current.querySelector(`#${CSS.escape(elementId)}`);

      // If not found, try without escaping (in case elementId already has special chars)
      if (!el) {
        el = viewerRef.current.querySelector(`#${elementId}`);
      }

      // If still not found, try searching by attribute
      if (!el) {
        el = viewerRef.current.querySelector(`[id="${elementId}"]`);
      }

      // If still not found, try searching all elements with that ID (case-insensitive)
      if (!el) {
        const allElements = viewerRef.current.querySelectorAll('[id]');
        for (const elem of allElements) {
          if (elem.id === elementId || elem.id.toLowerCase() === elementId.toLowerCase()) {
            el = elem;
            break;
          }
        }
      }

      if (el) {
        el.classList.add('studio-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.log(`[Highlight] ✓ Highlighted element: ${elementId}`);
      } else {
        console.warn(`[Highlight] ✗ Element not found: ${elementId}. Available IDs:`,
          Array.from(viewerRef.current.querySelectorAll('[id]')).slice(0, 10).map(e => e.id)
        );
      }
    }
  }, []);

  /**
   * Create a region on the waveform
   */
  const createRegion = useCallback((id, start, end, type = 'sentence', color = null) => {
    if (!regionsPluginRef.current) return null;

    const regionColor = color || (type === 'sentence'
      ? 'rgba(74, 123, 84, 0.4)'
      : 'rgba(255, 212, 59, 0.3)');

    // Ensure valid duration.
    // Some Aeneas outputs can be extremely short (or near-zero) for trailing sentences.
    // Use a slightly larger visual minimum for sentence regions so they remain visible/editable.
    const minDuration = type === 'sentence' ? 0.12 : 0.01;
    const actualStart = Math.max(0, start);
    const actualEnd = Math.max(actualStart + minDuration, end);

    const region = regionsPluginRef.current.addRegion({
      id,
      start: actualStart,
      end: actualEnd,
      color: regionColor,
      drag: true,
      resize: true,
      minLength: minDuration, // Minimum region length for resize
      content: type === 'sentence' ? id : undefined
    });

    // Ensure region is interactive by setting pointer events
    // Use setTimeout to ensure DOM is ready (region.element might not be immediately available)
    setTimeout(() => {
      if (region && region.element) {
        region.element.style.pointerEvents = 'auto';
        region.element.style.cursor = 'move';
        region.element.style.userSelect = 'none';

        // Ensure resize handles are interactive
        const resizeHandles = region.element.querySelectorAll('.wavesurfer-handle');
        resizeHandles.forEach(handle => {
          handle.style.pointerEvents = 'auto';
          handle.style.cursor = 'ew-resize';
          handle.style.userSelect = 'none';
        });
      }
    }, 0);

    return region;
  }, []);

  /**
   * Update sync data and recreate word regions
   */
  const updateSentenceWithWords = useCallback((sentenceId, start, end, text = '', shouldCreateWords = null) => {
    // Update sentence
    setSyncData(prev => ({
      ...prev,
      sentences: {
        ...prev.sentences,
        [sentenceId]: {
          id: sentenceId, // CRITICAL: Ensure id is stored in the data object
          start,
          end,
          text,
          pageNumber: currentPageNumber,
          status: 'SYNCED' // CRITICAL: Mark as synced when manually synced
        }
      }
    }));

    // Auto-propagate word timings ONLY if:
    // 1. showWordTrack is enabled AND
    // 2. granularity is "word" (user wants word-level syncs) OR shouldCreateWords is explicitly true
    // For manual sentence-level syncs, shouldCreateWords will be false/undefined, so words won't be created
    const shouldCreateWordTimings = (shouldCreateWords === true) ||
      (shouldCreateWords !== false && showWordTrack && granularity === 'word');

    if (shouldCreateWordTimings) {
      // CRITICAL FIX: Check if words for this sentence already exist and are synced
      // Only preserve words if they are from manual section boundaries (authoritative Aeneas results)
      // Allow overwriting words from TTS or proportional calculation when user manually syncs
      const existingWords = Object.entries(syncData.words || {})
        .filter(([id, data]) => data.parentId === sentenceId && data.status === 'SYNCED');

      // Check if any existing words are from manual section boundaries (check backend notes via syncData)
      // For now, if words exist and are synced, preserve them to avoid overwriting manual boundaries
      // User can still manually tap-to-sync individual words if needed
      const hasSyncedWords = existingWords.length > 0;

      // Only recalculate word timings if no synced words exist for this sentence
      // This preserves manual word timings from manual section boundaries
      // Note: Tap-to-sync on sentence will update sentence timing but preserve existing word timings
      if (!hasSyncedWords) {
        const words = calculateWordTimings(sentenceId, start, end);

        // Remove old word regions for this sentence
        // CRITICAL FIX: Find words by parentId match, not by ID prefix
        if (regionsPluginRef.current) {
          const regions = regionsPluginRef.current.getRegions();
          regions.forEach(r => {
            // Check if this region is a word whose parent matches sentenceId
            if (r.id.includes('_w')) {
              const wordData = syncData.words[r.id];
              if (wordData && wordData.parentId === sentenceId) {
                r.remove();
              }
            }
          });
        }

        // Create new word regions
        const wordData = {};
        words.forEach(word => {
          createRegion(word.id, word.start, word.end, 'word');
          wordData[word.id] = { ...word, pageNumber: currentPageNumber, status: 'SYNCED' };
        });

        setSyncData(prev => ({
          ...prev,
          words: {
            ...prev.words,
            ...wordData
          }
        }));
      } else {
        console.log(`[updateSentenceWithWords] Preserving ${existingWords.length} existing synced word timings for sentence ${sentenceId} (manual timings)`);
      }
    } else {
      // Remove any existing word regions for this sentence if we're not creating words
      if (regionsPluginRef.current) {
        const regions = regionsPluginRef.current.getRegions();
        regions.forEach(r => {
          if (r.id.includes('_w')) {
            const wordData = syncData.words[r.id];
            if (wordData && wordData.parentId === sentenceId) {
              r.remove();
            }
          }
        });
      }

      // Remove word data from syncData
      setSyncData(prev => {
        const newWords = { ...prev.words };
        Object.keys(newWords).forEach(wordId => {
          if (newWords[wordId]?.parentId === sentenceId) {
            delete newWords[wordId];
          }
        });
        return {
          ...prev,
          words: newWords
        };
      });
    }
  }, [calculateWordTimings, createRegion, currentSectionIndex, showWordTrack, granularity, syncData.words]);

  /**
   * Handle region update (drag/resize)
   */
  const handleRegionUpdate = useCallback((region) => {
    // Skip if we're programmatically playing a segment to prevent infinite loops
    if (isProgrammaticPlayRef.current) {
      return;
    }

    const { id } = region;
    // CRITICAL: Coerce to number and validate - prevent NaN from being stored
    let start = Number(region.start);
    let end = Number(region.end);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      console.warn('[RegionUpdate] Invalid region times, skipping update:', { id, start, end });
      return;
    }

    // Apply snap to silence (only if values stay valid)
    if (snapToSilence) {
      const snappedStart = findNearestSilence(start);
      const snappedEnd = findNearestSilence(end);
      if (!Number.isNaN(snappedStart) && !Number.isNaN(snappedEnd) && snappedEnd > snappedStart) {
        start = snappedStart;
        end = snappedEnd;
        region.setOptions({ start, end });
      }
    }

    if (id.includes('_w')) {
      // WORD: Constrain within parent sentence (use only valid parent times)
      const wordData = syncData.words[id];
      if (wordData && wordData.parentId) {
        const parent = Object.values(syncData.sentences).find(s => s.id === wordData.parentId);
        if (parent != null) {
          const parentStart = Number(parent.start);
          const parentEnd = Number(parent.end);
          if (!Number.isNaN(parentStart) && !Number.isNaN(parentEnd)) {
            start = Math.max(start, parentStart);
            end = Math.min(end, parentEnd);
            if (end <= start) {
              console.warn('[RegionUpdate] Word region would be invalid after parent constraint, skipping');
              return;
            }
            region.setOptions({ start, end });
          }
        }
      }

      setSyncData(prev => ({
        ...prev,
        words: {
          ...prev.words,
          [id]: { ...prev.words[id], start, end }
        }
      }));
    } else {
      // SENTENCE: Update and re-propagate words only if granularity is "word"
      updateSentenceWithWords(id, start, end, syncData.sentences[id]?.text || '', granularity === 'word');
    }

    highlightElement(id);
  }, [findNearestSilence, highlightElement, snapToSilence, syncData.sentences, syncData.words, updateSentenceWithWords, granularity]);

  /**
   * Handle region drag (scrubbing)
   */
  const handleRegionDrag = useCallback((region) => {
    // CRITICAL: During full audio playback (main play button), completely skip this handler
    // This prevents any region-related interference with main playback
    // Full audio playback = not recording, not playing a segment, and no segment ID ref
    // Check BOTH refs and state to be absolutely sure
    const isFullAudioPlayback = !isProgrammaticPlayRef.current &&
      !isRecordingRef.current &&
      !playingSegmentIdRef.current &&
      !playingSegmentId; // Also check state for extra safety

    if (isFullAudioPlayback) {
      // During full audio playback, only update highlight - don't scrub or interfere
      // This is the most important safeguard - completely prevent any interference
      highlightElement(region.id);
      setActiveRegionId(region.id);
      return; // Early return to prevent any other logic
    }

    // Skip if we're programmatically playing a segment to prevent infinite loops
    if (isProgrammaticPlayRef.current) {
      return;
    }

    // Skip if we're already scrubbing to prevent infinite loops
    if (isScrubbingRef.current) {
      return;
    }

    // Only scrub if scrubOnDrag is enabled and we're not in full audio playback
    if (scrubOnDrag) {
      // Only scrub if user is actively interacting, not during full audio playback
      scrubAudio(region.start, 0.08);
    }
    highlightElement(region.id);
    setActiveRegionId(region.id);
  }, [highlightElement, scrubAudio, scrubOnDrag, playingSegmentId]);

  /**
   * Initialize WaveSurfer
   */
  useEffect(() => {
    if (!waveformRef.current || !audioUrl) {
      // No audio for this page/section — reset state and tear down any existing instance
      setIsReady(false);
      if (wavesurferRef.current) {
        try {
          wavesurferRef.current.destroy();
        } catch (err) {
          console.warn('[SyncStudio] Error destroying WaveSurfer (no audio):', err?.message);
        }
        wavesurferRef.current = null;
      }
      return;
    }

    // Reset ready state when loading new audio
    setIsReady(false);

    // Destroy existing instance
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.destroy();
      } catch (err) {
        // Ignore errors during cleanup
        console.warn('[SyncStudio] Error destroying WaveSurfer:', err.message);
      }
    }

    // Create regions plugin
    regionsPluginRef.current = RegionsPlugin.create();

    // Create wavesurfer instance
    wavesurferRef.current = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#4a5568',
      progressColor: '#4A7B54',
      cursorColor: '#ffd43b',
      cursorWidth: 2,
      height: 180,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      responsive: true,
      normalize: true,
      plugins: [
        regionsPluginRef.current,
        TimelinePlugin.create({
          container: '#timeline',
          primaryLabelInterval: 5,
          secondaryLabelInterval: 1,
          style: {
            fontSize: '11px',
            color: '#888'
          }
        })
      ]
    });

    // Load audio
    wavesurferRef.current.load(audioUrl);

    // Apply playback speed
    if (wavesurferRef.current.getMediaElement) {
      const mediaElement = wavesurferRef.current.getMediaElement();
      if (mediaElement) {
        mediaElement.playbackRate = playbackSpeed;
      }
    }

    // Event handlers
    wavesurferRef.current.on('ready', () => {
      try {
        const duration = wavesurferRef.current.getDuration();
        if (duration && duration > 0) {
          setDuration(duration);
          setIsReady(true);
          console.log('[WaveSurfer] Ready');

          // Ensure regions plugin is properly initialized
          if (regionsPluginRef.current) {
            // Verify regions plugin is working
            console.log('[WaveSurfer] Regions plugin ready, regions can be created');
          }

          // Recreate any pending regions after audio reload
          if (pendingRegionUpdatesRef.current.size > 0 && regionsPluginRef.current) {
            pendingRegionUpdatesRef.current.forEach((regionData, segmentId) => {
              try {
                const existingRegion = regionsPluginRef.current.getRegions().find(r => r.id === segmentId);
                if (existingRegion) {
                  // Update existing region
                  existingRegion.setOptions({
                    start: regionData.start,
                    end: regionData.end,
                    drag: true,
                    resize: true
                  });
                } else {
                  // Create new region
                  createRegion(segmentId, regionData.start, regionData.end, 'sentence');
                }
                console.log(`[Region] Recreated region for segment ${segmentId} after audio reload`);
              } catch (err) {
                console.error(`[Region] Error recreating region for ${segmentId}:`, err);
              }
            });
            // Clear pending updates
            pendingRegionUpdatesRef.current.clear();
          }
        }
      } catch (err) {
        console.error('[WaveSurfer] Error in ready handler:', err);
        setIsReady(false);
      }
    });

    // Handle errors
    wavesurferRef.current.on('error', (error) => {
      const msg = String(error?.message || error || '');
      const isAbort =
        error?.name === 'AbortError' || /signal is aborted/i.test(msg) || /aborted/i.test(msg);

      // Expected when cleanup destroys the current instance while an async load is in-flight.
      if (waveSurferDestroyingRef.current && isAbort) {
        return;
      }

      console.error('[WaveSurfer] Error:', error);
      setIsReady(false);
    });

    wavesurferRef.current.on('play', () => {
      // Speech recognition is handled in the diagnostic modal
    });

    wavesurferRef.current.on('pause', () => {
      // Stop speech recognition when playback pauses
      if (recognitionRef.current) {
        stopSpeechRecognition();
      }
    });

    wavesurferRef.current.on('audioprocess', (time) => {
      // Guard: instance may have been destroyed (e.g. switched to section with no audio)
      if (!wavesurferRef.current) return;
      setCurrentTime(time);

      // CRITICAL FIX: Don't stop playback at region boundaries when in recording mode
      // This allows users to sync blocks that come after already-synced regions
      if (isRecordingRef.current) {
        // When recording, completely skip all programmatic play stopping logic
        // Let audio play continuously so users can sync blocks that come after synced regions
        // Just continue to region highlighting below
      } else {
        // CRITICAL: Only process segment stopping logic if we're explicitly playing a segment
        // If isProgrammaticPlayRef is false, skip ALL segment-related checks to allow full audio playback
        if (!isProgrammaticPlayRef.current) {
          // Not playing a segment - skip ALL segment stopping logic completely
          // This ensures main play button (full audio) is never interrupted
          // Continue to region highlighting below - do NOT process any segment logic
          // Early return to ensure no segment logic runs - this is the key fix
        } else {
          // Only enter this block if isProgrammaticPlayRef is TRUE
          // Normal playback mode: Stop playback if we've reached the end of the playing segment
          // CRITICAL: Only stop if BOTH isProgrammaticPlayRef AND playingSegmentIdRef are set
          const currentPlayingSegmentId = playingSegmentIdRef.current;
          if (currentPlayingSegmentId && wavesurferRef.current) {
            // Double-check: verify state matches ref (safety check)
            if (!playingSegmentId) {
              // State doesn't match ref - clear refs to prevent false stops
              console.warn('[Play] audioprocess: State mismatch detected. Clearing segment refs.');
              isProgrammaticPlayRef.current = false;
              playingSegmentIdRef.current = null;
              playingScriptSegmentIdRef.current = null;
              return;
            }

            // Check both syncData and audioScriptData
            const segmentData = syncDataRef.current.sentences[currentPlayingSegmentId] ||
              audioScriptDataRef.current.sentences[currentPlayingSegmentId];
            if (segmentData && segmentData.start !== undefined && segmentData.end !== undefined) {
              // Stop when we reach or exceed the end time (with small buffer to account for timing precision)
              if (time >= segmentData.end - 0.01) {
                console.log(`[Play] audioprocess: Reached end time for segment ${currentPlayingSegmentId}: ${segmentData.end.toFixed(3)}s (current: ${time.toFixed(3)}s)`);
                isProgrammaticPlayRef.current = false;
                wavesurferRef.current.pause();
                // Ensure we're exactly at the end time
                wavesurferRef.current.setTime(segmentData.end);
                setPlayingSegmentId(null);
                setPlayingScriptSegmentId(null);
                playingSegmentIdRef.current = null;
                playingScriptSegmentIdRef.current = null;
                return; // Exit early to prevent other handlers from running
              }
              // Also prevent playback if we somehow went before the start
              // BUT only if we're actually programmatically playing this specific segment
              // This prevents interference with full audio playback
              // CRITICAL: Only do this if we're explicitly playing this segment (not full audio)
              else if (time < segmentData.start && isProgrammaticPlayRef.current && playingSegmentId === currentPlayingSegmentId && playingSegmentIdRef.current === currentPlayingSegmentId) {
                // Only seek to start if we're actually playing this specific segment
                wavesurferRef.current.setTime(segmentData.start);
              }
            } else {
              console.warn(`[Play] Segment ${currentPlayingSegmentId} missing start/end data:`, segmentData);
            }
          }

          // Also check script segment playback - ensure we only play within the segment bounds
          // Only check if we're still in programmatic play mode
          const currentPlayingScriptSegmentId = playingScriptSegmentIdRef.current;
          if (currentPlayingScriptSegmentId && wavesurferRef.current) {
            const scriptSegmentData = audioScriptDataRef.current.sentences[currentPlayingScriptSegmentId];
            if (scriptSegmentData && scriptSegmentData.start !== undefined && scriptSegmentData.end !== undefined) {
              // Stop when we reach or exceed the end time
              if (time >= scriptSegmentData.end) {
                console.log('[Script Play] Reached end time, stopping at:', scriptSegmentData.end.toFixed(3), 'current time:', time.toFixed(3));
                isProgrammaticPlayRef.current = false;
                wavesurferRef.current.pause();
                // Ensure we're exactly at the end time
                wavesurferRef.current.setTime(scriptSegmentData.end);
                setPlayingScriptSegmentId(null);
                playingScriptSegmentIdRef.current = null;
                return; // Exit early to prevent other handlers
              }
              // Prevent playback if we somehow went before the start
              // BUT only if we're actually programmatically playing this specific segment
              // CRITICAL: Only do this if we're explicitly playing this segment (not full audio)
              else if (time < scriptSegmentData.start && isProgrammaticPlayRef.current && playingScriptSegmentId === currentPlayingScriptSegmentId && playingScriptSegmentIdRef.current === currentPlayingScriptSegmentId) {
                // Only seek to start if we're actually playing this specific segment
                console.log('[Script Play] Time before start, resetting to:', scriptSegmentData.start.toFixed(3), 'current time:', time.toFixed(3));
                wavesurferRef.current.setTime(scriptSegmentData.start);
              }
            }
          }
        }
      }

      // Find and highlight active region (only if not programmatically playing a segment)
      if (!isProgrammaticPlayRef.current && regionsPluginRef.current) {
        const regions = regionsPluginRef.current.getRegions();
        // Find all regions that contain the current time
        const activeRegions = regions.filter(r => time >= r.start && time < r.end);
        
        // If multiple regions overlap, choose the one that started most recently (highest start time)
        // This handles cases where regions overlap slightly due to alignment inaccuracies
        const active = activeRegions.length > 0
          ? activeRegions.reduce((latest, current) => 
              current.start > latest.start ? current : latest
            )
          : null;
        
        if (active) {
          // Always update highlight even if activeRegionId hasn't changed (in case DOM was re-rendered)
          if (active.id !== activeRegionId) {
            setActiveRegionId(active.id);
          }
          highlightElement(active.id);
        } else if (activeRegionId) {
          // Clear highlight if no active region
          setActiveRegionId(null);
          highlightElement(null);
        }
      }
    });

    wavesurferRef.current.on('play', () => setIsPlaying(true));
    wavesurferRef.current.on('pause', () => {
      setIsPlaying(false);
      // Clear playing segment if paused
      setPlayingSegmentId(null);
      setPlayingScriptSegmentId(null);
      playingScriptSegmentIdRef.current = null;
      isProgrammaticPlayRef.current = false;
    });
    wavesurferRef.current.on('finish', () => {
      setIsPlaying(false);
      setPlayingSegmentId(null);
      setPlayingScriptSegmentId(null);
      playingScriptSegmentIdRef.current = null;
      isProgrammaticPlayRef.current = false;
    });

    // Additional check using timeupdate for more reliable stopping
    // Only stops playback if we're explicitly playing a segment (not full audio)
    const checkSegmentEnd = () => {
      // CRITICAL: Early exit if not in programmatic play mode
      // This is the most important check - must be first
      if (!isProgrammaticPlayRef.current) {
        // Not playing a segment - definitely skip
        return;
      }

      // CRITICAL: Only check segment end if BOTH flags are set
      // This ensures full audio playback (main play button) is not interrupted
      // Double-check both the ref and the state to be absolutely sure
      if (!wavesurferRef.current || !isReady) {
        return;
      }

      const currentPlayingSegmentId = playingSegmentIdRef.current;
      // Must have a specific segment ID - if null, we're playing full audio
      // Also verify that playingSegmentId state is set (double-check)
      if (!currentPlayingSegmentId || !playingSegmentId) {
        // If refs don't match state, clear everything to be safe
        if (currentPlayingSegmentId && !playingSegmentId) {
          console.warn('[Play] Mismatch: ref has segment but state does not. Clearing refs.');
          isProgrammaticPlayRef.current = false;
          playingSegmentIdRef.current = null;
          playingScriptSegmentIdRef.current = null;
        }
        return;
      }

      const segmentData = syncDataRef.current.sentences[currentPlayingSegmentId] ||
        audioScriptDataRef.current.sentences[currentPlayingSegmentId];

      if (segmentData && segmentData.start !== undefined && segmentData.end !== undefined) {
        const currentTime = wavesurferRef.current.getCurrentTime();

        // Stop when we reach or exceed the end time (with small buffer to account for timing)
        if (currentTime >= segmentData.end - 0.01) {
          console.log(`[Play] Timeupdate check: Reached end time for segment ${currentPlayingSegmentId}: ${segmentData.end.toFixed(3)}s (current: ${currentTime.toFixed(3)}s)`);
          isProgrammaticPlayRef.current = false;
          wavesurferRef.current.pause();
          wavesurferRef.current.setTime(segmentData.end);
          setPlayingSegmentId(null);
          setPlayingScriptSegmentId(null);
          playingSegmentIdRef.current = null;
          playingScriptSegmentIdRef.current = null;
        }
      }
    };

    // Check segment end periodically when playing
    // CRITICAL: Only check if we're explicitly playing a segment (not full audio)
    segmentEndIntervalRef.current = setInterval(() => {
      // CRITICAL: Use refs, not state, to avoid stale closure issues
      // Must have BOTH isProgrammaticPlayRef AND playingSegmentIdRef set
      // This ensures the interval doesn't interfere with main play button

      // Early exit if not in programmatic play mode - this is the most important check
      if (!isProgrammaticPlayRef.current) {
        // Not playing a segment - definitely skip
        return;
      }

      if (wavesurferRef.current && playingSegmentIdRef.current) {
        // Double-check state matches ref (safety check)
        if (!playingSegmentId) {
          // State doesn't match - clear refs and skip
          console.warn('[Play] Interval: State mismatch. Clearing refs.');
          isProgrammaticPlayRef.current = false;
          playingSegmentIdRef.current = null;
          playingScriptSegmentIdRef.current = null;
          return;
        }
        // Check if actually playing by checking WaveSurfer's internal state
        const mediaElement = wavesurferRef.current.getMediaElement();
        const isActuallyPlaying = mediaElement && !mediaElement.paused;
        if (isActuallyPlaying) {
          checkSegmentEnd();
        }
      }
    }, 50); // Check every 50ms for responsive stopping

    // Region events
    regionsPluginRef.current.on('region-updated', handleRegionUpdate);
    regionsPluginRef.current.on('region-update-ended', handleRegionUpdate); // Also handle when drag/resize ends
    regionsPluginRef.current.on('region-in', handleRegionDrag);
    regionsPluginRef.current.on('region-clicked', (region, e) => {
      // Skip if we're programmatically playing a segment to prevent infinite loops
      if (isProgrammaticPlayRef.current) {
        return;
      }
      // Guard: WaveSurfer may have been destroyed (e.g. switched to section with no audio)
      if (!wavesurferRef.current) return;

      e.stopPropagation();
      setActiveRegionId(region.id);
      highlightElement(region.id);
      wavesurferRef.current.setTime(region.start);
    });

    // Ensure regions are interactive after creation
    regionsPluginRef.current.on('region-created', (region) => {
      // Make sure the region element is interactive
      if (region.element) {
        region.element.style.pointerEvents = 'auto';
        region.element.style.cursor = 'move';
        // Ensure resize handles are visible and interactive
        const resizeHandles = region.element.querySelectorAll('.wavesurfer-handle');
        resizeHandles.forEach(handle => {
          handle.style.pointerEvents = 'auto';
          handle.style.cursor = 'ew-resize';
        });
      }
    });

    return () => {
      // Clear interval on cleanup
      if (segmentEndIntervalRef.current) {
        clearInterval(segmentEndIntervalRef.current);
        segmentEndIntervalRef.current = null;
      }

      if (wavesurferRef.current) {
        try {
          setIsReady(false);
          waveSurferDestroyingRef.current = true;
          wavesurferRef.current.destroy();
        } catch (err) {
          console.warn('[SyncStudio] Error during WaveSurfer cleanup:', err?.message);
        }
        wavesurferRef.current = null;
        waveSurferDestroyingRef.current = false;
      }
    };
  }, [audioUrl, handleRegionUpdate, handleRegionDrag, highlightElement]);

  /**
   * Update zoom level
   */
  useEffect(() => {
    if (wavesurferRef.current && isReady) {
      try {
        // Check if audio is actually loaded before zooming
        const duration = wavesurferRef.current.getDuration();
        if (duration && duration > 0) {
          wavesurferRef.current.zoom(zoom);
        }
      } catch (err) {
        // Audio not loaded yet, skip zoom
        console.warn('[SyncStudio] Cannot zoom: audio not loaded yet', err.message);
      }
    }
  }, [zoom, isReady]);

  /**
   * Update playback speed
   */
  useEffect(() => {
    if (wavesurferRef.current && isReady) {
      try {
        const mediaElement = wavesurferRef.current.getMediaElement();
        if (mediaElement) {
          mediaElement.playbackRate = playbackSpeed;
        }
      } catch (err) {
        // Audio not loaded yet, skip playback speed update
        console.warn('[SyncStudio] Cannot set playback speed: audio not loaded yet', err.message);
      }
    }
  }, [playbackSpeed, isReady]);

  /**
   * Light reflow hints for classic reflowable EPUB HTML only.
   * Do NOT mutate EPUB Image Editor pages: they use `.page` + position:absolute; forcing
   * maxWidth/height on every node breaks the same layout you see in the Image Editor.
   */
  useEffect(() => {
    if (!viewerRef.current || !xhtmlContent) return;
    const root = viewerRef.current;
    if (root.querySelector('.page')) {
      return;
    }
    const allElements = root.querySelectorAll('*');
    allElements.forEach((el) => {
      let pos = '';
      try {
        pos = window.getComputedStyle(el).position;
      } catch (_) {
        return;
      }
      if (pos === 'absolute' || pos === 'fixed') return;

      el.style.wordWrap = 'break-word';
      el.style.overflowWrap = 'break-word';
      el.style.maxWidth = '100%';
      el.style.boxSizing = 'border-box';

      if (el.tagName === 'TABLE') {
        el.style.tableLayout = 'auto';
        el.style.width = '100%';
      }

      if (el.tagName === 'IMG') {
        el.style.maxWidth = '100%';
        el.style.height = 'auto';
      }
    });
  }, [xhtmlContent, leftPanelWidth]);

  /**
   * Simplified tap-to-sync: Two spacebar presses (start and end)
   * First press: Record start time
   * Second press: Record end time and sync the block
   */
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Only handle spacebar when in recording mode
      if (e.code !== 'Space' || !isRecording) return;

      // Prevent default scrolling behavior
      e.preventDefault();

      // Check if a block is selected
      if (!selectedBlockForSync) {
        console.warn(`[TapSync] No block selected. Please click on a text block first.`);
        return;
      }

      const currentTime = wavesurferRef.current?.getCurrentTime() || 0;

      // First tap: Record start time
      if (tapSyncStartTimeRef.current === null) {
        tapSyncStartTimeRef.current = currentTime;
        console.log(`[TapSync] Start time recorded: ${currentTime.toFixed(3)}s`);
        return;
      }

      // Second tap: Record end time and sync
      const startTime = tapSyncStartTimeRef.current;
      const endTime = currentTime;

      // Validate timing
      if (endTime <= startTime) {
        console.warn(`[TapSync] End time (${endTime.toFixed(3)}s) must be after start time (${startTime.toFixed(3)}s). Resetting.`);
        tapSyncStartTimeRef.current = null;
        return;
      }

      // Minimum duration check (0.1 seconds)
      const duration = endTime - startTime;
      if (duration < 0.1) {
        console.warn(`[TapSync] Duration too short (${(duration * 1000).toFixed(0)}ms). Minimum: 100ms. Resetting.`);
        tapSyncStartTimeRef.current = null;
        return;
      }

      // Find the selected element
      const element = parsedElements.find(el => el.id === selectedBlockForSync);

      if (!element) {
        console.error(`[TapSync] ERROR: Selected block ${selectedBlockForSync} not found in parsedElements`);
        tapSyncStartTimeRef.current = null;
        return;
      }

      // Validate element has an ID
      if (!element.id) {
        console.error(`[TapSync] ERROR: Element has no ID!`, element);
        tapSyncStartTimeRef.current = null;
        return;
      }

      // CRITICAL: Validate that the selected block matches the current granularity
      const allParsedIds = parsedElements.map((el) => el.id);
      if (!parsedElementMatchesGranularityExport(granularity, element, allParsedIds)) {
        const elementType = inferSyncElementTypeFromId(element.id, element.type);
        console.warn(`[TapSync] Block ${element.id} is ${elementType} level, but granularity is ${granularity}. Cannot sync.`);
        tapSyncStartTimeRef.current = null;
        setSelectedBlockForSync(null);
        return;
      }

      // Check if element is on current page
      const pageMatch = element.id.match(/page(\d+)/);
      const elementPageNum = pageMatch ? parseInt(pageMatch[1], 10) : null;
      const isOnCurrentPage =
        elementPageNum === currentPageNumber ||
        element.sectionIndex === currentSectionIndex ||
        (element.pageNumber != null && element.pageNumber === currentPageNumber);

      if (!isOnCurrentPage) {
        console.warn(`[TapSync] Selected block is not on current page. Selected: ${selectedBlockForSync}, Current page: ${currentPageNumber}`);
        tapSyncStartTimeRef.current = null;
        return;
      }

      // Apply snap to silence
      const snappedStart = findNearestSilence(startTime);
      const snappedEnd = findNearestSilence(endTime);

      console.log(`[TapSync] Syncing selected element:`, {
        id: element.id,
        text: element.text?.substring(0, 50),
        type: element.type,
        startTime: snappedStart.toFixed(3),
        endTime: snappedEnd.toFixed(3),
        duration: (duration * 1000).toFixed(0) + 'ms'
      });

      // CRITICAL FIX: Handle word-level syncs differently from sentence-level syncs
      // If syncing a word directly, update words directly without creating sentence timings
      const isWordLevel = elementType === 'word' || element.id.includes('_w');

      if (isWordLevel) {
        // For word-level manual sync: directly update the word in syncData.words
        createRegion(element.id, snappedStart, snappedEnd, 'word');
        setSyncData(prev => {
          const nextSentences = { ...prev.sentences };
          // Remove this word id from sentences if it was wrongly stored there (prevents duplicate row)
          if (nextSentences[element.id]) delete nextSentences[element.id];
          return {
            ...prev,
            sentences: nextSentences,
            words: {
              ...prev.words,
              [element.id]: {
                id: element.id,
                parentId: element.id.replace(/_w\d+$/, ''), // Extract parent sentence ID
                start: snappedStart,
                end: snappedEnd,
                text: element.text || '',
                pageNumber: currentPageNumber,
                status: 'SYNCED'
              }
            }
          };
        });
        console.log(`[TapSync] ✓ Word-level sync: ${element.id} (${snappedStart.toFixed(3)}s - ${snappedEnd.toFixed(3)}s)`);
      } else {
        // For sentence/paragraph-level sync: use updateSentenceWithWords
        createRegion(element.id, snappedStart, snappedEnd, 'sentence');
        // For manual syncs, only create word timings if granularity is "word"
        // Pass false to prevent word creation for sentence-level manual syncs
        updateSentenceWithWords(element.id, snappedStart, snappedEnd, element.text, granularity === 'word');
        console.log(`[TapSync] ✓ Sentence-level sync: ${element.id} (${snappedStart.toFixed(3)}s - ${snappedEnd.toFixed(3)}s)`);
      }

      console.log(`[TapSync] ✓ Page ${currentPageNumber} - ${element.id}: ${snappedStart.toFixed(3)}s - ${snappedEnd.toFixed(3)}s`);

      // Reset for next sync
      tapSyncStartTimeRef.current = null;
      setSelectedBlockForSync(null);
      lastSyncTimeRef.current = Date.now();
    };

    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [isRecording, selectedBlockForSync, parsedElements, currentSectionIndex, createRegion, findNearestSilence, updateSentenceWithWords]);

  /**
   * Load EPUB content and voices
   */
  useEffect(() => {
    const loadContent = async () => {
      try {
        setLoading(true);
        setError('');

        // Load voices
        const voicesData = await audioSyncService.getAvailableVoices();
        setVoices(voicesData);

        // Check if Aeneas is available
        try {
          const aeneasStatus = await audioSyncService.checkAeneas();
          setAeneasAvailable(aeneasStatus.installed);
          console.log('[SyncStudio] Aeneas status:', aeneasStatus);
        } catch (aeneasErr) {
          console.warn('[SyncStudio] Could not check Aeneas:', aeneasErr);
          setAeneasAvailable(false);
        }

        // Load job info
        const jobData = await conversionService.getConversionJob(parseInt(jobId));
        if (jobData?.pdfDocumentId) {
          setPdfId(jobData.pdfDocumentId);
        }

        // Try Reflowable Sync Studio API first (same shape as FXL Sync Studio)
        let sectionsData = null;
        let syncStudioPayload = null;
        try {
          const syncStudioRes = await audioSyncService.getSyncStudio(parseInt(jobId));
          if (syncStudioRes?.sections?.length > 0) {
            sectionsData = syncStudioRes.sections;
            syncStudioPayload = syncStudioRes;
            console.log('[SyncStudio] Using Sync Studio API: sections', sectionsData.length, 'alignment', syncStudioRes.alignment?.length ?? 0);
          }
        } catch (e) {
          console.warn('[SyncStudio] Sync Studio API not used:', e?.message);
        }
        if (!sectionsData) {
          sectionsData = await conversionService.getEpubSections(parseInt(jobId));
        }

        if (sectionsData && sectionsData.length > 0) {
          // Convert relative image paths to absolute URLs for browser preview
          const baseURL = api.defaults.baseURL || 'http://localhost:8081/api';
          const processedSections = sectionsData.map((section, idx) => {
            let processedXhtml = section.xhtml || section.content || '';

            // Pattern: src="images/filename.ext" or src="../images/filename.ext" -> absolute URL
            const relativeImagePattern1 = /src=["']images\/([^"']+)["']/gi;
            const relativeImagePattern2 = /src=["']\.\.\/images\/([^"']+)["']/gi;

            processedXhtml = processedXhtml.replace(relativeImagePattern1, (match, fileName) => {
              const absoluteUrl = withAuthImageQuery(
                `${baseURL}/conversions/${jobId}/images/${fileName}`
              );
              console.log('[SyncStudio] Converting image path (images/):', match, '->', absoluteUrl);
              return `src="${absoluteUrl}"`;
            });

            processedXhtml = processedXhtml.replace(relativeImagePattern2, (match, fileName) => {
              const absoluteUrl = withAuthImageQuery(
                `${baseURL}/conversions/${jobId}/images/${fileName}`
              );
              console.log('[SyncStudio] Converting image path (../images/):', match, '->', absoluteUrl);
              return `src="${absoluteUrl}"`;
            });

            // Extract page number from ID or href (e.g., "page-1" or "OEBPS/page_4.xhtml")
            let sectionPageNumber = idx + 1;
            const pageMatch = (section.id || '').match(/page-?(\d+)/i) ||
              (section.href || '').match(/page_?(\d+)/i);
            if (pageMatch) {
              sectionPageNumber = parseInt(pageMatch[1]);
            }

            return {
              ...section,
              xhtml: processedXhtml,
              pageNumber: sectionPageNumber
            };
          });

          setSections(processedSections);
          setXhtmlContent(xhtmlFragmentForDivViewer(processedSections[0]?.xhtml || ''));

          // Parse elements from all sections (use processed sections with absolute URLs)
          const allElements = [];
          processedSections.forEach((section, idx) => {
            const elements = parseXhtmlElements(section.xhtml, idx, section.pageNumber);
            console.log(`[SyncStudio] Parsed ${elements.length} elements from section ${idx + 1} (Page ${section.pageNumber || idx + 1}):`,
              elements.map(el => ({ id: el.id, type: el.type, text: el.text?.substring(0, 30) }))
            );
            allElements.push(...elements);
          });
          console.log(`[SyncStudio] Total parsed elements: ${allElements.length}`);
          setParsedElements(allElements);

          // Use Sync Studio API audio + alignment when available (match FXL flow)
          console.log('[SyncStudio] 🔍 syncStudioPayload:', syncStudioPayload);
          console.log('[SyncStudio] 🔍 readingOrder in payload:', syncStudioPayload?.readingOrder);
          
          if (syncStudioPayload?.audioUrl) {
            setAudioUrl(audioSyncService.getJobAudioUrl(jobId));
            setDuration(Number(syncStudioPayload.audioDuration) || 0);
            setAudioSource(syncStudioPayload.audioSource ?? null);
          }

          // Load per-section audio metadata from backend.
          // Backend field is `perSectionAudioUrls` (index -> /api/audio-sync/job/:jobId/audio/section/:idx).
          const payloadSectionAudioUrls =
            syncStudioPayload?.perSectionAudioUrls || syncStudioPayload?.perSectionAudio;
          if (
            payloadSectionAudioUrls &&
            typeof payloadSectionAudioUrls === 'object' &&
            Object.keys(payloadSectionAudioUrls).length > 0
          ) {
            const base = api.defaults.baseURL || '';
            const baseHasApiPrefix = /\/api\/?$/.test(base);
            const backendOrigin = base.replace(/\/api\/?$/, '');
            const normalized = {};
            Object.entries(payloadSectionAudioUrls).forEach(([idxRaw, relOrAbsUrl]) => {
              const idx = Number(idxRaw);
              if (!Number.isFinite(idx)) return;
              const rawUrl = String(relOrAbsUrl || '').trim();
              if (!rawUrl) return;
              let resolvedUrl = rawUrl;
              if (!/^https?:\/\//i.test(resolvedUrl)) {
                if (resolvedUrl.startsWith('/api/')) {
                  // Backend may be mounted at root (localhost dev) or behind /api (prod proxy).
                  // Keep /api only when base URL itself includes /api.
                  resolvedUrl = baseHasApiPrefix
                    ? `${backendOrigin}${resolvedUrl}`
                    : `${backendOrigin}${resolvedUrl.slice(4)}`;
                } else if (resolvedUrl.startsWith('/')) {
                  resolvedUrl = `${backendOrigin}${resolvedUrl}`;
                } else {
                  resolvedUrl = `${backendOrigin}/${resolvedUrl}`;
                }
              }
              normalized[idx] = {
                url: withAuthImageQuery(resolvedUrl),
                fileName: `section_audio_${idx}.mp3`,
                source: 'uploaded'
              };
            });
            setPerSectionAudioFiles(normalized);
            setPerSectionMode(true);
            console.log('[SyncStudio] Loaded per-section audio URLs:', normalized);
          } else {
            // Check individually which sections have audio (graceful background check)
            const detected = {};
            await Promise.all(processedSections.map(async (_, idx) => {
              try {
                const url = audioSyncService.getSectionAudioUrl(jobId, idx);
                const resp = await fetch(url, { method: 'HEAD' });
                if (resp.ok) {
                  detected[idx] = { url, fileName: `section_audio_${idx}`, source: 'uploaded' };
                }
              } catch (_) { }
            }));
            if (Object.keys(detected).length > 0) {
              setPerSectionAudioFiles(detected);
              setPerSectionMode(true);
              console.log(`[SyncStudio] Auto-detected ${Object.keys(detected).length} per-section audio files`);
              // Switch waveform to current section's audio, or clear if this section has none
              const currentSectionAudio = detected[currentSectionIndex];
              if (currentSectionAudio?.url) {
                setAudioUrl(currentSectionAudio.url);
                setAudioSource(currentSectionAudio.source || 'uploaded');
                console.log(`[SyncStudio] Per-section mode: switched waveform to section ${currentSectionIndex} audio`);
              } else {
                // Current section has no per-section audio — clear waveform
                setAudioUrl(null);
                setAudioSource(null);
                setDuration(0);
                if (wavesurferRef.current) {
                  wavesurferRef.current.destroy();
                  wavesurferRef.current = null;
                }
                console.log(`[SyncStudio] Per-section mode: section ${currentSectionIndex} has no audio, cleared waveform`);
              }
            }
          }
          
          // Load per-page reading orders from backend
          if (syncStudioPayload?.readingOrderByPage && typeof syncStudioPayload.readingOrderByPage === 'object') {
            const pageCount = Object.keys(syncStudioPayload.readingOrderByPage).length;
            const totalItems = Object.values(syncStudioPayload.readingOrderByPage).reduce((sum, arr) => sum + arr.length, 0);
            console.log(`[SyncStudio] 📋 Loaded per-page reading orders: ${pageCount} pages, ${totalItems} total items`);
            setReadingOrderByPage(syncStudioPayload.readingOrderByPage);
          } else {
            console.log(`[SyncStudio] ⚠️ No per-page reading orders found in payload`);
          }
          
          
          if (syncStudioPayload?.alignment?.length > 0) {
            const sentences = {};
            const words = {};
            // CRITICAL FIX: Load words FIRST, then sentences, to ensure manual boundaries word timings are preserved
            // This prevents any code from recalculating words from sentences later
            (syncStudioPayload.alignment || []).forEach(seg => {
              const el = allElements.find(e => e.id === seg.id);
              // Use element's page/section when available so chapter3_h1_s1 and chapter4_h1_s1 don't both get page 1
              const pageNum = el ? (el.pageNumber ?? (el.sectionIndex + 1)) : (() => {
                const id = String(seg.id || '');
                const pageMatch = id.match(/page(\d+)/i) || id.match(/chapter\d+_page(\d+)/i);
                return pageMatch ? parseInt(pageMatch[1], 10) : 1;
              })();
              const text = (el?.text || '').trim();
              if (String(seg.id).includes('_w')) {
                const parentId = seg.id.replace(/_w\d+$/, '');
                // CRITICAL: Preserve word timings from backend - these are authoritative
                words[seg.id] = { id: seg.id, parentId, start: seg.startTime, end: seg.endTime, text, pageNumber: pageNum, status: 'SYNCED' };
              } else {
                sentences[seg.id] = { id: seg.id, start: seg.startTime, end: seg.endTime, text, pageNumber: pageNum, status: 'SYNCED' };
              }
            });

            // CRITICAL DEBUG: Log manual boundaries words to detect if they're being loaded correctly
            const manualBoundariesWords = Object.values(words).filter(w => {
              // Check if this word's parent sentence exists and might cause recalculation
              const parentSentence = sentences[w.parentId];
              return parentSentence && parentSentence.start !== undefined && parentSentence.end !== undefined;
            });
            if (manualBoundariesWords.length > 0) {
              console.log(`[Load] Found ${manualBoundariesWords.length} words with parent sentences. Sample:`,
                manualBoundariesWords.slice(0, 3).map(w => ({
                  id: w.id,
                  wordTime: `${w.start.toFixed(3)}s-${w.end.toFixed(3)}s`,
                  parentId: w.parentId,
                  parentTime: sentences[w.parentId] ? `${sentences[w.parentId].start.toFixed(3)}s-${sentences[w.parentId].end.toFixed(3)}s` : 'N/A'
                }))
              );
            }
            allElements.forEach(el => {
              if (sentences[el.id] || words[el.id]) return;
              // Use element's pageNumber (from parseXhtmlElements: page from ID or section)
              const pageNum = el.pageNumber ?? (el.sectionIndex + 1);
              if (el.id.includes('_w')) {
                const parentId = el.id.replace(/_w\d+$/, '');
                words[el.id] = { id: el.id, parentId, start: undefined, end: undefined, text: el.text || '', pageNumber: pageNum, status: 'UNSYNCED' };
              } else {
                sentences[el.id] = { id: el.id, start: undefined, end: undefined, text: el.text || '', pageNumber: pageNum, status: 'UNSYNCED' };
              }
            });
            setSyncData({ sentences, words });
          } else {
            // Fallback: check for existing audio syncs from DB
            try {
              const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
              if (audioData && audioData.length > 0) {
                if (audioData[0]?.audioFilePath) {
                  setAudioUrl(audioSyncService.getAudioUrl(audioData[0].id));
                }

                // Build a map of ID -> pageNumber from XHTML sections (use processed sections)
                const idToPageMap = {};
                processedSections.forEach((section, idx) => {
                  const pageNum = section.pageNumber || idx + 1;
                  const xhtml = section.xhtml || section.content || '';
                  // Extract all IDs from this section
                  const idMatches = xhtml.matchAll(/id=["']([^"']+)["']/g);
                  for (const match of idMatches) {
                    idToPageMap[match[1]] = pageNum;
                  }
                });

                console.log('[Load] Built ID to page map with', Object.keys(idToPageMap).length, 'entries');

                // Load existing sync data
                // CRITICAL FIX: Use original XHTML ID as key (not unique DB key)
                // This ensures consistency with createRegion, handleRegionUpdate, etc.
                const sentences = {};
                const words = {};
                // CRITICAL DEBUG: Track manual boundaries words to detect shifts
                const manualBoundariesWordsFromDB = [];

                audioData.forEach(sync => {
                  const blockId = sync.block_id || sync.blockId;
                  if (blockId) {
                    // Use database page_number as it's the authoritative source
                    const pageNumber = sync.page_number || sync.pageNumber || 1;

                    // CRITICAL FIX: Use original XHTML ID as key for consistency
                    // This matches how Magic Sync stores data
                    const key = blockId;

                    // Preserve status from backend (SKIPPED or SYNCED)
                    // Check notes field for "SKIPPED" or "Magic Sync" to determine status
                    const status = sync.notes?.includes('SKIPPED') || sync.status === 'SKIPPED' ? 'SKIPPED' : 'SYNCED';

                    // CRITICAL DEBUG: Track manual boundaries words
                    const isManualBoundaries = sync.notes?.includes('manual section boundaries');
                    const isWord = blockId.includes('_w');
                    if (isManualBoundaries && isWord) {
                      manualBoundariesWordsFromDB.push({
                        id: blockId,
                        start: Number(sync.start_time || sync.startTime || 0),
                        end: Number(sync.end_time || sync.endTime || 0),
                        notes: sync.notes
                      });
                    }

                    if (blockId.includes('_w')) {
                      const parentId = blockId.replace(/_w\d+$/, '');
                      words[key] = {
                        id: blockId, // Original XHTML ID for SMIL reference
                        parentId: parentId,
                        start: sync.start_time || sync.startTime || 0,
                        end: sync.end_time || sync.endTime || 0,
                        text: sync.custom_text || sync.customText || '',
                        pageNumber: pageNumber,
                        status: status
                      };
                    } else {
                      sentences[key] = {
                        id: blockId, // CRITICAL: Ensure id is stored in the data object
                        start: Number(sync.start_time || sync.startTime || 0),
                        end: Number(sync.end_time || sync.endTime || 0),
                        text: sync.custom_text || sync.customText || '',
                        pageNumber: pageNumber,
                        status: status
                      };
                    }
                  }
                });

                // CRITICAL DEBUG: Log manual boundaries words loaded from DB
                if (manualBoundariesWordsFromDB.length > 0) {
                  console.log(`[Load DB] Found ${manualBoundariesWordsFromDB.length} manual boundaries words in database. Sample timings:`,
                    manualBoundariesWordsFromDB.slice(0, 5).map(w => ({
                      id: w.id,
                      start: w.start.toFixed(3),
                      end: w.end.toFixed(3),
                      notes: w.notes?.substring(0, 50)
                    }))
                  );
                }

                console.log('[Load] Page distribution:', {
                  page1: Object.values(sentences).filter(s => s.pageNumber === 1).length,
                  page2: Object.values(sentences).filter(s => s.pageNumber === 2).length,
                  page3: Object.values(sentences).filter(s => s.pageNumber === 3).length,
                  samplePageNumbers: Object.values(sentences).slice(0, 5).map(s => s.pageNumber)
                });

                console.log('[Load] Loaded syncs:', {
                  sentences: Object.keys(sentences).length,
                  words: Object.keys(words).length,
                  page1Sentences: Object.values(sentences).filter(s => s.pageNumber === 1).length,
                  page2Sentences: Object.values(sentences).filter(s => s.pageNumber === 2).length
                });

                // Merge with all parsedElements to ensure all blocks are visible
                // Add all elements (sentences, paragraphs, and words) that aren't already in syncData
                let mergedCount = 0;
                allElements.forEach(element => {
                  // Skip if already in syncData (check both sentences and words)
                  if (sentences[element.id] || words[element.id]) return;

                  // Extract page number from ID (e.g., "page6_p1_s1" -> 6 or "chapter1_page6_p1_s1" -> 6)
                  // This is the most reliable method since IDs contain the page number
                  const pageMatch = element.id.match(/page(\d+)/i);
                  let pageNum = 1;
                  if (pageMatch) {
                    pageNum = parseInt(pageMatch[1]);
                  } else if (element.pageNumber) {
                    pageNum = element.pageNumber;
                  } else if (element.sectionIndex !== undefined) {
                    pageNum = element.sectionIndex + 1;
                  }

                  // CRITICAL FIX: Add words to words object, not sentences
                  const isWord = element.type === 'word' || element.id.includes('_w');
                  if (isWord) {
                    const parentId = element.parentId || element.id.replace(/_w\d+$/, '');
                    words[element.id] = {
                      id: element.id,
                      parentId,
                      start: undefined,
                      end: undefined,
                      text: element.text || '',
                      pageNumber: pageNum,
                      status: 'UNSYNCED'
                    };
                  } else {
                    sentences[element.id] = {
                      id: element.id,
                      start: undefined,
                      end: undefined,
                      text: element.text || '',
                      pageNumber: pageNum,
                      status: 'UNSYNCED' // Mark as unsynced by default
                    };
                  }
                  mergedCount++;
                });

                console.log(`[Load] After merging parsedElements: ${Object.keys(sentences).length} sentences, ${Object.keys(words).length} words (added ${mergedCount} unsynced blocks)`);
                console.log(`[Load] Page distribution after merge:`, {
                  page1: { sentences: Object.values(sentences).filter(s => s.pageNumber === 1).length, words: Object.values(words).filter(w => w.pageNumber === 1).length },
                  page2: { sentences: Object.values(sentences).filter(s => s.pageNumber === 2).length, words: Object.values(words).filter(w => w.pageNumber === 2).length },
                  page6: { sentences: Object.values(sentences).filter(s => s.pageNumber === 6).length, words: Object.values(words).filter(w => w.pageNumber === 6).length }
                });
                setSyncData({ sentences, words });
              } else {
                // No existing sync data, initialize with all parsedElements (including words)
                const sentences = {};
                const words = {};

                allElements.forEach(element => {
                  // Extract page number from ID (e.g., "page6_p1_s1" -> 6 or "chapter1_page6_p1_s1" -> 6)
                  const pageMatch = element.id.match(/page(\d+)/i);
                  let pageNum = 1;
                  if (pageMatch) {
                    pageNum = parseInt(pageMatch[1]);
                  } else if (element.pageNumber) {
                    pageNum = element.pageNumber;
                  } else if (element.sectionIndex !== undefined) {
                    pageNum = element.sectionIndex + 1;
                  }

                  // CRITICAL FIX: Add words to words object, not sentences
                  const isWord = element.type === 'word' || element.id.includes('_w');
                  if (isWord) {
                    const parentId = element.parentId || element.id.replace(/_w\d+$/, '');
                    words[element.id] = {
                      id: element.id,
                      parentId,
                      start: undefined,
                      end: undefined,
                      text: element.text || '',
                      pageNumber: pageNum,
                      status: 'UNSYNCED'
                    };
                  } else {
                    sentences[element.id] = {
                      id: element.id,
                      start: undefined,
                      end: undefined,
                      text: element.text || '',
                      pageNumber: pageNum,
                      status: 'UNSYNCED'
                    };
                  }
                });

                console.log(`[Load] Initialized with ${Object.keys(sentences).length} sentences, ${Object.keys(words).length} words (unsynced)`);
                console.log(`[Load] Page distribution:`, {
                  page1: { sentences: Object.values(sentences).filter(s => s.pageNumber === 1).length, words: Object.values(words).filter(w => w.pageNumber === 1).length },
                  page6: { sentences: Object.values(sentences).filter(s => s.pageNumber === 6).length, words: Object.values(words).filter(w => w.pageNumber === 6).length }
                });
                setSyncData({ sentences, words });
              }
            } catch (audioErr) {
              console.warn('No existing audio:', audioErr);
              // Initialize with all parsedElements (including words) if no audio data
              const sentences = {};
              const words = {};

              allElements.forEach(element => {
                // Extract page number from ID (e.g., "page6_p1_s1" -> 6)
                const pageMatch = element.id.match(/page(\d+)/);
                let pageNum = 1;
                if (pageMatch) {
                  pageNum = parseInt(pageMatch[1]);
                } else if (element.sectionIndex !== undefined) {
                  pageNum = element.sectionIndex + 1;
                } else if (element.pageNumber) {
                  pageNum = element.pageNumber;
                }

                // CRITICAL FIX: Add words to words object, not sentences
                const isWord = element.type === 'word' || element.id.includes('_w');
                if (isWord) {
                  const parentId = element.parentId || element.id.replace(/_w\d+$/, '');
                  words[element.id] = {
                    id: element.id,
                    parentId,
                    start: undefined,
                    end: undefined,
                    text: element.text || '',
                    pageNumber: pageNum,
                    status: 'UNSYNCED'
                  };
                } else {
                  sentences[element.id] = {
                    id: element.id,
                    start: undefined,
                    end: undefined,
                    text: element.text || '',
                    pageNumber: pageNum,
                    status: 'UNSYNCED'
                  };
                }
              });

              console.log(`[Load] Initialized with ${Object.keys(sentences).length} sentences, ${Object.keys(words).length} words (no audio data)`);
              console.log(`[Load] Page distribution:`, {
                page1: { sentences: Object.values(sentences).filter(s => s.pageNumber === 1).length, words: Object.values(words).filter(w => w.pageNumber === 1).length },
                page6: { sentences: Object.values(sentences).filter(s => s.pageNumber === 6).length, words: Object.values(words).filter(w => w.pageNumber === 6).length },
                page8: Object.values(sentences).filter(s => s.pageNumber === 8).length
              });
              setSyncData({ sentences, words });
            }
          }
        } else {
          // No sections loaded, initialize with empty objects
          setSyncData({ sentences: {}, words: {} });
        }
      } catch (err) {
        console.error('Error loading content:', err);
        setError('Failed to load content: ' + err.message);
        setSyncData({ sentences: {}, words: {} });
      } finally {
        setLoading(false);
      }
    };

    if (jobId) {
      loadContent();
    }
  }, [jobId, parseXhtmlElements]);

  /**
   * Backup: Initialize syncData with all text blocks from parsedElements
   * This runs as a safety net in case elements weren't added during loadContent
   * Only adds blocks that aren't already in syncData
   */
  useEffect(() => {
    if (parsedElements.length === 0) return;

    setSyncData(prev => {
      // Check if we already have blocks - if so, don't overwrite
      const hasBlocks = Object.keys(prev.sentences).length > 0;
      if (hasBlocks) {
        // Just merge in any missing blocks
        const newSentences = { ...prev.sentences };
        let addedCount = 0;

        parsedElements.forEach(element => {
          if (newSentences[element.id]) return;

          const pageMatch = element.id.match(/page(\d+)/);
          let pageNum = 1;
          if (pageMatch) {
            pageNum = parseInt(pageMatch[1]);
          } else if (element.sectionIndex !== undefined) {
            pageNum = element.sectionIndex + 1;
          } else if (element.pageNumber) {
            pageNum = element.pageNumber;
          }

          newSentences[element.id] = {
            id: element.id,
            start: undefined,
            end: undefined,
            text: element.text || '',
            pageNumber: pageNum,
            status: 'UNSYNCED'
          };
          addedCount++;
        });

        if (addedCount > 0) {
          console.log(`[SyncStudio] Backup: Added ${addedCount} missing text blocks to syncData`);
          return { sentences: newSentences, words: prev.words };
        }
      } else {
        // No blocks yet, initialize with all parsedElements
        const sentences = {};
        const words = {};

        parsedElements.forEach(element => {
          const pageMatch = element.id.match(/page(\d+)/);
          let pageNum = 1;
          if (pageMatch) {
            pageNum = parseInt(pageMatch[1]);
          } else if (element.sectionIndex !== undefined) {
            pageNum = element.sectionIndex + 1;
          } else if (element.pageNumber) {
            pageNum = element.pageNumber;
          }

          sentences[element.id] = {
            id: element.id,
            start: undefined,
            end: undefined,
            text: element.text || '',
            pageNumber: pageNum,
            status: 'UNSYNCED'
          };
        });

        console.log(`[SyncStudio] Backup: Initialized syncData with ${Object.keys(sentences).length} text blocks`);
        return { sentences, words };
      }

      return prev;
    });
  }, [parsedElements]);

  /**
   * Recreate regions when sync data changes (on load)
   */
  useEffect(() => {
    // Only run when we have audio and WaveSurfer is initialized (avoids using plugin after teardown)
    if (!audioUrl || !isReady || !wavesurferRef.current || !regionsPluginRef.current) return;

    // Clear existing regions
    regionsPluginRef.current.clearRegions();

    // Create sentence regions
    // CRITICAL FIX: Skip SKIPPED blocks (they don't have timestamps and shouldn't create regions)
    // IMPORTANT: Sort by start time to ensure regions are created in audio playback order
    const sentenceEntries = Object.entries(syncData.sentences)
      .filter(([key, data]) => {
        // Skip if status is SKIPPED or if timestamps are invalid
        if (data.status === 'SKIPPED') return false;
        if (!(data.start >= 0 && data.end > data.start)) return false;
        // In per-section mode, only draw regions for the current section to avoid overlap
        if (currentSectionElementIds !== null) {
          const id = data.id || key;
          return currentSectionElementIds.has(id);
        }
        return true;
      })
      .sort((a, b) => {
        // Sort by start time (audio playback order)
        const startA = Number(a[1].start || 0);
        const startB = Number(b[1].start || 0);
        return startA - startB;
      });
    
    console.log(`[CreateRegions] Creating ${sentenceEntries.length} sentence regions in audio timing order`);
    if (sentenceEntries.length > 0) {
      console.log(`[CreateRegions] First 5 regions:`, sentenceEntries.slice(0, 5).map(([key, data]) => ({
        id: data.id || key,
        start: data.start?.toFixed(2),
        end: data.end?.toFixed(2)
      })));
    }
    
    sentenceEntries.forEach(([key, data]) => {
      const region = createRegion(data.id || key, data.start, data.end, 'sentence');
      // Ensure region is interactive after creation
      if (region) {
        setTimeout(() => {
          if (region.element) {
            region.element.style.pointerEvents = 'auto';
            region.element.style.cursor = 'move';
          }
        }, 10);
      }
    });

    // Create word regions
    // CRITICAL FIX: Skip SKIPPED blocks and sort by start time
    if (showWordTrack) {
      const wordEntries = Object.entries(syncData.words)
        .filter(([key, data]) => {
          if (data.status === 'SKIPPED') return false;
          if (!(data.start >= 0 && data.end > data.start)) return false;
          // In per-section mode, only draw word regions for the current section
          if (currentSectionElementIds !== null) {
            const parentId = data.parentId || (key.includes('_w') ? key.replace(/_w\d+$/, '') : key);
            return currentSectionElementIds.has(parentId) || currentSectionElementIds.has(data.id || key);
          }
          return true;
        })
        .sort((a, b) => {
          const startA = Number(a[1].start || 0);
          const startB = Number(b[1].start || 0);
          return startA - startB;
        });
      
      wordEntries.forEach(([key, data]) => {
        const region = createRegion(data.id || key, data.start, data.end, 'word');
        // Ensure region is interactive after creation
        if (region) {
          setTimeout(() => {
            if (region.element) {
              region.element.style.pointerEvents = 'auto';
              region.element.style.cursor = 'move';
            }
          }, 10);
        }
      });
    }
  }, [isReady, syncData, createRegion, showWordTrack, currentSectionElementIds]);

  /**
   * Handle audio file upload — upload to server immediately so it is not overridden by TTS.
   */
  const handleAudioUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('audio/')) return;
    setAudioFile(file);
    const blobUrl = URL.createObjectURL(file);
    setAudioUrl(blobUrl);
    setIsReady(false);
    // Upload to server so uploaded_audio_<jobId>.mp3 exists and takes precedence over TTS
    if (jobId && pdfId) {
      try {
        await audioSyncService.uploadAudioFile(parseInt(jobId), file);
        // Use job audio URL so playback and reload use server file (uploaded takes precedence)
        setAudioUrl(audioSyncService.getJobAudioUrl(jobId));
        setAudioSource('uploaded');
        setSuccess('Audio uploaded. It will not be overridden by TTS.');
        setTimeout(() => setSuccess(''), 3000);
      } catch (err) {
        setError('Upload failed: ' + (err?.response?.data?.error || err?.message || 'Unknown error'));
      }
    }
  };

  /**
   * Upload an audio file for a specific section (per-section audio mode).
   * Called from the Manual Section Boundaries modal audio column.
   */
  const handleSectionAudioUpload = async (sectionIndex, file) => {
    if (!file || !file.type.startsWith('audio/')) return;
    const blobUrl = URL.createObjectURL(file);
    // Optimistically set in local state (so modal waveform preview works instantly)
    setPerSectionAudioFiles(prev => ({
      ...prev,
      [sectionIndex]: { url: blobUrl, fileName: file.name, source: 'uploaded' }
    }));
    // Also update the boundary entry
    setManualSectionBoundaries(prev =>
      prev.map(b => b.sectionIndex === sectionIndex ? { ...b, audioFile: file, audioUrl: blobUrl, audioFileName: file.name } : b)
    );
    // Upload to server
    try {
      await audioSyncService.uploadSectionAudio(parseInt(jobId), sectionIndex, file);
      const serverUrl = audioSyncService.getSectionAudioUrl(jobId, sectionIndex);
      setPerSectionAudioFiles(prev => ({
        ...prev,
        [sectionIndex]: { url: serverUrl, fileName: file.name, source: 'uploaded' }
      }));
      setManualSectionBoundaries(prev =>
        prev.map(b => b.sectionIndex === sectionIndex ? { ...b, audioUrl: serverUrl, audioFileName: file.name } : b)
      );
      // If this is the current section and we're in per-section mode, switch waveform
      if (perSectionMode && sectionIndex === currentSectionIndex) {
        setAudioUrl(serverUrl);
        setAudioSource('uploaded');
      }
    } catch (err) {
      setError(`Section ${sectionIndex} audio upload failed: ` + (err?.response?.data?.error || err?.message || 'Unknown error'));
    }
  };

  /**
   * Generate TTS audio for a specific section in per-section mode.
   */
  const handleGenerateSectionAudio = async (sectionIndex) => {
    if (!pdfId) { setError('PDF ID not found'); return; }
    const section = sections[sectionIndex];
    if (!section) return;

    try {
      setGenerating(true);
      setError('');
      const level = granularity || 'sentence';
      const sectionElements = parsedElements.filter(el => el.sectionIndex === sectionIndex);
      const allParsedIds = parsedElements.map((e) => e.id);
      const matchedElements = sectionElements.filter((el) =>
        parsedElementMatchesGranularityExport(level, el, allParsedIds)
      );

      // Respect the reading order for this section: check section-scoped order first,
      // then fall back to live sortedIds if this is the currently active section.
      const sectionPageNum = sections[sectionIndex]?.pageNumber || (sectionIndex + 1);
      const sectionOrderKey = `section:${sectionIndex}`;
      const savedOrderForSection = readingOrderByPage[sectionOrderKey]
        || readingOrderByPage[String(sectionPageNum)]
        || [];
      const elMap = new Map(matchedElements.map(el => [el.id, el]));
      let orderedElements;
      if (savedOrderForSection.length > 0) {
        const inOrder = savedOrderForSection.filter(id => elMap.has(id)).map(id => elMap.get(id));
        const remaining = matchedElements.filter(el => !new Set(savedOrderForSection).has(el.id));
        orderedElements = [...inOrder, ...remaining];
        console.log(`[GenerateSectionTTS] Using saved reading order for ${sectionOrderKey} (${inOrder.length} ordered + ${remaining.length} remaining)`);
      } else if (sectionIndex === currentSectionIndex && sortedIds.length > 0) {
        const sortedSet = new Set(sortedIds);
        const inOrder = sortedIds.filter(id => elMap.has(id)).map(id => elMap.get(id));
        const remaining = matchedElements.filter(el => !sortedSet.has(el.id));
        orderedElements = [...inOrder, ...remaining];
        console.log(`[GenerateSectionTTS] Using live sortedIds for current section ${sectionIndex}`);
      } else {
        orderedElements = matchedElements;
        console.log(`[GenerateSectionTTS] Using default parsedElements order for section ${sectionIndex}`);
      }

      const seenIds = new Set();
      const textBlocks = orderedElements
        .filter(el => { const id = (el.id || '').trim(); if (!id || seenIds.has(id)) return false; seenIds.add(id); return true; })
        .map(el => ({ id: el.id, pageNumber: el.pageNumber, text: el.text }));
      if (textBlocks.length === 0) {
        setError(`No ${level}-level blocks found in section ${sectionIndex + 1}`);
        return;
      }
      const segments = await audioSyncService.generateSectionAudio(
        pdfId, parseInt(jobId), sectionIndex, selectedVoice, textBlocks, level, ttsSpeakingRate
      );
      await new Promise(resolve => setTimeout(resolve, 500));
      const serverUrl = appendQueryParams(audioSyncService.getSectionAudioUrl(jobId, sectionIndex), {
        t: Date.now()
      });
      setPerSectionAudioFiles(prev => ({
        ...prev,
        [sectionIndex]: { url: serverUrl, fileName: `tts_section_${sectionIndex}.mp3`, source: 'tts' }
      }));
      setManualSectionBoundaries(prev =>
        prev.map(b => b.sectionIndex === sectionIndex ? { ...b, audioUrl: serverUrl, audioFileName: `TTS Section ${sectionIndex + 1}` } : b)
      );
      // Switch waveform to this section's audio if it's the currently viewed section
      if (sectionIndex === currentSectionIndex) {
        setAudioUrl(serverUrl);
        setAudioSource('tts');
        setIsReady(false);
        if (wavesurferRef.current) { wavesurferRef.current.destroy(); wavesurferRef.current = null; }
      }
      if (segments && segments.length > 0) {
        setSyncData(prev => {
          const nextSentences = { ...prev.sentences };
          const nextWords = { ...prev.words };
          segments.forEach(seg => {
            const id = seg.blockId || seg.block_id || seg.id;
            const pageNum = seg.pageNumber || seg.page_number || 1;
            const start = Number(seg.startTime ?? seg.start_time ?? 0);
            const end = Number(seg.endTime ?? seg.end_time ?? 0);
            const text = seg.customText ?? seg.custom_text ?? seg.text ?? '';
            if (id.includes('_w')) {
              nextWords[id] = { id, parentId: id.replace(/_w\d+$/, ''), start, end, text, pageNumber: pageNum, status: 'SYNCED' };
            } else {
              nextSentences[id] = { id, start, end, text, pageNumber: pageNum, status: 'SYNCED' };
            }
          });
          return { sentences: nextSentences, words: nextWords };
        });
      }
      setSuccess(`TTS generated for section ${sectionIndex + 1}: ${segments?.length ?? 0} segments.`);
      setTimeout(() => setSuccess(''), 6000);
    } catch (err) {
      setError(`Section ${sectionIndex + 1} TTS failed: ` + err.message);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Generate TTS audio (same as Kitaboo: based on Export Level / granularity).
   * Word = one TTS segment per word; Sentence = per sentence; Paragraph = per paragraph.
   */
  const handleGenerateAudio = async () => {
    if (!pdfId) {
      setError('PDF ID not found');
      return;
    }

    try {
      setGenerating(true);
      setError('');

      const level = granularity || 'sentence';
      const unspokenPatterns = [
        /toc/i, /table-of-contents/i, /contents/i,
        /chapter-index/i, /chapter-idx/i,
        /^nav/i, /^header/i, /^footer/i, /^sidebar/i, /^menu/i,
        /page-number/i, /page-num/i, /^skip/i, /^metadata/i
      ];

      const allParsedIds = parsedElements.map((e) => e.id);

      const filtered = parsedElements.filter(el => {
        if (!parsedElementMatchesGranularityExport(level, el, allParsedIds)) return false;
        const id = el.id || '';
        const text = el.text || '';
        if (unspokenPatterns.some(p => p.test(id) || p.test(text))) {
          console.log(`[handleGenerateAudio] Excluding unspoken: ${id}`);
          return false;
        }
        return true;
      });
      
      // Build the ordered element list section-by-section (preserving section sequence),
      // applying each section's saved reading order (or live sortedIds for the active section).
      // This avoids the old bug where sortedIds put the active section first and left other
      // sections in parsedElements order appended at the end.
      console.log(`[handleGenerateAudio] 🔍 Building ordered elements section-by-section`);

      const bySectionIndex = new Map();
      filtered.forEach(el => {
        const idx = el.sectionIndex ?? 0;
        if (!bySectionIndex.has(idx)) bySectionIndex.set(idx, []);
        bySectionIndex.get(idx).push(el);
      });

      const orderedElements = [];
      const sectionIndices = [...bySectionIndex.keys()].sort((a, b) => a - b);
      for (const sIdx of sectionIndices) {
        const sectionEls = bySectionIndex.get(sIdx) || [];
        const sectionPageNum = sections[sIdx]?.pageNumber || (sIdx + 1);
        const sectionOrderKey = `section:${sIdx}`;
        const savedOrderForSection = readingOrderByPage[sectionOrderKey]
          || readingOrderByPage[String(sectionPageNum)]
          || [];
        const elMap = new Map(sectionEls.map(el => [el.id, el]));

        if (savedOrderForSection.length > 0) {
          const inOrder = savedOrderForSection.filter(id => elMap.has(id)).map(id => elMap.get(id));
          const remaining = sectionEls.filter(el => !new Set(savedOrderForSection).has(el.id));
          orderedElements.push(...inOrder, ...remaining);
          console.log(`[handleGenerateAudio] ${sectionOrderKey}: saved order (${inOrder.length} + ${remaining.length})`);
        } else if (sIdx === currentSectionIndex && sortedIds.length > 0) {
          const sortedSet = new Set(sortedIds);
          const inOrder = sortedIds.filter(id => elMap.has(id)).map(id => elMap.get(id));
          const remaining = sectionEls.filter(el => !sortedSet.has(el.id));
          orderedElements.push(...inOrder, ...remaining);
          console.log(`[handleGenerateAudio] Section ${sIdx}: live sortedIds (${inOrder.length} + ${remaining.length})`);
        } else {
          orderedElements.push(...sectionEls);
          console.log(`[handleGenerateAudio] Section ${sIdx}: default order (${sectionEls.length})`);
        }
      }

      console.log(`[handleGenerateAudio] ✅ Ordered ${orderedElements.length} elements across ${sectionIndices.length} sections`);
      console.log(`[handleGenerateAudio] ✅ First 5 ordered IDs:`, orderedElements.slice(0, 5).map(el => el.id));
      console.log(`[handleGenerateAudio] ✅ Last 5 ordered IDs:`, orderedElements.slice(-5).map(el => el.id));
      
      // Deduplicate by id (keep first occurrence = reading order) so TTS and sync don't create duplicate blocks/audio
      const seenIds = new Set();
      const textBlocks = orderedElements
        .filter(el => {
          const id = (el.id || '').trim();
          if (!id || seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        })
        .map(el => ({
          id: el.id,
          pageNumber: el.pageNumber,
          text: el.text
        }));

      if (textBlocks.length === 0) {
        setError(`No ${level}-level blocks found. Check Export Level (${level}) or add read-aloud content.`);
        setGenerating(false);
        return;
      }
      
      console.log(`[handleGenerateAudio] 📤 Sending ${textBlocks.length} text blocks to backend in sidebar order`);
      console.log(`[handleGenerateAudio] 📤 First 5 text block IDs:`, textBlocks.slice(0, 5).map(b => b.id));
      console.log(`[handleGenerateAudio] 📤 Last 5 text block IDs:`, textBlocks.slice(-5).map(b => b.id));

      const segments = await audioSyncService.generateAudio(
        pdfId,
        parseInt(jobId),
        selectedVoice,
        textBlocks,
        level,
        ttsSpeakingRate
      );

      console.log(`[handleGenerateAudio] ✅ TTS generation complete, received ${segments?.length || 0} segments`);
      
      // Small delay to ensure audio file is fully written to disk
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Force waveform to reload with new audio
      // Use aggressive cache-busting to ensure browser loads new audio file
      const newAudioUrl = appendQueryParams(audioSyncService.getJobAudioUrl(jobId), {
        t: Date.now(),
        regenerated: true
      });
      console.log(`[handleGenerateAudio] 🔄 Setting new audio URL with cache-buster: ${newAudioUrl}`);
      
      setAudioUrl(newAudioUrl);
      setAudioSource('tts');
      setIsReady(false);
      
      // Force waveform to reload by clearing and resetting
      if (wavesurferRef.current) {
        console.log(`[handleGenerateAudio] 🔄 Destroying existing waveform to force reload`);
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }

      // Merge new segments into syncData so regions and right panel update (Kitaboo-like)
      if (segments && segments.length > 0) {
        console.log(`[handleGenerateAudio] 📊 Received ${segments.length} segments from backend`);
        console.log(`[handleGenerateAudio] 📊 First segment:`, segments[0]);
        console.log(`[handleGenerateAudio] 📊 Last segment:`, segments[segments.length - 1]);
        
        setSyncData(prev => {
          const nextSentences = { ...prev.sentences };
          const nextWords = { ...prev.words };
          segments.forEach((seg, idx) => {
            const id = seg.blockId || seg.block_id || seg.id;
            const pageNum = seg.pageNumber || seg.page_number || 1;
            const start = Number(seg.startTime ?? seg.start_time ?? 0);
            const end = Number(seg.endTime ?? seg.end_time ?? 0);
            const text = seg.customText ?? seg.custom_text ?? seg.text ?? '';
            
            if (idx < 3 || idx >= segments.length - 3) {
              console.log(`[handleGenerateAudio] 📊 Segment ${idx}: ${id} (${start.toFixed(2)}s - ${end.toFixed(2)}s)`);
            }
            
            if (id.includes('_w')) {
              nextWords[id] = { id, parentId: id.replace(/_w\d+$/, ''), start, end, text, pageNumber: pageNum, status: 'SYNCED' };
            } else {
              nextSentences[id] = { id, start, end, text, pageNumber: pageNum, status: 'SYNCED' };
            }
          });
          return { sentences: nextSentences, words: nextWords };
        });
        // Regions will be drawn when waveform is ready (effect syncs syncData → regions)
      }

      const levelLabel = level === 'word' ? 'words' : level === 'paragraph' ? 'paragraphs' : 'sentences';
      setSuccess(`Generated TTS: ${segments?.length ?? 0} ${levelLabel}. Audio will play in sidebar order. For accurate text–audio sync, click "Run alignment (auto)" below, then Save.`);
      setTimeout(() => setSuccess(''), 10000);
    } catch (err) {
      setError('Failed to generate audio: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Start/stop recording mode
   * When starting Tap-to-Sync, ensure uploaded audio is used (not TTS)
   */
  const toggleRecording = async () => {
    if (isRecording) {
      setIsRecording(false);
      setSelectedBlockForSync(null); // Clear selection when stopping recording
      tapSyncStartTimeRef.current = null; // Reset tap sync state
      if (wavesurferRef.current) {
        wavesurferRef.current.pause();
      }
    } else {
      // When starting Tap-to-Sync:
      // - In per-section mode: load section-specific audio if available
      // - In global mode: ensure uploaded audio is used (not TTS)
      if (jobId) {
        if (perSectionMode) {
          // Per-section mode: use the current section's audio
          const sectionAudio = perSectionAudioFiles[currentSectionIndex];
          if (sectionAudio?.url) {
            setAudioUrl(sectionAudio.url);
            setAudioSource(sectionAudio.source || 'uploaded');
            console.log(`[Tap-to-Sync] Per-section mode: loaded section ${currentSectionIndex} audio`);
          } else {
            console.warn(`[Tap-to-Sync] Per-section mode: no audio for section ${currentSectionIndex}. Upload or generate TTS first.`);
            setError(`No audio for section ${currentSectionIndex + 1}. Upload or generate TTS first in Manual section boundaries.`);
            return;
          }
        } else {
          // Global mode: ensure uploaded audio is used (not TTS)
          try {
            const syncStudioData = await audioSyncService.getSyncStudio(parseInt(jobId));
            if (syncStudioData?.audioUrl && syncStudioData?.audioSource === 'uploaded') {
              setAudioUrl(audioSyncService.getJobAudioUrl(jobId));
              setAudioSource('uploaded');
              console.log('[Tap-to-Sync] Switched to uploaded audio');
            } else if (syncStudioData?.audioSource === 'tts') {
              console.warn('[Tap-to-Sync] No uploaded audio found. Tap-to-Sync will use TTS audio.');
            }
          } catch (err) {
            console.warn('[Tap-to-Sync] Could not check for uploaded audio:', err);
          }
        }
      }

      setIsRecording(true);
      setSelectedBlockForSync(null); // Clear any previous selection when starting
      tapSyncStartTimeRef.current = null; // Reset tap sync state
      setCurrentSentenceIndex(0);
      // CRITICAL: Clear all programmatic play flags when starting recording
      // This ensures audio won't stop at previous segment boundaries
      isProgrammaticPlayRef.current = false;
      setPlayingSegmentId(null);
      setPlayingScriptSegmentId(null);
      playingSegmentIdRef.current = null;
      playingScriptSegmentIdRef.current = null;
      // Wait a bit for waveform to reload if audio was switched, then play
      setTimeout(() => {
        if (wavesurferRef.current) {
          wavesurferRef.current.setTime(0);
          wavesurferRef.current.play();
        }
      }, 100);
    }
  };


  /** Open manual section boundaries modal; one row per logical page (reflowable: one section can contain multiple logical pages). */
  const openManualSectionBoundaries = () => {
    const pageToSectionMap = new Map(); // Map page number to section index
    const list = [];

    // First pass: collect pages from parsedElements
    parsedElements.forEach((el) => {
      const pageMatch = String(el.id || '').match(/page(\d+)/);
      const pageNum = el.pageNumber ?? (pageMatch ? parseInt(pageMatch[1], 10) : null);
      if (pageNum == null) return;

      const sectionIndex = el.sectionIndex ?? sections.findIndex(s => (s.pageNumber ?? 0) === pageNum);
      if (sectionIndex < 0) return;

      // Track section index for this page (use first valid one found)
      if (!pageToSectionMap.has(pageNum)) {
        pageToSectionMap.set(pageNum, sectionIndex);
      }
    });

    // Second pass: also check sections array for pages that might not have parsedElements yet
    // This ensures pages 24, 25, etc. are included even if they have no readable content
    sections.forEach((section, sectionIdx) => {
      // Check section.pageNumber
      if (section.pageNumber != null) {
        const pageNum = Number(section.pageNumber);
        if (!pageToSectionMap.has(pageNum)) {
          pageToSectionMap.set(pageNum, sectionIdx);
        }
      }

      // Also extract page numbers from XHTML content (e.g., id="page24_p1_s1")
      const xhtml = section.xhtml || section.content || '';
      const pageMatches = xhtml.matchAll(/page(\d+)[_\-]/gi);
      for (const match of pageMatches) {
        const pageNum = parseInt(match[1], 10);
        if (!isNaN(pageNum) && !pageToSectionMap.has(pageNum)) {
          // Find which section index this page belongs to
          const sectionIndex = sections.findIndex(s => {
            const sPageNum = s.pageNumber ?? (sections.indexOf(s) + 1);
            return sPageNum === pageNum;
          });
          pageToSectionMap.set(pageNum, sectionIndex >= 0 ? sectionIndex : sectionIdx);
        }
      }
    });

    // Third pass: detect gaps and fill in missing pages
    const sortedPages = Array.from(pageToSectionMap.keys()).sort((a, b) => a - b);
    const minPage = sortedPages.length > 0 ? Math.min(...sortedPages) : 1;
    const maxPage = sortedPages.length > 0 ? Math.max(...sortedPages) : 1;

    // Fill in gaps: if we have pages 23 and 26, include pages 24 and 25
    const allPages = new Set(sortedPages);
    for (let pageNum = minPage; pageNum <= maxPage; pageNum++) {
      if (!allPages.has(pageNum)) {
        // Find the closest section index (use the section of the previous page, or next page if no previous)
        let sectionIndex = 0;
        for (let prevPage = pageNum - 1; prevPage >= minPage; prevPage--) {
          if (pageToSectionMap.has(prevPage)) {
            sectionIndex = pageToSectionMap.get(prevPage);
            break;
          }
        }
        // If no previous page found, try next page
        if (!pageToSectionMap.has(pageNum - 1)) {
          for (let nextPage = pageNum + 1; nextPage <= maxPage; nextPage++) {
            if (pageToSectionMap.has(nextPage)) {
              sectionIndex = pageToSectionMap.get(nextPage);
              break;
            }
          }
        }
        pageToSectionMap.set(pageNum, sectionIndex);
      }
    }

    // Fourth pass: create one entry per unique page number (now including filled gaps)
    const finalSortedPages = Array.from(pageToSectionMap.keys()).sort((a, b) => a - b);
    finalSortedPages.forEach((pageNum) => {
      const sectionIndex = pageToSectionMap.get(pageNum);
      const segs = Object.entries(syncData.sentences || {})
        .filter(([, d]) => d.pageNumber === pageNum && d.start != null && d.end != null)
        .map(([, d]) => ({ start: d.start, end: d.end }));
      const fromWords = Object.entries(syncData.words || {})
        .filter(([, d]) => d.pageNumber === pageNum && d.start != null && d.end != null)
        .map(([, d]) => ({ start: d.start, end: d.end }));
      const all = [...segs, ...fromWords];
      let start = '';
      let end = '';
      if (all.length > 0) {
        const startSeconds = Math.min(...all.map(x => x.start));
        const endSeconds = Math.max(...all.map(x => x.end));
        start = formatTime(startSeconds);
        end = formatTime(endSeconds);
      }
      list.push({ sectionIndex, pageNumber: pageNum, start, end, label: `Page ${pageNum}` });
    });

    list.sort((a, b) => a.sectionIndex - b.sectionIndex || a.pageNumber - b.pageNumber);
    setManualSectionBoundaries(list);
    setShowManualSectionBoundaries(true);
  };

  /** Run alignment using the manual section boundaries from the modal (per logical page when pageNumber is set). */
  const handleRunAlignmentWithBoundaries = async () => {
    // In per-section audio mode, sections with audio files don't need start/end times
    if (perSectionMode) {
      const sectionRowsWithAudio = manualSectionBoundaries.filter(b =>
        b.audioFile || b.audioUrl || perSectionAudioFiles[b.sectionIndex]
      );
      if (sectionRowsWithAudio.length === 0) {
        setError('Please upload or generate TTS audio for at least one section before running alignment.');
        return;
      }
      // IMPORTANT: Modal uploads are section-level audio, not global/page slices.
      // Build one boundary per section to avoid accidental timeline mixing from page-level rows.
      const sectionIndices = Array.from(new Set(
        sectionRowsWithAudio
          .map(b => Number(b.sectionIndex))
          .filter(idx => Number.isInteger(idx) && idx >= 0)
      ));
      const valid = sectionIndices.map(sectionIndex => ({
        sectionIndex,
        pageNumber: undefined,
        start: 0,
        end: 0
      }));
      // Jump directly to alignment (skip classic validation)
      setShowManualSectionBoundaries(false);
      const hasPerSectionAudio = Object.keys(perSectionAudioFiles).length > 0 || manualSectionBoundaries.some(b => b.audioFile || b.audioUrl);
      if (!hasPerSectionAudio) { setError('Upload or generate audio for at least one section first'); return; }
      try {
        setAutoSyncing(true);
        setError('');
        setAutoSyncProgress(`Uploading section audio files and running alignment...`);
        const pendingUploads = manualSectionBoundaries.filter(b => b.audioFile && !b.audioUrl?.startsWith('http'));
        if (pendingUploads.length > 0) {
          setAutoSyncProgress(`Uploading ${pendingUploads.length} section audio files...`);
          await Promise.all(pendingUploads.map(b =>
            audioSyncService.uploadSectionAudio(parseInt(jobId), b.sectionIndex, b.audioFile)
              .catch(err => console.warn(`[Manual Boundaries] Section ${b.sectionIndex} upload failed:`, err.message))
          ));
        }
        const currentSidebarOrder = {};
        if (sortedIds && sortedIds.length > 0) {
          sortedIds.forEach(id => {
            const pageMatch = String(id).match(/page(\d+)/);
            const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : currentPageNumber;
            if (!currentSidebarOrder[pageNum]) currentSidebarOrder[pageNum] = [];
            currentSidebarOrder[pageNum].push(id);
          });
        }
        const result = await audioSyncService.alignSyncStudio(parseInt(jobId), {
          granularity: granularity || 'sentence', propagateWords: true,
          sectionBoundaries: valid, currentSidebarOrder, perSectionAudio: true
        });
        const segs = result?.segments || [];
        setAutoSyncProgress(`Aligned ${segs.length} segments`);
        const newSentences = {};
        const newWords = {};
        segs.forEach(seg => {
          const pageMatch = String(seg.id || '').match(/page(\d+)/);
          const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 1;
          const el = parsedElements.find(e => e.id === seg.id);
          const text = (el?.text || '').trim();
          if (String(seg.id).includes('_w')) {
            const parentId = seg.id.replace(/_w\d+$/, '');
            newWords[seg.id] = { id: seg.id, parentId, start: seg.startTime, end: seg.endTime, text, pageNumber: pageNum, status: 'SYNCED' };
          } else {
            newSentences[seg.id] = { id: seg.id, start: seg.startTime, end: seg.endTime, text, pageNumber: pageNum, status: 'SYNCED' };
          }
        });
        parsedElements.forEach(el => {
          if (newSentences[el.id] || newWords[el.id]) return;
          const pageMatch = String(el.id).match(/page(\d+)/);
          const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 1;
          if (el.id.includes('_w')) {
            newWords[el.id] = { id: el.id, parentId: el.id.replace(/_w\d+$/, ''), start: undefined, end: undefined, text: el.text || '', pageNumber: pageNum, status: 'UNSYNCED' };
          } else {
            newSentences[el.id] = { id: el.id, start: undefined, end: undefined, text: el.text || '', pageNumber: pageNum, status: 'UNSYNCED' };
          }
        });
        setSyncData({ sentences: newSentences, words: newWords });

        // Keep waveform/audio timeline consistent with the active section after per-section alignment.
        const activeSectionAudio = perSectionAudioFiles[currentSectionIndex];
        if (activeSectionAudio?.url) {
          setAudioUrl(activeSectionAudio.url);
          setAudioSource(activeSectionAudio.source || 'uploaded');
          setIsReady(false);
        }

        if (regionsPluginRef.current) {
          regionsPluginRef.current.clearRegions();
          Object.entries(newSentences).forEach(([id, data]) => {
            if (data.status === 'SKIPPED') return;
            if (data.start != null && data.end != null && data.end > data.start) createRegion(id, data.start, data.end, 'sentence');
          });
          if (showWordTrack) {
            Object.entries(newWords).forEach(([id, data]) => {
              if (data.start != null && data.end != null && data.end > data.start) createRegion(id, data.start, data.end, 'word');
            });
          }
        }
        setSuccess(`Alignment complete (per-section audio). ${segs.length} segments. Adjust if needed, then Save.`);
        setTimeout(() => setSuccess(''), 5000);
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Per-section alignment failed');
      } finally {
        setAutoSyncing(false);
        setAutoSyncProgress(null);
      }
      return; // Done for per-section mode
    }

    // Classic mode: validate start/end times
    const sectionsWithValues = manualSectionBoundaries.filter(b => {
      const hasStart = b.start && String(b.start).trim() !== '';
      const hasEnd = b.end && String(b.end).trim() !== '';
      return hasStart && hasEnd;
    });

    if (sectionsWithValues.length === 0) {
      setError('Please fill in start and end times (MM:SS.ms format, e.g., 0:01.52) for at least one section.');
      return;
    }

    const valid = sectionsWithValues
      .map((b, idx) => {
        // Parse MM:SS.ms format to seconds
        const startSeconds = parseTimeFormat(b.start);
        const endSeconds = parseTimeFormat(b.end);

        // Debug logging for troubleshooting
        if (startSeconds === null || endSeconds === null) {
          console.log(`[Manual Boundaries] Invalid times for ${b.label}: start="${b.start}" end="${b.end}"`);
        }

        if (startSeconds === null || endSeconds === null || isNaN(startSeconds) || isNaN(endSeconds)) {
          return null;
        }

        if (endSeconds <= startSeconds) {
          console.log(`[Manual Boundaries] End time must be greater than start time for ${b.label}: ${startSeconds} >= ${endSeconds}`);
          return null;
        }

        return {
          sectionIndex: b.sectionIndex,
          pageNumber: b.pageNumber != null ? Number(b.pageNumber) : undefined,
          start: startSeconds,
          end: endSeconds
        };
      })
      .filter(b => b !== null);

    if (valid.length === 0) {
      const invalidEntries = sectionsWithValues.filter(b => {
        const startSeconds = parseTimeFormat(b.start);
        const endSeconds = parseTimeFormat(b.end);
        return startSeconds === null || endSeconds === null || endSeconds <= startSeconds;
      });

      if (invalidEntries.length > 0) {
        const examples = invalidEntries.slice(0, 3).map(b => `${b.label} (start: "${b.start}", end: "${b.end}")`).join(', ');
        setError(`Invalid time format. Please use MM:SS.ms format (e.g., 0:01.52). Problematic entries: ${examples}${invalidEntries.length > 3 ? '...' : ''}`);
      } else {
        setError('Set at least one section with valid start and end times (MM:SS.ms format, e.g., 0:01.52).');
      }
      return;
    }
    setShowManualSectionBoundaries(false);
    // Check: in per-section mode boundaries without audio are invalid; in classic mode we need global audio
    const hasPerSectionAudio = Object.keys(perSectionAudioFiles).length > 0 || manualSectionBoundaries.some(b => b.audioFile || b.audioUrl);
    if (!perSectionMode && !audioUrl) {
      setError('Upload or generate audio first');
      return;
    }
    if (perSectionMode && !hasPerSectionAudio) {
      setError('Upload or generate audio for at least one section first');
      return;
    }
    try {
      setAutoSyncing(true);
      setError('');
      setAutoSyncProgress('Running alignment with section boundaries...');

      // Upload any pending per-section audio files that haven't been uploaded yet
      const pendingUploads = manualSectionBoundaries.filter(b => b.audioFile && !b.audioUrl?.startsWith('http'));
      if (pendingUploads.length > 0) {
        setAutoSyncProgress(`Uploading ${pendingUploads.length} section audio files...`);
        await Promise.all(pendingUploads.map(b =>
          audioSyncService.uploadSectionAudio(parseInt(jobId), b.sectionIndex, b.audioFile)
            .catch(err => console.warn(`[Manual Boundaries] Section ${b.sectionIndex} upload failed:`, err.message))
        ));
      }
      
      // Build current sidebar order
      const currentSidebarOrder = {};
      if (sortedIds && sortedIds.length > 0) {
        sortedIds.forEach(id => {
          const pageMatch = String(id).match(/page(\d+)/);
          const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : currentPageNumber;
          if (!currentSidebarOrder[pageNum]) currentSidebarOrder[pageNum] = [];
          currentSidebarOrder[pageNum].push(id);
        });
        console.log(`[Manual Boundaries] 📋 Passing current sidebar order (sortedIds) for ${Object.keys(currentSidebarOrder).length} pages`);
      }

      const alignOptions = {
        granularity: granularity || 'sentence',
        propagateWords: true,
        sectionBoundaries: valid,
        currentSidebarOrder,
        ...(perSectionMode ? { perSectionAudio: true } : {})
      };
      
      const result = await audioSyncService.alignSyncStudio(parseInt(jobId), alignOptions);
      const segs = result?.segments || [];
      setAutoSyncProgress(`Aligned ${segs.length} segments`);
      const newSentences = {};
      const newWords = {};
      segs.forEach(seg => {
        const pageMatch = String(seg.id || '').match(/page(\d+)/);
        const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 1;
        const el = parsedElements.find(e => e.id === seg.id);
        const text = (el?.text || '').trim();
        if (String(seg.id).includes('_w')) {
          const parentId = seg.id.replace(/_w\d+$/, '');
          newWords[seg.id] = { id: seg.id, parentId, start: seg.startTime, end: seg.endTime, text, pageNumber: pageNum, status: 'SYNCED' };
        } else {
          newSentences[seg.id] = { id: seg.id, start: seg.startTime, end: seg.endTime, text, pageNumber: pageNum, status: 'SYNCED' };
        }
      });
      parsedElements.forEach(el => {
        if (newSentences[el.id] || newWords[el.id]) return;
        const pageMatch = String(el.id).match(/page(\d+)/);
        const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 1;
        if (el.id.includes('_w')) {
          const parentId = el.id.replace(/_w\d+$/, '');
          newWords[el.id] = { id: el.id, parentId, start: undefined, end: undefined, text: el.text || '', pageNumber: pageNum, status: 'UNSYNCED' };
        } else {
          newSentences[el.id] = { id: el.id, start: undefined, end: undefined, text: el.text || '', pageNumber: pageNum, status: 'UNSYNCED' };
        }
      });
      setSyncData({ sentences: newSentences, words: newWords });
      if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();
        Object.entries(newSentences).forEach(([id, data]) => {
          if (data.status === 'SKIPPED') return;
          if (data.start != null && data.end != null && data.end > data.start) {
            createRegion(id, data.start, data.end, 'sentence');
          }
        });
        if (showWordTrack) {
          Object.entries(newWords).forEach(([id, data]) => {
            if (data.start != null && data.end != null && data.end > data.start) {
              createRegion(id, data.start, data.end, 'word');
            }
          });
        }
      }
      setSuccess(`Alignment complete (manual boundaries). ${segs.length} segments. Adjust if needed, then Save.`);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Alignment with boundaries failed');
    } finally {
      setAutoSyncing(false);
      setAutoSyncProgress(null);
    }
  };

  /**
   * Run alignment (same as FXL Sync Studio): Aeneas/linear spread, returns segments.
   */
  const handleRunAlignment = async () => {
    const hasAnyAudio = audioUrl || Object.keys(perSectionAudioFiles).length > 0;
    if (!hasAnyAudio) {
      setError('Upload or generate audio first');
      return;
    }
    try {
      setAutoSyncing(true);
      setError('');
      setAutoSyncProgress('Running alignment...');
      
      // CRITICAL: Pass current sidebar order as fallback for pages without saved reading order
      const currentSidebarOrder = {};
      if (sortedIds && sortedIds.length > 0) {
        sortedIds.forEach(id => {
          const pageMatch = String(id).match(/page(\d+)/);
          const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : currentPageNumber;
          if (!currentSidebarOrder[pageNum]) currentSidebarOrder[pageNum] = [];
          currentSidebarOrder[pageNum].push(id);
        });
        console.log(`[Auto-Sync] 📋 Passing current sidebar order (sortedIds) for ${Object.keys(currentSidebarOrder).length} pages`);
      }

      // In per-section mode: build synthetic section boundaries and pass perSectionAudio flag
      const alignOptions = {
        granularity: granularity || 'sentence',
        propagateWords: true,
        currentSidebarOrder
      };
      if (perSectionMode && Object.keys(perSectionAudioFiles).length > 0) {
        alignOptions.perSectionAudio = true;
        // Build one boundary per section that has its own audio
        alignOptions.sectionBoundaries = sections.map((sec, idx) => ({
          sectionIndex: idx,
          pageNumber: sec.pageNumber ?? idx + 1
        })).filter((_, idx) => perSectionAudioFiles[idx]);
        console.log(`[Auto-Sync] Per-section mode: ${alignOptions.sectionBoundaries.length} sections with dedicated audio`);
      }
      
      const result = await audioSyncService.alignSyncStudio(parseInt(jobId), alignOptions);
      const segs = result?.segments || [];
      setAutoSyncProgress(`Aligned ${segs.length} segments`);
      const newSentences = {};
      const newWords = {};
      segs.forEach(seg => {
        const pageMatch = String(seg.id || '').match(/page(\d+)/);
        const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 1;
        const el = parsedElements.find(e => e.id === seg.id);
        const text = (el?.text || '').trim();
        if (String(seg.id).includes('_w')) {
          const parentId = seg.id.replace(/_w\d+$/, '');
          newWords[seg.id] = { id: seg.id, parentId, start: seg.startTime, end: seg.endTime, text, pageNumber: pageNum, status: 'SYNCED' };
        } else {
          newSentences[seg.id] = { id: seg.id, start: seg.startTime, end: seg.endTime, text, pageNumber: pageNum, status: 'SYNCED' };
        }
      });
      parsedElements.forEach(el => {
        if (newSentences[el.id] || newWords[el.id]) return;
        const pageMatch = String(el.id).match(/page(\d+)/);
        const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 1;
        if (el.id.includes('_w')) {
          const parentId = el.id.replace(/_w\d+$/, '');
          newWords[el.id] = { id: el.id, parentId, start: undefined, end: undefined, text: el.text || '', pageNumber: pageNum, status: 'UNSYNCED' };
        } else {
          newSentences[el.id] = { id: el.id, start: undefined, end: undefined, text: el.text || '', pageNumber: pageNum, status: 'UNSYNCED' };
        }
      });
      setSyncData({ sentences: newSentences, words: newWords });
      if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();
        Object.entries(newSentences).forEach(([id, data]) => {
          if (data.status === 'SKIPPED') return;
          if (data.start != null && data.end != null && data.end > data.start) {
            createRegion(id, data.start, data.end, 'sentence');
          }
        });
        if (showWordTrack) {
          Object.entries(newWords).forEach(([id, data]) => {
            if (data.start != null && data.end != null && data.end > data.start) {
              createRegion(id, data.start, data.end, 'word');
            }
          });
        }
      }
      setSuccess(`Alignment complete. ${segs.length} segments. Adjust regions if needed, then Save.`);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Alignment failed');
    } finally {
      setAutoSyncing(false);
      setAutoSyncProgress(null);
    }
  };

  /**
   * Hybrid Gemini Alignment (Magic Sync)
   * Uses Gemini AI to intelligently match book blocks to audio transcript
   * This solves the TOC blocking and 45s offset issues
   */
  const handleMagicSync = async () => {
    if (!audioUrl) {
      setError('Please upload or generate audio first');
      return;
    }

    try {
      setAutoSyncing(true);
      setError('');

      // If we have a local audio file (blob URL), upload it first
      if (audioFile || audioUrl.startsWith('blob:')) {
        setAutoSyncProgress('Uploading audio to server...');
        console.log('[MagicSync] Audio is local, uploading first...');

        let fileToUpload = audioFile;

        if (!fileToUpload && audioUrl.startsWith('blob:')) {
          try {
            const response = await fetch(audioUrl);
            const blob = await response.blob();
            fileToUpload = new File([blob], `audio_${jobId}.mp3`, { type: 'audio/mpeg' });
          } catch (fetchErr) {
            console.error('[MagicSync] Failed to fetch blob:', fetchErr);
            setError('Failed to process audio file. Please upload a file directly.');
            setAutoSyncing(false);
            return;
          }
        }

        if (fileToUpload) {
          try {
            const uploadResult = await audioSyncService.uploadAudioFile(parseInt(jobId), fileToUpload);
            console.log('[MagicSync] Audio uploaded:', uploadResult);
          } catch (uploadErr) {
            console.error('[MagicSync] Upload failed:', uploadErr);
            setError('Failed to upload audio: ' + uploadErr.message);
            setAutoSyncing(false);
            return;
          }
        }
      }

      // Validate jobId
      const numericJobId = parseInt(jobId);
      if (!jobId || isNaN(numericJobId)) {
        setError('Invalid job ID. Please refresh the page and try again.');
        setAutoSyncing(false);
        return;
      }

      setAutoSyncProgress('Phase 1: Getting transcript from audio...');
      console.log('[MagicSync] Starting hybrid alignment for job:', numericJobId);
      console.log('[MagicSync] Options:', { language: 'eng', granularity });

      const result = await audioSyncService.magicSync(numericJobId, {
        language: 'eng',
        granularity: granularity || 'sentence'
      });

      console.log('[MagicSync] Result:', result);
      setAutoSyncProgress(`Aligned ${result.sentences?.length || 0} sentences (${result.stats?.skipped || 0} skipped)`);

      // Update local sync data
      const newSentences = {};
      const newWords = {};

      if (result.sentences) {
        result.sentences.forEach(s => {
          const pageNum = s.pageNumber || 1;
          const key = s.id;

          newSentences[key] = {
            id: s.id,
            start: s.startTime,
            end: s.endTime,
            text: s.text,
            pageNumber: pageNum,
            status: 'SYNCED' // All returned sentences are SYNCED
          };
        });
      }

      if (result.words) {
        result.words.forEach(w => {
          const pageNum = w.pageNumber || 1;
          const key = w.id;

          newWords[key] = {
            id: w.id,
            parentId: w.parentId,
            start: w.startTime,
            end: w.endTime,
            text: w.text,
            pageNumber: pageNum,
            status: 'SYNCED' // All returned words are SYNCED
          };
        });
      }

      // Add SKIPPED blocks to syncData so they appear in the UI
      // We need to get the text from parsedElements
      if (result.skippedIds && result.skippedIds.length > 0) {
        result.skippedIds.forEach(skippedId => {
          // Find the element in parsedElements to get its text and page number
          const element = parsedElements.find(el => el.id === skippedId);
          if (element) {
            // Extract page number from ID (e.g., page3_p1_s1 -> page 3)
            const pageMatch = skippedId.match(/page(\d+)/);
            const pageNum = pageMatch ? parseInt(pageMatch[1]) : currentSectionIndex + 1;

            // Determine if it's a word-level element
            const isWord = element.type === 'word' || skippedId.includes('_w');

            if (isWord) {
              // Extract parentId for word-level elements
              const parentMatch = skippedId.match(/^((?:page\d+_)?p\d+_s\d+)_w\d+$/);
              const parentId = parentMatch ? parentMatch[1] : element.parentId || skippedId.replace(/_w\d+$/, '');

              // Add to words
              newWords[skippedId] = {
                id: skippedId,
                start: undefined,
                end: undefined,
                text: element.text || '',
                pageNumber: pageNum,
                status: 'SKIPPED',
                parentId: parentId
              };
            } else {
              // Add to sentences (sentence/paragraph level)
              newSentences[skippedId] = {
                id: skippedId,
                start: undefined,
                end: undefined,
                text: element.text || '',
                pageNumber: pageNum,
                status: 'SKIPPED'
              };
            }
          }
        });
      }

      // CRITICAL FIX: Include ALL text blocks from parsedElements that aren't already in syncData
      // This ensures all text blocks appear in the UI, even if they weren't synced or skipped
      // This ensures all blocks are visible in the UI (including words)
      parsedElements.forEach(element => {
        // Skip if already in newSentences
        if (newSentences[element.id]) return;

        // For words: if it exists in newWords but has empty/missing text, update it with text from parsedElements
        // This prevents duplicates while ensuring synced words have their text
        if (newWords[element.id]) {
          // If the existing word has no text or empty text, update it with text from parsedElements
          if (!newWords[element.id].text || newWords[element.id].text.trim() === '' || newWords[element.id].text === 'No text') {
            newWords[element.id].text = element.text || newWords[element.id].text || '';
            console.log(`[MagicSync] Updated text for existing synced word ${element.id}: "${newWords[element.id].text}"`);
          }
          return; // Don't create a duplicate - the word is already synced
        }

        // Extract page number from ID
        const pageMatch = element.id.match(/page(\d+)/);
        const pageNum = pageMatch ? parseInt(pageMatch[1]) : currentSectionIndex + 1;

        // Determine if it's a word-level element
        const isWord = element.type === 'word' || element.id.includes('_w');

        if (isWord) {
          // Extract parentId for word-level elements
          const parentMatch = element.id.match(/^((?:page\d+_)?p\d+_s\d+)_w\d+$/);
          const parentId = parentMatch ? parentMatch[1] : element.parentId || element.id.replace(/_w\d+$/, '');

          // Add to words
          newWords[element.id] = {
            id: element.id,
            start: undefined,
            end: undefined,
            text: element.text || '',
            pageNumber: pageNum,
            status: 'UNSYNCED',
            parentId: parentId
          };
        } else {
          // Add to sentences (sentence/paragraph level)
          newSentences[element.id] = {
            id: element.id,
            start: undefined,
            end: undefined,
            text: element.text || '',
            pageNumber: pageNum,
            status: 'UNSYNCED' // New status for blocks that weren't processed
          };
        }
      });

      setSyncData({ sentences: newSentences, words: newWords });

      // Clear and recreate regions
      if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();

        Object.entries(newSentences).forEach(([id, data]) => {
          // Skip SKIPPED blocks - don't create regions for them
          if (data.status === 'SKIPPED') return;
          if (data.start >= 0 && data.end > data.start) {
            createRegion(id, data.start, data.end, 'sentence');
          }
        });

        if (showWordTrack) {
          Object.entries(newWords).forEach(([id, data]) => {
            if (data.start >= 0 && data.end > data.start) {
              createRegion(id, data.start, data.end, 'word');
            }
          });
        }
      }

      setAutoSyncProgress(null);
      const skippedMsg = result.skippedIds?.length > 0
        ? `\n\nSkipped (not in audio): ${result.skippedIds.length} blocks (TOC, headers, etc.)`
        : '';
      alert(`* Magic Sync complete!\n\nMethod: Hybrid Gemini + Aeneas\nSentences: ${result.sentences?.length || 0}\nWords: ${result.words?.length || 0}${skippedMsg}\n\nTOC and unspoken content automatically skipped!`);

    } catch (err) {
      console.error('[MagicSync] Error:', err);
      console.error('[MagicSync] Error details:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
        jobId: jobId
      });

      // Provide more helpful error messages
      let errorMessage = 'Magic Sync failed: ';
      if (err.response?.status === 400) {
        errorMessage += err.response?.data?.message || err.response?.data?.error || 'Bad request. Please check that audio file exists and job is valid.';
      } else if (err.response?.status === 404) {
        errorMessage += 'Job or audio file not found.';
      } else if (err.response?.status === 500) {
        errorMessage += 'Server error. Please check backend logs.';
      } else {
        errorMessage += err.message || 'Unknown error occurred';
      }

      setError(errorMessage);
      setAutoSyncProgress(null);
    } finally {
      setAutoSyncing(false);
    }
  };


  /**
   * Re-propagate all word timings
   */
  const handleRefreshWordMap = () => {
    Object.entries(syncData.sentences).forEach(([id, data]) => {
      if (data.start >= 0 && data.end > data.start) {
        // Only create word timings if granularity is "word"
        updateSentenceWithWords(id, data.start, data.end, data.text, granularity === 'word');
      }
    });
  };

  /**
   * Handle starting text edit for a block
   */
  const handleStartEdit = (blockId, currentText) => {
    setEditingBlockId(blockId);
    setEditedText(currentText || '');
  };

  /**
   * Handle canceling text edit
   */
  const handleCancelEdit = () => {
    setEditingBlockId(null);
    setEditedText('');
  };

  /**
   * Load audio script data from backend
   */
  const loadAudioScript = async () => {
    if (!jobId) return;

    try {
      setLoadingAudioScript(true);
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));

      if (!audioData || audioData.length === 0) {
        setAudioScriptData({ sentences: {}, words: {} });
        return;
      }

      // Transform the data into the same format as syncData
      const sentences = {};
      const words = {};

      audioData.forEach(sync => {
        const blockId = sync.block_id || sync.blockId || sync.elementId;
        if (!blockId) return;

        const pageNumber = sync.page_number || sync.pageNumber || 1;
        const status = sync.notes?.includes('SKIPPED') || sync.status === 'SKIPPED' ? 'SKIPPED' : 'SYNCED';

        if (blockId.includes('_w')) {
          // Word
          const parentId = blockId.replace(/_w\d+$/, '');
          words[blockId] = {
            id: blockId,
            parentId: parentId,
            start: Number(sync.start_time || sync.startTime || 0),
            end: Number(sync.end_time || sync.endTime || 0),
            text: sync.custom_text || sync.customText || sync.text || '',
            pageNumber: pageNumber,
            status: status
          };
        } else {
          // Sentence
          sentences[blockId] = {
            id: blockId,
            start: Number(sync.start_time || sync.startTime || 0),
            end: Number(sync.end_time || sync.endTime || 0),
            text: sync.custom_text || sync.customText || sync.text || '',
            pageNumber: pageNumber,
            status: status
          };
        }
      });

      setAudioScriptData({ sentences, words });
    } catch (err) {
      console.error('Error loading audio script:', err);
      setAudioScriptData({ sentences: {}, words: {} });
    } finally {
      setLoadingAudioScript(false);
    }
  };

  /**
   * Handle playing/pausing a script segment from modal
   */
  const handlePlayScriptSegment = (segmentId) => {
    if (!wavesurferRef.current || !isReady) {
      console.warn('[Script Play] Audio not ready');
      return;
    }

    const segmentData = audioScriptData.sentences[segmentId];
    if (!segmentData) {
      console.warn('[Script Play] Segment data not found:', segmentId);
      return;
    }

    if (segmentData.start === undefined || segmentData.end === undefined) {
      console.warn('[Script Play] Invalid segment times:', segmentData);
      return;
    }

    // Validate segment times
    if (segmentData.start < 0 || segmentData.end <= segmentData.start) {
      console.warn('[Script Play] Invalid time range:', segmentData.start, segmentData.end);
      return;
    }

    // If this segment is already playing, pause it
    if (playingScriptSegmentId === segmentId && isPlaying) {
      isProgrammaticPlayRef.current = false;
      wavesurferRef.current.pause();
      setPlayingScriptSegmentId(null);
      playingScriptSegmentIdRef.current = null;
      return;
    }

    // Stop any currently playing segment (both regular and script segments)
    if (isPlaying) {
      wavesurferRef.current.pause();
      setPlayingSegmentId(null);
      setPlayingScriptSegmentId(null);
      playingScriptSegmentIdRef.current = null;
    }

    // Set flag to prevent region handlers from interfering
    isProgrammaticPlayRef.current = true;

    // Set time to segment start
    wavesurferRef.current.setTime(segmentData.start);
    setPlayingScriptSegmentId(segmentId);
    playingScriptSegmentIdRef.current = segmentId;

    console.log('[Script Play] Playing segment:', {
      id: segmentId,
      start: segmentData.start.toFixed(3),
      end: segmentData.end.toFixed(3),
      duration: (segmentData.end - segmentData.start).toFixed(3)
    });

    // Small delay to ensure setTime completes before play
    setTimeout(() => {
      if (wavesurferRef.current && isProgrammaticPlayRef.current) {
        // Double-check we're still playing this segment using ref
        const currentPlayingId = playingScriptSegmentIdRef.current;
        if (currentPlayingId === segmentId) {
          const currentTime = wavesurferRef.current.getCurrentTime();
          // Verify we're at the start time (or very close) - allow 0.2s tolerance
          if (Math.abs(currentTime - segmentData.start) < 0.2) {
            wavesurferRef.current.play();
            console.log('[Script Play] Started playback at:', currentTime.toFixed(3), 'for segment:', segmentId, 'will stop at:', segmentData.end.toFixed(3));
          } else {
            // Reset to start if we're not at the right position
            console.log('[Script Play] Time mismatch, resetting to start:', segmentData.start.toFixed(3));
            wavesurferRef.current.setTime(segmentData.start);
            wavesurferRef.current.play();
          }
        } else {
          console.log('[Script Play] Segment changed, aborting playback. Current:', currentPlayingId, 'Expected:', segmentId);
        }
      }
    }, 50);
  };

  /**
   * Handle editing a script block
   */
  const handleStartEditScript = (blockId, currentText) => {
    setEditingScriptBlockId(blockId);
    setEditedScriptText(currentText || '');
  };

  /**
   * Handle canceling script edit
   */
  const handleCancelEditScript = () => {
    setEditingScriptBlockId(null);
    setEditedScriptText('');
  };

  /**
   * Handle saving edited script text and regenerating audio
   */
  const handleSaveEditScript = async (blockId) => {
    if (!jobId || !editedScriptText.trim()) {
      setError('Cannot save empty text');
      return;
    }

    if (!pdfId) {
      setError('PDF ID not found. Cannot regenerate audio.');
      return;
    }

    const blockData = audioScriptData.sentences[blockId];
    if (!blockData) {
      setError('Block not found');
      return;
    }

    // Check if text actually changed
    const textChanged = editedScriptText.trim() !== (blockData.text || '').trim();
    if (!textChanged) {
      handleCancelEditScript();
      return;
    }

    try {
      setError('');
      setRegeneratingScriptBlock(blockId);

      const savedText = editedScriptText.trim();

      // Update text in local state first
      setAudioScriptData(prev => ({
        ...prev,
        sentences: {
          ...prev.sentences,
          [blockId]: {
            ...prev.sentences[blockId],
            text: savedText
          }
        }
      }));

      setEditingScriptBlockId(null);
      setEditedScriptText('');

      // Regenerate audio for this block
      const updatedBlock = {
        id: blockId,
        pageNumber: blockData.pageNumber || 1,
        text: savedText
      };

      const segments = await audioSyncService.generateAudio(
        pdfId,
        parseInt(jobId),
        selectedVoice,
        [updatedBlock],
        granularity || 'sentence',
        ttsSpeakingRate
      );

      // Update sync data with new timings from regenerated audio
      if (segments && segments.length > 0) {
        const newSegment = segments.find(s => s.blockId === blockId) || segments[0];

        // Update the sentence in audioScriptData with new timings
        setAudioScriptData(prev => ({
          ...prev,
          sentences: {
            ...prev.sentences,
            [blockId]: {
              ...prev.sentences[blockId],
              start: newSegment.startTime || blockData.start,
              end: newSegment.endTime || blockData.end,
              text: savedText
            }
          }
        }));

        // Also update syncData if it exists
        if (syncData.sentences[blockId]) {
          setSyncData(prev => ({
            ...prev,
            sentences: {
              ...prev.sentences,
              [blockId]: {
                ...prev.sentences[blockId],
                start: newSegment.startTime || blockData.start,
                end: newSegment.endTime || blockData.end,
                text: savedText
              }
            }
          }));

          // Update region on waveform
          if (regionsPluginRef.current && newSegment.startTime !== undefined && newSegment.endTime !== undefined) {
            const region = regionsPluginRef.current.getRegions().find(r => r.id === blockId);
            if (region) {
              region.setOptions({
                start: newSegment.startTime,
                end: newSegment.endTime
              });
            } else {
              createRegion(blockId, newSegment.startTime, newSegment.endTime, 'sentence');
            }
          }
        }

        // Update audio sync record in database with new text and timings
        try {
          const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
          const existingSync = audioData.find(s => {
            const syncBlockId = s.block_id || s.blockId || s.elementId;
            return syncBlockId === blockId;
          });
          if (existingSync) {
            await audioSyncService.updateAudioSync(existingSync.id, {
              start_time: newSegment.startTime || blockData.start,
              end_time: newSegment.endTime || blockData.end,
              custom_text: savedText,
              notes: `Text edited and audio regenerated. Original: ${blockData.text?.substring(0, 50)}...`
            });
          }
        } catch (updateErr) {
          console.warn('Could not update audio sync record:', updateErr);
        }

        setSuccess(`Audio regenerated for edited block "${savedText.substring(0, 30)}..."`);
        setTimeout(() => setSuccess(''), 3000);
      }

      setRegeneratingScriptBlock(null);
    } catch (err) {
      console.error('Error saving script edit and regenerating audio:', err);
      setError('Failed to regenerate audio: ' + err.message);
      setRegeneratingScriptBlock(null);
      // Revert text change on error
      setAudioScriptData(prev => ({
        ...prev,
        sentences: {
          ...prev.sentences,
          [blockId]: {
            ...prev.sentences[blockId],
            text: blockData.text
          }
        }
      }));
    }
  };

  /**
   * Handle deleting a script block
   */
  const handleDeleteScriptBlock = async (blockId) => {
    if (!window.confirm('Are you sure you want to delete this audio block? This will remove it from the final output.')) {
      return;
    }

    try {
      // Find the sync record for this block
      const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
      const syncRecord = audioData.find(sync => {
        const syncBlockId = sync.block_id || sync.blockId || sync.elementId;
        return syncBlockId === blockId;
      });

      if (!syncRecord) {
        setError('Block not found');
        return;
      }

      // Delete from backend
      await audioSyncService.deleteAudioSync(syncRecord.id);

      // Update local state
      setAudioScriptData(prev => {
        const newSentences = { ...prev.sentences };
        delete newSentences[blockId];

        // Remove associated words
        const newWords = { ...prev.words };
        Object.keys(newWords).forEach(wordId => {
          if (newWords[wordId].parentId === blockId) {
            delete newWords[wordId];
          }
        });

        return {
          sentences: newSentences,
          words: newWords
        };
      });

      // Also update syncData if it exists
      if (syncData.sentences[blockId]) {
        setSyncData(prev => {
          const newSentences = { ...prev.sentences };
          delete newSentences[blockId];

          const newWords = { ...prev.words };
          Object.keys(newWords).forEach(wordId => {
            if (newWords[wordId].parentId === blockId) {
              delete newWords[wordId];
            }
          });

          return {
            sentences: newSentences,
            words: newWords
          };
        });

        // Remove region from waveform
        if (regionsPluginRef.current) {
          const region = regionsPluginRef.current.getRegions().find(r => r.id === blockId);
          if (region) {
            region.remove();
          }
        }
      }
    } catch (err) {
      setError('Failed to delete: ' + err.message);
      console.error('Error deleting script block:', err);
    }
  };

  /**
   * Handle playing/pausing a specific segment
   */
  const handlePlaySegment = (segmentId) => {
    if (!wavesurferRef.current || !isReady) {
      console.warn(`[Play] Cannot play segment ${segmentId}:`, {
        wavesurferReady: !!wavesurferRef.current,
        audioReady: isReady
      });
      return;
    }

    // Use ref to ensure we get the latest segment data (including after regeneration)
    const segmentData = syncDataRef.current.sentences[segmentId];
    if (!segmentData || segmentData.start === undefined || segmentData.end === undefined) {
      console.warn(`[Play] Segment ${segmentId} data invalid:`, segmentData);
      return;
    }

    console.log(`[Play] Playing segment ${segmentId}:`, {
      text: segmentData.text,
      start: segmentData.start,
      end: segmentData.end,
      duration: segmentData.end - segmentData.start,
      audioUrl: audioUrl
    });

    // If this segment is already playing, pause it
    if (playingSegmentId === segmentId && isPlaying) {
      isProgrammaticPlayRef.current = false;
      wavesurferRef.current.pause();
      setPlayingSegmentId(null);
      return;
    }

    // Stop any currently playing segment
    if (isPlaying) {
      wavesurferRef.current.pause();
    }

    // Set flag to prevent region handlers from interfering
    isProgrammaticPlayRef.current = true;

    // Set refs immediately to ensure audioprocess handler can stop at the right time
    playingSegmentIdRef.current = segmentId;
    setPlayingSegmentId(segmentId);

    // Set time to segment start
    wavesurferRef.current.setTime(segmentData.start);

    // Small delay to ensure setTime completes before play
    setTimeout(() => {
      if (wavesurferRef.current && isProgrammaticPlayRef.current) {
        // Verify we're still at the start (or close to it) before playing
        const currentTime = wavesurferRef.current.getCurrentTime();
        if (Math.abs(currentTime - segmentData.start) < 0.1) {
          wavesurferRef.current.play();
        } else {
          // If time changed, reset it
          wavesurferRef.current.setTime(segmentData.start);
          wavesurferRef.current.play();
        }
      }
    }, 50);
    // Note: The audioprocess event handler will automatically stop playback at segment end
  };

  /**
   * Start speech recognition for transcribing audio playback
   */
  const startSpeechRecognition = (segmentId, expectedText) => {
    // Check if SpeechRecognition is available
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[SpeechRecognition] Not supported in this browser');
      setTranscribedText('Speech recognition not supported in this browser. Please use Chrome or Edge.');
      return null;
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setIsTranscribing(true);
    setTranscribedText('Listening...');

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }
      setTranscribedText(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event) => {
      console.error('[SpeechRecognition] Error:', event.error);
      if (event.error === 'no-speech') {
        setTranscribedText('No speech detected. Make sure audio is playing and microphone can hear it.');
      } else if (event.error === 'not-allowed') {
        setTranscribedText('Microphone access denied. Please allow microphone access to transcribe audio.');
      } else {
        setTranscribedText(`Recognition error: ${event.error}`);
      }
      setIsTranscribing(false);
    };

    recognition.onend = () => {
      setIsTranscribing(false);
      console.log('[SpeechRecognition] Ended. Final transcript:', finalTranscript);
    };

    recognition.start();
    recognitionRef.current = recognition;

    // Auto-stop after segment duration + buffer
    const segmentData = syncDataRef.current.sentences[segmentId];
    if (segmentData && segmentData.end && segmentData.start) {
      const duration = (segmentData.end - segmentData.start) * 1000 + 2000; // Add 2 second buffer
      setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
          recognitionRef.current = null;
        }
      }, duration);
    }

    return recognition;
  };

  /**
   * Stop speech recognition
   */
  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsTranscribing(false);
  };

  /**
   * Diagnostic function to debug audio playback issues
   */
  const handleDiagnostics = async (segmentId) => {
    try {
      setLoadingDiagnostics(true);
      const segmentData = syncDataRef.current.sentences[segmentId];
      const currentEditedText = editingBlockId === segmentId ? editedText : null;

      // Get backend data for comparison
      let backendData = null;
      let allBackendSegments = [];
      try {
        const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
        allBackendSegments = audioData || [];
        backendData = audioData.find(s => s.blockId === segmentId);

        // Find segments that overlap with this segment's timings
        const overlappingSegments = audioData.filter(s => {
          if (!s.startTime || !s.endTime || s.blockId === segmentId) return false;
          const sStart = s.startTime || 0;
          const sEnd = s.endTime || 0;
          const segStart = segmentData?.start || 0;
          const segEnd = segmentData?.end || 0;
          // Check if segments overlap
          return (sStart < segEnd && sEnd > segStart);
        });

        console.log(`[Diagnostics] Found ${overlappingSegments.length} overlapping segments:`, overlappingSegments);
      } catch (err) {
        console.warn('Could not fetch backend data:', err);
      }

      // Get waveform current time
      const currentWaveformTime = wavesurferRef.current?.getCurrentTime() || 0;
      const waveformDuration = wavesurferRef.current?.getDuration() || 0;

      // Get region data
      let regionData = null;
      if (regionsPluginRef.current) {
        const region = regionsPluginRef.current.getRegions().find(r => r.id === segmentId);
        if (region) {
          regionData = {
            start: region.start,
            end: region.end,
            duration: region.end - region.start
          };
        }
      }

      // Check for mismatches
      let mismatches = [];
      let recommendations = [];
      let rootCauseAnalysis = [];

      // Find segments that overlap or are close to this segment's timings
      let overlappingSegments = [];
      let segmentsAtSameTime = [];
      if (segmentData && allBackendSegments.length > 0) {
        const segStart = segmentData.start || 0;
        const segEnd = segmentData.end || 0;

        allBackendSegments.forEach(s => {
          if (s.blockId === segmentId) return; // Skip self
          const sStart = s.startTime || s.start_time || 0;
          const sEnd = s.endTime || s.end_time || 0;

          // Check for exact overlap
          if (sStart < segEnd && sEnd > segStart) {
            overlappingSegments.push({
              blockId: s.blockId || s.block_id,
              text: s.customText || s.custom_text || s.text || 'NO TEXT',
              startTime: sStart,
              endTime: sEnd
            });
          }

          // Check for segments at the same start time (within 0.1s)
          if (Math.abs(sStart - segStart) < 0.1) {
            segmentsAtSameTime.push({
              blockId: s.blockId || s.block_id,
              text: s.customText || s.custom_text || s.text || 'NO TEXT',
              startTime: sStart,
              endTime: sEnd
            });
          }
        });
      }

      // Root cause analysis
      if (segmentData) {
        const localText = (segmentData.text || '').trim();
        if (localText && localText.length > 0) {
          console.log(`[Diagnostics] Segment ${segmentId} local text: "${localText}"`);

          // Check if timings match backend
          if (backendData) {
            const backendText = (backendData.customText || backendData.text || '').trim();
            if (localText !== backendText) {
              rootCauseAnalysis.push({
                issue: 'Text Mismatch',
                description: `Local state has "${localText}" but backend has "${backendText}"`,
                impact: 'Audio playback uses backend timings, so it may play the backend text instead',
                solution: 'Save and regenerate audio to sync local text with backend'
              });
            }

            // Check timing mismatches
            const startDiff = Math.abs((segmentData.start || 0) - (backendData.startTime || 0));
            const endDiff = Math.abs((segmentData.end || 0) - (backendData.endTime || 0));
            if (startDiff > 0.1 || endDiff > 0.1) {
              rootCauseAnalysis.push({
                issue: 'Timing Mismatch',
                description: `Local timings (${segmentData.start?.toFixed(3)}s-${segmentData.end?.toFixed(3)}s) don't match backend (${backendData.startTime?.toFixed(3)}s-${backendData.endTime?.toFixed(3)}s)`,
                impact: 'Playback may start/end at wrong times, playing wrong audio',
                solution: 'Reload sync data or regenerate audio'
              });
            }
          }

          // Check for overlapping segments
          if (overlappingSegments.length > 0) {
            rootCauseAnalysis.push({
              issue: 'Overlapping Segments',
              description: `Found ${overlappingSegments.length} other segment(s) with overlapping timings`,
              impact: 'Audio may be playing from a different segment at the same time',
              solution: 'Check overlapping segments and ensure timings are unique',
              details: overlappingSegments
            });
          }

          // Check for segments at same start time
          if (segmentsAtSameTime.length > 0) {
            rootCauseAnalysis.push({
              issue: 'Multiple Segments at Same Start Time',
              description: `Found ${segmentsAtSameTime.length} other segment(s) starting at the same time`,
              impact: 'Playback may start from the wrong segment',
              solution: 'Ensure each segment has unique start times',
              details: segmentsAtSameTime
            });
          }
        } else {
          mismatches.push('Local state has no text');
          recommendations.push('Text may have been deleted or not set properly');
        }
      }

      if (segmentData && backendData) {
        const textMatch = (segmentData.text || '').trim() === (backendData.customText || backendData.text || '').trim();
        const startMatch = Math.abs((segmentData.start || 0) - (backendData.startTime || 0)) < 0.001;
        const endMatch = Math.abs((segmentData.end || 0) - (backendData.endTime || 0)) < 0.001;

        if (!textMatch) {
          mismatches.push(`Text mismatch: Local "${segmentData.text}" vs Backend "${backendData.customText || backendData.text}"`);
          recommendations.push('The audio may be playing old text. Try saving and regenerating audio again.');
        }
        if (!startMatch) {
          mismatches.push(`Start time mismatch: Local ${segmentData.start?.toFixed(3)}s vs Backend ${backendData.startTime?.toFixed(3)}s`);
          recommendations.push('Timings may be out of sync. The audio file might need to be regenerated.');
        }
        if (!endMatch) {
          mismatches.push(`End time mismatch: Local ${segmentData.end?.toFixed(3)}s vs Backend ${backendData.endTime?.toFixed(3)}s`);
          recommendations.push('Timings may be out of sync. The audio file might need to be regenerated.');
        }
      } else if (!backendData) {
        mismatches.push('No backend data found for this segment');
        recommendations.push('The segment may not be saved to the database. Try saving the sync data.');
      }

      // Check if edited text is unsaved
      if (currentEditedText && segmentData?.text && currentEditedText.trim() !== segmentData.text.trim()) {
        mismatches.push('Unsaved edited text detected');
        recommendations.push('Click "Save & Regenerate" to apply your edits and generate new audio');
      }

      // Check if audio is ready
      if (!isReady) {
        recommendations.push('Audio file is not ready. Wait for it to load completely.');
      }

      // Check if region exists
      const isSkipped = segmentData?.status === 'SKIPPED';
      if (!regionData && !isSkipped) {
        mismatches.push('Region not found on waveform');
        recommendations.push('The segment may need to be re-synced');
      }

      // Build diagnostic data object
      const diagnosticInfo = {
        segmentId,
        localState: {
          text: segmentData?.text || 'NOT FOUND',
          start: segmentData?.start,
          end: segmentData?.end,
          duration: segmentData?.start !== undefined && segmentData?.end !== undefined
            ? segmentData.end - segmentData.start : null,
          pageNumber: segmentData?.pageNumber || null
        },
        editState: {
          isEditing: editingBlockId === segmentId,
          editedText: currentEditedText || null,
          textChanged: currentEditedText && segmentData?.text
            ? currentEditedText.trim() !== segmentData.text.trim()
            : false
        },
        playbackState: {
          isPlaying: playingSegmentId === segmentId && isPlaying,
          isReady,
          waveformTime: currentWaveformTime,
          waveformDuration
        },
        audioFile: {
          url: audioUrl || null,
          isReady
        },
        backendData: backendData ? {
          text: backendData.customText || backendData.text || null,
          startTime: backendData.startTime,
          endTime: backendData.endTime,
          syncId: backendData.id
        } : null,
        regionData,
        mismatches,
        recommendations: recommendations.length > 0 ? recommendations : ['No issues detected. Audio should play correctly.'],
        rootCauseAnalysis,
        overlappingSegments,
        segmentsAtSameTime
      };

      // Log to console
      console.log('=== AUDIO PLAYBACK DIAGNOSTICS ===', diagnosticInfo);

      setDiagnosticData(diagnosticInfo);
      setShowDiagnostics(true);
    } catch (err) {
      console.error('Error in diagnostics:', err);
      setDiagnosticData({
        error: err.message,
        segmentId
      });
      setShowDiagnostics(true);
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  /**
   * Handle clearing sync for a block (reset to unsynced state)
   */
  const handleClearSync = useCallback((blockId) => {
    if (!blockId) return;

    // Remove region from waveform
    if (regionsPluginRef.current) {
      const regions = regionsPluginRef.current.getRegions();
      const region = regions.find(r => r.id === blockId);
      if (region) {
        region.remove();
      }

      // Also remove word regions for this block
      const blockData = syncDataRef.current.sentences[blockId];
      if (blockData) {
        Object.keys(syncDataRef.current.words || {}).forEach(wordId => {
          const wordData = syncDataRef.current.words[wordId];
          if (wordData && wordData.parentId === blockId) {
            const wordRegion = regions.find(r => r.id === wordId);
            if (wordRegion) {
              wordRegion.remove();
            }
          }
        });
      }
    }

    // Clear sync data - set to unsynced state
    setSyncData(prev => {
      const newSentences = { ...prev.sentences };
      const newWords = { ...prev.words };

      // Reset block to unsynced state
      if (newSentences[blockId]) {
        newSentences[blockId] = {
          ...newSentences[blockId],
          start: undefined,
          end: undefined,
          status: 'UNSYNCED'
        };
      }

      // Remove word timings for this block
      Object.keys(newWords).forEach(wordId => {
        const wordData = newWords[wordId];
        if (wordData && wordData.parentId === blockId) {
          delete newWords[wordId];
        }
      });

      return {
        sentences: newSentences,
        words: newWords
      };
    });

    // Clear active region if it was the cleared one
    if (activeRegionId === blockId) {
      setActiveRegionId(null);
    }

    console.log(`[ClearSync] Cleared sync for block: ${blockId}`);
  }, [activeRegionId]);

  /**
   * Handle deleting a segment
   */
  const handleDeleteSegment = (segmentId) => {
    if (!window.confirm('Are you sure you want to delete this segment? This will remove it from the audio sequence.')) {
      return;
    }

    const segmentData = syncData.sentences[segmentId];
    if (!segmentData) return;

    // Remove the region from the waveform
    if (regionsPluginRef.current) {
      const region = regionsPluginRef.current.getRegions().find(r => r.id === segmentId);
      if (region) {
        region.remove();
      }
    }

    // Remove associated words
    const wordsToRemove = Object.keys(syncData.words).filter(
      wordId => syncData.words[wordId].parentId === segmentData.id
    );

    // Remove word regions
    if (regionsPluginRef.current && showWordTrack) {
      wordsToRemove.forEach(wordId => {
        const wordRegion = regionsPluginRef.current.getRegions().find(r => r.id === wordId);
        if (wordRegion) {
          wordRegion.remove();
        }
      });
    }

    // Update syncData - remove sentence and associated words
    setSyncData(prev => {
      const newSentences = { ...prev.sentences };
      delete newSentences[segmentId];

      const newWords = { ...prev.words };
      wordsToRemove.forEach(wordId => {
        delete newWords[wordId];
      });

      return {
        sentences: newSentences,
        words: newWords
      };
    });

    // Clear active region if it was the deleted one
    if (activeRegionId === segmentId) {
      setActiveRegionId(null);
    }

    // Cancel edit if editing this segment
    if (editingBlockId === segmentId) {
      handleCancelEdit();
    }
  };

  /**
   * Handle saving edited text and regenerating audio
   */
  const handleSaveEdit = async (blockId) => {
    if (!pdfId || !editedText.trim()) {
      setError('Cannot save empty text');
      return;
    }

    const blockData = syncData.sentences[blockId];
    if (!blockData) {
      setError('Block not found');
      return;
    }

    // Check if text actually changed
    const textChanged = editedText.trim() !== (blockData.text || '').trim();
    if (!textChanged) {
      handleCancelEdit();
      return;
    }

    try {
      setRegeneratingBlock(blockId);
      setError('');

      // Update text in local state
      setSyncData(prev => ({
        ...prev,
        sentences: {
          ...prev.sentences,
          [blockId]: {
            ...prev.sentences[blockId],
            text: editedText.trim()
          }
        }
      }));

      const savedText = editedText.trim();
      setEditingBlockId(null);
      setEditedText('');

      // Regenerate audio for this block
      const updatedBlock = {
        id: blockId,
        pageNumber: blockData.pageNumber || currentSectionIndex + 1,
        text: savedText
      };

      console.log(`[Regenerate] Starting audio regeneration for block ${blockId} with text: "${savedText}"`);

      const segments = await audioSyncService.generateAudio(
        pdfId,
        parseInt(jobId),
        selectedVoice,
        [updatedBlock],
        granularity || 'sentence',
        ttsSpeakingRate
      );

      console.log(`[Regenerate] Received ${segments?.length || 0} segments from backend`);

      // Update sync data with new timings from regenerated audio
      if (segments && segments.length > 0) {
        const newSegment = segments.find(s => s.blockId === blockId) || segments[0];

        console.log(`[Regenerate] New segment data:`, {
          blockId: newSegment.blockId,
          startTime: newSegment.startTime,
          endTime: newSegment.endTime,
          text: savedText
        });

        // Update the sentence in syncData with new timings
        setSyncData(prev => ({
          ...prev,
          sentences: {
            ...prev.sentences,
            [blockId]: {
              ...prev.sentences[blockId],
              start: newSegment.startTime || 0,
              end: newSegment.endTime || 0,
              text: savedText,
              // Ensure id is preserved
              id: blockId
            }
          }
        }));

        console.log(`[Regenerate] Updated syncData for block ${blockId} with new timings: ${newSegment.startTime} - ${newSegment.endTime}`);

        // Update region on waveform
        if (newSegment.startTime !== undefined && newSegment.endTime !== undefined) {
          // Store region update info for recreation after audio reload
          pendingRegionUpdatesRef.current.set(blockId, {
            start: newSegment.startTime,
            end: newSegment.endTime
          });

          // Try to update/create region immediately if audio is ready
          if (regionsPluginRef.current && isReady) {
            const region = regionsPluginRef.current.getRegions().find(r => r.id === blockId);
            if (region) {
              region.setOptions({
                start: newSegment.startTime,
                end: newSegment.endTime
              });
              console.log(`[Region] Updated region for segment ${blockId}`);
            } else {
              createRegion(blockId, newSegment.startTime, newSegment.endTime, 'sentence');
              console.log(`[Region] Created region for segment ${blockId}`);
            }
            // Remove from pending since we've handled it
            pendingRegionUpdatesRef.current.delete(blockId);
          } else {
            console.log(`[Region] Audio not ready, will recreate region for ${blockId} after reload`);
          }
        }

        // Update audio sync record in database with new text and timings
        try {
          const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
          const existingSync = audioData.find(s => s.blockId === blockId);
          if (existingSync) {
            await audioSyncService.updateAudioSync(existingSync.id, {
              startTime: newSegment.startTime || 0,
              endTime: newSegment.endTime || 0,
              customText: savedText,
              notes: `Text edited and audio regenerated. Original: ${blockData.text?.substring(0, 50)}...`
            });
          }

          // Reload audio URL to get the updated audio file with regenerated content
          // IMPORTANT: After regenerating audio, we need to fetch the latest audio data
          // because the audio file might have been regenerated
          try {
            // Fetch fresh audio data after regeneration
            const freshAudioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
            console.log(`[Regenerate] Fetched fresh audio data:`, freshAudioData);

            if (freshAudioData && freshAudioData.length > 0 && freshAudioData[0]?.audioFilePath) {
              const updatedUrl = audioSyncService.getAudioUrl(freshAudioData[0].id);
              // Add timestamp to force reload and bypass cache
              const urlWithCacheBuster = appendQueryParams(updatedUrl, {
                t: Date.now(),
                regenerated: blockId
              });

              console.log(`[Regenerate] Reloading audio from URL: ${urlWithCacheBuster}`);

              // Reload waveform with updated audio
              if (wavesurferRef.current) {
                // Stop any current playback
                if (isPlaying) {
                  wavesurferRef.current.pause();
                  setPlayingSegmentId(null);
                }

                // Store the blockId that was regenerated so we can verify after reload
                const regeneratedBlockIdRef = { current: blockId };

                // Reload the audio file
                wavesurferRef.current.load(urlWithCacheBuster);

                // Update audio URL state
                setAudioUrl(urlWithCacheBuster);

                // Wait for audio to be ready, then verify the segment
                const checkAudioReady = setInterval(() => {
                  if (isReady && wavesurferRef.current) {
                    clearInterval(checkAudioReady);
                    const segmentData = syncDataRef.current.sentences[regeneratedBlockIdRef.current];
                    if (segmentData) {
                      console.log(`[Regenerate] Audio ready. Segment ${regeneratedBlockIdRef.current} timings:`, {
                        start: segmentData.start,
                        end: segmentData.end,
                        text: segmentData.text
                      });
                    }
                  }
                }, 100);

                // Clear interval after 10 seconds
                setTimeout(() => clearInterval(checkAudioReady), 10000);

                // Note: The 'ready' event handler will recreate regions from pendingRegionUpdatesRef
                // This ensures regions are recreated after audio reload completes
              }
            } else {
              console.warn(`[Regenerate] No audio file path found after regeneration`);
            }
          } catch (reloadErr) {
            console.error(`[Regenerate] Error reloading audio after regeneration:`, reloadErr);
          }
        } catch (updateErr) {
          console.warn('Could not update audio sync record:', updateErr);
        }

        // Reload sync data from backend to ensure we have the latest timings
        // This is important because the backend may have regenerated the entire audio file
        // and updated timings for all segments
        try {
          console.log(`[Regenerate] Reloading sync data from backend...`);
          const refreshedAudioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));

          if (refreshedAudioData && refreshedAudioData.length > 0) {
            const sentences = {};
            const words = {};

            refreshedAudioData.forEach(sync => {
              const blockId = sync.block_id || sync.blockId;
              if (blockId) {
                const pageNumber = sync.page_number || sync.pageNumber || 1;
                const status = sync.notes?.includes('SKIPPED') || sync.status === 'SKIPPED' ? 'SKIPPED' : 'SYNCED';

                if (blockId.includes('_w')) {
                  const parentId = blockId.replace(/_w\d+$/, '');
                  words[blockId] = {
                    id: blockId,
                    parentId: parentId,
                    start: sync.start_time || sync.startTime || 0,
                    end: sync.end_time || sync.endTime || 0,
                    text: sync.custom_text || sync.customText || '',
                    pageNumber: pageNumber,
                    status: status
                  };
                } else {
                  sentences[blockId] = {
                    id: blockId,
                    start: Number(sync.start_time || sync.startTime || 0),
                    end: Number(sync.end_time || sync.endTime || 0),
                    text: sync.custom_text || sync.customText || '',
                    pageNumber: pageNumber,
                    status: status
                  };
                }
              }
            });

            // Update syncData with refreshed data
            setSyncData({ sentences, words });

            // Log the regenerated segment to verify
            const refreshedSegment = sentences[blockId];
            if (refreshedSegment) {
              console.log(`[Regenerate] Refreshed segment data for ${blockId}:`, {
                text: refreshedSegment.text,
                start: refreshedSegment.start,
                end: refreshedSegment.end
              });
            }

            // Update regions after reloading sync data (wait a bit for audio to be ready)
            setTimeout(() => {
              if (regionsPluginRef.current && isReady) {
                // Update the region for this specific block
                const region = regionsPluginRef.current.getRegions().find(r => r.id === blockId);
                if (refreshedSegment && refreshedSegment.start !== undefined && refreshedSegment.end !== undefined) {
                  if (region) {
                    region.setOptions({
                      start: refreshedSegment.start,
                      end: refreshedSegment.end
                    });
                    console.log(`[Regenerate] Updated region with refreshed timings`);
                  } else {
                    createRegion(blockId, refreshedSegment.start, refreshedSegment.end, 'sentence');
                    console.log(`[Regenerate] Created region with refreshed timings`);
                  }
                }
              }
            }, 500);
          }
        } catch (reloadErr) {
          console.error(`[Regenerate] Error reloading sync data:`, reloadErr);
          // Don't fail the whole operation if reload fails
        }

        setSuccess(`Audio regenerated for edited block "${savedText.substring(0, 30)}..."`);
        setTimeout(() => setSuccess(''), 3000);
      }

    } catch (err) {
      console.error('Error saving edit and regenerating audio:', err);
      setError('Failed to regenerate audio: ' + err.message);
      // Revert text change on error
      setSyncData(prev => ({
        ...prev,
        sentences: {
          ...prev.sentences,
          [blockId]: {
            ...prev.sentences[blockId],
            text: blockData.text
          }
        }
      }));
    } finally {
      setRegeneratingBlock(null);
    }
  };

  /**
   * Save sync data to backend
   */
  const handleSave = async () => {
    try {
      setLoading(true);

      // Normalize legacy synthetic image-alt ids (e.g. "..._imgalt_0" or "..._imgalt_0_w1")
      // into the real XHTML image container ids (e.g. "chapter3_page6_img1").
      //
      // This makes "Save & regenerate EPUB" robust even when sync data loaded from the DB
      // still contains older (incorrect) image-alt id generation.
      const imageSentenceElements = parsedElements.filter(el => el?.isImageAlt && el?.type === 'sentence');
      const imageIdsByPage = {};
      imageSentenceElements.forEach(el => {
        const m = String(el?.id || '').match(/page(\\d+)_/i);
        const pageNum = m ? parseInt(m[1], 10) : parseInt(el?.pageNumber, 10);
        if (!Number.isNaN(pageNum)) {
          imageIdsByPage[pageNum] = imageIdsByPage[pageNum] || [];
          imageIdsByPage[pageNum].push({ id: el.id });
        }
      });
      Object.keys(imageIdsByPage).forEach((pageKey) => {
        // Preserve parse order from XHTML so legacy _imgalt_{index} resolves correctly.
        imageIdsByPage[pageKey] = imageIdsByPage[pageKey].map(({ id }) => ({ id }));
      });

      const resolveLegacyImgAltIdToXhtmlId = (blockId) => {
        const id = String(blockId || '').trim();
        if (!id.includes('_imgalt_')) return id;
        if (Object.keys(imageIdsByPage).length === 0) return id;

        const withoutWordSuffix = id.replace(/_w\\d+$/i, '');
        const imgAltMatch = withoutWordSuffix.match(/_imgalt_(\\d+)$/i);
        if (!imgAltMatch) return id;
        const imgAltIndex = parseInt(imgAltMatch[1], 10);

        // IDs usually look like page6_div2_imgalt_0; extract "6".
        const pageMatch = withoutWordSuffix.match(/page(\\d+)_/i);
        const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : null;
        if (pageNum == null || Number.isNaN(pageNum)) return id;

        return imageIdsByPage[pageNum]?.[imgAltIndex]?.id || id;
      };

      // In per-section mode the individual section audio files are managed separately.
      // A global audioUrl/audioFile is not required when at least one section has its own audio.
      const hasPerSectionFiles = perSectionMode && Object.keys(perSectionAudioFiles).length > 0;
      if (!audioFile && !audioUrl && !hasPerSectionFiles) {
        setError('Please upload or generate audio first');
        return;
      }

      // Upload audio if needed
      let audioFileName;
      if (audioFile) {
        const uploadResult = await audioSyncService.uploadAudioFile(parseInt(jobId), audioFile);
        audioFileName = uploadResult?.fileName || audioFile.name;
      } else if (audioUrl) {
        const audioData = await audioSyncService.getAudioSyncsByJob(parseInt(jobId));
        audioFileName = audioData?.[0]?.audioFilePath?.split('/').pop() || `audio_${jobId}.mp3`;
      } else {
        // Per-section mode only — no global audio file; backend will embed per-section files
        audioFileName = null;
      }

      // Prepare sync blocks based on dropdown Export Level (granularity) — only save blocks matching selected level
      const syncBlocks = [];
      const currentGranularity = granularity || 'sentence';

      const isUnspoken = (id, text) => {
        const unspokenPatterns = [
          /toc/i, /table-of-contents/i, /contents/i,
          /chapter-index/i, /chapter-idx/i,
          /^nav/i, /^header/i, /^footer/i, /^sidebar/i, /^menu/i,
          /page-number/i, /page-num/i, /^skip/i, /^metadata/i
        ];
        return unspokenPatterns.some(pattern => pattern.test(id) || pattern.test(text));
      };

      const allParsedIdsForSave = parsedElements.map((e) => e.id);
      const matchesGranularityForSave = (id, type) =>
        parsedElementMatchesGranularityExport(currentGranularity, { id, type }, allParsedIdsForSave);

      // Add sentences only when Export Level is sentence or paragraph
      if (currentGranularity === 'sentence' || currentGranularity === 'paragraph') {
        Object.entries(syncData.sentences).forEach(([id, data]) => {
          if (data.status === 'SKIPPED') return;
          if (data.start == null || data.end == null) return;
          const resolvedId = resolveLegacyImgAltIdToXhtmlId(id);
          if (isUnspoken(resolvedId, data.text || '')) return;
          const el = parsedElements.find(e => e.id === resolvedId);
          const type = el?.type || inferSyncElementTypeFromId(resolvedId);
          if (!matchesGranularityForSave(resolvedId, type)) return;

          const pageMatch = resolvedId.match(/page(\\d+)_/i);
          const resolvedPageNumber = pageMatch ? parseInt(pageMatch[1], 10) : (data.pageNumber || 1);
          syncBlocks.push({
            id: resolvedId,
            text: data.text,
            type: type,
            shouldRead: true,
            start: data.start,
            end: data.end,
            pageNumber: resolvedPageNumber,
            granularity: currentGranularity
          });
        });
      }

      // Add words only when Export Level is word
      if (currentGranularity === 'word') {
        Object.entries(syncData.words).forEach(([id, data]) => {
          if (data.status === 'SKIPPED') return;
          if (data.start == null || data.end == null) return;
          const wordSuffixMatch = String(id).match(/(_w\\d+)$/i);
          const wordSuffix = wordSuffixMatch ? wordSuffixMatch[1] : '';
          const idWithoutWordSuffix = String(id).replace(/_w\\d+$/i, '');

          const resolvedBaseId = resolveLegacyImgAltIdToXhtmlId(idWithoutWordSuffix);
          const resolvedId = idWithoutWordSuffix.includes('_imgalt_') ? `${resolvedBaseId}${wordSuffix}` : id;

          if (isUnspoken(resolvedId, data.text || '')) return;
          const parentSentence = Object.values(syncData.sentences).find(s => s.id === data.parentId);
          const pageMatch = resolvedId.match(/page(\\d+)_/i);
          const pageNumber = pageMatch ? parseInt(pageMatch[1], 10) : (parentSentence?.pageNumber || data.pageNumber || 1);
          syncBlocks.push({
            id: resolvedId,
            text: data.text,
            type: 'word',
            shouldRead: true,
            start: data.start,
            end: data.end,
            pageNumber: pageNumber,
            granularity: currentGranularity
          });
        });
      }

      // Ensure playback speed is a valid number
      const speedToSave = parseFloat(playbackSpeed) || 1.0;
      console.log(`[SyncStudio] Saving with playback speed: ${speedToSave}x`);

      // Save via Sync Studio API (same as FXL) then legacy for playback speed
      const segments = syncBlocks.map(b => ({
        id: b.id,
        startTime: Number(b.start) || 0,
        endTime: Number(b.end) || 0
      }));
      
      // Send current reading order (sortedIds) to persist user's custom arrangement
      const orderKey = `section:${currentSectionIndex}`;
      const latestOrder = (Array.isArray(sortedIdsRef.current) && sortedIdsRef.current.length > 0)
        ? sortedIdsRef.current
        : sortedIds;
      const existingSectionOrder = readingOrderByPage[orderKey] || [];
      const latestSet = new Set(latestOrder);
      let mergedSectionOrder = [];
      let inserted = false;
      if (Array.isArray(existingSectionOrder) && existingSectionOrder.length > 0) {
        for (const id of existingSectionOrder) {
          if (latestSet.has(id)) {
            if (!inserted) {
              mergedSectionOrder.push(...latestOrder);
              inserted = true;
            }
            continue;
          }
          mergedSectionOrder.push(id);
        }
        if (!inserted) mergedSectionOrder.push(...latestOrder);
        mergedSectionOrder = Array.from(new Set(mergedSectionOrder));
      } else {
        mergedSectionOrder = latestOrder;
      }
      await audioSyncService.saveSyncStudio(parseInt(jobId), segments, mergedSectionOrder, currentPageNumber, orderKey);
      console.log(`[SyncStudio] Saved reading order with ${mergedSectionOrder.length} items for ${orderKey}`);
      
      // saveSyncBlocks associates a global audio file name with the sync records.
      // In per-section mode there may be no global audio file — skip the call in that case
      // (the backend embeds per-section audio files directly during EPUB regeneration).
      if (audioFileName) {
        await audioSyncService.saveSyncBlocks(
          parseInt(jobId),
          syncBlocks,
          audioFileName,
          granularity,
          speedToSave
        );
      }

      // Regenerate EPUB with playback speed setting
      const regenerateResult = await conversionService.regenerateEpub(parseInt(jobId), {
        granularity,
        playbackSpeed: speedToSave
      });

      setSaveSuccess(true);
      setError('');
      console.log(`[SyncStudio] EPUB regenerated successfully. ${syncBlocks.length} sync points saved. Playback speed: ${playbackSpeed}x`);
    } catch (err) {
      setError('Failed to save: ' + err.message);
      setSaveSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Download EPUB file
   */
  const handleDownloadEpub = async () => {
    try {
      setDownloading(true);
      setError('');
      setSuccess('');

      const numericJobId = parseInt(jobId);
      const downloadRes = await api.get(`/conversions/${numericJobId}/download`, { responseType: 'blob', timeout: 600000 });
      const epubBlob = downloadRes.data;

      const epubFileName = `converted_${numericJobId}.epub`;

      const url = URL.createObjectURL(epubBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = epubFileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setSuccess('Reflowable EPUB downloaded successfully!');
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to download EPUB: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  /**
   * Format time display (guards against NaN/invalid values)
   * Displays as: "0:01.52" (MM:SS.ms format)
   */
  const formatTime = (seconds) => {
    const n = Number(seconds);
    if (n !== n || n < 0) return '0:00.00'; // NaN or negative
    const mins = Math.floor(n / 60);
    const secs = Math.floor(n % 60);
    const ms = Math.floor((n % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  /**
   * Parse MM:SS.ms format to seconds
   * Examples: "0:01.52" -> 1.52, "1:23.45" -> 83.45, "1.5" -> 1.5
   * Also handles common mistakes like "0.55.36" (should be "0:55.36")
   */
  const parseTimeFormat = (timeStr) => {
    // Handle null, undefined, or empty string
    if (timeStr === null || timeStr === undefined || timeStr === '') {
      return null;
    }

    // Convert to string and trim
    let trimmed = String(timeStr).trim();

    // Check again after trimming
    if (trimmed === '') {
      return null;
    }

    // Handle common mistake: "0.55.36" -> convert to "0:55.36"
    // Pattern: number.number.number (likely meant to be MM:SS.ms)
    const dotDotPattern = trimmed.match(/^(\d+)\.(\d{1,2})\.(\d{1,2})$/);
    if (dotDotPattern) {
      const mins = parseInt(dotDotPattern[1], 10);
      const secs = parseInt(dotDotPattern[2], 10);
      const msStr = dotDotPattern[3];
      const ms = parseInt(msStr.padEnd(2, '0'), 10);
      if (secs >= 60) return null; // Invalid seconds
      console.log(`[parseTimeFormat] Converted "${trimmed}" to MM:SS.ms format: ${mins}:${secs.toString().padStart(2, '0')}.${msStr.padEnd(2, '0')}`);
      return mins * 60 + secs + ms / 100;
    }

    // If it's already a plain number (seconds), return it
    // Check if it doesn't contain ':' and is a valid number
    if (!trimmed.includes(':') && !trimmed.includes('.')) {
      // Pure integer seconds
      const num = Number(trimmed);
      if (!isNaN(num) && num >= 0) {
        return num;
      }
      return null;
    }

    // If it's a decimal number without colon (e.g., "1.52"), treat as seconds
    // But only if it has a single dot (not multiple dots which would be MM.SS.ms mistake)
    if (!trimmed.includes(':') && trimmed.includes('.')) {
      const dotCount = (trimmed.match(/\./g) || []).length;
      if (dotCount === 1) {
        const num = Number(trimmed);
        if (!isNaN(num) && num >= 0) {
          return num;
        }
      }
      return null;
    }

    // Parse MM:SS.ms format (flexible - allows 1-2 digits for seconds, 1-2 digits for ms)
    // Matches: "0:1.5", "0:01.52", "1:23.4", "1:23.45", etc.
    const flexibleMatch = trimmed.match(/^(\d+):(\d{1,2})\.(\d{1,2})$/);
    if (flexibleMatch) {
      const mins = parseInt(flexibleMatch[1], 10);
      const secs = parseInt(flexibleMatch[2], 10);
      const msStr = flexibleMatch[3];
      // Normalize ms to 2 digits (e.g., "5" -> 50, "52" -> 52)
      const ms = parseInt(msStr.padEnd(2, '0'), 10);
      if (secs >= 60) return null; // Invalid seconds
      return mins * 60 + secs + ms / 100;
    }

    // Try stricter format MM:SS.ms (exactly 2 digits for seconds and ms)
    const strictMatch = trimmed.match(/^(\d+):(\d{2})\.(\d{2})$/);
    if (strictMatch) {
      const mins = parseInt(strictMatch[1], 10);
      const secs = parseInt(strictMatch[2], 10);
      const ms = parseInt(strictMatch[3], 10);
      if (secs >= 60) return null; // Invalid seconds
      return mins * 60 + secs + ms / 100;
    }

    // If we get here, the format is not recognized
    console.warn(`[parseTimeFormat] Unrecognized time format: "${timeStr}"`);
    return null;
  };

  /**
   * Change current section.
   * In per-section mode, switches the waveform to the new section's audio if available.
   */
  const handleSectionChange = (index) => {
    setCurrentSectionIndex(index);
    setCurrentSentenceIndex(0);
    if (sections[index]) {
      setXhtmlContent(xhtmlFragmentForDivViewer(sections[index].xhtml || ''));
    }
    // Per-section audio: switch waveform to section audio when available, or clear if none
    if (perSectionMode) {
      const sectionAudio = perSectionAudioFiles[index];
      if (sectionAudio?.url) {
        setAudioUrl(sectionAudio.url);
        setAudioSource(sectionAudio.source || 'uploaded');
      } else {
        // No audio for this section — clear waveform so it doesn't show a different section's audio
        setAudioUrl(null);
        setAudioSource(null);
        setDuration(0);
      }
      setIsReady(false);
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }
    }
  };

  // Resize handlers for left panel
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingLeft) return;

      const container = resizeContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;

      const minWidth = 250;
      const maxWidth = Math.min(800, containerRect.width * 0.6);

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setLeftPanelWidth(newWidth);
        localStorage.setItem('sync-studio-left-panel-width', newWidth.toString());
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
    };

    if (isResizingLeft) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingLeft]);

  // Resize handlers for right panel
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRight) return;

      const container = resizeContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const newWidth = containerRect.width - (e.clientX - containerRect.left);

      const minWidth = 250;
      const maxWidth = Math.min(800, containerRect.width * 0.6);

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setRightPanelWidth(newWidth);
        localStorage.setItem('sync-studio-right-panel-width', newWidth.toString());
      }
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
    };

    if (isResizingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingRight]);

  const handleLeftResizeStart = (e) => {
    e.preventDefault();
    setIsResizingLeft(true);
  };

  const handleRightResizeStart = (e) => {
    e.preventDefault();
    setIsResizingRight(true);
  };

  if (loading && sections.length === 0) {
    return (
      <div className="sync-studio-loading">
        <div className="spinner"></div>
        <p>Loading Sync Studio...</p>
      </div>
    );
  }

  return (
    <div className="sync-studio">
      {/* Header */}
      <header className="studio-header">
        <div className="header-left">
          <button onClick={() => navigate(`/epub-image-editor/${jobId}`)} className="btn-back">
            ← Back
          </button>
          <h1>Sync Studio</h1>
          <span className="job-badge">Job #{jobId}</span>
        </div>
        <div className="header-right">
          <button
            onClick={async () => {
              setShowAudioScript(true);
              await loadAudioScript();
            }}
            className="btn-audio-script"
            title="View complete audio script"
            style={{
              display: 'none',
              alignItems: 'center',
              padding: '8px 16px',
              background: '#2a2a2a',
              color: '#e0e0e0',
              border: '1px solid #444',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              marginRight: '10px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#333';
              e.target.style.borderColor = '#555';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#2a2a2a';
              e.target.style.borderColor = '#444';
            }}
          >
            <HiOutlineDocumentText size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Audio Script
          </button>
          {saveSuccess ? (
            <div className="save-success-actions">
              <span className="save-success-message">
                <HiOutlineCheck size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                Saved successfully!
              </span>
              <button
                onClick={handleDownloadEpub}
                className="btn-download"
                disabled={downloading}
              >
                <HiOutlineDownload size={18} />
                {downloading ? 'Downloading...' : 'Download EPUB'}
              </button>
              <button
                onClick={() => setSaveSuccess(false)}
                className="btn-save-again"
                title="Save again"
              >
                <HiOutlineSave size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Save Again
              </button>
            </div>
          ) : (
            <button onClick={handleSave} className="btn-save" disabled={loading}>
              {loading ? 'Saving...' : (
                <>
                  <HiOutlineSave size={18} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                  Save & Export
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner"><HiOutlineCheck size={18} /> <span>{success}</span></div>}
      {saveSuccess && !error && !success && (
        <div className="success-banner">
          <HiOutlineCheck size={18} />
          <span>Sync data saved successfully! EPUB has been regenerated with your settings. Click "Download EPUB" in the header to get your file.</span>
        </div>
      )}

      <div className="studio-layout" ref={resizeContainerRef}>
        {/* Left Panel: XHTML Viewer */}
        <aside
          className="viewer-panel"
          style={{ width: `${leftPanelWidth}px`, minWidth: `${leftPanelWidth}px`, maxWidth: `${leftPanelWidth}px` }}
        >
          <div className="panel-header">
            <h3><HiOutlineDocument size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Page {currentPageNumber}</h3>
            <div className="page-nav-buttons" style={{ flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-page-nav"
                title="Open EPUB reader on a full page"
                onClick={() => {
                  const spine = sections[currentSectionIndex]?.href;
                  const anchorId = parsedElements.find(
                    (el) => el.pageNumber === currentPageNumber && el.sectionIndex === currentSectionIndex
                  )?.id;
                  navigate(buildEpubReaderPath(jobId, { source: 'conversion', spine, anchorId }));
                }}
                style={{ padding: '4px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <HiOutlineBookOpen size={14} />
                Reader
              </button>
              <button
                type="button"
                className="btn-page-nav"
                title="Open EPUB reader in a new browser tab"
                onClick={() => {
                  const spine = sections[currentSectionIndex]?.href;
                  const anchorId = parsedElements.find(
                    (el) => el.pageNumber === currentPageNumber && el.sectionIndex === currentSectionIndex
                  )?.id;
                  const path = buildEpubReaderPath(jobId, { source: 'conversion', spine, anchorId });
                  window.open(`${window.location.origin}${path}`, '_blank', 'noopener,noreferrer');
                }}
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                ↗
              </button>
              <button
                onClick={() => handleSectionChange(Math.max(0, currentSectionIndex - 1))}
                disabled={currentSectionIndex === 0}
                className="btn-page-nav"
              >
                <HiOutlineChevronLeft size={14} />
              </button>
              {sections.length > 1 && (
                <select
                  value={currentSectionIndex}
                  onChange={(e) => handleSectionChange(parseInt(e.target.value))}
                  className="page-select"
                >
                  {sections.map((s, i) => (
                    <option key={i} value={i}>
                      {s.title && !s.title.includes('Chapter') ? s.title : `Page ${s.pageNumber || i + 1}`}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() => handleSectionChange(Math.min(sections.length - 1, currentSectionIndex + 1))}
                disabled={currentSectionIndex >= sections.length - 1}
                className="btn-page-nav"
              >
                <HiOutlinePlay size={14} />
              </button>
            </div>
          </div>
          <div
            ref={viewerRef}
            className="xhtml-viewer"
            dangerouslySetInnerHTML={{ __html: xhtmlContent }}
          />
        </aside>

        {/* Left Resizable Divider */}
        <div
          className="studio-divider studio-divider-left"
          onMouseDown={handleLeftResizeStart}
          style={{ cursor: 'col-resize' }}
        >
          <div className="studio-divider-handle" />
        </div>

        {/* Main Content */}
        <main className="main-panel">
          {/* Audio Controls */}
          <div className="audio-controls">
            <div className="control-group">
              {/* Upload Audio — hidden; use Manual section boundaries or per-section upload instead */}
              <label className="upload-btn" style={{ display: 'none' }}>
                <HiOutlineVolumeUp size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Upload Audio
                <input type="file" accept="audio/*" onChange={handleAudioUpload} hidden />
              </label>

              <label className="export-level-label" title="TTS and sync use this level (word / sentence)">
                Export Level
                <select
                  value={granularity}
                  onChange={(e) => setGranularity(e.target.value)}
                  className="export-level-select"
                >
                  <option value="word">Word</option>
                  <option value="sentence">Sentence</option>
                </select>
              </label>

              {/* Voice selector — hidden; configured inside Manual section boundaries */}
              <div className="tts-controls" style={{ display: 'none' }}>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                >
                  {voices.map((v, i) => (
                    <option key={v.id || i} value={v.value || v.id}>
                      {v.label || v.name}
                    </option>
                  ))}
                </select>
                <label className="tts-speed-label" title="Faster TTS generation (Google Cloud TTS only)" style={{ display: 'none' }}>
                  TTS speed
                  <select
                    value={String(ttsSpeakingRate)}
                    onChange={(e) => setTtsSpeakingRate(parseFloat(e.target.value))}
                    className="tts-speed-select"
                  >
                    <option value="1">1x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                  </select>
                </label>
                <button
                  onClick={handleGenerateAudio}
                  disabled={generating || !pdfId}
                  className="btn-generate"
                  title={`Generate TTS at ${granularity || 'sentence'} level`}
                >
                  {generating ? (
                    <>
                      <HiOutlineClock size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      Generating...
                    </>
                  ) : (
                    <>
                      <HiOutlineVolumeUp size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      Generate TTS ({granularity || 'sentence'})
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="playback-controls">
              <label className="playback-speed-label" title="Faster playback for TTS" style={{ display: 'none' }}>
                Speed
                <select
                  value={String(playbackSpeed)}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  className="playback-speed-select"
                >
                  <option value="1">1x</option>
                  <option value="1.25">1.25x</option>
                  <option value="1.5">1.5x</option>
                </select>
              </label>
              <button
                onClick={() => {
                  // CRITICAL: Clear all segment playback flags BEFORE toggling playback
                  // Clear refs first, then state, to ensure no race conditions
                  console.log('[Main Play] Clearing all segment flags for full audio playback');

                  // Clear all flags synchronously
                  playingSegmentIdRef.current = null;
                  playingScriptSegmentIdRef.current = null;
                  isProgrammaticPlayRef.current = false;
                  setPlayingSegmentId(null);
                  setPlayingScriptSegmentId(null);

                  // Toggle playback immediately - flags are now cleared
                  // The audioprocess handler will skip all segment logic because isProgrammaticPlayRef is false
                  wavesurferRef.current?.playPause();

                  console.log('[Main Play] Playback toggled. isProgrammaticPlayRef:', isProgrammaticPlayRef.current, 'playingSegmentIdRef:', playingSegmentIdRef.current);
                }}
                disabled={!isReady}
                className="btn-play"
              >
                {isPlaying ? (
                  <>
                    <HiOutlinePause size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Pause
                  </>
                ) : (
                  <>
                    <HiOutlinePlay size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Play
                  </>
                )}
              </button>
              <button
                onClick={() => wavesurferRef.current?.stop()}
                disabled={!isReady}
              >
                <HiOutlineStop size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Stop
              </button>
              <span className="time-display">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              {perSectionMode && (
                <span
                  style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.78rem', background: '#1a2e3b', color: '#5ab4f7', border: '1px solid #2a5278', marginLeft: '4px' }}
                  title="Per-section audio mode: each EPUB section uses its own audio file"
                >
                  Per-section {perSectionAudioFiles[currentSectionIndex] ? `(${perSectionAudioFiles[currentSectionIndex].source === 'tts' ? 'TTS' : 'Upload'})` : '(no audio)'}
                </span>
              )}
            </div>


            <div className="zoom-control">
              <span>Zoom:</span>
              <input
                type="range"
                min="10"
                max="200"
                value={zoom}
                onChange={(e) => setZoom(parseInt(e.target.value))}
              />
              <span>{zoom}x</span>
            </div>
          </div>

          {/* Waveform */}
          <div className="waveform-container">
            <div id="timeline" className="timeline"></div>
            <div ref={waveformRef} className="waveform"></div>

            {!audioUrl && (
              <div className="waveform-placeholder">
                <p>
                  <HiOutlineVolumeUp size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                  {perSectionMode
                    ? 'No audio for this section — open Manual section boundaries to upload or generate TTS'
                    : 'Upload or generate audio to see waveform'}
                </p>
              </div>
            )}
          </div>

          {/* Track Legend */}
          <div className="track-legend">
            <div className="legend-item sentence">
              <span className="legend-color"></span>
              <span>Sentences ({Object.keys(syncData.sentences).length})</span>
            </div>
            <div className="legend-item word">
              <span className="legend-color"></span>
              <span>Words ({Object.keys(syncData.words).length})</span>
            </div>
          </div>

          {/* Magic Sync Section */}
          <div className="auto-sync-section">
            <div className="auto-sync-header">
              <h3><HiOutlineCog size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Magic Sync</h3>
              <span className={`aeneas-badge ${aeneasAvailable ? 'available' : 'unavailable'}`}>
                {aeneasAvailable === null ? '...' : aeneasAvailable ? (
                  <>
                    <HiOutlineCheckCircle size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Aeneas Ready
                  </>
                ) : (
                  <>
                    <HiOutlineXCircle size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Aeneas Not Available
                  </>
                )}
              </span>
            </div>

            <div className="auto-sync-controls">
              <button
                onClick={handleRunAlignment}
                disabled={!audioUrl || !isReady || autoSyncing}
                className="btn-align"
                title="Aligns audio to text (Aeneas). Run this after TTS for accurate highlights."
                style={{ marginRight: '10px', display: 'none' }}
              >
                <HiOutlineCalculator size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                {autoSyncing ? 'Aligning...' : 'Run alignment (auto)'}
              </button>
              <button
                type="button"
                onClick={openManualSectionBoundaries}
                disabled={autoSyncing || sections.length === 0}
                className="btn-align btn-manual-boundaries"
                title="Upload or generate audio per section, then run alignment"
                style={{
                  marginRight: '10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '10px 20px',
                  background: (autoSyncing || sections.length === 0)
                    ? '#333'
                    : 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: (autoSyncing || sections.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (autoSyncing || sections.length === 0) ? 0.6 : 1,
                  fontWeight: '600',
                  fontSize: '14px',
                  transition: 'all 0.2s ease',
                  boxShadow: (autoSyncing || sections.length === 0) ? 'none' : '0 2px 8px rgba(14, 165, 233, 0.3)'
                }}
              >
                <HiOutlineDocumentText size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                Manual section boundaries
              </button>
              <button
                onClick={handleMagicSync}
                disabled={!isReady || autoSyncing}
                className="btn-magic-sync"
                title="Hybrid Gemini Alignment - Intelligently skips TOC and unspoken content"
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  cursor: autoSyncing || !isReady ? 'not-allowed' : 'pointer',
                  opacity: autoSyncing || !isReady ? 0.6 : 1,
                  fontWeight: 'bold',
                  display: 'none'
                }}
              >
                {autoSyncing ? (
                  <>
                    <HiOutlineClock size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Syncing...
                  </>
                ) : (
                  <>
                    <HiOutlineStar size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Magic Sync
                  </>
                )}
              </button>

              <button
                onClick={async () => {
                  if (window.confirm('Clear all sync data for this job? You will need to re-sync.')) {
                    try {
                      await audioSyncService.deleteAudioSyncsByJob(parseInt(jobId));

                      // Clear waveform regions
                      if (regionsPluginRef.current) {
                        regionsPluginRef.current.clearRegions();
                      }

                      // Re-initialize syncData with all parsedElements as UNSYNCED
                      // This ensures text blocks remain visible after clearing
                      const newSentences = {};
                      const newWords = {};

                      parsedElements.forEach(element => {
                        // Extract page number from ID
                        const pageMatch = element.id.match(/page(\d+)/);
                        let pageNum = 1;
                        if (pageMatch) {
                          pageNum = parseInt(pageMatch[1]);
                        } else if (element.sectionIndex !== undefined) {
                          pageNum = element.sectionIndex + 1;
                        } else if (element.pageNumber) {
                          pageNum = element.pageNumber;
                        }

                        // Determine if it's a word or sentence/paragraph
                        if (element.type === 'word' || element.id.includes('_w')) {
                          newWords[element.id] = {
                            id: element.id,
                            text: element.text || '',
                            pageNumber: pageNum,
                            status: 'UNSYNCED',
                            parentId: element.parentId
                          };
                        } else {
                          newSentences[element.id] = {
                            id: element.id,
                            text: element.text || '',
                            pageNumber: pageNum,
                            status: 'UNSYNCED'
                          };
                        }
                      });

                      setSyncData({ sentences: newSentences, words: newWords });
                      console.log(`[Clear] Re-initialized ${Object.keys(newSentences).length} sentences and ${Object.keys(newWords).length} words as UNSYNCED`);

                      alert('Sync data cleared. All text blocks are now available for syncing.');
                    } catch (err) {
                      setError('Failed to clear sync data: ' + err.message);
                    }
                  }
                }}
                disabled={autoSyncing}
                className="btn-clear-sync"
                title="Clear all sync data and start fresh"
              >
                <HiOutlineTrash size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Clear
              </button>
            </div>

            {autoSyncProgress && (
              <div className="auto-sync-progress">
                <span className="progress-spinner"><HiOutlineClock size={16} /></span>
                <span>{autoSyncProgress}</span>
              </div>
            )}

            <p className="auto-sync-hint">
              {aeneasAvailable
                ? (
                  <>
                    <HiOutlineCheckCircle size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Aeneas analyzes audio phonemes. Run alignment after TTS for accurate text–audio sync. | <HiOutlineSparkles size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Magic Sync uses AI to skip TOC/unspoken content
                  </>
                ) : (
                  <>
                    <HiOutlineCalculator size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Linear spread calculates timings based on character count
                  </>
                )}
            </p>
          </div>

          {/* Recording Controls (Manual Tap-to-Sync) */}
          <div className="recording-section">
            <div className="section-header">
              <h3><HiOutlineMicrophone size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Manual Tap-to-Sync</h3>
            </div>
            <div className="recording-controls">
              <button
                onClick={toggleRecording}
                disabled={!isReady}
                className={`btn-record ${isRecording ? 'recording' : ''}`}
              >
                {isRecording ? (
                  <>
                    <HiOutlineStop size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Stop Recording
                  </>
                ) : (
                  <>
                    <HiOutlineMicrophone size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Start Tap-to-Sync
                  </>
                )}
              </button>

              {isRecording && (
                <div className="recording-status">
                  <span className="recording-indicator">●</span>
                  <span>Hold SPACEBAR to mark sentences {currentSentenceIndex + 1} / {parsedElements.filter(el => {
                    return (el.sectionIndex === currentSectionIndex) && (el.type === 'sentence' || el.type === 'paragraph');
                  }).length} (Page {currentPageNumber})</span>
                  <span className="counter">
                    {currentSentenceIndex} / {parsedElements.filter(e => e.type !== 'word').length}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleRefreshWordMap}
              disabled={Object.keys(syncData.sentences).length === 0}
              className="btn-refresh"
            >
              <HiOutlineRefresh size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Refresh Word Map
            </button>
          </div>

          {/* Settings */}
          <div className="settings-panel">
            <label className="setting">
              <input
                type="checkbox"
                checked={snapToSilence}
                onChange={(e) => setSnapToSilence(e.target.checked)}
              />
              <span><HiOutlinePaperClip size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Snap to Silence</span>
            </label>
            <label className="setting">
              <input
                type="checkbox"
                checked={showWordTrack}
                onChange={(e) => setShowWordTrack(e.target.checked)}
              />
              <span><HiOutlineDocumentText size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Show Word Track</span>
            </label>
            <label className="setting">
              <input
                type="checkbox"
                checked={scrubOnDrag}
                onChange={(e) => setScrubOnDrag(e.target.checked)}
              />
              <span><HiOutlineVolumeUp size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Scrub on Drag</span>
            </label>
          </div>
        </main>

        {/* Right Resizable Divider */}
        <div
          className="studio-divider studio-divider-right"
          onMouseDown={handleRightResizeStart}
          style={{ cursor: 'col-resize' }}
        >
          <div className="studio-divider-handle" />
        </div>

        {/* Right Panel: Sync List */}
        <aside
          className="sync-panel"
          style={{ width: `${rightPanelWidth}px`, minWidth: `${rightPanelWidth}px`, maxWidth: `${rightPanelWidth}px` }}
        >
          <div className="panel-header">
            <h3><HiOutlineClipboard size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Page {currentPageNumber} Sync</h3>
            
            {/* Auto-save indicator */}
            {autoSaveIndicator && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                backgroundColor: '#10b981',
                color: 'white',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '500',
                marginLeft: '12px',
                animation: 'fadeIn 0.2s ease-in'
              }}>
                <HiOutlineCheckCircle size={14} />
                Reading order saved
              </div>
            )}
            
            <div className="page-nav-buttons">
              <button
                onClick={() => handleSectionChange(Math.max(0, currentSectionIndex - 1))}
                disabled={currentSectionIndex === 0}
                className="btn-page-nav"
              >
                <HiOutlineChevronLeft size={14} />
              </button>
              <span className="page-indicator">Section {currentSectionIndex + 1} / {sections.length} (Page {currentPageNumber})</span>
              <button
                onClick={() => handleSectionChange(Math.min(sections.length - 1, currentSectionIndex + 1))}
                disabled={currentSectionIndex >= sections.length - 1}
                className="btn-page-nav"
              >
                <HiOutlinePlay size={14} />
              </button>
            </div>
          </div>

          {/* Page Stats */}
          <div className="page-stats">
            <span className="stat">
              <HiOutlineDocumentText size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> {[
                // Sentences: exclude word ids (avoid double-count)
                ...Object.entries(syncData.sentences).filter(([id]) => !id.includes('_w')).map(([id, data]) => ({ id, data })),
                // Words: only word ids from words
                ...Object.entries(syncData.words).filter(([id]) => id.includes('_w')).map(([id, data]) => ({ id, data }))
              ].filter(({ id, data }) => {
                const pe = parsedElements.find(el => el.id === id);
                const isCorrectSection = pe && pe.sectionIndex === currentSectionIndex;
                const isCorrectPage = data.pageNumber === currentPageNumber;
                const show = pe ? isCorrectSection : isCorrectPage;
                if (!show) return false;
                const el = pe || { id, type: inferSyncElementTypeFromId(id) };
                return parsedElementMatchesGranularityExport(granularity, el, parsedElements.map((e) => e.id));
              }).length} {granularity === 'word' ? 'words' : granularity === 'sentence' ? 'sentences' : 'paragraphs'}
            </span>
            <span className="stat">
              <HiOutlineHashtag size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> {Object.entries(syncData.words).filter(([id, data]) => {
                const parsedElement = parsedElements.find(el => el.id === id);
                return parsedElement ? (parsedElement.sectionIndex === currentSectionIndex) : (data.pageNumber === currentPageNumber);
              }).length} words
            </span>
          </div>

          <div className="sync-list">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis]}
            >
              <SortableContext
                items={sortedIds}
                strategy={verticalListSortingStrategy}
              >
                {sortedIds.map((id, index) => {
                  const data = syncData.sentences[id] || syncData.words[id];
                  if (!data) return null;

                  const isSkipped = data.status === 'SKIPPED';
                  const isUnsynced = data.status === 'UNSYNCED';

                  return (
                    <SortableItem key={id} id={id}>
                      {({ attributes, listeners, isDragging }) => (
                        <div
                          className={`sync-item ${activeRegionId === id ? 'active' : ''} ${isSkipped ? 'skipped' : ''} ${isUnsynced ? 'unsynced' : ''} ${selectedBlockForSync === id && isRecording ? 'selected-for-sync' : ''} ${isDragging ? 'dragging' : ''}`}
                          style={{
                            position: 'relative'
                          }}
                          onMouseEnter={() => {
                            // Highlight Sync on hover
                            highlightElement(data.id);
                          }}
                          onClick={() => {
                            if (isSkipped) return;

                            const pe = parsedElements.find(el => el.id === id);
                            const el = pe || { id, type: inferSyncElementTypeFromId(id) };

                            // Tap Sync Logic
                            if (isRecording) {
                              if (!parsedElementMatchesGranularityExport(granularity, el, parsedElements.map((e) => e.id))) {
                                return;
                              }

                              setSelectedBlockForSync(id);
                              setActiveRegionId(id);
                              highlightElement(data.id);
                              return;
                            }

                            if (isUnsynced) return;
                            setActiveRegionId(id);
                            highlightElement(data.id);
                            if (wavesurferRef.current && data.start !== undefined) {
                              wavesurferRef.current.setTime(data.start);
                            }
                          }}
                        >
                          {/* Drag Handle */}
                          <div
                            {...attributes}
                            {...listeners}
                            className="drag-handle"
                            style={{
                              position: 'absolute',
                              left: '4px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              padding: '4px',
                              cursor: 'grab',
                              color: '#666',
                              zIndex: 10
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <HiOutlineSelector />
                          </div>

                          <div className="sync-item-content" style={{ paddingLeft: '24px' }}>
                            <div className="sync-item-header">
                              <span className="sync-index" style={{
                                background: '#1976d2',
                                color: '#fff',
                                borderRadius: '50%',
                                width: '20px',
                                height: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11px',
                                marginRight: '8px',
                                fontWeight: 'bold'
                              }}>
                                {index + 1}
                              </span>
                              <span className="sync-id" title={data.id || id}>{data.id || id || 'No ID'}</span>
                              {isSkipped ? (
                                <span className="badge-skipped">Not in Audio</span>
                              ) : isUnsynced ? (
                                <span className="badge-unsynced">Not Synced</span>
                              ) : (
                                <span className="sync-time">
                                  {formatTime(data.start)} - {formatTime(data.end)}
                                </span>
                              )}
                            </div>
                            {editingBlockId === id ? (
                              <div className="edit-text-container">
                                <textarea
                                  value={editedText}
                                  onChange={(e) => setEditedText(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    width: '100%',
                                    minHeight: '60px',
                                    padding: '8px',
                                    fontSize: '13px',
                                    border: '2px solid #1976d2',
                                    borderRadius: '4px',
                                    fontFamily: 'inherit',
                                    resize: 'vertical',
                                    marginBottom: '8px'
                                  }}
                                  autoFocus
                                  placeholder="Edit text here..."
                                />
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                    {!isUnsynced && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleClearSync(id);
                                        }}
                                        style={{
                                          padding: '4px 8px',
                                          border: '1px solid #f44336',
                                          borderRadius: '4px',
                                          backgroundColor: '#ffebee',
                                          color: '#c62828',
                                          cursor: 'pointer',
                                          fontSize: '11px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '4px'
                                        }}
                                        title="Clear sync timing to allow resyncing"
                                      >
                                        <HiOutlineRefresh size={12} />
                                        Clear Sync
                                      </button>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSaveEdit(id);
                                      }}
                                      disabled={regeneratingBlock === id}
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCancelEdit();
                                      }}
                                      disabled={regeneratingBlock === id}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                                {regeneratingBlock === id && (
                                  <div style={{ fontSize: '11px', color: '#1976d2', marginTop: '4px', fontStyle: 'italic' }}>
                                    <HiOutlineSun size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Regenerating audio with new text...
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="sync-text" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                <span style={{ flex: 1 }}>{data.text || 'No text'}</span>
                                {!isSkipped && (
                                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                    {!isUnsynced && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleClearSync(id);
                                        }}
                                        className="btn-clear-sync"
                                      >
                                        <HiOutlineRefresh size={12} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Word children */}
                            {showWordTrack && (
                              <div className="word-children">
                                {Object.entries(syncData.words)
                                  .filter(([, wdata]) => {
                                    // Match words whose parent ID matches this sentence's original ID
                                    const sentenceOriginalId = data.id;
                                    return wdata.parentId === sentenceOriginalId && wdata.pageNumber === data.pageNumber;
                                  })
                                  .sort((a, b) => a[1].start - b[1].start)
                                  .map(([wid, wdata]) => (
                                    <div
                                      key={wid}
                                      className={`word-item ${activeRegionId === wid ? 'active' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveRegionId(wid);
                                        highlightElement(wdata.id);
                                        if (wavesurferRef.current) {
                                          wavesurferRef.current.setTime(wdata.start);
                                        }
                                      }}
                                    >
                                      <span className="word-id">{wdata.id?.split('_w')[1] || '?'}</span>
                                      <span className="word-text">{wdata.text}</span>
                                    </div>
                                  ))
                                }
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </SortableItem>
                  );
                })}
              </SortableContext>

              <DragOverlay>
                {activeDragId ? (
                  <div style={{
                    padding: '10px',
                    background: '#333',
                    borderRadius: '4px',
                    border: '1px solid #1976d2',
                    color: '#fff',
                    boxShadow: '0 5px 15px rgba(0,0,0,0.5)'
                  }}>
                    <span style={{ fontWeight: 'bold' }}>Moving Block...</span>
                  </div>
                ) : null}
              </DragOverlay>

            </DndContext>
            {sortedIds.length === 0 && (
              <div className="empty-state">
                <p>No {granularity === 'word' ? 'words' : granularity === 'sentence' ? 'sentences' : 'paragraphs'} found for Page {currentPageNumber}.</p>
                <p>Text blocks will appear here once the page content is loaded.</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Manual Section Boundaries Modal (reflowable = FXL-style) */}
      {showManualSectionBoundaries && (
        <div
          className="manual-section-boundaries-overlay"
          onClick={() => setShowManualSectionBoundaries(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            className="manual-section-boundaries-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1e1e1e',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '560px',
              width: '100%',
              maxHeight: '85vh',
              overflow: 'auto',
              border: '1px solid #333'
            }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Manual section boundaries</h3>
            <p style={{ color: '#aaa', fontSize: '0.9rem', margin: '0 0 12px 0' }}>
              Each section uses its own audio file. Upload or generate TTS per section.
            </p>
            <p style={{ color: '#888', fontSize: '0.82rem', margin: '0 0 12px 0' }}>
              Generate TTS already sets timings for that section. Use &quot;Run alignment with section audio&quot; only when you have uploaded audio and need to align text to it.
            </p>

            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #444' }}>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Section</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Audio File</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((section, sectionIdx) => {
                    const audioFileName = perSectionAudioFiles[sectionIdx]?.fileName
                      || manualSectionBoundaries.find(b => b.sectionIndex === sectionIdx)?.audioFileName
                      || null;
                    const sectionLabel = section.title || `Section ${sectionIdx + 1}`;
                    return (
                      <tr key={`section-${sectionIdx}`} style={{ borderBottom: '1px solid #333' }}>
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{sectionLabel}</td>
                        <td style={{ padding: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                type="file"
                                accept="audio/*"
                                hidden
                                onChange={e => { const f = e.target.files[0]; if (f) handleSectionAudioUpload(sectionIdx, f); e.target.value = ''; }}
                              />
                              <span style={{
                                padding: '3px 10px', background: '#2a2a2a', border: '1px solid #555',
                                borderRadius: '4px', color: '#ccc', fontSize: '0.82rem', cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}>
                                Upload
                              </span>
                            </label>
                            <button
                              type="button"
                              disabled={generating}
                              onClick={() => handleGenerateSectionAudio(sectionIdx)}
                              style={{
                                padding: '3px 10px', background: '#1e3a2e', border: '1px solid #4A7B54',
                                borderRadius: '4px', color: '#7edd9a', fontSize: '0.82rem', cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              Generate TTS
                            </button>
                            {audioFileName ? (
                              <span style={{ color: '#7edd9a', fontSize: '0.8rem', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={audioFileName}>
                                {audioFileName}
                              </span>
                            ) : (
                              <span style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>No audio</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowManualSectionBoundaries(false)} style={{ padding: '8px 16px', background: '#333', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-align"
                disabled={autoSyncing}
                onClick={handleRunAlignmentWithBoundaries}
                style={{ padding: '8px 16px' }}
              >
                Run alignment with section audio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio Script Modal */}
      {showAudioScript && (
        <div
          className="audio-script-modal-overlay"
          onClick={() => setShowAudioScript(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            className="audio-script-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1a1a1a',
              borderRadius: '8px',
              width: '90%',
              maxWidth: '900px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #444',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px',
              borderBottom: '2px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h2 style={{
                margin: 0,
                color: '#fff',
                fontSize: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <HiOutlineDocumentText size={24} />
                Complete Audio Script
              </h2>
              <button
                onClick={() => setShowAudioScript(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#e0e0e0',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px'
                }}
                onMouseEnter={(e) => e.target.style.background = '#333'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                <HiOutlineX size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{
              padding: '20px',
              overflowY: 'auto',
              flex: 1
            }}>
              {loadingAudioScript ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                  <HiOutlineClock size={32} style={{ marginBottom: '10px', opacity: 0.5 }} />
                  <p>Loading audio script...</p>
                </div>
              ) : (() => {
                // Sort sentences by start time - use audioScriptData from backend
                const sortedSentences = Object.entries(audioScriptData.sentences)
                  .filter(([, data]) => data.status !== 'SKIPPED')
                  .sort((a, b) => a[1].start - b[1].start);

                if (sortedSentences.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                      <p>No audio script available.</p>
                      <p>Sync audio segments to see the script here.</p>
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {sortedSentences.map(([id, data], index) => (
                      <div
                        key={id}
                        style={{
                          background: '#2a2a2a',
                          border: '1px solid #333',
                          borderRadius: '6px',
                          padding: '15px',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#444';
                          e.currentTarget.style.background = '#2f2f2f';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#333';
                          e.currentTarget.style.background = '#2a2a2a';
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          marginBottom: '10px',
                          flexWrap: 'wrap'
                        }}>
                          <span style={{
                            background: '#1976d2',
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            fontSize: '12px',
                            minWidth: '30px',
                            textAlign: 'center'
                          }}>
                            #{index + 1}
                          </span>
                          <span style={{
                            color: '#4caf50',
                            fontFamily: 'Courier New, monospace',
                            fontSize: '13px',
                            fontWeight: '500'
                          }}>
                            {data.id}
                          </span>
                          <span style={{
                            color: '#ffa726',
                            fontSize: '13px',
                            fontFamily: 'Courier New, monospace'
                          }}>
                            {formatTime(data.start)} - {formatTime(data.end)}
                          </span>
                          <span style={{
                            color: '#9e9e9e',
                            fontSize: '12px',
                            marginLeft: 'auto'
                          }}>
                            Page {data.pageNumber}
                          </span>
                        </div>
                        {editingScriptBlockId === id ? (
                          <div>
                            <textarea
                              value={editedScriptText}
                              onChange={(e) => setEditedScriptText(e.target.value)}
                              style={{
                                width: '100%',
                                minHeight: '60px',
                                padding: '8px',
                                fontSize: '13px',
                                border: '2px solid #1976d2',
                                borderRadius: '4px',
                                fontFamily: 'inherit',
                                resize: 'vertical',
                                marginBottom: '8px',
                                background: '#1a1a1a',
                                color: '#e0e0e0'
                              }}
                              autoFocus
                              placeholder="Edit text here..."
                            />
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              <button
                                onClick={() => handleSaveEditScript(id)}
                                disabled={regeneratingScriptBlock === id}
                                style={{
                                  padding: '4px 12px',
                                  border: '1px solid #4caf50',
                                  borderRadius: '4px',
                                  backgroundColor: regeneratingScriptBlock === id ? '#81c784' : '#4caf50',
                                  color: 'white',
                                  cursor: regeneratingScriptBlock === id ? 'not-allowed' : 'pointer',
                                  fontSize: '12px',
                                  opacity: regeneratingScriptBlock === id ? 0.7 : 1
                                }}
                              >
                                {regeneratingScriptBlock === id ? (
                                  <>
                                    <HiOutlineClock size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                    Regenerating...
                                  </>
                                ) : (
                                  <>
                                    <HiOutlineSave size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                    Save & Regenerate
                                  </>
                                )}
                              </button>
                              <button
                                onClick={handleCancelEditScript}
                                disabled={regeneratingScriptBlock === id}
                                style={{
                                  padding: '4px 12px',
                                  border: '1px solid #ccc',
                                  borderRadius: '4px',
                                  backgroundColor: '#fff',
                                  color: '#666',
                                  cursor: regeneratingScriptBlock === id ? 'not-allowed' : 'pointer',
                                  fontSize: '12px',
                                  opacity: regeneratingScriptBlock === id ? 0.5 : 1
                                }}
                              >
                                <HiOutlineX size={14} style={{ verticalAlign: 'middle' }} /> Cancel
                              </button>
                            </div>
                            {regeneratingScriptBlock === id && (
                              <div style={{ fontSize: '11px', color: '#1976d2', marginTop: '4px', fontStyle: 'italic' }}>
                                <HiOutlineSun size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Regenerating audio with new text...
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            <div style={{
                              color: '#e0e0e0',
                              fontSize: '15px',
                              lineHeight: '1.6',
                              padding: '10px',
                              background: '#252525',
                              borderRadius: '4px',
                              whiteSpace: 'pre-wrap',
                              wordWrap: 'break-word',
                              flex: 1
                            }}>
                              {data.text || '(No text)'}
                            </div>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <button
                                onClick={() => handlePlayScriptSegment(id)}
                                disabled={!isReady}
                                style={{
                                  padding: '4px 8px',
                                  border: '1px solid #4caf50',
                                  borderRadius: '4px',
                                  backgroundColor: playingScriptSegmentId === id && isPlaying ? '#c8e6c9' : '#e8f5e9',
                                  color: '#2e7d32',
                                  cursor: !isReady ? 'not-allowed' : 'pointer',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  opacity: !isReady ? 0.5 : 1
                                }}
                                title={playingScriptSegmentId === id && isPlaying ? "Pause playback" : "Play this segment"}
                              >
                                {playingScriptSegmentId === id && isPlaying ? (
                                  <>
                                    <HiOutlinePause size={12} /> Pause
                                  </>
                                ) : (
                                  <>
                                    <HiOutlinePlay size={12} /> Play
                                  </>
                                )}
                              </button>
                              <button
                                onClick={() => handleStartEditScript(id, data.text)}
                                style={{
                                  padding: '4px 8px',
                                  border: '1px solid #1976d2',
                                  borderRadius: '4px',
                                  backgroundColor: '#e3f2fd',
                                  color: '#1976d2',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Edit text"
                              >
                                <HiOutlinePencil size={12} /> Edit
                              </button>
                              <button
                                onClick={() => handleDeleteScriptBlock(id)}
                                style={{
                                  padding: '4px 8px',
                                  border: '1px solid #d32f2f',
                                  borderRadius: '4px',
                                  backgroundColor: '#ffebee',
                                  color: '#d32f2f',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Delete this block"
                              >
                                <HiOutlineTrash size={12} /> Delete
                              </button>
                            </div>
                          </div>
                        )}
                        {audioScriptData.words && Object.entries(audioScriptData.words)
                          .filter(([, wdata]) => wdata.parentId === data.id)
                          .length > 0 && (
                            <div style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '6px',
                              marginTop: '10px',
                              paddingTop: '10px',
                              borderTop: '1px dashed #444'
                            }}>
                              {Object.entries(audioScriptData.words)
                                .filter(([, wdata]) => wdata.parentId === data.id)
                                .sort((a, b) => a[1].start - b[1].start)
                                .map(([wid, wdata]) => (
                                  <span
                                    key={wid}
                                    style={{
                                      background: '#333',
                                      color: '#b0b0b0',
                                      padding: '4px 8px',
                                      borderRadius: '4px',
                                      fontSize: '12px',
                                      border: '1px solid #444'
                                    }}
                                  >
                                    {wdata.text}
                                  </span>
                                ))}
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '15px 20px',
              borderTop: '2px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#1f1f1f'
            }}>
              <div style={{
                display: 'flex',
                gap: '20px',
                fontSize: '14px',
                color: '#b0b0b0'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <HiOutlineDocumentText size={16} />
                  {Object.entries(audioScriptData.sentences).filter(([, data]) => data.status !== 'SKIPPED').length} segments
                </span>
                {(() => {
                  const sorted = Object.entries(audioScriptData.sentences)
                    .filter(([, data]) => data.status !== 'SKIPPED')
                    .sort((a, b) => a[1].start - b[1].start);
                  const totalDuration = sorted.length > 0 ? sorted[sorted.length - 1][1].end : 0;
                  return (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <HiOutlineClock size={16} />
                      {formatTime(totalDuration)} total duration
                    </span>
                  );
                })()}
              </div>
              <button
                onClick={() => setShowAudioScript(false)}
                style={{
                  padding: '8px 16px',
                  background: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
                onMouseEnter={(e) => e.target.style.background = '#1565c0'}
                onMouseLeave={(e) => e.target.style.background = '#1976d2'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostic Modal */}
      {showDiagnostics && diagnosticData && (
        <div
          className="diagnostic-modal-overlay"
          onClick={() => setShowDiagnostics(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            className="diagnostic-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1a1a1a',
              borderRadius: '8px',
              width: '90%',
              maxWidth: '1000px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #444',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px',
              borderBottom: '2px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)'
            }}>
              <h2 style={{
                margin: 0,
                color: '#fff',
                fontSize: '22px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <HiOutlineInformationCircle size={28} color="#ff9800" />
                Audio Playback Diagnostics
              </h2>
              <button
                onClick={() => setShowDiagnostics(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#e0e0e0',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px'
                }}
                onMouseEnter={(e) => e.target.style.background = '#333'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                <HiOutlineX size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{
              padding: '20px',
              overflowY: 'auto',
              flex: 1
            }}>
              {loadingDiagnostics ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                  <HiOutlineClock size={32} style={{ marginBottom: '10px', opacity: 0.5 }} />
                  <p>Loading diagnostics...</p>
                </div>
              ) : diagnosticData.error ? (
                <div style={{
                  padding: '20px',
                  background: '#3d1f1f',
                  border: '1px solid #d32f2f',
                  borderRadius: '6px',
                  color: '#ffcdd2'
                }}>
                  <h3 style={{ marginTop: 0, color: '#f44336' }}>Error</h3>
                  <p>{diagnosticData.error}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Segment ID */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{
                      margin: '0 0 10px 0',
                      color: '#4caf50',
                      fontSize: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <HiOutlineHashtag size={18} />
                      Segment ID: <span style={{ color: '#fff', fontFamily: 'Courier New, monospace' }}>{diagnosticData.segmentId}</span>
                    </h3>
                  </div>

                  {/* Local State */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#64b5f6', fontSize: '16px' }}>
                      📦 Local State (syncData)
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Text:</span>
                        <div style={{
                          color: '#e0e0e0',
                          marginTop: '4px',
                          padding: '8px',
                          background: '#1a1a1a',
                          borderRadius: '4px',
                          border: '1px solid #333',
                          wordBreak: 'break-word'
                        }}>
                          {diagnosticData.localState.text}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Page Number:</span>
                        <div style={{ color: '#e0e0e0', marginTop: '4px' }}>
                          {diagnosticData.localState.pageNumber || 'N/A'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Start Time:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.localState.start !== undefined ? `${diagnosticData.localState.start.toFixed(3)}s` : 'NOT SET'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>End Time:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.localState.end !== undefined ? `${diagnosticData.localState.end.toFixed(3)}s` : 'NOT SET'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Duration:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.localState.duration !== null ? `${diagnosticData.localState.duration.toFixed(3)}s` : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Edit State */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#ba68c8', fontSize: '16px' }}>
                      ✏️ Edit State
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Currently Editing:</span>
                        <div style={{
                          color: diagnosticData.editState.isEditing ? '#4caf50' : '#9e9e9e',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {diagnosticData.editState.isEditing ? 'YES' : 'NO'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Text Changed:</span>
                        <div style={{
                          color: diagnosticData.editState.textChanged ? '#ff9800' : '#9e9e9e',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {diagnosticData.editState.textChanged ? 'YES (Unsaved)' : 'NO'}
                        </div>
                      </div>
                      {diagnosticData.editState.editedText && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <span style={{ color: '#9e9e9e' }}>Edited Text (Unsaved):</span>
                          <div style={{
                            color: '#fff3e0',
                            marginTop: '4px',
                            padding: '8px',
                            background: '#3d2f1f',
                            borderRadius: '4px',
                            border: '1px solid #ff9800',
                            wordBreak: 'break-word'
                          }}>
                            {diagnosticData.editState.editedText}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Playback State */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                      <h3 style={{ margin: 0, color: '#4caf50', fontSize: '16px' }}>
                        ▶️ Playback State
                      </h3>
                      {diagnosticData.localState.start !== undefined && diagnosticData.localState.end !== undefined && (
                        <button
                          onClick={() => {
                            const segmentId = diagnosticData.segmentId;
                            const expectedText = diagnosticData.localState.text;

                            console.log(`[Diagnostics] Testing playback for segment ${segmentId}`);
                            console.log(`[Diagnostics] Expected text: "${expectedText}"`);
                            console.log(`[Diagnostics] Playback timings: ${diagnosticData.localState.start.toFixed(3)}s - ${diagnosticData.localState.end.toFixed(3)}s`);

                            // Clear previous transcription
                            setTranscribedText('');

                            // Start speech recognition before playing
                            const recognition = startSpeechRecognition(segmentId, expectedText);

                            // Play the segment
                            handlePlaySegment(segmentId);

                            // Update diagnostics after a short delay to show playback state
                            setTimeout(() => {
                              handleDiagnostics(segmentId);
                            }, 500);

                            // Stop recognition when playback ends
                            const segmentData = syncDataRef.current.sentences[segmentId];
                            if (segmentData && segmentData.end && segmentData.start) {
                              const duration = (segmentData.end - segmentData.start) * 1000 + 3000; // Add 3 second buffer
                              setTimeout(() => {
                                stopSpeechRecognition();
                              }, duration);
                            }
                          }}
                          disabled={!diagnosticData.playbackState.isReady}
                          style={{
                            padding: '8px 16px',
                            background: diagnosticData.playbackState.isReady ? '#4caf50' : '#666',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: diagnosticData.playbackState.isReady ? 'pointer' : 'not-allowed',
                            fontSize: '14px',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            opacity: diagnosticData.playbackState.isReady ? 1 : 0.5
                          }}
                          title={diagnosticData.playbackState.isReady
                            ? `Play segment to test if it reads: "${diagnosticData.localState.text}"`
                            : 'Audio not ready'}
                          onMouseEnter={(e) => {
                            if (diagnosticData.playbackState.isReady) {
                              e.target.style.background = '#45a049';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (diagnosticData.playbackState.isReady) {
                              e.target.style.background = '#4caf50';
                            }
                          }}
                        >
                          {playingSegmentId === diagnosticData.segmentId && isPlaying ? (
                            <>
                              <HiOutlinePause size={16} />
                              Pause Test
                            </>
                          ) : (
                            <>
                              <HiOutlinePlay size={16} />
                              Test Playback
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Is Playing:</span>
                        <div style={{
                          color: playingSegmentId === diagnosticData.segmentId && isPlaying ? '#4caf50' : '#9e9e9e',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {playingSegmentId === diagnosticData.segmentId && isPlaying ? 'YES' : 'NO'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Audio Ready:</span>
                        <div style={{
                          color: diagnosticData.playbackState.isReady ? '#4caf50' : '#f44336',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {diagnosticData.playbackState.isReady ? 'YES' : 'NO'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Waveform Time:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.playbackState.waveformTime.toFixed(3)}s
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>Waveform Duration:</span>
                        <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                          {diagnosticData.playbackState.waveformDuration.toFixed(3)}s
                        </div>
                      </div>
                    </div>
                    {diagnosticData.localState.text && (
                      <>
                        <div style={{
                          marginTop: '15px',
                          padding: '10px',
                          background: '#1a1a1a',
                          borderRadius: '4px',
                          border: '1px solid #4caf50'
                        }}>
                          <div style={{ color: '#9e9e9e', fontSize: '12px', marginBottom: '4px' }}>
                            Expected Text (should hear this):
                          </div>
                          <div style={{
                            color: '#4caf50',
                            fontSize: '14px',
                            fontWeight: '500',
                            fontStyle: 'italic'
                          }}>
                            "{diagnosticData.localState.text}"
                          </div>
                        </div>

                        {/* Speech-to-Text Transcription Container */}
                        <div style={{
                          marginTop: '15px',
                          padding: '12px',
                          background: '#1a1a1a',
                          borderRadius: '4px',
                          border: transcribedText ? '1px solid #64b5f6' : '1px solid #666',
                          minHeight: '80px'
                        }}>
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '8px'
                          }}>
                            <div style={{ color: '#64b5f6', fontSize: '12px', fontWeight: '500' }}>
                              🎤 Transcribed Text (what was actually heard):
                            </div>
                            {isTranscribing && (
                              <div style={{
                                color: '#ff9800',
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}>
                                <span style={{
                                  display: 'inline-block',
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  background: '#ff9800',
                                  animation: 'pulse 1.5s infinite'
                                }}></span>
                                Listening...
                              </div>
                            )}
                          </div>
                          {transcribedText && transcribedText !== 'Listening...' ? (
                            <div style={{
                              color: transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim()
                                ? '#4caf50'
                                : '#ff9800',
                              fontSize: '14px',
                              fontWeight: '500',
                              fontStyle: 'italic',
                              wordBreak: 'break-word',
                              padding: '8px',
                              background: transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim()
                                ? 'rgba(76, 175, 80, 0.1)'
                                : 'rgba(255, 152, 0, 0.1)',
                              borderRadius: '4px',
                              border: `1px solid ${transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim() ? '#4caf50' : '#ff9800'}`
                            }}>
                              "{transcribedText}"
                            </div>
                          ) : (
                            <div style={{
                              color: '#9e9e9e',
                              fontSize: '12px',
                              fontStyle: 'italic',
                              padding: '8px'
                            }}>
                              {isTranscribing
                                ? (transcribedText === 'Listening...'
                                  ? '⚠️ Microphone not detecting audio. Check "Root Cause Analysis" below for the actual issue.'
                                  : 'Listening to audio...')
                                : 'Click "Test Playback" to transcribe what you hear (requires microphone access)'}
                            </div>
                          )}

                          {/* Comparison Result */}
                          {transcribedText && diagnosticData.localState.text && (
                            <div style={{
                              marginTop: '10px',
                              padding: '8px',
                              background: transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim()
                                ? 'rgba(76, 175, 80, 0.15)'
                                : 'rgba(244, 67, 54, 0.15)',
                              borderRadius: '4px',
                              border: `1px solid ${transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim() ? '#4caf50' : '#f44336'}`
                            }}>
                              <div style={{
                                color: transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim() ? '#4caf50' : '#f44336',
                                fontSize: '12px',
                                fontWeight: '500'
                              }}>
                                {transcribedText.toLowerCase().trim() === diagnosticData.localState.text.toLowerCase().trim()
                                  ? '✓ Match: Transcribed text matches expected text!'
                                  : '✗ Mismatch: Transcribed text does not match expected text'}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Audio File */}
                  <div style={{
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#64b5f6', fontSize: '16px' }}>
                      🎵 Audio File
                    </h3>
                    <div style={{ fontSize: '14px' }}>
                      <div style={{ marginBottom: '10px' }}>
                        <span style={{ color: '#9e9e9e' }}>Audio URL:</span>
                        <div style={{
                          color: '#e0e0e0',
                          marginTop: '4px',
                          padding: '8px',
                          background: '#1a1a1a',
                          borderRadius: '4px',
                          border: '1px solid #333',
                          fontFamily: 'Courier New, monospace',
                          fontSize: '12px',
                          wordBreak: 'break-all'
                        }}>
                          {diagnosticData.audioFile.url || 'NOT SET'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: '#9e9e9e' }}>File Ready:</span>
                        <div style={{
                          color: diagnosticData.audioFile.isReady ? '#4caf50' : '#f44336',
                          marginTop: '4px',
                          fontWeight: '500'
                        }}>
                          {diagnosticData.audioFile.isReady ? 'YES' : 'NO'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Backend Data */}
                  {diagnosticData.backendData && (
                    <div style={{
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      padding: '15px'
                    }}>
                      <h3 style={{ margin: '0 0 15px 0', color: '#ab47bc', fontSize: '16px' }}>
                        💾 Backend Data (Database)
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Text:</span>
                          <div style={{
                            color: '#e0e0e0',
                            marginTop: '4px',
                            padding: '8px',
                            background: '#1a1a1a',
                            borderRadius: '4px',
                            border: '1px solid #333',
                            wordBreak: 'break-word'
                          }}>
                            {diagnosticData.backendData.text || 'NOT FOUND'}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Sync ID:</span>
                          <div style={{ color: '#e0e0e0', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.backendData.syncId || 'NOT FOUND'}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Start Time:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.backendData.startTime !== undefined ? `${diagnosticData.backendData.startTime.toFixed(3)}s` : 'NOT SET'}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>End Time:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.backendData.endTime !== undefined ? `${diagnosticData.backendData.endTime.toFixed(3)}s` : 'NOT SET'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Region Data */}
                  {diagnosticData.regionData ? (
                    <div style={{
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      padding: '15px'
                    }}>
                      <h3 style={{ margin: '0 0 15px 0', color: '#26a69a', fontSize: '16px' }}>
                        📍 Region Data (Waveform)
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', fontSize: '14px' }}>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Start:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.regionData.start.toFixed(3)}s
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>End:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.regionData.end.toFixed(3)}s
                          </div>
                        </div>
                        <div>
                          <span style={{ color: '#9e9e9e' }}>Duration:</span>
                          <div style={{ color: '#ffa726', marginTop: '4px', fontFamily: 'Courier New, monospace' }}>
                            {diagnosticData.regionData.duration.toFixed(3)}s
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      background: '#3d2f1f',
                      border: '1px solid #ff9800',
                      borderRadius: '6px',
                      padding: '15px',
                      color: '#ffcc80'
                    }}>
                      <h3 style={{ margin: '0 0 10px 0', color: '#ff9800', fontSize: '16px' }}>
                        ⚠️ Region Data
                      </h3>
                      <p style={{ margin: '0 0 15px 0' }}>Region not found on waveform. The segment may need to be re-synced.</p>
                      {diagnosticData.localState.start !== undefined && diagnosticData.localState.end !== undefined && (
                        <button
                          onClick={() => {
                            const segmentId = diagnosticData.segmentId;
                            const start = diagnosticData.localState.start;
                            const end = diagnosticData.localState.end;

                            if (regionsPluginRef.current && isReady) {
                              // Check if region already exists
                              const existingRegion = regionsPluginRef.current.getRegions().find(r => r.id === segmentId);
                              if (existingRegion) {
                                existingRegion.setOptions({ start, end });
                                console.log(`[Region] Updated existing region for ${segmentId}`);
                              } else {
                                createRegion(segmentId, start, end, 'sentence');
                                console.log(`[Region] Created region for ${segmentId}`);
                              }
                              // Refresh diagnostics
                              handleDiagnostics(segmentId);
                            } else {
                              alert('Audio is not ready yet. Please wait for the audio to load completely.');
                            }
                          }}
                          style={{
                            padding: '8px 16px',
                            background: '#ff9800',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: isReady ? 'pointer' : 'not-allowed',
                            fontSize: '14px',
                            fontWeight: '500',
                            opacity: isReady ? 1 : 0.5
                          }}
                          disabled={!isReady}
                          onMouseEnter={(e) => {
                            if (isReady) e.target.style.background = '#fb8c00';
                          }}
                          onMouseLeave={(e) => {
                            if (isReady) e.target.style.background = '#ff9800';
                          }}
                        >
                          🔧 Recreate Region Now
                        </button>
                      )}
                    </div>
                  )}

                  {/* Root Cause Analysis */}
                  {diagnosticData.rootCauseAnalysis && diagnosticData.rootCauseAnalysis.length > 0 && (
                    <div style={{
                      background: '#1f1f3d',
                      border: '1px solid #673ab7',
                      borderRadius: '6px',
                      padding: '15px'
                    }}>
                      <h3 style={{ margin: '0 0 15px 0', color: '#9c27b0', fontSize: '16px' }}>
                        🔍 Root Cause Analysis
                      </h3>
                      {diagnosticData.rootCauseAnalysis.map((analysis, idx) => (
                        <div key={idx} style={{
                          marginBottom: idx < diagnosticData.rootCauseAnalysis.length - 1 ? '15px' : '0',
                          padding: '12px',
                          background: '#2a2a3d',
                          borderRadius: '4px',
                          border: '1px solid #444'
                        }}>
                          <div style={{
                            color: '#ff9800',
                            fontSize: '14px',
                            fontWeight: '600',
                            marginBottom: '6px'
                          }}>
                            Issue #{idx + 1}: {analysis.issue}
                          </div>
                          <div style={{ color: '#e0e0e0', fontSize: '13px', marginBottom: '6px' }}>
                            <strong>Description:</strong> {analysis.description}
                          </div>
                          <div style={{ color: '#ffcdd2', fontSize: '13px', marginBottom: '6px' }}>
                            <strong>Impact:</strong> {analysis.impact}
                          </div>
                          <div style={{ color: '#c8e6c9', fontSize: '13px', marginBottom: analysis.details ? '8px' : '0' }}>
                            <strong>Solution:</strong> {analysis.solution}
                          </div>
                          {analysis.details && analysis.details.length > 0 && (
                            <div style={{ marginTop: '8px', padding: '8px', background: '#1a1a2a', borderRadius: '4px' }}>
                              <div style={{ color: '#9e9e9e', fontSize: '12px', marginBottom: '4px' }}>Details:</div>
                              {analysis.details.map((detail, detailIdx) => (
                                <div key={detailIdx} style={{
                                  color: '#e0e0e0',
                                  fontSize: '12px',
                                  marginBottom: '4px',
                                  paddingLeft: '12px',
                                  fontFamily: 'Courier New, monospace'
                                }}>
                                  • {detail.blockId}: "{detail.text}" ({detail.startTime?.toFixed(3)}s - {detail.endTime?.toFixed(3)}s)
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Mismatches */}
                  {diagnosticData.mismatches && diagnosticData.mismatches.length > 0 && (
                    <div style={{
                      background: '#3d1f1f',
                      border: '1px solid #d32f2f',
                      borderRadius: '6px',
                      padding: '15px'
                    }}>
                      <h3 style={{ margin: '0 0 15px 0', color: '#f44336', fontSize: '16px' }}>
                        ⚠️ Detected Issues
                      </h3>
                      <ul style={{ margin: 0, paddingLeft: '20px', color: '#ffcdd2' }}>
                        {diagnosticData.mismatches.map((mismatch, idx) => (
                          <li key={idx} style={{ marginBottom: '8px' }}>{mismatch}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recommendations */}
                  <div style={{
                    background: '#1f3d1f',
                    border: '1px solid #4caf50',
                    borderRadius: '6px',
                    padding: '15px'
                  }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#4caf50', fontSize: '16px' }}>
                      💡 Recommendations
                    </h3>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: '#c8e6c9' }}>
                      {diagnosticData.recommendations.map((rec, idx) => (
                        <li key={idx} style={{ marginBottom: '8px' }}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '15px 20px',
              borderTop: '2px solid #333',
              display: 'flex',
              justifyContent: 'flex-end',
              background: '#1f1f1f'
            }}>
              <button
                onClick={() => {
                  stopSpeechRecognition();
                  setShowDiagnostics(false);
                }}
                style={{
                  padding: '8px 16px',
                  background: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
                onMouseEnter={(e) => e.target.style.background = '#1565c0'}
                onMouseLeave={(e) => e.target.style.background = '#1976d2'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncStudio;

