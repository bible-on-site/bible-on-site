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
			reporter: ["text", "json", "lcov"],
			// Aligns with tests/util/merge-coverage.mts (.coverage/unit/lcov.info)
			reportsDirectory: "./.coverage/unit",
		},
	},
});
