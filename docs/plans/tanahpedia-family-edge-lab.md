# תכנון: מעבדת מקרי קצה — עץ משפחה (תנכפדיה)

מטרה: עשרות תרחישים מבודדים לבדיקת ייצוג UI (`PersonFamilyTree`) ושאילתות (`getPersonFamilySummary`), בלי לדרוס תוכן אמיתי. כל תרחיש הוא **ערך תנכפדיה נפרד** עם קידומת `tanahpedia-lab-NN-…`.

## הרצת נתונים

```bash
cd data && cargo make mysql-apply-tanahpedia-edge-lab
```

דורש מבנה תנכפדיה + טבלאות lookup (כמו אחרי `mysql-populate-dev` או לפחות seed תנכפדיה). הקובץ `tanahpedia_incremental_lookups.sql` רץ קודם (כולל `BANNED_INCEST`, `BETROTHAL`, `FOSTER`).

**יצירה מחדש של ה-SQL** (אחרי שינוי הגדרות במעבדה):

```bash
node data/mysql/scripts/generate-tanahpedia-edge-lab.mjs
```

## ייצוג ב-UI — מיפוי כללי

| מנגנון DB | ייצוג באתר |
|-----------|------------|
| `tanahpedia_person_parent_child` עם `alt_group_id` שונה בין קבוצות | בלוק **«חלופי»** + שורת כרטיסים (כמו בהורים; מיושם גם ל**ילדים**) |
| `relationship_type_id` → BIOLOGICAL / ADOPTIVE / STEP / FOSTER | שורת מטא «אב/אם · ביולוגי/אימוץ/חורג/אומנות» |
| `union_type_id` → MARRIAGE / PILEGESH / FORBIDDEN_WITH_GENTILE / BANNED_INCEST / BETROTHAL | כרטיס זיווג או תתי־כותרות בכרטיס ממוזג |
| שתי שורות union לאותו `entity` של בן/בת זוג: MARRIAGE + FORBIDDEN_WITH_GENTILE, אותו `union_order` | **מיזוג** לכרטיס אחד + טקסט דעות (הרמב״ם / רש״י…) |
| `start_date`, `end_date`, `end_reason_id` ב־`tanahpedia_person_union` | סיומת מטא: התחלה / פטירה או גירושין + תאריך (פורמט YYYY-MM-DD) |
| אחים: אותו `parent_id` לשני `child` | כרטיסי **אחים** לצד המוקד (חציית שמאל/ימין) |
| ישות בלי `tanahpedia_entry_entity` | שם תצוגה בלבד, **ללא קישור** לערך |

## מגבלות המודל (לתיעוד)

- **סבא/נכד** דרך הילדים של המוקד לא מוצגים בעץ המוקד (אין שליפת דורות נוספים).
- מיזוג אוטומטי לשיטות מרובות קיים היום ל־**MARRIAGE + FORBIDDEN_WITH_GENTILE** בלבד (אותו `union_order`).

## טבלת תרחישים (38 ערכי מוקד)

| # | `unique_name` (נתיב `/tanahpedia/entry/…`) | מה נבדק | איך זה נראה ב-UI |
|---|-------------------------------------------|---------|-------------------|
| 01 | `tanahpedia-lab-01-two-bio-parents` | אב + אם ביולוגיים | שורת הורים, שני כרטיסים |
| 02 | `tanahpedia-lab-02-father-only` | אב בלבד | כרטיס אב בלבד |
| 03 | `tanahpedia-lab-03-mother-only` | אם בלבד | כרטיס אם בלבד |
| 04 | `tanahpedia-lab-04-alt-two-fathers` | שני מועמדים לאב (`alt_group`) | שני בלוקי **חלופי** |
| 05 | `tanahpedia-lab-05-stepfather-bio-mother` | אב חורג + אם ביולוגית | מטא «חורג» / «ביולוגי» |
| 06 | `tanahpedia-lab-06-adoptive-mother` | אם מאימוץ | מטא «אימוץ» |
| 07 | `tanahpedia-lab-07-foster-father` | אב FOSTER | מטא «אומנות» |
| 08 | `tanahpedia-lab-08-one-marriage` | נישואין יחידים | שורת בנות זוג, כרטיס אחד |
| 09 | `tanahpedia-lab-09-two-wives-ordered` | שתי נשואין + `union_order` | שני כרטיסים עם סדר |
| 10 | `tanahpedia-lab-10-wife-and-pilegesh` | אישה + פילגש | «נישואין» / «פילגש» |
| 11 | `tanahpedia-lab-11-dual-opinion-fused` | נישואין + פסול גוי, אותו סדר | כרטיס ממוזג + שתי דעות |
| 12 | `tanahpedia-lab-12-dual-opinion-split-order` | אותו אדם, סדר union שונה | שני כרטיסים נפרדים (אין מיזוג) |
| 13 | `tanahpedia-lab-13-spouse-alt-identities` | שתי זהויות בת זוג (`alt_group`) | בלוק **חלופי** בזיווגים |
| 14 | `tanahpedia-lab-14-female-focal-husband` | מוקדת נקבה | כותרת גשר **בני זוג** |
| 15 | `tanahpedia-lab-15-unknown-sex-spouse` | בלי `person_sex` | כותרת **זיווגים** |
| 16 | `tanahpedia-lab-16-one-bio-child` | ילד ביולוגי | שורת ילדים |
| 17 | `tanahpedia-lab-17-adoptive-child` | ילד מאימוץ | מטא «אימוץ» |
| 18 | `tanahpedia-lab-18-step-child` | ילד חורג | מטא «חורג» |
| 19 | `tanahpedia-lab-19-child-two-relations` | אותו ילד, ביולוגי + חורג | **שני** כרטיסי ילד (מפתח דדופ שונה) |
| 20 | `tanahpedia-lab-20-children-alt-paternity` | ילד אחד, שני `alt_group` לאבות | **חלופי** תחת ילדים |
| 21 | `tanahpedia-lab-21-siblings-shared-parents` | אח מלא | אח לצד המוקד |
| 22 | `tanahpedia-lab-22-half-sibling` | אב משותף, אם שונה לאח | אח מחצה |
| 23 | `tanahpedia-lab-23-many-siblings` | חמישה אחים | פריסת אחים רחבה |
| 24 | `tanahpedia-lab-24-union-ended-death` | סיום פטירה + תאריכים | מטא זיווג: פטירה + תאריך |
| 25 | `tanahpedia-lab-25-union-divorce` | גירושין | מטא: גירושין + תאריך |
| 26 | `tanahpedia-lab-26-betrothal` | BETROTHAL | כותרת דעה לדוגמה + «אירוסין» |
| 27 | `tanahpedia-lab-27-banned-incest-union` | BANNED_INCEST | כותרת דעה לדוגמה + «קשר אסור (ערוה)» |
| 28 | `tanahpedia-lab-28-pilegesh-alone` | פילגש בלבד | כרטיס פילגש |
| 29 | `tanahpedia-lab-29-spouses-no-parents` | זיווגים בלי הורים | אין שורת הורים |
| 30 | `tanahpedia-lab-30-parents-children-no-spouse` | הורים + ילד, בלי union | בלי גשר זיווגים |
| 31 | `tanahpedia-lab-31-citation-on-parent` | `source_citation` על הורה | שורת מקור תחת כרטיס הורה |
| 32 | `tanahpedia-lab-32-unlinked-child` | ילד בלי entry | טקסט שם בלי קישור |
| 33 | `tanahpedia-lab-33-unlinked-spouse` | בת זוג בלי entry | כרטיס ללא קישור |
| 34 | `tanahpedia-lab-34-triple-union-types` | שלוש שיטות טיב, אותו `alt_group` | כרטיס ממוזג עם שלוש דעות |
| 35 | `tanahpedia-lab-35-marriage-plus-betrothal` | נישואין + אירוסין לאותה אישה | כרטיס ממוזג (שני טורים) |
| 36 | `tanahpedia-lab-36-parent-bio-and-step-same-side` | שני אבות (ביולוגי + חורג) | שני כרטיסי אב |
| 37 | `tanahpedia-lab-37-child-foster` | ילד FOSTER | מטא «אומנות» בילד |
| 38 | `tanahpedia-lab-38-full-stack` | הורים + אח + זיווג + ילד | כל השכבות יחד |

## קבצים

| קובץ | תפקיד |
|------|--------|
| `data/mysql/tanahpedia_family_edge_lab_data.sql` | נתונים (נוצר ע"י הסקריפט) |
| `data/mysql/scripts/generate-tanahpedia-edge-lab.mjs` | הגדרות התרחישים + יצוא SQL |
| `data/mysql/tanahpedia_incremental_lookups.sql` | סוגי union / parent-child נוספים |
| `web/.../PersonFamilyTree.tsx` | ייצוג |
| `web/.../person-family-labels.ts` | תוויות עברית |

## תרחישים נוספים (מחקר) — אותו ייצוג כבר קיים

להלן מקרים שלא דורשים ערך נפרד (חופפים למיפוי למעלה), או שמחכים להרחבת מודל:

- **אלמן/אלמנה עם ילדים בלבד** — כמו 30 + ילדים (אין שדה «סטטוס נישואין נוכחי» נפרד).
- **יבום / חליצה** — דורש טיפוס union או תהליך ייעודי (לא נוסף עדיין).
- **אותו ילד בשלושה `alt_group`** — אותו מנגנון כמו 04/20.
- **ריבוי נישואין עם אותו `union_order`** — התנהגות מיון בלבד (לא מומלץ ב-DB אמיתי).

## נספח: עוד מקרי קצה למחקר (ללא ערך SQL ייעודי עדיין)

אלה משלימים ל־**50+** תרחישים מחושבים; רובם ניתנים למיפוי לאותו ייצוג כמו בשורות למעלה או דורשים הרחבת סכימה:

| # | מקרה | ייצוג יעד / הערה |
|---|------|------------------|
| 39 | ריבוי `source_citation` לאותו קשר | כיום שורה אחת; אולי רשימת מקורות |
| 40 | הורה לא ידוע (רק «אחד מההורים») | צריך ישות placeholder או דגל |
| 41 | תאומים — שני ילדים, אותם הורים | שני כרטיסי ילדים (קיים) |
| 42 | גיל הנקה / גיל פרידה כטקסט | לא בשדות מספריים כיום |
| 43 | נישואי חוץ (לא מקודדים) | דרך `BETROTHAL` / הערה בלבד |
| 44 | גרושה שנישאה שוב — סדר unions | `union_order` + סיומים |
| 45 | פילגש שהועלתה לכתובה | שתי שורות union (דומה ל־11) |
| 46 | ממזר ממעשה / קדושין תלויים | טיפוסי union עתידיים |
| 47 | אימוץ מבית דין | כמו ADOPTIVE |
| 48 | אפוטרופוס (לא הורה ביולוגי) | תפקיד הורה נפרד ב-lookup? |
| 49 | קטין — אין שינוי UI | שדות גיל עתידיים |
| 50 | מגדר לא בינארי ב-`person_sex` | היום UNKNOWN → «זיווגים» |
| 51 | שינוי שם אדם (MAIN vs ADDITIONAL) | לא משפיע על עץ |
| 52 | אדם = ישות לא PERSON | לא נכנס לעץ |
| 53 | מעגלים (A אב של B, B אב של A) | מניעה ב-DB / אזהרה |
| 54 | יותר משני הורים מאותו מין (ריבוי משפחות) | `alt_group` או גרף |
| 55 | צאצא מאומץ + ביולוגי לאותו מוקד | שני כרטיסי parent_child (קיים) |
| 56 | נכד כ«מוקד» נפרד | עץ משלו; אין rollup |
| 57 | אחים מאותה אם, אבות שונים (חצי מאם) | שיקול sibling query — היום לפי הורה משותף כלשהו |
| 58 | גיור בתוך המשפחה | כמו ADOPTIVE / STEP לפי הנחה |
| 59 | רישום חלקי (רק union בלי parent_child) | ילדים לא יופיעו |
| 60 | אותו `alt_group` להורים ולילדים | שני בלוקי חלופי נפרדים לשכבה |

---

*עודכן עם מימוש מעבדת ה-SQL והרחבות UI (חלופי בילדים, תאריכי/סיום union).*
