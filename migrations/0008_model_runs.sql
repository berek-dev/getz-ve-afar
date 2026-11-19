-- A 3D model being built by Gemini. The app can leave the screen (or the phone can sleep) while it runs:
-- the result is saved as a job_models version, and the app polls this row to know when it is ready.
-- 'running' rows older than a few minutes were cut off (the server gives up then).
CREATE TABLE model_runs (
  id          INTEGER PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  request     TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('new', 'edit')),
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'canceled')),
  error       TEXT,
  model_id    INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX model_runs_job ON model_runs (job_id, id);
