# ProQuote · חשמל ושיפוצים 360

מערכת תמחור וניהול לבעלי מקצוע בשטח בישראל — חשמלאים, שיפוצניקים, קבלנים.
הצעות מחיר, מעקב תשלומים, חלוקת רווח לעובדים ושותפים, יומן עבודות, דשבורד רווחיות, ויועץ AI (Gemini).

> A pricing and business-management tool for Israeli field tradespeople. Hebrew, RTL, mobile-first.

---

## מקור האמת (Source of truth)

**`App_v43.jsx`** — כל הקוד נמצא בקובץ יחיד (~5000 שורות React).
זהו הקובץ שרץ בפרודקשן (Google AI Studio או פרויקט Firebase אמיתי).

| קובץ | תפקיד |
|---|---|
| `App_v43.jsx` | מקור האמת — כל האפליקציה בקובץ אחד |
| `App_v43_preview.html` | תצוגה מקדימה עצמאית עם מוק של Firebase (לבדיקת UI מחוץ ל-Studio בלבד — **לא** לפרודקשן) |
| `docs/handoff-brief.md` | מסמך העברה מקיף — חזון, ארכיטקטורה, היסטוריה, מה עובד/שבור, מפת דרכים |
| `docs/engineering-book.md` | ספר ההנדסה והמוצר המלא (15 פרקים) |
| `docs/google-studio-guide.md` | מדריך העלאה / QA / פרסום + חיבור Gemini |

## אילוצים קריטיים (Critical constraints)

1. **אין שלב build** — Tailwind דרך Play CDN, JSX מטורנספל בדפדפן. אסור `dark:` classes, אסור להניח קומפיילר.
2. **קובץ יחיד** — כל הקוד ב-`App_v43.jsx`.
3. **כל פיצ'ר חדש כבוי כברירת מחדל**, נפתח דרך ההגדרות.
4. **`geminiKey` לעולם לא נכתב ל-Firestore** — localStorage בלבד.
5. **מניעת רקורסיה** בחישובי רווח (עובד "אחוז רווח" לא נכלל בבסיס של עצמו).

פירוט מלא: `docs/handoff-brief.md` §4.

## טכנולוגיה (Stack)

- **Frontend:** React (single-file JSX), Tailwind CSS (Play CDN), `lucide-react`, `recharts`
- **Backend:** Firebase — Firestore + Auth
- **AI:** Gemini Flash, מפתח per-user ב-localStorage

## מפת דרכים לפרודקשן (Roadmap)

1. ✅ **Git** — `App_v43.jsx` ל-repo (נקודת התחלה נקייה)
2. **Firebase אמיתי** — פרויקט משלך + אימות אמיתי (Email/Google) במקום ההזרקה הזמנית של Studio
3. **כללי אבטחה** — Firestore Security Rules פר-משתמש (קריטי לפני פרודקשן)
4. **מנוי/תשלום** — Paywall
5. **החלטת build** — לשקול מעבר ל-Vite + Tailwind build

פירוט: `docs/handoff-brief.md` §10.
