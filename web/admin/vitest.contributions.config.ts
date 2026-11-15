import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
	test: {
		environment: "node",
		include: ["tests/integration/contributions-mysql.test.ts"],
		fileParallelism: false,
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/routeTree.gen.ts",
				"src/test/**",
				"**/*.d.ts",
				"**/*.test.ts",
			],
			reporter: ["text-summary", "json", "lcov"],
			reportsDirectory: "./.coverage/mysql",
		},
	},
});
