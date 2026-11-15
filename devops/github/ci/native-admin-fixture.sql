-- Synthetic data only, on the verifier-owned independent MySQL server.
-- Mirrors the production tanah_daily_bulletin shape owned by
-- data/mysql/tanah_daily_bulletin_upgrade.sql; the anonymous
-- /api/bulletin-documents probe below proves a real DB read.
CREATE TABLE tanah_daily_bulletin (
    bulletin_date DATE NOT NULL PRIMARY KEY,
    perek_id SMALLINT UNSIGNED NOT NULL,
    article_id MEDIUMINT NULL,
    input_json JSON NOT NULL,
    subject VARCHAR(700) NOT NULL,
    source VARCHAR(255) NOT NULL,
    email_html MEDIUMTEXT NOT NULL,
    pdf_data MEDIUMBLOB NOT NULL,
    filename VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
