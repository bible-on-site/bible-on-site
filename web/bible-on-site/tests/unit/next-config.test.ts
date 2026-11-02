/** @jest-environment node */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const configUrl = pathToFileURL(
	path.resolve(__dirname, "../../next.config.mjs"),
).href;
const budgetUrl = pathToFileURL(
	path.resolve(__dirname, "../../scripts/build-worker-budget.mjs"),
).href;

function nativeJson(source: string, env: Record<string, string> = {}) {
	return JSON.parse(
		execFileSync(process.execPath, ["--input-type=module", "-e", source], {
			encoding: "utf8",
			env: { ...process.env, ...env },
		}).trim(),
	);
}

function cssChunking(turbopack: string) {
	return nativeJson(
		`const { default: configure } = await import(${JSON.stringify(configUrl)});
		 const { PHASE_DEVELOPMENT_SERVER } = await import("next/constants.js");
		 const config = configure(PHASE_DEVELOPMENT_SERVER, { defaultConfig: { experimental: { cpus: 1 } } });
		 console.log(JSON.stringify(config.experimental.cssChunking));`,
		{ TURBOPACK: turbopack },
	);
}

describe("next.config.mjs", () => {
	it("keeps dependency-graph CSS chunking enabled", () => {
		// #2735: the default merge-everything strategy shipped one ~85 KiB
		// shared chunk (with pedia-only styles) to perek pages. "graph" splits
		// CSS so routes download close to only what they import. A silent
		// revert restores the large shared chunk on ~4000 generated pages.
		expect(cssChunking("auto")).toBe("graph");
		expect(cssChunking("1")).toBe("graph");
	});
	it("supports the documented webpack development command", () => {
		expect(cssChunking("")).toBe(true);
	});

	it.each(["linux", "darwin", "win32"])(
		"budgets only production builds on %s and preserves other options",
		(platform) => {
			const result = nativeJson(
				`import os from "node:os";
			 import { syncBuiltinESMExports } from "node:module";
			 import { isDeepStrictEqual } from "node:util";
			 const calls = { available: 0, constrained: 0, parallelism: 0 };
			 process.availableMemory = () => { calls.available++; return 7_140_000_000; };
			 process.constrainedMemory = () => { calls.constrained++; return 0; };
			 os.availableParallelism = () => { calls.parallelism++; return 20; };
			 syncBuiltinESMExports();
			 const { default: configure } = await import(${JSON.stringify(configUrl)});
			 const { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_DEVELOPMENT_SERVER } = await import("next/constants.js");
			 Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
			 const context = { defaultConfig: { experimental: { cpus: 19 } } };
			 const server = configure(PHASE_PRODUCTION_SERVER, context);
			 const dev = configure(PHASE_DEVELOPMENT_SERVER, context);
			 const runtimeCalls = { ...calls };
			 const build = configure(PHASE_PRODUCTION_BUILD, context);
			 const { cpus, staticGenerationMaxConcurrency, ...experimental } = build.experimental;
			 console.log(JSON.stringify({
			   cpus, concurrency: staticGenerationMaxConcurrency ?? null, calls, runtimeCalls,
			   runtimeCpuOverride: Object.hasOwn(server.experimental, "cpus"),
			   runtimeConcurrencyOverride: Object.hasOwn(server.experimental, "staticGenerationMaxConcurrency"),
			   sameRuntimeOptions: isDeepStrictEqual(server, dev),
			   sameOtherBuildOptions: isDeepStrictEqual({ ...build, experimental }, server)
			 }));`,
				{ NODE_ENV: "production" },
			);
			expect(result).toEqual({
				cpus: 5,
				concurrency: platform === "win32" ? 1 : null,
				calls: { available: 1, constrained: 1, parallelism: 1 },
				runtimeCalls: { available: 0, constrained: 0, parallelism: 0 },
				runtimeCpuOverride: false,
				runtimeConcurrencyOverride: false,
				sameRuntimeOptions: true,
				sameOtherBuildOptions: true,
			});
		},
	);
});

const GiB = 1024 ** 3;
const resources = {
	defaultCpuLimit: 19,
	parallelism: 20,
	availableBytes: 32 * GiB,
	constrainedBytes: 0,
};

it.each([
	["keeps Next's CPU ceiling when memory is ample", {}, 19],
	[
		"keeps the one-worker Next default on two-core CI",
		{ defaultCpuLimit: 1, parallelism: 2 },
		1,
	],
	["honors a smaller available CPU allocation", { parallelism: 2 }, 2],
	[
		"budgets the measured 7.14 GB of free host memory",
		{ availableBytes: 7_140_000_000 },
		5,
	],
	["reserves a full GiB for the parent", { availableBytes: 3 * GiB }, 2],
	[
		"respects a nonzero process memory constraint",
		{ constrainedBytes: 4 * GiB },
		3,
	],
	[
		"uses lower current free memory than the constraint",
		{ availableBytes: 3 * GiB, constrainedBytes: 8 * GiB },
		2,
	],
	[
		"still permits one worker below the memory budget",
		{ availableBytes: GiB / 2 },
		1,
	],
	[
		"permits one worker when no free memory is reported",
		{ availableBytes: 0 },
		1,
	],
	[
		"degrades to one worker if available memory is unknown",
		{ availableBytes: undefined },
		1,
	],
	[
		"degrades to one worker if Next's CPU ceiling is unknown",
		{ defaultCpuLimit: undefined },
		1,
	],
] as const)("build worker budget %s", (_name, overrides, expected) => {
	const count = nativeJson(
		`const { getBuildWorkerCount } = await import(${JSON.stringify(budgetUrl)});
		 console.log(JSON.stringify(getBuildWorkerCount(${JSON.stringify({ ...resources, ...overrides })})));`,
	);
	expect(count).toBe(expected);
});
