import { PlatformApiKeyModel } from '../models/PlatformApiKey.js';

export async function ensurePlatformApiKeys() {
  try {
    await PlatformApiKeyModel.ensureSchema();
    console.log('[bootstrap] platform_api_keys schema OK');
  } catch (e) {
    console.warn('[bootstrap] ensurePlatformApiKeys failed:', e.message);
  }
}
