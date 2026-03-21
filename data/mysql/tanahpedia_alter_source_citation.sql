-- One-time upgrade for databases created before source_citation was added to family tables.
-- Skip if columns already exist (MySQL will error on duplicate column).

ALTER TABLE tanahpedia_person_union
	ADD COLUMN source_citation VARCHAR(400) NULL;

ALTER TABLE tanahpedia_person_parent_child
	ADD COLUMN source_citation VARCHAR(400) NULL;
