-- In-content links (e.g. inside יהושע-בן-נון) point at the bare name משה while
-- no entry or synonym resolves it. Alias משה to the existing משה-רבנו entry,
-- resolved by unique_name so the row survives entry id regeneration.
-- Insert only while the target entry exists and neither a משה entry nor a
-- משה synonym is already present.
SET @moshe_entry_id = (
	SELECT id FROM tanahpedia_entry WHERE unique_name = 'משה-רבנו' LIMIT 1
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT UUID(), 'משה', @moshe_entry_id
WHERE @moshe_entry_id IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM tanahpedia_entry_synonym s WHERE s.name = 'משה'
	)
	AND NOT EXISTS (
		SELECT 1 FROM tanahpedia_entry e WHERE e.unique_name = 'משה'
	);
