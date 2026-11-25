-- Non-exclusive person role marking a person as a Tanah commentator
-- (מפרש תנ"ך) — feeds the מפרשי התנ"ך subcategory under אישים (issue 3770).
-- Mirrors tanahpedia_person_role_prophet / _king. Additive and repeat-safe:
-- IF NOT EXISTS keeps the deploy Lambda from injecting a DROP before the
-- statement.

CREATE TABLE IF NOT EXISTS `tanahpedia_person_role_commentator` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_commentator_person` (`person_id`),
    CONSTRAINT `fk_commentator_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
