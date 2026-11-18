-- 3D model of a job: layout versions (src/core/scene.ts). The newest row is the current model;
-- undo deletes it. mode 'new' starts a design (a description or a pasted layout), 'edit' changes the one before.
CREATE TABLE job_models (
  id          INTEGER PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  layout_json TEXT NOT NULL,
  request     TEXT,
  mode        TEXT NOT NULL DEFAULT 'edit' CHECK (mode IN ('new', 'edit')),
  source      TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'paste', 'demo')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX job_models_job ON job_models (job_id, id);
