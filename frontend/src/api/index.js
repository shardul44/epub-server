/**
 * Centralized API barrel — import all service modules from here.
 *
 * Usage:
 *   import { pdfApi, conversionApi, audioSyncApi } from '../api';
 *
 * All underlying HTTP calls still go through the single axios instance
 * in services/api.js (auth headers, error handling, base URL).
 */

export { pdfService as pdfApi } from '../services/pdfService';
export { conversionService as conversionApi } from '../services/conversionService';
export { audioSyncService as audioSyncApi } from '../services/audioSyncService';
export { kitabooService as kitabooApi } from '../services/kitabooService';
export { adminService as adminApi } from '../services/adminService';
export { orgTeamService as orgTeamApi } from '../services/orgTeamService';
export { interactiveService as interactiveApi } from '../services/interactiveService';
export { ttsConfigService as ttsApi } from '../services/ttsConfigService';
export { aiConfigService as aiConfigApi } from '../services/aiConfigService';
export { userService as userApi } from '../services/userService';

// Re-export the raw axios instance for one-off calls
export { default as apiClient } from '../services/api';
