CREATE DATABASE  IF NOT EXISTS `tanah_test` /*!40100 DEFAULT CHARACTER SET utf8mb3 */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `tanah_test`;
-- MySQL dump 10.13  Distrib 8.0.41, for Win64 (x86_64)
--
-- Host: localhost    Database: tanah_test
-- ------------------------------------------------------
-- Server version	8.4.4

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `tanah_article`
--

DROP TABLE IF EXISTS `tanah_article`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_article` (
  `id` mediumint NOT NULL AUTO_INCREMENT,
  `perek_id` smallint NOT NULL,
  `author_id` smallint NOT NULL,
  `abstract` varchar(10000) DEFAULT NULL,
  `name` varchar(700) NOT NULL,
  `priority` tinyint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_article_dedication`
--

DROP TABLE IF EXISTS `tanah_article_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_article_dedication` (
  `article_id` mediumint NOT NULL,
  `dedication_id` mediumint NOT NULL,
  PRIMARY KEY (`article_id`,`dedication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_dedication`
--

DROP TABLE IF EXISTS `tanah_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_dedication` (
  `id` mediumint NOT NULL AUTO_INCREMENT,
  `subject` varchar(1023) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_dedication_dedication_type`
--

DROP TABLE IF EXISTS `tanah_dedication_dedication_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_dedication_dedication_type` (
  `dedication_id` mediumint NOT NULL,
  `dedication_type_id` tinyint NOT NULL,
  PRIMARY KEY (`dedication_id`,`dedication_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_dedication_type`
--

DROP TABLE IF EXISTS `tanah_dedication_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_dedication_type` (
  `id` tinyint NOT NULL,
  `description` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_helek`
--

DROP TABLE IF EXISTS `tanah_helek`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_helek` (
  `id` tinyint NOT NULL,
  `name` varchar(20) NOT NULL,
  `sefer_id_from` int NOT NULL,
  `sefer_id_to` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_perek`
--

DROP TABLE IF EXISTS `tanah_perek`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_perek` (
  `id` int NOT NULL,
  `perek` int DEFAULT NULL,
  `header` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_perek_date`
--

DROP TABLE IF EXISTS `tanah_perek_date`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_perek_date` (
  `perek_id` int NOT NULL,
  `cycle` tinyint NOT NULL,
  `date` date NOT NULL,
  `hebdate` varchar(20) NOT NULL,
  `star_rise` time NOT NULL,
  PRIMARY KEY (`perek_id`,`cycle`),
  CONSTRAINT `fk_perek_date_perek` FOREIGN KEY (`perek_id`) REFERENCES `tanah_perek` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_perek_dedication`
--

DROP TABLE IF EXISTS `tanah_perek_dedication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_perek_dedication` (
  `perek_id_low` int NOT NULL,
  `perek_id_high` int NOT NULL,
  `dedication_id` mediumint NOT NULL,
  PRIMARY KEY (`perek_id_low`,`perek_id_high`,`dedication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_author`
--

DROP TABLE IF EXISTS `tanah_author`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_author` (
  `id` smallint NOT NULL AUTO_INCREMENT,
  `name` tinytext NOT NULL,
  `details` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_system_message`
--

DROP TABLE IF EXISTS `tanah_system_message`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_system_message` (
  `id` tinyint NOT NULL AUTO_INCREMENT,
  `priority` tinyint NOT NULL,
  `abstract` mediumtext NOT NULL,
  `content` mediumtext NOT NULL,
  `active` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_sefer`
--

DROP TABLE IF EXISTS `tanah_sefer`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_sefer` (
  `id` int NOT NULL,
  `name` varchar(19) DEFAULT NULL,
  `tanach_us_name` varchar(29) DEFAULT NULL,
  `perek_id_from` int NOT NULL,
  `perek_id_to` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tanah_additional`
--

DROP TABLE IF EXISTS `tanah_additional`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_additional` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sefer_id` int NOT NULL,
  `letter` varchar(5) NOT NULL,
  `tanach_us_name` varchar(28) NOT NULL,
  `perek_from` int NOT NULL,
  `perek_to` int NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_additional_sefer` FOREIGN KEY (`sefer_id`) REFERENCES `tanah_sefer` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- View for denormalized perek data (used by API)
-- Returns data from the current valid cycle (latest cycle where date <= CURRENT_DATE)
--

DROP VIEW IF EXISTS `tanah_perek_view`;
CREATE VIEW `tanah_perek_view` AS
SELECT
  p.id,
  p.id AS perek_id,
  s.id AS sefer_id,
  s.name AS sefer_name,
  CASE
    WHEN a.id IS NOT NULL THEN a.id
    ELSE NULL
  END AS additional,
  a.letter AS additional_letter,
  p.perek,
  -- Perek number within sefer/additional context (for compiled_source)
  CASE
    WHEN a.id IS NOT NULL THEN p.id - a.perek_from + 1
    ELSE p.id - s.perek_id_from + 1
  END AS perek_in_context,
  pd.date,
  pd.hebdate,
  pd.star_rise AS tseit,
  p.header
FROM tanah_perek p
JOIN tanah_sefer s ON p.id BETWEEN s.perek_id_from AND s.perek_id_to
LEFT JOIN tanah_perek_date pd ON pd.perek_id = p.id AND pd.cycle = (
  SELECT MAX(pd2.cycle) FROM tanah_perek_date pd2
  WHERE pd2.perek_id = p.id AND pd2.date <= CURRENT_DATE
)
LEFT JOIN tanah_additional a ON a.sefer_id = s.id AND p.id BETWEEN a.perek_from AND a.perek_to;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-03-02 21:03:02
