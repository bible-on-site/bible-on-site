import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react(), tsconfigPaths()],
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "lcov"],
			reportsDirectory: "./.coverage",
		},
	},
});
