import {
	type APIRequestContext,
	type APIResponse,
	expect,
	test,
} from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3003";

async function queryApi(
	request: APIRequestContext,
	query: string,
	variables: Record<string, unknown> = {},
) {
	const response: APIResponse = await request.post(ROOT_URL, {
		headers: {
			"Content-Type": "application/json",
		},
		data: {
			operationName: null,
			variables,
			query,
		},
	});
	return response.json();
}

test.describe("TanahpediaEntriesService", () => {
	test.describe("tanahpediaEntries", () => {
		test("returns published entries with default limit", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaEntries { id uniqueName title updatedAt } }",
			);
			expect(body.errors).toBeUndefined();
			expect(Array.isArray(body.data.tanahpediaEntries)).toBe(true);
			expect(body.data.tanahpediaEntries.length).toBeGreaterThan(0);
			expect(body.data.tanahpediaEntries[0].uniqueName).toBeTruthy();
		});

		test("honours limit and offset pagination", async ({ request }) => {
			const first = await queryApi(
				request,
				"query ($limit: Int, $offset: Int) { tanahpediaEntries(limit: $limit, offset: $offset) { uniqueName } }",
				{ limit: 2, offset: 0 },
			);
			const second = await queryApi(
				request,
				"query ($limit: Int, $offset: Int) { tanahpediaEntries(limit: $limit, offset: $offset) { uniqueName } }",
				{ limit: 2, offset: 2 },
			);
			expect(first.errors).toBeUndefined();
			expect(second.errors).toBeUndefined();
			expect(first.data.tanahpediaEntries.length).toBeLessThanOrEqual(2);
			const firstNames = first.data.tanahpediaEntries.map(
				(e: { uniqueName: string }) => e.uniqueName,
			);
			for (const entry of second.data.tanahpediaEntries) {
				expect(firstNames).not.toContain(entry.uniqueName);
			}
		});

		test("clamps an oversized limit without erroring", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaEntries(limit: 99999) { uniqueName } }",
			);
			expect(body.errors).toBeUndefined();
			expect(body.data.tanahpediaEntries.length).toBeLessThanOrEqual(500);
		});
	});

	test.describe("tanahpediaRecentEntries", () => {
		test("returns recently updated entries", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaRecentEntries(limit: 5) { id uniqueName title updatedAt } }",
			);
			expect(body.errors).toBeUndefined();
			expect(Array.isArray(body.data.tanahpediaRecentEntries)).toBe(true);
			expect(body.data.tanahpediaRecentEntries.length).toBeLessThanOrEqual(5);
		});
	});

	test.describe("tanahpediaEntry", () => {
		test("returns the canonical entry with entities and occurrences", async ({
			request,
		}) => {
			const body = await queryApi(
				request,
				`query ($uniqueName: String!) {
					tanahpediaEntry(uniqueName: $uniqueName) {
						uniqueName
						title
						entities { entityId entityType entityName }
						occurrences { perekId pasukNumber }
					}
				}`,
				{ uniqueName: "משה-רבנו" },
			);
			expect(body.errors).toBeUndefined();
			expect(body.data.tanahpediaEntry).not.toBeNull();
			expect(body.data.tanahpediaEntry.uniqueName).toBe("משה-רבנו");
			expect(Array.isArray(body.data.tanahpediaEntry.entities)).toBe(true);
			expect(Array.isArray(body.data.tanahpediaEntry.occurrences)).toBe(true);
		});

		test("returns null for an unknown name", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaEntry(uniqueName: \"__missing__\") { uniqueName } }",
			);
			expect(body.errors).toBeUndefined();
			expect(body.data.tanahpediaEntry).toBeNull();
		});
	});

	test.describe("searchTanahpediaEntries", () => {
		test("returns ranked hits for a name phrase", async ({ request }) => {
			const body = await queryApi(
				request,
				`query ($phrase: String!) {
					searchTanahpediaEntries(phrase: $phrase) {
						id uniqueName title excerpt score
					}
				}`,
				{ phrase: "משה רבנו" },
			);
			expect(body.errors).toBeUndefined();
			const hits = body.data.searchTanahpediaEntries;
			expect(hits.length).toBeGreaterThan(0);
			expect(hits[0].uniqueName).toBe("משה-רבנו");
			// One hit per entry — aliases and disambiguation targets collapse
			// into the canonical entry, never duplicate rows.
			const uniqueNames = hits.map((hit: { uniqueName: string }) => hit.uniqueName);
			expect(new Set(uniqueNames).size).toBe(uniqueNames.length);
			for (const hit of hits) {
				expect(hit.score).toBeGreaterThan(0);
			}
		});

		test("resolves an alias to its canonical entry", async ({ request }) => {
			const body = await queryApi(
				request,
				'{ searchTanahpediaEntries(phrase: "משה") { uniqueName } }',
			);
			expect(body.errors).toBeUndefined();
			const uniqueNames = body.data.searchTanahpediaEntries.map(
				(hit: { uniqueName: string }) => hit.uniqueName,
			);
			expect(uniqueNames).toContain("משה-רבנו");
		});

		test("returns empty for a blank phrase and rejects a bad limit", async ({
			request,
		}) => {
			const blank = await queryApi(
				request,
				'{ searchTanahpediaEntries(phrase: "   ") { uniqueName } }',
			);
			expect(blank.errors).toBeUndefined();
			expect(blank.data.searchTanahpediaEntries).toEqual([]);

			const badLimit = await queryApi(
				request,
				'{ searchTanahpediaEntries(phrase: "משה", limit: 0) { uniqueName } }',
			);
			expect(badLimit.errors).toBeDefined();
		});

		test("scopes hits to selected categories before limiting", async ({
			request,
		}) => {
			// The same phrase scoped to unrelated categories must return no
			// hits while the matching category keeps them — the filter runs
			// inside the candidate query, not on the truncated result set.
			const scopedOut = await queryApi(
				request,
				'{ searchTanahpediaEntries(phrase: "משה", categories: ["PLANT"]) { uniqueName } }',
			);
			expect(scopedOut.errors).toBeUndefined();
			expect(scopedOut.data.searchTanahpediaEntries).toEqual([]);

			const scopedIn = await queryApi(
				request,
				'{ searchTanahpediaEntries(phrase: "משה", categories: ["PERSON", "PROPHET"]) { uniqueName } }',
			);
			expect(scopedIn.errors).toBeUndefined();
			const names = scopedIn.data.searchTanahpediaEntries.map(
				(hit: { uniqueName: string }) => hit.uniqueName,
			);
			expect(names).toContain("משה-רבנו");

			const unknown = await queryApi(
				request,
				'{ searchTanahpediaEntries(phrase: "משה", categories: ["WIZARD"]) { uniqueName } }',
			);
			expect(unknown.errors).toBeDefined();
		});
	});

	test.describe("tanahpediaSynonymTargets", () => {
		test("resolves an alias to its canonical entry", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaSynonymTargets(name: \"משה\") { entryId uniqueName title label } }",
			);
			expect(body.errors).toBeUndefined();
			const uniqueNames = body.data.tanahpediaSynonymTargets.map(
				(t: { uniqueName: string }) => t.uniqueName,
			);
			expect(uniqueNames).toContain("משה-רבנו");
		});

		test("returns empty for an unknown name", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaSynonymTargets(name: \"__missing__\") { uniqueName } }",
			);
			expect(body.errors).toBeUndefined();
			expect(body.data.tanahpediaSynonymTargets).toEqual([]);
		});
	});

	test.describe("tanahpediaCategoryCounts", () => {
		test("returns zero-filled counts for the full taxonomy", async ({
			request,
		}) => {
			const body = await queryApi(
				request,
				"{ tanahpediaCategoryCounts { category count } }",
			);
			expect(body.errors).toBeUndefined();
			const categories = body.data.tanahpediaCategoryCounts.map(
				(row: { category: string }) => row.category,
			);
			for (const key of [
				"PERSON",
				"PROPHET",
				"KING",
				"PLACE",
				"EVENT",
				"WAR",
				"SAYING",
				"PROPHECY",
				"OBJECT",
				"TEMPLE_TOOL",
				"ASTRONOMICAL_OBJECT",
				"ANIMAL",
				"BEHEMA",
				"CHAYA",
				"OF",
				"SHERETZ",
				"TAHOR",
				"TAMEH",
				"PLANT",
				"SEFER",
				"TANAH_SEFER",
				"NATION",
			]) {
				expect(categories).toContain(key);
			}
			for (const row of body.data.tanahpediaCategoryCounts) {
				expect(row.count).toBeGreaterThanOrEqual(0);
			}
		});
	});

	test.describe("tanahpediaEntities", () => {
		test("returns entities with their linked entries", async ({ request }) => {
			const body = await queryApi(
				request,
				`query ($entityType: String!) {
					tanahpediaEntities(entityType: $entityType) {
						entityId entityType entityName
						linkedEntries { id uniqueName title }
					}
				}`,
				{ entityType: "PERSON" },
			);
			expect(body.errors).toBeUndefined();
			expect(body.data.tanahpediaEntities.length).toBeGreaterThan(0);
			expect(body.data.tanahpediaEntities[0].entityName).toBeTruthy();
		});

		test("routes the KING sub to the person role table", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaEntities(entityType: \"PERSON\", sub: \"KING\") { entityType entityName } }",
			);
			expect(body.errors).toBeUndefined();
			for (const entity of body.data.tanahpediaEntities) {
				expect(entity.entityType).toBe("PERSON");
			}
		});

		test("routes the TAHOR sub to the animal purity table", async ({
			request,
		}) => {
			const body = await queryApi(
				request,
				"{ tanahpediaEntities(entityType: \"ANIMAL\", sub: \"TAHOR\") { entityType entityName } }",
			);
			expect(body.errors).toBeUndefined();
			for (const entity of body.data.tanahpediaEntities) {
				expect(entity.entityType).toBe("ANIMAL");
			}
		});

		test("returns empty for an unknown sub", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaEntities(entityType: \"PERSON\", sub: \"BOGUS\") { entityName } }",
			);
			expect(body.errors).toBeUndefined();
			expect(body.data.tanahpediaEntities).toEqual([]);
		});
	});

	test.describe("tanahpediaTodayEntities", () => {
		test("returns entities for a valid Hebrew date", async ({ request }) => {
			const body = await queryApi(
				request,
				`query ($hebrewMonth: Int!, $hebrewDay: Int!) {
					tanahpediaTodayEntities(hebrewMonth: $hebrewMonth, hebrewDay: $hebrewDay) {
						entityId entityName
					}
				}`,
				{ hebrewMonth: 7, hebrewDay: 15 },
			);
			expect(body.errors).toBeUndefined();
			expect(Array.isArray(body.data.tanahpediaTodayEntities)).toBe(true);
		});

		test("returns empty for an out-of-range Hebrew date", async ({
			request,
		}) => {
			const body = await queryApi(
				request,
				"{ tanahpediaTodayEntities(hebrewMonth: 15, hebrewDay: 40) { entityId } }",
			);
			expect(body.errors).toBeUndefined();
			expect(body.data.tanahpediaTodayEntities).toEqual([]);
		});
	});

	test.describe("tanahpediaCategoryHomepage", () => {
		test("returns the configured homepage or null", async ({ request }) => {
			const body = await queryApi(
				request,
				"{ tanahpediaCategoryHomepage(entityType: \"PLACE\") { entityType layoutType content } }",
			);
			expect(body.errors).toBeUndefined();
			expect(body.data).toHaveProperty("tanahpediaCategoryHomepage");
		});
	});
});
