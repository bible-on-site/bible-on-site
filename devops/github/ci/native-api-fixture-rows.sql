-- No production content: these rows exercise the final binary and SQLx driver.
INSERT INTO tanah_author (id, name, details) VALUES (1, 'Fixture author', 'Native image test');
INSERT INTO tanah_article (id, perek_id, author_id, abstract, name, priority, content, coverage_verified) VALUES
(1, 1, 1, NULL, 'Alpha orchard', 1, '<p>alpha orchard apple alpha</p>', TRUE),
(2, 1, 1, 'Omega fixture', 'Omega ocean', 1, '<p>omega ocean water omega</p>', FALSE),
(3, 1, 1, NULL, 'Gamma mountain', 1, '<p>gamma mountain stone gamma</p>', FALSE);
INSERT INTO tanah_article_covering_source VALUES (1, 1, 1, '2026-01-02 03:04:05');
INSERT INTO tanah_dedication (id, subject, expires_at) VALUES (1, 'Ongoing fixture', NULL), (2, 'Expiring fixture', '2099-01-02 03:04:05');
INSERT INTO tanah_dedication_type VALUES (1, 'Fixture purpose');
INSERT INTO tanah_dedication_dedication_type VALUES (1, 1), (2, 1);
INSERT INTO tanah_perek_dedication VALUES (1, 1, 1, NULL), (1, 1, 2, '2099-01-02 03:04:05');
INSERT INTO tanah_article_dedication VALUES (1, 1, NULL), (1, 2, '2099-01-02 03:04:05');
INSERT INTO tanah_sefer_dedication VALUES (1, 1, NULL, '2026-01-02 03:04:05'), (1, 2, '2099-01-02 03:04:05', '2026-01-02 03:04:05');
INSERT INTO tanah_helek_dedication VALUES (1, 1, NULL, '2026-01-02 03:04:05'), (1, 2, '2099-01-02 03:04:05', '2026-01-02 03:04:05');
INSERT INTO tanah_parasha_dedication VALUES (1, 1, NULL, '2026-01-02 03:04:05'), (1, 2, '2099-01-02 03:04:05', '2026-01-02 03:04:05');
INSERT INTO tanah_masora_dedication VALUES (1, NULL, '2026-01-02 03:04:05'), (2, '2099-01-02 03:04:05', '2026-01-02 03:04:05');
-- The normal dynamic structure creates this scope later in the populator.
CREATE TABLE tanahpedia_entry_dedication (entry_id VARCHAR(64) NOT NULL, dedication_id MEDIUMINT NOT NULL, expires_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(entry_id, dedication_id));
INSERT INTO tanahpedia_entry_dedication VALUES ('fixture-entry', 1, NULL, '2026-01-02 03:04:05'), ('fixture-entry', 2, '2099-01-02 03:04:05', '2026-01-02 03:04:05');
