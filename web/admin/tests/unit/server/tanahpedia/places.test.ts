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
}));

vi.mock("~/server/db", () => ({
	execute: executeMock,
	query: queryMock,
	queryOne: queryOneMock,
}));

import { createPlace, deletePlace } from "~/server/tanahpedia/places";
import { __resetRevalidateForTests } from "~/server/website-revalidate";

describe("tanahpedia places api", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
	});

	it("creates the entity and place rows", async () => {
		const result = await createPlace({ data: { name: "  ירושלים  " } });

		expect(result.id).toBeTruthy();
		expect(result.entity_id).toBeTruthy();
		expect(executeMock).toHaveBeenCalledTimes(2);
		expect(executeMock.mock.calls[0]?.[1]?.[1]).toBe("ירושלים");
	});

	it("deletes the entity row behind the place", async () => {
		queryOneMock.mockResolvedValue({ entity_id: "entity-1" });

		await expect(deletePlace({ data: "place-1" })).resolves.toEqual({
			success: true,
		});
		expect(executeMock).toHaveBeenCalledWith(
			"DELETE FROM tanahpedia_entity WHERE id = ?",
			["entity-1"],
		);
	});

	it("rejects deleting a missing place", async () => {
		queryOneMock.mockResolvedValue(null);

		await expect(deletePlace({ data: "missing" })).rejects.toThrow(
			"Place not found",
		);
	});
});

describe("place saves invalidate the website", () => {
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

	it("sends the created entity's change after a place create", async () => {
		await createPlace({ data: { name: "ירושלים" } });

		expect(fetchSpy).toHaveBeenCalled();
		const changes = fetchSpy.mock.calls.flatMap((call: unknown[]) => {
			const body = (call[1] as RequestInit | undefined)?.body;
			return body ? (JSON.parse(String(body)).changes ?? []) : [];
		});
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ kind: "pedia-entity" });
		expect(typeof changes[0].entityId).toBe("string");
	});
});
