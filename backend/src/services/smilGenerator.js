/**
 * SMIL Generator from Transcript
 * 
 * Generates EPUB3-compliant SMIL (Synchronized Multimedia Integration Language)
 * files from transcript JSON data.
 * 
 * Architecture:
 * - Transcript JSON is the single source of truth
 * - Each fragment in transcript becomes a <par> element in SMIL
 * - Fragment IDs must match XHTML element IDs exactly
 * - Audio clipBegin/clipEnd use timings from transcript (aeneas output)
 * 
 * SMIL Structure:
 * <smil>
 *   <body>
 *     <seq> (sequence of parallel elements)
 *       <par> (parallel: text + audio)
 *         <text src="chapter.xhtml#fragmentId"/>
 *         <audio src="audio.mp3" clipBegin="0.000s" clipEnd="2.345s"/>
 *       </par>
 *     </seq>
 *   </body>
 * </smil>
 */

/**
 * Normalize fragments for SMIL: monotonic clipBegin, min duration (200ms), optional anticipatory offset.
 * Kitaboo-style: prevents flicker (min 200ms) and ensures clipBegin always increases.
 * @param {Array} fragments - [{id, startTime, endTime}]
 * @param {Object} options - { minDurationSec: 0.2, anticipatoryOffsetSec: 0 }
 * @returns {Array} Normalized fragments
 */
export function normalizeFragmentsForSmil(fragments, options = {}) {
  const { minDurationSec = 0.2, anticipatoryOffsetSec = 0 } = options;
  const raw = (fragments || []).filter((f) => {
    const s = f?.startTime != null ? parseFloat(f.startTime) : NaN;
    const e = f?.endTime != null ? parseFloat(f.endTime) : NaN;
    return f?.id != null && !Number.isNaN(s) && !Number.isNaN(e);
  });
  const out = [];
  let prevEnd = 0;
  for (const f of raw) {
    let start = Math.max(parseFloat(f.startTime), prevEnd);
    let end = Math.max(parseFloat(f.endTime), start + minDurationSec);
    if (end - start < minDurationSec) end = start + minDurationSec;
    out.push({ ...f, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) });
    prevEnd = end;
  }
  return out;
}

/**
 * Generate SMIL content from transcript JSON
 * Enforces: clipBegin always increases, min duration 200ms, optional anticipatory offset (Kitaboo-style).
 *
 * @param {Object} transcript - Transcript JSON data
 * @param {string} xhtmlFileName - Name of XHTML file (e.g., "page_1.xhtml")
 * @param {string} audioFileName - Name of audio file (e.g., "audio.mp3")
 * @param {Object} options - Additional options { minDurationSec: 0.2, anticipatoryOffsetSec: 0.05 }
 * @returns {string} SMIL XML content
 */
export function generateSMILFromTranscript(transcript, xhtmlFileName, audioFileName, options = {}) {
  const {
    namespace = 'http://www.w3.org/2001/SMIL20/',
    epubNamespace = 'http://www.idpf.org/2007/ops',
    minDurationSec = 0.2,
    anticipatoryOffsetSec = 0
  } = options;

  if (!transcript || !transcript.fragments || transcript.fragments.length === 0) {
    throw new Error('Transcript must have fragments array');
  }

  const normalized = normalizeFragmentsForSmil(transcript.fragments, { minDurationSec, anticipatoryOffsetSec });

  // Build sequence of parallel elements (clipBegin always increases, min 200ms per par)
  const parElements = normalized
    .filter(f => (f.endTime - f.startTime) >= minDurationSec)
    .map(fragment => {
      const start = fragment.startTime;
      const end = fragment.endTime;
      const clipBeginSec = Math.max(0, start - (anticipatoryOffsetSec || 0));
      const clipEndSec = end;
      const clipBegin = `${clipBeginSec.toFixed(3)}s`;
      const clipEnd = `${Math.max(clipBeginSec + 0.001, clipEndSec).toFixed(3)}s`;

      return `      <par>
        <text src="${xhtmlFileName}#${fragment.id}"/>
        <audio src="${audioFileName}" clipBegin="${clipBegin}" clipEnd="${clipEnd}"/>
      </par>`;
    })
    .join('\n');

  // Build complete SMIL document
  const smilContent = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="${namespace}" xmlns:epub="${epubNamespace}" version="3.0">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${transcript.jobId}-page-${transcript.pageNumber}"/>
    <meta name="dtb:totalElapsedTime" content="${getTotalDuration(transcript).toFixed(3)}"/>
    <meta name="dtb:audioClock" content="UTC"/>
  </head>
  <body>
    <seq>
${parElements}
    </seq>
  </body>
</smil>`;

  return smilContent;
}

/**
 * Calculate total duration from transcript fragments
 */
function getTotalDuration(transcript) {
  if (!transcript.fragments || transcript.fragments.length === 0) {
    return 0;
  }

  const lastFragment = transcript.fragments[transcript.fragments.length - 1];
  return lastFragment.endTime || 0;
}

/**
 * Generate SMIL file and save to disk
 * 
 * @param {Object} transcript - Transcript JSON data
 * @param {string} outputDir - Directory to save SMIL file
 * @param {string} xhtmlFileName - Name of XHTML file
 * @param {string} audioFileName - Name of audio file
 * @returns {Promise<string>} Path to saved SMIL file
 */
export async function generateAndSaveSMIL(transcript, outputDir, xhtmlFileName, audioFileName) {
  const fs = await import('fs/promises');
  const path = await import('path');

  const smilContent = generateSMILFromTranscript(transcript, xhtmlFileName, audioFileName);
  const smilFileName = `page_${transcript.pageNumber}.smil`;
  const smilPath = path.join(outputDir, smilFileName);

  await fs.writeFile(smilPath, smilContent, 'utf8');

  console.log(`[SMILGenerator] Generated SMIL file: ${smilFileName} with ${transcript.fragments.length} fragments`);

  return smilPath;
}







