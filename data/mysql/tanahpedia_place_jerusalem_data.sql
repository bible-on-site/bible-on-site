-- First mapped city for Tanahpedia. Add missing rows without replacing content
-- that may already have been edited through the admin API.
SET @jerusalem_entity_id = (
	SELECT id FROM tanahpedia_entity
	WHERE entity_type = 'PLACE' AND name = 'ירושלים' LIMIT 1
);

INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e5000000-0000-4000-8000-000000000001', 'PLACE', 'ירושלים', NOW(), NOW()
WHERE @jerusalem_entity_id IS NULL;

SET @jerusalem_entity_id = (
	SELECT id FROM tanahpedia_entity
	WHERE entity_type = 'PLACE' AND name = 'ירושלים' LIMIT 1
);

INSERT INTO tanahpedia_place (id, entity_id)
SELECT 'pl500000-0000-4000-8000-000000000001', @jerusalem_entity_id
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_place WHERE entity_id = @jerusalem_entity_id
);

SET @jerusalem_place_id = (
	SELECT id FROM tanahpedia_place WHERE entity_id = @jerusalem_entity_id LIMIT 1
);

INSERT INTO tanahpedia_place_identification (
	id, place_id, modern_name, latitude, longitude, alt_group_id
)
SELECT 'pi500000-0000-4000-8000-000000000001',
	@jerusalem_place_id, NULL, 31.7780132, 35.2351364, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_place_identification
	WHERE place_id = @jerusalem_place_id
		AND latitude IS NOT NULL AND longitude IS NOT NULL
);

-- Upgrade the English URL from the first local draft without touching another entry.
UPDATE tanahpedia_entry AS old_entry
LEFT JOIN tanahpedia_entry AS hebrew_entry
	ON hebrew_entry.unique_name = 'ירושלים'
SET old_entry.unique_name = 'ירושלים', old_entry.updated_at = NOW()
WHERE old_entry.id = 'ea500000-0000-4000-8000-000000000001'
	AND old_entry.unique_name = 'jerusalem'
	AND hebrew_entry.id IS NULL;

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea500000-0000-4000-8000-000000000001', 'ירושלים', 'ירושלים',
	'',
	NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = 'ירושלים'
);

-- Clear the text from the first draft while preserving later editorial content.
UPDATE tanahpedia_entry
SET content = '', updated_at = NOW()
WHERE id = 'ea500000-0000-4000-8000-000000000001'
	AND content = '<p>ירושלים היא העיר שדוד קבע כבירת ממלכתו, ובה נבנה בית המקדש בימי שלמה. הנקודה במפה מציינת את מרכז העיר כיום ומשמשת להתמצאות בלבד.</p><h2>ירושלים בתנ״ך</h2><p>דוד כבש את מצודת ציון וקרא לה עיר דוד (<a href="/929/268">שמואל ב ה</a>). לאחר מכן העלה את ארון ה׳ לירושלים (<a href="/929/269">שמואל ב ו</a>). שלמה העלה את הארון לבית המקדש וחנך את הבית (<a href="/929/295">מלכים א ח</a>). תיאור חורבן העיר והמקדש מופיע ב<a href="/929/334">מלכים ב כה</a>.</p>';

SET @jerusalem_entry_id = (
	SELECT id FROM tanahpedia_entry WHERE unique_name = 'ירושלים' LIMIT 1
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee500000-0000-4000-8000-000000000001',
	@jerusalem_entry_id, @jerusalem_entity_id
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @jerusalem_entry_id AND entity_id = @jerusalem_entity_id
);

-- Retire the old notice above the map only in the fixed-ID demo homepage.
UPDATE tanahpedia_category_homepage
SET content = '<p>ברוכים הבאים לקטגוריית המקומות.</p>'
WHERE id = 'ch400000-0000-4000-8000-000000000001'
	AND (content LIKE '%OpenStreetMap ללא מפתח API%'
		OR content LIKE '%המפה מציגה מיקומים גאוגרפיים של מקומות בתנ״ך%');

UPDATE tanahpedia_entry
SET content = SUBSTRING_INDEX(content, '<p>המפה להלן', 1)
WHERE id = 'ea400000-0000-4000-8000-000000000001'
	AND (content LIKE '%OpenStreetMap%'
		OR content LIKE '%המפה להלן מציגה רקע מפה חיצוני%');
