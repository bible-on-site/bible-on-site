-- External authority references emitted as JSON-LD sameAs (issue 1840).
-- subject_id holds a Tanahpedia entity UUID, a parshan id or a Tanah author
-- id as text. Additive and repeat-safe: IF NOT EXISTS keeps the deploy
-- Lambda from injecting a DROP before the statement.

CREATE TABLE IF NOT EXISTS `external_reference` (
    `subject_kind` enum('TANAHPEDIA_ENTITY', 'PARSHAN', 'TANAH_AUTHOR') NOT NULL,
    `subject_id` varchar(36) NOT NULL,
    `source` enum('WIKIDATA', 'WIKIPEDIA_HE', 'WIKIPEDIA_EN', 'SEFARIA', 'OFFICIAL') NOT NULL,
    `url` varchar(1024) NOT NULL,
    PRIMARY KEY (`subject_kind`, `subject_id`, `source`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
