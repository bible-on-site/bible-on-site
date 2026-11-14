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
		modules?: { name?: string }[];
	};
}

// Each `it` runs one vendored-webpack cold compile of instrumentation.ts
// (~5-15s typical); 60s bounds a pathological hang while leaving headroom for
// a loaded CI runner. Jest's 5s default is far too tight for a real webpack run.
jest.setTimeout(60_000);

const srcDir = path.resolve(__dirname, "../../src");
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
function compileInstrumentation(
	runtime: "edge" | "nodejs",
): Promise<WebpackStatsLike> {
	const compiler = webpack({
		mode: "development",
		target: runtime === "nodejs" ? "node" : "webworker",
		context: srcDir,
		entry: "./instrumentation.ts",
		output: {
			path: makeBundleOutputDir(),
			filename: "instrumentation.js",
		},
		devtool: false,
		resolve: {
			extensions: [".ts", ".tsx", ".js", ".json"],
			alias: { "@": srcDir },
		},
		module: { rules: [{ test: /\.tsx?$/, use: [tsLoader] }] },
		plugins: [
			new DefinePlugin({
				"process.env.NEXT_RUNTIME": JSON.stringify(runtime),
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
		const stats = await compileInstrumentation("edge");
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
				(n) => n.includes("event-loop-diagnostics") || n.includes("perf_hooks"),
			),
		).toEqual([]);
	});

	it("keeps the diagnostics module reachable in the nodejs bundle", async () => {
		const stats = await compileInstrumentation("nodejs");
		expect(stats.hasErrors()).toBe(false);
		expect(
			moduleNames(stats).some((n) => n.includes("event-loop-diagnostics")),
		).toBe(true);
	});
});
