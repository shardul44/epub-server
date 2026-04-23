-- Max member users per organization (NULL = unlimited). Org admins do not count.
USE epub_db;

ALTER TABLE organizations
  ADD COLUMN member_seat_limit INT NULL
    COMMENT 'Max users with role member; NULL = unlimited'
    AFTER active;
