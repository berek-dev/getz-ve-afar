-- גץ ועפר – סכמה ראשונית
-- סכומים בש"ח (REAL), אורכים במ"מ (INTEGER), תאריכים כ-ISO text.

CREATE TABLE settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  business_name   TEXT    NOT NULL DEFAULT 'גץ ועפר',
  hourly_rate     REAL    NOT NULL DEFAULT 0,
  overhead_pct    REAL    NOT NULL DEFAULT 0,
  margin_pct      REAL    NOT NULL DEFAULT 0,
  vat_pct         REAL    NOT NULL DEFAULT 18,
  bar_length_mm   INTEGER NOT NULL DEFAULT 6000,
  kerf_mm         INTEGER NOT NULL DEFAULT 3,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ספריית אלמנטים: פרופילים, צינורות, אביזרים, שעות עבודה...
CREATE TABLE elements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  category            TEXT NOT NULL CHECK (category IN
                        ('profile','plate','pipe','fitting','hardware','weld','labor','finish','equipment','other')),
  name                TEXT NOT NULL,
  unit                TEXT NOT NULL CHECK (unit IN ('m','kg','unit','hour','m2','joint','day')),
  unit_cost           REAL NOT NULL DEFAULT 0,
  weight_kg_per_unit  REAL,
  stock_length_mm     INTEGER,
  supplier_id         INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- תבנית = רשימת אלמנטים ממולאת מראש (JSON), נשמרת מעבודה קיימת
CREATE TABLE templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT,
  items_json   TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  site_address  TEXT,
  kind          TEXT NOT NULL DEFAULT 'fabrication'
                  CHECK (kind IN ('fabrication','pipe','service','earthworks')),
  status        TEXT NOT NULL DEFAULT 'lead'
                  CHECK (status IN ('lead','visit','quoted','approved','in_progress','done','paid','lost')),
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_client ON jobs(client_id);

CREATE TABLE job_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  element_id   INTEGER REFERENCES elements(id) ON DELETE SET NULL,
  group_name   TEXT,
  description  TEXT NOT NULL,
  quantity     REAL NOT NULL DEFAULT 1,
  unit         TEXT NOT NULL,
  unit_cost    REAL NOT NULL DEFAULT 0,
  length_mm    INTEGER,
  pieces       INTEGER,
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','template','ai')),
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_job_items_job ON job_items(job_id);

-- הצעת מחיר: צילום מצב (snapshot) של העבודה + טוקן ללינק ללקוח
CREATE TABLE quotes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL DEFAULT 1,
  token          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','approved','rejected','expired')),
  subtotal       REAL,
  vat            REAL,
  total          REAL,
  snapshot_json  TEXT NOT NULL,
  valid_until    TEXT,
  approved_at    TEXT,
  approved_name  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_quotes_job ON quotes(job_id);

CREATE TABLE photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  storage_key  TEXT NOT NULL,
  caption      TEXT,
  kind         TEXT NOT NULL DEFAULT 'site' CHECK (kind IN ('site','before','during','after','markup')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id    INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  amount    REAL NOT NULL,
  method    TEXT,
  paid_at   TEXT NOT NULL DEFAULT (date('now')),
  notes     TEXT
);

CREATE TABLE expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  category      TEXT,
  amount        REAL NOT NULL,
  vat           REAL,
  spent_at      TEXT NOT NULL DEFAULT (date('now')),
  receipt_key   TEXT,
  notes         TEXT
);
