import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Play, Upload } from 'lucide-react';
import api from '../services/api';
import { epubcheckHistoryKey } from '../utils/epubCheckerMeta';
import { useAuth } from '../context/AuthContext';
import './AccessibilityWizard.css';
import './EpubConformanceCheck.css';

const emptyResult = {
  valid: null,
  summary: null,
  messages: [],
  publicationTitle: null,
  checkerVersion: null,
  engine: null,
  note: null,
  sourceFileName: null,
};

const EPUB_SEVERITIES = ['FATAL', 'ERROR', 'WARNING', 'INFO'];
const SEVERITY_LABELS = {
  FATAL: 'Fatal',
  ERROR: 'Error',
  WARNING: 'Warning',
  INFO: 'Info',
};

function badgeClassForSeverity(sev) {
  const s = String(sev || '').toUpperCase();
  if (s === 'FATAL') return 'critical';
  if (s === 'ERROR') return 'serious';
  if (s === 'WARNING') return 'moderate';
  return 'minor';
}

function statClassForSeverity(sev) {
  const s = String(sev || '').toUpperCase();
  if (s === 'FATAL') return 'aw-stat-critical';
  if (s === 'ERROR') return 'aw-stat-serious';
  if (s === 'WARNING') return 'aw-stat-moderate';
  return 'aw-stat-minor';
}

function normalizeRelPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function pathBasename(p) {
  const n = normalizeRelPath(p);
  const i = n.lastIndexOf('/');
  return i === -1 ? n : n.slice(i + 1);
}

/** Match EPUBCheck short paths (nav.xhtml) to AI draft paths (OEBPS/nav.xhtml). */
function findDraftIndexForPath(drafts, path) {
  const n = normalizeRelPath(path);
  if (!n) return -1;
  const list = drafts || [];
  let idx = list.findIndex((d) => normalizeRelPath(d.path) === n);
  if (idx >= 0) return idx;
  const bn = pathBasename(n);
  if (!bn) return -1;
  idx = list.findIndex((d) => pathBasename(d.path) === bn);
  if (idx >= 0) return idx;
  return list.findIndex((d) => {
    const dp = normalizeRelPath(d.path);
    return dp.endsWith('/' + n) || n.endsWith('/' + dp);
  });
}

function severityRankMsg(sev) {
  const o = { FATAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
  return o[String(sev || '').toUpperCase()] ?? 9;
}

/**
 * One row per package path: EPUBCheck messages that reference that path + optional AI draft index.
 */
function buildFileIssueGroups(messages, drafts) {
  const list = Array.isArray(messages) ? messages : [];
  const pathToEntries = new Map();

  list.forEach((msg, msgIdx) => {
    const locs = msg.locations || [];
    if (locs.length === 0) {
      if (!pathToEntries.has('')) pathToEntries.set('', []);
      pathToEntries.get('').push({ msg, msgIdx });
      return;
    }
    const seen = new Set();
    for (const loc of locs) {
      const p = normalizeRelPath(loc.path);
      if (!p || seen.has(p)) continue;
      seen.add(p);
      if (!pathToEntries.has(p)) pathToEntries.set(p, []);
      pathToEntries.get(p).push({ msg, msgIdx });
    }
  });

  const allPaths = new Set();
  for (const p of pathToEntries.keys()) {
    if (p) allPaths.add(p);
  }
  const messageBasenames = new Set(
    [...pathToEntries.keys()].filter(Boolean).map((p) => pathBasename(p))
  );
  for (const d of drafts || []) {
    const p = normalizeRelPath(d.path);
    if (!p) continue;
    if (messageBasenames.has(pathBasename(p))) continue;
    allPaths.add(p);
  }

  const pathList = [...allPaths];
  pathList.sort((a, b) => {
    const entriesA = pathToEntries.get(a) || [];
    const entriesB = pathToEntries.get(b) || [];
    const ra = entriesA.length
      ? Math.min(...entriesA.map((e) => severityRankMsg(e.msg.severity)))
      : 9;
    const rb = entriesB.length
      ? Math.min(...entriesB.map((e) => severityRankMsg(e.msg.severity)))
      : 9;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  let orphan = pathToEntries.get('') || [];
  const opfPath = pathList.find((p) => /(^|\/)content\.opf$/i.test(p));
  if (orphan.length > 0 && opfPath) {
    const cur = pathToEntries.get(opfPath) || [];
    const seen = new Set(cur.map((e) => e.msgIdx));
    for (const o of orphan) {
      if (!seen.has(o.msgIdx)) {
        cur.push(o);
        seen.add(o.msgIdx);
      }
    }
    pathToEntries.set(opfPath, cur);
    orphan = [];
  }

  const groups = pathList.map((path) => ({
    path,
    entries: pathToEntries.get(path) || [],
    draftIndex: findDraftIndexForPath(drafts, path),
  }));

  if (orphan.length > 0) {
    groups.unshift({
      path: null,
      pathLabel: 'Package-wide (no location path)',
      entries: orphan,
      draftIndex: findDraftIndexForPath(drafts, opfPath || 'content.opf'),
    });
  }

  return groups;
}

const EpubConformanceCheck = ({
  checkerPageLayout = false,
  onCheckerUiState,
  onFileUploaded,
}) => {
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  /** 'errors' | 'errors-warnings' | 'full' — used when checkerPageLayout */
  const [checkLevel, setCheckLevel] = useState('errors');
  const [includeNoticesExtra, setIncludeNoticesExtra] = useState(false);
  const [prefAutoFix, setPrefAutoFix] = useState(true);
  const [prefAiDrafts, setPrefAiDrafts] = useState(true);
  const [prefRecheckAfterFix, setPrefRecheckAfterFix] = useState(true);

  const [file, setFile] = useState(null);
  const [includeWarnings, setIncludeWarnings] = useState(true);
  const [includeNotices, setIncludeNotices] = useState(false);
  const [javaStatus, setJavaStatus] = useState(null);
  const [result, setResult] = useState(emptyResult);
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [repairSessionId, setRepairSessionId] = useState('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [loadingAutoFix, setLoadingAutoFix] = useState(false);
  const [loadingRecheckSession, setLoadingRecheckSession] = useState(false);
  const [loadingFix, setLoadingFix] = useState(false);
  const [autoFixSummary, setAutoFixSummary] = useState('');
  const [fileRepairDrafts, setFileRepairDrafts] = useState([]);
  const [lastDownloadId, setLastDownloadId] = useState('');
  const [aiError, setAiError] = useState('');
  const [error, setError] = useState('');
  /** When AI drafts exist, EPUBCheck messages are hidden by default (toggle to show). */
  const [showIssuesBesideAi, setShowIssuesBesideAi] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/epubcheck/status');
        const data = res.data?.data ?? res.data;
        if (!cancelled) setJavaStatus(data);
      } catch {
        if (!cancelled) setJavaStatus({ javaAvailable: false, checker: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveCheckOptions = useMemo(() => {
    if (checkerPageLayout) {
      return {
        includeWarnings: checkLevel !== 'errors',
        includeNotices:
          checkLevel === 'full' || (checkLevel === 'errors-warnings' && includeNoticesExtra),
      };
    }
    return { includeWarnings, includeNotices };
  }, [
    checkerPageLayout,
    checkLevel,
    includeNoticesExtra,
    includeWarnings,
    includeNotices,
  ]);

  useEffect(() => {
    if (!onCheckerUiState) return;
    let step = 0;
    if (file) step = Math.max(step, 1);
    if (loadingCheck) step = Math.max(step, 1);
    if (result.valid !== null) step = Math.max(step, 2);
    if (loadingAutoFix || (autoFixSummary && String(autoFixSummary).trim().length > 0))
      step = Math.max(step, 3);
    if (loadingAi || fileRepairDrafts.length > 0) step = Math.max(step, 4);
    if (lastDownloadId) step = Math.max(step, 5);
    onCheckerUiState({
      javaStatus,
      stepperStep: step,
      checkerLabel: javaStatus?.checker ?? result.checkerVersion ?? null,
    });
  }, [
    onCheckerUiState,
    file,
    loadingCheck,
    result.valid,
    result.checkerVersion,
    loadingAutoFix,
    autoFixSummary,
    loadingAi,
    fileRepairDrafts.length,
    lastDownloadId,
    javaStatus,
  ]);

  const selectFile = useCallback((selected) => {
    setError('');
    setAiError('');
    setResult(emptyResult);
    setRepairSessionId('');
    setFileRepairDrafts([]);
    setLastDownloadId('');
    setAutoFixSummary('');
    setShowIssuesBesideAi(false);

    if (selected && !selected.name.toLowerCase().endsWith('.epub')) {
      setError('Please select a valid .epub file.');
      setFile(null);
      return;
    }
    setFile(selected);
    if (selected) onFileUploaded?.(selected);
  }, [onFileUploaded]);

  const handleFileChange = (event) => {
    selectFile(event.target.files?.[0] || null);
  };

  const ensureRepairSession = useCallback(async () => {
    if (repairSessionId) return repairSessionId;
    if (!file) return '';
    const fd = new FormData();
    fd.append('file', file);
    const res = await api.post('/epubcheck/repair-session', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const data = res.data?.data ?? res.data;
    const sid = data?.sessionId || '';
    if (sid) setRepairSessionId(sid);
    return sid;
  }, [file, repairSessionId]);

  const handleRunCheck = async (event) => {
    if (event) event.preventDefault();
    setError('');
    setAiError('');
    if (!file) {
      setError('Please select an EPUB file first.');
      return;
    }
    setLoadingCheck(true);
    setRepairSessionId('');
    setFileRepairDrafts([]);
    setLastDownloadId('');
    setAutoFixSummary('');
    setShowIssuesBesideAi(false);

    const params = new URLSearchParams({
      includeWarnings: effectiveCheckOptions.includeWarnings ? 'true' : 'false',
      includeNotices: effectiveCheckOptions.includeNotices ? 'true' : 'false',
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post(`/epubcheck/check?${params.toString()}`, formData);
      const data = response.data?.data ?? response.data;

      setResult({
        valid: data.valid,
        summary: data.summary ?? null,
        messages: Array.isArray(data.messages) ? data.messages : [],
        publicationTitle: data.publicationTitle ?? null,
        checkerVersion: data.checkerVersion ?? null,
        engine: data.engine ?? null,
        note: data.note ?? null,
        sourceFileName: file?.name ?? null,
      });

      try {
        const historyKey = epubcheckHistoryKey(user?.id);
        const raw = sessionStorage.getItem(historyKey);
        const prev = JSON.parse(raw || '[]');
        const list = Array.isArray(prev) ? prev : [];
        list.unshift({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          fileName: file?.name ?? '—',
          valid: data.valid === true,
          publicationTitle: data.publicationTitle ?? null,
          checkerVersion: data.checkerVersion ?? null,
          at: new Date().toISOString(),
        });
        sessionStorage.setItem(historyKey, JSON.stringify(list.slice(0, 40)));
      } catch {
        /* ignore quota / private mode */
      }

      const fd2 = new FormData();
      fd2.append('file', file);
      const sessionRes = await api.post('/epubcheck/repair-session', fd2, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const sData = sessionRes.data?.data ?? sessionRes.data;
      if (sData?.sessionId) setRepairSessionId(sData.sessionId);
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Failed to run EPUBCheck.';
      setError(message);
      setResult(emptyResult);
    } finally {
      setLoadingCheck(false);
    }
  };

  const fileIssueGroups = useMemo(
    () => buildFileIssueGroups(result.messages, fileRepairDrafts),
    [result.messages, fileRepairDrafts]
  );

  const totalMessages = result.messages?.length ?? 0;
  const hasIssues = totalMessages > 0;
  const busy = loadingCheck || loadingAi || loadingAutoFix || loadingRecheckSession || loadingFix;

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (busy) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) selectFile(dropped);
  };

  const handleDeterministicAutoFix = async () => {
    setError('');
    setAiError('');
    setAutoFixSummary('');
    if (!file || result.valid === null) {
      setError('Run EPUBCheck first.');
      return;
    }
    setLoadingAutoFix(true);
    try {
      const sid = await ensureRepairSession();
      if (!sid) {
        setError('Could not open a repair session. Try running EPUBCheck again.');
        return;
      }
      const params = new URLSearchParams({
        includeWarnings: effectiveCheckOptions.includeWarnings ? 'true' : 'false',
        includeNotices: effectiveCheckOptions.includeNotices ? 'true' : 'false',
      });
      const body =
        Array.isArray(result.messages) && result.messages.length > 0
          ? { messages: result.messages }
          : {};
      const response = await api.post(
        `/epubcheck/repair-session/${sid}/auto-fix?${params.toString()}`,
        body,
        { timeout: 180000 }
      );
      const data = response.data?.data ?? response.data;
      if (data.downloadId) setLastDownloadId(data.downloadId);

      const parts = [];
      const written = Array.isArray(data.written) ? data.written : [];
      if (written.length > 0) {
        const list = written.length <= 10 ? written.join(', ') : `${written.slice(0, 10).join(', ')} … (${written.length} total)`;
        parts.push(`Rewrote ${written.length} file(s) in the package: ${list}.`);
      } else {
        parts.push(
          'No files were rewritten (content already matched what the safe rules expect, or no applicable edits).'
        );
      }

      const stats = data.stats;
      if (stats) {
        parts.push(
          `Your report listed ${stats.autoFixable} line(s) whose codes map to our automations — that only decides which handlers run; it is not the same as ${stats.autoFixable} files changed or ${stats.autoFixable} issues cleared. Many lines refer to the same file; others still need AI or manual fixes (e.g. SMIL timing, NAV semantics).`
        );
        if (stats.requiresManualFix > 0) {
          parts.push(`${stats.requiresManualFix} line(s) are outside the deterministic map.`);
        }
        if ((stats.aiAssistSuggested ?? 0) > 0) {
          parts.push(`${stats.aiAssistSuggested} line(s) are flagged for AI-assist / review.`);
        }
      } else if (data.mode === 'full') {
        parts.push('Ran full safe pass (no message filter).');
      }
      if (Array.isArray(data.appliedHandlers) && data.appliedHandlers.length > 0) {
        parts.push(`Handlers run: ${data.appliedHandlers.join(', ')}.`);
      }
      if (data.mode === 'none') {
        parts.push('No deterministic actions (empty report filter).');
      }
      if (data.fallbackFromEmptyTarget) {
        parts.push(
          '(No report codes matched the fix map or IDs were missing — ran full safe pass so files can still be updated.)'
        );
      }
      setAutoFixSummary(parts.join(' ') || 'Auto-fix completed.');

      if (data.after) {
        setResult((prev) => ({
          ...prev,
          valid: data.after.valid,
          summary: data.after.summary ?? prev.summary,
          messages: Array.isArray(data.after.messages) ? data.after.messages : prev.messages,
        }));
      }
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Deterministic auto-fix failed.';
      setError(message);
    } finally {
      setLoadingAutoFix(false);
    }
  };

  /** Re-run EPUBCheck on the EPUB already in the repair session (after auto-fix / apply), without re-uploading. */
  const handleRecheckSessionEpub = async () => {
    if (!repairSessionId) {
      setError('No repair session. Run EPUBCheck once first.');
      return;
    }
    setError('');
    setLoadingRecheckSession(true);
    try {
      const params = new URLSearchParams({
        includeWarnings: effectiveCheckOptions.includeWarnings ? 'true' : 'false',
        includeNotices: effectiveCheckOptions.includeNotices ? 'true' : 'false',
      });
      const recheck = await api.post(
        `/epubcheck/repair-session/${repairSessionId}/epubcheck?${params.toString()}`,
        {}
      );
      const rData = recheck.data?.data ?? recheck.data;
      setResult((prev) => ({
        ...prev,
        valid: rData.valid,
        summary: rData.summary ?? prev.summary,
        messages: Array.isArray(rData.messages) ? rData.messages : prev.messages,
        publicationTitle: rData.publicationTitle ?? prev.publicationTitle,
        checkerVersion: rData.checkerVersion ?? prev.checkerVersion,
        engine: rData.engine ?? prev.engine,
        note: rData.note ?? prev.note,
      }));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Session re-check failed.');
    } finally {
      setLoadingRecheckSession(false);
    }
  };

  const handleGenerateAiSuggestions = async () => {
    if (!file || result.valid === null || !result.messages?.length) return;
    setAiError('');
    setAutoFixSummary('');
    setFileRepairDrafts([]);
    setLastDownloadId('');
    setShowIssuesBesideAi(false);
    setLoadingAi(true);
    try {
      const sid = await ensureRepairSession();
      if (!sid) {
        setAiError('Could not open a repair session. Try running EPUBCheck again.');
        return;
      }
      const response = await api.post(
        `/epubcheck/repair-session/${sid}/ai-suggest`,
        {
          messages: result.messages,
          includeWarnings: effectiveCheckOptions.includeWarnings,
          includeNotices: effectiveCheckOptions.includeNotices,
        },
        { timeout: 300000 }
      );
      const data = response.data?.data ?? response.data;
      const suggestions = Array.isArray(data.fileSuggestions) ? data.fileSuggestions : [];

      setFileRepairDrafts(
        suggestions.map((s) => ({
          path: s.path || '',
          originalContent: s.originalContent ?? '',
          proposedContent: s.proposedContent ?? '',
          notes: s.notes || '',
          ok: s.ok !== false,
          error: s.error || '',
          approved: false,
        }))
      );
      setShowIssuesBesideAi(false);

      if (data.capped) {
        setAiError(
          'Note: AI suggestions were generated for the first batch of files only (parallel cap). Apply these fixes and re-validate to process more paths.'
        );
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to generate AI suggestions.';
      setAiError(
        err.code === 'ECONNABORTED' || String(msg).toLowerCase().includes('timeout')
          ? 'AI suggestion timed out. Try again with fewer messages or a smaller EPUB.'
          : msg
      );
    } finally {
      setLoadingAi(false);
    }
  };

  const handleApproveAllAiFixes = () => {
    setFileRepairDrafts((prev) =>
      prev.map((item) => ({
        ...item,
        approved: !!(item.ok && String(item.proposedContent || '').trim().length > 0),
      }))
    );
  };

  const handleSaveAndRevalidate = async () => {
    if (!repairSessionId) {
      setError('No repair session. Run EPUBCheck first.');
      return;
    }
    setError('');
    setLoadingFix(true);
    try {
      const hasApprovedInvalid = fileRepairDrafts.some(
        (d) => d.approved && (d.ok === false || String(d.error || '').trim().length > 0)
      );
      if (hasApprovedInvalid) {
        setError(
          'Cannot save: unapprove files that show an error, or fix the proposed text. Incomplete AI output cannot be applied.'
        );
        setLoadingFix(false);
        return;
      }

      const approvedFiles = fileRepairDrafts
        .filter(
          (d) =>
            d.approved &&
            d.ok !== false &&
            !d.error &&
            d.path &&
            String(d.proposedContent || '').trim().length > 0
        )
        .map((d) => ({ path: d.path, content: d.proposedContent }));

      if (approvedFiles.length === 0) {
        setError('Approve at least one valid file with non-empty proposed content (no error on the draft).');
        setLoadingFix(false);
        return;
      }

      const response = await api.post(
        `/epubcheck/repair-session/${repairSessionId}/apply`,
        {
          approvedFiles,
          includeWarnings: effectiveCheckOptions.includeWarnings,
          includeNotices: effectiveCheckOptions.includeNotices,
        },
        { timeout: 600000 }
      );
      const data = response.data?.data ?? response.data;

      setFileRepairDrafts([]);
      setShowIssuesBesideAi(false);
      setAiError('');
      if (data.downloadId) setLastDownloadId(data.downloadId);

      const params = new URLSearchParams({
        includeWarnings: effectiveCheckOptions.includeWarnings ? 'true' : 'false',
        includeNotices: effectiveCheckOptions.includeNotices ? 'true' : 'false',
      });
      const recheck = await api.post(
        `/epubcheck/repair-session/${repairSessionId}/epubcheck?${params.toString()}`,
        {}
      );
      const rData = recheck.data?.data ?? recheck.data;
      setResult((prev) => ({
        ...prev,
        valid: rData.valid,
        summary: rData.summary ?? prev.summary,
        messages: Array.isArray(rData.messages) ? rData.messages : prev.messages,
        publicationTitle: rData.publicationTitle ?? prev.publicationTitle,
        checkerVersion: rData.checkerVersion ?? prev.checkerVersion,
        engine: rData.engine ?? prev.engine,
        note: rData.note ?? prev.note,
      }));
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Failed to apply fixes.';
      setError(message);
    } finally {
      setLoadingFix(false);
    }
  };

  const downloadJson = useCallback(() => {
    const payload = {
      valid: result.valid,
      summary: result.summary,
      messages: result.messages,
      publicationTitle: result.publicationTitle,
      checkerVersion: result.checkerVersion,
      engine: result.engine,
      sourceFileName: result.sourceFileName,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'epubcheck-report.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const downloadPdf = useCallback(async () => {
    if (result.valid === null) return;
    setPdfLoading(true);
    setError('');
    try {
      const payload = {
        valid: result.valid,
        summary: result.summary,
        messages: result.messages,
        publicationTitle: result.publicationTitle,
        checkerVersion: result.checkerVersion,
        engine: result.engine,
        sourceFileName: result.sourceFileName,
      };
      const response = await api.post('/epubcheck/pdf', payload, {
        responseType: 'arraybuffer',
      });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'epubcheck-report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to generate PDF.');
    } finally {
      setPdfLoading(false);
    }
  }, [result]);

  const downloadFixedEpub = useCallback(async () => {
    if (!lastDownloadId) return;
    try {
      const res = await api.get(`/epubcheck/ai-repair-download/${lastDownloadId}`, {
        responseType: 'blob',
      });
      const blob = res.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'epub-repaired.epub';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Download failed.');
    }
  }, [lastDownloadId]);

  const checkDone = result.valid !== null;

  const checkLevels = useMemo(
    () => [
      { id: 'errors', title: 'Errors only', sub: 'Fastest — critical issues only' },
      { id: 'errors-warnings', title: 'Errors + warnings', sub: 'Recommended for publishing' },
      { id: 'full', title: 'Full (+ INFO)', sub: 'Most verbose output' },
    ],
    []
  );

  return (
    <div className={`aw-card${checkerPageLayout ? ' aw-card--checker-shell' : ''}`}>
      {!checkerPageLayout && (
        <div className="aw-header">
          <h2 className="aw-title">EPUB Checker</h2>
          <p className="aw-subtitle">
            Upload an EPUB → run W3C EPUBCheck → optional <strong>deterministic auto-fix</strong> (safe, code-based) →
            or generate AI file fixes (drafts) → approve → save &amp; re-validate → download the repaired package.
          </p>
        </div>
      )}

      {javaStatus && !checkerPageLayout && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: '0.88rem',
            background: javaStatus.javaAvailable ? '#ecfdf5' : '#fef2f2',
            border: `1px solid ${javaStatus.javaAvailable ? '#a7f3d0' : '#fecaca'}`,
            color: javaStatus.javaAvailable ? '#065f46' : '#991b1b',
          }}
        >
          {javaStatus.javaAvailable ? (
            <>
              <strong>Server ready:</strong> Java found — EPUBCheck can run.
              {javaStatus.checker && ` (${javaStatus.checker})`}
            </>
          ) : (
            <>
              <strong>Server not ready:</strong> Install a JRE and put <code>java</code> on PATH.
            </>
          )}
          {javaStatus.geminiConfigured === false && (
            <span>
              {' '}
              AI suggestions need <code>GEMINI_API_KEY</code> on the server.
            </span>
          )}
        </div>
      )}

      {checkerPageLayout ? (
        <div className="ecc-shell">
          <div className="ecc-card ecc-card--upload">
            <div className="ecc-step-head">
              <span className="ecc-step-badge" aria-hidden="true">
                1
              </span>
              <h3 className="ecc-step-title">Select EPUB file</h3>
            </div>
            <input
              ref={fileInputRef}
              id="epubcheck-file-input-shell"
              className="ecc-file-input-hidden"
              type="file"
              accept=".epub,application/epub+zip"
              onChange={handleFileChange}
              disabled={busy}
            />
            <label
              htmlFor="epubcheck-file-input-shell"
              className={`ecc-dropzone${dragActive ? ' ecc-dropzone--active' : ''}${busy ? ' ecc-dropzone--disabled' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <span className="ecc-dropzone-icon" aria-hidden="true">
                <Upload size={22} strokeWidth={2.25} />
              </span>
              <span className="ecc-dropzone-title">Drop your .epub here or click to browse</span>
              <span className="ecc-dropzone-sub">Supports EPUB 2 and EPUB 3 · Max 200 MB</span>
            </label>
            {file && (
              <div className="ecc-file-pill">
                <span className="ecc-file-pill-name">{file.name}</span>
                <button
                  type="button"
                  className="ecc-file-clear"
                  onClick={(e) => {
                    e.preventDefault();
                    selectFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  disabled={busy}
                  aria-label="Remove file"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <div className="ecc-card ecc-card--options">
            <div className="ecc-step-head">
              <span className="ecc-step-badge" aria-hidden="true">
                2
              </span>
              <h3 className="ecc-step-title">Check options</h3>
            </div>
            <div className="ecc-level-grid" role="radiogroup" aria-label="Check severity">
              {checkLevels.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={checkLevel === opt.id}
                  className={`ecc-level-card${checkLevel === opt.id ? ' ecc-level-card--selected' : ''}`}
                  onClick={() => setCheckLevel(opt.id)}
                  disabled={busy}
                >
                  <span className="ecc-level-title">{opt.title}</span>
                  <span className="ecc-level-sub">{opt.sub}</span>
                </button>
              ))}
            </div>
            <div className="ecc-pref-row">
              <label className="ecc-check-label">
                <input
                  type="checkbox"
                  checked={prefAutoFix}
                  onChange={(e) => setPrefAutoFix(e.target.checked)}
                  disabled={busy}
                />
                Deterministic auto-fix
              </label>
              <label className="ecc-check-label">
                <input
                  type="checkbox"
                  checked={prefAiDrafts}
                  onChange={(e) => setPrefAiDrafts(e.target.checked)}
                  disabled={busy}
                />
                Generate AI fix drafts
              </label>
              <label className="ecc-check-label">
                <input
                  type="checkbox"
                  checked={prefRecheckAfterFix}
                  onChange={(e) => setPrefRecheckAfterFix(e.target.checked)}
                  disabled={busy}
                />
                Re-validate after fix
              </label>
            </div>
            <label className="ecc-check-label ecc-check-label--solo">
              <input
                type="checkbox"
                checked={
                  checkLevel === 'full' ? true : checkLevel === 'errors-warnings' ? includeNoticesExtra : false
                }
                onChange={(e) => {
                  const on = e.target.checked;
                  if (checkLevel === 'full') return;
                  if (checkLevel === 'errors-warnings') {
                    setIncludeNoticesExtra(on);
                  } else if (on) {
                    setCheckLevel('errors-warnings');
                    setIncludeNoticesExtra(true);
                  }
                }}
                disabled={busy || checkLevel === 'full'}
              />
              Include notices (INFO)
            </label>

            <button
              type="button"
              className="ecc-run-primary"
              onClick={handleRunCheck}
              disabled={busy || !file || javaStatus?.javaAvailable === false}
            >
              <Play className="ecc-run-icon" size={18} fill="currentColor" aria-hidden="true" />
              {loadingCheck ? 'Running EPUBCheck…' : 'Run EPUBCheck'}
            </button>
            {repairSessionId && (
              <button
                type="button"
                className="ecc-recheck-btn"
                onClick={handleRecheckSessionEpub}
                disabled={busy || javaStatus?.javaAvailable === false}
                title="Runs EPUBCheck on the EPUB in the current repair session (e.g. after auto-fix)."
              >
                {loadingRecheckSession ? 'Re-checking…' : 'Re-check session EPUB'}
              </button>
            )}
            <p className="ecc-hint">
              Run EPUBCheck uploads the selected file. After auto-fix, use <strong>Re-check session EPUB</strong> or
              select your downloaded <code>epub-repaired.epub</code> and run again.
            </p>
          </div>
          {error && <div className="aw-error-bar ecc-error-bar">{error}</div>}
          {javaStatus?.geminiConfigured === false && (
            <p className="ecc-ai-warning">
              AI suggestions require <code>GEMINI_API_KEY</code> on the server.
            </p>
          )}
        </div>
      ) : (
        <div className="aw-upload-section">
          <label className="aw-file-label" htmlFor="epubcheck-file-input">
            Select EPUB file
          </label>
          <div className="aw-file-row">
            <input
              id="epubcheck-file-input"
              type="file"
              accept=".epub,application/epub+zip"
              onChange={handleFileChange}
              disabled={busy}
            />
            <button
              type="button"
              className="aw-run-btn"
              onClick={handleRunCheck}
              disabled={busy || !file || javaStatus?.javaAvailable === false}
            >
              {loadingCheck ? '⏳ Running EPUBCheck…' : '▶ Run EPUBCheck'}
            </button>
            {repairSessionId && (
              <button
                type="button"
                className="aw-view-report-link"
                onClick={handleRecheckSessionEpub}
                disabled={busy || javaStatus?.javaAvailable === false}
                title="Runs EPUBCheck on the EPUB stored in the current repair session (e.g. after auto-fix), without using the file picker."
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontWeight: 600,
                }}
              >
                {loadingRecheckSession ? '⏳ Re-checking…' : '🔁 Re-check session EPUB'}
              </button>
            )}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#64748b', maxWidth: 720 }}>
            <strong>Run EPUBCheck</strong> uploads the file you selected above. After auto-fix, either use{' '}
            <strong>Re-check session EPUB</strong> (validates the fixed package on the server) or select your downloaded{' '}
            <code>epub-repaired.epub</code> and then run EPUBCheck.
          </p>
          <div className="aw-file-row" style={{ marginTop: 10 }}>
            <label style={{ fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={includeWarnings}
                onChange={(e) => setIncludeWarnings(e.target.checked)}
                disabled={busy}
              />
              Include warnings
            </label>
            <label style={{ fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={includeNotices}
                onChange={(e) => setIncludeNotices(e.target.checked)}
                disabled={busy}
              />
              Include notices (INFO)
            </label>
          </div>
          {file && <div className="aw-file-name">📄 {file.name}</div>}
          {error && <div className="aw-error-bar">{error}</div>}
        </div>
      )}

      {checkDone && (
        <div className="aw-results">
          <div className="aw-stats-row">
            {EPUB_SEVERITIES.map((sev) => (
              <div key={sev} className={`aw-stat-card ${statClassForSeverity(sev)}`}>
                <span className="aw-stat-label">{SEVERITY_LABELS[sev]}</span>
                <span className="aw-stat-count">{result.summary?.[`${sev.toLowerCase()}Count`] ?? 0}</span>
              </div>
            ))}
            <div className="aw-stat-card aw-stat-total">
              <span className="aw-stat-label">Total</span>
              <span className="aw-stat-count">{totalMessages}</span>
            </div>
          </div>

          {result.valid && totalMessages === 0 && (
            <div className="aw-success-banner">
              <div className="aw-success-icon">✅</div>
              <div className="aw-success-content">
                <strong>Valid — no EPUBCheck messages in this run.</strong>
                <p>Your package passed with the current warning/notice filters.</p>
              </div>
            </div>
          )}

          {result.valid && totalMessages > 0 && (
            <div className="aw-success-banner" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
              <div className="aw-success-icon">✓</div>
              <div className="aw-success-content">
                <strong>No errors or fatals</strong>
                <p>There are still informational messages or warnings below — you can use AI repair if needed.</p>
              </div>
            </div>
          )}

          {hasIssues && (
            <div className="aw-fix-panel">
              <div className="aw-fix-toolbar">
                <div className="aw-fix-toolbar-left">
                  <span className="aw-fix-badge">🔧 Fix mode</span>
                  <span className="aw-fix-hint">
                    <strong>Auto-fix</strong> applies on the server immediately — then use <strong>Download repaired
                    EPUB</strong>. Use <strong>Save &amp; Re-validate</strong> only after approving AI drafts.
                  </span>
                </div>
                <div className="aw-fix-toolbar-right">
                  <button
                    type="button"
                    className="aw-view-report-link"
                    onClick={handleDeterministicAutoFix}
                    disabled={busy || !repairSessionId || (checkerPageLayout && !prefAutoFix)}
                    style={{
                      border: '1px solid #0d9488',
                      borderRadius: 8,
                      padding: '8px 14px',
                      fontWeight: 600,
                      color: '#0f766e',
                      background: '#f0fdfa',
                    }}
                    title="Runs only fixes mapped to EPUBCheck codes in your report (or full safe pass if the report is empty)."
                  >
                    {loadingAutoFix
                      ? '⏳ Auto-fix…'
                      : totalMessages > 0
                        ? '⚙ Auto-fix (safe, from report)'
                        : '⚙ Auto-fix (full safe pass)'}
                  </button>
                  <button
                    type="button"
                    className="aw-ai-btn"
                    onClick={handleGenerateAiSuggestions}
                    disabled={
                      loadingAi ||
                      busy ||
                      !repairSessionId ||
                      javaStatus?.geminiConfigured === false ||
                      (checkerPageLayout && !prefAiDrafts)
                    }
                  >
                    {loadingAi
                      ? '⏳ Running AI in parallel… (may take ~30s–2m)'
                      : '✦ Generate AI Suggestions'}
                  </button>
                  {fileRepairDrafts.length > 0 && (
                    <button
                      type="button"
                      className="aw-approve-all-btn"
                      onClick={handleApproveAllAiFixes}
                      disabled={busy}
                    >
                      ✓ Approve All AI Fixes
                    </button>
                  )}
                </div>
              </div>

              {autoFixSummary && (
                <div
                  className="aw-success-banner"
                  style={{ marginBottom: 12, background: '#ecfeff', borderColor: '#a5f3fc' }}
                >
                  <div className="aw-success-icon">⚙</div>
                  <div className="aw-success-content">
                    <strong>Deterministic auto-fix</strong>
                    <p style={{ margin: '6px 0 0', fontSize: '0.9rem' }}>{autoFixSummary}</p>
                    <p style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>
                      <strong>Validate the fixed EPUB:</strong> use <strong>Re-check session EPUB</strong> (uses the
                      server copy) or select your downloaded <code>epub-repaired.epub</code> and then{' '}
                      <strong>Run EPUBCheck</strong>. The file picker must not still point at the old upload if you want a
                      fresh check from disk.
                    </p>
                    {lastDownloadId && (
                      <p style={{ margin: '6px 0 0', fontSize: '0.85rem' }}>
                        <strong>Download repaired EPUB</strong> saves the same package that was rewritten above.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {aiError && <div className="aw-error-bar">{aiError}</div>}

              <div className="aw-section">
                <div className="aw-section-header">
                  <span className="aw-badge aw-badge-serious">By file</span>
                  <span className="aw-section-title-text">Issues &amp; fix suggestions</span>
                  <span className="aw-issue-count">{fileIssueGroups.length} group(s)</span>
                </div>
                <p className="aw-section-desc">
                  Each card is one path: EPUBCheck issues (optional) and the AI full-file suggestion. While AI
                  drafts are shown, issue text is hidden to reduce clutter — use the button below to show it
                  again. Re-running <strong>Generate AI Suggestions</strong> clears previous drafts. Large
                  outputs need sufficient <code>GEMINI_EPUB_REPAIR_MAX_OUTPUT</code> on the server.
                </p>
                {fileRepairDrafts.length > 0 && (
                  <div className="epub-issue-toggle-row">
                    <button
                      type="button"
                      className="aw-view-report-link"
                      style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 14px' }}
                      onClick={() => setShowIssuesBesideAi((v) => !v)}
                    >
                      {showIssuesBesideAi ? '▼ Hide EPUBCheck messages' : '▶ Show EPUBCheck messages'}
                    </button>
                  </div>
                )}

                <div className="epub-file-issue-list">
                  {fileIssueGroups.map((group, gi) => {
                    const draftIdx = group.draftIndex;
                    const draft = draftIdx >= 0 ? fileRepairDrafts[draftIdx] : null;
                    const header = group.pathLabel || group.path || 'File';
                    const hasAiDrafts = fileRepairDrafts.length > 0;
                    const showIssueBlock =
                      group.entries.length > 0 && (!hasAiDrafts || showIssuesBesideAi);
                    const showNoDraftHint =
                      fileRepairDrafts.length > 0 &&
                      draftIdx < 0 &&
                      group.entries.length > 0 &&
                      !loadingAi;

                    return (
                      <div key={group.path ?? `pkg-${gi}`} className="epub-file-issue-card">
                        <div className="epub-file-issue-header">{header}</div>
                        <div className="epub-file-issue-body">
                          {showIssueBlock && (
                            <div className="epub-file-issue-block">
                              <div className="epub-file-issue-block-title">Issues</div>
                              {group.entries.map(({ msg, msgIdx }) => (
                                <div
                                  key={`${msgIdx}-${msg.ID || ''}-${msg.severity}`}
                                  className="aw-violation-card epub-issue-msg-card"
                                >
                                  <div className="aw-violation-meta">
                                    <span
                                      className={`aw-badge aw-badge-${badgeClassForSeverity(msg.severity)}`}
                                    >
                                      {SEVERITY_LABELS[String(msg.severity || 'INFO').toUpperCase()] ||
                                        msg.severity}
                                    </span>
                                    {msg.ID && <span className="aw-violation-rule">{msg.ID}</span>}
                                  </div>
                                  <p className="aw-violation-desc">{msg.message}</p>
                                  {msg.locations?.length > 0 && (
                                    <details className="aw-snippet-details">
                                      <summary className="aw-snippet-summary">Locations</summary>
                                      <pre className="aw-snippet-pre">
                                        {msg.locations
                                          .map(
                                            (loc) =>
                                              `${loc.path || ''}${loc.line != null ? `:${loc.line}` : ''}${
                                                loc.column != null ? `:${loc.column}` : ''
                                              }`
                                          )
                                          .join('\n')}
                                      </pre>
                                    </details>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {group.entries.length === 0 && draft && (
                            <p className="aw-no-fix-hint epub-issue-draftonly-hint">
                              No messages list this path alone — AI still returned a full-file suggestion.
                            </p>
                          )}

                          {draft && (
                            <div className="epub-file-issue-block epub-file-issue-block--fix">
                              <div className="epub-file-issue-block-title">AI suggested fix (full file)</div>
                              {draft.error && <p className="aw-fix-error">⚠ {draft.error}</p>}
                              {draft.notes && <p className="aw-fix-reason">💡 {draft.notes}</p>}
                              {!draft.ok &&
                                !draft.error &&
                                !String(draft.proposedContent || '').trim() && (
                                  <p className="aw-no-fix-hint">Model did not return a fix for this path.</p>
                                )}
                              {(draft.ok || String(draft.proposedContent || '').trim().length > 0) && (
                                <div className="aw-fix-area">
                                  <div className="aw-fix-label">Original (read-only excerpt)</div>
                                  <pre className="aw-snippet-pre" style={{ maxHeight: 120, overflow: 'auto' }}>
                                    {(draft.originalContent || '').slice(0, 4000)}
                                    {(draft.originalContent || '').length > 4000 ? '\n…' : ''}
                                  </pre>
                                  <div className="aw-fix-label">Proposed content (editable)</div>
                                  <textarea
                                    className="aw-fix-textarea"
                                    rows={12}
                                    value={draft.proposedContent}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setFileRepairDrafts((prev) => {
                                        const next = [...prev];
                                        next[draftIdx] = {
                                          ...next[draftIdx],
                                          proposedContent: val,
                                          ok: true,
                                          error: ''
                                        };
                                        return next;
                                      });
                                    }}
                                  />
                                  <label className={`aw-approve-label${draft.ok === false ? ' aw-approve-disabled' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={!!draft.approved}
                                      disabled={draft.ok === false}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setFileRepairDrafts((prev) => {
                                          const next = [...prev];
                                          next[draftIdx] = { ...next[draftIdx], approved: checked };
                                          return next;
                                        });
                                      }}
                                    />
                                    Approve this file
                                    {draft.ok === false && (
                                      <span className="aw-approve-hint"> (blocked — fix text or regenerate)</span>
                                    )}
                                  </label>
                                </div>
                              )}
                            </div>
                          )}

                          {showNoDraftHint && (
                            <p className="aw-no-fix-hint">
                              No AI draft for this path in the last run — click Generate AI Suggestions again
                              after other fixes, or edit another path first.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="aw-save-bar">
                <button
                  type="button"
                  className="aw-download-report-link"
                  style={{ border: 'none', cursor: pdfLoading ? 'wait' : 'pointer' }}
                  onClick={downloadPdf}
                  disabled={pdfLoading}
                >
                  {pdfLoading ? '…' : '⬇'} Report (PDF)
                </button>
                <button
                  type="button"
                  className="aw-view-report-link"
                  style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px' }}
                  onClick={downloadJson}
                >
                  ⬇ JSON
                </button>
                {lastDownloadId && (
                  <button
                    type="button"
                    className="aw-download-btn"
                    onClick={downloadFixedEpub}
                    style={{ border: 'none', cursor: 'pointer' }}
                  >
                    ⬇ Download repaired EPUB
                  </button>
                )}
                <button
                  type="button"
                  className="aw-save-btn"
                  onClick={handleSaveAndRevalidate}
                  disabled={loadingFix || !repairSessionId}
                >
                  {loadingFix ? '⏳ Applying & Re-validating…' : '💾 Save Changes & Re-validate'}
                </button>
              </div>
            </div>
          )}

          {!hasIssues && checkDone && (
            <div className="aw-save-bar" style={{ flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                className="aw-view-report-link"
                onClick={handleDeterministicAutoFix}
                disabled={busy || !repairSessionId || (checkerPageLayout && !prefAutoFix)}
                style={{
                  border: '1px solid #0d9488',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontWeight: 600,
                  color: '#0f766e',
                  background: '#f0fdfa',
                }}
              >
                {loadingAutoFix ? '⏳ Auto-fix…' : '⚙ Auto-fix (full safe pass)'}
              </button>
              {autoFixSummary && (
                <span style={{ fontSize: '0.88rem', color: '#0f766e', flex: '1 1 100%' }}>{autoFixSummary}</span>
              )}
              {lastDownloadId && (
                <button
                  type="button"
                  className="aw-download-btn"
                  onClick={downloadFixedEpub}
                  style={{ border: 'none', cursor: 'pointer' }}
                >
                  ⬇ Download repaired EPUB
                </button>
              )}
              <button
                type="button"
                className="aw-download-report-link"
                style={{ border: 'none', cursor: pdfLoading ? 'wait' : 'pointer' }}
                onClick={downloadPdf}
                disabled={pdfLoading}
              >
                ⬇ Report (PDF)
              </button>
              <button
                type="button"
                className="aw-view-report-link"
                style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px' }}
                onClick={downloadJson}
              >
                ⬇ JSON
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EpubConformanceCheck;
