import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import type { LoggingFunction, RollupLog } from "rollup";
import { defineConfig } from "vitest/config";

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
