import express from 'express';
import { AiConfigService } from '../services/aiConfigService.js';
import { normalizeGeminiModelName } from '../services/geminiService.js';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';
import multer from 'multer';
import { authenticate, requireFeature, requireRole } from '../middlewares/auth.js';
import { ROLES } from '../constants/roles.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/** Platform super-admin only — manage AI configuration UI. */
const platformAiAdmin = [
  authenticate,
  requireRole(ROLES.PLATFORM_ADMIN),
  requireFeature('ai_config'),
];

// GET /ai/config/current
router.get('/config/current', ...platformAiAdmin, async (req, res) => {
  try {
    const config = await AiConfigService.getCurrentConfiguration();
    return successResponse(res, config ?? null);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/** Read-only active model for job cards / dashboards (any signed-in user; no API key). */
router.get('/config/active-model', authenticate, async (req, res) => {
  try {
    const status = await AiConfigService.getStatus();
    return successResponse(res, {
      modelName: status.model ?? null,
      enabled: status.enabled,
      configured: status.configured,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/ai/config
router.post('/config', ...platformAiAdmin, async (req, res) => {
  try {
    const config = await AiConfigService.saveConfiguration(req.body);
    return successResponse(res, config);
  } catch (error) {
    if (error.message.includes('required') || error.message.includes('must be')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/ai/status
router.get('/status', ...platformAiAdmin, async (req, res) => {
  try {
    const status = await AiConfigService.getStatus();
    return successResponse(res, status);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/ai/models
router.get('/models', ...platformAiAdmin, async (req, res) => {
  try {
    const models = AiConfigService.getAvailableModels();
    return successResponse(res, models);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/ai/test
router.post('/test', ...platformAiAdmin, async (req, res) => {
  try {
    const { apiKey, modelName } = req.body;

    if (!apiKey || apiKey.trim().length < 20) {
      return badRequestResponse(res, 'Invalid API key format. API key must be at least 20 characters.');
    }

    if (apiKey.includes('****')) {
      return badRequestResponse(res, 'Invalid API key format. Please enter a valid API key.');
    }

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey.trim());
      const testModelName = normalizeGeminiModelName(modelName || '');
      const model = genAI.getGenerativeModel({ model: testModelName });

      const startTime = Date.now();
      const result = await model.generateContent('Test');
      const response = await result.response;
      const responseTime = Date.now() - startTime;
      const responseText = await response.text();

      const maskedApiKey = apiKey.length > 8
        ? apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4)
        : '****';

      return successResponse(res, {
        message: 'Connection test successful!',
        details: {
          status: 'connected',
          model: testModelName,
          apiKey: maskedApiKey,
          responseTime: `${responseTime}ms`,
          responseReceived: responseText ? 'Yes' : 'No',
          timestamp: new Date().toISOString(),
        },
        summary: `Successfully connected to ${testModelName} model. API key is valid and working. Response time: ${responseTime}ms.`,
      });
    } catch (apiError) {
      const errorMessage = apiError.message || 'Unknown error';
      let userFriendlyMessage = 'Connection test failed. ';

      if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('401')) {
        userFriendlyMessage += 'Invalid API key. Please check your API key.';
      } else if (errorMessage.includes('MODEL_NOT_FOUND') || errorMessage.includes('404')) {
        userFriendlyMessage += `Model "${modelName || 'gemini-2.5-flash'}" not found. Please check the model name.`;
      } else if (errorMessage.includes('QUOTA') || errorMessage.includes('429')) {
        userFriendlyMessage += 'API quota exceeded. Please check your API usage limits.';
      } else {
        userFriendlyMessage += errorMessage;
      }

      return badRequestResponse(res, userFriendlyMessage);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/ai/describe-image — workflow feature (any authenticated user)
router.post('/describe-image', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return badRequestResponse(res, 'Image file is required');
    }

    const imageBuffer = req.file.buffer;
    const imageMimeType = req.file.mimetype || 'image/png';

    const config = await AiConfigService.getActiveConfiguration();
    if (!config || !config.apiKey) {
      return errorResponse(res, 'AI service is not configured. Please configure AI settings first.', 400);
    }

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(config.apiKey);
      const modelName = normalizeGeminiModelName(config.modelName || '');
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `Describe this image in detail. Include:
1. What objects, people, or scenes are visible
2. Colors, composition, and visual style
3. Any text that appears in the image
4. The overall context or purpose of the image

Provide a clear, concise description that would be useful for accessibility and understanding the image content.`;

      const result = await model.generateContent([
        { text: prompt },
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: imageMimeType,
          },
        },
      ]);

      const response = await result.response;
      const description = await response.text();

      return successResponse(res, {
        description: description.trim(),
        model: modelName,
        timestamp: new Date().toISOString(),
      });
    } catch (apiError) {
      console.error('Error describing image with Gemini:', apiError);
      const errorMessage = apiError.message || 'Unknown error';

      if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('401')) {
        return errorResponse(res, 'Invalid API key. Please check your AI configuration.', 401);
      }
      if (errorMessage.includes('QUOTA') || errorMessage.includes('429')) {
        return errorResponse(res, 'API quota exceeded. Please try again later.', 429);
      }
      return errorResponse(res, `Failed to describe image: ${errorMessage}`, 500);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

export default router;
