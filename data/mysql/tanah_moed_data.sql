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
SELECT 5, 'שמיני-עצרת-ושמחת-תורה', 'שמיני עצרת ושמחת תורה', 'שמיני עצרת ושמחת תורה - סיום הקריאה והתחלתה מחדש.', 'תשרי', 'כ''ב-כ''ג בתשרי', 5, TRUE FROM DUAL
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
SELECT 10, 'יום-העצמאות', 'יום העצמאות', 'יום העצמאות - ה'' באייר, יום הכרזת מדינת ישראל. ההפטרה נקבעה מנהג בחלק מהשנים בלבד.', 'אייר', 'ה'' באייר', 10, TRUE FROM DUAL
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
SELECT * FROM (SELECT 1001 AS id, 10 AS moed_id, 'הפטרה - כאשר נהוג לקרוא' AS label, 1 AS position) seed
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
SELECT * FROM (SELECT 1011 AS id, 101 AS section_id, 1 AS position, 233 AS perek_id_start, 1 AS pasuk_start, 234 AS perek_id_end, 10 AS pasuk_end) seed
WHERE NOT EXISTS (SELECT 1 FROM tanah_moed_range r JOIN tanah_moed_section s ON s.id = r.section_id WHERE s.moed_id = 1);

INSERT INTO tanah_moed_range (id, section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
SELECT * FROM (SELECT 1021 AS id, 102 AS section_id, 1 AS position, 431 AS perek_id_start, 1 AS pasuk_start, 431 AS perek_id_end, 19 AS pasuk_end) seed
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
