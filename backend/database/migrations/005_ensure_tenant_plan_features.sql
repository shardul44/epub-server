-- Ensure every plan includes core tenant workflow features (fixes member 403 on /pdfs, /conversions).
-- Full tenant feature catalog (must match schema.sql seed list).
INSERT IGNORE INTO features (feature_key, description) VALUES
    ('conversion.basic', 'PDF conversion and conversion jobs'),
    ('kitaboo.import', 'Kitaboo / FXL import and studio'),
    ('sync_studio', 'Sync studio and media overlay'),
    ('epub_tools', 'EPUB image editor and EPUB checker'),
    ('accessibility_tools', 'Accessibility remediation'),
    ('ai_config', 'AI configuration'),
    ('tts_management', 'TTS management'),
    ('interactive.content', 'Interactive books and editor');

INSERT IGNORE INTO plan_features (plan_id, feature_key, limits_json)
SELECT p.id, f.feature_key, NULL
FROM plans p
CROSS JOIN features f;
