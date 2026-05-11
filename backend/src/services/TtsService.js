import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { createRequire } from 'module';
import { ffprobeBin, getAugmentedEnv } from '../utils/ffmpegPath.js';

const require = createRequire(import.meta.url);
let gTTS = null;
try {
  gTTS = require('gtts');
} catch (e) {
  console.warn('[TTS] gtts package not available. Install with: npm install gtts');
}

export class TtsService {
  static _client = null;
  static _useFreeTts = false;

  static getClient() {
    if (!this._client) {
      // Check if TTS is explicitly disabled
      const ttsEnabled = (process.env.TTS_ENABLED || 'true').toLowerCase() === 'true';
      if (!ttsEnabled) {
        console.log('[TTS] TTS is disabled via TTS_ENABLED=false. TTS features will be skipped.');
        return null;
      }

      // Check if we should force free gTTS (the user's request)
      const forceFreeTts = (process.env.FORCE_FREE_TTS || 'true').toLowerCase() === 'true';
      if (forceFreeTts) {
        console.log('[TTS] Using free gTTS (Google Translate TTS) as requested.');
        this._useFreeTts = true;
        return 'free-tts';
      }

      // Google Cloud TTS requires service account credentials
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                               process.env.GCP_SERVICE_ACCOUNT_PATH ||
                               process.env.GCP_CREDENTIALS_PATH;
      
      if (!credentialsPath) {
        // No credentials provided - use free gTTS as fallback
        console.log('[TTS] No Google Cloud credentials found. Using free gTTS as fallback.');
        this._useFreeTts = true;
        return 'free-tts';
      }
      
      let clientOptions = {};
      
      try {
        // Verify file exists
        const fs = require('fs');
        if (!fs.existsSync(credentialsPath)) {
          console.warn(`[TTS] Credentials file not found at: ${credentialsPath}`);
          console.log('[TTS] TTS features will be disabled. You can upload human audio files instead.');
          return null;
        }
        
        clientOptions.keyFilename = credentialsPath;
        console.log(`[TTS] Using GCP credentials from: ${credentialsPath}`);
      } catch (error) {
        console.warn(`[TTS] Could not verify credentials file: ${error.message}`);
        console.log('[TTS] TTS features will be disabled. You can upload human audio files instead.');
        return null;
      }
      
      try {
        this._client = new TextToSpeechClient(clientOptions);
        console.log('[TTS] Text-to-Speech client initialized successfully');
      } catch (error) {
        console.error('[TTS] Failed to initialize Text-to-Speech client:', error.message);
        console.log('[TTS] TTS features will be disabled. You can upload human audio files instead.');
        return null;
      }
    }
    return this._client;
  }

  /**
   * Scale timings so the last endTimeSec equals target duration.
   * @param {number} [targetFactor=1] - Multiply ffprobe duration by this (0.9 = 90%, avoids over-expansion that causes highlight lag)
   */
  static scaleTimingsToAudioDuration(timings, audioFilePath, targetFactor = 1) {
    if (!timings || timings.length === 0) return timings;
    const actualDurationSec = this.getMp3DurationSec(audioFilePath);
    if (actualDurationSec == null || actualDurationSec <= 0) return timings;
    const targetSec = actualDurationSec * (Number(targetFactor) || 1);
    const lastEnd = timings[timings.length - 1].endTimeSec;
    const diff = Math.abs(lastEnd - targetSec);
    if (diff < 0.001) return timings;
    const scale = targetSec / lastEnd;
    return timings.map(t => ({
      ...t,
      startTimeSec: parseFloat((t.startTimeSec * scale).toFixed(3)),
      endTimeSec: parseFloat((t.endTimeSec * scale).toFixed(3))
    }));
  }

  /**
   * Estimate word timings by distributing the full audio duration evenly across words.
   * No artificial pauses — highlights span the full clip so they stay in sync with playback.
   */
  static estimateWordTimings(text, audioDurationSec) {
    const words = text.split(/\s+/).filter(w => w.trim().length > 0);
    if (words.length === 0) return [];
    const totalSec = Math.max(0.01, audioDurationSec);
    const timePerWord = totalSec / words.length;
    const timings = [];
    let currentTime = 0;
    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/[^\w]/g, '');
      const endTime = Math.min(currentTime + timePerWord, totalSec);
      timings.push({
        word,
        startTimeSec: parseFloat(currentTime.toFixed(3)),
        endTimeSec: parseFloat(endTime.toFixed(3))
      });
      currentTime = endTime;
    }
    return timings;
  }

  /**
   * Synthesize page audio with word-level timepoints.
   * @param {object} params
   * @param {string} params.text - Plain text to synthesize.
   * @param {string} params.audioOutPath - Path to write the mp3 file.
   * @param {object} [params.voice] - Optional voice config { languageCode, name, ssmlGender }.
   * @param {number} [params.speakingRate] - Speaking speed (0.25–2.0). 1.0 = normal; 1.25 = 25% faster.
   * @returns {Promise<{ audioFilePath: string, timings: Array<{ word: string, startTimeSec: number, endTimeSec: number }>, audioBuffer: Buffer }>}
   */
  static async synthesizePageAudio({ text, audioOutPath, voice = {}, durationScaleFactor, speakingRate }) {
    if (!text || !text.trim()) {
      return { audioFilePath: null, timings: [], audioBuffer: null };
    }

    const client = this.getClient();
    
    // Use free gTTS if no Google Cloud credentials
    if (this._useFreeTts || client === 'free-tts') {
      if (voice?.name) {
        console.log('[TTS] Voice selection ignored: using free gTTS (no Google Cloud). Configure Google Cloud TTS for voice choice.');
      }
      return await this.synthesizeWithFreeTts({ text, audioOutPath, voice });
    }
    
    if (!client) {
      console.warn('[TTS] Text-to-Speech client not available, skipping audio synthesis');
      return { audioFilePath: null, timings: [], audioBuffer: null };
    }

    const input = { text };
    const voiceConfig = {
      languageCode: voice.languageCode || 'en-US',
      name: voice.name || undefined,
      ssmlGender: voice.ssmlGender || 'NEUTRAL'
    };
    if (voiceConfig.name) {
      console.log(`[TTS] Using Google Cloud voice: ${voiceConfig.name} (${voiceConfig.ssmlGender})`);
    }
    // speakingRate: 0.25–2.0 (Google Cloud). Default 1.0; e.g. 1.25 = 25% faster.
    const rate = speakingRate != null && Number.isFinite(speakingRate)
      ? Math.max(0.25, Math.min(2, Number(speakingRate)))
      : 1.0;
    if (rate !== 1.0) {
      console.log(`[TTS] Speaking rate: ${rate}x`);
    }
    const audioConfig = {
      audioEncoding: 'MP3',
      enableTimePointing: ['WORD'],
      ...(rate !== 1.0 && { speakingRate: rate })
    };

    try {
      const [response] = await client.synthesizeSpeech({
        input,
        voice: voiceConfig,
        audioConfig
      });

      const audioBuffer = response.audioContent
        ? Buffer.from(response.audioContent, 'base64')
        : Buffer.alloc(0);

      // Write to disk if requested
      if (audioOutPath && audioBuffer.length > 0) {
        await fs.mkdir(path.dirname(audioOutPath), { recursive: true }).catch(() => {});
        await fs.writeFile(audioOutPath, audioBuffer);
      }

      const raw = (response.timepoints || []).map(tp => ({
        word: tp.markName || '',
        startTimeSec: parseFloat((tp.timeSeconds || tp.time || 0).toFixed(3)),
        endTimeSec: parseFloat((tp.timeSeconds || tp.time || 0).toFixed(3))
      }));
      // Google returns one timestamp per word (start only). Set end = next start, or start+0.35 for last word.
      let timings = raw.map((t, i) => ({
        ...t,
        endTimeSec: i < raw.length - 1
          ? raw[i + 1].startTimeSec
          : parseFloat((t.startTimeSec + 0.35).toFixed(3))
      }));
      // Scale timings to target duration. durationScaleFactor 0.9 = anchor to 90% of ffprobe (fixes reader lag)
      if (audioOutPath && timings.length > 0) {
        const factor = durationScaleFactor ?? parseFloat(process.env.TTS_DURATION_SCALE_FACTOR || '0.92', 10);
        timings = this.scaleTimingsToAudioDuration(timings, audioOutPath, Number.isFinite(factor) ? factor : 1);
      }

      return {
        audioFilePath: audioOutPath || '',
        timings,
        audioBuffer
      };
    } catch (error) {
      console.error('[TTS] Error synthesizing speech:', error.message);
      if (error.code === 7) {
        console.error('[TTS] Permission denied - check service account has Cloud Text-to-Speech API enabled');
      } else if (error.code === 16) {
        console.error('[TTS] Unauthenticated - check credentials are valid');
      }
      return { audioFilePath: null, timings: [], audioBuffer: null };
    }
  }

  /**
   * Get real audio duration in seconds from an MP3 file using ffprobe.
   * Falls back to word-count estimate if ffprobe fails.
   */
  static getMp3DurationSec(filePath) {
    try {
      const out = execSync(
        `"${ffprobeBin}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: 'utf8', env: getAugmentedEnv() }
      );
      const sec = parseFloat(out.trim());
      return Number.isFinite(sec) && sec > 0 ? sec : null;
    } catch {
      return null;
    }
  }

  /**
   * Synthesize audio using free gTTS (no credentials required).
   * Word-level timings are estimated from the actual MP3 duration so highlights stay in sync.
   * For accurate word-level sync, use Google Cloud Text-to-Speech (enableTimePointing: ['WORD']).
   */
  static async synthesizeWithFreeTts({ text, audioOutPath, voice = {} }) {
    try {
      const languageCode = voice.languageCode || 'en';
      const lang = languageCode.split('-')[0];
      console.log(`[TTS] Using free gTTS (language: ${lang}). Word timings are estimated; for precise sync use Google Cloud TTS.`);

      if (audioOutPath) {
        await fs.mkdir(path.dirname(audioOutPath), { recursive: true }).catch(() => {});
      }

      return new Promise((resolve, reject) => {
        const gtts = new gTTS(text, lang);
        const tempPath = audioOutPath || path.join(process.cwd(), 'temp_tts.mp3');

        gtts.save(tempPath, async (err) => {
          if (err) {
            console.error('[TTS] gTTS error:', err);
            reject(err);
            return;
          }
          try {
            const audioBuffer = await fs.readFile(tempPath);
            let durationSec = this.getMp3DurationSec(tempPath);
            if (durationSec == null) {
              const words = text.split(/\s+/).filter(w => w.trim().length > 0);
              durationSec = (words.length / 150) * 60;
              console.log(`[TTS] Could not read MP3 duration; using estimate: ${durationSec.toFixed(2)}s`);
            }
            let timings = this.estimateWordTimings(text, durationSec);
            const filePath = audioOutPath || tempPath;
            const factor = parseFloat(process.env.TTS_DURATION_SCALE_FACTOR || '0.92', 10);
            timings = this.scaleTimingsToAudioDuration(timings, filePath, Number.isFinite(factor) ? factor : 1);
            console.log(`[TTS] gTTS audio: ${(audioBuffer.length / 1024).toFixed(2)} KB, duration: ${durationSec.toFixed(2)}s, ${timings.length} words`);
            resolve({
              audioFilePath: filePath,
              timings,
              audioBuffer
            });
          } catch (readError) {
            console.error('[TTS] Error reading generated audio:', readError);
            reject(readError);
          }
        });
      });
    } catch (error) {
      console.error('[TTS] Error with free gTTS:', error.message);
      return { audioFilePath: null, timings: [], audioBuffer: null };
    }
  }
}

