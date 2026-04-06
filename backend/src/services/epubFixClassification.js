/**
 * EPUBCheck message classification for deterministic auto-fix.
 * We only auto-fix codes we map to safe handlers — never attempt all EPUBCheck codes.
 *
 * Expand HANDLER_CODE_MAP gradually (top ~15–20 common codes ≈ most real-world noise).
 */

/**
 * EPUBCheck JSON uses `id` (often lowercase key); codes are uppercase (OPF-027).
 * If missing, try to extract a code from the message text (e.g. "RSC-005").
 */
export function messageId(m) {
  if (!m || typeof m !== 'object') return '';
  let raw = m.ID ?? m.id ?? m.code ?? m.messageCode ?? m.messageId;
  raw = raw != null ? String(raw).trim() : '';
  if (!raw && typeof m.message === 'string') {
    const match = m.message.match(/\b([A-Z]{2,5}-\d{2,4}[a-z]?)\b/i);
    if (match) raw = match[1];
  }
  return raw ? raw.toUpperCase() : '';
}

/**
 * Handler IDs (must match epubAutoFixEngine runner).
 * @typedef {'package'|'metadata'|'manifest'|'spine'|'nav'|'cssImports'|'encryption'|'xhtmlDoctype'|'xhtmlStructure'|'xhtmlLang'|'brokenLinks'|'smilRefs'} HandlerId
 */

/** Which EPUBCheck codes trigger which deterministic handler (union = auto-fixable set). */
export const HANDLER_CODE_MAP = {
  package: [
    'OPF-086',
    'OPF-006',
    'PKG-001',
    'PKG-002',
    'PKG-025',
    'PKG-007',
    'PKG-008'
  ],
  metadata: [
    'OPF-003',
    'OPF-004',
    'OPF-009',
    'OPF-010',
    'OPF-012',
    'OPF-025',
    'OPF-007',
    'OPF-027',
    'OPF-085',
    'OPF-046',
    'OPF-047',
    'OPF-048',
    'OPF-049',
    'OPF-076',
    'CHK-008',
    'OPF-011',
    'MED-016'
  ],
  manifest: [
    'OPF-018',
    'OPF-019',
    'OPF-021',
    'OPF-022',
    'OPF-023',
    'OPF-024',
    'OPF-099',
    'MED-010',
    'RSC-001',
    'RSC-026',
    'RSC-005'
  ],
  spine: ['OPF-014', 'OPF-015', 'OPF-016', 'OPF-017', 'OPF-013', 'OPF-050'],
  nav: ['OPF-042', 'OPF-043', 'NAV-001', 'NAV-004', 'OPF-044', 'RSC-005'],
  cssImports: ['RSC-006', 'RSC-013', 'RSC-014', 'HTM-017', 'CSS-008'],
  encryption: ['RSC-005', 'PKG-008'],
  xhtmlDoctype: ['HTM-004'],
  xhtmlStructure: ['HTM-003', 'HTM-008', 'HTM-009', 'HTM-010', 'RSC-005'],
  xhtmlLang: ['HTM-001', 'HTM-005', 'HTM-015', 'HTM-016'],
  brokenLinks: ['RSC-007', 'RSC-006', 'RSC-012', 'RSC-013'],
  smilRefs: ['RSC-005', 'OPF-039', 'OPF-040', 'SMIL-001', 'SMIL-002']
};

/** Codes where AI / human review is typical (not run by deterministic engine). UX hint only. */
export const AI_ASSIST_CODES = new Set([
  'ACC-001',
  'ACC-002',
  'ACC-003',
  'ACC-004',
  'ACC-005',
  'ACC-006',
  'ACC-007',
  'ACC-008',
  'ACC-009',
  'ACC-010',
  'ACC-011',
  'ACC-012',
  'ACC-013',
  'ACC-014',
  'ACC-015',
  'HTM-006',
  'HTM-007'
]);

/** Build code → [handlers] (RSC-005 may map to manifest + smilRefs). Keys normalized to uppercase. */
function buildCodeToHandlers() {
  /** @type {Record<string, string[]>} */
  const map = {};
  for (const [handler, codes] of Object.entries(HANDLER_CODE_MAP)) {
    for (const c of codes) {
      const key = String(c).trim().toUpperCase();
      if (!map[key]) map[key] = [];
      if (!map[key].includes(handler)) map[key].push(handler);
    }
  }
  return map;
}

export const CODE_TO_HANDLERS = buildCodeToHandlers();

/** Ordered execution for OPF-dependent steps. */
export const HANDLER_ORDER = [
  'package',
  'metadata',
  'manifest',
  'spine',
  'nav',
  'cssImports',
  'encryption',
  'xhtmlDoctype',
  'xhtmlStructure',
  'xhtmlLang',
  'brokenLinks',
  'smilRefs'
];

/**
 * @param {string[]} codes
 * @returns {Set<string>}
 */
export function handlersForCodes(codes) {
  const handlers = new Set();
  for (const c of codes) {
    const list = CODE_TO_HANDLERS[String(c).trim().toUpperCase()];
    if (list) {
      for (const h of list) handlers.add(h);
    }
  }
  return handlers;
}

/**
 * Classify EPUBCheck messages into auto-fixable vs manual vs AI-assist hints.
 * @param {object[]} messages
 */
export function classifyEpubcheckMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const fixableMessages = [];
  const manualMessages = [];
  const aiAssistMessages = [];
  const fixableCodes = new Set();

  for (const m of list) {
    const id = messageId(m);
    if (!id) {
      manualMessages.push(m);
      continue;
    }
    if (CODE_TO_HANDLERS[id]) {
      fixableMessages.push(m);
      fixableCodes.add(id);
    } else if (AI_ASSIST_CODES.has(id)) {
      aiAssistMessages.push(m);
    } else {
      manualMessages.push(m);
    }
  }

  const handlersNeeded = handlersForCodes([...fixableCodes]);
  const orderedHandlers = HANDLER_ORDER.filter((h) => handlersNeeded.has(h));

  return {
    fixableMessages,
    manualMessages,
    aiAssistMessages,
    fixableCodes: [...fixableCodes].sort(),
    handlersNeeded: orderedHandlers,
    stats: {
      total: list.length,
      autoFixable: fixableMessages.length,
      requiresManualFix: manualMessages.length,
      aiAssistSuggested: aiAssistMessages.length
    }
  };
}

/**
 * @param {object[]|undefined} messages - undefined = run all handlers (legacy full run)
 * @returns {{ mode: 'full'|'targeted'|'none', handlers: Set<string>|null }}
 */
export function resolveAutoFixHandlers(messages) {
  if (messages === undefined) {
    return { mode: 'full', handlers: null };
  }
  if (!Array.isArray(messages)) {
    return { mode: 'full', handlers: null };
  }
  if (messages.length === 0) {
    return { mode: 'none', handlers: new Set() };
  }
  const { handlersNeeded } = classifyEpubcheckMessages(messages);
  if (handlersNeeded.length === 0) {
    // Targeted run would apply nothing (no matching codes / unparsed IDs) — run full safe pass so the EPUB actually changes.
    return { mode: 'full', handlers: null, fallbackFromEmptyTarget: true };
  }
  return {
    mode: 'targeted',
    handlers: new Set(handlersNeeded)
  };
}
