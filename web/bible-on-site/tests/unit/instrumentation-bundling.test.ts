/** @jest-environment node */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// Next vendors webpack (no standalone webpack package is installed); the
// compiled bundle only ships `any`-typed declarations, so the small surface
// this test uses is declared here.
const require = createRequire(__filename);
const { webpack } = require("next/dist/compiled/webpack/webpack") as {
	webpack: ((config: Record<string, unknown>) => {
		run: (cb: (err: Error | null, stats: WebpackStatsLike) => void) => void;
	}) & {
		DefinePlugin: new (defs: Record<string, string>) => unknown;
	};
};
const { DefinePlugin } = webpack;

interface WebpackStatsLike {
	hasErrors: () => boolean;
	toJson: (opts: Record<string, unknown>) => {
		errors?: { message?: string }[];
		modules?: { name?: string; moduleType?: string }[];
	};
}

// Mirror Next's runtime constants and raw-source corpus rule. Production must
// exclude the development corpus; development retains its HMR dependency as
// asset/source. Keep Jest's 5s default deadline as the regression check.
const srcDir = path.resolve(__dirname, "../../src");
const localModules = path.resolve(__dirname, "../../node_modules");
const tsLoader = path.resolve(__dirname, "../util/webpack-swc-ts-loader.cjs");
const bundleOutputDirs: string[] = [];

function makeBundleOutputDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "instr-bundle-"));
	bundleOutputDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of bundleOutputDirs) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * Bundles `src/instrumentation.ts` the way Next does per runtime:
 * `process.env.NEXT_RUNTIME` is a compile-time constant, so runtime-conditional
 * code must sit behind a constant-evaluable positive check for the bundler to
 * drop it (#3258). The edge variant uses a web target where `node:` builtins
 * are an unhandled scheme — the same UnhandledSchemeError webpack dev hit.
 */
function compileBundle(
	runtime: "edge" | "nodejs",
	nodeEnv: "production" | "development" = "production",
	entry = "./instrumentation.ts",
): Promise<WebpackStatsLike> {
	const compiler = webpack({
		// "none" skips the development-mode naming/nodeEnv plugin passes —
		// the assertions only inspect module names and errors.
		mode: "none",
		target: runtime === "nodejs" ? "node" : "webworker",
		context: srcDir,
		entry,
		output: {
			path: makeBundleOutputDir(),
			filename: "instrumentation.js",
		},
		devtool: false,
		resolve: {
			extensions: [".ts", ".tsx", ".js", ".json"],
			alias: { "@": srcDir },
			// Local node_modules first short-circuits the upward directory
			// walk; "node_modules" stays as the standard fallback.
			modules: [localModules, "node_modules"],
		},
		module: {
			rules: [
				{ test: /\.tsx?$/, use: [tsLoader] },
				{
					test: /sefaria-dump-5784-sivan-4\.tanah_view\.json$/,
					type: "asset/source",
				},
			],
		},
		plugins: [
			new DefinePlugin({
				"process.env.NEXT_RUNTIME": JSON.stringify(runtime),
				"process.env.NODE_ENV": JSON.stringify(nodeEnv),
			}),
		],
	});
	return new Promise((resolve, reject) => {
		compiler.run((err, stats) => {
			if (err) reject(err);
			else resolve(stats);
		});
	});
}

function moduleNames(stats: WebpackStatsLike): string[] {
	return (stats.toJson({ modules: true }).modules ?? [])
		.map((m) => m.name ?? "")
		.filter(Boolean);
}

describe("instrumentation bundling", () => {
	it("excludes the Node-only diagnostics module from the edge bundle", async () => {
		const stats = await compileBundle("edge");
		const errors = stats
			.toJson({ errors: true })
			.errors?.map((e) => e.message ?? "");
		expect({ errors, hasErrors: stats.hasErrors() }).toEqual({
			errors: [],
			hasErrors: false,
		});
		const names = moduleNames(stats);
		expect(
			names.filter(
				(n) =>
					n.includes("event-loop-diagnostics") ||
					n.includes("perf_hooks") ||
					n.includes("/data/db/"),
			),
		).toEqual([]);
	});

	it("keeps the diagnostics module reachable in the nodejs bundle", async () => {
		const stats = await compileBundle("nodejs");
		expect(stats.hasErrors()).toBe(false);
		const names = moduleNames(stats);
		expect(names.some((n) => n.includes("event-loop-diagnostics"))).toBe(true);
		expect(names.some((n) => n.includes("/data/db/sefarim.ts"))).toBe(true);
		expect(
			names.filter((n) =>
				n.includes("sefaria-dump-5784-sivan-4.tanah_view.json"),
			),
		).toEqual([]);
	});

	it("retains the raw-source corpus dependency for development HMR", async () => {
		const stats = await compileBundle(
			"nodejs",
			"development",
			"./data/db/sefarim.ts",
		);
		expect(stats.hasErrors()).toBe(false);
		const modules = stats.toJson({ modules: true }).modules ?? [];
		expect(
			modules
				.filter((m) =>
					m.name?.includes("sefaria-dump-5784-sivan-4.tanah_view.json"),
				)
				.map((m) => m.moduleType),
		).toEqual(["asset/source"]);
	});
});
