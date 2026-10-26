-- Test fixtures for the mention-decoration pipeline (issue #2516).
--
-- ORDERING CONSTRAINT: this file must run AFTER the Tanahpedia seed chain
-- (tanahpedia_seed_data.sql + tanahpedia_legacy_migration.sql + family/place
-- data). The legacy migration is gated on `tanahpedia_entry` being empty — an
-- entry inserted before it (e.g. inside tanah_test_data.sql) makes the
-- populator skip the entire legacy seed. The db-populator therefore loads
-- this file only after apply_tanahpedia_full_seed completes, and only when
-- --skip-tanah-test-data is not set.
--
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
-- span_* are UTF-16 code-unit offsets; LOCATE/CHAR_LENGTH count characters,
-- which coincides for this BMP-only fixture content.
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
