import { AudioSyncModel } from '../models/AudioSync.js';
import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { AiConfigurationModel } from '../models/AiConfiguration.js';
import fs from 'fs/promises';
import path from 'path';
import { getTtsOutputDir } from '../config/fileStorage.js';
import { v4 as uuidv4 } from 'uuid';

export class AudioSyncService {
  static async getAudioSyncsByPdfId(pdfId) {
    return await AudioSyncModel.findByPdfId(pdfId);
  }

  static async getAudioSyncsByJobId(jobId) {
    const syncs = await AudioSyncModel.findByJobId(jobId);
    return syncs.map(sync => ({
      id: sync.id,
      pdfDocumentId: sync.pdf_document_id,
      conversionJobId: sync.conversion_job_id,
      pageNumber: sync.page_number,
      blockId: sync.block_id,
      startTime: sync.start_time,
      endTime: sync.end_time,
      audioFilePath: sync.audio_file_path,
      notes: sync.notes,
      customText: sync.custom_text,
      isCustomSegment: sync.is_custom_segment,
      audioUrl: `/api/audio-sync/${sync.id}/audio`
    }));
  }

  static async getAudioSyncs(pdfId, jobId) {
    return await AudioSyncModel.findByPdfAndJob(pdfId, jobId);
  }

  static async saveAudioSync(syncData) {
    // Validate required fields
    if (!syncData.pdfDocumentId || !syncData.conversionJobId || 
        syncData.startTime === undefined || syncData.endTime === undefined) {
      throw new Error('Missing required fields for audio sync: pdfDocumentId, conversionJobId, startTime, and endTime are required');
    }

    // pageNumber and audioFilePath are optional (can be null)
    // audioFilePath can be null initially and set later when audio is generated
    // pageNumber can be derived from blockId or defaulted if not provided

    return await AudioSyncModel.create(syncData);
  }

  static async updateAudioSync(id, syncData) {
    const existing = await AudioSyncModel.findById(id);
    if (!existing) {
      throw new Error('Audio sync not found with id: ' + id);
    }

    return await AudioSyncModel.update(id, syncData);
  }

  static async deleteAudioSync(id) {
    const existing = await AudioSyncModel.findById(id);
    if (!existing) {
      throw new Error('Audio sync not found with id: ' + id);
    }

    await AudioSyncModel.delete(id);
  }

  static async deleteAudioSyncsByJobId(jobId) {
    await AudioSyncModel.deleteByJobId(jobId);
  }

  static async getConversionJob(jobId) {
    const job = await ConversionJobModel.findById(jobId);
    if (!job) {
      throw new Error('Conversion job not found with id: ' + jobId);
    }
    return job;
  }

  static async getPdfDocument(pdfId) {
    const pdf = await PdfDocumentModel.findById(pdfId);
    if (!pdf) {
      throw new Error('PDF document not found with id: ' + pdfId);
    }
    return pdf;
  }

  // Extract text from PDF (simplified - in production would use pdf-parse)
  static async extractTextFromPdf(pdfId) {
    const pdf = await this.getPdfDocument(pdfId);
    
    // TODO: Implement actual PDF text extraction using pdf-parse or similar
    // For now, return placeholder text chunks
    const textChunks = [
      { id: 1, pageNumber: 1, text: 'This is a sample text chunk from page 1 of the PDF document.', startTime: 0, endTime: 5 },
      { id: 2, pageNumber: 1, text: 'Another paragraph from the same page that continues the content.', startTime: 5, endTime: 10 },
      { id: 3, pageNumber: 2, text: 'Text from page 2 of the document.', startTime: 10, endTime: 13 },
      { id: 4, pageNumber: 2, text: 'More content from page 2.', startTime: 13, endTime: 16 }
    ];

    return textChunks;
  }

  // Extract text from EPUB sections (for audio syncing)
  static async extractTextFromEpub(jobId) {
    const { EpubService } = await import('./epubService.js');
    const textContent = await EpubService.getEpubTextContent(jobId);
    
    // Convert EPUB text content to chunks format
    const textChunks = [];
    let chunkId = 1;
    
    textContent.forEach(section => {
      // Split section text into paragraphs
      const paragraphs = section.text.split('\n').filter(p => p.trim());
      paragraphs.forEach((paragraph, idx) => {
        textChunks.push({
          id: chunkId++,
          pageNumber: section.sectionId,
          sectionId: section.sectionId,
          sectionTitle: section.title,
          text: paragraph.trim(),
          xhtml: section.xhtml
        });
      });
    });
    
    return textChunks;
  }

  // Build voice config for TtsService from voice id or object
  static _voiceConfig(voice) {
    if (voice && typeof voice === 'object' && (voice.languageCode || voice.name || voice.ssmlGender)) {
      return {
        languageCode: voice.languageCode || 'en-US',
        name: voice.name,
        ssmlGender: voice.ssmlGender || 'NEUTRAL'
      };
    }
    const id = String(voice || 'standard');
    return { languageCode: 'en-US', ssmlGender: 'NEUTRAL' };
  }

  // Resolve ffmpeg binary robustly across environments (windows path may point to missing .exe).
  static async _configureFfmpegPath(ffmpeg) {
    const ffmpegStatic = await import('ffmpeg-static');
    const configured = ffmpegStatic?.default;
    if (!configured) return;

    const isWindows = process.platform === 'win32';
    // On Windows, only .exe paths are spawnable for this use-case.
    // Do NOT try extensionless sibling (it exists in ffmpeg-static package but can't be spawned).
    const candidates = isWindows
      ? (/\.exe$/i.test(configured) ? [configured] : [`${configured}.exe`])
      : [configured, `${configured}.exe`];

    for (const c of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.stat(c);
        ffmpeg.setFfmpegPath(c);
        console.log(`[Audio] Using FFmpeg binary: ${c}`);
        return;
      } catch (_) { }
    }

    // Final fallback: rely on system ffmpeg command if static package binary is not runnable.
    // (On some Windows setups ffmpeg-static ships a non-.exe binary path that cannot be spawned.)
    const fallbackCmd = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    ffmpeg.setFfmpegPath(fallbackCmd);
    console.log(`[Audio] Using FFmpeg fallback command: ${fallbackCmd}`);
  }

  // Generate TTS audio for text chunks. Uses TtsService (Google Cloud) when available for speakingRate support; else gtts.
  static async generateAudioForText(text, voice = 'standard', pdfId, chunkId, options = {}) {
    await fs.mkdir(getTtsOutputDir(), { recursive: true }).catch(() => {});

    const audioFileName = `audio_${pdfId}_${chunkId}_${uuidv4()}.mp3`;
    const audioFilePath = path.join(getTtsOutputDir(), audioFileName);
    const estimatedDuration = this.estimateAudioDurationIntelligent(text);
    const speakingRate = options.speakingRate != null ? Number(options.speakingRate) : null;

    // Prefer Google Cloud TTS (TtsService) when available — supports speakingRate for faster voice
    const { TtsService } = await import('./TtsService.js');
    const client = TtsService.getClient();
    if (client && typeof client === 'object') {
      const voiceConfig = this._voiceConfig(voice);
      const result = await TtsService.synthesizePageAudio({
        text,
        audioOutPath: audioFilePath,
        voice: voiceConfig,
        speakingRate: speakingRate ?? 1.0,
        durationScaleFactor: undefined
      });
      if (result.audioFilePath && (result.timings?.length || result.audioFilePath)) {
        const duration = result.timings?.length
          ? result.timings[result.timings.length - 1].endTimeSec
          : TtsService.getMp3DurationSec(result.audioFilePath) ?? estimatedDuration;
        return {
          audioFilePath: result.audioFilePath,
          audioFileName,
          duration: Number(duration)
        };
      }
    }

    // Fallback: gtts (no speakingRate; use playback speed in UI for faster listening)
    const { AiConfigService } = await import('./aiConfigService.js');
    const aiConfig = await AiConfigService.getActiveConfiguration();
    if (!aiConfig || !aiConfig.apiKey) {
      throw new Error('No active AI configuration found. Please configure AI settings first.');
    }

    try {
      const gttsModule = await import('gtts');
      const Gtts = gttsModule.default || gttsModule.gtts;
      const gttsInstance = new Gtts(text, 'en');
      await new Promise((resolve, reject) => {
        gttsInstance.save(audioFilePath, (err) => {
          if (err) {
            console.warn(`[Audio] Google TTS failed for block ${chunkId}, using estimation: ${err.message}`);
            AudioSyncService.createSilentAudioFile(audioFilePath, estimatedDuration).then(() => resolve()).catch(() => resolve());
          } else {
            console.log(`[Audio] Generated TTS audio: ${audioFilePath} (${estimatedDuration}s)`);
            resolve();
          }
        });
      });
    } catch (ttsError) {
      console.warn(`[Audio] TTS library not available, using estimation: ${ttsError.message}`);
      await this.createSilentAudioFile(audioFilePath, estimatedDuration);
    }

    return {
      audioFilePath,
      audioFileName,
      duration: estimatedDuration
    };
  }

  // Intelligent audio duration estimation (like Java app - KITABOO-style)
  static estimateAudioDurationIntelligent(text) {
    if (!text || text.trim().length === 0) {
      return 0.5;
    }
    
    const trimmedText = text.trim();
    
    // Count words
    const wordCount = trimmedText.split(/\s+/).length;
    
    // Count sentences (periods, exclamation, question marks)
    const sentenceCount = trimmedText.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1;
    
    // Count punctuation (adds pauses)
    const punctuationCount = (trimmedText.match(/[.,!?;:]/g) || []).length;
    
    // Base reading speed: 200 words per minute = 3.33 words per second
    const wordsPerSecond = 3.33;
    
    // Calculate base duration
    const baseDuration = wordCount / wordsPerSecond;
    
    // Add pause time for punctuation (0.3s per punctuation mark)
    const pauseTime = punctuationCount * 0.3;
    
    // Add pause time for sentence breaks (0.5s per sentence break)
    const sentencePauseTime = (sentenceCount - 1) * 0.5;
    
    // Total estimated duration
    let estimatedDuration = baseDuration + pauseTime + sentencePauseTime;
    
    // Minimum duration
    if (estimatedDuration < 0.5) {
      estimatedDuration = 0.5;
    }
    
    return Math.ceil(estimatedDuration);
  }

  // Create a silent audio file with estimated duration
  static createSilentAudioFile(filePath, durationSeconds) {
    // Create a minimal valid MP3 file (silent)
    // This is a minimal MP3 frame header
    const mp3Header = Buffer.from([
      0xFF, 0xFB, 0x90, 0x00, // MP3 sync word and header
    ]);
    
    fs.writeFile(filePath, mp3Header).catch(err => {
      console.error(`[Audio] Error creating silent audio file:`, err);
    });
  }

  /** Normalize block text so TTS input and word-count mapping use the same source of truth. */
  static _normalizeBlockText(text) {
    return (text || '').trim().replace(/\s+/g, ' ');
  }

  /** Build full text from chunks with normalized spacing (single space between blocks). */
  static _fullTextFromChunks(textChunks) {
    return textChunks
      .map(c => this._normalizeBlockText(c.text))
      .filter(Boolean)
      .join(' ');
  }

  /** Word count from normalized text (must match what we send to TTS). */
  static _wordCount(text) {
    return (this._normalizeBlockText(text).split(/\s+/).filter(Boolean).length);
  }

  /**
   * FXL-style: one TTS call per section (page). Engine word timings match the audio exactly, so text and audio
   * stay in sync without running Aeneas. Sections are concatenated into one combined file.
   */
  static async _generateNaturalCompleteAudioPerSection(textChunks, voice, pdfId, jobId, combinedAudioFilePath, options = {}) {
    const { TtsService } = await import('./TtsService.js');
    const voiceConfig = this._voiceConfig(voice);
    const durationScaleFactor = parseFloat(process.env.TTS_DURATION_SCALE_FACTOR || process.env.SMIL_AUDIO_DURATION_FACTOR || '0.92', 10);
    const speakingRate = options.speakingRate != null ? Number(options.speakingRate) : 1.0;
    const dir = path.dirname(combinedAudioFilePath);

    // Group chunks by pageNumber (preserve order within page)
    const byPage = new Map();
    textChunks.forEach((c, idx) => {
      const page = c.pageNumber ?? 1;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push({ ...c, _order: idx });
    });
    const orderedPages = [...byPage.keys()].sort((a, b) => a - b);

    const sectionFiles = [];
    const sectionTimings = []; // { startOffset, duration, timings } per section

    let currentOffset = 0;
    for (const pageNum of orderedPages) {
      const chunks = byPage.get(pageNum);
      const sectionText = this._fullTextFromChunks(chunks);
      if (!sectionText) continue;

      const sectionPath = path.join(dir, `section_${jobId}_p${pageNum}.mp3`);
      const ttsResult = await TtsService.synthesizePageAudio({
        text: sectionText,
        audioOutPath: sectionPath,
        voice: voiceConfig,
        durationScaleFactor: Number.isFinite(durationScaleFactor) ? durationScaleFactor : 0.92,
        speakingRate
      });
      if (!ttsResult?.audioFilePath || !ttsResult.timings?.length) {
        console.warn(`[Audio] Per-section TTS skipped for page ${pageNum} (no result)`);
        continue;
      }
      const duration = TtsService.getMp3DurationSec(ttsResult.audioFilePath) ?? (ttsResult.timings[ttsResult.timings.length - 1]?.endTimeSec ?? 0);
      sectionFiles.push(sectionPath);
      sectionTimings.push({ startOffset: currentOffset, duration, timings: ttsResult.timings, chunks });
      currentOffset += duration;
    }

    if (sectionFiles.length === 0) return null;

    // Concat into one file (or copy if single section)
    if (sectionFiles.length === 1) {
      await fs.copyFile(sectionFiles[0], combinedAudioFilePath).catch(() => {});
      await fs.unlink(sectionFiles[0]).catch(() => {});
    } else {
      const fluentFfmpeg = await import('fluent-ffmpeg');
      const ffmpeg = fluentFfmpeg.default;
      await this._configureFfmpegPath(ffmpeg);
      const concatListPath = path.join(dir, `concat_sections_${jobId}.txt`);
      const concatListContent = sectionFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      await fs.writeFile(concatListPath, concatListContent, 'utf8');
      await new Promise((resolve, reject) => {
        ffmpeg(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(combinedAudioFilePath)
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
      });
      await fs.unlink(concatListPath).catch(() => {});
      for (const f of sectionFiles) await fs.unlink(f).catch(() => {});
    }

    // Map timings to chunks using section offset (same as FXL: engine timings per section)
    const audioSegments = [];
    for (const { startOffset, duration, timings, chunks } of sectionTimings) {
      const totalWordsInSection = chunks.reduce((s, c) => s + this._wordCount(c.text), 0);
      const useProportional = totalWordsInSection !== timings.length;
      if (useProportional && totalWordsInSection > 0) {
        console.warn(`[Audio] Per-section word count mismatch (page): chunks=${totalWordsInSection}, TTS=${timings.length}. Using proportional for this section.`);
      }
      let wordIndex = 0;
      for (const chunk of chunks) {
        const blockText = this._normalizeBlockText(chunk.text);
        if (!blockText) continue;
        const wordCount = this._wordCount(chunk.text);
        if (wordCount === 0) continue;
        let startTime;
        let endTime;
        if (useProportional && totalWordsInSection > 0 && duration > 0) {
          startTime = startOffset + (wordIndex / totalWordsInSection) * duration;
          endTime = startOffset + ((wordIndex + wordCount) / totalWordsInSection) * duration;
        } else {
          const startWordIdx = wordIndex;
          const endWordIdx = Math.min(wordIndex + wordCount - 1, timings.length - 1);
          if (startWordIdx >= timings.length) break;
          const first = timings[startWordIdx];
          const last = timings[endWordIdx];
          startTime = startOffset + (first.startTimeSec ?? 0);
          endTime = startOffset + (last.endTimeSec ?? last.startTimeSec ?? 0) + 0.05;
        }
        wordIndex += wordCount;

        const audioSync = await AudioSyncModel.create({
          pdfDocumentId: pdfId,
          conversionJobId: jobId,
          pageNumber: chunk.pageNumber ?? 1,
          blockId: chunk.id,
          startTime: Number(Number(startTime).toFixed(3)),
          endTime: Number(Number(endTime).toFixed(3)),
          audioFilePath: combinedAudioFilePath,
          notes: `Natural TTS (per-section, FXL-style), voice: ${typeof voice === 'object' ? voice?.name || 'default' : voice}`,
          customText: chunk.text,
          isCustomSegment: false
        });
        audioSegments.push({
          id: audioSync.id,
          pdfDocumentId: audioSync.pdf_document_id,
          conversionJobId: audioSync.conversion_job_id,
          pageNumber: audioSync.page_number,
          blockId: audioSync.block_id,
          startTime: audioSync.start_time,
          endTime: audioSync.end_time,
          audioFilePath: audioSync.audio_file_path,
          notes: audioSync.notes,
          customText: audioSync.custom_text,
          isCustomSegment: audioSync.is_custom_segment,
          text: chunk.text,
          audioUrl: `/api/audio-sync/${audioSync.id}/audio`
        });
      }
    }
    console.log(`[Audio] Path: Google Cloud TTS (per-section, FXL-style), ${sectionTimings.length} sections, ${audioSegments.length} blocks`);
    return audioSegments;
  }

  /**
   * Generate one continuous TTS stream for all chunks (same as FXL: natural flow, one voice).
   * Maps word-level timings back to each block. Used when Google Cloud TTS is available.
   * If TTS word count !== our chunk word count, uses proportional mapping so text and audio stay in sync.
   */
  static async _generateNaturalCompleteAudio(textChunks, voice, pdfId, jobId, combinedAudioFilePath, options = {}) {
    const { TtsService } = await import('./TtsService.js');
    const fullText = this._fullTextFromChunks(textChunks);
    if (!fullText) return null;

    const voiceConfig = this._voiceConfig(voice);
    const durationScaleFactor = parseFloat(process.env.TTS_DURATION_SCALE_FACTOR || process.env.SMIL_AUDIO_DURATION_FACTOR || '0.92', 10);
    const speakingRate = options.speakingRate != null ? Number(options.speakingRate) : 1.0;

    const ttsResult = await TtsService.synthesizePageAudio({
      text: fullText,
      audioOutPath: combinedAudioFilePath,
      voice: voiceConfig,
      durationScaleFactor: Number.isFinite(durationScaleFactor) ? durationScaleFactor : 0.92,
      speakingRate
    });

    if (!ttsResult.audioFilePath || !ttsResult.timings?.length) return null;

    const timings = ttsResult.timings;
    const totalWordsFromChunks = textChunks.reduce((sum, c) => sum + this._wordCount(c.text), 0);
    const ttsWordCount = timings.length;
    const durationSec = timings[ttsWordCount - 1]?.endTimeSec ?? TtsService.getMp3DurationSec(ttsResult.audioFilePath) ?? 0;
    const useProportional = totalWordsFromChunks !== ttsWordCount;
    if (useProportional) {
      console.warn(`[Audio] Word count mismatch: chunks=${totalWordsFromChunks}, TTS=${ttsWordCount}. Using proportional mapping so text and audio stay in sync.`);
    }

    let wordIndex = 0;
    const audioSegments = [];

    for (const chunk of textChunks) {
      const blockText = this._normalizeBlockText(chunk.text);
      if (!blockText) continue;

      const wordCount = this._wordCount(chunk.text);
      if (wordCount === 0) continue;

      let startTime;
      let endTime;

      if (useProportional && totalWordsFromChunks > 0 && durationSec > 0) {
        startTime = (wordIndex / totalWordsFromChunks) * durationSec;
        endTime = ((wordIndex + wordCount) / totalWordsFromChunks) * durationSec;
      } else {
        const startWordIdx = wordIndex;
        const endWordIdx = Math.min(wordIndex + wordCount - 1, timings.length - 1);
        if (startWordIdx >= timings.length) break;
        const firstWordTiming = timings[startWordIdx];
        const lastWordTiming = timings[endWordIdx];
        startTime = firstWordTiming.startTimeSec ?? 0;
        endTime = (lastWordTiming.endTimeSec ?? lastWordTiming.startTimeSec ?? 0) + 0.05;
      }

      const audioSync = await AudioSyncModel.create({
        pdfDocumentId: pdfId,
        conversionJobId: jobId,
        pageNumber: chunk.pageNumber ?? 1,
        blockId: chunk.id,
        startTime: Number(Number(startTime).toFixed(3)),
        endTime: Number(Number(endTime).toFixed(3)),
        audioFilePath: combinedAudioFilePath,
        notes: `Natural TTS (single stream), voice: ${typeof voice === 'object' ? voice?.name || 'default' : voice}`,
        customText: chunk.text,
        isCustomSegment: false
      });

      audioSegments.push({
        id: audioSync.id,
        pdfDocumentId: audioSync.pdf_document_id,
        conversionJobId: audioSync.conversion_job_id,
        pageNumber: audioSync.page_number,
        blockId: audioSync.block_id,
        startTime: audioSync.start_time,
        endTime: audioSync.end_time,
        audioFilePath: audioSync.audio_file_path,
        notes: audioSync.notes,
        customText: audioSync.custom_text,
        isCustomSegment: audioSync.is_custom_segment,
        text: chunk.text,
        audioUrl: `/api/audio-sync/${audioSync.id}/audio`
      });

      wordIndex += wordCount;
    }

    return audioSegments;
  }

  /** Max chars per request for gtts (library uses 100; we chunk at sentences to avoid mid-phrase splits). */
  static _gttsMaxChars() {
    return 100;
  }

  /**
   * Split text at sentence boundaries into chunks of at most maxChars to avoid gtts internal
   * 100-char splitting that causes staccato ("like ... a ... horse").
   */
  static _chunkTextAtSentences(text, maxChars = 100) {
    if (!text || text.length <= maxChars) return text ? [text] : [];
    const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length === 0) return [text];
    const chunks = [];
    let current = '';
    for (const sent of sentences) {
      const next = current ? current + ' ' + sent : sent;
      if (next.length <= maxChars) {
        current = next;
      } else {
        if (current) chunks.push(current);
        if (sent.length <= maxChars) {
          current = sent;
        } else {
          let rest = sent;
          while (rest.length > maxChars) {
            const part = rest.slice(0, maxChars);
            const lastSpace = part.lastIndexOf(' ');
            const cut = lastSpace > 0 ? lastSpace : maxChars;
            chunks.push(rest.slice(0, cut).trim());
            rest = rest.slice(cut).trim();
          }
          current = rest;
        }
      }
    }
    if (current) chunks.push(current);
    return chunks.filter(Boolean);
  }

  /**
   * Generate gtts audio for one section's text (sentence-boundary chunking if > 100 chars to avoid staccato).
   * Returns path to the section's single mp3 file.
   */
  static async _gttsGenerateSectionAudio(gtts, sectionText, sectionPath, jobId, pageNum) {
    const maxChars = this._gttsMaxChars();
    const dir = path.dirname(sectionPath);
    await fs.mkdir(dir, { recursive: true }).catch(() => {});

    const textParts = this._chunkTextAtSentences(sectionText, maxChars);
    if (textParts.length === 0) return null;
    if (textParts.length === 1 && textParts[0].length <= maxChars) {
      await new Promise((resolve, reject) => {
        const gttsInstance = new gtts(textParts[0], 'en');
        gttsInstance.save(sectionPath, (err) => (err ? reject(err) : resolve()));
      });
      return sectionPath;
    }
    const tempFiles = [];
    for (let i = 0; i < textParts.length; i++) {
      const tempPath = path.join(dir, `gtts_section_${jobId}_p${pageNum}_${i}.mp3`);
      tempFiles.push(tempPath);
      await new Promise((resolve, reject) => {
        const gttsInstance = new gtts(textParts[i], 'en');
        gttsInstance.save(tempPath, (err) => (err ? reject(err) : resolve()));
      });
    }
    const fluentFfmpeg = await import('fluent-ffmpeg');
    const ffmpeg = fluentFfmpeg.default;
    await this._configureFfmpegPath(ffmpeg);
    const concatListPath = path.join(dir, `gtts_section_concat_${jobId}_p${pageNum}.txt`);
    const concatListContent = tempFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(concatListPath, concatListContent, 'utf8');
    await new Promise((resolve, reject) => {
      ffmpeg(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(sectionPath)
        .on('end', () => resolve())
        .on('error', (e) => reject(e))
        .run();
    });
    await fs.unlink(concatListPath).catch(() => {});
    for (const f of tempFiles) await fs.unlink(f).catch(() => {});
    return sectionPath;
  }

  /**
   * gtts FXL-style: one section (page) at a time, then concat. Proportional timings per section so
   * text and audio stay in sync like FXL. Uses sentence-boundary chunking within each section to avoid staccato.
   */
  static async _generateNaturalCompleteAudioWithGttsPerSection(textChunks, voice, pdfId, jobId, combinedAudioFilePath) {
    let gtts;
    try {
      const gttsModule = await import('gtts');
      gtts = gttsModule.default || gttsModule.gtts;
    } catch (e) {
      console.warn('[Audio] gtts not available for per-section fallback:', e?.message);
      return null;
    }

    const dir = path.dirname(combinedAudioFilePath);
    const byPage = new Map();
    textChunks.forEach((c) => {
      const page = c.pageNumber ?? 1;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push(c);
    });
    const orderedPages = [...byPage.keys()].sort((a, b) => a - b);

    const sectionFiles = [];
    const sectionDurations = [];

    for (const pageNum of orderedPages) {
      const chunks = byPage.get(pageNum);
      const sectionText = this._fullTextFromChunks(chunks);
      if (!sectionText) continue;
      const sectionPath = path.join(dir, `gtts_section_${jobId}_p${pageNum}.mp3`);
      try {
        await this._gttsGenerateSectionAudio(gtts, sectionText, sectionPath, jobId, pageNum);
      } catch (err) {
        console.warn(`[Audio] gtts per-section failed for page ${pageNum}:`, err?.message);
        continue;
      }
      const { TtsService } = await import('./TtsService.js');
      const duration = TtsService.getMp3DurationSec(sectionPath) ?? 0;
      if (duration <= 0) {
        const words = sectionText.split(/\s+/).filter(Boolean).length;
        sectionDurations.push({ path: sectionPath, duration: Math.max(1, (words / 150) * 60), chunks });
      } else {
        sectionDurations.push({ path: sectionPath, duration, chunks });
      }
      sectionFiles.push(sectionPath);
    }

    if (sectionDurations.length === 0) return null;

    if (sectionFiles.length === 1) {
      await fs.copyFile(sectionFiles[0], combinedAudioFilePath).catch(() => {});
      await fs.unlink(sectionFiles[0]).catch(() => {});
    } else {
      const fluentFfmpeg = await import('fluent-ffmpeg');
      const ffmpeg = fluentFfmpeg.default;
      await this._configureFfmpegPath(ffmpeg);
      const concatListPath = path.join(dir, `gtts_concat_sections_${jobId}.txt`);
      const concatListContent = sectionFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      await fs.writeFile(concatListPath, concatListContent, 'utf8');
      await new Promise((resolve, reject) => {
        ffmpeg(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(combinedAudioFilePath)
          .on('end', () => resolve())
          .on('error', (e) => reject(e))
          .run();
      });
      await fs.unlink(concatListPath).catch(() => {});
      for (const f of sectionFiles) await fs.unlink(f).catch(() => {});
    }

    let sectionStartOffset = 0;
    const audioSegments = [];
    for (const { duration, chunks } of sectionDurations) {
      const totalWords = chunks.reduce((s, c) => s + this._wordCount(c.text), 0);
      let wordIndex = 0;
      for (const chunk of chunks) {
        const blockText = this._normalizeBlockText(chunk.text);
        if (!blockText) continue;
        const wordCount = this._wordCount(chunk.text);
        if (wordCount === 0) continue;
        const startTime = sectionStartOffset + (totalWords > 0 ? (wordIndex / totalWords) * duration : 0);
        const endTime = sectionStartOffset + (totalWords > 0 ? ((wordIndex + wordCount) / totalWords) * duration : duration);
        wordIndex += wordCount;

        const audioSync = await AudioSyncModel.create({
          pdfDocumentId: pdfId,
          conversionJobId: jobId,
          pageNumber: chunk.pageNumber ?? 1,
          blockId: chunk.id,
          startTime: Number(Number(startTime).toFixed(3)),
          endTime: Number(Number(endTime).toFixed(3)),
          audioFilePath: combinedAudioFilePath,
          notes: 'Natural TTS (gtts per-section, FXL-style)',
          customText: chunk.text,
          isCustomSegment: false
        });
        audioSegments.push({
          id: audioSync.id,
          pdfDocumentId: audioSync.pdf_document_id,
          conversionJobId: audioSync.conversion_job_id,
          pageNumber: audioSync.page_number,
          blockId: audioSync.block_id,
          startTime: audioSync.start_time,
          endTime: audioSync.end_time,
          audioFilePath: audioSync.audio_file_path,
          notes: audioSync.notes,
          customText: audioSync.custom_text,
          isCustomSegment: audioSync.is_custom_segment,
          text: chunk.text,
          audioUrl: `/api/audio-sync/${audioSync.id}/audio`
        });
      }
      sectionStartOffset += duration;
    }
    console.log(`[Audio] Path: gtts (per-section, FXL-style), ${sectionDurations.length} sections, ${audioSegments.length} blocks`);
    return audioSegments;
  }

  /**
   * One continuous gtts generation for full text, then assign block times by word proportion.
   * Chunks at sentence boundaries (max 100 chars) so gtts doesn't split mid-phrase → less staccato.
   */
  static async _generateNaturalCompleteAudioWithGtts(textChunks, voice, pdfId, jobId, combinedAudioFilePath) {
    const fullText = this._fullTextFromChunks(textChunks);
    if (!fullText) return null;

    let gtts;
    try {
      const gttsModule = await import('gtts');
      gtts = gttsModule.default || gttsModule.gtts;
    } catch (e) {
      console.warn('[Audio] gtts not available for natural fallback:', e?.message);
      return null;
    }

    await fs.mkdir(path.dirname(combinedAudioFilePath), { recursive: true }).catch(() => {});

    const maxChars = this._gttsMaxChars();
    const textParts = this._chunkTextAtSentences(fullText, maxChars);

    if (textParts.length === 0) return null;
    if (textParts.length === 1 && textParts[0].length <= maxChars) {
      return this._gttsSaveSingleAndMapTimings(gtts, textParts[0], textChunks, fullText, pdfId, jobId, combinedAudioFilePath);
    }

    const dir = path.dirname(combinedAudioFilePath);
    const tempFiles = [];
    for (let i = 0; i < textParts.length; i++) {
      const tempPath = path.join(dir, `gtts_part_${jobId}_${i}.mp3`);
      tempFiles.push(tempPath);
      await new Promise((resolve, reject) => {
        const gttsInstance = new gtts(textParts[i], 'en');
        gttsInstance.save(tempPath, (err) => (err ? reject(err) : resolve()));
      });
    }

    try {
      const fluentFfmpeg = await import('fluent-ffmpeg');
      const ffmpeg = fluentFfmpeg.default;
      await this._configureFfmpegPath(ffmpeg);
      const concatListPath = path.join(dir, `gtts_concat_${jobId}.txt`);
      const concatListContent = tempFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      await fs.writeFile(concatListPath, concatListContent, 'utf8');
      await new Promise((resolve, reject) => {
        ffmpeg(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(combinedAudioFilePath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });
      await fs.unlink(concatListPath).catch(() => {});
    } finally {
      for (const f of tempFiles) await fs.unlink(f).catch(() => {});
    }

    return this._gttsMapTimingsToChunks(textChunks, fullText, combinedAudioFilePath, pdfId, jobId);
  }

  static async _gttsSaveSingleAndMapTimings(gtts, singleText, textChunks, fullText, pdfId, jobId, combinedAudioFilePath) {
    return new Promise((resolve, reject) => {
      const gttsInstance = new gtts(singleText, 'en');
      gttsInstance.save(combinedAudioFilePath, async (err) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          const segments = await this._gttsMapTimingsToChunks(textChunks, fullText, combinedAudioFilePath, pdfId, jobId);
          resolve(segments);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  static async _gttsMapTimingsToChunks(textChunks, fullText, combinedAudioFilePath, pdfId, jobId) {
    const { TtsService } = await import('./TtsService.js');
    let durationSec = TtsService.getMp3DurationSec(combinedAudioFilePath);
    if (durationSec == null || durationSec <= 0) {
      const wordCount = this._wordCount(fullText) || (fullText.split(/\s+/).filter(Boolean).length);
      durationSec = Math.max(1, (wordCount / 150) * 60);
    }
    const totalWords = fullText.split(/\s+/).filter(Boolean).length;
    let currentTime = 0;
    const audioSegments = [];
    for (const chunk of textChunks) {
      const blockText = this._normalizeBlockText(chunk.text);
      if (!blockText) continue;
      const wordCount = this._wordCount(chunk.text);
      if (wordCount === 0) continue;
      const chunkDuration = totalWords > 0 ? (durationSec * wordCount) / totalWords : durationSec / textChunks.length;
      const startTime = Number(currentTime.toFixed(3));
      const endTime = Number((currentTime + chunkDuration).toFixed(3));
      currentTime += chunkDuration;
      const audioSync = await AudioSyncModel.create({
        pdfDocumentId: pdfId,
        conversionJobId: jobId,
        pageNumber: chunk.pageNumber ?? 1,
        blockId: chunk.id,
        startTime,
        endTime,
        audioFilePath: combinedAudioFilePath,
        notes: 'Natural TTS (gtts single stream)',
        customText: chunk.text,
        isCustomSegment: false
      });
      audioSegments.push({
        id: audioSync.id,
        pdfDocumentId: audioSync.pdf_document_id,
        conversionJobId: audioSync.conversion_job_id,
        pageNumber: audioSync.page_number,
        blockId: audioSync.block_id,
        startTime: audioSync.start_time,
        endTime: audioSync.end_time,
        audioFilePath: audioSync.audio_file_path,
        notes: audioSync.notes,
        customText: audioSync.custom_text,
        isCustomSegment: audioSync.is_custom_segment,
        text: chunk.text,
        audioUrl: `/api/audio-sync/${audioSync.id}/audio`
      });
    }
    console.log(`[Audio] Natural gtts: one continuous stream, ${audioSegments.length} blocks`);
    return audioSegments;
  }

  // Generate complete audio for all text chunks
  static async generateCompleteAudio(textChunks, voice, pdfId, jobId, options = {}) {
    // Replace existing syncs for this job so "Generate TTS" doesn't append duplicates (same block_id twice)
    // Skip deletion when generating per-section audio so other sections' syncs are preserved
    if (!options.skipDeleteSyncs) {
      await AudioSyncModel.deleteByJobId(jobId);
    }

    const { getTtsOutputDir } = await import('../config/fileStorage.js');
    // Allow caller to specify a custom output path (e.g. per-section TTS)
    const combinedAudioFileName = `combined_audio_${jobId}.mp3`;
    const combinedAudioFilePath = options.outputPath || path.join(getTtsOutputDir(), combinedAudioFileName);
    await fs.mkdir(path.dirname(combinedAudioFilePath), { recursive: true }).catch(() => {});

    // Deduplicate by id (preserve order) so we don't speak the same block twice or create duplicate sync rows
    const seenIds = new Set();
    textChunks = textChunks.filter((c) => {
      const key = (c.id || '').trim();
      if (!key || seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });

    const fullTextFromChunks = this._fullTextFromChunks(textChunks);
    const looksLikeWordLevel = textChunks.length > 10 && textChunks.every(c => ((c.text || '').trim().split(/\s+/).length <= 2));
    const preserveInputOrder = options.preserveInputOrder === true;

    // 1) When Google Cloud TTS is available: use per-section (FXL-style) so text and audio are in sync like FXL
    const { TtsService } = await import('./TtsService.js');
    const client = TtsService.getClient();
    if (client && typeof client === 'object' && textChunks.length > 0) {
      if (!preserveInputOrder) {
        const perSectionSegments = await this._generateNaturalCompleteAudioPerSection(
          textChunks, voice, pdfId, jobId, combinedAudioFilePath, options
        );
        if (perSectionSegments && perSectionSegments.length > 0) {
          return perSectionSegments;
        }
      } else {
        console.log('[Audio] preserveInputOrder=true: skipping Google per-section regrouping');
      }
      const naturalSegments = await this._generateNaturalCompleteAudio(
        textChunks, voice, pdfId, jobId, combinedAudioFilePath, options
      );
      if (naturalSegments && naturalSegments.length > 0) {
        console.log(`[Audio] Path: Google Cloud TTS (one continuous stream), ${naturalSegments.length} blocks`);
        return naturalSegments;
      }
    } else if (textChunks.length > 0) {
      console.log(`[Audio] Google Cloud TTS not available (client=${typeof client}), trying gtts per-section (FXL-style) next`);
    }

    // 2) gtts per-section (FXL-style): one section at a time, then concat — text and audio in sync like FXL
    if (!preserveInputOrder) {
      try {
        const gttsPerSectionSegments = await this._generateNaturalCompleteAudioWithGttsPerSection(
          textChunks, voice, pdfId, jobId, combinedAudioFilePath
        );
        if (gttsPerSectionSegments && gttsPerSectionSegments.length > 0) {
          return gttsPerSectionSegments;
        }
      } catch (e) {
        console.warn('[Audio] gtts per-section failed, trying single stream:', e?.message);
      }
    } else {
      console.log('[Audio] preserveInputOrder=true: skipping gtts per-section regrouping');
    }

    // 3) One continuous gtts for full text (fallback)
    try {
      const gttsSegments = await this._generateNaturalCompleteAudioWithGtts(
        textChunks, voice, pdfId, jobId, combinedAudioFilePath
      );
      if (gttsSegments && gttsSegments.length > 0) {
        console.log(`[Audio] Path: gtts (one continuous stream), ${gttsSegments.length} blocks`);
        return gttsSegments;
      }
    } catch (e) {
      console.warn('[Audio] Natural gtts path failed:', e?.message);
    }

    // 4) Fallback: per-chunk generation then concatenate — CAN CAUSE STACCATO if chunks are word-level
    if (looksLikeWordLevel) {
      console.warn(`[Audio] STACCATO RISK: Using per-chunk fallback with ${textChunks.length} short chunks (word-level?). Install gtts (npm install gtts) or set GOOGLE_APPLICATION_CREDENTIALS for natural speech.`);
    }
    const audioSegments = [];
    let currentTime = 0;
    const individualAudioFiles = [];
    const ttsOptions = { speakingRate: options.speakingRate };

    for (const chunk of textChunks) {
      try {
        const audio = await this.generateAudioForText(chunk.text, voice, pdfId, chunk.id, ttsOptions);
        individualAudioFiles.push(audio.audioFilePath);

        const audioSync = await AudioSyncModel.create({
          pdfDocumentId: pdfId,
          conversionJobId: jobId,
          pageNumber: chunk.pageNumber,
          blockId: chunk.id,
          startTime: currentTime,
          endTime: currentTime + audio.duration,
          audioFilePath: combinedAudioFilePath,
          notes: `Generated with voice: ${voice}`,
          customText: chunk.text,
          isCustomSegment: false
        });

        audioSegments.push({
          id: audioSync.id,
          pdfDocumentId: audioSync.pdf_document_id,
          conversionJobId: audioSync.conversion_job_id,
          pageNumber: audioSync.page_number,
          blockId: audioSync.block_id,
          startTime: audioSync.start_time,
          endTime: audioSync.end_time,
          audioFilePath: audioSync.audio_file_path,
          notes: audioSync.notes,
          customText: audioSync.custom_text,
          isCustomSegment: audioSync.is_custom_segment,
          text: chunk.text,
          audioUrl: `/api/audio-sync/${audioSync.id}/audio`
        });

        currentTime += audio.duration;
      } catch (error) {
        console.error(`Error generating audio for chunk ${chunk.id}:`, error);
      }
    }

    // Concatenate all individual audio files into one combined file
    if (individualAudioFiles.length > 0) {
      try {
        const fluentFfmpeg = await import('fluent-ffmpeg');
        const ffmpeg = fluentFfmpeg.default;
        await this._configureFfmpegPath(ffmpeg);

        const concatListPath = path.join(path.dirname(combinedAudioFilePath), `concat_list_${jobId}.txt`);
        const concatListContent = individualAudioFiles
          .map(filePath => `file '${filePath.replace(/'/g, "'\\''")}'`)
          .join('\n');
        await fs.writeFile(concatListPath, concatListContent, 'utf8');

        await new Promise((resolve, reject) => {
          ffmpeg(concatListPath)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .outputOptions(['-c', 'copy'])
            .output(combinedAudioFilePath)
            .on('end', async () => {
              await fs.unlink(concatListPath).catch(() => {});
              resolve();
            })
            .on('error', async (err) => {
              console.error(`[Audio] FFmpeg concatenation error:`, err);
              if (individualAudioFiles.length > 0) {
                try {
                  await fs.copyFile(individualAudioFiles[0], combinedAudioFilePath);
                  await fs.unlink(concatListPath).catch(() => {});
                } catch (e) { await fs.unlink(concatListPath).catch(() => {}); }
                resolve();
              } else reject(err);
            })
            .run();
        });
      } catch (error) {
        console.error(`[Audio] Error creating combined audio file:`, error);
        if (individualAudioFiles.length > 0) {
          try { await fs.copyFile(individualAudioFiles[0], combinedAudioFilePath); } catch (_) {}
        }
      }
    }

    return audioSegments;
  }

  // Get available voices
  static getAvailableVoices() {
    return [
      { id: 'standard', name: 'Standard Voice', type: 'adult' },
      { id: 'child', name: 'Child Voice', type: 'child' },
      { id: 'female', name: 'Female Voice', type: 'adult' },
      { id: 'male', name: 'Male Voice', type: 'adult' },
      { id: 'neural', name: 'Neural Voice', type: 'adult' }
    ];
  }
}

