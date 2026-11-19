-- The 3D model version Yaal approved ("ההדמיה מוכנה"). Material lines, the shop drawing and the cut list follow it;
-- a newer version means the model changed since approval.
ALTER TABLE jobs ADD COLUMN model_approved_id INTEGER;
