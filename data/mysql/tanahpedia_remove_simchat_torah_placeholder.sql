-- Remove the seeded reading-cycle placeholder: it is not a biblical event.
-- Delete children explicitly because the deployment runner disables FK checks.
DELETE FROM tanahpedia_event_date_range WHERE event_id = 'ev-simchat-torah-001';
DELETE FROM tanahpedia_event_place WHERE event_id = 'ev-simchat-torah-001';
DELETE FROM tanahpedia_event WHERE id = 'ev-simchat-torah-001';
DELETE FROM tanahpedia_entry_entity WHERE entity_id = 'evt-simchat-torah-001';
DELETE FROM tanahpedia_entity_tanah_source WHERE entity_id = 'evt-simchat-torah-001';
DELETE FROM tanahpedia_entity WHERE id = 'evt-simchat-torah-001';
