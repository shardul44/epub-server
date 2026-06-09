import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../utils/logger.js';
const log = createLogger('SmilGeneration');
function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
export class SmilGenerationService {
    /**
     * Generate SMIL media overlay files — one per page.
     * Each sentence maps to begin, end, and text fragment (#sentence_id).
     */
    static async generate(smilDir, coords, options = {}) {
        await fs.mkdir(smilDir, { recursive: true });
        const secondsPerWord = options.secondsPerWord ?? 0.35;
        const sentencePauseSec = options.sentencePauseSec ?? 0.3;
        const audioFileName = options.audioFileName ?? 'narration.mp3';
        const smilFiles = [];
        let globalTime = 0;
        for (const page of coords.pages) {
            const pageSentences = coords.sentences.filter((s) => s.page === page.number);
            const xhtmlFileName = `pages/page_${page.number}.xhtml`;
            const smilFileName = `page_${page.number}.smil`;
            const timings = [];
            for (const sentence of pageSentences) {
                const wordCount = sentence.words.length;
                const duration = Math.max(wordCount * secondsPerWord, 0.5);
                const begin = globalTime;
                const end = begin + duration;
                timings.push({
                    sentenceId: sentence.id,
                    begin,
                    end,
                    textFragment: `${xhtmlFileName}#${sentence.id}`,
                });
                globalTime = end + sentencePauseSec;
            }
            const smilContent = SmilGenerationService.buildSmil(xhtmlFileName, audioFileName, timings);
            const smilPath = path.join(smilDir, smilFileName);
            await fs.writeFile(smilPath, smilContent, 'utf8');
            smilFiles.push(smilFileName);
        }
        log.info('SMIL files generated', { count: smilFiles.length });
        return smilFiles;
    }
    static buildSmil(xhtmlFileName, audioFileName, timings) {
        const textDocRef = escapeXml(xhtmlFileName.split('#')[0]);
        const parElements = timings
            .map((t) => {
            const clipBegin = `${t.begin.toFixed(3)}s`;
            const clipEnd = `${t.end.toFixed(3)}s`;
            return `    <par id="par_${escapeXml(t.sentenceId)}">
      <text src="${escapeXml(t.textFragment)}"/>
      <audio src="../audio/${escapeXml(audioFileName)}" clipBegin="${clipBegin}" clipEnd="${clipEnd}"/>
    </par>`;
        })
            .join('\n');
        return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq epub:textref="${textDocRef}">
${parElements}
    </seq>
  </body>
</smil>`;
    }
}
//# sourceMappingURL=SmilGenerationService.js.map