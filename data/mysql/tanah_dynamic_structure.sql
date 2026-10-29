-- Dynamic structure for Tanah database
-- Contains tables that change frequently (articles, dedications, authors, messages)
-- For tests: USE `tanah_test`
-- For prod: USE `tanah`
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */
;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */
;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */
;
/*!50503 SET NAMES utf8 */
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
--
-- Table structure for table `tanah_author`
--
DROP TABLE IF EXISTS `tanah_author`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
-- DO NOT add image_url or any URL column here.
-- Author image URLs are derived at runtime from the author ID:
--   S3 key = authors/high-res/{id}.jpg  (see getAuthorImageUrl in code)
CREATE TABLE `tanah_author` (
    `id` smallint NOT NULL AUTO_INCREMENT,
    `name` tinytext NOT NULL,
    `details` text NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB AUTO_INCREMENT = 1 DEFAULT CHARSET = utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_article`
--
DROP TABLE IF EXISTS `tanah_article`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `tanah_article` (
    `id` mediumint NOT NULL AUTO_INCREMENT,
    `perek_id` smallint NOT NULL,
    `author_id` smallint NOT NULL,
    `abstract` varchar(10000) DEFAULT NULL,
    `name` varchar(700) NOT NULL,
    `priority` tinyint NOT NULL,
    -- Approval for the daily bulletin only; all valid articles remain public on the site.
    `distributable` boolean NOT NULL DEFAULT FALSE,
    -- FALSE = verse-level coverage unknown (consumers fall back to the primary
    -- perek association); TRUE = tanah_article_covering_source rows are the
    -- verified coverage and drive verse/range lookups.
    `coverage_verified` boolean NOT NULL DEFAULT FALSE,
    `content` mediumtext,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB AUTO_INCREMENT = 1 DEFAULT CHARSET = utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_dedication`
--
DROP TABLE IF EXISTS `tanah_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `tanah_dedication` (
    `id` mediumint NOT NULL AUTO_INCREMENT,
    `subject` varchar(1023) NOT NULL,
    -- Whole-dedication expiry, UTC; NULL = ongoing (#2731).
    `expires_at` datetime NULL DEFAULT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB AUTO_INCREMENT = 1 DEFAULT CHARSET = utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_dedication_type`
--
DROP TABLE IF EXISTS `tanah_dedication_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `tanah_dedication_type` (
    `id` tinyint NOT NULL,
    `description` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_article_covering_source`
--
DROP TABLE IF EXISTS `tanah_article_covering_source`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
-- Verified pasuk-level coverage of an article: each row links one article to
-- one canonical {perek_id, pasuk} it covers. No rows are derived from
-- perek_id alone — coverage is authored through the admin workflow, which
-- also flips tanah_article.coverage_verified once mapping is complete.
CREATE TABLE `tanah_article_covering_source` (
    `article_id` mediumint NOT NULL,
    `perek_id` int NOT NULL,
    `pasuk` smallint NOT NULL COMMENT '1-based pasuk index within perek',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`article_id`, `perek_id`, `pasuk`),
    KEY `idx_covering_source_perek_pasuk` (`perek_id`, `pasuk`),
    CONSTRAINT `fk_covering_source_article` FOREIGN KEY (`article_id`) REFERENCES `tanah_article` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_covering_source_perek` FOREIGN KEY (`perek_id`) REFERENCES `tanah_perek` (`id`),
    CONSTRAINT `chk_covering_source_pasuk` CHECK (`pasuk` >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_article_dedication`
--
DROP TABLE IF EXISTS `tanah_article_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `tanah_article_dedication` (
    `article_id` mediumint NOT NULL,
    `dedication_id` mediumint NOT NULL,
    -- Assignment-level expiry, UTC; NULL = ongoing (#2731).
    `expires_at` datetime NULL DEFAULT NULL,
    PRIMARY KEY (`article_id`, `dedication_id`),
    CONSTRAINT `fk_article_dedication_article` FOREIGN KEY (`article_id`)
        REFERENCES `tanah_article` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_article_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_dedication_dedication_type`
--
DROP TABLE IF EXISTS `tanah_dedication_dedication_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `tanah_dedication_dedication_type` (
    `dedication_id` mediumint NOT NULL,
    `dedication_type_id` tinyint NOT NULL,
    PRIMARY KEY (`dedication_id`, `dedication_type_id`),
    CONSTRAINT `fk_ddt_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_ddt_type` FOREIGN KEY (`dedication_type_id`)
        REFERENCES `tanah_dedication_type` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_perek_dedication`
--
DROP TABLE IF EXISTS `tanah_perek_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `tanah_perek_dedication` (
    `perek_id_low` int NOT NULL,
    `perek_id_high` int NOT NULL,
    `dedication_id` mediumint NOT NULL,
    -- Assignment-level expiry, UTC; NULL = ongoing (#2731).
    `expires_at` datetime NULL DEFAULT NULL,
    PRIMARY KEY (`perek_id_low`, `perek_id_high`, `dedication_id`),
    CONSTRAINT `fk_perek_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb3;

--
-- Table structure for table `tanah_sefer_dedication`
--
DROP TABLE IF EXISTS `tanah_sefer_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
-- Full-sefer scope (#2731). sefer_id carries no FK: deploys recreate
-- tanah_sefer and a cascade would delete still-valid assignments; the write
-- path validates the canonical sefer id instead.
CREATE TABLE `tanah_sefer_dedication` (
    `sefer_id` int NOT NULL,
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`sefer_id`, `dedication_id`),
    KEY `idx_sefer_dedication` (`dedication_id`),
    CONSTRAINT `fk_sefer_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_helek_dedication`
--
DROP TABLE IF EXISTS `tanah_helek_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
-- Full-helek scope (#2731). helek_id carries no FK for the same reason.
CREATE TABLE `tanah_helek_dedication` (
    `helek_id` tinyint NOT NULL,
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`helek_id`, `dedication_id`),
    KEY `idx_helek_dedication` (`dedication_id`),
    CONSTRAINT `fk_helek_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_parasha_dedication`
--
DROP TABLE IF EXISTS `tanah_parasha_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
-- Weekly-parasha scope (#2731): parasha_id is the unit id of the shared
-- parasha division (the /פרשה route identity). Joined weekly readings keep
-- each parasha's own identity, so each side of a combined reading carries
-- its own dedication rows.
CREATE TABLE `tanah_parasha_dedication` (
    `parasha_id` smallint NOT NULL,
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`parasha_id`, `dedication_id`),
    KEY `idx_parasha_dedication` (`dedication_id`),
    CONSTRAINT `chk_parasha_dedication_id` CHECK (`parasha_id` >= 1),
    CONSTRAINT `fk_parasha_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_masora_dedication`
--
DROP TABLE IF EXISTS `tanah_masora_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
-- Whole-feature מסורה על הפרק scope (#2731): one row per dedication, never
-- per internal masoretic parasha.
CREATE TABLE `tanah_masora_dedication` (
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`dedication_id`),
    CONSTRAINT `fk_masora_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */
;
-- The Tanahpedia-entry scope table (tanahpedia_entry_dedication) is created
-- by tanah_dedication_upgrade.sql instead: this file runs before the
-- Tanahpedia structure exists in the db-populator ordering, and its FK to
-- tanahpedia_entry requires the target table to be present already.
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_system_message`
--
DROP TABLE IF EXISTS `tanah_system_message`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `tanah_system_message` (
    `id` tinyint NOT NULL AUTO_INCREMENT,
    `priority` tinyint NOT NULL,
    `abstract` mediumtext NOT NULL,
    `content` mediumtext NOT NULL,
    `active` tinyint(1) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB AUTO_INCREMENT = 1 DEFAULT CHARSET = utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */
;
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
