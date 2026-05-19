import pool from '../src/config/database.js';

await pool.execute(
  `INSERT IGNORE INTO features (feature_key, description) VALUES
    ('tts_management', 'TTS management'),
    ('ai_config', 'AI configuration')`
);
await pool.execute(
  `INSERT IGNORE INTO plan_features (plan_id, feature_key, limits_json)
   SELECT p.id, f.feature_key, NULL FROM plans p CROSS JOIN features f`
);
const [r] = await pool.execute('SELECT feature_key FROM features ORDER BY feature_key');
console.log('features:', r.map((x) => x.feature_key));
await pool.end();
