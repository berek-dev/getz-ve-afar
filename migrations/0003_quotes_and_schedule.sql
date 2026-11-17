-- Quote settings, and a scheduled date/time on jobs (for the calendar)
ALTER TABLE settings ADD COLUMN business_phone TEXT;
ALTER TABLE settings ADD COLUMN quote_terms TEXT;
ALTER TABLE settings ADD COLUMN quote_valid_days INTEGER NOT NULL DEFAULT 14;

ALTER TABLE jobs ADD COLUMN scheduled_at TEXT;      -- local date-time "YYYY-MM-DDTHH:MM"
ALTER TABLE jobs ADD COLUMN scheduled_hours REAL;   -- planned duration
