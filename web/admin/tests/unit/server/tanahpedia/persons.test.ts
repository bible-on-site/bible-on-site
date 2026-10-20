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

import { createPerson, deletePerson } from "~/server/tanahpedia/persons";

describe("tanahpedia persons api", () => {
	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
	});

	it("inserts the person row, main name and optional sex", async () => {
		const result = await createPerson({
			data: {
				id: "p-1",
				name: "אברהם",
				name_id: "n-1",
				name_type_id: "main",
				sex: "MALE",
				sex_id: "s-1",
			},
		});

		expect(result).toEqual({ id: "p-1" });
		expect(executeMock).toHaveBeenCalledTimes(3);
		expect(executeMock.mock.calls[0]?.[0]).toContain(
			"INSERT INTO tanahpedia_person",
		);
		expect(executeMock.mock.calls[2]?.[1]).toEqual(["s-1", "p-1", "MALE"]);
	});

	it("deletes the person row", async () => {
		await expect(deletePerson({ data: "p-1" })).resolves.toEqual({
			success: true,
		});
		expect(executeMock).toHaveBeenCalledWith(
			"DELETE FROM tanahpedia_person WHERE id = ?",
			["p-1"],
		);
	});
});

describe("person saves invalidate the website", () => {
	const ENV_KEYS = ["VITE_WEBSITE_URL", "REVALIDATE_SECRET"] as const;
	let savedEnv: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		executeMock.mockReset().mockResolvedValue(undefined);
		queryOneMock.mockReset();
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		process.env.VITE_WEBSITE_URL = "https://site.test";
		process.env.REVALIDATE_SECRET = "s3cr3t";
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

	it("expires pedia surfaces after a person delete", async () => {
		await deletePerson({ data: "p-1" });

		const calls = fetchSpy.mock.calls.map((call: unknown[]) =>
			new URL(String(call[0])).searchParams.get("tag"),
		);
		expect(calls).toContain("tanahpedia-entity-refs");
	});
});
