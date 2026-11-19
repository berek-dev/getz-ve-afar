-- Models built by hand in the grid builder are saved with source 'builder'. SQLite can't change a CHECK
-- constraint in place, so the table is copied into a new one with the wider check.
CREATE TABLE job_models_new (
  id          INTEGER PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  layout_json TEXT NOT NULL,
  request     TEXT,
  mode        TEXT NOT NULL DEFAULT 'edit' CHECK (mode IN ('new', 'edit')),
  source      TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'paste', 'demo', 'builder')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO job_models_new (id, job_id, layout_json, request, mode, source, created_at)
  SELECT id, job_id, layout_json, request, mode, source, created_at FROM job_models;
DROP TABLE job_models;
ALTER TABLE job_models_new RENAME TO job_models;
CREATE INDEX job_models_job ON job_models (job_id, id);
