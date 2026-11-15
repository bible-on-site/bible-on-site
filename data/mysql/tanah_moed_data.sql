-- Initial מועדים catalogue for issue #3101.
--
-- Authoritative production content applied through the data-deploy path (not
-- the Rust populator and not GUI fixtures). Every statement is repeat-safe:
-- moed rows are guarded by slug/id, and the sections+ranges of each moed are only
-- seeded while that moed has no curated sections, so re-running on every
-- deploy is a no-op and editor-authored content is preserved.
--
-- Removing a seeded moed permanently means deleting it via admin AND removing
-- its blocks here, otherwise the next deploy reseeds it (same seed semantics
-- as tanah_dedication_data.sql).
--
-- Provenance: haftara ranges mirror the verified special-occasion table in
-- web/bible-on-site/src/data/parasha/parasha-division.json (itself sourced
-- from printed sidurim tables), split into labelled sections per documented
-- custom so no tradition is presented as universal. Megillot use the full
-- canonical sefer range. Scripture ranges are curated per moed — never
-- derived from article ids.
--
-- Canonical perek ids come from the corpus numbering (1-929):
-- יהושע 188-211, שמואל א 233-263, שמואל ב 264-287, מלכים א 288-309,
-- ישעיהו 335-400, ירמיהו 401-452, יחזקאל 453-500, הושע 501-514, יונה 529-532,
-- מיכה 533-539, זכריה 551-564, רות 799-802, איכה 803-807, אסתר 820-829.
--
-- Comment lines stay free of semicolons and apostrophes for the deploy
-- Lambda statement splitter.

-- ---------------------------------------------------------------------------
-- Moed rows: guarded by slug and id.
-- ---------------------------------------------------------------------------

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 1, 'ראש-השנה', 'ראש השנה', 'ראש השנה לתורה ולעולם - ימי הדין והזכרונות בתחילת השנה החדשה. ההפטרות מובאות למנהגי הספרדים האשכנזים והתימנים.', 'תשרי', 'א''-ב'' בתשרי', 1, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'ראש-השנה' OR id = 1);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 2, 'צום-גדליה', 'צום גדליה', 'צום השלישי בתשרי בזכר רצח גדליה בן אחיקם - אחד מארבעת הצומות על החורבן.', 'תשרי', 'ג'' בתשרי', 2, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'צום-גדליה' OR id = 2);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 3, 'יום-כיפור', 'יום כיפור', 'יום הכיפורים - יום התשובה והסליחה, קדוש השנה. ההפטרות מובאות למנהגי הספרדים האשכנזים והתימנים.', 'תשרי', 'י'' בתשרי', 3, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'יום-כיפור' OR id = 3);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 4, 'סוכות', 'סוכות', 'חג הסוכות - זמן שמחתנו, חג האסיף. ההפטרות מובאות למנהגי הספרדים האשכנזים והתימנים.', 'תשרי', 'ט''ו-כ''א בתשרי', 4, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'סוכות' OR id = 4);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 5, 'שמיני-עצרת-ושמחת-תורה', 'שמיני עצרת ושמחת תורה', 'שמיני עצרת ושמחת תורה - סיום הקריאה והתחלתה מחדש.', 'תשרי', 'כ''ב בתשרי', 5, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'שמיני-עצרת-ושמחת-תורה' OR id = 5);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 6, 'חנוכה', 'חנוכה', 'חנוכת המזבח - שמונת ימי החנוכה על הנס שעשה הקב"ה לאבותינו בימים ההם.', 'כסלו', 'כ''ה בכסלו-ב'' בטבת', 6, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'חנוכה' OR id = 6);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 7, 'טו-בשבט', 'ט"ו בשבט', 'ראש השנה לאילנות - ט"ו בשבט.', 'שבט', 'ט''ו בשבט', 7, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'טו-בשבט' OR id = 7);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 8, 'פורים', 'פורים', 'יום הפורים - קריאת מגילת אסתר ומשלוח מנות.', 'אדר', 'י''ד באדר', 8, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'פורים' OR id = 8);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 9, 'פסח', 'פסח', 'חג הפסח - זמן חירותנו, חג המצות. ההפטרות מובאות למנהגי הספרדים האשכנזים והתימנים.', 'ניסן', 'ט''ו-כ''א בניסן', 9, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'פסח' OR id = 9);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 10, 'יום-העצמאות', 'יום העצמאות', 'יום העצמאות - ה'' באייר, יום הכרזת מדינת ישראל.', 'אייר', 'ה'' באייר', 10, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'יום-העצמאות' OR id = 10);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 11, 'לג-בעומר', 'ל"ג בעומר', 'ל"ג בעומר - יום ההילולא של רבי שמעון בר יוחאי.', 'אייר', 'י''ח באייר', 11, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'לג-בעומר' OR id = 11);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 12, 'שבועות', 'שבועות', 'חג השבועות - זמן מתן תורתנו. נהוג לקרוא את מגילת רות.', 'סיון', 'ו''-ז'' בסיון', 12, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'שבועות' OR id = 12);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 13, 'שבעה-עשר-בתמוז', 'שבעה עשר בתמוז', 'צום שבעה עשר בתמוז - יום הקרעה בחומות ירושלים, פתיחת שלושת השבועות.', 'תמוז', 'י''ז בתמוז', 13, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'שבעה-עשר-בתמוז' OR id = 13);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 14, 'תשעה-באב', 'תשעה באב', 'תשעה באב - יום האבל הלאומי על חורבן הבית. נהוג לקרוא את מגילת איכה ואת הקינות.', 'אב', 'ט'' באב', 14, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'תשעה-באב' OR id = 14);

-- ---------------------------------------------------------------------------
-- Sections: seeded only while the moed has no curated sections, so admin edits
-- are never overwritten by a redeploy.
-- ---------------------------------------------------------------------------

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 101 AS id, 1 AS moed_id, 'הפטרת יום א''' AS label, 1 AS position UNION ALL
               SELECT 102, 1, 'הפטרת יום ב''', 2) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 1);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 201 AS id, 2 AS moed_id, 'הפטרת מנחה - אשכנזים' AS label, 1 AS position) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 2);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 301 AS id, 3 AS moed_id, 'הפטרת שחרית' AS label, 1 AS position UNION ALL
               SELECT 302, 3, 'הפטרת מנחה', 2) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 3);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 401 AS id, 4 AS moed_id, 'הפטרת יום א'' - ספרדים ואשכנזים' AS label, 1 AS position UNION ALL
               SELECT 402, 4, 'הפטרת יום א'' - תימנים', 2 UNION ALL
               SELECT 403, 4, 'הפטרת שבת חול המועד - ספרדים ואשכנזים', 3 UNION ALL
               SELECT 404, 4, 'הפטרת שבת חול המועד - תימנים', 4) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 4);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 601 AS id, 6 AS moed_id, 'הפטרת שבת חנוכה א''' AS label, 1 AS position UNION ALL
               SELECT 602, 6, 'הפטרת שבת חנוכה ב''', 2) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 6);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 801 AS id, 8 AS moed_id, 'מגילת אסתר' AS label, 1 AS position) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 8);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 901 AS id, 9 AS moed_id, 'הפטרת יום א'' - אשכנזים' AS label, 1 AS position UNION ALL
               SELECT 902, 9, 'הפטרת יום א'' - ספרדים ותימנים', 2 UNION ALL
               SELECT 903, 9, 'הפטרת שבת חול המועד - ספרדים ואשכנזים', 3 UNION ALL
               SELECT 904, 9, 'הפטרת שבת חול המועד - תימנים', 4 UNION ALL
               SELECT 905, 9, 'הפטרת שביעי של פסח', 5) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 9);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 1001 AS id, 10 AS moed_id, 'הפטרה' AS label, 1 AS position) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 10);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 1201 AS id, 12 AS moed_id, 'מגילת רות' AS label, 1 AS position UNION ALL
               SELECT 1202, 12, 'הפטרה', 2) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 12);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 1301 AS id, 13 AS moed_id, 'הפטרת מנחה - אשכנזים' AS label, 1 AS position) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 13);

INSERT INTO tanah_moed_section (id, moed_id, label, position)
SELECT * FROM (SELECT 1401 AS id, 14 AS moed_id, 'מגילת איכה' AS label, 1 AS position UNION ALL
               SELECT 1402, 14, 'הפטרת שחרית - ספרדים ואשכנזים', 2 UNION ALL
               SELECT 1403, 14, 'הפטרת שחרית - תימנים', 3 UNION ALL
               SELECT 1404, 14, 'הפטרת מנחה - ספרדים ותימנים', 4 UNION ALL
               SELECT 1405, 14, 'הפטרת מנחה - אשכנזים', 5) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_section WHERE moed_id = 14);

-- ---------------------------------------------------------------------------
-- Ranges: seeded only while the moed has no curated ranges.
-- ---------------------------------------------------------------------------

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 1011 AS id, 101 AS section_id, 1 AS position, 233 AS perek_id_start, 1 AS pasuk_start, 234 AS perek_id_end, 10 AS pasuk_end UNION ALL
               SELECT 1021, 102, 1, 431, 1, 431, 19) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 1);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 2011 AS id, 201 AS section_id, 1 AS position, 389 AS perek_id_start, 6 AS pasuk_start, 390 AS perek_id_end, 8 AS pasuk_end) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 2);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 3011 AS id, 301 AS section_id, 1 AS position, 391 AS perek_id_start, 14 AS pasuk_start, 392 AS perek_id_end, 14 AS pasuk_end UNION ALL
               SELECT 3021, 302, 1, 529, 1, 532, 11 UNION ALL
               SELECT 3022, 302, 2, 539, 18, 539, 20) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 3);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 4011 AS id, 401 AS section_id, 1 AS position, 564 AS perek_id_start, 1 AS pasuk_start, 564 AS perek_id_end, 21 AS pasuk_end UNION ALL
               SELECT 4021, 402, 1, 563, 9, 564, 21 UNION ALL
               SELECT 4031, 403, 1, 490, 18, 491, 16 UNION ALL
               SELECT 4041, 404, 1, 490, 1, 490, 23) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 4);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 6011 AS id, 601 AS section_id, 1 AS position, 552 AS perek_id_start, 14 AS pasuk_start, 554 AS perek_id_end, 7 AS pasuk_end UNION ALL
               SELECT 6021, 602, 1, 294, 40, 294, 50) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 6);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 8011 AS id, 801 AS section_id, 1 AS position, 820 AS perek_id_start, 1 AS pasuk_start, 829 AS perek_id_end, 3 AS pasuk_end) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 8);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 9011 AS id, 901 AS section_id, 1 AS position, 192 AS perek_id_start, 2 AS pasuk_start, 193 AS perek_id_end, 1 AS pasuk_end UNION ALL
               SELECT 9021, 902, 1, 192, 2, 193, 1 UNION ALL
               SELECT 9022, 902, 2, 193, 27, 193, 27 UNION ALL
               SELECT 9031, 903, 1, 489, 1, 489, 14 UNION ALL
               SELECT 9041, 904, 1, 488, 37, 489, 14 UNION ALL
               SELECT 9051, 905, 1, 285, 1, 285, 51) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 9);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 10011 AS id, 1001 AS section_id, 1 AS position, 344 AS perek_id_start, 32 AS pasuk_start, 346 AS perek_id_end, 6 AS pasuk_end) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 10);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 12011 AS id, 1201 AS section_id, 1 AS position, 799 AS perek_id_start, 1 AS pasuk_start, 802 AS perek_id_end, 22 AS pasuk_end UNION ALL
               SELECT 12021, 1202, 1, 453, 1, 453, 28 UNION ALL
               SELECT 12022, 1202, 2, 455, 12, 455, 12) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 12);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 13011 AS id, 1301 AS section_id, 1 AS position, 389 AS perek_id_start, 6 AS pasuk_start, 390 AS perek_id_end, 8 AS pasuk_end) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 13);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 14011 AS id, 1401 AS section_id, 1 AS position, 803 AS perek_id_start, 1 AS pasuk_start, 807 AS perek_id_end, 22 AS pasuk_end UNION ALL
               SELECT 14021, 1402, 1, 408, 13, 409, 23 UNION ALL
               SELECT 14031, 1403, 1, 406, 16, 406, 17 UNION ALL
               SELECT 14032, 1403, 2, 408, 13, 409, 23 UNION ALL
               SELECT 14041, 1404, 1, 514, 2, 514, 10 UNION ALL
               SELECT 14042, 1404, 2, 539, 18, 539, 20 UNION ALL
               SELECT 14051, 1405, 1, 389, 6, 390, 8) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 14);

-- ---------------------------------------------------------------------------
-- Initial article links named by the issue: resolved through the moed slug
-- (stable identity) and skipped silently when the article id is absent (e.g.
-- a test database), so the same file is safe on every environment.
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO tanah_article_moed (article_id, moed_id)
SELECT a.id, m.id FROM tanah_moed m JOIN tanah_article a ON a.id = 2199
WHERE m.slug = 'תשעה-באב';

INSERT IGNORE INTO tanah_article_moed (article_id, moed_id)
SELECT a.id, m.id FROM tanah_moed m JOIN tanah_article a ON a.id = 2860
WHERE m.slug = 'יום-העצמאות';

-- ---------------------------------------------------------------------------
-- Editorial corrections (#3160): the owner asked to drop the conditional
-- haftarah wording from יום העצמאות. The insert-if-absent seed cannot fix
-- rows that already exist, so these UPDATEs carry the correction to them.
-- Both are guarded by the stale text still being there — they only rewrite
-- rows that never received the correction, stay a no-op on every redeploy,
-- and never overwrite a later admin edit (a rewritten summary or label no
-- longer matches the guard). Rows are matched by the moed slug, the stable
-- identity, never by seed ids.
-- ---------------------------------------------------------------------------

UPDATE tanah_moed
SET summary = REPLACE(summary, ' ההפטרה נקבעה מנהג בחלק מהשנים בלבד.', '')
WHERE slug = 'יום-העצמאות'
  AND summary LIKE '%ההפטרה נקבעה מנהג בחלק מהשנים בלבד%';

UPDATE tanah_moed_section s
JOIN tanah_moed m ON m.id = s.moed_id
SET s.label = 'הפטרה'
WHERE m.slug = 'יום-העצמאות'
  AND s.label = 'הפטרה - כאשר נהוג לקרוא';

-- ---------------------------------------------------------------------------
-- Catalogue update (#3254): three new published moadim, two retirements,
-- the Israel date for שמיני עצרת ושמחת תורה, and the missing Torah and
-- maftir and historical reading sections.
--
-- Every statement is guarded and repeat-safe: UPDATEs only fire while the
-- old seeded value is still present, section inserts only fire while the
-- labelled section is absent, and range inserts only fire while the
-- labelled section has no ranges. Editorial edits made through the admin
-- after these statements have run are never rewritten by a redeploy.
--
-- Annual ordering follows the Hebrew year including unpublished rows, so a
-- retired moed that is ever republished lands back in its dated slot.
-- ---------------------------------------------------------------------------

-- The Israel date for שמיני עצרת ושמחת תורה is כב תשרי alone.
UPDATE tanah_moed
SET date_label = 'כ''ב בתשרי'
WHERE slug = 'שמיני-עצרת-ושמחת-תורה'
  AND date_label = 'כ''ב-כ''ג בתשרי';

-- Retire לג בעומר and טו בשבט from the published catalogue. The rows and
-- their sections stay in place as the unpublished archive.
UPDATE tanah_moed SET published = FALSE WHERE slug = 'לג-בעומר' AND published = TRUE;
UPDATE tanah_moed SET published = FALSE WHERE slug = 'טו-בשבט' AND published = TRUE;

-- Annual order shifts, descending so the unique annual_order key never
-- sees a transient duplicate. Every UPDATE is guarded by the old seeded
-- order still being present.
UPDATE tanah_moed SET annual_order = 16 WHERE slug = 'תשעה-באב' AND annual_order = 14;
UPDATE tanah_moed SET annual_order = 15 WHERE slug = 'שבעה-עשר-בתמוז' AND annual_order = 13;
UPDATE tanah_moed SET annual_order = 14 WHERE slug = 'שבועות' AND annual_order = 12;
UPDATE tanah_moed SET annual_order = 12 WHERE slug = 'לג-בעומר' AND annual_order = 11;
UPDATE tanah_moed SET annual_order = 11 WHERE slug = 'יום-העצמאות' AND annual_order = 10;
UPDATE tanah_moed SET annual_order = 10 WHERE slug = 'פסח' AND annual_order = 9;
UPDATE tanah_moed SET annual_order = 9 WHERE slug = 'פורים' AND annual_order = 8;
UPDATE tanah_moed SET annual_order = 8 WHERE slug = 'טו-בשבט' AND annual_order = 7;

-- The three new published moadim, slotted into their dated positions.
INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 15, 'עשרה-בטבת', 'עשרה בטבת', 'צום עשרה בטבת - יום תחילת המצור על ירושלים בימי בית ראשון, אחד מארבעת הצומות על החורבן.', 'טבת', 'י'' בטבת', 7, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'עשרה-בטבת' OR id = 15);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 16, 'יום-ירושלים', 'יום ירושלים', 'יום ירושלים - כ''ח באייר, יום שחרור ירושלים ואיחודה במלחמת ששת הימים.', 'אייר', 'כ''ח באייר', 13, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'יום-ירושלים' OR id = 16);

INSERT INTO tanah_moed (id, slug, name, summary, hebrew_month, date_label, annual_order, published)
SELECT 17, 'טו-באב', 'ט"ו באב', 'ט"ו באב - יום טוב לישראל בימי המשנה, חג האהבה והשידוכים בכרמים.', 'אב', 'ט''ו באב', 17, TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed WHERE slug = 'טו-באב' OR id = 17);

-- Section reordering: the seeded haftarah and megillah sections move to
-- their place after the new Torah sections, keeping the ceremony order.
-- Each UPDATE is guarded by slug and label and the old position, so the
-- block stays a no-op on redeploy and after any later admin reorder.
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 4 WHERE m.slug = 'ראש-השנה' AND s.label = 'הפטרת יום ב''' AND s.position = 2;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 2 WHERE m.slug = 'ראש-השנה' AND s.label = 'הפטרת יום א''' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 2 WHERE m.slug = 'צום-גדליה' AND s.label = 'הפטרת מנחה - אשכנזים' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 4 WHERE m.slug = 'יום-כיפור' AND s.label = 'הפטרת מנחה' AND s.position = 2;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 2 WHERE m.slug = 'יום-כיפור' AND s.label = 'הפטרת שחרית' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 6 WHERE m.slug = 'סוכות' AND s.label = 'הפטרת שבת חול המועד - תימנים' AND s.position = 4;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 5 WHERE m.slug = 'סוכות' AND s.label = 'הפטרת שבת חול המועד - ספרדים ואשכנזים' AND s.position = 3;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 3 WHERE m.slug = 'סוכות' AND s.label = 'הפטרת יום א'' - תימנים' AND s.position = 2;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 2 WHERE m.slug = 'סוכות' AND s.label = 'הפטרת יום א'' - ספרדים ואשכנזים' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 10 WHERE m.slug = 'חנוכה' AND s.label = 'הפטרת שבת חנוכה ב''' AND s.position = 2;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 9 WHERE m.slug = 'חנוכה' AND s.label = 'הפטרת שבת חנוכה א''' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 2 WHERE m.slug = 'פורים' AND s.label = 'מגילת אסתר' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 8 WHERE m.slug = 'פסח' AND s.label = 'הפטרת שביעי של פסח' AND s.position = 5;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 6 WHERE m.slug = 'פסח' AND s.label = 'הפטרת שבת חול המועד - תימנים' AND s.position = 4;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 5 WHERE m.slug = 'פסח' AND s.label = 'הפטרת שבת חול המועד - ספרדים ואשכנזים' AND s.position = 3;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 3 WHERE m.slug = 'פסח' AND s.label = 'הפטרת יום א'' - ספרדים ותימנים' AND s.position = 2;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 2 WHERE m.slug = 'פסח' AND s.label = 'הפטרת יום א'' - אשכנזים' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 3 WHERE m.slug = 'שבועות' AND s.label = 'מגילת רות' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 2 WHERE m.slug = 'שבעה-עשר-בתמוז' AND s.label = 'הפטרת מנחה - אשכנזים' AND s.position = 1;

UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 6 WHERE m.slug = 'תשעה-באב' AND s.label = 'הפטרת מנחה - אשכנזים' AND s.position = 5;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 5 WHERE m.slug = 'תשעה-באב' AND s.label = 'הפטרת מנחה - ספרדים ותימנים' AND s.position = 4;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 4 WHERE m.slug = 'תשעה-באב' AND s.label = 'הפטרת שחרית - תימנים' AND s.position = 3;
UPDATE tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
SET s.position = 3 WHERE m.slug = 'תשעה-באב' AND s.label = 'הפטרת שחרית - ספרדים ואשכנזים' AND s.position = 2;

-- New sections: one guarded insert per labelled section. The position guard
-- keeps redeploys idempotent and never rewrites an admin-renamed section.
-- A renamed section still occupies its (moed_id, position) slot, so guarding
-- on label would reinsert the old label and collide with
-- uk_moed_section_position — guarding on position skips instead.
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה ומפטיר - יום א''', 1 FROM tanah_moed m
WHERE m.slug = 'ראש-השנה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה ומפטיר - יום ב''', 3 FROM tanah_moed m
WHERE m.slug = 'ראש-השנה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 3);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - ויחל (שחרית ומנחה)', 1 FROM tanah_moed m
WHERE m.slug = 'צום-גדליה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'סיפור הרצח - ירמיהו מ-מא', 3 FROM tanah_moed m
WHERE m.slug = 'צום-גדליה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 3);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה ומפטיר - שחרית', 1 FROM tanah_moed m
WHERE m.slug = 'יום-כיפור'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - מנחה', 3 FROM tanah_moed m
WHERE m.slug = 'יום-כיפור'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 3);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה ומפטיר - יום א''', 1 FROM tanah_moed m
WHERE m.slug = 'סוכות'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - שבת חול המועד', 4 FROM tanah_moed m
WHERE m.slug = 'סוכות'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 4);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - הושענא רבה', 7 FROM tanah_moed m
WHERE m.slug = 'סוכות'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 7);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - וזאת הברכה ובראשית', 1 FROM tanah_moed m
WHERE m.slug = 'שמיני-עצרת-ושמחת-תורה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'מפטיר', 2 FROM tanah_moed m
WHERE m.slug = 'שמיני-עצרת-ושמחת-תורה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 2);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'הפטרה', 3 FROM tanah_moed m
WHERE m.slug = 'שמיני-עצרת-ושמחת-תורה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 3);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - יום א''', 1 FROM tanah_moed m
WHERE m.slug = 'חנוכה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - יום ב''', 2 FROM tanah_moed m
WHERE m.slug = 'חנוכה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 2);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - יום ג''', 3 FROM tanah_moed m
WHERE m.slug = 'חנוכה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 3);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - יום ד''', 4 FROM tanah_moed m
WHERE m.slug = 'חנוכה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 4);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - יום ה''', 5 FROM tanah_moed m
WHERE m.slug = 'חנוכה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 5);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - יום ו''', 6 FROM tanah_moed m
WHERE m.slug = 'חנוכה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 6);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - יום ז''', 7 FROM tanah_moed m
WHERE m.slug = 'חנוכה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 7);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - יום ח''', 8 FROM tanah_moed m
WHERE m.slug = 'חנוכה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 8);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - ויבא עמלק', 1 FROM tanah_moed m
WHERE m.slug = 'פורים'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה ומפטיר - יום א''', 1 FROM tanah_moed m
WHERE m.slug = 'פסח'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה ומפטיר - שבת חול המועד', 4 FROM tanah_moed m
WHERE m.slug = 'פסח'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 4);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה ומפטיר - שביעי של פסח', 7 FROM tanah_moed m
WHERE m.slug = 'פסח'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 7);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה ומפטיר', 1 FROM tanah_moed m
WHERE m.slug = 'שבועות'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - ויחל (שחרית ומנחה)', 1 FROM tanah_moed m
WHERE m.slug = 'שבעה-עשר-בתמוז'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'הקשר היסטורי - מלכים ב כה', 3 FROM tanah_moed m
WHERE m.slug = 'שבעה-עשר-בתמוז'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 3);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - כי תוליד', 2 FROM tanah_moed m
WHERE m.slug = 'תשעה-באב'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 2);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'קריאת התורה - ויחל (שחרית ומנחה)', 1 FROM tanah_moed m
WHERE m.slug = 'עשרה-בטבת'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'הפטרת מנחה - אשכנזים', 2 FROM tanah_moed m
WHERE m.slug = 'עשרה-בטבת'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 2);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'הקשר היסטורי', 3 FROM tanah_moed m
WHERE m.slug = 'עשרה-בטבת'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 3);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'תהלים קכב - שמחתי באומרים לי', 1 FROM tanah_moed m
WHERE m.slug = 'יום-ירושלים'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'ישעיהו סב - למען ציון', 2 FROM tanah_moed m
WHERE m.slug = 'יום-ירושלים'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 2);

INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'שופטים כא - בנות שילה', 1 FROM tanah_moed m
WHERE m.slug = 'טו-באב'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 1);
INSERT INTO tanah_moed_section (moed_id, label, position)
SELECT m.id, 'משלי לא - שקר החן', 2 FROM tanah_moed m
WHERE m.slug = 'טו-באב'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_section s WHERE s.moed_id = m.id AND s.position = 2);

-- New ranges: each insert targets its section by slug and label and only
-- fires while that section has no ranges at all, so curated range edits
-- are never duplicated or overwritten.
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 21 AS ps, 1 AS vs, 21 AS pe, 34 AS ve UNION ALL
      SELECT 2, 146, 1, 146, 6) seed ON TRUE
WHERE m.slug = 'ראש-השנה' AND s.label = 'קריאת התורה ומפטיר - יום א'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 22 AS ps, 1 AS vs, 22 AS pe, 24 AS ve UNION ALL
      SELECT 2, 146, 1, 146, 6) seed ON TRUE
WHERE m.slug = 'ראש-השנה' AND s.label = 'קריאת התורה ומפטיר - יום ב'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 82 AS ps, 11 AS vs, 82 AS pe, 14 AS ve UNION ALL
      SELECT 2, 84, 1, 84, 10) seed ON TRUE
WHERE m.slug = 'צום-גדליה' AND s.label = 'קריאת התורה - ויחל (שחרית ומנחה)'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 440, 1, 441, 18
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'צום-גדליה' AND s.label = 'סיפור הרצח - ירמיהו מ-מא'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 106 AS ps, 1 AS vs, 106 AS pe, 34 AS ve UNION ALL
      SELECT 2, 146, 7, 146, 11) seed ON TRUE
WHERE m.slug = 'יום-כיפור' AND s.label = 'קריאת התורה ומפטיר - שחרית'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 108, 1, 108, 30
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'יום-כיפור' AND s.label = 'קריאת התורה - מנחה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 112 AS ps, 26 AS vs, 113 AS pe, 44 AS ve UNION ALL
      SELECT 2, 146, 12, 146, 16) seed ON TRUE
WHERE m.slug = 'סוכות' AND s.label = 'קריאת התורה ומפטיר - יום א'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 83, 12, 84, 15
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'סוכות' AND s.label = 'קריאת התורה - שבת חול המועד'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 146, 26, 146, 31
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'סוכות' AND s.label = 'קריאת התורה - הושענא רבה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 186 AS ps, 1 AS vs, 187 AS pe, 12 AS ve UNION ALL
      SELECT 2, 1, 1, 2, 3) seed ON TRUE
WHERE m.slug = 'שמיני-עצרת-ושמחת-תורה' AND s.label = 'קריאת התורה - וזאת הברכה ובראשית'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 146, 35, 147, 1
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'שמיני-עצרת-ושמחת-תורה' AND s.label = 'מפטיר'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 188, 1, 188, 18
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'שמיני-עצרת-ושמחת-תורה' AND s.label = 'הפטרה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 124, 1, 124, 23
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'חנוכה' AND s.label = 'קריאת התורה - יום א'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 124, 24, 124, 35
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'חנוכה' AND s.label = 'קריאת התורה - יום ב'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 124, 36, 124, 47
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'חנוכה' AND s.label = 'קריאת התורה - יום ג'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 124, 48, 124, 59
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'חנוכה' AND s.label = 'קריאת התורה - יום ד'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 124, 60, 124, 71
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'חנוכה' AND s.label = 'קריאת התורה - יום ה'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 124, 72, 124, 83
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'חנוכה' AND s.label = 'קריאת התורה - יום ו'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 124, 84, 124, 89
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'חנוכה' AND s.label = 'קריאת התורה - יום ז'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 125, 1, 125, 4
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'חנוכה' AND s.label = 'קריאת התורה - יום ח'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 67, 8, 67, 16
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'פורים' AND s.label = 'קריאת התורה - ויבא עמלק'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 62 AS ps, 21 AS vs, 62 AS pe, 51 AS ve UNION ALL
      SELECT 2, 145, 16, 145, 25) seed ON TRUE
WHERE m.slug = 'פסח' AND s.label = 'קריאת התורה ומפטיר - יום א'''
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 83 AS ps, 12 AS vs, 84 AS pe, 26 AS ve UNION ALL
      SELECT 2, 145, 19, 145, 25) seed ON TRUE
WHERE m.slug = 'פסח' AND s.label = 'קריאת התורה ומפטיר - שבת חול המועד'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 63 AS ps, 17 AS vs, 65 AS pe, 26 AS ve UNION ALL
      SELECT 2, 145, 19, 145, 25) seed ON TRUE
WHERE m.slug = 'פסח' AND s.label = 'קריאת התורה ומפטיר - שביעי של פסח'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 69 AS ps, 1 AS vs, 70 AS pe, 23 AS ve UNION ALL
      SELECT 2, 145, 26, 145, 31) seed ON TRUE
WHERE m.slug = 'שבועות' AND s.label = 'קריאת התורה ומפטיר'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 82 AS ps, 11 AS vs, 82 AS pe, 14 AS ve UNION ALL
      SELECT 2, 84, 1, 84, 10) seed ON TRUE
WHERE m.slug = 'שבעה-עשר-בתמוז' AND s.label = 'קריאת התורה - ויחל (שחרית ומנחה)'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 334, 3, 334, 9
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'שבעה-עשר-בתמוז' AND s.label = 'הקשר היסטורי - מלכים ב כה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 157, 25, 157, 40
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'תשעה-באב' AND s.label = 'קריאת התורה - כי תוליד'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 82 AS ps, 11 AS vs, 82 AS pe, 14 AS ve UNION ALL
      SELECT 2, 84, 1, 84, 10) seed ON TRUE
WHERE m.slug = 'עשרה-בטבת' AND s.label = 'קריאת התורה - ויחל (שחרית ומנחה)'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 389, 6, 390, 8
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'עשרה-בטבת' AND s.label = 'הפטרת מנחה - אשכנזים'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, seed.position, seed.ps, seed.vs, seed.pe, seed.ve
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
JOIN (SELECT 1 AS position, 334 AS ps, 1 AS vs, 334 AS pe, 3 AS ve UNION ALL
      SELECT 2, 476, 1, 476, 2) seed ON TRUE
WHERE m.slug = 'עשרה-בטבת' AND s.label = 'הקשר היסטורי'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 689, 1, 689, 9
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'יום-ירושלים' AND s.label = 'תהלים קכב - שמחתי באומרים לי'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 396, 1, 396, 7
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'יום-ירושלים' AND s.label = 'ישעיהו סב - למען ציון'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);

INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 232, 15, 232, 25
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'טו-באב' AND s.label = 'שופטים כא - בנות שילה'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
INSERT INTO tanah_moed_range (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT s.id, 1, 748, 30, 748, 30
FROM tanah_moed_section s JOIN tanah_moed m ON m.id = s.moed_id
WHERE m.slug = 'טו-באב' AND s.label = 'משלי לא - שקר החן'
AND NOT EXISTS (SELECT 1 FROM tanah_moed_range r WHERE r.section_id = s.id);
