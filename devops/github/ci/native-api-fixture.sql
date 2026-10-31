-- Synthetic data only, on the verifier-owned independent MySQL server.
CREATE TABLE tanah_perek (id INT NOT NULL PRIMARY KEY);
INSERT INTO tanah_perek VALUES (1);
CREATE TABLE tanah_sefer (id INT NOT NULL PRIMARY KEY, name TEXT NOT NULL, tanach_us_name TEXT NULL, perek_id_from INT NOT NULL, perek_id_to INT NOT NULL);
INSERT INTO tanah_sefer VALUES (1, 'Fixture book', NULL, 1, 50);
CREATE TABLE tanah_helek (id INT NOT NULL PRIMARY KEY, name TEXT NOT NULL, sefer_id_from INT NOT NULL, sefer_id_to INT NOT NULL);
INSERT INTO tanah_helek VALUES (1, 'Fixture division', 1, 5);
CREATE VIEW tanah_perek_view AS SELECT 1 AS id, 1 AS perek_id, 1 AS sefer_id, 'Fixture book' AS sefer_name, NULL AS additional, NULL AS additional_letter, 1 AS perek, 1 AS perek_in_context, NULL AS date, NULL AS hebdate, NULL AS tseit, NULL AS header, 31 AS pasuk_count;
CREATE TABLE native_fixture_lock_owner (connection_id BIGINT NOT NULL PRIMARY KEY);
