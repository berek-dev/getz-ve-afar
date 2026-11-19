-- Jobs in phases and steps: the measuring visit gets its own date (scheduled_at stays the work date),
-- notes and measurements from the site, and the day materials were ordered.
ALTER TABLE jobs ADD COLUMN visit_at TEXT;    -- local "YYYY-MM-DDTHH:MM"
ALTER TABLE jobs ADD COLUMN site_notes TEXT;
ALTER TABLE jobs ADD COLUMN ordered_at TEXT;  -- "YYYY-MM-DD"

-- Until now one date served both: before the quote it was the visit.
UPDATE jobs SET visit_at = scheduled_at, scheduled_at = NULL, scheduled_hours = NULL
 WHERE status IN ('lead', 'visit') AND scheduled_at IS NOT NULL;
