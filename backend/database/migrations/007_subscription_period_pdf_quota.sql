-- Subscription-period PDF quota on org row (not monthly). Run after 006.

USE epub_db;

ALTER TABLE organizations
  CHANGE COLUMN monthly_page_limit pdf_page_quota INT NULL
    COMMENT 'Total PDF pages allowed for the current subscription period';

ALTER TABLE organizations
  ADD COLUMN pdf_pages_used INT NOT NULL DEFAULT 0
    COMMENT 'PDF pages consumed in the current subscription period'
    AFTER pdf_page_quota;
