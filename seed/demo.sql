-- Demo data only – fictional clients, suppliers and prices. Not a real price list.
-- Load with:  npm run db:seed:local   (or db:seed:remote)
-- Safe to re-run: deletes the demo rows (ids 9001+) first, then inserts them again.

DELETE FROM templates WHERE id BETWEEN 9001 AND 9099;
DELETE FROM jobs      WHERE id BETWEEN 9001 AND 9099;
DELETE FROM clients   WHERE id BETWEEN 9001 AND 9099;
DELETE FROM elements  WHERE id BETWEEN 9001 AND 9099;
DELETE FROM suppliers WHERE id BETWEEN 9001 AND 9099;

-- Pricing settings – only if never set (does not overwrite real settings)
UPDATE settings
   SET hourly_rate = 180, overhead_pct = 10, margin_pct = 20, vat_pct = 18,
       bar_length_mm = 6000, kerf_mm = 3, updated_at = datetime('now')
 WHERE id = 1 AND hourly_rate = 0;

INSERT INTO suppliers (id, name, phone, notes) VALUES
  (9001, 'ספק ברזל לדוגמה', NULL, 'פרופילים וצינורות'),
  (9002, 'חנות פרזול לדוגמה', NULL, 'צירים, מנעולים, מתכלים'),
  (9003, 'צביעה בתנור לדוגמה', NULL, NULL);

-- Element library. Rectangular tube weight = (2t(b+h) - 4t²) mm² × 7.85 kg/dm³
INSERT INTO elements (id, category, name, unit, unit_cost, weight_kg_per_unit, stock_length_mm, supplier_id) VALUES
  (9001, 'profile',  'פרופיל 80/80/3',            'm',     55,  7.25, 6000, 9001),
  (9002, 'profile',  'פרופיל 60/40/2',            'm',     22,  3.01, 6000, 9001),
  (9003, 'profile',  'פרופיל 40/20/1.5',          'm',     10,  1.34, 6000, 9001),
  (9004, 'hardware', 'ציר כבד לשער',              'unit',  45,  NULL, NULL, 9002),
  (9005, 'hardware', 'בריח רצפה',                 'unit',  60,  NULL, NULL, 9002),
  (9006, 'hardware', 'מנעול שער + ידית',          'unit', 180,  NULL, NULL, 9002),
  (9007, 'finish',   'צביעה בתנור',               'm2',    55,  NULL, NULL, 9003),
  (9008, 'other',    'בטון מהיר (שק)',            'unit',  35,  NULL, NULL, NULL),
  (9009, 'other',    'מתכלים: חוט ריתוך, דיסקים, גז', 'unit', 120, NULL, NULL, 9002),
  (9010, 'labor',    'שעת עבודה',                 'hour', 180,  NULL, NULL, NULL),
  (9011, 'other',    'הובלה',                     'unit', 250,  NULL, NULL, NULL),
  (9012, 'weld',     'תפר ריתוך צנרת 8 צול', 'joint', 480, NULL, NULL, NULL),
  (9013, 'equipment','רתכת נגררת + גנרטור – יום',  'day',  400,  NULL, NULL, NULL);

INSERT INTO clients (id, name, phone, address, notes) VALUES
  (9001, 'משפחת כהן (דוגמה)', NULL, 'מושב לדוגמה 12', 'לקוח בדוי לבדיקות'),
  (9002, 'אגודת מים לדוגמה',  NULL, NULL,            'לקוח בדוי לבדיקות');

-- Job 1: double-leaf gate 4 m × 1.75 m, 60/40 frame, vertical 40/20 infill every ~12 cm
INSERT INTO jobs (id, client_id, title, site_address, kind, status, description) VALUES
  (9001, 9001, 'שער כנף כפולה 4 מ׳ (דוגמה)', 'מושב לדוגמה 12', 'fabrication', 'visit',
   'שער כנף כפולה לכניסה לחניה. פתח 4 מ׳, גובה 1.75 מ׳. שני עמודים 80/80 עם יסוד בטון, מסגרת 60/40, מילוי אנכי 40/20 כל 12 ס״מ בערך, צביעה בתנור באפור גרפיט.');

INSERT INTO job_items (job_id, element_id, group_name, description, quantity, unit, unit_cost, length_mm, pieces, source, sort_order) VALUES
  (9001, 9001, 'עמודים',  'עמוד 80/80/3 (כולל 50 ס״מ ביסוד)',     4.6,   'm',    55,  2300,  2, 'manual', 10),
  (9001, 9002, 'כנפיים',  'מסגרת 60/40/2 – אנכיים',                7.0,   'm',    22,  1750,  4, 'manual', 20),
  (9001, 9002, 'כנפיים',  'מסגרת 60/40/2 – אופקיים',               7.44,  'm',    22,  1860,  4, 'manual', 30),
  (9001, 9003, 'כנפיים',  'מילוי 40/20/1.5 – אנכי',                50.1,  'm',    10,  1670, 30, 'manual', 40),
  (9001, 9004, 'פרזול',   'ציר כבד',                               4,     'unit', 45,  NULL, NULL, 'manual', 50),
  (9001, 9005, 'פרזול',   'בריח רצפה',                             1,     'unit', 60,  NULL, NULL, 'manual', 60),
  (9001, 9006, 'פרזול',   'מנעול + ידית',                          1,     'unit', 180, NULL, NULL, 'manual', 70),
  (9001, 9009, 'מתכלים',  'חוט ריתוך, דיסקים, גז',                 1,     'unit', 120, NULL, NULL, 'manual', 80),
  (9001, 9007, 'גמר',     'צביעה בתנור (שני הצדדים של 7 מ״ר שער)', 7,     'm2',   55,  NULL, NULL, 'manual', 90),
  (9001, 9008, 'התקנה',   'בטון מהיר לעמודים',                     4,     'unit', 35,  NULL, NULL, 'manual', 100),
  (9001, 9011, 'התקנה',   'הובלה לאתר',                            1,     'unit', 250, NULL, NULL, 'manual', 110),
  (9001, 9010, 'עבודה',   'ייצור במסגרייה',                        14,    'hour', 180, NULL, NULL, 'manual', 120),
  (9001, 9010, 'עבודה',   'התקנה בשטח',                            5,     'hour', 180, NULL, NULL, 'manual', 130);

-- Job 2: pipe welding – priced completely differently (per joint and per equipment day)
INSERT INTO jobs (id, client_id, title, kind, status, description) VALUES
  (9002, 9002, 'תיקון קו מים 8 צול – החלפת קטע (דוגמה)', 'pipe', 'lead',
   'החלפת קטע של 12 מ׳ בקו מים 8 צול פלדה. 6 תפרי ריתוך בשטח, יום רתכת נגררת.');

INSERT INTO job_items (job_id, element_id, group_name, description, quantity, unit, unit_cost, length_mm, pieces, source, sort_order) VALUES
  (9002, 9012, 'ריתוך',  'תפר 8 צול (8 אינץ׳-קוטר × 60 ₪)',  6, 'joint', 480, NULL, NULL, 'manual', 10),
  (9002, 9013, 'ציוד',   'רתכת נגררת + גנרטור',          1, 'day',   400, NULL, NULL, 'manual', 20),
  (9002, 9009, 'מתכלים', 'אלקטרודות, דיסקים',            1, 'unit',  120, NULL, NULL, 'manual', 30),
  (9002, 9011, 'הגעה',   'הגעה לאתר',                    1, 'unit',  250, NULL, NULL, 'manual', 40);

-- Job 3: service call, no items yet
INSERT INTO jobs (id, client_id, title, kind, status, description) VALUES
  (9003, 9001, 'תיקון ציר שער נפול (דוגמה)', 'service', 'lead', 'הלקוח שלח תמונה בוואטסאפ, צריך לתאם ביקור.');

-- A template made from the demo gate, so "start from a template" has something to show
INSERT INTO templates (id, name, description, items_json)
SELECT 9001, 'שער כנף כפולה (דוגמה)', 'שער חניה עם עמודים 80/80, מסגרת 60/40 ומילוי אנכי',
       json_group_array(json_object(
         'element_id', element_id, 'group_name', group_name, 'description', description,
         'quantity', quantity, 'unit', unit, 'unit_cost', unit_cost, 'length_mm', length_mm, 'pieces', pieces))
  FROM (SELECT * FROM job_items WHERE job_id = 9001 ORDER BY sort_order);
