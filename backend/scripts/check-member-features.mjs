import pool from '../src/config/database.js';
import { EntitlementService } from '../src/services/entitlementService.js';

const [users] = await pool.execute(
  "SELECT id, email, role, organization_id FROM users WHERE email = 'prakash123@gmail.com' LIMIT 1"
);
const u = users[0];
const planKeys = await EntitlementService.fetchPlanFeatureKeys(u.organization_id);
const features = await EntitlementService.getFeatureKeysForUser(u);
console.log('plan keys:', planKeys);
console.log('resolved count:', features.length);
console.log('tts_management:', features.includes('tts_management'));
console.log('ai_config:', features.includes('ai_config'));
await pool.end();
