import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, queryMock, queryOneMock } = vi.hoisted(() => ({
	executeMock: vi.fn(),
	queryMock: vi.fn(),
	queryOneMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		inputValidator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
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

describe("tanahpedia family api", () => {
	beforeEach(() => {
		executeMock.mockReset();
		queryMock.mockReset();
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

	it("rejects a whitespace-only birthPlaceId on create", async () => {
		queryOneMock.mockResolvedValueOnce({ id: "name-type-main" });

		await expect(
			createFamilyPersonNode({
				data: { displayName: "Moses", birthPlaceId: "   " },
			}),
		).rejects.toThrow("birthPlaceId is required");
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

		it("rejects a whitespace-only birthPlaceId on update", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });

			await expect(
				updateFamilyPersonNode({
					data: { entityId: "entity-1", birthPlaceId: "   " },
				}),
			).rejects.toThrow("birthPlaceId is required");
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
				"UPDATE tanahpedia_person_birth_place SET place_id = ? WHERE id = ?",
				["place-2", "place-link-1"],
			);
		});

		it("clears death date and birth place singleton rows", async () => {
			queryOneMock.mockResolvedValueOnce({ id: "person-1" });
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
				"DELETE FROM tanahpedia_person_birth_place WHERE person_id = ?",
				["person-1"],
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
