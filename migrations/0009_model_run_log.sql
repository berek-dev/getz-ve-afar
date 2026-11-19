-- What each Gemini attempt of a run did (model, status, seconds to the first piece, total seconds, characters),
-- so a slow or failed build can be explained.
ALTER TABLE model_runs ADD COLUMN log TEXT;
