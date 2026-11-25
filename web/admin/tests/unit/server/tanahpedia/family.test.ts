import type { PoolConnection } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, queryMock, queryOneMock } = vi.hoisted(() => ({
	executeMock: vi.fn(),
	queryMock: vi.fn(),
	queryOneMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
	createServerOnlyFn: (fn: unknown) => fn,
}));

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
	transaction: <T>(fn: (conn: PoolConnection) => Promise<T>) =>
		fn({} as PoolConnection),
	txExecute: (_conn: PoolConnection, ...args: unknown[]) =>
		executeMock(...args),
	txQuery: (_conn: PoolConnection, ...args: unknown[]) => queryMock(...args),
	txQueryOne: (_conn: PoolConnection, ...args: unknown[]) =>
		queryOneMock(...args),
}));

import {
	createFamilyPersonNode,
	createParentChildLink,
	createPersonName,
	createUnionLink,
	deleteFamilyPersonNode,
	deleteParentChildLink,
	deletePersonName,
	deleteUnionLink,
	getFamilyLookups,
	updateFamilyPersonNode,
	updateParentChildLink,
	updatePersonName,
	updateUnionLink,
} from "~/server/tanahpedia/family";
import { __resetRevalidateForTests } from "~/server/website-revalidate";

describe("tanahpedia family api", () => {
	beforeEach(() => {
		executeMock.mockReset();
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
	});

	it("creates person node with trimmed name and optional entry link", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "name-type-main" });
		executeMock.mockResolvedValue(undefined);

		const result = await createFamilyPersonNode({
			data: {
				displayName: "  Jacob  ",
				sex: "male" as unknown as "MALE",
				linkToEntryId: "entry-1",
			},
		});

		expect(result.entityId).toBeTruthy();
		expect(result.personId).toBeTruthy();
		expect(result.linkId).toBeTruthy();
		expect(executeMock).toHaveBeenCalledTimes(5);
		expect(executeMock.mock.calls[0]?.[1]).toEqual([result.entityId, "Jacob"]);
		expect(executeMock.mock.calls[3]?.[1]?.[2]).toBe("MALE");
	});

	it("rejects invalid person sex", async () => {
		await expect(
			createFamilyPersonNode({
				data: {
					displayName: "Jacob",
					sex: "other" as unknown as "MALE",
				},
			}),
		).rejects.toThrow("sex must be MALE, FEMALE, UNKNOWN, or null");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects a blank required field", async () => {
		await expect(
			createFamilyPersonNode({ data: { displayName: "   " } }),
		).rejects.toThrow("displayName is required");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("throws when the MAIN name type lookup row is missing", async () => {
		queryOneMock.mockResolvedValueOnce(null);

		await expect(
			createFamilyPersonNode({ data: { displayName: "Jacob" } }),
		).rejects.toThrow("Missing tanahpedia_lookup_name_type row for MAIN");
	});

	it("creates a person node without sex or entry link", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "name-type-main" });
		executeMock.mockResolvedValue(undefined);

		const result = await createFamilyPersonNode({
			data: { displayName: "Jacob" },
		});

		expect(result.linkId).toBeNull();
		expect(executeMock).toHaveBeenCalledTimes(3);
	});

	it("creates a person node with biographical fields and roles", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "name-type-main" })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		executeMock.mockResolvedValue(undefined);

		await createFamilyPersonNode({
			data: {
				displayName: "Moses",
				birthDate: 100,
				deathDate: 200,
				deathCause: "old age",
				birthPlaceId: "place-1",
				isProphet: true,
				isKing: true,
			},
		});

		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("tanahpedia_person_birth_date"),
			expect.arrayContaining([100]),
		);
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("tanahpedia_person_death_date"),
			expect.arrayContaining([200]),
		);
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("tanahpedia_person_death_cause"),
			expect.arrayContaining(["old age"]),
		);
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("tanahpedia_person_birth_place"),
			expect.arrayContaining(["place-1"]),
		);
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("tanahpedia_person_role_prophet"),
			expect.any(Array),
		);
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("tanahpedia_person_role_king"),
			expect.any(Array),
		);
	});

	it("rejects a whitespace-only deathCause on create", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "name-type-main" });

		await expect(
			createFamilyPersonNode({
				data: { displayName: "Moses", deathCause: "   " },
			}),
		).rejects.toThrow("deathCause is required");
	});

	it("rejects a linked birth place together with free text on create", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "name-type-main" });

		await expect(
			createFamilyPersonNode({
				data: {
					displayName: "Moses",
					birthPlaceId: "place-1",
					birthPlaceText: "דבינסק",
				},
			}),
		).rejects.toThrow("provide either a linked place or free text");
	});

	it("rejects an empty activity place entry on create", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "name-type-main" });

		await expect(
			createFamilyPersonNode({
				data: {
					displayName: "Moses",
					activityPlaces: [{ placeId: null, placeText: "  " }],
				},
			}),
		).rejects.toThrow(
			"activityPlaces[0]: a linked place or free text is required",
		);
	});

	it("creates free-text and linked place facts and activity places", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "name-type-main" })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		executeMock.mockResolvedValue(undefined);

		await createFamilyPersonNode({
			data: {
				displayName: "Mordechai",
				birthPlaceText: " דבינסק ",
				deathPlaceId: "place-9",
				activityPlaces: [{ placeId: "place-1" }, { placeText: "שושן" }],
			},
		});

		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO tanahpedia_person_birth_place"),
			expect.arrayContaining([null, "דבינסק"]),
		);
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO tanahpedia_person_death_place"),
			expect.arrayContaining(["place-9", null]),
		);
		// A fresh person has no existing activity rows, so nothing is deleted
		// and every listed place inserts under a new id.
		expect(
			executeMock.mock.calls.some(([sql]) =>
				String(sql).startsWith("DELETE FROM tanahpedia_person_activity_place"),
			),
		).toBe(false);
		const activityInserts = executeMock.mock.calls.filter(([sql]) =>
			String(sql).startsWith("INSERT INTO tanahpedia_person_activity_place"),
		);
		expect(activityInserts).toHaveLength(2);
		expect(activityInserts[0]?.[1]).toEqual(
			expect.arrayContaining(["place-1", null]),
		);
		expect(activityInserts[1]?.[1]).toEqual(
			expect.arrayContaining([null, "שושן"]),
		);
	});

	it("creates parent-child link with lookup ids", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "rel-bio" })
			.mockResolvedValueOnce({ id: "role-father" });
		executeMock.mockResolvedValue(undefined);

		const result = await createParentChildLink({
			data: {
				parentPersonId: "parent-1",
				childPersonId: "child-1",
				relationshipType: "BIOLOGICAL",
				parentRole: "FATHER",
				sourceCitation: "Gen 25",
			},
		});

		expect(result.id).toBeTruthy();
		expect(queryOneMock).toHaveBeenCalledTimes(2);
		expect(executeMock).toHaveBeenCalledTimes(1);
		expect(executeMock.mock.calls[0]?.[1]).toEqual([
			result.id,
			"parent-1",
			"child-1",
			"rel-bio",
			"role-father",
			null,
			"Gen 25",
		]);
	});

	it("rejects invalid relationship type", async () => {
		await expect(
			createParentChildLink({
				data: {
					parentPersonId: "parent-1",
					childPersonId: "child-1",
					relationshipType: "INVALID" as unknown as "BIOLOGICAL",
					parentRole: "FATHER",
				},
			}),
		).rejects.toThrow("Invalid relationshipType");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects invalid parent role", async () => {
		await expect(
			createParentChildLink({
				data: {
					parentPersonId: "parent-1",
					childPersonId: "child-1",
					relationshipType: "BIOLOGICAL",
					parentRole: "INVALID" as unknown as "FATHER",
				},
			}),
		).rejects.toThrow("Invalid parentRole");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("throws when a lookup row is missing", async () => {
		queryOneMock.mockResolvedValueOnce(null);

		await expect(
			createParentChildLink({
				data: {
					parentPersonId: "parent-1",
					childPersonId: "child-1",
					relationshipType: "BIOLOGICAL",
					parentRole: "FATHER",
				},
			}),
		).rejects.toThrow(
			"Missing tanahpedia_lookup_parent_child_type row for BIOLOGICAL",
		);
	});

	it("creates a parent-child link without altGroupId or sourceCitation", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "rel-bio" })
			.mockResolvedValueOnce({ id: "role-father" });
		executeMock.mockResolvedValue(undefined);

		const result = await createParentChildLink({
			data: {
				parentPersonId: "parent-1",
				childPersonId: "child-1",
				relationshipType: "BIOLOGICAL",
				parentRole: "FATHER",
			},
		});

		expect(executeMock.mock.calls[0]?.[1]).toEqual([
			result.id,
			"parent-1",
			"child-1",
			"rel-bio",
			"role-father",
			null,
			null,
		]);
	});

	it("rejects union where both people are identical", async () => {
		await expect(
			createUnionLink({
				data: {
					person1Id: "same-person",
					person2Id: "same-person",
					unionType: "MARRIAGE",
				},
			}),
		).rejects.toThrow("person1Id and person2Id must be different");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects invalid union type", async () => {
		await expect(
			createUnionLink({
				data: {
					person1Id: "p1",
					person2Id: "p2",
					unionType: "INVALID" as unknown as "MARRIAGE",
				},
			}),
		).rejects.toThrow("Invalid unionType");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("rejects invalid end reason on create", async () => {
		await expect(
			createUnionLink({
				data: {
					person1Id: "p1",
					person2Id: "p2",
					unionType: "MARRIAGE",
					endReason: "INVALID" as unknown as "DEATH",
				},
			}),
		).rejects.toThrow("Invalid endReason");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("creates a union link without end reason or optional fields", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "union-marriage" });
		executeMock.mockResolvedValue(undefined);

		const result = await createUnionLink({
			data: { person1Id: "p1", person2Id: "p2", unionType: "MARRIAGE" },
		});

		expect(executeMock.mock.calls[0]?.[1]).toEqual([
			result.id,
			"p1",
			"p2",
			"union-marriage",
			null,
			null,
			null,
			null,
			null,
			null,
		]);
	});

	it("creates union link with end reason lookup", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "end-death" })
			.mockResolvedValueOnce({ id: "union-marriage" });
		executeMock.mockResolvedValue(undefined);

		const result = await createUnionLink({
			data: {
				person1Id: "p1",
				person2Id: "p2",
				unionType: "MARRIAGE",
				endReason: "DEATH",
				unionOrder: 2,
				sourceCitation: "Gen 29",
			},
		});

		expect(result.id).toBeTruthy();
		expect(executeMock).toHaveBeenCalledTimes(1);
		expect(executeMock.mock.calls[0]?.[1]).toEqual([
			result.id,
			"p1",
			"p2",
			"union-marriage",
			2,
			null,
			null,
			"end-death",
			null,
			"Gen 29",
		]);
	});

	it("returns lookup lists grouped by table", async () => {
		queryMock
			.mockResolvedValueOnce([{ id: "rt-1", name: "BIOLOGICAL" }])
			.mockResolvedValueOnce([{ id: "pr-1", name: "FATHER" }])
			.mockResolvedValueOnce([{ id: "ut-1", name: "MARRIAGE" }])
			.mockResolvedValueOnce([{ id: "er-1", name: "DEATH" }]);

		const lookups = await getFamilyLookups();

		expect(lookups).toEqual({
			relationshipTypes: [{ id: "rt-1", name: "BIOLOGICAL" }],
			parentRoles: [{ id: "pr-1", name: "FATHER" }],
			unionTypes: [{ id: "ut-1", name: "MARRIAGE" }],
			unionEndReasons: [{ id: "er-1", name: "DEATH" }],
		});
	});

	describe("updateFamilyPersonNode", () => {
		it("updates display name and propagates to the main person name", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({ id: "name-type-main" });
			executeMock.mockResolvedValueOnce(undefined);

			const result = await updateFamilyPersonNode({
				data: { entityId: "entity-1", displayName: "  Israel  " },
			});

			expect(result).toEqual({ entityId: "entity-1" });
			expect(executeMock.mock.calls[0]).toEqual([
				"UPDATE tanahpedia_entity SET name = ? WHERE id = ?",
				["Israel", "entity-1"],
			]);
			expect(executeMock.mock.calls[1]?.[1]).toEqual([
				"Israel",
				"person-1",
				"name-type-main",
			]);
		});

		it("throws when entity is not found while updating display name", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 0 });

			await expect(
				updateFamilyPersonNode({
					data: { entityId: "missing", displayName: "Israel" },
				}),
			).rejects.toThrow("Person entity not found: missing");
		});

		it("inserts a new sex row when none exists", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce(null);
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: { entityId: "entity-1", sex: "male" as unknown as "MALE" },
			});

			expect(executeMock.mock.calls[0]?.[0]).toContain(
				"INSERT INTO tanahpedia_person_sex",
			);
			expect(executeMock.mock.calls[0]?.[1]?.[2]).toBe("MALE");
		});

		it("updates an existing sex row", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({ id: "sex-1" });
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: { entityId: "entity-1", sex: "FEMALE" },
			});

			expect(executeMock.mock.calls[0]).toEqual([
				"UPDATE tanahpedia_person_sex SET sex = ? WHERE id = ?",
				["FEMALE", "sex-1"],
			]);
		});

		it("clears sex when explicitly set to null", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: { entityId: "entity-1", sex: null },
			});

			expect(executeMock.mock.calls[0]).toEqual([
				"DELETE FROM tanahpedia_person_sex WHERE person_id = ?",
				["person-1"],
			]);
		});

		it("throws when no fields are provided", async () => {
			await expect(
				updateFamilyPersonNode({ data: { entityId: "entity-1" } }),
			).rejects.toThrow("At least one field must be provided to update");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects a whitespace-only deathCause on update", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });

			await expect(
				updateFamilyPersonNode({
					data: { entityId: "entity-1", deathCause: "   " },
				}),
			).rejects.toThrow("deathCause is required");
		});

		it("rejects a linked birth place together with free text on update", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						birthPlaceId: "place-1",
						birthPlaceText: "דבינסק",
					},
				}),
			).rejects.toThrow("provide either a linked place or free text");
		});

		it("clears the birth place when only whitespace is sent", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({
					id: "b1",
					place_id: "place-9",
					place_text: null,
				});
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: { entityId: "entity-1", birthPlaceId: "   " },
			});

			// Only the checked canonical row is cleared — hidden alternate-opinion
			// rows belong to other opinion groups and must survive the save.
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_birth_place WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["b1", "person-1"],
			);
		});

		it("replaces activity places and clears the death place", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({
					id: "d1",
					place_id: "place-3",
					place_text: null,
				});
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					deathPlaceId: null,
					activityPlaces: [{ placeId: "place-1" }, { placeText: "שושן" }],
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_death_place WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["d1", "person-1"],
			);
			// With no existing canonical rows there is nothing to delete — the
			// sent places all insert as new rows.
			const activityInserts = executeMock.mock.calls.filter(([sql]) =>
				String(sql).startsWith("INSERT INTO tanahpedia_person_activity_place"),
			);
			expect(activityInserts).toHaveLength(2);
		});

		it("rejects an empty activity place entry", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						activityPlaces: [{ placeId: null, placeText: "  " }],
					},
				}),
			).rejects.toThrow(
				"activityPlaces[0]: a linked place or free text is required",
			);
		});

		it("clears all activity places when null is sent", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValue(null);
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [
								{ id: "a1", place_id: "place-1", place_text: null },
								{ id: "a2", place_id: null, place_text: "חרן" },
							]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: { entityId: "entity-1", activityPlaces: null },
			});

			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_activity_place WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["a1", "person-1"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_activity_place WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["a2", "person-1"],
			);
			expect(
				executeMock.mock.calls.some(([sql]) =>
					String(sql).startsWith(
						"INSERT INTO tanahpedia_person_activity_place",
					),
				),
			).toBe(false);
		});

		it("reconciles activity places in place, keeping row ids stable", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValue(null);
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [
								{ id: "a1", place_id: "place-1", place_text: null },
								{ id: "a2", place_id: "place-5", place_text: null },
								{ id: "a3", place_id: "place-7", place_text: null },
							]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					activityPlaces: [
						{ id: "a1", placeId: "place-1" },
						{ id: "a2", placeText: "חרן" },
						{ placeId: "place-9" },
					],
				},
			});

			// The canonical rows were locked FOR UPDATE before reconciling so a
			// contribution merge cannot move one between the read and the writes.
			expect(queryMock).toHaveBeenCalledWith(
				expect.stringContaining("FOR UPDATE"),
				["person-1"],
			);
			// a2 changed in place — its id stays so citations remain attached.
			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_activity_place SET place_id = ?, place_text = ? WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				[null, "חרן", "a2", "person-1"],
			);
			// a3 was removed after the dependent/source guard ran.
			expect(queryOneMock).toHaveBeenCalledWith(
				"SELECT id FROM tanahpedia_source_group WHERE target_table=? AND target_id=? LIMIT 1 FOR SHARE NOWAIT",
				["tanahpedia_person_activity_place", "a3"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_activity_place WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["a3", "person-1"],
			);
			// a1 was unchanged — no UPDATE ran against it.
			expect(
				executeMock.mock.calls.some(
					([sql, params]) =>
						String(sql).startsWith("UPDATE tanahpedia_person_activity_place") &&
						(params as unknown[])[2] === "a1",
				),
			).toBe(false);
			// The new entry (no id) inserted exactly once.
			const inserts = executeMock.mock.calls.filter(([sql]) =>
				String(sql).startsWith("INSERT INTO tanahpedia_person_activity_place"),
			);
			expect(inserts).toHaveLength(1);
			expect(inserts[0]?.[1]).toEqual([
				expect.any(String),
				"person-1",
				"place-9",
				null,
			]);
		});

		it("rejects an activity place id that stopped being canonical", async () => {
			// The editor kept row "a9" but a contribution review already moved it
			// out of the canonical opinion group, so the locked read no longer
			// returns it — fail loudly instead of overwriting the reviewed row.
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [{ id: "a1", place_id: "place-1", place_text: null }]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						activityPlaces: [{ id: "a9", placeId: "place-9" }],
					},
				}),
			).rejects.toThrow("no longer a canonical activity place");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects when the locked activity list gained a row the editor never saw", async () => {
			// The editor loaded one activity row; a contribution merge committed
			// another canonical row before the FOR UPDATE read. The unseen row
			// is neither kept nor in removedActivityPlaces — reject rather than
			// delete a row the editor never saw.
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [
								{ id: "a1", place_id: "place-1", place_text: null },
								{ id: "a9", place_id: "place-9", place_text: null },
							]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						activityPlaces: [{ id: "a1", placeId: "place-1" }],
						removedActivityPlaces: [],
					},
				}),
			).rejects.toThrow("canonical list changed since the editor loaded it");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects when a kept activity row's content changed since the editor loaded it", async () => {
			// A contribution merge edited the canonical row in place — the id
			// still matches, but the locked content no longer equals the
			// original the editor loaded, so the stale write must be rejected.
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [{ id: "a1", place_id: "place-9", place_text: null }]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						activityPlaces: [
							{
								id: "a1",
								placeId: "place-1",
								originalPlaceId: "place-1",
								originalPlaceText: null,
							},
						],
						removedActivityPlaces: [],
					},
				}),
			).rejects.toThrow(
				"activityPlaces: row a1 changed since the editor loaded it",
			);
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("updates a kept activity row whose locked content matches its original", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [{ id: "a1", place_id: "place-1", place_text: null }]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					activityPlaces: [
						{
							id: "a1",
							placeText: "שושן",
							originalPlaceId: "place-1",
							originalPlaceText: null,
						},
					],
					removedActivityPlaces: [],
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_activity_place SET place_id = ?, place_text = ? WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				[null, "שושן", "a1", "person-1"],
			);
		});

		it("accepts a kept activity row compared by free text alone", async () => {
			// The editor loaded a free-text row (no linked place), so only
			// originalPlaceText is set — the CAS compares the text side.
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [{ id: "a1", place_id: null, place_text: "שושן" }]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					activityPlaces: [
						{ id: "a1", placeId: "place-2", originalPlaceText: "שושן" },
					],
					removedActivityPlaces: [],
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_activity_place SET place_id = ?, place_text = ? WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["place-2", null, "a1", "person-1"],
			);
		});

		it("deletes only the explicitly removed activity place rows", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValue(null);
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [
								{ id: "a1", place_id: "place-1", place_text: null },
								{ id: "a2", place_id: "place-2", place_text: null },
							]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					activityPlaces: [{ id: "a1", placeId: "place-1" }],
					removedActivityPlaces: [
						{
							id: "a2",
							originalPlaceId: "place-2",
							originalPlaceText: null,
						},
						// Id-less drafts never reached the database — dropped.
						{ originalPlaceText: "unsaved" },
					],
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_activity_place WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["a2", "person-1"],
			);
			expect(
				executeMock.mock.calls.some(([sql]) =>
					String(sql).startsWith(
						"INSERT INTO tanahpedia_person_activity_place",
					),
				),
			).toBe(false);
		});

		it("rejects removing an activity row whose locked content changed", async () => {
			// A contribution merge edited the row the editor asked to remove —
			// deleting it would silently discard the merged content.
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [{ id: "a2", place_id: null, place_text: "דבינסק" }]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						activityPlaces: [],
						removedActivityPlaces: [{ id: "a2", originalPlaceText: "שושן" }],
					},
				}),
			).rejects.toThrow(
				"activityPlaces: row a2 changed since the editor loaded it",
			);
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects a birth place write when the canonical row appeared since the editor loaded it", async () => {
			// The editor loaded an empty birth place (original = null); a merge
			// committed a canonical row before the locked read — the write must
			// fail instead of overwriting the merged fact.
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({
					id: "b1",
					place_id: "place-9",
					place_text: null,
				});
			executeMock.mockResolvedValue(undefined);

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						birthPlaceId: "place-2",
						birthPlaceOriginal: null,
					},
				}),
			).rejects.toThrow(
				"canonical place fact changed since the editor loaded it",
			);
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects a birth place write when the canonical row content changed", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({
					id: "b1",
					place_id: null,
					place_text: "שושן",
				});
			executeMock.mockResolvedValue(undefined);

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						birthPlaceId: "place-2",
						birthPlaceOriginal: {
							id: "b1",
							placeId: "place-9",
							placeText: null,
						},
					},
				}),
			).rejects.toThrow(
				"canonical place fact changed since the editor loaded it",
			);
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("updates the birth place when the locked row matches the loaded original", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({
					id: "b1",
					place_id: "place-9",
					place_text: null,
				});
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					birthPlaceId: "place-2",
					birthPlaceOriginal: {
						id: "b1",
						placeId: "place-9",
						placeText: null,
					},
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_birth_place SET place_id = ?, place_text = ? WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["place-2", null, "b1", "person-1"],
			);
		});

		it("updates the birth place when the loaded original held free text", async () => {
			// A free-text row has placeId null — the CAS still matches the locked
			// row field-for-field before overwriting it.
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({
					id: "b1",
					place_id: null,
					place_text: "שושן",
				});
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					birthPlaceId: "place-2",
					birthPlaceOriginal: {
						id: "b1",
						placeId: null,
						placeText: "שושן",
					},
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_birth_place SET place_id = ?, place_text = ? WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["place-2", null, "b1", "person-1"],
			);
		});

		it("ignores a birth place clear when no canonical row exists", async () => {
			// Nothing was loaded and nothing exists — the clear is a no-op and
			// must not emit a delete against a row it never checked.
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce(null);
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					birthPlaceId: null,
					birthPlaceOriginal: null,
				},
			});

			expect(
				executeMock.mock.calls.some(([sql]) =>
					String(sql).includes("tanahpedia_person_birth_place"),
				),
			).toBe(false);
		});

		it("rejects a birth place clear when another canonical row exists", async () => {
			// A contribution merge can leave a second canonical row the editor
			// never saw — clearing the loaded one must fail rather than delete
			// it and let the unseen row surface as "the" fact on reload.
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({
					id: "b1",
					place_id: "place-1",
					place_text: null,
				})
				.mockResolvedValueOnce({ id: "b2" });
			executeMock.mockResolvedValue(undefined);

			await expect(
				updateFamilyPersonNode({
					data: {
						entityId: "entity-1",
						birthPlaceId: null,
						birthPlaceOriginal: {
							id: "b1",
							placeId: "place-1",
							placeText: null,
						},
					},
				}),
			).rejects.toThrow("another canonical place fact exists");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("refuses to remove a cited activity place", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({ id: "sg-1" });
			queryMock.mockImplementation((sql) =>
				Promise.resolve(
					String(sql).includes("FROM tanahpedia_person_activity_place")
						? [{ id: "a1", place_id: "place-1", place_text: null }]
						: [],
				),
			);
			executeMock.mockResolvedValue(undefined);

			await expect(
				updateFamilyPersonNode({
					data: { entityId: "entity-1", activityPlaces: [] },
				}),
			).rejects.toThrow("still has source references");
			expect(
				executeMock.mock.calls.some(([sql]) =>
					String(sql).startsWith(
						"DELETE FROM tanahpedia_person_activity_place",
					),
				),
			).toBe(false);
		});

		it("inserts birth date, death date, death cause, birth place, and roles", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null);
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					birthDate: 20000101,
					deathDate: 20500101,
					deathCause: "old age",
					birthPlaceId: "place-1",
					isProphet: true,
					isKing: true,
				},
			});

			expect(executeMock).toHaveBeenCalledTimes(6);
			expect(executeMock.mock.calls[0]?.[0]).toContain(
				"tanahpedia_person_birth_date",
			);
			expect(executeMock.mock.calls[1]?.[0]).toContain(
				"tanahpedia_person_death_date",
			);
			expect(executeMock.mock.calls[2]?.[0]).toContain(
				"tanahpedia_person_death_cause",
			);
			expect(executeMock.mock.calls[3]?.[0]).toContain(
				"tanahpedia_person_birth_place",
			);
			expect(executeMock.mock.calls[4]?.[0]).toContain(
				"tanahpedia_person_role_prophet",
			);
			expect(executeMock.mock.calls[5]?.[0]).toContain(
				"tanahpedia_person_role_king",
			);
		});

		it("clears birth date, death cause, and disables roles", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					birthDate: null,
					deathCause: null,
					isProphet: false,
					isKing: false,
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_birth_date WHERE person_id = ?",
				["person-1"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_death_cause WHERE person_id = ?",
				["person-1"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_role_prophet WHERE person_id = ?",
				["person-1"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_role_king WHERE person_id = ?",
				["person-1"],
			);
		});

		it("updates existing biographical singleton rows", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({ id: "birth-1" })
				.mockResolvedValueOnce({ id: "death-1" })
				.mockResolvedValueOnce({ id: "cause-1" })
				.mockResolvedValueOnce({ id: "place-link-1" });
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					birthDate: 101,
					deathDate: 202,
					deathCause: "battle",
					birthPlaceId: "place-2",
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_birth_date SET birth_date = ? WHERE id = ?",
				[101, "birth-1"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_death_date SET death_date = ? WHERE id = ?",
				[202, "death-1"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_death_cause SET death_cause = ? WHERE id = ?",
				["battle", "cause-1"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_birth_place SET place_id = ?, place_text = ? WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["place-2", null, "place-link-1", "person-1"],
			);
		});

		it("clears death date and birth place singleton rows", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({
					id: "b1",
					place_id: null,
					place_text: "דבינסק",
				});
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: {
					entityId: "entity-1",
					deathDate: null,
					birthPlaceId: null,
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_death_date WHERE person_id = ?",
				["person-1"],
			);
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_birth_place WHERE id = ? AND person_id = ? AND alt_group_id IS NULL",
				["b1", "person-1"],
			);
		});

		it("leaves existing role rows in place when enabling roles", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "person-1" })
				.mockResolvedValueOnce({ id: "prophet-role-1" })
				.mockResolvedValueOnce({ id: "king-role-1" });
			executeMock.mockResolvedValue(undefined);

			await updateFamilyPersonNode({
				data: { entityId: "entity-1", isProphet: true, isKing: true },
			});

			expect(executeMock).not.toHaveBeenCalled();
		});

		it("throws when person is not found while updating biographical fields", async () => {
			queryOneMock.mockResolvedValueOnce(null);

			await expect(
				updateFamilyPersonNode({
					data: { entityId: "missing", birthDate: 20000101 },
				}),
			).rejects.toThrow("Person not found for entity: missing");
		});

		it("skips name propagation when the entity is not a person", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });
			queryOneMock.mockResolvedValueOnce(null);

			const result = await updateFamilyPersonNode({
				data: { entityId: "entity-1", displayName: "Israel" },
			});

			expect(result).toEqual({ entityId: "entity-1" });
			expect(executeMock).toHaveBeenCalledTimes(1);
		});

		it("throws when updating sex for a person that is not found", async () => {
			queryOneMock.mockResolvedValueOnce(null);

			await expect(
				updateFamilyPersonNode({
					data: { entityId: "entity-1", sex: "MALE" },
				}),
			).rejects.toThrow("Person not found for entity: entity-1");
			expect(executeMock).not.toHaveBeenCalled();
		});
	});

	describe("deleteFamilyPersonNode", () => {
		it("cascades deletion across family tables", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			executeMock.mockResolvedValue({ affectedRows: 1 });

			const result = await deleteFamilyPersonNode({
				data: { entityId: "entity-1" },
			});

			expect(result).toEqual({ entityId: "entity-1" });
			expect(executeMock).toHaveBeenCalledTimes(7);
			expect(executeMock.mock.calls[0]?.[0]).toContain(
				"tanahpedia_person_union",
			);
			expect(executeMock.mock.calls[6]?.[0]).toContain("tanahpedia_entity");
		});

		it("throws when person is not found", async () => {
			queryOneMock.mockResolvedValueOnce(null);

			await expect(
				deleteFamilyPersonNode({ data: { entityId: "missing" } }),
			).rejects.toThrow("Person not found for entity: missing");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("throws when the entity delete affects no rows", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
			executeMock
				.mockResolvedValueOnce({ affectedRows: 1 })
				.mockResolvedValueOnce({ affectedRows: 1 })
				.mockResolvedValueOnce({ affectedRows: 1 })
				.mockResolvedValueOnce({ affectedRows: 1 })
				.mockResolvedValueOnce({ affectedRows: 1 })
				.mockResolvedValueOnce({ affectedRows: 1 })
				.mockResolvedValueOnce({ affectedRows: 0 });

			await expect(
				deleteFamilyPersonNode({ data: { entityId: "missing-entity" } }),
			).rejects.toThrow("Person entity not found: missing-entity");
		});
	});

	describe("updateParentChildLink", () => {
		it("updates relationship type, parent role, and source citation", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "rel-adopt" })
				.mockResolvedValueOnce({ id: "role-mother" });
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			const result = await updateParentChildLink({
				data: {
					id: "link-1",
					relationshipType: "ADOPTIVE",
					parentRole: "MOTHER",
					sourceCitation: "Gen 29:23",
				},
			});

			expect(result).toEqual({ id: "link-1" });
			expect(executeMock.mock.calls[0]).toEqual([
				"UPDATE tanahpedia_person_parent_child SET relationship_type_id = ?, parent_role_id = ?, source_citation = ? WHERE id = ?",
				["rel-adopt", "role-mother", "Gen 29:23", "link-1"],
			]);
		});

		it("rejects invalid relationship type on update", async () => {
			await expect(
				updateParentChildLink({
					data: {
						id: "link-1",
						relationshipType: "INVALID" as unknown as "BIOLOGICAL",
					},
				}),
			).rejects.toThrow("Invalid relationshipType");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects invalid parent role on update", async () => {
			await expect(
				updateParentChildLink({
					data: {
						id: "link-1",
						parentRole: "INVALID" as unknown as "FATHER",
					},
				}),
			).rejects.toThrow("Invalid parentRole");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("updates altGroupId only", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			const result = await updateParentChildLink({
				data: { id: "link-1", altGroupId: "alt-1" },
			});

			expect(result).toEqual({ id: "link-1" });
			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_parent_child SET alt_group_id = ? WHERE id = ?",
				["alt-1", "link-1"],
			);
		});

		it("throws when no fields are provided", async () => {
			await expect(
				updateParentChildLink({ data: { id: "link-1" } }),
			).rejects.toThrow("At least one field must be provided to update");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("throws when the link is not found", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 0 });

			await expect(
				updateParentChildLink({
					data: { id: "missing", sourceCitation: "Gen 29:23" },
				}),
			).rejects.toThrow("Parent-child link not found: missing");
		});
	});

	describe("deleteParentChildLink", () => {
		it("deletes the link", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			const result = await deleteParentChildLink({ data: { id: "link-1" } });

			expect(result).toEqual({ id: "link-1" });
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_parent_child WHERE id = ?",
				["link-1"],
			);
		});

		it("throws when the link is not found", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 0 });

			await expect(
				deleteParentChildLink({ data: { id: "missing" } }),
			).rejects.toThrow("Parent-child link not found: missing");
		});
	});

	describe("updateUnionLink", () => {
		it("updates source citation only", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			const result = await updateUnionLink({
				data: { id: "union-1", sourceCitation: "Gen 29:28" },
			});

			expect(result).toEqual({ id: "union-1" });
			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_union SET source_citation = ? WHERE id = ?",
				["Gen 29:28", "union-1"],
			);
		});

		it("updates union type, order, dates, and alt group together", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "union-type-pilegesh" });
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			await updateUnionLink({
				data: {
					id: "union-1",
					unionType: "PILEGESH",
					unionOrder: 3,
					startDate: 100,
					endDate: 200,
					altGroupId: "alt-1",
				},
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_union SET union_type_id = ?, union_order = ?, start_date = ?, end_date = ?, alt_group_id = ? WHERE id = ?",
				["union-type-pilegesh", 3, 100, 200, "alt-1", "union-1"],
			);
		});

		it("rejects invalid end reason on update", async () => {
			await expect(
				updateUnionLink({
					data: { id: "union-1", endReason: "INVALID" as unknown as "DEATH" },
				}),
			).rejects.toThrow("Invalid endReason");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("clears end reason when explicitly set to null", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			await updateUnionLink({
				data: { id: "union-1", endReason: null },
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_union SET end_reason_id = ? WHERE id = ?",
				[null, "union-1"],
			);
		});

		it("resolves a new end reason lookup", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "end-divorce" });
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			await updateUnionLink({
				data: { id: "union-1", endReason: "DIVORCE" },
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_union SET end_reason_id = ? WHERE id = ?",
				["end-divorce", "union-1"],
			);
		});

		it("updates unionOrder without altGroupId or sourceCitation", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			await updateUnionLink({
				data: { id: "union-1", unionOrder: 1 },
			});

			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_union SET union_order = ? WHERE id = ?",
				[1, "union-1"],
			);
		});

		it("rejects invalid union type on update", async () => {
			await expect(
				updateUnionLink({
					data: {
						id: "union-1",
						unionType: "INVALID" as unknown as "MARRIAGE",
					},
				}),
			).rejects.toThrow("Invalid unionType");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("throws when no fields are provided", async () => {
			await expect(
				updateUnionLink({ data: { id: "union-1" } }),
			).rejects.toThrow("At least one field must be provided to update");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("throws when the union link is not found", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 0 });

			await expect(
				updateUnionLink({
					data: { id: "missing", sourceCitation: "Gen 29:28" },
				}),
			).rejects.toThrow("Union link not found: missing");
		});
	});

	describe("deleteUnionLink", () => {
		it("deletes the union link", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			const result = await deleteUnionLink({ data: { id: "union-1" } });

			expect(result).toEqual({ id: "union-1" });
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_union WHERE id = ?",
				["union-1"],
			);
		});

		it("throws when the union link is not found", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 0 });

			await expect(
				deleteUnionLink({ data: { id: "missing" } }),
			).rejects.toThrow("Union link not found: missing");
		});
	});

	describe("createPersonName", () => {
		it("creates an additional name", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "name-type-additional" });
			executeMock.mockResolvedValue(undefined);

			const result = await createPersonName({
				data: {
					personId: "person-1",
					name: "Israel",
					nameType: "ADDITIONAL",
				},
			});

			expect(result.id).toBeTruthy();
			expect(executeMock).toHaveBeenCalledTimes(1);
			expect(executeMock.mock.calls[0]?.[1]).toEqual([
				result.id,
				"person-1",
				"Israel",
				"name-type-additional",
				null,
			]);
		});

		it("creates a name given by another person", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "name-type-nickname" });
			executeMock.mockResolvedValue(undefined);

			const result = await createPersonName({
				data: {
					personId: "person-1",
					name: "Israel",
					nameType: "NICKNAME",
					giverPersonId: "person-god",
				},
			});

			expect(executeMock).toHaveBeenCalledTimes(2);
			expect(executeMock.mock.calls[1]?.[0]).toContain(
				"tanahpedia_person_name_giver_person",
			);
			expect(executeMock.mock.calls[1]?.[1]).toEqual([
				expect.any(String),
				result.id,
				"person-god",
			]);
		});

		it("creates a God-given name", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "name-type-additional" })
				.mockResolvedValueOnce({ id: "god-1" });
			executeMock.mockResolvedValue(undefined);

			await createPersonName({
				data: {
					personId: "person-1",
					name: "Israel",
					nameType: "ADDITIONAL",
					isGodGiven: true,
				},
			});

			expect(executeMock.mock.calls[1]?.[0]).toContain(
				"tanahpedia_person_name_giver_god",
			);
		});

		it("rejects mutually exclusive givers", async () => {
			await expect(
				createPersonName({
					data: {
						personId: "person-1",
						name: "Israel",
						nameType: "ADDITIONAL",
						giverPersonId: "person-god",
						isGodGiven: true,
					},
				}),
			).rejects.toThrow("giverPersonId and isGodGiven are mutually exclusive");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects a whitespace-only giverPersonId", async () => {
			await expect(
				createPersonName({
					data: {
						personId: "person-1",
						name: "Israel",
						nameType: "ADDITIONAL",
						giverPersonId: "   ",
					},
				}),
			).rejects.toThrow("giverPersonId is required");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects a missing nameType", async () => {
			await expect(
				createPersonName({
					data: {
						personId: "person-1",
						name: "Israel",
						nameType: undefined as unknown as "ADDITIONAL",
					},
				}),
			).rejects.toThrow("nameType is required");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects invalid name type", async () => {
			await expect(
				createPersonName({
					data: {
						personId: "person-1",
						name: "Israel",
						nameType: "INVALID" as unknown as "ADDITIONAL",
					},
				}),
			).rejects.toThrow("Invalid nameType");
			expect(executeMock).not.toHaveBeenCalled();
		});
	});

	describe("updatePersonName", () => {
		it("updates name, name type, and alt group", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "name-type-nickname" });
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			const result = await updatePersonName({
				data: {
					id: "name-1",
					name: "Israel",
					nameType: "NICKNAME",
					altGroupId: "alt-1",
				},
			});

			expect(result).toEqual({ id: "name-1" });
			expect(executeMock).toHaveBeenCalledWith(
				"UPDATE tanahpedia_person_name SET name = ?, name_type_id = ?, alt_group_id = ? WHERE id = ?",
				["Israel", "name-type-nickname", "alt-1", "name-1"],
			);
		});

		it("rejects a non-string nameType", async () => {
			await expect(
				updatePersonName({
					data: {
						id: "name-1",
						nameType: null as unknown as "NICKNAME",
					},
				}),
			).rejects.toThrow("nameType is required");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("replaces the human giver and clears a stale God-giver row", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "name-1" });
			executeMock.mockResolvedValue(undefined);

			await updatePersonName({
				data: { id: "name-1", giverPersonId: "person-2" },
			});

			expect(executeMock).toHaveBeenCalledTimes(3);
			expect(executeMock.mock.calls[0]?.[0]).toContain(
				"DELETE FROM tanahpedia_person_name_giver_person",
			);
			expect(executeMock.mock.calls[1]?.[0]).toContain(
				"DELETE FROM tanahpedia_person_name_giver_god",
			);
			expect(executeMock.mock.calls[2]?.[0]).toContain(
				"INSERT INTO tanahpedia_person_name_giver_person",
			);
			expect(executeMock.mock.calls[2]?.[1]).toEqual([
				expect.any(String),
				"name-1",
				"person-2",
			]);
		});

		it("rejects a whitespace-only giverPersonId", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "name-1" });

			await expect(
				updatePersonName({
					data: { id: "name-1", giverPersonId: "   " },
				}),
			).rejects.toThrow("giverPersonId is required");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("rejects setting giverPersonId and isGodGiven together", async () => {
			await expect(
				updatePersonName({
					data: { id: "name-1", giverPersonId: "person-2", isGodGiven: true },
				}),
			).rejects.toThrow("giverPersonId and isGodGiven are mutually exclusive");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("clears the human giver when set to null", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "name-1" });
			executeMock.mockResolvedValue(undefined);

			await updatePersonName({
				data: { id: "name-1", giverPersonId: null },
			});

			expect(executeMock).toHaveBeenCalledTimes(1);
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_name_giver_person WHERE person_name_id = ?",
				["name-1"],
			);
		});

		it("sets the God-given flag and clears a stale human-giver row", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "name-1" })
				.mockResolvedValueOnce({ id: "god-1" });
			executeMock.mockResolvedValue(undefined);

			await updatePersonName({
				data: { id: "name-1", isGodGiven: true },
			});

			expect(executeMock).toHaveBeenCalledTimes(3);
			expect(executeMock.mock.calls[0]?.[0]).toContain(
				"DELETE FROM tanahpedia_person_name_giver_god",
			);
			expect(executeMock.mock.calls[1]?.[0]).toContain(
				"DELETE FROM tanahpedia_person_name_giver_person",
			);
			expect(executeMock.mock.calls[2]?.[0]).toContain(
				"INSERT INTO tanahpedia_person_name_giver_god",
			);
		});

		it("throws when no fields are provided", async () => {
			await expect(
				updatePersonName({ data: { id: "name-1" } }),
			).rejects.toThrow("At least one field must be provided to update");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("throws when the name is not found", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 0 });

			await expect(
				updatePersonName({ data: { id: "missing", name: "Israel" } }),
			).rejects.toThrow("Person name not found: missing");
		});

		it("rejects a nameType outside the family vocabulary", async () => {
			await expect(
				updatePersonName({
					data: { id: "name-1", nameType: "MAIN" as "NICKNAME" },
				}),
			).rejects.toThrow("Invalid nameType");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("throws when the requested name type has no lookup row", async () => {
			queryOneMock.mockResolvedValueOnce(null);

			await expect(
				updatePersonName({ data: { id: "name-1", nameType: "NICKNAME" } }),
			).rejects.toThrow("Missing tanahpedia_lookup_name_type row for NICKNAME");
			expect(executeMock).not.toHaveBeenCalled();
		});

		it("throws when a giver-only update targets a missing name row", async () => {
			queryOneMock.mockResolvedValueOnce(null);

			await expect(
				updatePersonName({ data: { id: "missing", giverPersonId: null } }),
			).rejects.toThrow("Person name not found: missing");
		});

		it("clears the God-given flag without touching the human giver", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "name-1" });
			executeMock.mockResolvedValue(undefined);

			await updatePersonName({
				data: { id: "name-1", isGodGiven: false },
			});

			expect(executeMock).toHaveBeenCalledTimes(1);
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_name_giver_god WHERE person_name_id = ?",
				["name-1"],
			);
		});

		it("throws when the God singleton row is missing", async () => {
			queryOneMock
				.mockResolvedValueOnce({ id: "name-1" })
				.mockResolvedValueOnce(null);
			executeMock.mockResolvedValue(undefined);

			await expect(
				updatePersonName({ data: { id: "name-1", isGodGiven: true } }),
			).rejects.toThrow("Missing tanahpedia_god singleton row");
		});
	});

	describe("deletePersonName", () => {
		it("deletes the name", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 1 });

			const result = await deletePersonName({ data: { id: "name-1" } });

			expect(result).toEqual({ id: "name-1" });
			expect(executeMock).toHaveBeenCalledWith(
				"DELETE FROM tanahpedia_person_name WHERE id = ?",
				["name-1"],
			);
		});

		it("throws when the name is not found", async () => {
			executeMock.mockResolvedValueOnce({ affectedRows: 0 });

			await expect(
				deletePersonName({ data: { id: "missing" } }),
			).rejects.toThrow("Person name not found: missing");
		});
	});
});

describe("family saves invalidate the website", () => {
	const ENV_KEYS = ["VITE_WEBSITE_URL", "REVALIDATE_SECRET"] as const;
	let savedEnv: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		process.env.VITE_WEBSITE_URL = "https://site.test";
		process.env.REVALIDATE_SECRET = "s3cr3t";
		__resetRevalidateForTests();
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
		fetchSpy.mockRestore();
	});

	/** The typed entity changes posted to the website across all calls. */
	function sentChanges(): Record<string, unknown>[] {
		return fetchSpy.mock.calls.flatMap((call: unknown[]) => {
			const body = (call[1] as RequestInit | undefined)?.body;
			return body ? (JSON.parse(String(body)).changes ?? []) : [];
		});
	}

	/**
	 * `pediaChangesForPersons` resolves person ids → entities → their linked
	 * entry names in four queries: the person→entity join, then the entity
	 * types, linked entry names and source perakim together.
	 */
	function mockPersonResolution(
		entityIds: string[],
		entryNames: Record<string, string>,
	) {
		queryMock
			.mockResolvedValueOnce(entityIds.map((id) => ({ entity_id: id })))
			.mockResolvedValueOnce(
				entityIds.map((id) => ({ id, entity_type: "PERSON" })),
			)
			.mockResolvedValueOnce(
				Object.entries(entryNames).map(([entity_id, unique_name]) => ({
					entity_id,
					unique_name,
				})),
			)
			.mockResolvedValueOnce([]);
	}

	function entityChanges() {
		return sentChanges().filter((c) => c.kind === "pedia-entity");
	}

	it("sends both persons' entity changes after a parent-child link commit", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "rel-bio" })
			.mockResolvedValueOnce({ id: "role-father" });
		mockPersonResolution(["e1", "e2"], { e1: "אברהם", e2: "יצחק" });

		await createParentChildLink({
			data: {
				parentPersonId: "parent-1",
				childPersonId: "child-1",
				relationshipType: "BIOLOGICAL",
				parentRole: "FATHER",
			},
		});

		expect(sentChanges()).toEqual([
			{
				kind: "pedia-entity",
				entityId: "e1",
				entityType: "PERSON",
				entryUniqueNames: ["אברהם"],
				refPerekIds: [],
			},
			{
				kind: "pedia-entity",
				entityId: "e2",
				entityType: "PERSON",
				entryUniqueNames: ["יצחק"],
				refPerekIds: [],
			},
		]);
	});

	it("sends the owning person's entity change after a person name delete", async () => {
		queryOneMock.mockResolvedValueOnce({ person_id: "p1" });
		mockPersonResolution(["e1"], { e1: "יעקב" });
		executeMock.mockResolvedValueOnce({ affectedRows: 1 });

		await deletePersonName({ data: { id: "name-1" } });

		expect(fetchSpy).toHaveBeenCalled();
		expect(entityChanges()[0]?.entityId).toBe("e1");
	});

	it("carries the linked entry's change when a new person links to it", async () => {
		queryOneMock.mockResolvedValue({ id: "type-1" });
		queryMock
			.mockResolvedValueOnce([{ id: "entry-1", unique_name: "משה" }])
			.mockResolvedValueOnce([{ entry_id: "entry-1", entity_type: "PERSON" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		await createFamilyPersonNode({
			data: { displayName: "דוד", linkToEntryId: "entry-1" },
		});

		expect(sentChanges()).toEqual([
			{
				kind: "pedia-entry",
				uniqueName: "משה",
				entityTypes: ["PERSON"],
				synonymNames: [],
				refPerekIds: [],
			},
		]);
	});

	it("carries the linked persons' entry names after a parent-child update", async () => {
		executeMock.mockResolvedValue({ affectedRows: 1 });
		queryOneMock.mockResolvedValue({
			parent_id: "parent-1",
			child_id: "child-1",
		});
		mockPersonResolution(["e1"], { e1: "אברהם" });

		await updateParentChildLink({
			data: { id: "link-1", sourceCitation: "מקור" },
		});

		expect(entityChanges()[0]?.entryUniqueNames).toEqual(["אברהם"]);
	});

	it("carries the linked persons' entry names after a parent-child delete", async () => {
		executeMock.mockResolvedValue({ affectedRows: 1 });
		queryOneMock.mockResolvedValue({
			parent_id: "parent-1",
			child_id: "child-1",
		});
		mockPersonResolution(["e1"], { e1: "אברהם" });

		await deleteParentChildLink({ data: { id: "link-1" } });

		expect(entityChanges()[0]?.entryUniqueNames).toEqual(["אברהם"]);
	});

	it("carries the members' entry names after a union update", async () => {
		executeMock.mockResolvedValue({ affectedRows: 1 });
		queryOneMock.mockResolvedValue({
			person1_id: "p1",
			person2_id: "p2",
		});
		mockPersonResolution(["e1"], { e1: "שרה" });

		await updateUnionLink({ data: { id: "u1", unionOrder: 2 } });

		expect(entityChanges()[0]?.entryUniqueNames).toEqual(["שרה"]);
	});

	it("carries the members' entry names after a union delete", async () => {
		executeMock.mockResolvedValue({ affectedRows: 1 });
		queryOneMock.mockResolvedValue({
			person1_id: "p1",
			person2_id: "p2",
		});
		mockPersonResolution(["e1"], { e1: "שרה" });

		await deleteUnionLink({ data: { id: "u1" } });

		expect(entityChanges()[0]?.entryUniqueNames).toEqual(["שרה"]);
	});

	it("carries the named person's and giver's entry names after a name create", async () => {
		queryOneMock.mockResolvedValue({ id: "type-1" });
		mockPersonResolution(["e1", "e2"], { e1: "יעקב", e2: "ישמעאל" });

		await createPersonName({
			data: {
				personId: "p1",
				name: "ישראל",
				nameType: "ADDITIONAL",
				giverPersonId: "p2",
			},
		});

		expect(entityChanges().map((c) => c.entryUniqueNames)).toEqual([
			["יעקב"],
			["ישמעאל"],
		]);
	});

	it("carries the owning person's entry names after a name update", async () => {
		executeMock.mockResolvedValue({ affectedRows: 1 });
		queryOneMock.mockResolvedValue({ person_id: "p1" });
		mockPersonResolution(["e1"], { e1: "יעקב" });

		await updatePersonName({ data: { id: "name-1", name: "ישראל" } });

		expect(entityChanges()[0]?.entryUniqueNames).toEqual(["יעקב"]);
	});

	it("carries the owning person's entry names after a name delete", async () => {
		executeMock.mockResolvedValue({ affectedRows: 1 });
		queryOneMock.mockResolvedValue({ person_id: "p1" });
		mockPersonResolution(["e1"], { e1: "יעקב" });

		await deletePersonName({ data: { id: "name-1" } });

		expect(entityChanges()[0]?.entryUniqueNames).toEqual(["יעקב"]);
	});
});
