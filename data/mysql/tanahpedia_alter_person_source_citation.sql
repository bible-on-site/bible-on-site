-- One-time upgrade for databases created before person_source_citation was added
-- to tanahpedia_person_union. Skip if the column already exists (MySQL will
-- error on duplicate column).
--
-- source_citation holds the citation for the UNION/relationship itself (e.g. the
-- commentary source justifying its classification as a marriage).
-- person_source_citation holds the related PERSON's own citation (e.g. the verse
-- where she is first mentioned or her children are born), shown separately when
-- it differs from the relationship citation.
ALTER TABLE tanahpedia_person_union
ADD COLUMN person_source_citation VARCHAR(400) NULL;
