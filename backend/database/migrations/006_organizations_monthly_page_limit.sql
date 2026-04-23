-- Per-organization monthly PDF page cap (required when creating org via admin API).
USE epub_db;

ALTER TABLE organizations
  ADD COLUMN monthly_page_limit INT NULL
    COMMENT 'Max PDF pages per calendar month for this org; overrides plan when set'
    AFTER member_seat_limit;
