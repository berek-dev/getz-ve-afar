-- Catalog: families, materials and price per kg.
-- Metal stock (profiles, pipes, plate) can be priced by weight: unit_cost = weight × material price per kg,
-- recalculated whenever the material price changes.

CREATE TABLE materials (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  density       REAL NOT NULL,              -- kg/dm³
  price_per_kg  REAL NOT NULL DEFAULT 0,    -- before VAT
  sort_order    INTEGER NOT NULL DEFAULT 0
);

INSERT INTO materials (key, name, density, sort_order) VALUES
  ('black',     'ברזל שחור',    7.85, 1),
  ('galv',      'ברזל מגולוון', 7.85, 2),
  ('stainless', 'נירוסטה 304',  7.93, 3),
  ('aluminum',  'אלומיניום',    2.70, 4);

ALTER TABLE elements ADD COLUMN family TEXT;                          -- menu group inside the category
ALTER TABLE elements ADD COLUMN material TEXT;                        -- materials.key
ALTER TABLE elements ADD COLUMN size TEXT;                            -- short label for the size grid ("60×40×2")
ALTER TABLE elements ADD COLUMN catalog_key TEXT;                     -- set when it came from the built-in catalog
ALTER TABLE elements ADD COLUMN price_by_kg INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX elements_catalog_key ON elements (catalog_key) WHERE catalog_key IS NOT NULL;
CREATE INDEX elements_family ON elements (category, family);
