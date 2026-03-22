-- Idempotent lookup rows added after older databases were provisioned.
-- Safe before tanahpedia_family_* scripts (e.g. --tanahpedia-families-only).

INSERT IGNORE INTO `tanahpedia_lookup_union_type` (`id`, `name`) VALUES
('20000000-0000-0000-0000-000000000003', 'FORBIDDEN_WITH_GENTILE'),
('20000000-0000-0000-0000-000000000004', 'BANNED_INCEST'),
('20000000-0000-0000-0000-000000000005', 'BETROTHAL');

INSERT IGNORE INTO `tanahpedia_lookup_parent_child_type` (`id`, `name`) VALUES
('40000000-0000-0000-0000-000000000004', 'FOSTER');
