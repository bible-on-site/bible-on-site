import type { PoolConnection } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
	queryMock: vi.fn(),
}));

vi.mock("~/server/db", () => ({
	txExecute: vi.fn(),
	txQuery: (_conn: PoolConnection, ...args: unknown[]) =>
		queryMock(...args),
	txQueryOne: vi.fn(),
}));

vi.mock("~/server/tanahpedia/revisions", () => ({
	saveEntryTitleRevisioned: vi.fn(),
}));

import { structuredContributionCatalogue } from "~/server/tanahpedia/contribution-records.server";

const conn = {} as PoolConnection;
const BIRTH_PLACE_FROM = /FROM tanahpedia_person_birth_place\s/;

function missingTable() {
	const error = new Error("Table 'x' doesn't exist") as Error & {
		code: string;
	};
	error.code = "ER_NO_SUCH_TABLE";
	return error;
}

describe("structuredContributionCatalogue", () => {
	beforeEach(() => {
		queryMock.mockReset().mockResolvedValue([]);
	});

	it("reads an undeployed record table as an empty catalogue section", async () => {
		queryMock.mockImplementation((sql: unknown) =>
			BIRTH_PLACE_FROM.test(String(sql))
				? Promise.reject(missingTable())
				: Promise.resolve([]),
		);

		const { targets } = await structuredContributionCatalogue(conn);
		expect(
			targets.every((target) => target.kind !== "person_birth_place"),
		).toBe(true);
	});

	it("propagates catalogue failures that are not a missing table", async () => {
		queryMock.mockImplementation((sql: unknown) =>
			BIRTH_PLACE_FROM.test(String(sql))
				? Promise.reject(new Error("connection lost"))
				: Promise.resolve([]),
		);

		await expect(structuredContributionCatalogue(conn)).rejects.toThrow(
			"connection lost",
		);
	});
});
