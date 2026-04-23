-- Tenant columns for PDFs (who owns the document; org scope for org_admin visibility)
ALTER TABLE pdf_documents
  ADD COLUMN user_id BIGINT NULL,
  ADD COLUMN organization_id BIGINT NULL,
  ADD INDEX idx_pdf_documents_user (user_id),
  ADD INDEX idx_pdf_documents_org (organization_id);

ALTER TABLE pdf_documents
  ADD CONSTRAINT fk_pdf_documents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_pdf_documents_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Activity log: one row per notable action (filtered by role in the API)
CREATE TABLE IF NOT EXISTS user_activities (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  organization_id BIGINT NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_id BIGINT NULL,
  summary VARCHAR(500) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_activities_user (user_id, created_at),
  INDEX idx_user_activities_org (organization_id, created_at),
  CONSTRAINT fk_user_activities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_activities_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional: interactive books gated by plan (same pattern as other features)
INSERT IGNORE INTO features (feature_key, description) VALUES
  ('interactive.content', 'Interactive books and editor');

INSERT IGNORE INTO plan_features (plan_id, feature_key, limits_json)
SELECT p.id, 'interactive.content', NULL
FROM plans p;
