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
    -- Stored fingerprint of the indexable fields; the article-search reconcile
    -- sweep diffs this column instead of re-hashing `content` (the largest
    -- column) for every row on each sweep. Keep the expression identical to
    -- tanah_article_content_hash_upgrade.sql.
    `content_hash` binary(16) GENERATED ALWAYS AS (UNHEX(MD5(CONCAT_WS(X'01', IFNULL(`name`, ''), IFNULL(`abstract`, ''), IFNULL(`content`, ''), `perek_id`, `author_id`)))) STORED,
    PRIMARY KEY (`id`),
    KEY `idx_article_perek` (`perek_id`, `priority`),
    KEY `idx_article_author` (`author_id`)
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
-- Table structure for table `tanah_article_link_proposal`
--
DROP TABLE IF EXISTS `tanah_article_link_proposal`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
-- LLM/heuristic article-linking drafts (#3103). Rows are proposals only —
-- they are never read by public consumers and never mutate the live
-- relationship tables; a human review in the admin applies the approved
-- patch through the typed relationship write path (#3102).
CREATE TABLE `tanah_article_link_proposal` (
    `id` char(36) NOT NULL,
    -- Generation run grouping — all proposals of one pipeline execution.
    `run_id` char(36) NOT NULL,
    `article_id` mediumint NOT NULL,
    -- The shared registry key (#3102), never a table/column name.
    `relationship_key` varchar(40) NOT NULL,
    -- 'add' | 'remove' | 'replace' | 'clear' (registry operation names).
    `action` varchar(10) NOT NULL,
    -- Canonical normalized target payload (e.g. {"perekId":12},
    -- {"pasukCoordinates":[{"perekId":1,"pasuk":3}]}). Original model output
    -- stays in evidence/rationale; review_patch_json carries the human edit.
    `target_json` json NOT NULL,
    -- Human-readable target for the review queue (e.g. "בראשית א ג").
    `target_label` varchar(500) NOT NULL,
    -- [{"quote","spanStart","spanEnd"}] — offsets in the extracted plain-text
    -- view of the article content snapshot the proposal was generated on.
    `evidence_json` json DEFAULT NULL,
    `rationale` text,
    -- Advisory score only — never an automatic approval threshold.
    `confidence` decimal(4,3) DEFAULT NULL,
    -- Detected collision/ambiguity the reviewer must see (e.g. occupied
    -- month/day, competing manual link, ambiguous citation, pending schema).
    `conflict` varchar(500) DEFAULT NULL,
    -- pending | held | approved | rejected | applied | stale.
    `status` varchar(12) NOT NULL DEFAULT 'pending',
    -- sha256(dedupe input incl. generator+prompt_version+base_content_hash):
    -- rerun idempotency — same inputs never insert a second row.
    `dedupe_key` char(64) NOT NULL,
    -- sha256(article+relationship+action+canonical target): the durable
    -- identity a reject/apply decision binds to, across generators/versions.
    `decision_key` char(64) NOT NULL,
    -- 'openai:<model>' | 'heuristic:<ver>' — which draft path produced it.
    `generator` varchar(120) NOT NULL,
    -- Provider-reported model identifier/revision when available.
    `model` varchar(120) DEFAULT NULL,
    `prompt_version` varchar(40) NOT NULL,
    -- Freshness token: LOWER(HEX(tanah_article.content_hash)) at generation;
    -- '' when the generated column is not deployed (staleness then unchecked).
    `base_content_hash` char(32) NOT NULL DEFAULT '',
    -- The relationship state the proposal was generated against.
    `base_snapshot_json` json DEFAULT NULL,
    `prompt_tokens` int DEFAULT NULL,
    `completion_tokens` int DEFAULT NULL,
    -- The human-edited final patch — kept separate from the model output.
    `review_patch_json` json DEFAULT NULL,
    `review_notes` varchar(1000) DEFAULT NULL,
    -- The approving/rejecting editor identity (Cognito sub, or 'local' dev).
    `reviewer` varchar(200) DEFAULT NULL,
    `reviewed_at` timestamp(6) NULL DEFAULT NULL,
    `applied_at` timestamp(6) NULL DEFAULT NULL,
    -- The post-apply relationship state (the exact after-record).
    `applied_snapshot_json` json DEFAULT NULL,
    `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_link_proposal_dedupe` (`dedupe_key`),
    KEY `idx_link_proposal_queue` (`status`, `article_id`),
    KEY `idx_link_proposal_run` (`run_id`),
    KEY `idx_link_proposal_decision` (`decision_key`),
    CONSTRAINT `fk_link_proposal_article` FOREIGN KEY (`article_id`)
        REFERENCES `tanah_article` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */
;
--
-- Table structure for table `tanah_article_link_checkpoint`
--
DROP TABLE IF EXISTS `tanah_article_link_checkpoint`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
-- Resumable-run checkpointing (#3103): one row per
-- (article, generator, prompt_version, content_hash) already processed —
-- unchanged inputs reuse the prior generation instead of re-calling the model.
CREATE TABLE `tanah_article_link_checkpoint` (
    `article_id` mediumint NOT NULL,
    `generator` varchar(120) NOT NULL,
    `prompt_version` varchar(40) NOT NULL,
    `content_hash` char(32) NOT NULL DEFAULT '',
    `run_id` char(36) NOT NULL,
    `proposal_count` int NOT NULL DEFAULT 0,
    `processed_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`article_id`, `generator`, `prompt_version`, `content_hash`),
    CONSTRAINT `fk_link_checkpoint_article` FOREIGN KEY (`article_id`)
        REFERENCES `tanah_article` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
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
