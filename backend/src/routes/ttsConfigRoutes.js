import express from 'express';
import { TtsConfigService } from '../services/ttsConfigService.js';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';
import { authenticate, requireFeature, requireRole } from '../middlewares/auth.js';
import { ROLES } from '../constants/roles.js';

const router = express.Router();

/** Platform super-admin only — save/test TTS configuration. */
const platformTtsAdmin = [
  authenticate,
  requireRole(ROLES.PLATFORM_ADMIN),
  requireFeature('tts_management'),
];

// GET /api/tts/config/current - read active config (studios / pipelines)
router.get('/config/current', authenticate, async (req, res) => {
  try {
    const config = await TtsConfigService.getCurrentConfiguration();
    return successResponse(res, config || null);
  } catch (error) {
    console.error('[TTS Config] Error getting current configuration:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/tts/status
router.get('/status', authenticate, async (req, res) => {
  try {
    const status = await TtsConfigService.getStatus();
    return successResponse(res, status);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/tts/languages
router.get('/languages', authenticate, async (req, res) => {
  try {
    const languages = TtsConfigService.getAvailableLanguages();
    return successResponse(res, languages);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/tts/voices
router.get('/voices', authenticate, async (req, res) => {
  try {
    const { languageCode } = req.query;
    const voices = TtsConfigService.getAvailableVoices(languageCode || 'en-US');
    return successResponse(res, voices);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/tts/audio-encodings
router.get('/audio-encodings', authenticate, async (req, res) => {
  try {
    const encodings = TtsConfigService.getAvailableAudioEncodings();
    return successResponse(res, encodings);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/tts/config - Save TTS configuration
router.post('/config', ...platformTtsAdmin, async (req, res) => {
  try {
    const config = await TtsConfigService.saveConfiguration(req.body);
    return successResponse(res, config);
  } catch (error) {
    if (error.message.includes('required') || error.message.includes('must be') || error.message.includes('not found')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/tts/test - Test TTS configuration
router.post('/test', ...platformTtsAdmin, async (req, res) => {
  try {
    const { credentialsPath, languageCode, voiceName, ssmlGender } = req.body;

    try {
      const { TtsService } = await import('../services/TtsService.js');

      if (credentialsPath && credentialsPath.trim().length > 0 && !credentialsPath.includes('****')) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath.trim();
        TtsService._client = null;
      }

      const client = TtsService.getClient();

      if (!client || client === 'free-tts') {
        return successResponse(res, {
          message: 'TTS test successful (using free gTTS)',
          details: {
            status: 'free-tts',
            message: 'Free gTTS is available. No credentials required.',
            timestamp: new Date().toISOString(),
          },
          summary: 'Free TTS is available and ready to use.',
        });
      }

      const testText = 'This is a test of the text to speech system.';
      const testResult = await TtsService.synthesizePageAudio({
        text: testText,
        voice: {
          languageCode: languageCode || 'en-US',
          name: voiceName || undefined,
          ssmlGender: ssmlGender || 'NEUTRAL',
        },
      });

      if (testResult.audioBuffer && testResult.audioBuffer.length > 0) {
        return successResponse(res, {
          message: 'TTS test successful',
          details: {
            status: 'connected',
            languageCode: languageCode || 'en-US',
            voiceName: voiceName || 'default',
            ssmlGender: ssmlGender || 'NEUTRAL',
            audioSize: `${(testResult.audioBuffer.length / 1024).toFixed(2)} KB`,
            timestamp: new Date().toISOString(),
          },
          summary: 'Successfully generated test audio. TTS is working correctly.',
        });
      }
      return badRequestResponse(res, 'TTS test failed: Could not generate audio');
    } catch (ttsError) {
      const errorMessage = ttsError.message || 'Unknown error';
      let userFriendlyMessage = 'TTS test failed. ';

      if (errorMessage.includes('Permission denied') || errorMessage.includes('403')) {
        userFriendlyMessage += 'Permission denied. Check that your service account has Cloud Text-to-Speech API enabled.';
      } else if (errorMessage.includes('Unauthenticated') || errorMessage.includes('401')) {
        userFriendlyMessage += 'Authentication failed. Please check your credentials file.';
      } else if (errorMessage.includes('not found')) {
        userFriendlyMessage += 'Credentials file not found. Please check the path.';
      } else {
        userFriendlyMessage += errorMessage;
      }

      return badRequestResponse(res, userFriendlyMessage);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/tts/detect-pages
router.post('/detect-pages', ...platformTtsAdmin, async (req, res) => {
  try {
    const { pages, exclusionPrompt, jobId } = req.body;

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return badRequestResponse(res, 'Pages array is required and must not be empty');
    }

    if (!exclusionPrompt || !exclusionPrompt.trim()) {
      return badRequestResponse(res, 'Exclusion prompt is required');
    }

    let pagesToAnalyze = pages;
    if (jobId) {
      try {
        const { getJobOutputBase, getHtmlIntermediateDir } = await import('../config/fileStorage.js');
        const fs = await import('fs/promises');
        const path = await import('path');

        const jobOutputBase = getJobOutputBase();
        const jobDir = path.join(jobOutputBase, `job_${jobId}`);
        const textDataPath = path.join(jobDir, `text_data_${jobId}.json`);

        let textData = null;
        try {
          const textDataContent = await fs.readFile(textDataPath, 'utf8');
          textData = JSON.parse(textDataContent);
        } catch (error) {
          const htmlIntermediateDir = getHtmlIntermediateDir();
          const altTextDataPath = path.join(htmlIntermediateDir, `job_${jobId}`, `text_data_${jobId}.json`);
          const textDataContent = await fs.readFile(altTextDataPath, 'utf8');
          textData = JSON.parse(textDataContent);
        }

        if (textData && textData.pages) {
          pagesToAnalyze = textData.pages;
        }
      } catch (loadError) {
        console.warn('[TTS] Could not load pages from job, using provided pages:', loadError.message);
      }
    }

    const result = await TtsConfigService.detectExcludedPages(pagesToAnalyze, exclusionPrompt);

    return successResponse(res, {
      excludedPages: result.excludedPages,
      reasoning: result.reasoning,
      exclusionList: result.excludedPages.length > 0 ? result.excludedPages.join(', ') : '',
      message: `Detected ${result.excludedPages.length} page(s) to exclude`,
    });
  } catch (error) {
    if (error.message.includes('AI configuration not available')) {
      return errorResponse(res, error.message, 400);
    }
    return errorResponse(res, error.message, 500);
  }
});

export default router;
