-- Entry aliases (synonyms) — alternate names a reader may type in the URL.
-- Rows are keyed by `unique_name` so they survive entry id regeneration, and the
-- delete-then-insert makes the script idempotent across repeated populates.
DELETE s
FROM tanahpedia_entry_synonym s
    JOIN tanahpedia_entry e ON e.id = s.entry_id
WHERE e.unique_name IN (
        'משה-רבנו',
        'יהושע-בן-נון',
        'עלי-הכהן',
        'eretz-yisrael'
    );
INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT UUID(),
    'משה',
    id
FROM tanahpedia_entry
WHERE unique_name = 'משה-רבנו';
INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT UUID(),
    'משה בן עמרם',
    id
FROM tanahpedia_entry
WHERE unique_name = 'משה-רבנו';
INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT UUID(),
    'יהושע',
    id
FROM tanahpedia_entry
WHERE unique_name = 'יהושע-בן-נון';
INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT UUID(),
    'הושע בן נון',
    id
FROM tanahpedia_entry
WHERE unique_name = 'יהושע-בן-נון';
INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT UUID(),
    'עלי',
    id
FROM tanahpedia_entry
WHERE unique_name = 'עלי-הכהן';
INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT UUID(),
    'ארץ ישראל',
    id
FROM tanahpedia_entry
WHERE unique_name = 'eretz-yisrael';