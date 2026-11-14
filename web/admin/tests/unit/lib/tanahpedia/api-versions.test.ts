import { describe, expect, it } from "vitest";
import {
	type ApiVersionAdapter,
	ApiVersionError,
	convertApiVersion,
	convertApiVersionAsync,
} from "~/lib/tanahpedia/api-versions";

type Payload = Record<string, string | number>;
const adapters: ApiVersionAdapter<Payload>[] = [
	{
		from: 1,
		to: 2,
		id: "rename-parent",
		convert: ({ parentId, ...rest }) => ({ ...rest, parentPersonId: parentId }),
	},
	{
		from: 2,
		to: 1,
		id: "restore-parent",
		convert: ({ parentPersonId, ...rest }) => ({
			...rest,
			parentId: parentPersonId,
		}),
	},
	{
		from: 2,
		to: 3,
		id: "drop-retired-field",
		convert: ({ retired, ...rest }) => rest,
	},
	{
		from: 3,
		to: 2,
		id: "restore-default",
		convert: (payload) => ({ ...payload, retired: 0 }),
	},
];
describe("transitive API contract conversion", () => {
	it("composes asynchronous context lookups with pure adapters without mutating the source", async () => {
		const original = { parentId: "person", retired: 4 };
		const result = await convertApiVersionAsync(original, 1, 4, [
			...adapters,
			{
				from: 3,
				to: 4,
				id: "context",
				convert: async (p) => ({
					...p,
					currentName: await Promise.resolve("Authoritative name"),
				}),
			},
		]);
		expect(result.payload).toEqual({
			parentPersonId: "person",
			currentName: "Authoritative name",
		});
		expect(original).toEqual({ parentId: "person", retired: 4 });
		expect(result.steps.map((step) => step.id)).toEqual([
			"rename-parent",
			"drop-retired-field",
			"context",
		]);
		await expect(convertApiVersionAsync({}, 0, 1, [])).rejects.toThrow(
			"positive integers",
		);
		await expect(convertApiVersionAsync({}, 1, 2, [])).rejects.toThrow(
			"No supported conversion",
		);
	});
	it("preserves asynchronous adapter failures as causes and supports detached identity conversion", async () => {
		const cause = Object.assign(new Error("Storage unavailable"), {
			code: "ER_SERVER_SHUTDOWN",
		});
		try {
			await convertApiVersionAsync({}, 1, 2, [
				{
					from: 1,
					to: 2,
					id: "lookup",
					convert: async () => {
						throw cause;
					},
				},
			]);
			throw new Error("Expected conversion failure");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiVersionError);
			expect((error as Error).cause).toBe(cause);
		}
		await expect(
			convertApiVersionAsync({}, 1, 2, [
				{
					from: 1,
					to: 2,
					id: "invalid",
					convert: async () => {
						throw null;
					},
				},
			]),
		).rejects.toThrow("unsupported payload");
		const original = { name: "old" },
			result = await convertApiVersionAsync(original, 2, 2, []);
		result.payload.name = "new";
		expect(original.name).toBe("old");
	});
	it("composes upgrades and permits removed fields without approval policy", () => {
		const original = { parentId: "person-1", retired: 7 };
		const result = convertApiVersion<Payload>(original, 1, 3, adapters);
		expect(result.payload).toEqual({ parentPersonId: "person-1" });
		expect(result.steps.map((step) => step.id)).toEqual([
			"rename-parent",
			"drop-retired-field",
		]);
		expect(original).toEqual({ parentId: "person-1", retired: 7 });
		expect(result).not.toHaveProperty("requiresReview");
	});
	it("composes explicitly registered reverse conversions", () =>
		expect(
			convertApiVersion({ parentPersonId: "person-1" }, 3, 1, adapters).payload,
		).toEqual({ parentId: "person-1", retired: 0 }));
	it("does not invent missing paths or implicitly reverse adapters", () => {
		expect(() => convertApiVersion({}, 1, 4, adapters)).toThrow(
			"No supported conversion",
		);
		expect(() => convertApiVersion({}, 2, 1, [adapters[0]])).toThrow(
			ApiVersionError,
		);
	});
	it("returns a detached current-version payload", () => {
		const original = { parentId: "person" };
		const result = convertApiVersion(original, 1, 1, adapters);
		result.payload.parentId = "changed";
		expect(original.parentId).toBe("person");
		expect(result.steps).toEqual([]);
	});
	it("chooses the shortest explicit route deterministically and terminates cycles", () => {
		const result = convertApiVersion<Payload>({ parentId: "p" }, 1, 3, [
			...adapters,
			{ from: 1, to: 3, id: "direct", convert: () => ({ converted: 1 }) },
		]);
		expect(result.steps.map((step) => step.id)).toEqual(["direct"]);
		expect(result.payload).toEqual({ converted: 1 });
	});
	it("protects input even against mutating legacy adapters", () => {
		const input = { parentId: "original" };
		convertApiVersion(input, 1, 2, [
			{
				from: 1,
				to: 2,
				id: "legacy",
				convert: (payload) => {
					payload.parentId = "converted";
					return payload;
				},
			},
		]);
		expect(input.parentId).toBe("original");
	});
	it.each([0, -1, 1.5, NaN, Infinity])(
		"rejects invalid version %s",
		(version) =>
			expect(() => convertApiVersion({}, version, 1, adapters)).toThrow(
				"positive integers",
			),
	);
	it("rejects ambiguous adapter registries", () => {
		for (const edges of [
			[adapters[0], adapters[0]],
			[{ ...adapters[0], to: 1 }],
			[{ ...adapters[0], id: "" }],
			[adapters[0], { ...adapters[0], id: "duplicate-pair" }],
		])
			expect(() => convertApiVersion({}, 1, 2, edges)).toThrow("unique");
	});
	it("reports the failing step and leaves the original payload recoverable", () => {
		expect(() =>
			convertApiVersion({}, 1, 2, [
				{
					from: 1,
					to: 2,
					id: "missing-equivalent",
					convert: () => {
						throw new Error("cannot convert operation");
					},
				},
			]),
		).toThrow("missing-equivalent failed: cannot convert operation");
		expect(() =>
			convertApiVersion({}, 1, 2, [
				{
					from: 1,
					to: 2,
					id: "bad",
					convert: () => {
						throw "bad";
					},
				},
			]),
		).toThrow("unsupported payload");
	});
});
