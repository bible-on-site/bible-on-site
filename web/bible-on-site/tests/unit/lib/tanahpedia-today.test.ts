/** @jest-environment node */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { query } from "@/lib/api-client";
import { getTodayInTanahEntities } from "@/lib/tanahpedia/service";

jest.mock("@/lib/api-client", () => ({ query: jest.fn() }));

// Execute the production query against relational fixtures instead of mocking
// its results. The anniversary SELECT uses SQL shared by SQLite and MySQL.
let db: DatabaseSync;

beforeEach(() => {
	db = new DatabaseSync(":memory:");
	db.exec(`
		CREATE TABLE tanahpedia_entity (id TEXT PRIMARY KEY, name TEXT, entity_type TEXT);
		CREATE TABLE tanahpedia_entry (id TEXT PRIMARY KEY, unique_name TEXT, title TEXT);
		CREATE TABLE tanahpedia_entry_entity (entity_id TEXT, entry_id TEXT);
		CREATE TABLE tanahpedia_event (id TEXT PRIMARY KEY, entity_id TEXT);
		CREATE TABLE tanahpedia_event_date_range (event_id TEXT, start_date INTEGER, end_date INTEGER);
		CREATE TABLE tanahpedia_saying (id TEXT PRIMARY KEY, entity_id TEXT, saying_date INTEGER);
		CREATE TABLE tanahpedia_person (id TEXT PRIMARY KEY, entity_id TEXT);
		CREATE TABLE tanahpedia_person_birth_date (person_id TEXT, birth_date INTEGER);
		CREATE TABLE tanahpedia_person_death_date (person_id TEXT, death_date INTEGER);
		CREATE TABLE tanahpedia_person_union (person1_id TEXT, person2_id TEXT, start_date INTEGER, end_date INTEGER);
	`);
	jest
		.mocked(query)
		.mockImplementation(
			async (sql, params) =>
				db.prepare(sql).all(...((params ?? []) as SQLInputValue[])) as never[],
		);
});

afterEach(() => db.close());

function entity(id: string, type: string) {
	db.prepare("INSERT INTO tanahpedia_entity VALUES (?, ?, ?)").run(
		id,
		id,
		type,
	);
}

function event(id: string, start: number | null, end: number | null) {
	entity(id, "EVENT");
	db.prepare("INSERT INTO tanahpedia_event VALUES (?, ?)").run(id, id);
	db.prepare("INSERT INTO tanahpedia_event_date_range VALUES (?, ?, ?)").run(
		id,
		start,
		end,
	);
}

function person(id: string) {
	entity(id, "PERSON");
	db.prepare("INSERT INTO tanahpedia_person VALUES (?, ?)").run(id, id);
}

function saying(id: string, date: number | null) {
	entity(id, "SAYING");
	db.prepare("INSERT INTO tanahpedia_saying VALUES (?, ?, ?)").run(
		id,
		id,
		date,
	);
}

test("unites event endpoints, saying dates, births, deaths, and both relationship participants", async () => {
	event("event-start", 24490701, null);
	event("event-end", 24490628, 24490701);
	event("event-spanning", 24490628, 24490702);
	event("event-wrong-month", 24490801, null);
	saying("saying-today", 701); // Known month/day with unknown year.
	saying("saying-wrong-day", 24490702);
	person("birth-today");
	db.prepare("INSERT INTO tanahpedia_person_birth_date VALUES (?, ?)").run(
		"birth-today",
		20010701,
	);
	person("death-today");
	db.prepare("INSERT INTO tanahpedia_person_death_date VALUES (?, ?)").run(
		"death-today",
		24880701,
	);
	for (const id of ["spouse1", "spouse2", "ended1", "ended2", "unrelated"]) {
		person(id);
	}
	db.exec(`
		INSERT INTO tanahpedia_person_union VALUES ('spouse1', 'spouse2', 22000701, NULL);
		INSERT INTO tanahpedia_person_union VALUES ('ended1', 'ended2', 22000628, 22010701);
	`);
	const rows = await getTodayInTanahEntities(7, 1);
	expect(rows.map((row) => row.entityId)).toEqual([
		"birth-today",
		"death-today",
		"ended1",
		"ended2",
		"event-end",
		"event-start",
		"saying-today",
		"spouse1",
		"spouse2",
	]);
});

test("returns each entity once across multiple matching dates and preserves every entry link", async () => {
	person("person");
	db.exec(`
		INSERT INTO tanahpedia_person_birth_date VALUES ('person', 20010701), ('person', 20020701);
		INSERT INTO tanahpedia_person_death_date VALUES ('person', 21010701);
		INSERT INTO tanahpedia_entry VALUES ('a', 'entry-a', 'A'), ('b', 'entry-b', 'B');
		INSERT INTO tanahpedia_entry_entity VALUES ('person', 'a'), ('person', 'b'), ('person', 'a');
	`);
	expect(await getTodayInTanahEntities(7, 1)).toEqual([
		{
			entityId: "person",
			entityName: "person",
			entityType: "PERSON",
			linkedEntries: [
				{ id: "a", uniqueName: "entry-a", title: "A" },
				{ id: "b", uniqueName: "entry-b", title: "B" },
			],
		},
	]);
});

test("keeps the entity name when a linked legacy article has no title", async () => {
	saying("saying-today", 24490701);
	db.exec(`
		INSERT INTO tanahpedia_entry VALUES ('legacy', 'legacy-saying', NULL);
		INSERT INTO tanahpedia_entry_entity VALUES ('saying-today', 'legacy');
	`);
	expect((await getTodayInTanahEntities(7, 1))[0].linkedEntries).toEqual([
		{ id: "legacy", uniqueName: "legacy-saying", title: "saying-today" },
	]);
});

test("excludes incomplete dates and the unknown, not-yet, and forever sentinels", async () => {
	for (const [index, date] of [
		null,
		0,
		-1,
		24480000,
		24480700,
		24480001,
		99991229,
	].entries()) {
		event(`event-${index}`, date, date);
		saying(`saying-${index}`, date);
		person(`person-${index}`);
		db.prepare("INSERT INTO tanahpedia_person_birth_date VALUES (?, ?)").run(
			`person-${index}`,
			date,
		);
		db.prepare("INSERT INTO tanahpedia_person_death_date VALUES (?, ?)").run(
			`person-${index}`,
			date,
		);
		db.prepare("INSERT INTO tanahpedia_person_union VALUES (?, ?, ?, ?)").run(
			`person-${index}`,
			`person-${index}`,
			date,
			date,
		);
	}
	expect(await getTodayInTanahEntities(7, 1)).toEqual([]);
	expect(await getTodayInTanahEntities(12, 29)).toEqual([]);
});

test.each([6, 13, 14])(
	"uses the stored uniform month number %i for Adar",
	async (month) => {
		for (const storedMonth of [6, 13, 14]) {
			saying(`adar-${storedMonth}`, 24000000 + storedMonth * 100 + 7);
		}
		expect(
			(await getTodayInTanahEntities(month, 7)).map((row) => row.entityId),
		).toEqual([`adar-${month}`]);
	},
);
