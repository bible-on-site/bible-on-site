-- Schema for perushim (commentaries) tables
-- For tests: USE `tanah_test`
-- For prod: USE `tanah`

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;

SET FOREIGN_KEY_CHECKS = 0;

--
-- Table structure for table `parshan` (commentator)
--

DROP TABLE IF EXISTS `parshan`;
CREATE TABLE `parshan` (
    `id` smallint NOT NULL,
    `name` varchar(200) NOT NULL,
    `birth_year` smallint DEFAULT NULL,
    `has_pic` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `perush` (commentary work)
--

DROP TABLE IF EXISTS `perush`;
CREATE TABLE `perush` (
    `id` smallint NOT NULL,
    `name` varchar(200) NOT NULL,
    `parshan_id` smallint NOT NULL,
    `comp_date` varchar(100) DEFAULT NULL,
    `pub_date` varchar(100) DEFAULT NULL,
    `priority` smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `idx_perush_parshan` (`parshan_id`),
    CONSTRAINT `fk_perush_parshan` FOREIGN KEY (`parshan_id`) REFERENCES `parshan` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `note` (commentary text per pasuk)
--

DROP TABLE IF EXISTS `note`;
CREATE TABLE `note` (
    `perush_id` smallint NOT NULL,
    `perek_id` smallint NOT NULL,
    `pasuk` smallint NOT NULL,
    `note_idx` smallint NOT NULL,
    `note_content` text NOT NULL,
    PRIMARY KEY (`perush_id`, `perek_id`, `pasuk`, `note_idx`),
    KEY `idx_note_perek` (`perek_id`),
    KEY `idx_note_perek_pasuk` (`perek_id`, `pasuk`),
    CONSTRAINT `fk_note_perush` FOREIGN KEY (`perush_id`) REFERENCES `perush` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
