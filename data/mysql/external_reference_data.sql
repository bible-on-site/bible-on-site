-- Curated JSON-LD sameAs authority links for issue 1840.
--
-- Verification: every Wikidata item was resolved from its Hebrew Wikipedia
-- title through the Wikidata API and checked to be a human or a biblical
-- figure. The Wikipedia links are the he and en sitelinks of that item. A Sefaria
-- topic link is kept only when the Sefaria topic points at the same
-- Wikipedia article.
--
--   אברהם = Q9181 (Abraham)
--   שרה = Q194808 (Sarah)
--   יצחק = Q671872 (Isaac)
--   רבקה = Q40520 (Rebecca)
--   יעקב = Q289957 (Jacob)
--   רחל = Q207389 (Rachel)
--   לאה = Q128847 (Leah)
--   רש"י = Q26456 (Rashi)
--   רמב"ן = Q355455 (Nahmanides)
--   אבן עזרא = Q270670 (Abraham ibn Ezra)
--   רד"ק = Q733619 (David Kimhi)
--   ספורנו = Q1195977 (Obadiah ben Jacob Sforno)
--   מלבי"ם = Q1391091 (Malbim)
--   רלב"ג = Q353633 (Gersonides)
--   אברבנאל = Q319902 (Isaac Abrabanel)
--   חיים בן עטר = Q982046 (Chaim ibn Attar)
--   רשב"ם = Q722697 (Rashbam)
--   אונקלוס = Q2533433 (Onkelos)
--   אליהו בן שלומו זלמן מווילנה = Q279359 (Gaon of Vilnius)
--   אלשיך = Q786391 (Moshe Alshich)
--   נפתלי צבי יהודה ברלין = Q1861531 (Naftali Zvi Yehuda Berlin)
--   יונתן בן עוזיאל = Q1400104 (Jonathan ben Uzziel)
--
-- TANAH_AUTHOR rows are intentionally absent. Authors are living rabbis and
-- get links only after a review confirms an established public presence.
--
-- Parshan ids are regenerated in first-seen order by every perushim data
-- deploy, so this file owns the PARSHAN rows and rebuilds them by parshan
-- name each run (gershayim normalized to an ASCII double quote).
-- Tanahpedia entity ids are stable, so entity rows are upserted by a unique
-- PERSON name and never deleted. A missing or ambiguous name is skipped.
--
-- Comment lines stay free of semicolons and apostrophes for the deploy
-- Lambda statement splitter.

DELETE FROM external_reference WHERE subject_kind = 'PARSHAN';

INSERT INTO external_reference (subject_kind, subject_id, source, url)
SELECT 'PARSHAN', CAST(p.id AS CHAR), r.source, r.url
FROM (
    SELECT 'רש"י' AS name, 'WIKIDATA' AS source, 'https://www.wikidata.org/wiki/Q26456' AS url
    UNION ALL
    SELECT 'רש"י', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A8%D7%A9%22%D7%99'
    UNION ALL
    SELECT 'רש"י', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Rashi'
    UNION ALL
    SELECT 'רש"י', 'SEFARIA', 'https://www.sefaria.org/topics/rashi'
    UNION ALL
    SELECT 'רמב"ן', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q355455'
    UNION ALL
    SELECT 'רמב"ן', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A8%D7%9E%D7%91%22%D7%9F'
    UNION ALL
    SELECT 'רמב"ן', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Nachmanides'
    UNION ALL
    SELECT 'רמב"ן', 'SEFARIA', 'https://www.sefaria.org/topics/ramban'
    UNION ALL
    SELECT 'אבן עזרא', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q270670'
    UNION ALL
    SELECT 'אבן עזרא', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%90%D7%91%D7%A8%D7%94%D7%9D_%D7%90%D7%91%D7%9F_%D7%A2%D7%96%D7%A8%D7%90'
    UNION ALL
    SELECT 'אבן עזרא', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Abraham_ibn_Ezra'
    UNION ALL
    SELECT 'אבן עזרא', 'SEFARIA', 'https://www.sefaria.org/topics/ibn-ezra'
    UNION ALL
    SELECT 'רד"ק', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q733619'
    UNION ALL
    SELECT 'רד"ק', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A8%D7%93%22%D7%A7'
    UNION ALL
    SELECT 'רד"ק', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/David_Kimhi'
    UNION ALL
    SELECT 'רד"ק', 'SEFARIA', 'https://www.sefaria.org/topics/radak'
    UNION ALL
    SELECT 'ספורנו', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q1195977'
    UNION ALL
    SELECT 'ספורנו', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%94_%D7%A1%D7%A4%D7%95%D7%A8%D7%A0%D7%95'
    UNION ALL
    SELECT 'ספורנו', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Obadiah_ben_Jacob_Sforno'
    UNION ALL
    SELECT 'מלבי"ם', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q1391091'
    UNION ALL
    SELECT 'מלבי"ם', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%9E%D7%9C%D7%91%D7%99%22%D7%9D'
    UNION ALL
    SELECT 'מלבי"ם', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Malbim'
    UNION ALL
    SELECT 'מלבי"ם', 'SEFARIA', 'https://www.sefaria.org/topics/malbim'
    UNION ALL
    SELECT 'רלב"ג', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q353633'
    UNION ALL
    SELECT 'רלב"ג', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A8%D7%9C%D7%91%22%D7%92'
    UNION ALL
    SELECT 'רלב"ג', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Gersonides'
    UNION ALL
    SELECT 'רלב"ג', 'SEFARIA', 'https://www.sefaria.org/topics/ralbag'
    UNION ALL
    SELECT 'אברבנאל', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q319902'
    UNION ALL
    SELECT 'אברבנאל', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%99%D7%A6%D7%97%D7%A7_%D7%90%D7%91%D7%A8%D7%91%D7%A0%D7%90%D7%9C'
    UNION ALL
    SELECT 'אברבנאל', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Isaac_Abarbanel'
    UNION ALL
    SELECT 'אברבנאל', 'SEFARIA', 'https://www.sefaria.org/topics/isaac-abarbanel'
    UNION ALL
    SELECT 'חיים בן עטר', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q982046'
    UNION ALL
    SELECT 'חיים בן עטר', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%97%D7%99%D7%99%D7%9D_%D7%91%D7%9F_%D7%A2%D7%98%D7%A8'
    UNION ALL
    SELECT 'חיים בן עטר', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Chaim_ibn_Attar'
    UNION ALL
    SELECT 'חיים בן עטר', 'SEFARIA', 'https://www.sefaria.org/topics/chaim-ibn-attar'
    UNION ALL
    SELECT 'רשב"ם', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q722697'
    UNION ALL
    SELECT 'רשב"ם', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A8%D7%A9%D7%91%22%D7%9D'
    UNION ALL
    SELECT 'רשב"ם', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Rashbam'
    UNION ALL
    SELECT 'רשב"ם', 'SEFARIA', 'https://www.sefaria.org/topics/rashbam'
    UNION ALL
    SELECT 'אונקלוס', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q2533433'
    UNION ALL
    SELECT 'אונקלוס', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%90%D7%95%D7%A0%D7%A7%D7%9C%D7%95%D7%A1'
    UNION ALL
    SELECT 'אונקלוס', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Onkelos'
    UNION ALL
    SELECT 'אונקלוס', 'SEFARIA', 'https://www.sefaria.org/topics/onkelos'
    UNION ALL
    SELECT 'אליהו בן שלומו זלמן מווילנה', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q279359'
    UNION ALL
    SELECT 'אליהו בן שלומו זלמן מווילנה', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%94%D7%92%D7%90%D7%95%D7%9F_%D7%9E%D7%95%D7%95%D7%99%D7%9C%D7%A0%D7%94'
    UNION ALL
    SELECT 'אליהו בן שלומו זלמן מווילנה', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Vilna_Gaon'
    UNION ALL
    SELECT 'אליהו בן שלומו זלמן מווילנה', 'SEFARIA', 'https://www.sefaria.org/topics/vilna-gaon'
    UNION ALL
    SELECT 'אלשיך', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q786391'
    UNION ALL
    SELECT 'אלשיך', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%9E%D7%A9%D7%94_%D7%90%D7%9C%D7%A9%D7%99%D7%9A'
    UNION ALL
    SELECT 'אלשיך', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Moshe_Alshich'
    UNION ALL
    SELECT 'אלשיך', 'SEFARIA', 'https://www.sefaria.org/topics/moses-alshikh'
    UNION ALL
    SELECT 'נפתלי צבי יהודה ברלין', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q1861531'
    UNION ALL
    SELECT 'נפתלי צבי יהודה ברלין', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A0%D7%A4%D7%AA%D7%9C%D7%99_%D7%A6%D7%91%D7%99_%D7%99%D7%94%D7%95%D7%93%D7%94_%D7%91%D7%A8%D7%9C%D7%99%D7%9F'
    UNION ALL
    SELECT 'נפתלי צבי יהודה ברלין', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Naftali_Zvi_Yehuda_Berlin'
    UNION ALL
    SELECT 'יונתן בן עוזיאל', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q1400104'
    UNION ALL
    SELECT 'יונתן בן עוזיאל', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%99%D7%95%D7%A0%D7%AA%D7%9F_%D7%91%D7%9F_%D7%A2%D7%95%D7%96%D7%99%D7%90%D7%9C'
    UNION ALL
    SELECT 'יונתן בן עוזיאל', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Jonathan_ben_Uzziel'
) AS r
JOIN parshan p ON REPLACE(p.name, '״', '"') = r.name;

INSERT INTO external_reference (subject_kind, subject_id, source, url)
SELECT 'TANAHPEDIA_ENTITY', e.id, r.source, r.url
FROM (
    SELECT 'אברהם' AS name, 'WIKIDATA' AS source, 'https://www.wikidata.org/wiki/Q9181' AS url
    UNION ALL
    SELECT 'אברהם', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%90%D7%91%D7%A8%D7%94%D7%9D'
    UNION ALL
    SELECT 'אברהם', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Abraham'
    UNION ALL
    SELECT 'אברהם', 'SEFARIA', 'https://www.sefaria.org/topics/abraham'
    UNION ALL
    SELECT 'שרה', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q194808'
    UNION ALL
    SELECT 'שרה', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A9%D7%A8%D7%94'
    UNION ALL
    SELECT 'שרה', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Sarah'
    UNION ALL
    SELECT 'שרה', 'SEFARIA', 'https://www.sefaria.org/topics/sarah'
    UNION ALL
    SELECT 'יצחק', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q671872'
    UNION ALL
    SELECT 'יצחק', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%99%D7%A6%D7%97%D7%A7'
    UNION ALL
    SELECT 'יצחק', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Isaac'
    UNION ALL
    SELECT 'יצחק', 'SEFARIA', 'https://www.sefaria.org/topics/isaac'
    UNION ALL
    SELECT 'רבקה', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q40520'
    UNION ALL
    SELECT 'רבקה', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A8%D7%91%D7%A7%D7%94'
    UNION ALL
    SELECT 'רבקה', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Rebecca_(biblical_figure)'
    UNION ALL
    SELECT 'רבקה', 'SEFARIA', 'https://www.sefaria.org/topics/rebecca'
    UNION ALL
    SELECT 'יעקב', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q289957'
    UNION ALL
    SELECT 'יעקב', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%99%D7%A2%D7%A7%D7%91'
    UNION ALL
    SELECT 'יעקב', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Jacob'
    UNION ALL
    SELECT 'יעקב', 'SEFARIA', 'https://www.sefaria.org/topics/jacob'
    UNION ALL
    SELECT 'רחל', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q207389'
    UNION ALL
    SELECT 'רחל', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%A8%D7%97%D7%9C'
    UNION ALL
    SELECT 'רחל', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Rachel'
    UNION ALL
    SELECT 'רחל', 'SEFARIA', 'https://www.sefaria.org/topics/rachel'
    UNION ALL
    SELECT 'לאה', 'WIKIDATA', 'https://www.wikidata.org/wiki/Q128847'
    UNION ALL
    SELECT 'לאה', 'WIKIPEDIA_HE', 'https://he.wikipedia.org/wiki/%D7%9C%D7%90%D7%94'
    UNION ALL
    SELECT 'לאה', 'WIKIPEDIA_EN', 'https://en.wikipedia.org/wiki/Leah'
    UNION ALL
    SELECT 'לאה', 'SEFARIA', 'https://www.sefaria.org/topics/leah'
) AS r
JOIN tanahpedia_entity e ON e.entity_type = 'PERSON' AND e.name = r.name
WHERE (
    SELECT COUNT(*) FROM tanahpedia_entity d
    WHERE d.entity_type = 'PERSON' AND d.name = r.name
) = 1
ON DUPLICATE KEY UPDATE url = r.url;
