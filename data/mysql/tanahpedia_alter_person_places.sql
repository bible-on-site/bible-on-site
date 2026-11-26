-- One-time upgrade for databases created before person place facts gained a
-- free-text alternative and the activity/death place tables existed. Plain
-- MySQL has no ADD COLUMN IF NOT EXISTS clause (that is a MariaDB-only
-- extension), so this uses the standard prepared-statement idiom to check
-- information_schema first. This makes the script safe to execute
-- unconditionally on every deploy (production data-deploy Lambda has no
-- pre-check and re-runs this file on every deployment).
--
-- Each location fact holds either a linked tanahpedia_place reference
-- (place_id) or a nonblank free-text alternative (place_text). The linked form
-- follows the place entity to its public entry, while the text form preserves
-- the spelling the editor entered without requiring a new entity.
--
-- Existing tanahpedia_person_birth_place rows keep their id, place_id and
-- alt_group_id: the column is only widened to NULL and a new nullable
-- place_text column is appended.

SET @preparedStatement = (
        SELECT IF(
                (
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = 'tanahpedia_person_birth_place'
                        AND COLUMN_NAME = 'place_text'
                ) > 0,
                'SELECT 1',
                'ALTER TABLE tanahpedia_person_birth_place
                 MODIFY COLUMN place_id CHAR(36) NULL COMMENT ''Linked place; exactly one of place_id/place_text is set'',
                 ADD COLUMN place_text VARCHAR(255) NULL COMMENT ''Free-text place when no place entity exists'''
            )
    );
PREPARE addPersonBirthPlaceText
FROM @preparedStatement;
EXECUTE addPersonBirthPlaceText;
DEALLOCATE PREPARE addPersonBirthPlaceText;

CREATE TABLE IF NOT EXISTS `tanahpedia_person_death_place` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `place_id` char(36) DEFAULT NULL COMMENT 'Linked place; exactly one of place_id/place_text is set',
    `place_text` varchar(255) DEFAULT NULL COMMENT 'Free-text place when no place entity exists',
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_death_place_person` (`person_id`),
    KEY `idx_person_death_place_place` (`place_id`),
    CONSTRAINT `fk_person_death_place_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_person_death_place_place` FOREIGN KEY (`place_id`) REFERENCES `tanahpedia_place` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tanahpedia_person_activity_place` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `place_id` char(36) DEFAULT NULL COMMENT 'Linked place; exactly one of place_id/place_text is set',
    `place_text` varchar(255) DEFAULT NULL COMMENT 'Free-text place when no place entity exists',
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_activity_place_person` (`person_id`),
    KEY `idx_person_activity_place_place` (`place_id`),
    CONSTRAINT `fk_person_activity_place_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_person_activity_place_place` FOREIGN KEY (`place_id`) REFERENCES `tanahpedia_place` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
