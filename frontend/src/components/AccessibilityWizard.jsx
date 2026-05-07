import React, { useEffect, useMemo, useState } from 'react';
import api, { API_BASE_URL } from '../services/api';
import { useSearchParams } from 'react-router-dom';
import {
  X,
  Loader2,
  Play,
  CircleCheck,
  Download,
  FileText,
  Sparkles,
  Wrench,
  Check,
  Settings,
  Lightbulb,
  AlertTriangle,
  Info,
  ArrowRight,
  RefreshCw,
  Save,
} from 'lucide-react';
import './AccessibilityWizard.css';

const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];
const SEVERITY_LABELS = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };

// Violations handled automatically by RemedyEngine.applyGlobalFixes.
// Each entry describes what exact change will be made.
const AUTO_FIXED_RULES = {
  'epub-lang': {
    summary: 'Adds xml:lang and lang attributes to the OPF <package> element.',
    file: 'content.opf',
    patch: `<!-- Before -->\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" ...>\n\n<!-- After -->\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0"\n         xml:lang="en" lang="en" ...>`
  },
  'html-has-lang': {
    summary: 'Adds lang and xml:lang attributes to every XHTML <html> element.',
    file: 'All page XHTML files',
    patch: `<!-- Before -->\n<html xmlns="http://www.w3.org/1999/xhtml">\n\n<!-- After -->\n<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">`
  },
  'metadata-accessmode': {
    summary: 'Injects schema:accessMode metadata into the OPF <metadata> block.',
    file: 'content.opf',
    patch: `<meta property="schema:accessMode">textual</meta>`
  },
  'metadata-accessmodesufficient': {
    summary: 'Injects schema:accessModeSufficient metadata into the OPF <metadata> block.',
    file: 'content.opf',
    patch: `<meta property="schema:accessModeSufficient">textual</meta>`
  },
  'metadata-accessibilityfeature': {
    summary: 'Injects schema:accessibilityFeature metadata into the OPF <metadata> block.',
    file: 'content.opf',
    patch: `<meta property="schema:accessibilityFeature">alternativeText</meta>`
  },
  'metadata-accessibilityhazard': {
    summary: 'Injects schema:accessibilityHazard metadata into the OPF <metadata> block.',
    file: 'content.opf',
    patch: `<meta property="schema:accessibilityHazard">noFlashingHazard</meta>`
  },
  'metadata-accessibilitysummary': {
    summary: 'Injects schema:accessibilitySummary metadata into the OPF <metadata> block.',
    file: 'content.opf',
    patch: `<meta property="schema:accessibilitySummary">\n  This EPUB provides accessibility features including\n  alternative text and structured headings.\n</meta>`
  },
  'scrollable-region-focusable': {
    summary: 'Adds tabindex="0" to <body> and any inline scroll containers so keyboard users can navigate them.',
    file: 'All page XHTML files',
    patch: `<!-- Before -->\n<body>\n\n<!-- After -->\n<body tabindex="0">`
  },
  'landmark-no-duplicate-contentinfo': {
    summary: 'Keeps the first <footer> as a landmark; demotes extras to role="none" aria-hidden="true" to remove duplicate contentinfo landmarks.',
    file: 'All page XHTML files',
    patch: `<!-- First footer: kept as landmark -->\n<footer aria-label="Document footer">...</footer>\n\n<!-- Subsequent footers: neutralised -->\n<footer role="none" aria-hidden="true">...</footer>`
  },
  'landmark-unique': {
    summary: 'Adds unique aria-label to each repeated landmark so assistive technologies can distinguish them.',
    file: 'All page XHTML files',
    patch: `<!-- Before -->\n<nav epub:type="toc">...</nav>\n<nav epub:type="toc">...</nav>\n\n<!-- After -->\n<nav epub:type="toc" aria-label="navigation 1">...</nav>\n<nav epub:type="toc" aria-label="navigation 2">...</nav>`
  },
  'epub-toc-order': {
    summary: 'Adds role="doc-toc" to the nav element with epub:type="toc".',
    file: 'nav.xhtml',
    patch: `<!-- Before -->\n<nav epub:type="toc">\n\n<!-- After -->\n<nav epub:type="toc" role="doc-toc">`
  },
  // Ace may report this rule under either name depending on the version
  'epub-type-has-matching-role': {
    summary: 'Maps every epub:type value to its required DPUB-ARIA role attribute (toc→doc-toc, chapter→doc-chapter, etc.).',
    file: 'nav.xhtml / page XHTML files',
    patch: `<!-- Before -->\n<nav epub:type="toc">\n<section epub:type="chapter">\n\n<!-- After -->\n<nav epub:type="toc" role="doc-toc">\n<section epub:type="chapter" role="doc-chapter">`
  },
  'epub-type-has-matching-dpub-role': {
    summary: 'Maps every epub:type value to its required DPUB-ARIA role attribute (toc→doc-toc, chapter→doc-chapter, etc.).',
    file: 'nav.xhtml / page XHTML files',
    patch: `<!-- Before -->\n<nav epub:type="toc">\n<section epub:type="chapter">\n\n<!-- After -->\n<nav epub:type="toc" role="doc-toc">\n<section epub:type="chapter" role="doc-chapter">`
  },
  'aria-roles': {
    summary: 'Replaces invalid role="doc-landmarks" with role="navigation" on landmarks nav and adds a label when missing.',
    file: 'nav.xhtml',
    patch: `<!-- Before -->\n<nav epub:type="landmarks" role="doc-landmarks">\n\n<!-- After -->\n<nav epub:type="landmarks" role="navigation" aria-label="Landmarks">`
  },
  'epub-pagelist-broken': {
    summary: 'Repairs malformed page-list links so they target valid XHTML files (e.g. page-0010xhtml → page-0010.xhtml).',
    file: 'nav.xhtml',
    patch: `<!-- Before -->\n<a href="page-0010xhtml">10</a>\n\n<!-- After -->\n<a href="page-0010.xhtml">10</a>`
  }
};

const initialSummary = {
  totalViolations: 0,
  bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 }
};

function parseHeadingsFromAceHtml(headingsHtml) {
  if (!headingsHtml || typeof headingsHtml !== 'string') return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(headingsHtml, 'text/html');
    const spans = Array.from(doc.querySelectorAll('span[class*="toc-h"]'));
    const out = [];
    for (const span of spans) {
      const text = (span.textContent || '').replace(/\s+/g, ' ').trim();
      const classList = span.className ? String(span.className) : '';
      const m = classList.match(/toc-h(\d)/i);
      const level = m ? Number(m[1]) : null;
      if (!text) continue;
      out.push({ text, currentLevel: level });
    }
    return out;
  } catch (_e) {
    return [];
  }
}

function hasHeadingOrderIssues(headings) {
  if (!headings || headings.length < 2) return false;
  for (let i = 1; i < headings.length; i += 1) {
    const prev = headings[i - 1]?.currentLevel;
    const next = headings[i]?.currentLevel;
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    if (Math.abs(next - prev) > 1) return true;
  }
  return false;
}

const AccessibilityWizard = ({ onStateChange }) => {
  const [searchParams] = useSearchParams();
  const initialJobId = searchParams.get('jobId');
  const autoSuggest = searchParams.get('autoSuggest') === '1' || searchParams.get('autoSuggest') === 'true';

  const [file, setFile] = useState(null);
  const [standards, setStandards] = useState({
    wcag21aa: true,
    epubA11y: true,
    wcag22aa: false,
    section508: false,
    ariaLandmarks: false,
  });
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [loadingFix, setLoadingFix] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [loadingRecheck, setLoadingRecheck] = useState(false);
  const [loadingInit, setLoadingInit] = useState(false);
  const [error, setError] = useState('');
  const [aiError, setAiError] = useState('');

  const [jobId, setJobId] = useState('');
  const [summary, setSummary] = useState(initialSummary);
  const [reportUrl, setReportUrl] = useState('');
  const [report, setReport] = useState(null);
  const [allViolations, setAllViolations] = useState([]);
  const [metadata, setMetadata] = useState({});

  const [revalidateFailed, setRevalidateFailed] = useState(false);
  const [revalidateError, setRevalidateError] = useState('');

  const computeSummaryFromViolations = (violations) => {
    const out = {
      totalViolations: 0,
      bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 }
    };
    const list = Array.isArray(violations) ? violations : [];
    out.totalViolations = list.length;

    for (const v of list) {
      const sev = String(v?.severity || '').toLowerCase();
      if (sev === 'critical') out.bySeverity.critical += 1;
      else if (sev === 'serious' || sev === 'severe') out.bySeverity.serious += 1;
      else if (sev === 'moderate') out.bySeverity.moderate += 1;
      else out.bySeverity.minor += 1;
    }

    return out;
  };

  // Fix drafts
  const [imageAltDrafts, setImageAltDrafts] = useState({});
  const [headingDrafts, setHeadingDrafts] = useState([]);
  const [codeRepairDrafts, setCodeRepairDrafts] = useState([]);

  // --- Computed ---
  // Show only images that are currently part of Ace "image-alt" violations.
  // `report.data.images` is an image inventory and may include non-violations.
  const altViolations = useMemo(() => {
    const images = report?.data?.images || [];
    const imageAltIssues = (allViolations || []).filter((v) => v?.title === 'image-alt');
    if (imageAltIssues.length === 0) return [];

    const bySrc = new Map(
      images
        .filter((img) => img?.src)
        .map((img) => [String(img.src), img])
    );
    const byHtml = new Map(
      images
        .filter((img) => img?.html)
        .map((img) => [String(img.html), img])
    );

    const out = [];
    const seen = new Set();

    for (const issue of imageAltIssues) {
      const issueHtml = String(issue?.offendingSnippet || '');
      const issuePath = String(issue?.filePath || '').replace(/^\/+/, '');
      let matched = null;

      if (issueHtml && byHtml.has(issueHtml)) {
        matched = byHtml.get(issueHtml);
      } else if (issuePath && bySrc.has(issuePath)) {
        matched = bySrc.get(issuePath);
      } else if (issueHtml) {
        matched = images.find((img) => {
          const src = String(img?.src || '');
          const base = src.split('/').pop();
          return !!base && issueHtml.includes(base);
        }) || null;
      }

      if (matched?.src && !seen.has(matched.src)) {
        seen.add(matched.src);
        out.push(matched);
      }
    }

    return out;
  }, [report, allViolations]);

  // Subset that are truly decorative (role=presentation/none) — no descriptive text needed.
  // FXL EPUB pages use SVG <image> which Ace reports with role=null; those are NOT decorative
  // and will be fixed by RemedyEngine adding role="img" + aria-label to the parent <svg>.
  const decorativeImages = useMemo(() => {
    const decorativeRoles = new Set(['presentation', 'none']);
    return new Set(
      altViolations
        .filter((img) => decorativeRoles.has(String(img.role || '').toLowerCase()))
        .map((img) => img.src)
    );
  }, [altViolations]);

  // FXL SVG page images are identified by true SVG markup from Ace (`<image ...>`),
  // not by file extension alone. RemedyEngine auto-fixes these on Save.
  const svgPageImages = useMemo(() => {
    return new Set(
      altViolations
        .filter((img) => {
          if (img?.role) return false;
          const html = String(img?.html || '').toLowerCase();
          // Real SVG image node from Ace snippet.
          const isSvgImageElement = html.includes('<image ');
          // Guard: plain HTML <img> is not an SVG page image.
          const isHtmlImg = html.includes('<img ');
          return isSvgImageElement && !isHtmlImg;
        })
        .map((img) => img.src)
    );
  }, [altViolations]);

  // Some fixed-layout EPUBs use HTML <img> as full-page canvases (not SVG <image>).
  // Treat these as auto-handled page images as well.
  const fxlPageCanvasImages = useMemo(() => {
    return new Set(
      altViolations
        .filter((img) => {
          const html = String(img?.html || '').toLowerCase();
          if (!html.includes('<img ')) return false;
          const cls = String(html.match(/class="([^"]+)"/i)?.[1] || '').toLowerCase();
          const src = String(img?.src || '').toLowerCase();
          const looksLikeFxlCanvasClass = /\bbi\b/.test(cls);
          const looksLikeFxlPageAsset = /\/images\/(bg\d+|cover\d*)\.(png|jpg|jpeg|webp|gif|svg)$/i.test(src);
          return looksLikeFxlCanvasClass || looksLikeFxlPageAsset;
        })
        .map((img) => img.src)
    );
  }, [altViolations]);

  const normalizeImageSrc = (value) =>
    String(value || '')
      .replace(/\\/g, '/')
      .replace(/^(?:\.\.\/)+/, '')
      .replace(/^\.\//, '')
      .replace(/^OPS\//i, '')
      .replace(/^OEBPS\//i, '')
      .toLowerCase();

  const parsedHeadings = useMemo(
    () => parseHeadingsFromAceHtml(report?.outlines?.headings),
    [report]
  );

  const hasHeadingOrderViolation = useMemo(() => {
    if (!Array.isArray(allViolations) || allViolations.length === 0) return false;
    return allViolations.some((v) => v?.title === 'heading-order');
  }, [allViolations]);

  const showHeadingSection = useMemo(
    () => hasHeadingOrderViolation,
    [hasHeadingOrderViolation]
  );
  const headingLevelDraftsReady = useMemo(() => {
    if (!parsedHeadings || parsedHeadings.length === 0) return [];
    if (headingDrafts.length === parsedHeadings.length) return headingDrafts;
    return parsedHeadings.map((h) => ({
      text: h.text,
      currentLevel: h.currentLevel,
      nextLevel: Number.isFinite(h.currentLevel) ? h.currentLevel : 1
    }));
  }, [parsedHeadings, headingDrafts]);

  // Code violations grouped by severity (image-alt and heading-order have separate sections)
  const codeViolationsBySeverity = useMemo(() => {
    const groups = { critical: [], serious: [], moderate: [], minor: [] };
    for (const v of allViolations) {
      if (v.title === 'image-alt') continue;
      if (v.title === 'heading-order') continue;
      const sev = SEVERITIES.includes(v.severity) ? v.severity : 'minor';
      groups[sev].push(v);
    }
    return groups;
  }, [allViolations]);

  const hasViolations = summary.totalViolations > 0 || revalidateFailed || summary.totalViolations < 0;
  const anyCodeViolations = SEVERITIES.some((s) => (codeViolationsBySeverity[s] || []).length > 0);

  const imageUrl = (imgSrc) =>
    `${API_BASE_URL}/accessibility/${jobId}/image?src=${encodeURIComponent(imgSrc)}`;

  const backendBase = API_BASE_URL.replace(/\/api\/?$/, '');
  const absoluteReportUrl = reportUrl ? `${backendBase}${reportUrl}` : '';
  const downloadEpubUrl = jobId ? `${backendBase}/api/accessibility/${jobId}/download-epub` : '';
  const downloadReportPdfUrl = jobId ? `${backendBase}/api/accessibility/report/${jobId}/pdf` : '';

  const onResetDraftsFromReport = (nextReport) => {
    const headings = parseHeadingsFromAceHtml(nextReport?.outlines?.headings);
    const prevHeadingDrafts = headingDrafts;
    const prevImageAltDrafts = imageAltDrafts;

    const nextHeadingDrafts = headings.map((h) => ({
      text: h.text,
      currentLevel: h.currentLevel,
      nextLevel: Number.isFinite(h.currentLevel) ? h.currentLevel : 1
    }));
    const nextImageDrafts = {};
    for (const img of nextReport?.data?.images || []) {
      if (!img?.src) continue;
      if (!img.alt || String(img.alt).trim().length === 0) nextImageDrafts[img.src] = '';
    }

    for (let i = 0; i < nextHeadingDrafts.length; i += 1) {
      const prev = prevHeadingDrafts?.[i];
      if (prev && Number.isFinite(prev.nextLevel)) nextHeadingDrafts[i].nextLevel = prev.nextLevel;
    }
    for (const [src] of Object.entries(nextImageDrafts)) {
      if (typeof prevImageAltDrafts?.[src] === 'string') nextImageDrafts[src] = prevImageAltDrafts[src];
    }

    setImageAltDrafts(nextImageDrafts);
    setHeadingDrafts(nextHeadingDrafts);
  };

  const handleFileChange = (event) => {
    const selected = event.target.files?.[0] || null;
    setError('');
    setFile(selected);
    setJobId('');
    setReport(null);
    setAllViolations([]);
    setSummary(initialSummary);
    setReportUrl('');
    setImageAltDrafts({});
    setHeadingDrafts([]);
    setCodeRepairDrafts([]);
    setAiError('');
    setRevalidateFailed(false);
    setRevalidateError('');
  };

  const handleRemoveFile = () => {
    setError('');
    setFile(null);
    setJobId('');
    setReport(null);
    setAllViolations([]);
    setSummary(initialSummary);
    setReportUrl('');
    setImageAltDrafts({});
    setHeadingDrafts([]);
    setCodeRepairDrafts([]);
    setAiError('');
    setRevalidateFailed(false);
    setRevalidateError('');
    // Reset the hidden file input so the same file can be re-selected
    const input = document.getElementById('epub-file-input');
    if (input) input.value = '';
  };

  const applyReportData = (data, reportData) => {
    setSummary(data.summary || initialSummary);
    setReportUrl(data.reportUrl || '');
    const nextReport = reportData || null;
    setReport(nextReport);
    if (Array.isArray(reportData?.allViolations)) setAllViolations(reportData.allViolations);
    onResetDraftsFromReport(nextReport);
  };

  // Notify parent page of state changes so it can render dashboard tiles
  useEffect(() => {
    if (onStateChange) {
      onStateChange({ jobId, summary, allViolations, file, metadata });
    }
  }, [jobId, summary, allViolations, file, metadata]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunCheck = async (event) => {
    if (event) event.preventDefault();
    setError('');
    if (!file) { setError('Please select an EPUB file first.'); return; }
    setLoadingCheck(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post('/accessibility/check', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const data = response.data?.data || response.data;
      const nextJobId = data.jobId || '';
      setJobId(nextJobId);
      setSummary(data.summary || initialSummary);
      setReportUrl(data.reportUrl || '');
      setMetadata(data.metadata || {});
      setCodeRepairDrafts([]);
      setAiError('');

      // Fetch full report (includes allViolations)
      const reportRes = await api.get(`/accessibility/report/${nextJobId}/json`);
      const nextReport = reportRes.data?.data?.report || reportRes.data?.report || null;
      setReport(nextReport);
      if (Array.isArray(nextReport?.allViolations)) setAllViolations(nextReport.allViolations);
      onResetDraftsFromReport(nextReport);
    } catch (err) {
      const raw = err.response?.data?.error || err.message || 'Failed to analyze EPUB.';
      const status = err.response?.status;
      // Give a clear, actionable message for the Ace CLI failure case
      const message = status === 500
        ? `Accessibility check failed: ${raw} — Make sure the EPUB is a valid, non-password-protected file and try again.`
        : raw;
      setError(message);
    } finally {
      setLoadingCheck(false);
    }
  };

  const handleGenerateAiSuggestions = async (jobIdOverride = null) => {
    // When bound to an onClick handler, React passes the click event as the first arg.
    // Only treat overrides as job IDs if they are strings.
    const override =
      typeof jobIdOverride === 'string' ? jobIdOverride : (jobIdOverride == null ? null : null);
    const targetJobId = override || jobId;
    if (!targetJobId) return;
    setAiError('');
    setLoadingAi(true);
    try {
      const response = await api.post(
        `/accessibility/${targetJobId}/ai/suggest`,
        {},
        { timeout: 300000 }
      ); // 5 min — runs in parallel on backend
      const data = response.data?.data || response.data;

      const imageSuggestions = Array.isArray(data.imageAltSuggestions) ? data.imageAltSuggestions : [];
      if (imageSuggestions.length > 0) {
        setImageAltDrafts((prev) => {
          const next = { ...prev };
          for (const s of imageSuggestions) {
            if (!s?.src || !s?.suggestion) continue;
            if (!next[s.src] || String(next[s.src]).trim().length === 0) next[s.src] = s.suggestion;
          }
          return next;
        });
      }

      const codeSuggestions = Array.isArray(data.codeRepairSuggestions) ? data.codeRepairSuggestions : [];
      setCodeRepairDrafts(
        codeSuggestions.map((s) => ({
          violationId: s.violationId || '',
          filePath: s.filePath || '',
          title: s.title || '',
          offendingSnippet: s.offendingSnippet || '',
          fixedSnippet: s.fixedSnippet || '',
          reason: s.reason || '',
          approved: false,
          error: s.error || ''
        }))
      );
      if (data.capped) {
        setAiError(`Note: AI suggestions were generated for the first 20 violations to avoid timeout. Apply these fixes and re-validate to process the remaining issues.`);
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to generate AI suggestions.';
      setAiError(
        err.code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout')
          ? 'AI suggestion timed out. The EPUB has many violations — try running "Save Changes & Re-validate" first to apply the automatic fixes, then generate AI suggestions for remaining issues.'
          : msg
      );
    } finally {
      setLoadingAi(false);
    }
  };

  useEffect(() => {
    const targetJobId = initialJobId ? String(initialJobId) : '';
    if (!targetJobId) return;
    if (jobId) return; // do not override manual upload/check flow

    let isCancelled = false;
    const init = async () => {
      setLoadingInit(true);
      setError('');
      setAiError('');
      setRevalidateFailed(false);
      setRevalidateError('');
      try {
        const reportRes = await api.get(`/accessibility/report/${targetJobId}/json`);
        const nextReport = reportRes.data?.data?.report || reportRes.data?.report || null;
        if (!nextReport) throw new Error('Accessibility report not found for this job.');

        const nextAllViolations = Array.isArray(nextReport?.allViolations) ? nextReport.allViolations : [];
        const nextSummary = computeSummaryFromViolations(nextAllViolations);

        if (isCancelled) return;
        setJobId(targetJobId);
        setSummary(nextSummary);
        setReportUrl(`/backend/reports/${targetJobId}/report.html`);
        setReport(nextReport);
        setAllViolations(nextAllViolations);
        setMetadata(nextReport?.metadata || nextReport?.publication || {});
        setCodeRepairDrafts([]);
        onResetDraftsFromReport(nextReport);

        if (autoSuggest && nextSummary.totalViolations > 0) {
          await handleGenerateAiSuggestions(targetJobId);
        }
      } catch (err) {
        if (isCancelled) return;
        setError(err.response?.data?.error || err.message || 'Failed to load accessibility job.');
      } finally {
        if (!isCancelled) setLoadingInit(false);
      }
    };

    init();
    return () => {
      isCancelled = true;
    };
  }, [autoSuggest, initialJobId, jobId]);

  const handleApproveAllAiFixes = () => {
    setCodeRepairDrafts((prev) => prev.map((item) => ({ ...item, approved: true })));
  };

  const handleSaveAndRevalidate = async () => {
    if (!jobId) return;
    setError('');
    setLoadingFix(true);
    try {
      const imageAltUpdates = {};
      const autoHandledNormalized = new Set([
        ...Array.from(decorativeImages),
        ...Array.from(svgPageImages),
        ...Array.from(fxlPageCanvasImages)
      ].map((s) => normalizeImageSrc(s)));
      const autoHandledBasenames = new Set(
        Array.from(autoHandledNormalized).map((s) => s.split('/').pop()).filter(Boolean)
      );
      for (const [src, alt] of Object.entries(imageAltDrafts)) {
        if (!src || typeof alt !== 'string') continue;
        // Do not write custom alt text for auto-handled fixed-layout/decorative cases.
        const normSrc = normalizeImageSrc(src);
        const base = normSrc.split('/').pop();
        const isAutoHandledImage = autoHandledNormalized.has(normSrc)
          || (!!base && autoHandledBasenames.has(base));
        if (isAutoHandledImage) continue;
        imageAltUpdates[src] = alt;
      }
      const headingLevelUpdates = showHeadingSection
        ? headingLevelDraftsReady.map((h) => Number(h.nextLevel))
        : [];

      const payload = {
        imageAltUpdates,
        headingLevelUpdates,
        approvedCodeRepairs: codeRepairDrafts
          // Rules marked "Auto-fixed on Save" are handled by backend global fixes first.
          // Do not also submit AI snippet patches for the same rules.
          .filter((c) => !AUTO_FIXED_RULES[c.title])
          .filter((c) => c.approved && c.fixedSnippet && c.offendingSnippet)
          .map((c) => ({
            violationId: c.violationId,
            filePath: c.filePath,
            offendingSnippet: c.offendingSnippet,
            fixedSnippet: c.fixedSnippet
          }))
      };

      const response = await api.post(
        `/accessibility/${jobId}/remediate`,
        payload,
        { timeout: 600000 }
      ); // Ace can take several minutes on large/problematic EPUBs
      const data = response.data?.data || response.data;

      applyReportData(data, data.report);
      setCodeRepairDrafts([]);
      setAiError('');
      const failed = !!data.revalidateFailed;
      setRevalidateFailed(failed);
      setRevalidateError(failed ? (data.revalidateError || 'Re-validation failed.') : '');
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Failed to apply fixes.';
      const isTimeout = err.code === 'ECONNABORTED' || String(message).toLowerCase().includes('timeout');
      setError(
        isTimeout
          ? 'Save/Re-validate timed out in the browser. Your fixes may still be applied. Please click "Run check again" to continue re-validation.'
          : message
      );
    } finally {
      setLoadingFix(false);
    }
  };

  const handleRunCheckAgain = async () => {
    if (!jobId) return;
    setError('');
    setRevalidateError('');
    setLoadingRecheck(true);
    try {
      const response = await api.post(`/accessibility/${jobId}/recheck`, {}, { timeout: 600000 });
      const data = response.data?.data || response.data;
      applyReportData(data, data.report);
      setRevalidateFailed(false);
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Re-check failed.';
      const isTimeout = err.code === 'ECONNABORTED' || String(message).toLowerCase().includes('timeout');
      setRevalidateError(
        isTimeout
          ? 'Re-check is taking too long. Please try again; if it repeats, the EPUB likely has a content file that Ace cannot process in time.'
          : message
      );
    } finally {
      setLoadingRecheck(false);
    }
  };

  const busy = loadingCheck || loadingFix || loadingRecheck || loadingInit;

  // ---- Render ----
  return (
    <div className="aw-card">
      <div className="aw-header">
        <h2 className="aw-title">Accessibility Wizard</h2>
        <p className="aw-subtitle">
          Upload an EPUB → review all violations → apply AI-assisted fixes → re-validate → download a WCAG&nbsp;AA&#8209;compliant EPUB.
        </p>
      </div>

      {/* ── Step 1: Upload ── */}
      <div className="aw-upload-section">
        {/* Label above row */}
        <span className="aw-file-label-inline">Select EPUB file</span>

        {/* Row 1: file controls + centre hint + run button */}
        <div className="aw-upload-row">
          {/* Left: choose + filename */}
          <label className="aw-file-btn" htmlFor="epub-file-input">
            Choose File
          </label>
          <input
            id="epub-file-input"
            type="file"
            accept=".epub,application/epub+zip"
            onChange={handleFileChange}
            disabled={busy}
            className="aw-file-input-hidden"
          />
          {file
            ? (
              <span className="aw-file-chosen">
                <FileText size={14} strokeWidth={2} className="aw-file-chosen-doc" aria-hidden />
                <span className="aw-file-chosen-name" title={file.name}>{file.name}</span>
                <button
                  type="button"
                  className="aw-file-remove-btn"
                  onClick={handleRemoveFile}
                  disabled={busy}
                  aria-label="Remove selected file"
                  title="Remove file"
                >
                  <X size={11} strokeWidth={2.75} aria-hidden />
                </button>
              </span>
            )
            : <span className="aw-file-placeholder">No file chosen</span>
          }

          {/* Centre: mini bar chart + pre-scan hint */}
          <div className="aw-upload-center">
            <div className="aw-prescan-bars">
              <div className="aw-prescan-bar" style={{ height: 14, background: '#6366f1' }} />
              <div className="aw-prescan-bar" style={{ height: 22, background: '#6366f1' }} />
              <div className="aw-prescan-bar" style={{ height: 18, background: '#6366f1' }} />
              <div className="aw-prescan-bar" style={{ height: 26, background: '#6366f1' }} />
              <div className="aw-prescan-bar" style={{ height: 10, background: '#f59e0b' }} />
              <div className="aw-prescan-bar" style={{ height: 16, background: '#f59e0b' }} />
              <div className="aw-prescan-bar" style={{ height: 20, background: '#10b981' }} />
              <div className="aw-prescan-bar" style={{ height: 8,  background: '#10b981' }} />
              <div className="aw-prescan-bar" style={{ height: 12, background: '#94a3b8' }} />
            </div>
            <div className="aw-prescan-labels">
              <span>Text</span>
              <span>Structure</span>
              <span>Media</span>
              <span>Prints</span>
            </div>
            {file && (
              <p className="aw-prescan-hint">
                File pre-scan completed: structure identified. Press to run detailed standard checks.
              </p>
            )}
          </div>

          {/* Right: run button + status */}
          <div className="aw-upload-right">
            <button
              type="button"
              className="aw-run-btn"
              onClick={handleRunCheck}
              disabled={busy || !file}
            >
              {loadingCheck ? (
                <>
                  <Loader2 size={16} strokeWidth={2.25} className="aw-icon-spin" aria-hidden />
                  Analyzing…
                </>
              ) : (
                <>
                  <Play size={16} strokeWidth={2} className="aw-run-play" aria-hidden />
                  Run Accessibility Check
                </>
              )}
            </button>
            {file && !loadingCheck && (
              <span className="aw-analysis-status">
                <span className="aw-analysis-status-dot" />
                Analysis ready
              </span>
            )}
            {loadingCheck && (
              <span className="aw-analysis-status">
                <Loader2 size={12} strokeWidth={2.25} className="aw-icon-spin" aria-hidden />
                Running checks…
              </span>
            )}
          </div>
        </div>

        {/* Row 2: standards checkboxes */}
        <div className="aw-upload-divider" />
        <div className="aw-standards-row">
          {[
            { key: 'wcag21aa',      label: 'WCAG 2.1 AA' },
            { key: 'epubA11y',      label: 'EPUB Accessibility 1.1' },
            { key: 'wcag22aa',      label: 'Section 508' },
            { key: 'section508',    label: 'WCAG 2.2 AA' },
            { key: 'ariaLandmarks', label: 'ARIA landmarks' },
          ].map(({ key, label }) => (
            <label key={key} className="aw-std-label">
              <input
                type="checkbox"
                className="aw-std-checkbox"
                checked={standards[key]}
                onChange={() => setStandards(prev => ({ ...prev, [key]: !prev[key] }))}
              />
              <span className="aw-std-text">{label}</span>
              <span className="aw-std-info" title={`Learn more about ${label}`} aria-hidden>
                <Info size={9} strokeWidth={2.75} />
              </span>
            </label>
          ))}
        </div>

        {error && <div className="aw-error-bar">{error}</div>}
      </div>

      {/* ── Results ── */}
      {jobId && (
        <div className="aw-results">

          {/* ── Step 2: Stats ── */}
          <div className="aw-stats-row">
            {SEVERITIES.map((sev) => (
              <div key={sev} className={`aw-stat-card aw-stat-${sev}`}>
                <span className="aw-stat-label">{SEVERITY_LABELS[sev]}</span>
                <span className="aw-stat-count">{summary.bySeverity?.[sev] ?? 0}</span>
              </div>
            ))}
            <div className="aw-stat-card aw-stat-total">
              <span className="aw-stat-label">Total</span>
              <span className="aw-stat-count">{summary.totalViolations}</span>
            </div>
          </div>

          {/* ── Step 3 (success): 0 violations ── */}
          {!hasViolations && !revalidateFailed && summary.totalViolations === 0 && (
            <div className="aw-success-banner">
              <div className="aw-success-icon" aria-hidden>
                <CircleCheck size={40} strokeWidth={2} />
              </div>
              <div className="aw-success-content">
                <strong>0 violations — EPUB meets WCAG AA!</strong>
                <p>All accessibility issues have been resolved.</p>
              </div>
              <div className="aw-success-actions">
                <a className="aw-download-btn" href={downloadEpubUrl}>
                  <Download size={16} strokeWidth={2.25} aria-hidden />
                  Download AA-Compliant EPUB
                </a>
                {absoluteReportUrl && (
                  <a className="aw-view-report-link" href={absoluteReportUrl} target="_blank" rel="noreferrer">
                    <FileText size={15} strokeWidth={2} aria-hidden />
                    View Ace Report
                  </a>
                )}
                {downloadReportPdfUrl && (
                  <a className="aw-download-report-link" href={downloadReportPdfUrl} target="_blank" rel="noreferrer">
                    <Download size={15} strokeWidth={2.25} aria-hidden />
                    Download Report (PDF)
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3 (violations): Fix panel ── */}
          {hasViolations && (
            <div className="aw-fix-panel">

              {/* Toolbar */}
              <div className="aw-fix-toolbar">
                <div className="aw-fix-toolbar-left">
                  <span className="aw-fix-badge">
                    <Wrench size={13} strokeWidth={2.25} aria-hidden />
                    Fix Mode ON
                  </span>
                  <span className="aw-fix-hint">AI suggestions are drafts — review, edit, approve, then save.</span>
                </div>
                <div className="aw-fix-toolbar-right">
                  <button
                    type="button"
                    className="aw-ai-btn"
                    onClick={handleGenerateAiSuggestions}
                    disabled={loadingAi || busy}
                  >
                    {loadingAi ? (
                      <>
                        <Loader2 size={15} strokeWidth={2.25} className="aw-icon-spin" aria-hidden />
                        Running AI in parallel… (may take ~30s)
                      </>
                    ) : (
                      <>
                        <Sparkles size={15} strokeWidth={2} aria-hidden />
                        Generate AI Suggestions
                      </>
                    )}
                  </button>
                  {codeRepairDrafts.length > 0 && (
                    <button
                      type="button"
                      className="aw-approve-all-btn"
                      onClick={handleApproveAllAiFixes}
                      disabled={busy}
                    >
                      <Check size={15} strokeWidth={2.75} aria-hidden />
                      Approve All AI Fixes
                    </button>
                  )}
                </div>
              </div>

              {aiError && <div className="aw-error-bar">{aiError}</div>}

              {revalidateFailed && (
                <div className="aw-revalidate-warn">
                  <strong>Fixes saved.</strong> Re-validation failed — Ace could not load a content page.
                  {revalidateError && <p className="aw-rv-detail">{revalidateError}</p>}
                  <button type="button" className="aw-recheck-btn" onClick={handleRunCheckAgain} disabled={loadingRecheck}>
                    {loadingRecheck ? (
                      <>
                        <Loader2 size={14} strokeWidth={2.25} className="aw-icon-spin" aria-hidden />
                        Re-running…
                      </>
                    ) : (
                      <>
                        <RefreshCw size={14} strokeWidth={2.25} aria-hidden />
                        Run check again
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* ─── Section: Image Alt Text ─── */}
              {altViolations.length > 0 && (
                <div className="aw-section">
                  <div className="aw-section-header">
                    <span className="aw-badge aw-badge-serious">Serious</span>
                    <span className="aw-section-title-text">Missing Image Alt Text</span>
                    <span className="aw-issue-count">{altViolations.length} image{altViolations.length !== 1 ? 's' : ''}</span>
                  </div>
                  <p className="aw-section-desc">
                    Content images need descriptive alt text. FXL page images (SVG) and decorative images will be
                    fixed automatically on Save — no text needed for those.
                  </p>
                  <div className="aw-alt-list">
                    {altViolations.map((img) => {
                      const src = img.src;
                      const isDecorative = decorativeImages.has(src);
                      const isSvgPage = !isDecorative && svgPageImages.has(src);
                      const isFxlCanvasPage = !isDecorative && !isSvgPage && fxlPageCanvasImages.has(src);
                      const draft = imageAltDrafts[src] ?? '';
                      const isAutoFixed = isDecorative || isSvgPage || isFxlCanvasPage;
                      return (
                        <div key={src} className={`aw-alt-card${isAutoFixed ? ' aw-alt-card-decorative' : ''}`}>
                          <img className="aw-alt-thumb" src={imageUrl(src)} alt="" />
                          <div className="aw-alt-right">
                            <div className="aw-alt-src">
                              {src.split('/').pop()}
                              {isSvgPage && (
                                <span className="aw-alt-decorative-badge">
                                  <Settings size={12} strokeWidth={2.25} aria-hidden />
                                  FXL Page SVG — auto role=&quot;img&quot; on Save
                                </span>
                              )}
                              {isFxlCanvasPage && (
                                <span className="aw-alt-decorative-badge">
                                  <Settings size={12} strokeWidth={2.25} aria-hidden />
                                  FXL Page Image — auto handled on Save
                                </span>
                              )}
                              {isDecorative && (
                                <span className="aw-alt-decorative-badge">
                                  <Settings size={12} strokeWidth={2.25} aria-hidden />
                                  Decorative — auto alt=&quot;&quot; on Save
                                </span>
                              )}
                            </div>
                            {isSvgPage ? (
                              <div className="aw-alt-decorative-note">
                                This is a Fixed Layout page rendered as an SVG canvas. SVG images don&apos;t use
                                the <code>alt</code> attribute — the engine will automatically add{' '}
                                <code>role=&quot;img&quot;</code> and <code>aria-label=&quot;Page N&quot;</code>{' '}
                                to the SVG wrapper so screen readers can announce the page.
                              </div>
                            ) : isFxlCanvasPage ? (
                              <div className="aw-alt-decorative-note">
                                This is a Fixed Layout page canvas image. It is treated as page-level artwork and
                                auto-handled on Save, so custom alt text is not required here.
                              </div>
                            ) : isDecorative ? (
                              <div className="aw-alt-decorative-note">
                                This image has <code>role=&quot;presentation&quot;</code>. An explicit{' '}
                                <code>alt=&quot;&quot;</code> will be added automatically so Ace no longer shows N/A.
                              </div>
                            ) : (
                              <input
                                type="text"
                                className="aw-alt-input"
                                placeholder="Describe this image for screen readers…"
                                value={draft}
                                onChange={(e) =>
                                  setImageAltDrafts((prev) => ({ ...prev, [src]: e.target.value }))
                                }
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ─── Section: Heading Order ─── */}
              {showHeadingSection && (
                <div className="aw-section">
                  <div className="aw-section-header">
                    <span className="aw-badge aw-badge-moderate">Moderate</span>
                    <span className="aw-section-title-text">Heading Order</span>
                  </div>
                  <p className="aw-section-desc">
                    Heading levels must increase by one (e.g. H1→H2, not H1→H3). Set the correct level for each heading.
                  </p>
                  <div className="aw-heading-list">
                    {headingLevelDraftsReady.map((h, idx) => (
                      <div key={`${h.text}-${idx}`} className="aw-heading-row">
                        <div className="aw-heading-text">
                          <span>{h.text}</span>
                          <span className="aw-heading-cur">Currently H{h.currentLevel ?? '?'}</span>
                        </div>
                        <span className="aw-heading-arrow" aria-hidden>
                          <ArrowRight size={16} strokeWidth={2} />
                        </span>
                        <select
                          className="aw-heading-select"
                          value={h.nextLevel}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setHeadingDrafts((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], nextLevel: val };
                              return next;
                            });
                          }}
                        >
                          {[1, 2, 3, 4, 5, 6].map((l) => (
                            <option key={l} value={l}>H{l}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── Sections: Code violations by severity ─── */}
              {anyCodeViolations && SEVERITIES.map((sev) => {
                const group = codeViolationsBySeverity[sev] || [];
                if (group.length === 0) return null;
                return (
                  <div key={sev} className="aw-section">
                    <div className="aw-section-header">
                      <span className={`aw-badge aw-badge-${sev}`}>{SEVERITY_LABELS[sev]}</span>
                      <span className="aw-section-title-text">Code Violations</span>
                      <span className="aw-issue-count">{group.length} issue{group.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="aw-violation-list">
                      {group.map((violation) => {
                        const draftIdx = codeRepairDrafts.findIndex((d) => d.violationId === violation.id);
                        const draft = draftIdx >= 0 ? codeRepairDrafts[draftIdx] : null;
                        return (
                          <div key={violation.id} className="aw-violation-card">
                            <div className="aw-violation-meta">
                              <span className="aw-violation-rule">{violation.title}</span>
                              {violation.filePath && (
                                <span className="aw-violation-file">{violation.filePath.split('/').pop()}</span>
                              )}
                            </div>
                            {violation.description && (
                              <p className="aw-violation-desc">{violation.description}</p>
                            )}
                            {violation.helpDescription && !violation.description && (
                              <p className="aw-violation-desc">{violation.helpDescription}</p>
                            )}
                            {violation.offendingSnippet && (
                              <details className="aw-snippet-details">
                                <summary className="aw-snippet-summary">View offending HTML</summary>
                                <pre className="aw-snippet-pre">{violation.offendingSnippet.slice(0, 500)}</pre>
                              </details>
                            )}
                            {AUTO_FIXED_RULES[violation.title] ? (
                              <div className="aw-auto-fix-card">
                                <div className="aw-auto-fix-header">
                                  <span className="aw-auto-fix-icon" aria-hidden>
                                    <Settings size={15} strokeWidth={2.25} />
                                  </span>
                                  <strong>Auto-fixed on Save</strong>
                                  <span className="aw-auto-fix-file">{AUTO_FIXED_RULES[violation.title].file}</span>
                                </div>
                                <p className="aw-auto-fix-summary">{AUTO_FIXED_RULES[violation.title].summary}</p>
                                <div className="aw-auto-fix-patch-label">Change that will be applied:</div>
                                <pre className="aw-auto-fix-patch">{AUTO_FIXED_RULES[violation.title].patch}</pre>
                              </div>
                            ) : draft ? (
                              <div className="aw-fix-area">
                                {draft.reason && (
                                  <p className="aw-fix-reason">
                                    <Lightbulb size={14} strokeWidth={2.25} className="aw-fix-reason-icon" aria-hidden />
                                    <span>{draft.reason}</span>
                                  </p>
                                )}
                                {draft.error && (
                                  <p className="aw-fix-error">
                                    <AlertTriangle size={14} strokeWidth={2.25} className="aw-fix-error-icon" aria-hidden />
                                    <span>{draft.error}</span>
                                  </p>
                                )}
                                <div className="aw-fix-label">AI Suggested Fix (editable)</div>
                                <textarea
                                  className="aw-fix-textarea"
                                  rows={5}
                                  value={draft.fixedSnippet}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCodeRepairDrafts((prev) => {
                                      const next = [...prev];
                                      next[draftIdx] = { ...next[draftIdx], fixedSnippet: val };
                                      return next;
                                    });
                                  }}
                                />
                                <label className="aw-approve-label">
                                  <input
                                    type="checkbox"
                                    checked={!!draft.approved}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setCodeRepairDrafts((prev) => {
                                        const next = [...prev];
                                        next[draftIdx] = { ...next[draftIdx], approved: checked };
                                        return next;
                                      });
                                    }}
                                  />
                                  Approve this fix
                                </label>
                              </div>
                            ) : violation.offendingSnippet ? (
                              <div className="aw-no-fix-hint">
                                Click <strong>Generate AI Suggestions</strong> to get an automated fix for this issue.
                              </div>
                            ) : (
                              <div className="aw-no-snippet-hint">
                                <Info size={15} strokeWidth={2.25} className="aw-no-snippet-icon" aria-hidden />
                                <span>
                                  No HTML snippet available — this is a structural/metadata issue.
                                  Click <strong>Save Changes &amp; Re-validate</strong> to apply all global fixes.
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* ─── Step 4: Save & Re-validate ─── */}
              <div className="aw-save-bar">
                {absoluteReportUrl && (
                  <a className="aw-view-report-link" href={absoluteReportUrl} target="_blank" rel="noreferrer">
                    <FileText size={15} strokeWidth={2} aria-hidden />
                    View Ace Report
                  </a>
                )}
                {downloadReportPdfUrl && (
                  <a className="aw-download-report-link" href={downloadReportPdfUrl} target="_blank" rel="noreferrer">
                    <Download size={15} strokeWidth={2.25} aria-hidden />
                    Download Report (PDF)
                  </a>
                )}
                <button
                  type="button"
                  className="aw-save-btn"
                  onClick={handleSaveAndRevalidate}
                  disabled={loadingFix || loadingRecheck}
                >
                  {loadingFix ? (
                    <>
                      <Loader2 size={16} strokeWidth={2.25} className="aw-icon-spin" aria-hidden />
                      Applying &amp; Re-validating…
                    </>
                  ) : (
                    <>
                      <Save size={16} strokeWidth={2.25} aria-hidden />
                      Save Changes &amp; Re-validate
                    </>
                  )}
                </button>
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AccessibilityWizard;
