import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"~": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	plugins: [react()],
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./tests/setup.ts"],
		include: ["tests/unit/**/*.{test,spec}.{js,jsx,ts,tsx}"],
		coverage: {
			provider: "v8",
			// Enumerate every eligible source file — loaded or not. The merged
			// module report's denominator is this canonical universe; without
			// it, files only the E2E build loads (routes, server-fn stubs) would
			// fall outside the report entirely (#2707).
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/routeTree.gen.ts",
				"src/test/**",
				"**/*.d.ts",
				"**/*.test.ts",
			],
			reporter: ["text", "json", "lcov"],
			// Aligns with tests/util/merge-coverage.mts (.coverage/unit/lcov.info)
			reportsDirectory: "./.coverage/unit",
		},
	},
});
