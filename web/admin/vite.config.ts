import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { createInstrumenter } from "istanbul-lib-instrument";
import { nitro } from "nitro/vite";
import type { LoggingFunction, RollupLog } from "rolldown";

import type { Plugin } from "vite";
import istanbul from "vite-plugin-istanbul";
import { defineConfig } from "vitest/config";

// vite-plugin-istanbul only instruments the client transform (it returns early
// on `options.ssr`), so SSR modules need a matching instrumenter writing to the
// server realm's globalThis.__coverage__ — drained by /api/dev/coverage.
function ssrIstanbulPlugin(): Plugin {
	const srcRoot = fileURLToPath(new URL("./src/", import.meta.url)).replace(
		/\\/g,
		"/",
	);
	const instrumenter = createInstrumenter({
		esModules: true,
		produceSourceMap: true,
		autoWrap: true,
	});
	return {
		name: "admin-ssr-istanbul",
		apply: "serve",
		enforce: "post",
		transform(code, id, options) {
			if (!options?.ssr) return;
			const filename = id.split("?")[0].replace(/\\/g, "/");
			if (
				!filename.startsWith(srcRoot) ||
				filename.includes("routeTree.gen") ||
				filename.includes(".test.") ||
				filename.includes("/test/")
			) {
				return;
			}
			// istanbul's RawSourceMap and rolldown's SourceMap disagree on the
			// `version` field type (string vs number) — cast across both sides.
			return {
				code: instrumenter.instrumentSync(
					code,
					filename,
					this.getCombinedSourcemap() as never,
				),
				map: instrumenter.lastSourceMap() as never,
			};
		},
	};
}

function handleRollupWarning(warning: RollupLog, warn: LoggingFunction) {
	const sourceIds = [warning.id, ...(warning.ids ?? [])];
	const isTanStackDependency =
		sourceIds.some((id) =>
			id?.replace(/\\/g, "/").includes("/node_modules/@tanstack/"),
		) || warning.message.includes('in "node_modules/@tanstack/');
	const isKnownDirective =
		warning.code === "MODULE_LEVEL_DIRECTIVE" &&
		warning.message.includes('"use client"');
	const isKnownUnusedImport = warning.code === "UNUSED_EXTERNAL_IMPORT";
	const isNitroEmptyLibraryChunk =
		warning.code === "EMPTY_BUNDLE" &&
		warning.message.startsWith('Generated an empty chunk: "_libs/');

	if (
		(isTanStackDependency && (isKnownDirective || isKnownUnusedImport)) ||
		isNitroEmptyLibraryChunk
	) {
		return;
	}

	warn(warning);
}

export default defineConfig({
	build: {
		rollupOptions: {
			onwarn: handleRollupWarning,
		},
	},
	resolve: {
		alias: {
			"~": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 3101,
	},
	plugins: [
		tailwindcss(),
		tanstackStart(),
		nitro({ rollupConfig: { onwarn: handleRollupWarning } }),
		viteReact(),
		// Instrument app modules for e2e coverage — both the client bundle and
		// Nitro SSR modules set globalThis.__coverage__ in their realm.
		...(process.env.MEASURE_COV === "1"
			? [
					istanbul({
						include: "src/**/*.{ts,tsx,js,jsx}",
						extension: [".ts", ".tsx", ".js", ".jsx"],
						exclude: [
							"src/routeTree.gen.ts",
							"src/**/*.test.{ts,tsx}",
							"src/test/**",
						],
						requireEnv: false,
					}),
					ssrIstanbulPlugin(),
				]
			: []),
	],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/test/setup.ts"],
		coverage: {
			provider: "v8",
			reportsDirectory: ".coverage/unit",
			reporter: ["text", "lcov", "html"],
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/routeTree.gen.ts",
				"src/test/**",
				"**/*.d.ts",
				"**/*.test.ts",
			],
		},
	},
});
