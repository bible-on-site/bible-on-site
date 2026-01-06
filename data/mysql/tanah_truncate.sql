-- Truncate all tanah tables
-- Use this to clear all data while preserving the schema

USE `tanah_test`;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE tanah_article;
TRUNCATE TABLE tanah_article_dedication;
TRUNCATE TABLE tanah_dedication;
TRUNCATE TABLE tanah_dedication_dedication_type;
TRUNCATE TABLE tanah_dedication_type;
TRUNCATE TABLE tanah_helek;
TRUNCATE TABLE tanah_perek;
TRUNCATE TABLE tanah_perek_date;
TRUNCATE TABLE tanah_perek_dedication;
TRUNCATE TABLE tanah_author;
TRUNCATE TABLE tanah_system_message;
TRUNCATE TABLE tanah_sefer;
TRUNCATE TABLE tanah_additional;

SET FOREIGN_KEY_CHECKS = 1;
