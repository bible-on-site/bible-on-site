-- Database selection handled by the executing tool (db-populator, Lambda, etc.)
--
-- This file MUST be self-contained: every table referenced by the website's
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
        -- Bulletin approval is not website visibility. This author's only
        -- valid article must still appear on the website and in public search.
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

-- Representative test data for tanah_article_covering_source. Article 1 gets
-- verified coverage of its two opening pesukim. Every other fixture article
-- keeps coverage_verified = FALSE (coverage unknown -> primary-perek
-- fallback), so range lookups exercise both matching branches.
-- The perek FK needs tanah_perek populated, so the db-populator loads this
-- file only after tanah_sefarim_and_perakim_data.sql.
INSERT INTO tanah_article_covering_source (article_id, perek_id, pasuk)
VALUES (1, 1, 1), (1, 1, 2);
UPDATE tanah_article SET coverage_verified = TRUE WHERE id = 1;

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
-- Representative test data for the mention-decoration pipeline (issue #2516).
-- Two entries let e2e prove the full render contract: a resolved decoration
-- yields a dashed link, an unresolved one (יצחק has an entity but no entry)
-- stays plain text with no anchor at all.
-- ---------------------------------------------------------------------------
INSERT INTO tanahpedia_entry (id, unique_name, title, content)
VALUES
    (
        'e2e00000-0000-4000-8000-0000000000e1',
        'אלהים',
        'אלהים',
        '<p>שם הדגמה לבדיקת קישורי אזכורים</p>'
    ),
    (
        'e2e00000-0000-4000-8000-0000000000e2',
        'ישראל',
        'ישראל',
        '<p>שם הדגמה לבדיקת קישורי אזכורים</p>'
    );

-- Pasuk decoration on perek 1 pasuk 1 (בראשית א א): segment 2 is אֱלֹהִ֑ים.
INSERT INTO tanahpedia_mention_decoration (
    id,
    source_kind,
    perek_id,
    pasuk_number,
    segment_start,
    segment_end,
    surface,
    dedupe_key,
    intended_name,
    entity_type,
    acceptance,
    model_revision,
    source_hash
)
VALUES (
    'e2e00000-0000-4000-8000-0000000000d1',
    'pasuk',
    1,
    1,
    2,
    2,
    'אלהים',
    MD5('e2e-pasuk-elohim'),
    'אלהים',
    'PERSON',
    'auto',
    'e2e-fixture',
    SHA2('e2e-pasuk-elohim', 256)
);

-- Article decorations on article 1: ישראל resolves to its entry; יצחק has no
-- entry so the same span must render as ordinary text. content_hash and
-- surface are computed from the stored column so the fixture cannot drift.
INSERT INTO tanahpedia_mention_decoration (
    id,
    source_kind,
    article_id,
    content_hash,
    span_start,
    span_end,
    surface,
    dedupe_key,
    intended_name,
    entity_type,
    acceptance,
    model_revision,
    source_hash
)
SELECT 'e2e00000-0000-4000-8000-0000000000d2',
    'article',
    a.id,
    SHA2(a.content, 256),
    LOCATE('ישראל', a.content) - 1,
    LOCATE('ישראל', a.content) - 1 + CHAR_LENGTH('ישראל'),
    SUBSTRING(a.content, LOCATE('ישראל', a.content), CHAR_LENGTH('ישראל')),
    MD5('e2e-article-yisrael'),
    'ישראל',
    'NATION',
    'auto',
    'e2e-fixture',
    SHA2(a.content, 256)
FROM tanah_article a
WHERE a.id = 1;

INSERT INTO tanahpedia_mention_decoration (
    id,
    source_kind,
    article_id,
    content_hash,
    span_start,
    span_end,
    surface,
    dedupe_key,
    intended_name,
    entity_type,
    acceptance,
    model_revision,
    source_hash
)
SELECT 'e2e00000-0000-4000-8000-0000000000d3',
    'article',
    a.id,
    SHA2(a.content, 256),
    LOCATE('יצחק', a.content) - 1,
    LOCATE('יצחק', a.content) - 1 + CHAR_LENGTH('יצחק'),
    SUBSTRING(a.content, LOCATE('יצחק', a.content), CHAR_LENGTH('יצחק')),
    MD5('e2e-article-yitzchak'),
    'יצחק',
    'PERSON',
    'auto',
    'e2e-fixture',
    SHA2(a.content, 256)
FROM tanah_article a
WHERE a.id = 1;
