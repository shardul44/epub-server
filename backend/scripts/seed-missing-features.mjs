import pool from '../src/config/database.js';

await pool.execute(
  `INSERT IGNORE INTO features (feature_key, description) VALUES
    ('reflowable.pdf_to_epub', 'Reflowable Pdf to EPub'),
    ('reflowable.audio_sync', 'Reflowable Audio Sync'),
    ('hifi_fxl.pdf_to_epub', 'Hi-fi FXL Pdf to EPub'),
    ('hifi_fxl.audio_sync', 'Hi-fi FXL Audio Sync'),
    ('reflowable_epub.audio_sync', 'Reflowable EPUB to Audio Sync'),
    ('hifi_fxl_epub.audio_sync', 'Hi-fi FXL EPUB to Audio Sync'),
    ('accessibility', 'Accessibility'),
    ('epub_checker', 'Epub Checker'),
    ('interactive_books', 'Interactive Books'),
    ('conversion.basic', 'Reflowable Pdf to EPub'),
    ('kitaboo.import', 'Hi-fi FXL Pdf to EPub'),
    ('sync_studio', 'Reflowable Audio Sync'),
    ('epub_tools', 'Epub Checker'),
    ('accessibility_tools', 'Accessibility'),
    ('interactive.content', 'Interactive Books')`
);
await pool.execute(
  `INSERT IGNORE INTO plan_features (plan_id, feature_key, limits_json)
   SELECT p.id, f.feature_key, NULL FROM plans p CROSS JOIN features f`
);
const [r] = await pool.execute('SELECT feature_key FROM features ORDER BY feature_key');
console.log('features:', r.map((x) => x.feature_key));
await pool.end();
