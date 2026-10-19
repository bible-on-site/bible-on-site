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
		handler: (fn: () => unknown) => () => fn(),
	}),
}));

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
}));

import {
	replacePlaceIdentifications,
	updateEntityDisplayName,
	updatePersonMainName,
	updatePersonSex,
} from "~/server/tanahpedia/structural";

function executedStatements(): string[] {
	return executeMock.mock.calls.map(([sql]) => String(sql));
}

describe("updateEntityDisplayName", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset();
		queryOneMock.mockReset();
	});

	it("renames the entity row", async () => {
		await expect(
			updateEntityDisplayName({
				data: { entityId: "entity-1", name: "  משה רבנו  " },
			}),
		).resolves.toEqual({ success: true });

		expect(executeMock).toHaveBeenCalledWith(
			"UPDATE tanahpedia_entity SET name = ? WHERE id = ?",
			["משה רבנו", "entity-1"],
		);
	});

	it("rejects a blank name", async () => {
		await expect(
			updateEntityDisplayName({
				data: { entityId: "entity-1", name: "   " },
			}),
		).rejects.toThrow("שם יישות ריק");
		expect(executeMock).not.toHaveBeenCalled();
	});
});

describe("updatePersonMainName", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset();
		queryOneMock.mockReset();
	});

	it("rejects a blank name", async () => {
		await expect(
			updatePersonMainName({
				data: { personId: "person-1", name: "   " },
			}),
		).rejects.toThrow("שם ריק");
		expect(queryOneMock).not.toHaveBeenCalled();
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("throws when the MAIN name type lookup row is missing", async () => {
		queryOneMock.mockResolvedValueOnce(null);

		await expect(
			updatePersonMainName({
				data: { personId: "person-1", name: "משה" },
			}),
		).rejects.toThrow("Missing tanahpedia_lookup_name_type row for name=MAIN");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("updates the existing name row and mirrors it to the entity", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "name-type-main" })
			.mockResolvedValueOnce({ entity_id: "entity-1" });

		await expect(
			updatePersonMainName({
				data: {
					personId: "person-1",
					name: " משה רבנו ",
					mainNameRowId: "name-row-1",
				},
			}),
		).resolves.toEqual({ success: true });

		expect(executeMock).toHaveBeenCalledWith(
			"UPDATE tanahpedia_person_name SET name = ? WHERE id = ? AND person_id = ?",
			["משה רבנו", "name-row-1", "person-1"],
		);
		expect(executeMock).toHaveBeenCalledWith(
			"UPDATE tanahpedia_entity SET name = ? WHERE id = ?",
			["משה רבנו", "entity-1"],
		);
	});

	it("inserts a new main name row when none exists yet", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "name-type-main" })
			.mockResolvedValueOnce({ entity_id: "entity-1" });

		await updatePersonMainName({
			data: { personId: "person-1", name: "משה" },
		});

		const statements = executedStatements();
		expect(statements[0]).toContain("INSERT INTO tanahpedia_person_name");
		expect(executeMock.mock.calls[0]?.[1]?.[1]).toBe("person-1");
		expect(executeMock.mock.calls[0]?.[1]?.[2]).toBe("משה");
		expect(executeMock.mock.calls[0]?.[1]?.[3]).toBe("name-type-main");
	});

	it("skips the entity rename when the person row is gone", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: "name-type-main" })
			.mockResolvedValueOnce(null);

		await updatePersonMainName({
			data: { personId: "person-1", name: "משה" },
		});

		expect(executedStatements()).not.toContain(
			"UPDATE tanahpedia_entity SET name = ? WHERE id = ?",
		);
	});
});

describe("updatePersonSex", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset();
		queryOneMock.mockReset();
	});

	it("updates the existing sex row", async () => {
		await expect(
			updatePersonSex({
				data: { personId: "person-1", sex: "FEMALE", sexRowId: "sex-row-1" },
			}),
		).resolves.toEqual({ success: true });

		expect(executeMock).toHaveBeenCalledWith(
			"UPDATE tanahpedia_person_sex SET sex = ? WHERE id = ? AND person_id = ?",
			["FEMALE", "sex-row-1", "person-1"],
		);
		expect(executeMock).toHaveBeenCalledTimes(1);
	});

	it("replaces the main sex row when none exists yet", async () => {
		await updatePersonSex({
			data: { personId: "person-1", sex: "MALE" },
		});

		expect(executedStatements()).toEqual([
			"DELETE FROM tanahpedia_person_sex WHERE person_id = ? AND alt_group_id IS NULL",
			expect.stringContaining("INSERT INTO tanahpedia_person_sex"),
		]);
		expect(executeMock.mock.calls[0]?.[1]).toEqual(["person-1"]);
		expect(executeMock.mock.calls[1]?.[1]?.[1]).toBe("person-1");
		expect(executeMock.mock.calls[1]?.[1]?.[2]).toBe("MALE");
	});
});

describe("replacePlaceIdentifications", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
	});

	it("deletes rows that were dropped, updates kept rows and inserts new ones", async () => {
		queryMock.mockResolvedValue([{ id: "old-row" }, { id: "keep-row" }]);

		await expect(
			replacePlaceIdentifications({
				data: {
					placeId: "place-1",
					rows: [
						{
							id: "keep-row",
							modern_name: "ירושלים",
							latitude: 31.78,
							longitude: 35.21,
						},
						{
							modern_name: "אל קודס",
							latitude: null,
							longitude: null,
						},
					],
				},
			}),
		).resolves.toEqual({ success: true });

		expect(queryMock).toHaveBeenCalledWith(
			"SELECT id FROM tanahpedia_place_identification WHERE place_id = ?",
			["place-1"],
		);
		expect(executeMock).toHaveBeenCalledWith(
			"DELETE FROM tanahpedia_place_identification WHERE id = ?",
			["old-row"],
		);
		expect(executeMock).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE tanahpedia_place_identification"),
			["ירושלים", 31.78, 35.21, "keep-row", "place-1"],
		);
		const insert = executeMock.mock.calls.find(([sql]) =>
			String(sql).includes("INSERT INTO tanahpedia_place_identification"),
		);
		expect(insert?.[1]?.[1]).toBe("place-1");
		expect(insert?.[1]?.slice(2)).toEqual(["אל קודס", null, null]);
	});

	it("inserts every row when there is nothing to keep or delete", async () => {
		await replacePlaceIdentifications({
			data: {
				placeId: "place-1",
				rows: [
					{ modern_name: null, latitude: 1, longitude: 2 },
					{ modern_name: "שם", latitude: null, longitude: null },
				],
			},
		});

		const statements = executedStatements();
		expect(
			statements.filter((s) =>
				s.includes("INSERT INTO tanahpedia_place_identification"),
			),
		).toHaveLength(2);
		expect(statements).not.toContain(
			"DELETE FROM tanahpedia_place_identification WHERE id = ?",
		);
	});

	it("keeps all existing rows without touching them when only ids are sent back", async () => {
		queryMock.mockResolvedValue([{ id: "row-1" }]);

		await replacePlaceIdentifications({
			data: {
				placeId: "place-1",
				rows: [
					{
						id: "row-1",
						modern_name: "שם חדש",
						latitude: null,
						longitude: null,
					},
				],
			},
		});

		expect(executedStatements()).toEqual([
			expect.stringContaining("UPDATE tanahpedia_place_identification"),
		]);
	});
});

describe("structural saves invalidate the website", () => {
	const ENV_KEYS = ["VITE_WEBSITE_URL", "VITE_REVALIDATION_SECRET"] as const;
	let savedEnv: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset();
		queryOneMock.mockReset();
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		process.env.VITE_WEBSITE_URL = "https://site.test";
		process.env.VITE_REVALIDATION_SECRET = "s3cr3t";
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

	function revalidateCalls() {
		return fetchSpy.mock.calls.map(([input]) => {
			const url = new URL(String(input));
			return {
				tag: url.searchParams.get("tag"),
				path: url.searchParams.get("path"),
			};
		});
	}

	it("expires pedia surfaces after an entity rename", async () => {
		await updateEntityDisplayName({
			data: { entityId: "entity-1", name: "משה רבנו" },
		});

		expect(revalidateCalls()).toEqual([
			{ tag: "tanahpedia-entity-refs", path: null },
			{ tag: null, path: "/pedia/[slug]" },
			{ tag: null, path: "/pedia" },
		]);
	});

	it("does not call the website before the entity row is written", async () => {
		let fetchedBeforeWrite = false;
		fetchSpy.mockImplementation(async () => {
			fetchedBeforeWrite = !executedStatements().some((s) =>
				s.includes("UPDATE tanahpedia_entity"),
			);
			return new Response("{}", { status: 200 });
		});

		await updateEntityDisplayName({
			data: { entityId: "entity-1", name: "משה רבנו" },
		});

		expect(fetchedBeforeWrite).toBe(false);
		expect(fetchSpy).toHaveBeenCalled();
	});
});
