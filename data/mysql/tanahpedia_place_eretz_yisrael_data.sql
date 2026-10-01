-- ערך מקום: ארץ ישראל — ישות PLACE + זיהוי גאוגרפי + דף קטגוריה MAP.
-- אידמפוטנטי: UUIDs קבועים e400… / pl400… / pi400… / ea400… / ee400… / ch400…
--
-- הרצה: חלק מ־db-populator אחרי יעקב (cargo make mysql-populate-dev / mysql-apply-tanahpedia-families).

DELETE FROM tanahpedia_place_identification
WHERE id = 'pi400000-0000-4000-8000-000000000001';

DELETE FROM tanahpedia_place
WHERE id = 'pl400000-0000-4000-8000-000000000001';

DELETE FROM tanahpedia_entry_entity
WHERE id = 'ee400000-0000-4000-8000-000000000001';

DELETE FROM tanahpedia_entry
WHERE id = 'ea400000-0000-4000-8000-000000000001';

DELETE FROM tanahpedia_entity
WHERE id = 'e4000000-0000-4000-8000-000000000001';

INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at) VALUES
	('e4000000-0000-4000-8000-000000000001', 'PLACE', 'ארץ ישראל', NOW(), NOW());

INSERT INTO tanahpedia_place (id, entity_id) VALUES
	('pl400000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001');

-- ירושלים: נקודת ייחוס גאוגרפית בלבד (אין שרטוט גבול על ידי האתר)
INSERT INTO tanahpedia_place_identification (
	id,
	place_id,
	modern_name,
	latitude,
	longitude,
	alt_group_id
) VALUES (
	'pi400000-0000-4000-8000-000000000001',
	'pl400000-0000-4000-8000-000000000001',
	'נקודת ייחוס גאוגרפית (ירושלים)',
	31.7780132,
	35.2351364,
	NULL
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at) VALUES (
	'ea400000-0000-4000-8000-000000000001',
	'eretz-yisrael',
	'ארץ ישראל',
	'',
	NOW(),
	NOW()
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id) VALUES
	('ee400000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001');

-- דף קטגוריית מקומות: פריסת MAP
INSERT INTO tanahpedia_category_homepage (
	id,
	entity_type,
	layout_type,
	config,
	content,
	updated_at
) VALUES (
	'ch400000-0000-4000-8000-000000000001',
	'PLACE',
	'MAP',
	NULL,
	'<p>ברוכים הבאים לקטגוריית המקומות.</p>',
	NOW()
) ON DUPLICATE KEY UPDATE
	layout_type = VALUES(layout_type),
	config = VALUES(config),
	content = VALUES(content),
	updated_at = NOW();
