/** @jest-environment node */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
	loadWarmDerived,
	WARM_DERIVED_ARTIFACT_PATH,
	WARM_DERIVED_CORPUS_PATH,
	type WarmDerived,
} from "@/data/db/warm-derived";

const derivedKey = Symbol.for("bible-on-site.warm-derived");
const cwd = process.cwd();
const corpusPath = resolve(cwd, WARM_DERIVED_CORPUS_PATH);
const artifactPath = resolve(cwd, WARM_DERIVED_ARTIFACT_PATH);
const corpusBytes = Buffer.from("fake-corpus-br-bytes");
const corpusSha256 = createHash("sha256").update(corpusBytes).digest("hex");

function fixture(partial: Partial<WarmDerived> = {}): WarmDerived {
	return {
		corpusSha256,
		perakim: [
			{
				perekId: 1,
				source: "בראשית א",
				header: "בריאת העולם",
				normalizedSource: "בראשית א",
				normalizedHeader: "בריאת העולם",
			},
		],
		pesukim: [
			{
				perekId: 1,
				pasukNum: 1,
				text: "בְּרֵאשִׁית",
				normalized: "בראשית",
				reference: "בראשית א א",
			},
		],
		recitations: [
			{
				perekId: 2,
				audioSha256: "a".repeat(64),
				textSha256: "b".repeat(64),
				durationMs: 5000,
				alignmentStatus: "ready",
				words: [
					{ pasuk: 1, segment: 1, text: "בראשית", startMs: 101, endMs: 599 },
				],
			},
		],
		...partial,
	};
}

function options(
	files: Record<string, Buffer | string>,
	extra: Parameters<typeof loadWarmDerived>[0] = {},
) {
	return {
		env: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
		read: (path: string) => {
			const found = files[path];
			if (found === undefined) {
				const error = new Error(
					`ENOENT: no such file or directory, open '${path}'`,
				) as NodeJS.ErrnoException;
				error.code = "ENOENT";
				throw error;
			}
			return found;
		},
		decompress: (data: Buffer | string) => data,
		...extra,
	};
}

const paths = (artifact: string | object | undefined) => ({
	[corpusPath]: corpusBytes,
	...(artifact === undefined
		? {}
		: {
				[artifactPath]:
					typeof artifact === "string" ? artifact : JSON.stringify(artifact),
			}),
});

describe("loadWarmDerived", () => {
	it("returns null under the test fixture environment", () => {
		expect(
			loadWarmDerived(options(paths(fixture()), { env: process.env })),
		).toBeNull();
	});

	it("returns null outside production", () => {
		expect(
			loadWarmDerived(
				options(paths(fixture()), {
					env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
				}),
			),
		).toBeNull();
	});

	it("returns null when WARM_DERIVED_DISABLE is set", () => {
		expect(
			loadWarmDerived(
				options(paths(fixture()), {
					env: {
						...process.env,
						IS_TEST_ENV: "",
						NODE_ENV: "production",
						WARM_DERIVED_DISABLE: "1",
					},
				}),
			),
		).toBeNull();
	});

	it("returns the parsed artifact when its digest matches the corpus", () => {
		const derived = fixture();
		expect(loadWarmDerived(options(paths(derived)))).toEqual(derived);
	});

	it("returns null quietly when the artifact is absent", () => {
		const warn = jest.fn();
		expect(loadWarmDerived(options(paths(undefined), { warn }))).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("returns null quietly when the corpus is absent", () => {
		const warn = jest.fn();
		expect(
			loadWarmDerived(
				options({ [artifactPath]: JSON.stringify(fixture()) }, { warn }),
			),
		).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns and returns null on a digest mismatch (stale artifact)", () => {
		const warn = jest.fn();
		const stale = fixture({ corpusSha256: "0".repeat(64) });
		expect(loadWarmDerived(options(paths(stale), { warn }))).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("stale"));
	});

	it.each([
		"null", // a JSON null: digest check short-circuits
		{ corpusSha256 }, // digest matches but data arrays missing
		{ corpusSha256, perakim: "not-an-array" },
	])("warns and returns null on an incomplete artifact: %j", (malformed) => {
		const warn = jest.fn();
		expect(loadWarmDerived(options(paths(malformed), { warn }))).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("stale"));
	});

	it("warns and returns null on a corrupt artifact body", () => {
		const warn = jest.fn();
		expect(loadWarmDerived(options(paths("{not-json"), { warn }))).toBeNull();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("unreadable"),
			expect.anything(),
		);
	});
});

describe("warmDerived", () => {
	// jest sets IS_TEST_ENV: the cached process-wide entry resolves to null
	// here, while still covering the cache-hit and store branches.
	afterEach(() => {
		Reflect.deleteProperty(globalThis, derivedKey);
	});

	it("caches the resolved entry across calls", async () => {
		jest.resetModules();
		const { warmDerived } = await import("@/data/db/warm-derived");
		expect(warmDerived()).toBeNull();
		expect(warmDerived()).toBeNull();
		expect(Object.hasOwn(globalThis, derivedKey)).toBe(true);
	});

	it("returns a pre-seeded verified entry without re-reading", async () => {
		jest.resetModules();
		const derived = fixture();
		(globalThis as Record<symbol, unknown>)[derivedKey] = derived;
		const { warmDerived } = await import("@/data/db/warm-derived");
		expect(warmDerived()).toBe(derived);
	});
});
