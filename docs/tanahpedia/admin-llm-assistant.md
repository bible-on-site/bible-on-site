# עוזר LLM באדמין תנכפדיה

## מטרה

המודל מסייע בניסוח ובמילוי שדות **בלי גישה ישירה ל־MySQL**. כל שינוי עובר דרך פונקציות שרת קיימות (`updateEntry`, `updateEntityDisplayName`, וכו') לאחר אישור עורך אנושי.

## הקשר (Context) שנשלח למודל

1. **מטא־ערך** — `id`, `title`, `unique_name` (כולל טיוטות מהטופס אם שונו לפני הבקשה).
2. **HTML מלא** — מחרוזת `content` כפי שהיא בעורך ה־WYSIWYG (מקור אחד לאמת לטקסט ולתגים).
3. **יישויות מקושרות** — לכל קישור `entry_entity`: מזהה יישות, סוג, שם תצוגה, ואם רלוונטי: שם MAIN, מין, רשימת `place_identification`.
4. **תקציר סכמה** — נבנה מ־`web/admin/src/lib/tanahpedia/schema-registry.ts` (טבלאות, עמודות, enum, הערות FK).

## פלט

JSON יחיד (נאכף ע"י `response_format: json_object` ב־OpenAI), בצורה המתוארת ב־`buildTanahpediaAssistantSystemPrompt` ב־`web/admin/src/server/tanahpedia/llm-assistant.ts`.

- `entry` — שדות אופציונליים: `title`, `unique_name`, `contentHtml`.
- `linkedEntities` — רק `entityId` שכבר מקושרים לערך הנוכחי; שדות משנה לפי סוג (איש / מקום).
- `notesForEditor` — הסבר קצר.

אימות בשרת: כל `entityId` ב־`linkedEntities` חייב להופיע בקישורי הערך; אחרת הבקשה נכשלת.

## משתני סביבה (שרת אדמין בלבד)

| משתנה | תיאור |
|--------|--------|
| `OPENAI_API_KEY` | מפתח API ל־OpenAI |
| `OPENAI_MODEL` | אופציונלי; ברירת מחדל `gpt-4o-mini` |

אין לחשוף מפתח ללקוח — הקריאה מתבצעת רק ב־`suggestTanahpediaEntryEdits`.

## הרחבות עתידיות

- §6.0.1 בתוכנית: הצעות `entity_tanah_source` עם אימות מול טקסט פסוקים.
- הרחבת `schema-registry` לכל סוגי היישויות והטבלאות הדינמיות (מקורות, קשרי משפחה, וכו').
