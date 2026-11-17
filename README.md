# גץ ועפר

כלי עבודה פנימי לעסק המסגרות והריתוך של יעל חגי: עבודות, לקוחות, כתב כמויות, הצעות מחיר ומעקב תשלומים.
אפליקציית ווב (PWA) שמותקנת על מסך הבית באייפון. בנויה רק על שירותים חינמיים – בלי כרטיס אשראי בשום שלב
(Pages, Workers, D1, ובהמשך KV לתמונות. לא R2 ולא Zero Trust, שמבקשים אמצעי תשלום).

## סטאק

| שכבה | כלי |
| --- | --- |
| ממשק | Vite + React + TypeScript + Tailwind (RTL, מותאם לטלפון) |
| אירוח | Cloudflare Pages – מתעדכן אוטומטית בכל push ל-`main` |
| שרת | Pages Functions + Hono (`functions/api/[[route]].ts` → `server/app.ts`) |
| מסד נתונים | Cloudflare D1 (SQLite), מיגרציות ב-`migrations/` |
| התחברות | סיסמה אחת לאפליקציה + עוגייה חתומה ל-90 יום (`server/auth.ts`), עם הגבלת ניסיונות לפי IP |
| מנוע חישוב | `src/core/` – TypeScript נקי עם בדיקות `node:test` |

## הקמה (פעם אחת)

1. **חשבון Cloudflare חינמי** – <https://dash.cloudflare.com/sign-up>
2. **מקומית:**
   ```bash
   npm install
   npx wrangler login
   npx wrangler d1 create getz-ve-afar
   ```
   להעתיק את ה-`database_id` שמודפס אל `wrangler.toml`, ואז:
   ```bash
   npm run db:migrate:remote
   git commit -am "Set D1 database id" && git push
   ```
3. **חיבור הריפו ל-Pages:** Dashboard → Workers & Pages → Create → Pages → Connect to Git → `getz-ve-afar`.
   Build command: `npm run build`, Build output: `dist`. ה-bindings נקראים מ-`wrangler.toml`.
4. **סיסמה:** לבחור סיסמה ארוכה (12 תווים לפחות, עדיף משפט), ולהריץ:
   ```bash
   node scripts/hash-password.ts "הסיסמה שבחרתם"
   ```
   הפלט הוא שתי שורות: `APP_PASSWORD_HASH=...` ו-`SESSION_SECRET=...`.
   להוסיף את שתיהן ב-Pages → הפרויקט → Settings → Variables and Secrets → Production, מסוג **Secret**,
   ואז Deployments → Retry deployment. הסיסמה עצמה לא נשמרת בשום מקום, רק ה-hash שלה.
   שכחתם סיסמה או רוצים לנתק את כולם? מריצים שוב ומחליפים את שני הסודות.
5. **באייפון של יעל:** Safari → הכתובת → שיתוף → "הוסף למסך הבית". בפעם הראשונה מתחברים מתוך האפליקציה המותקנת,
   והכניסה נשמרת ל-90 יום (מתחדשת אוטומטית כשמשתמשים).
6. **גיבוי:** להפוך את הריפו לפרטי (Settings → General → Change visibility), ולהוסיף ב-Settings → Secrets → Actions:
   `CLOUDFLARE_API_TOKEN` (הרשאת D1 Edit) ו-`CLOUDFLARE_ACCOUNT_ID`. הגיבוי השבועי רץ רק בריפו פרטי.

## פיתוח מקומי

```bash
cp .dev.vars.example .dev.vars   # מדלג על הכניסה בסיסמה מקומית
npm run db:migrate:local
npm run db:seed:local            # נתוני דוגמה: שער כנף כפולה, תיקון קו מים, קריאת שירות (בדויים)
npm run build                    # פעם אחת, כדי ש-pages dev ימצא את dist
npm run dev:api                  # טרמינל 1: API + D1 מקומי על 8788
npm run dev                      # טרמינל 2: ממשק עם hot reload על 5173
npm test                         # בדיקות מנוע החישוב והאימות
```

## מבנה

```
src/            ממשק (React)
src/core/       מנוע חישוב – בלי תלויות, משותף לממשק ולשרת
server/         API (Hono) + כניסה בסיסמה
scripts/        כלי עזר (יצירת hash לסיסמה)
functions/      נקודת הכניסה של Pages Functions
migrations/     סכמת D1
```

## מפת דרכים

- **M0 – שלד** ✅ עבודות, לקוחות, הגדרות תמחור, התחברות, פריסה
- **M1 – מנוע חישוב:** אלמנטים, שיטות תמחור (מסגרות / צנרת / שירות), כתב כמויות, רשימת חיתוך ממוטות 6 מ'
- **M2 – בונה עבודה:** ספריית אלמנטים, בנייה חופשית עם קבוצות, צילומים (מכווצים בטלפון, נשמרים ב-Workers KV)
- **M3 – הצעת מחיר:** דף ללקוח, וואטסאפ, אישור
- **דמו:** + הכתבה → טיוטת אלמנטים (Gemini), רשימת חיתוך ויזואלית, שער תלת-ממדי
- **M4** רכש ויומן · **M5** כספים וקבלות · **M6** תבניות, אופליין, טאבלט + לייזר, עבודות עפר
