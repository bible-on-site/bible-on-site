/** @jest-environment node */
import type {
	PerekEntityReference,
	PerekScopedEntityReference,
} from "@/lib/tanahpedia/service";

type Loader = (ids: number[]) => Promise<PerekScopedEntityReference[]>;
type CacheOptions = { tags: string[]; revalidate: false };
const mockCurated = jest.fn(
	async (_ids: number[]): Promise<PerekScopedEntityReference[]> => [],
);
const mockMentions = jest.fn(
	async (_ids: number[]): Promise<PerekScopedEntityReference[]> => [],
);
const mockCache = jest.fn(
	(loader: Loader, _keys: string[], _options: CacheOptions): Loader => {
		const values = new Map<string, PerekScopedEntityReference[]>();
		return async (ids) => {
			const key = JSON.stringify([ids]);
			const cached = values.get(key);
			if (cached) return cached;
			// Rejections are deliberately not stored, as with unstable_cache.
			const rows = await loader(ids);
			values.set(key, rows);
			return rows;
		};
	},
);

jest.mock("next/cache", () => ({
	unstable_cache: (...args: Parameters<typeof mockCache>) => mockCache(...args),
}));
jest.mock("@/lib/tanahpedia/service", () => ({
	getEntityReferencesForPereks: (ids: number[]) => mockCurated(ids),
	getMentionReferencesForPereks: (ids: number[]) => mockMentions(ids),
}));

let fetchRefs: typeof import("@/lib/tanahpedia/perek-entity-refs").fetchAllEntityRefs;
const reference = (
	overrides: Partial<PerekEntityReference> = {},
): PerekEntityReference => ({
	entityId: "person",
	entityName: "A person",
	entityType: "PERSON",
	entryUniqueName: null,
	pasukNumber: 2,
	segmentStart: null,
	segmentEnd: null,
	...overrides,
});
const row = (
	perekId: number,
	entityId = `person-${perekId}`,
): PerekScopedEntityReference => ({
	perekId,
	...reference({ entityId }),
});

beforeEach(async () => {
	jest.resetModules();
	mockCurated.mockReset().mockResolvedValue([]);
	mockMentions.mockReset().mockResolvedValue([]);
	mockCache.mockClear();
	({ fetchAllEntityRefs: fetchRefs } = await import(
		"@/lib/tanahpedia/perek-entity-refs"
	));
});

test("an empty book performs no cache lookups or SQL queries", async () => {
	expect(await fetchRefs([])).toEqual({});
	expect(mockCache).not.toHaveBeenCalled();
	expect(mockCurated).not.toHaveBeenCalled();
	expect(mockMentions).not.toHaveBeenCalled();
});

test("150 chapters require six bounded cache lookups with every exact invalidation tag", async () => {
	const ids = Array.from({ length: 150 }, (_, index) => 150 - index);
	await fetchRefs(ids);
	expect(mockCache).toHaveBeenCalledTimes(6);
	for (const loader of [mockCurated, mockMentions]) {
		expect(loader.mock.calls.map(([batch]) => batch)).toEqual([
			Array.from({ length: 64 }, (_, index) => index + 1),
			Array.from({ length: 64 }, (_, index) => index + 65),
			Array.from({ length: 22 }, (_, index) => index + 129),
		]);
	}
	for (const [, keys, options] of mockCache.mock.calls) {
		const mention = keys[0] === "tanahpedia-mention-refs-batch";
		const batch = keys[1].split(",").map(Number);
		expect(options).toEqual({
			revalidate: false,
			tags: [
				mention ? "tanahpedia-mention-refs" : "tanahpedia-entity-refs",
				...batch.map(
					(id) => `perek:${id}:${mention ? "mention-refs" : "entity-refs"}`,
				),
			],
		});
		expect(batch.length).toBeLessThanOrEqual(64);
		expect(options.tags.length).toBeLessThanOrEqual(65);
	}
});

test("65 exact IDs split at the 64-ID boundary without adjacent chapters", async () => {
	const ids = Array.from({ length: 65 }, (_, index) => index + 300);
	await fetchRefs(ids);
	for (const loader of [mockCurated, mockMentions]) {
		expect(loader.mock.calls.map(([batch]) => batch)).toEqual([
			ids.slice(0, 64),
			[364],
		]);
	}
	expect(mockCache).toHaveBeenCalledTimes(4);
});

test("sparse chapter requests do not query or tag an enclosing range", async () => {
	mockCurated.mockResolvedValue([row(12), row(927)]);
	expect(await fetchRefs([927, 12, 450])).toEqual({
		12: [reference({ entityId: "person-12" })],
		927: [reference({ entityId: "person-927" })],
	});
	expect(mockCurated).toHaveBeenCalledWith([12, 450, 927]);
	expect(mockMentions).toHaveBeenCalledWith([12, 450, 927]);
	for (const [, , options] of mockCache.mock.calls) {
		expect(options.tags).toHaveLength(4);
		expect(options.tags.some((tag) => tag.startsWith("perek:13:"))).toBe(false);
	}
});

test("permutations and duplicates share definitions and invocation keys without mutating input", async () => {
	const ids = [3, 1, 3, 2];
	Object.freeze(ids);
	mockCurated.mockResolvedValue([row(2)]);
	const first = await fetchRefs(ids);
	expect(await fetchRefs([2, 3, 1, 1])).toEqual(first);
	expect(ids).toEqual([3, 1, 3, 2]);
	expect(mockCurated).toHaveBeenCalledTimes(1);
	expect(mockMentions).toHaveBeenCalledTimes(1);
	expect(mockCurated).toHaveBeenCalledWith([1, 2, 3]);
	expect(mockCache).toHaveBeenCalledTimes(2);
});

test("an exact subrange has its own key and loader arguments", async () => {
	mockCurated.mockImplementation(async (ids) => ids.map((id) => row(id)));
	await fetchRefs([12, 13]);
	expect(await fetchRefs([13])).toEqual({
		13: [reference({ entityId: "person-13" })],
	});
	expect(mockCurated.mock.calls).toEqual([[[12, 13]], [[13]]]);
	expect(mockCache).toHaveBeenCalledTimes(4);
});

test("curated refs lead each chapter while manual mention SQL order stays intact", async () => {
	mockCurated.mockResolvedValue([
		row(3, "curated-a"),
		row(7),
		row(3, "curated-b"),
	]);
	mockMentions.mockResolvedValue([
		row(3, "manual-first"),
		row(3, "auto-second"),
		row(7, "mention-seven"),
	]);
	const result = await fetchRefs([7, 3]);
	expect(result[3].map((ref) => ref.entityId)).toEqual([
		"curated-a",
		"curated-b",
		"manual-first",
		"auto-second",
	]);
	expect(result[7].map((ref) => ref.entityId)).toEqual([
		"person-7",
		"mention-seven",
	]);
});

test("public payloads contain exactly seven fields, preserve nulls and do not expose scoped data", async () => {
	const scoped = { ...row(3), internalColumn: "private" };
	mockCurated.mockResolvedValue([scoped]);
	const result = await fetchRefs([3]);
	expect(result).toEqual({ 3: [reference({ entityId: "person-3" })] });
	expect(Object.keys(result[3][0]).sort()).toEqual([
		"entityId",
		"entityName",
		"entityType",
		"entryUniqueName",
		"pasukNumber",
		"segmentEnd",
		"segmentStart",
	]);
	expect(scoped.perekId).toBe(3);
	result[3][0].entityName = "mutated public value";
	expect((await fetchRefs([3]))[3][0].entityName).toBe("A person");
});

test("an unrelated scoped row cannot create an unrequested output chapter", async () => {
	mockCurated.mockResolvedValue([row(12), row(13)]);
	expect(await fetchRefs([12])).toEqual({
		12: [reference({ entityId: "person-12" })],
	});
});

test.each([
	["curated", { code: "ER_NO_SUCH_TABLE" }],
	["mentions", { errno: 1054 }],
] as const)(
	"a missing %s schema keeps healthy cached data and retries only the failed family",
	async (family, failure) => {
		const failed = family === "curated" ? mockCurated : mockMentions;
		const healthy = family === "curated" ? mockMentions : mockCurated;
		failed
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce([row(12, "recovered")]);
		healthy.mockResolvedValue([row(12, "healthy")]);
		expect(await fetchRefs([12])).toEqual({
			12: [reference({ entityId: "healthy" })],
		});
		const result = await fetchRefs([12]);
		expect(result[12].map((ref) => ref.entityId)).toEqual(
			family === "curated"
				? ["recovered", "healthy"]
				: ["healthy", "recovered"],
		);
		expect(failed).toHaveBeenCalledTimes(2);
		expect(healthy).toHaveBeenCalledTimes(1);
	},
);

test.each(["curated", "mentions"] as const)(
	"operational %s failures reject and remain retryable",
	async (family) => {
		const failed = family === "curated" ? mockCurated : mockMentions;
		const healthy = family === "curated" ? mockMentions : mockCurated;
		const failure = new Error("connection reset");
		failed.mockRejectedValueOnce(failure).mockResolvedValueOnce([row(12)]);
		await expect(fetchRefs([12])).rejects.toBe(failure);
		expect(await fetchRefs([12])).toEqual({
			12: [reference({ entityId: "person-12" })],
		});
		expect(failed).toHaveBeenCalledTimes(2);
		expect(healthy).toHaveBeenCalledTimes(1);
	},
);

test("both missing schemas degrade without storing fallback empties", async () => {
	mockCurated.mockRejectedValue({ errno: 1146 });
	mockMentions.mockRejectedValue({ code: "ER_BAD_FIELD_ERROR" });
	expect(await fetchRefs([12])).toEqual({});
	mockCurated.mockResolvedValue([row(12)]);
	mockMentions.mockResolvedValue([]);
	expect(await fetchRefs([12])).toEqual({
		12: [reference({ entityId: "person-12" })],
	});
});
