-- Ten canonical Tanah commentators (מפרשי התנ"ך) requested in issue 3770,
-- under the אישים category. One empty canonical entry per person plus the
-- aliases that resolve to it through tanahpedia_entry_synonym. Idempotent:
-- every row is inserted only when missing and existing entities, persons,
-- entries and aliases are reused by name on first seed, while the fixed seed ids
-- win on rerun. An editor can therefore rename seeded rows without the next
-- deploy colliding on those ids or clobbering the editorial rename.
--
-- Requires tanahpedia_person_role_commentator (see
-- tanahpedia_person_role_commentator_upgrade.sql).

-- -------------------------------------------
-- 1. הרב חיים יוסף דוד אזולאי
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000001', 'PERSON', N'הרב חיים יוסף דוד אזולאי', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב חיים יוסף דוד אזולאי'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000001'
);

SET @c1_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000001' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב חיים יוסף דוד אזולאי' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000001', @c1_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c1_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000001'
);

SET @c1_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c1_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000001' LIMIT 1)
);

SET @c1_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000001', @c1_person, N'הרב חיים יוסף דוד אזולאי', @c1_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c1_person AND name_type_id = @c1_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000001', @c1_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c1_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000001', N'הרב-חיים-יוסף-דוד-אזולאי', N'הרב חיים יוסף דוד אזולאי', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-חיים-יוסף-דוד-אזולאי'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000001'
);

SET @c1_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000001' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-חיים-יוסף-דוד-אזולאי' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000001', @c1_entry, @c1_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c1_entry AND entity_id = @c1_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000101', N'החיד"א', @c1_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'החיד"א' AND entry_id = @c1_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000102', N'חיד"א', @c1_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'חיד"א' AND entry_id = @c1_entry
);

-- -------------------------------------------
-- 2. הרב מאיר שמחה הכהן מדבינסק
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000002', 'PERSON', N'הרב מאיר שמחה הכהן מדבינסק', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב מאיר שמחה הכהן מדבינסק'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000002'
);

SET @c2_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000002' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב מאיר שמחה הכהן מדבינסק' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000002', @c2_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c2_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000002'
);

SET @c2_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c2_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000002' LIMIT 1)
);

SET @c2_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000002', @c2_person, N'הרב מאיר שמחה הכהן מדבינסק', @c2_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c2_person AND name_type_id = @c2_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000002', @c2_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c2_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000002', N'הרב-מאיר-שמחה-הכהן-מדבינסק', N'הרב מאיר שמחה הכהן מדבינסק', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-מאיר-שמחה-הכהן-מדבינסק'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000002'
);

SET @c2_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000002' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-מאיר-שמחה-הכהן-מדבינסק' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000002', @c2_entry, @c2_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c2_entry AND entity_id = @c2_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000201', N'האור שמח', @c2_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'האור שמח' AND entry_id = @c2_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000202', N'בעל אור שמח', @c2_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'בעל אור שמח' AND entry_id = @c2_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000203', N'בעל משך חכמה', @c2_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'בעל משך חכמה' AND entry_id = @c2_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000204', N'מאיר שמחה הכהן מדווינסק', @c2_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'מאיר שמחה הכהן מדווינסק' AND entry_id = @c2_entry
);

-- -------------------------------------------
-- 3. הרב יעקב צבי מקלנבורג
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000003', 'PERSON', N'הרב יעקב צבי מקלנבורג', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב יעקב צבי מקלנבורג'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000003'
);

SET @c3_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000003' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב יעקב צבי מקלנבורג' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000003', @c3_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c3_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000003'
);

SET @c3_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c3_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000003' LIMIT 1)
);

SET @c3_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000003', @c3_person, N'הרב יעקב צבי מקלנבורג', @c3_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c3_person AND name_type_id = @c3_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000003', @c3_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c3_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000003', N'הרב-יעקב-צבי-מקלנבורג', N'הרב יעקב צבי מקלנבורג', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-יעקב-צבי-מקלנבורג'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000003'
);

SET @c3_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000003' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-יעקב-צבי-מקלנבורג' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000003', @c3_entry, @c3_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c3_entry AND entity_id = @c3_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000301', N'יעקב צבי מעקלענבורג', @c3_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'יעקב צבי מעקלענבורג' AND entry_id = @c3_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000302', N'בעל הכתב והקבלה', @c3_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'בעל הכתב והקבלה' AND entry_id = @c3_entry
);

-- -------------------------------------------
-- 4. הרב ברוך הלוי אפשטיין
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000004', 'PERSON', N'הרב ברוך הלוי אפשטיין', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב ברוך הלוי אפשטיין'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000004'
);

SET @c4_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000004' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב ברוך הלוי אפשטיין' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000004', @c4_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c4_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000004'
);

SET @c4_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c4_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000004' LIMIT 1)
);

SET @c4_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000004', @c4_person, N'הרב ברוך הלוי אפשטיין', @c4_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c4_person AND name_type_id = @c4_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000004', @c4_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c4_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000004', N'הרב-ברוך-הלוי-אפשטיין', N'הרב ברוך הלוי אפשטיין', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-ברוך-הלוי-אפשטיין'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000004'
);

SET @c4_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000004' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-ברוך-הלוי-אפשטיין' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000004', @c4_entry, @c4_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c4_entry AND entity_id = @c4_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000401', N'ברוך הלוי עפשטיין', @c4_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'ברוך הלוי עפשטיין' AND entry_id = @c4_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000402', N'בעל תורה תמימה', @c4_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'בעל תורה תמימה' AND entry_id = @c4_entry
);

-- -------------------------------------------
-- 5. הרב אשר וסרטיל
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000005', 'PERSON', N'הרב אשר וסרטיל', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב אשר וסרטיל'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000005'
);

SET @c5_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000005' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב אשר וסרטיל' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000005', @c5_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c5_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000005'
);

SET @c5_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c5_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000005' LIMIT 1)
);

SET @c5_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000005', @c5_person, N'הרב אשר וסרטיל', @c5_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c5_person AND name_type_id = @c5_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000005', @c5_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c5_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000005', N'הרב-אשר-וסרטיל', N'הרב אשר וסרטיל', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-אשר-וסרטיל'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000005'
);

SET @c5_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000005' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-אשר-וסרטיל' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000005', @c5_entry, @c5_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c5_entry AND entity_id = @c5_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000501', N'אשר וסרטיל', @c5_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'אשר וסרטיל' AND entry_id = @c5_entry
);

-- -------------------------------------------
-- 6. הרב משה איסרליש
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000006', 'PERSON', N'הרב משה איסרליש', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב משה איסרליש'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000006'
);

SET @c6_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000006' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב משה איסרליש' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000006', @c6_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c6_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000006'
);

SET @c6_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c6_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000006' LIMIT 1)
);

SET @c6_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000006', @c6_person, N'הרב משה איסרליש', @c6_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c6_person AND name_type_id = @c6_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000006', @c6_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c6_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000006', N'הרב-משה-איסרליש', N'הרב משה איסרליש', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-משה-איסרליש'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000006'
);

SET @c6_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000006' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-משה-איסרליש' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000006', @c6_entry, @c6_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c6_entry AND entity_id = @c6_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000601', N'רמ"א', @c6_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'רמ"א' AND entry_id = @c6_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000602', N'הרמ"א', @c6_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הרמ"א' AND entry_id = @c6_entry
);

-- -------------------------------------------
-- 7. הרב נפתלי צבי יהודה ברלין
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000007', 'PERSON', N'הרב נפתלי צבי יהודה ברלין', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב נפתלי צבי יהודה ברלין'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000007'
);

SET @c7_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000007' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב נפתלי צבי יהודה ברלין' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000007', @c7_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c7_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000007'
);

SET @c7_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c7_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000007' LIMIT 1)
);

SET @c7_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000007', @c7_person, N'הרב נפתלי צבי יהודה ברלין', @c7_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c7_person AND name_type_id = @c7_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000007', @c7_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c7_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000007', N'הרב-נפתלי-צבי-יהודה-ברלין', N'הרב נפתלי צבי יהודה ברלין', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-נפתלי-צבי-יהודה-ברלין'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000007'
);

SET @c7_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000007' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-נפתלי-צבי-יהודה-ברלין' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000007', @c7_entry, @c7_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c7_entry AND entity_id = @c7_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000701', N'נצי"ב', @c7_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'נצי"ב' AND entry_id = @c7_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000702', N'הנצי"ב', @c7_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הנצי"ב' AND entry_id = @c7_entry
);

-- -------------------------------------------
-- 8. הרב אליהו בן שלמה זלמן
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000008', 'PERSON', N'הרב אליהו בן שלמה זלמן', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב אליהו בן שלמה זלמן'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000008'
);

SET @c8_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000008' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב אליהו בן שלמה זלמן' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000008', @c8_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c8_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000008'
);

SET @c8_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c8_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000008' LIMIT 1)
);

SET @c8_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000008', @c8_person, N'הרב אליהו בן שלמה זלמן', @c8_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c8_person AND name_type_id = @c8_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000008', @c8_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c8_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000008', N'הרב-אליהו-בן-שלמה-זלמן', N'הרב אליהו בן שלמה זלמן', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-אליהו-בן-שלמה-זלמן'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000008'
);

SET @c8_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000008' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-אליהו-בן-שלמה-זלמן' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000008', @c8_entry, @c8_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c8_entry AND entity_id = @c8_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000801', N'הגר"א', @c8_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הגר"א' AND entry_id = @c8_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000802', N'הגאון מוילנא', @c8_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הגאון מוילנא' AND entry_id = @c8_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000803', N'הגאון מוילנה', @c8_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הגאון מוילנה' AND entry_id = @c8_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000804', N'הגר"א מוילנא', @c8_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הגר"א מוילנא' AND entry_id = @c8_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000805', N'הגר"א מוילנה', @c8_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הגר"א מוילנה' AND entry_id = @c8_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000806', N'הגאון ר'' אליהו מוילנא', @c8_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הגאון ר'' אליהו מוילנא' AND entry_id = @c8_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000807', N'הגאון ר'' אליהו מוילנה', @c8_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הגאון ר'' אליהו מוילנה' AND entry_id = @c8_entry
);

-- -------------------------------------------
-- 9. הרב מאיר ליבוש בן יחיאל מיכל וייזר
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000009', 'PERSON', N'הרב מאיר ליבוש בן יחיאל מיכל וייזר', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב מאיר ליבוש בן יחיאל מיכל וייזר'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000009'
);

SET @c9_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000009' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב מאיר ליבוש בן יחיאל מיכל וייזר' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000009', @c9_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c9_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000009'
);

SET @c9_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c9_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000009' LIMIT 1)
);

SET @c9_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000009', @c9_person, N'הרב מאיר ליבוש בן יחיאל מיכל וייזר', @c9_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c9_person AND name_type_id = @c9_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000009', @c9_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c9_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000009', N'הרב-מאיר-ליבוש-בן-יחיאל-מיכל-וייזר', N'הרב מאיר ליבוש בן יחיאל מיכל וייזר', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-מאיר-ליבוש-בן-יחיאל-מיכל-וייזר'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000009'
);

SET @c9_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000009' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-מאיר-ליבוש-בן-יחיאל-מיכל-וייזר' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000009', @c9_entry, @c9_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c9_entry AND entity_id = @c9_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000901', N'מלבי"ם', @c9_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'מלבי"ם' AND entry_id = @c9_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000000902', N'המלבי"ם', @c9_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'המלבי"ם' AND entry_id = @c9_entry
);

-- -------------------------------------------
-- 10. הרב יוסף רוזין
-- -------------------------------------------
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at)
SELECT 'e6c00000-0000-4000-8000-000000000010', 'PERSON', N'הרב יוסף רוזין', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity
	WHERE entity_type = 'PERSON' AND name = N'הרב יוסף רוזין'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000010'
);

SET @c10_entity = COALESCE(
	(SELECT id FROM tanahpedia_entity WHERE id = 'e6c00000-0000-4000-8000-000000000010' LIMIT 1),
	(SELECT id FROM tanahpedia_entity
	 WHERE entity_type = 'PERSON' AND name = N'הרב יוסף רוזין' LIMIT 1)
);

INSERT INTO tanahpedia_person (id, entity_id)
SELECT 'p6c00000-0000-4000-8000-000000000010', @c10_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE entity_id = @c10_entity
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000010'
);

SET @c10_person = COALESCE(
	(SELECT id FROM tanahpedia_person WHERE entity_id = @c10_entity LIMIT 1),
	(SELECT id FROM tanahpedia_person WHERE id = 'p6c00000-0000-4000-8000-000000000010' LIMIT 1)
);

SET @c10_main_name_type = (
	SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1
);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
SELECT 'n6c00000-0000-4000-8000-000000000010', @c10_person, N'הרב יוסף רוזין', @c10_main_name_type, NULL
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_name
	WHERE person_id = @c10_person AND name_type_id = @c10_main_name_type
		AND alt_group_id IS NULL
);

INSERT INTO tanahpedia_person_role_commentator (id, person_id)
SELECT 'r6c00000-0000-4000-8000-000000000010', @c10_person
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_person_role_commentator
	WHERE person_id = @c10_person
);

INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at)
SELECT 'ea6c0000-0000-4000-8000-000000000010', N'הרב-יוסף-רוזין', N'הרב יוסף רוזין', '', NOW(), NOW()
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE unique_name = N'הרב-יוסף-רוזין'
) AND NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000010'
);

SET @c10_entry = COALESCE(
	(SELECT id FROM tanahpedia_entry WHERE id = 'ea6c0000-0000-4000-8000-000000000010' LIMIT 1),
	(SELECT id FROM tanahpedia_entry WHERE unique_name = N'הרב-יוסף-רוזין' LIMIT 1)
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id)
SELECT 'ee6c0000-0000-4000-8000-000000000010', @c10_entry, @c10_entity
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_entity
	WHERE entry_id = @c10_entry AND entity_id = @c10_entity
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000001001', N'הרוגצ''ובר', @c10_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הרוגצ''ובר' AND entry_id = @c10_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000001002', N'רוגצ''ובר', @c10_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'רוגצ''ובר' AND entry_id = @c10_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000001003', N'הרוגצ''ובי', @c10_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'הרוגצ''ובי' AND entry_id = @c10_entry
);

INSERT INTO tanahpedia_entry_synonym (id, name, entry_id)
SELECT 's6c00000-0000-4000-8000-000000001004', N'רוגצ''ובי', @c10_entry
WHERE NOT EXISTS (
	SELECT 1 FROM tanahpedia_entry_synonym
	WHERE name = N'רוגצ''ובי' AND entry_id = @c10_entry
);
