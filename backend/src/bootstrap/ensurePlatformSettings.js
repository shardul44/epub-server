import { PlatformSettingsModel } from '../models/PlatformSettings.js';

/**
 * Ensures the platform_settings table and default row exist.
 * Runs once at server startup (see server.js).
 */
export async function ensurePlatformSettings() {
  try {
    await PlatformSettingsModel.ensureSchema();
    console.log('[bootstrap] platform_settings schema OK');
  } catch (e) {
    console.warn('[bootstrap] ensurePlatformSettings failed:', e.message);
  }
}
