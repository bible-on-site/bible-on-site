-- Tanahpedia structure
-- For tests: USE `tanah_test`
-- For prod: USE `tanah`
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */
;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */
;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */
;
/*!50503 SET NAMES utf8mb4 */
;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */
;
/*!40103 SET TIME_ZONE='+00:00' */
;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */
;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */
;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */
;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */
;

-- -------------------------------------------
-- GOD (singleton)
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_god`;
CREATE TABLE `tanahpedia_god` (
    `id` char(36) NOT NULL COMMENT 'Single row - the one God',
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- SOURCE TABLES
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_source_group`;
CREATE TABLE `tanahpedia_source_group` (
    `id` char(36) NOT NULL,
    `target_table` varchar(100) NOT NULL,
    `target_id` char(36) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_source_group_target` (`target_table`, `target_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_tanah_source`;
CREATE TABLE `tanahpedia_tanah_source` (
    `id` char(36) NOT NULL,
    `source_group_id` char(36) NOT NULL,
    `perush_id` smallint DEFAULT NULL,
    `pasuk_id` int DEFAULT NULL,
    `perek_id` int DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_tanah_source_group` (`source_group_id`),
    CONSTRAINT `fk_tanah_source_group` FOREIGN KEY (`source_group_id`) REFERENCES `tanahpedia_source_group` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_tanah_source_perush` FOREIGN KEY (`perush_id`) REFERENCES `perush` (`id`),
    CONSTRAINT `fk_tanah_source_perek` FOREIGN KEY (`perek_id`) REFERENCES `tanah_perek` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_non_tanah_source`;
CREATE TABLE `tanahpedia_non_tanah_source` (
    `id` char(36) NOT NULL,
    `source_group_id` char(36) NOT NULL,
    `source_text` varchar(500) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_non_tanah_source_group` (`source_group_id`),
    CONSTRAINT `fk_non_tanah_source_group` FOREIGN KEY (`source_group_id`) REFERENCES `tanahpedia_source_group` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- ENTRY SYSTEM
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_entry`;
CREATE TABLE `tanahpedia_entry` (
    `id` char(36) NOT NULL,
    `unique_name` varchar(255) NOT NULL,
    `title` varchar(255) NOT NULL,
    `content` mediumtext,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_entry_unique_name` (`unique_name`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_entry_synonym`;
CREATE TABLE `tanahpedia_entry_synonym` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    `entry_id` char(36) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_entry_synonym_entry` (`entry_id`),
    CONSTRAINT `fk_entry_synonym_entry` FOREIGN KEY (`entry_id`) REFERENCES `tanahpedia_entry` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_entry_synonym_disambiguation`;
CREATE TABLE `tanahpedia_entry_synonym_disambiguation` (
    `id` char(36) NOT NULL,
    `synonym_id` char(36) NOT NULL,
    `entry_id` char(36) NOT NULL,
    `disambiguation_label` varchar(255) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_synonym_disambig_synonym` (`synonym_id`),
    KEY `idx_synonym_disambig_entry` (`entry_id`),
    CONSTRAINT `fk_synonym_disambig_synonym` FOREIGN KEY (`synonym_id`) REFERENCES `tanahpedia_entry_synonym` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_synonym_disambig_entry` FOREIGN KEY (`entry_id`) REFERENCES `tanahpedia_entry` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_entry_entity`;
CREATE TABLE `tanahpedia_entry_entity` (
    `id` char(36) NOT NULL,
    `entry_id` char(36) NOT NULL,
    `entity_type` enum('PERSON','PLACE','EVENT','WAR','ANIMAL','OBJECT','TEMPLE_TOOL','PLANT','ASTRONOMICAL_OBJECT','SAYING','SEFER','PROPHECY','NATION') NOT NULL,
    `entity_id` char(36) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_entry_entity_entry` (`entry_id`),
    KEY `idx_entry_entity_type_id` (`entity_type`, `entity_id`),
    CONSTRAINT `fk_entry_entity_entry` FOREIGN KEY (`entry_id`) REFERENCES `tanahpedia_entry` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- PERSON
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_person`;
CREATE TABLE `tanahpedia_person` (
    `id` char(36) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_lookup_name_type`;
CREATE TABLE `tanahpedia_lookup_name_type` (
    `id` char(36) NOT NULL,
    `name` varchar(50) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_name`;
CREATE TABLE `tanahpedia_person_name` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    `name_type_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_name_person` (`person_id`),
    KEY `idx_person_name_type` (`name_type_id`),
    CONSTRAINT `fk_person_name_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_person_name_type` FOREIGN KEY (`name_type_id`) REFERENCES `tanahpedia_lookup_name_type` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_name_giver_person`;
CREATE TABLE `tanahpedia_person_name_giver_person` (
    `id` char(36) NOT NULL,
    `person_name_id` char(36) NOT NULL,
    `giver_person_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_name_giver_person_name` (`person_name_id`),
    KEY `idx_name_giver_person` (`giver_person_id`),
    CONSTRAINT `fk_name_giver_person_name` FOREIGN KEY (`person_name_id`) REFERENCES `tanahpedia_person_name` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_name_giver_person` FOREIGN KEY (`giver_person_id`) REFERENCES `tanahpedia_person` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_name_giver_god`;
CREATE TABLE `tanahpedia_person_name_giver_god` (
    `id` char(36) NOT NULL,
    `person_name_id` char(36) NOT NULL,
    `god_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_name_giver_god_name` (`person_name_id`),
    CONSTRAINT `fk_name_giver_god_name` FOREIGN KEY (`person_name_id`) REFERENCES `tanahpedia_person_name` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_name_giver_god` FOREIGN KEY (`god_id`) REFERENCES `tanahpedia_god` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_sex`;
CREATE TABLE `tanahpedia_person_sex` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `sex` enum('MALE','FEMALE','UNKNOWN') NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_sex_person` (`person_id`),
    CONSTRAINT `fk_person_sex_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_birth_date`;
CREATE TABLE `tanahpedia_person_birth_date` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `birth_date` int NOT NULL COMMENT 'YYYYMMDD format, see docs',
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_birth_date_person` (`person_id`),
    CONSTRAINT `fk_person_birth_date_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_death_date`;
CREATE TABLE `tanahpedia_person_death_date` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `death_date` int NOT NULL COMMENT 'YYYYMMDD format, -1 = not yet (Eliyahu)',
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_death_date_person` (`person_id`),
    CONSTRAINT `fk_person_death_date_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_death_cause`;
CREATE TABLE `tanahpedia_person_death_cause` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `death_cause` varchar(255) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_death_cause_person` (`person_id`),
    CONSTRAINT `fk_person_death_cause_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_birth_place`;
CREATE TABLE `tanahpedia_person_birth_place` (
    `id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `place_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_birth_place_person` (`person_id`),
    KEY `idx_person_birth_place_place` (`place_id`),
    CONSTRAINT `fk_person_birth_place_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_person_birth_place_place` FOREIGN KEY (`place_id`) REFERENCES `tanahpedia_place` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- PLACE
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_place`;
CREATE TABLE `tanahpedia_place` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_place_identification`;
CREATE TABLE `tanahpedia_place_identification` (
    `id` char(36) NOT NULL,
    `place_id` char(36) NOT NULL,
    `modern_name` varchar(255) DEFAULT NULL,
    `latitude` decimal(10,8) DEFAULT NULL,
    `longitude` decimal(11,8) DEFAULT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_place_ident_place` (`place_id`),
    CONSTRAINT `fk_place_ident_place` FOREIGN KEY (`place_id`) REFERENCES `tanahpedia_place` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- EVENT
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_event`;
CREATE TABLE `tanahpedia_event` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_event_place`;
CREATE TABLE `tanahpedia_event_place` (
    `id` char(36) NOT NULL,
    `event_id` char(36) NOT NULL,
    `place_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_event_place_event` (`event_id`),
    KEY `idx_event_place_place` (`place_id`),
    CONSTRAINT `fk_event_place_event` FOREIGN KEY (`event_id`) REFERENCES `tanahpedia_event` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_event_place_place` FOREIGN KEY (`place_id`) REFERENCES `tanahpedia_place` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_event_date_range`;
CREATE TABLE `tanahpedia_event_date_range` (
    `id` char(36) NOT NULL,
    `event_id` char(36) NOT NULL,
    `start_date` int DEFAULT NULL COMMENT 'YYYYMMDD format',
    `end_date` int DEFAULT NULL COMMENT 'YYYYMMDD format',
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_event_date_range_event` (`event_id`),
    CONSTRAINT `fk_event_date_range_event` FOREIGN KEY (`event_id`) REFERENCES `tanahpedia_event` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- WAR (extends Event)
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_war`;
CREATE TABLE `tanahpedia_war` (
    `id` char(36) NOT NULL,
    `event_id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_war_event` (`event_id`),
    CONSTRAINT `fk_war_event` FOREIGN KEY (`event_id`) REFERENCES `tanahpedia_event` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_war_side`;
CREATE TABLE `tanahpedia_war_side` (
    `id` char(36) NOT NULL,
    `war_id` char(36) NOT NULL,
    `side_number` int NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_war_side_war` (`war_id`),
    CONSTRAINT `fk_war_side_war` FOREIGN KEY (`war_id`) REFERENCES `tanahpedia_war` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_war_side_participant_person`;
CREATE TABLE `tanahpedia_war_side_participant_person` (
    `id` char(36) NOT NULL,
    `war_side_id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_war_side_part_person_side` (`war_side_id`),
    KEY `idx_war_side_part_person_person` (`person_id`),
    CONSTRAINT `fk_war_side_part_person_side` FOREIGN KEY (`war_side_id`) REFERENCES `tanahpedia_war_side` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_war_side_part_person_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_war_side_participant_nation`;
CREATE TABLE `tanahpedia_war_side_participant_nation` (
    `id` char(36) NOT NULL,
    `war_side_id` char(36) NOT NULL,
    `nation_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_war_side_part_nation_side` (`war_side_id`),
    KEY `idx_war_side_part_nation_nation` (`nation_id`),
    CONSTRAINT `fk_war_side_part_nation_side` FOREIGN KEY (`war_side_id`) REFERENCES `tanahpedia_war_side` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_war_side_part_nation_nation` FOREIGN KEY (`nation_id`) REFERENCES `tanahpedia_nation` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- NATION
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_nation`;
CREATE TABLE `tanahpedia_nation` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_nation_source_nation`;
CREATE TABLE `tanahpedia_nation_source_nation` (
    `id` char(36) NOT NULL,
    `nation_id` char(36) NOT NULL,
    `source_nation_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_nation_source_nation` (`nation_id`),
    KEY `idx_nation_source_source` (`source_nation_id`),
    CONSTRAINT `fk_nation_source_nation` FOREIGN KEY (`nation_id`) REFERENCES `tanahpedia_nation` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_nation_source_source` FOREIGN KEY (`source_nation_id`) REFERENCES `tanahpedia_nation` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_nation_territory`;
CREATE TABLE `tanahpedia_nation_territory` (
    `id` char(36) NOT NULL,
    `nation_id` char(36) NOT NULL,
    `place_id` char(36) NOT NULL,
    `start_date` int DEFAULT NULL COMMENT 'YYYYMMDD format',
    `end_date` int DEFAULT NULL COMMENT 'YYYYMMDD format',
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_nation_territory_nation` (`nation_id`),
    KEY `idx_nation_territory_place` (`place_id`),
    CONSTRAINT `fk_nation_territory_nation` FOREIGN KEY (`nation_id`) REFERENCES `tanahpedia_nation` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_nation_territory_place` FOREIGN KEY (`place_id`) REFERENCES `tanahpedia_place` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- ANIMAL
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_animal`;
CREATE TABLE `tanahpedia_animal` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- OBJECT
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_object`;
CREATE TABLE `tanahpedia_object` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- TEMPLE_TOOL (extends Object)
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_temple_tool`;
CREATE TABLE `tanahpedia_temple_tool` (
    `id` char(36) NOT NULL,
    `object_id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_temple_tool_object` (`object_id`),
    CONSTRAINT `fk_temple_tool_object` FOREIGN KEY (`object_id`) REFERENCES `tanahpedia_object` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- 3D MODEL (for Object, Temple Tool, Animal, Plant)
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_3d_model`;
CREATE TABLE `tanahpedia_3d_model` (
    `id` char(36) NOT NULL,
    `entity_type` enum('OBJECT','TEMPLE_TOOL','ANIMAL','PLANT') NOT NULL,
    `entity_id` char(36) NOT NULL,
    `blob_key` varchar(500) NOT NULL COMMENT 'S3/blob storage key for the 3D model file',
    `format` varchar(50) NOT NULL COMMENT 'glTF, GLB, OBJ, etc.',
    `label` varchar(255) DEFAULT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_3d_model_entity` (`entity_type`, `entity_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- CATEGORY HOMEPAGE
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_category_homepage`;
CREATE TABLE `tanahpedia_category_homepage` (
    `id` char(36) NOT NULL,
    `entity_type` enum('PERSON','PLACE','EVENT','WAR','ANIMAL','OBJECT','TEMPLE_TOOL','PLANT','ASTRONOMICAL_OBJECT','SAYING','SEFER','PROPHECY','NATION') NOT NULL,
    `layout_type` varchar(50) NOT NULL COMMENT 'LIST, MAP, GALLERY, TIMELINE, etc.',
    `config` json DEFAULT NULL COMMENT 'Layout-specific config (map center/zoom, gallery columns, etc.)',
    `content` mediumtext COMMENT 'Optional rich-text intro/description',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_category_homepage_entity_type` (`entity_type`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- PLANT
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_plant`;
CREATE TABLE `tanahpedia_plant` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_plant_creation_day`;
CREATE TABLE `tanahpedia_plant_creation_day` (
    `id` char(36) NOT NULL,
    `plant_id` char(36) NOT NULL,
    `creation_day` tinyint NOT NULL COMMENT '1-6, Bereishit creation day',
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_plant_creation_day_plant` (`plant_id`),
    CONSTRAINT `fk_plant_creation_day_plant` FOREIGN KEY (`plant_id`) REFERENCES `tanahpedia_plant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- ASTRONOMICAL_OBJECT
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_astronomical_object`;
CREATE TABLE `tanahpedia_astronomical_object` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_astronomical_object_creation_day`;
CREATE TABLE `tanahpedia_astronomical_object_creation_day` (
    `id` char(36) NOT NULL,
    `astronomical_object_id` char(36) NOT NULL,
    `creation_day` tinyint NOT NULL COMMENT '1-6, Bereishit creation day',
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_astro_creation_day_astro` (`astronomical_object_id`),
    CONSTRAINT `fk_astro_creation_day_astro` FOREIGN KEY (`astronomical_object_id`) REFERENCES `tanahpedia_astronomical_object` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- SEFER
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_sefer`;
CREATE TABLE `tanahpedia_sefer` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_sefer_tanah_match`;
CREATE TABLE `tanahpedia_sefer_tanah_match` (
    `id` char(36) NOT NULL,
    `sefer_id` char(36) NOT NULL,
    `tanah_sefer_id` int NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_sefer_tanah_match_sefer` (`sefer_id`),
    KEY `idx_sefer_tanah_match_tanah` (`tanah_sefer_id`),
    CONSTRAINT `fk_sefer_tanah_match_sefer` FOREIGN KEY (`sefer_id`) REFERENCES `tanahpedia_sefer` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_sefer_tanah_match_tanah` FOREIGN KEY (`tanah_sefer_id`) REFERENCES `tanah_sefer` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- SAYING
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_saying`;
CREATE TABLE `tanahpedia_saying` (
    `id` char(36) NOT NULL,
    `name` varchar(255) NOT NULL,
    `content` text,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_saying_location`;
CREATE TABLE `tanahpedia_saying_location` (
    `id` char(36) NOT NULL,
    `saying_id` char(36) NOT NULL,
    `place_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_saying_location_saying` (`saying_id`),
    KEY `idx_saying_location_place` (`place_id`),
    CONSTRAINT `fk_saying_location_saying` FOREIGN KEY (`saying_id`) REFERENCES `tanahpedia_saying` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_saying_location_place` FOREIGN KEY (`place_id`) REFERENCES `tanahpedia_place` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_saying_speaker_person`;
CREATE TABLE `tanahpedia_saying_speaker_person` (
    `id` char(36) NOT NULL,
    `saying_id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_saying_speaker_person_saying` (`saying_id`),
    KEY `idx_saying_speaker_person_person` (`person_id`),
    CONSTRAINT `fk_saying_speaker_person_saying` FOREIGN KEY (`saying_id`) REFERENCES `tanahpedia_saying` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_saying_speaker_person_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_saying_speaker_nation`;
CREATE TABLE `tanahpedia_saying_speaker_nation` (
    `id` char(36) NOT NULL,
    `saying_id` char(36) NOT NULL,
    `nation_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_saying_speaker_nation_saying` (`saying_id`),
    KEY `idx_saying_speaker_nation_nation` (`nation_id`),
    CONSTRAINT `fk_saying_speaker_nation_saying` FOREIGN KEY (`saying_id`) REFERENCES `tanahpedia_saying` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_saying_speaker_nation_nation` FOREIGN KEY (`nation_id`) REFERENCES `tanahpedia_nation` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_saying_speaker_god`;
CREATE TABLE `tanahpedia_saying_speaker_god` (
    `id` char(36) NOT NULL,
    `saying_id` char(36) NOT NULL,
    `god_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_saying_speaker_god_saying` (`saying_id`),
    CONSTRAINT `fk_saying_speaker_god_saying` FOREIGN KEY (`saying_id`) REFERENCES `tanahpedia_saying` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_saying_speaker_god_god` FOREIGN KEY (`god_id`) REFERENCES `tanahpedia_god` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_saying_audience_person`;
CREATE TABLE `tanahpedia_saying_audience_person` (
    `id` char(36) NOT NULL,
    `saying_id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_saying_audience_person_saying` (`saying_id`),
    KEY `idx_saying_audience_person_person` (`person_id`),
    CONSTRAINT `fk_saying_audience_person_saying` FOREIGN KEY (`saying_id`) REFERENCES `tanahpedia_saying` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_saying_audience_person_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_saying_audience_nation`;
CREATE TABLE `tanahpedia_saying_audience_nation` (
    `id` char(36) NOT NULL,
    `saying_id` char(36) NOT NULL,
    `nation_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_saying_audience_nation_saying` (`saying_id`),
    KEY `idx_saying_audience_nation_nation` (`nation_id`),
    CONSTRAINT `fk_saying_audience_nation_saying` FOREIGN KEY (`saying_id`) REFERENCES `tanahpedia_saying` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_saying_audience_nation_nation` FOREIGN KEY (`nation_id`) REFERENCES `tanahpedia_nation` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- PROPHECY (extends Saying)
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_prophecy`;
CREATE TABLE `tanahpedia_prophecy` (
    `id` char(36) NOT NULL,
    `saying_id` char(36) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_prophecy_saying` (`saying_id`),
    CONSTRAINT `fk_prophecy_saying` FOREIGN KEY (`saying_id`) REFERENCES `tanahpedia_saying` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_prophecy_is_good`;
CREATE TABLE `tanahpedia_prophecy_is_good` (
    `id` char(36) NOT NULL,
    `prophecy_id` char(36) NOT NULL,
    `is_good` tinyint(1) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_prophecy_is_good_prophecy` (`prophecy_id`),
    CONSTRAINT `fk_prophecy_is_good_prophecy` FOREIGN KEY (`prophecy_id`) REFERENCES `tanahpedia_prophecy` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_prophecy_prophet`;
CREATE TABLE `tanahpedia_prophecy_prophet` (
    `id` char(36) NOT NULL,
    `prophecy_id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_prophecy_prophet_prophecy` (`prophecy_id`),
    KEY `idx_prophecy_prophet_person` (`person_id`),
    CONSTRAINT `fk_prophecy_prophet_prophecy` FOREIGN KEY (`prophecy_id`) REFERENCES `tanahpedia_prophecy` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_prophecy_prophet_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_prophecy_recipient_person`;
CREATE TABLE `tanahpedia_prophecy_recipient_person` (
    `id` char(36) NOT NULL,
    `prophecy_id` char(36) NOT NULL,
    `person_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_prophecy_recip_person_prophecy` (`prophecy_id`),
    KEY `idx_prophecy_recip_person_person` (`person_id`),
    CONSTRAINT `fk_prophecy_recip_person_prophecy` FOREIGN KEY (`prophecy_id`) REFERENCES `tanahpedia_prophecy` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_prophecy_recip_person_person` FOREIGN KEY (`person_id`) REFERENCES `tanahpedia_person` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_prophecy_recipient_nation`;
CREATE TABLE `tanahpedia_prophecy_recipient_nation` (
    `id` char(36) NOT NULL,
    `prophecy_id` char(36) NOT NULL,
    `nation_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_prophecy_recip_nation_prophecy` (`prophecy_id`),
    KEY `idx_prophecy_recip_nation_nation` (`nation_id`),
    CONSTRAINT `fk_prophecy_recip_nation_prophecy` FOREIGN KEY (`prophecy_id`) REFERENCES `tanahpedia_prophecy` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_prophecy_recip_nation_nation` FOREIGN KEY (`nation_id`) REFERENCES `tanahpedia_nation` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- -------------------------------------------
-- FAMILY RELATIONSHIPS
-- -------------------------------------------

DROP TABLE IF EXISTS `tanahpedia_lookup_union_type`;
CREATE TABLE `tanahpedia_lookup_union_type` (
    `id` char(36) NOT NULL,
    `name` varchar(50) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_lookup_union_end_reason`;
CREATE TABLE `tanahpedia_lookup_union_end_reason` (
    `id` char(36) NOT NULL,
    `name` varchar(50) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_union`;
CREATE TABLE `tanahpedia_person_union` (
    `id` char(36) NOT NULL,
    `person1_id` char(36) NOT NULL,
    `person2_id` char(36) NOT NULL,
    `union_type_id` char(36) NOT NULL,
    `union_order` int DEFAULT NULL,
    `start_date` int DEFAULT NULL COMMENT 'YYYYMMDD format',
    `end_date` int DEFAULT NULL COMMENT 'YYYYMMDD format',
    `end_reason_id` char(36) DEFAULT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_person_union_person1` (`person1_id`),
    KEY `idx_person_union_person2` (`person2_id`),
    KEY `idx_person_union_type` (`union_type_id`),
    CONSTRAINT `fk_person_union_person1` FOREIGN KEY (`person1_id`) REFERENCES `tanahpedia_person` (`id`),
    CONSTRAINT `fk_person_union_person2` FOREIGN KEY (`person2_id`) REFERENCES `tanahpedia_person` (`id`),
    CONSTRAINT `fk_person_union_type` FOREIGN KEY (`union_type_id`) REFERENCES `tanahpedia_lookup_union_type` (`id`),
    CONSTRAINT `fk_person_union_end_reason` FOREIGN KEY (`end_reason_id`) REFERENCES `tanahpedia_lookup_union_end_reason` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_lookup_parent_child_type`;
CREATE TABLE `tanahpedia_lookup_parent_child_type` (
    `id` char(36) NOT NULL,
    `name` varchar(50) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_lookup_parent_role`;
CREATE TABLE `tanahpedia_lookup_parent_role` (
    `id` char(36) NOT NULL,
    `name` varchar(50) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `tanahpedia_person_parent_child`;
CREATE TABLE `tanahpedia_person_parent_child` (
    `id` char(36) NOT NULL,
    `parent_id` char(36) NOT NULL,
    `child_id` char(36) NOT NULL,
    `relationship_type_id` char(36) NOT NULL,
    `parent_role_id` char(36) NOT NULL,
    `alt_group_id` char(36) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_parent_child_parent` (`parent_id`),
    KEY `idx_parent_child_child` (`child_id`),
    KEY `idx_parent_child_type` (`relationship_type_id`),
    KEY `idx_parent_child_role` (`parent_role_id`),
    CONSTRAINT `fk_parent_child_parent` FOREIGN KEY (`parent_id`) REFERENCES `tanahpedia_person` (`id`),
    CONSTRAINT `fk_parent_child_child` FOREIGN KEY (`child_id`) REFERENCES `tanahpedia_person` (`id`),
    CONSTRAINT `fk_parent_child_type` FOREIGN KEY (`relationship_type_id`) REFERENCES `tanahpedia_lookup_parent_child_type` (`id`),
    CONSTRAINT `fk_parent_child_role` FOREIGN KEY (`parent_role_id`) REFERENCES `tanahpedia_lookup_parent_role` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */
;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */
;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */
;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */
;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */
;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */
;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */
;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */
;
