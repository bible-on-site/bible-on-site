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
-- Table structure for table `tanah_article_detection_type`
--

DROP TABLE IF EXISTS `tanah_article_detection_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_article_detection_type` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb3;
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
-- Table structure for table `tanah_perek`
--

DROP TABLE IF EXISTS `tanah_perek`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_perek` (
  `id` int NOT NULL,
  `perek_id` int DEFAULT NULL,
  `sefer_id` int DEFAULT NULL,
  `additional` int DEFAULT NULL,
  `perek` int DEFAULT NULL,
  `date` date DEFAULT NULL,
  `hebdate` varchar(20) DEFAULT NULL,
  `tseit` time DEFAULT NULL,
  `header` varchar(100) DEFAULT NULL,
  `source` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
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
-- Table structure for table `tanah_rabbi`
--

DROP TABLE IF EXISTS `tanah_rabbi`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tanah_rabbi` (
  `id` smallint NOT NULL AUTO_INCREMENT,
  `name` tinytext NOT NULL,
  `details` text NOT NULL,
  `article_detection_type_id` int NOT NULL,
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
  `sefer_id` int NOT NULL,
  `name` varchar(19) DEFAULT NULL,
  `tanach_us_name` varchar(29) NOT NULL,
  PRIMARY KEY (`sefer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-03-02 21:03:02
