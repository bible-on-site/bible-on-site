-- Database selection handled by the executing tool (db-populator, Lambda, etc.)
--
-- This file MUST be self-contained: every table referenced by website
-- e2e tests must have representative rows here.  When you add a new DB table
-- that the website queries, add test data here too — otherwise e2e tests will
-- silently get empty results and fail with confusing "element not found" errors.
--
-- Tables covered:
--   tanah_author, tanah_article          (articles feature)
--   tanah_article_covering_source        (verse-level article coverage)
--   parshan, perush, note                (perushim / commentaries feature)
-- --------------------------------------------------------------------------

-- Representative test data for tanah_author
INSERT INTO tanah_author (NAME, DETAILS)
VALUES ('הרב לדוגמא שליט"א', 'תיאור לדוגמא'),
    ('הרב לדוגמא ז"ל', 'תיאור לדוגמא'),
    ('הרב לדוגמא הי"ד', 'תיאור לדוגמא'),
    (
        'רב עם תיאור ארוך ז"ל',
        'תיאור מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד ארוך'
    );
-- Representative test data for tanah_article
INSERT INTO tanah_article (
        PEREK_ID,
        AUTHOR_ID,
        ABSTRACT,
        NAME,
        PRIORITY,
        CONTENT,
        DISTRIBUTABLE
    )
VALUES (
        1,
        1,
        '<h1>בראשית ברא - עיון בפסוק הראשון</h1>',
        'בראשית ברא - עיון בפסוק הראשון',
        1,
        '<h2>פתיחה</h2>
<p>הפסוק הראשון בתורה הוא אחד הפסוקים המפורסמים והנחקרים ביותר בכל ספרות העולם. "בראשית ברא אלהים את השמים ואת הארץ" - שבע מילים בלבד שמכילות בתוכן את כל יסודות האמונה והבריאה.</p>

<h2>פירוש המילה "בראשית"</h2>
<p>רש"י פותח את פירושו הגדול לתורה בשאלה מפורסמת: "אמר רבי יצחק: לא היה צריך להתחיל את התורה אלא מ''החדש הזה לכם'', שהיא מצוה ראשונה שנצטוו בה ישראל. ומה טעם פתח בבראשית? משום ''כח מעשיו הגיד לעמו לתת להם נחלת גוים''." פירוש זה מלמדנו שיש משמעות עמוקה לסדר הדברים בתורה, ושכל מילה ומילה נכתבה בכוונה ובחכמה אלוקית.</p>

<h2>המילה "ברא"</h2>
<p>המילה "ברא" מופיעה בתנ"ך רק ביחס לקב"ה, ומשמעותה יצירה יש מאין, שונה מ"עשה" או "יצר" שמשמעם עיבוד חומר קיים. הרמב"ן מסביר שזו הבריאה הראשונה של החומר הראשוני ממנו נוצר הכל.</p>

<h2>שם אלהים</h2>
<p>חז"ל מסבירים שהשימוש בשם "אלהים" בפסוק הראשון מרמז על מידת הדין. הקב"ה רצה לברוא את העולם במידת הדין בלבד, אך ראה שאין העולם מתקיים, ושיתף עמו מידת הרחמים. לכן בפרק ב מופיע השם המשולב "ה'' אלהים".</p>

<h2>"את השמים ואת הארץ"</h2>
<p>המילה "את" באה לרבות, כדברי חז"ל: "את השמים" - לרבות חמה ולבנה וכוכבים ומזלות. "ואת הארץ" - לרבות אילנות ודשאים וגן עדן. יש כאן רמז לכל הנברא בששת ימי הבריאה.</p>

<h2>סיכום</h2>
<p>הפסוק הראשון בתורה מלמד אותנו יסודות עיקריים באמונה: א) יש בורא לעולם. ב) הבריאה היא יש מאין. ג) הקב"ה ברא הכל - שמים וארץ וכל צבאם. ד) לבריאה יש התחלה בזמן. הבנת פסוק זה היא הבסיס להבנת כל התורה כולה, ולכן התורה פותחת דווקא בו.</p>',
        TRUE
    ),
    (
        1,
        2,
        '<h1>מאמר של הרב לדוגמא ז"ל על בראשית א</h1>',
        'מאמר של הרב לדוגמא ז"ל על בראשית א',
        1,
        '<h2>פתיחה</h2>
<p>הפסוק הראשון בתורה הוא אחד הפסוקים המפורסמים והנחקרים ביותר בכל ספרות העולם. "בראשית ברא אלהים את השמים ואת הארץ" - שבע מילים בלבד שמכילות בתוכן את כל יסודות האמונה והבריאה.</p>

<h2>פירוש המילה "בראשית"</h2>
<p>רש"י פותח את פירושו הגדול לתורה בשאלה מפורסמת: "אמר רבי יצחק: לא היה צריך להתחיל את התורה אלא מ''החדש הזה לכם'', שהיא מצוה ראשונה שנצטוו בה ישראל. ומה טעם פתח בבראשית? משום ''כח מעשיו הגיד לעמו לתת להם נחלת גוים''." פירוש זה מלמדנו שיש משמעות עמוקה לסדר הדברים בתורה, ושכל מילה ומילה נכתבה בכוונה ובחכמה אלוקית.</p>

<h2>המילה "ברא"</h2>
<p>המילה "ברא" מופיעה בתנ"ך רק ביחס לקב"ה, ומשמעותה יצירה יש מאין, שונה מ"עשה" או "יצר" שמשמעם עיבוד חומר קיים. הרמב"ן מסביר שזו הבריאה הראשונה של החומר הראשוני ממנו נוצר הכל.</p>

<h2>שם אלהים</h2>
<p>חז"ל מסבירים שהשימוש בשם "אלהים" בפסוק הראשון מרמז על מידת הדין. הקב"ה רצה לברוא את העולם במידת הדין בלבד, אך ראה שאין העולם מתקיים, ושיתף עמו מידת הרחמים. לכן בפרק ב מופיע השם המשולב "ה'' אלהים".</p>

<h2>"את השמים ואת הארץ"</h2>
<p>המילה "את" באה לרבות, כדברי חז"ל: "את השמים" - לרבות חמה ולבנה וכוכבים ומזלות. "ואת הארץ" - לרבות אילנות ודשאים וגן עדן. יש כאן רמז לכל הנברא בששת ימי הבריאה.</p>

<h2>סיכום</h2>
<p>הפסוק הראשון בתורה מלמד אותנו יסודות עיקריים באמונה: א) יש בורא לעולם. ב) הבריאה היא יש מאין. ג) הקב"ה ברא הכל - שמים וארץ וכל צבאם. ד) לבריאה יש התחלה בזמן. הבנת פסוק זה היא הבסיס להבנת כל התורה כולה, ולכן התורה פותחת דווקא בו.</p>',
        TRUE
    ),
    (
        1,
        2,
        '<h1>מאמר שני של הרב לדוגמא ז"ל על בראשית א</h1>',
        'מאמר שני של הרב לדוגמא ז"ל על בראשית א',
        1,
        NULL,
        TRUE
    ),
    (
        1,
        4,
        '<h1>מאמר עם תמונה - בראשית א</h1>',
        'מאמר עם תמונה - בראשית א',
        1,
        '<h2>פרק עם תמונה</h2>
<p>זהו מאמר לדוגמא עם תמונה מ-S3:</p>
<img src="https://bible-on-site-assets-test.s3.amazonaws.com/rabbis/test-rabbi.jpg" alt="תמונת רב לדוגמא" />
<p>התמונה לעיל היא לצורכי בדיקה בלבד.</p>',
        -- Bulletin approval is not website visibility. The only valid
        -- article of this author must still appear on the website and in public search.
        FALSE
    ),
    -- Invalid chapter row: public article routes and search must exclude it.
    -- perek_id 5000 is outside the 929 range so article counters stay unchanged.
    (
        5000,
        4,
        N'<h1>מאמר נסתר - אינו להפצה</h1>',
        N'מאמר נסתר - אינו להפצה',
        1,
        N'<p>מאמר זה אינו מיועד להפצה ומכיל את הביטוי הייחודי רזאדשבתא הנסתרת.</p>',
        FALSE
    );

-- Article with explicit scripture citations — the link-proposal pipeline
-- (#3103) heuristic engine extracts covering-source candidates from them.
-- Appended after the shared article rows above so its auto-increment id (6)
-- stays stable for e2e runs.
-- Hidden-row idiom like the row above: perek_id 5000 sits outside the 929
-- counters and DISTRIBUTABLE FALSE keeps it out of public article/author
-- counts, so shared-fixture assertions (API + website e2e) stay unchanged.
-- The admin pipeline reads the row directly by id.
INSERT INTO tanah_article (
        PEREK_ID,
        AUTHOR_ID,
        ABSTRACT,
        NAME,
        PRIORITY,
        CONTENT,
        DISTRIBUTABLE
    )
VALUES (
        5000,
        4,
        '<h1>מאמר ציטוטים לצינור ההצעות</h1>',
        'מאמר ציטוטים לצינור ההצעות',
        1,
        '<p>המאמר דן באברהם אבינו: בראשית יח, ב מתאר את התחנוננות על סדום, ושמואל ב ה, ז מזכיר את מלכות החברון.</p>',
        FALSE
    );

-- Representative test data for tanah_article_covering_source. Article 1 gets
-- verified coverage of its two opening pesukim. Every other fixture article
-- keeps coverage_verified = FALSE (coverage unknown -> primary-perek
-- fallback), so range lookups exercise both matching branches.
-- The perek FK needs tanah_perek populated, so the db-populator loads this
-- file only after tanah_sefarim_and_perakim_data.sql.
INSERT INTO tanah_article_covering_source (article_id, perek_id, pasuk)
VALUES (1, 1, 1), (1, 1, 2);
UPDATE tanah_article SET coverage_verified = TRUE WHERE id = 1;

-- Representative recurring Hebrew-date overrides (#3098). These are test
-- fixtures, NOT the production assignments (2199->9 Av, 2860->5 Iyar live in
-- tanah_article_hebrew_date_upgrade.sql). Article 2 is bound to 9 Av (11,9)
-- and article 3 to 5 Iyar (8,5) so date lookups exercise the override path
-- across different primary perek/author ownership than the scheduled perek.
-- The table is CREATE IF NOT EXISTS and survives repopulation, so the
-- fixtures re-assert on every run: ON DUPLICATE keeps the fixture owner even
-- when the prod upgrade claims the same date first.
INSERT INTO tanah_article_hebrew_date (article_id, hebrew_month, hebrew_day)
VALUES (2, 11, 9), (3, 8, 5)
ON DUPLICATE KEY UPDATE article_id = VALUES(article_id);

-- ---------------------------------------------------------------------------
-- Representative test data for perushim (commentaries)
-- parshan = commentator, perush = commentary work, note = text per pasuk
-- ---------------------------------------------------------------------------

-- Commentators
INSERT INTO parshan (id, name, birth_year, has_pic)
VALUES
    (1, 'רש"י', 1040, 0),
    (2, 'אבן עזרא', 1089, 0),
    (3, 'תרגום אונקלוס', NULL, 0);

-- Commentary works  (priority: 0-99 = Targum, 100 = Rashi, 200+ = others)
INSERT INTO perush (id, name, parshan_id, comp_date, pub_date, priority)
VALUES
    (1, 'רש"י', 1, NULL, NULL, 100),
    (2, 'אבן עזרא', 2, NULL, NULL, 200),
    (3, 'תרגום אונקלוס', 3, NULL, NULL, 10);

-- Sample notes for perek 1 (בראשית א) — enough to exercise carousel + full view
INSERT INTO note (perush_id, perek_id, pasuk, note_idx, note_content)
VALUES
    (1, 1, 1, 0, 'בראשית - אמר רבי יצחק לא היה צריך להתחיל את התורה אלא מהחודש הזה לכם'),
    (1, 1, 1, 1, 'ברא אלהים - ולא אמר ברא ה׳, שבתחילה עלה במחשבה לבראותו במידת הדין'),
    (1, 1, 2, 0, 'והארץ היתה תהו ובהו - תהו, אדם תוהה ומשתומם על בהו שבה'),
    (2, 1, 1, 0, 'בראשית - יש אומרים כי המילה בראשית היא סמיכות, בראש-ית, בראשית ברוא'),
    (2, 1, 2, 0, 'תהו ובהו - תהו הוא דבר שאין בו ממש, ובהו דבר שיש בו ממש'),
    (3, 1, 1, 0, 'בקדמין ברא ה׳ ית שמיא וית ארעא'),
    (3, 1, 2, 0, 'וארעא הות צדיא וריקניא');

-- ---------------------------------------------------------------------------
-- Representative test data for מועדים על הפרק (issue #3101).
--
-- The production catalogue seeds from tanah_moed_data.sql BEFORE this file
-- (db-populator order), so these fixtures only add deterministic test moadim
-- plus link rows covering every union branch of the article list:
--   article 1 - linked AND range-matched via its verified covering rows
--              (בראשית א 1-2 sit inside the stored בראשית א 1-3 range)
--   articles 2-4 - range-matched only: unverified coverage falls back to
--              their primary perek (1), which overlaps the stored range
--   article 5 - linked but never listed: its primary perek (5000) is not a
--              routable public chapter, so the union 1-929 bound keeps it
--              out — an explicit link alone cannot resurrect a dead route
--   article 3 - the explicit-only case on moed 92: its primary perek (1)
--              never intersects the stored range of moed 92, so it renders by
--              the link alone (no range match claims pasuk precision)
-- Moed 91 stays unpublished so the detail route 404 path is exercised.
-- ---------------------------------------------------------------------------
-- The moed tables are CREATE IF NOT EXISTS (never drop-recreated), so
-- these fixtures must stay idempotent like the seed guards above them.
INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT id, slug, name, summary, hebrew_month, date_label, annual_order, published
FROM (SELECT 90 AS id, 'מועד-בדיקה' AS slug, 'מועד בדיקה' AS name,
             'מועד לבדיקות אוטומטיות' AS summary, NULL AS hebrew_month,
             NULL AS date_label, 90 AS annual_order, TRUE AS published
      UNION ALL
      SELECT 91, 'מועד-לא-מפורסם', 'מועד לא מפורסם', NULL, NULL, NULL, 91, FALSE
      UNION ALL
      SELECT 92, 'מועד-בדיקה-קישור', 'מועד בדיקה קישור',
             'מועד לבדיקת קישור ידני בלבד', NULL, NULL, 92, TRUE) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE tanah_moed.id = seed.id);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT id, moed_id, label, position
FROM (SELECT 9001 AS id, 90 AS moed_id, 'סעיף בדיקה' AS label, 1 AS position
      UNION ALL
      SELECT 9002, 92, 'סעיף קריאה בלי מאמרים', 1) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE tanah_moed_section.id = seed.id);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end
FROM (SELECT 90011 AS id, 9001 AS section_id, 1 AS position,
             1 AS perek_id_start, 1 AS pasuk_start, 1 AS perek_id_end, 3 AS pasuk_end
      UNION ALL
      -- בראשית ב carries no fixture article, so the range of moed 92 matches
      -- nothing and its article list is the explicit link alone.
      SELECT 90021, 9002, 1, 2, 1, 2, 3) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range WHERE tanah_moed_range.id = seed.id);

INSERT INTO tanah_article_moed (article_id, moed_id)
SELECT article_id, moed_id
FROM (SELECT 1 AS article_id, 90 AS moed_id UNION ALL
      SELECT 5, 90 UNION ALL
      SELECT 3, 92) seed
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_article_moed existing
    WHERE existing.article_id = seed.article_id AND existing.moed_id = seed.moed_id
);

-- ---------------------------------------------------------------------------
-- Mention-decoration fixtures (issue #2516) live in
-- tanah_mention_test_data.sql instead. Never insert tanahpedia_entry rows in
-- this file: it runs BEFORE the Tanahpedia seed chain, and the legacy
-- migration only fires while tanahpedia_entry is empty — an entry inserted
-- here silently disables it and starves every Tanahpedia e2e of content.
-- ---------------------------------------------------------------------------
