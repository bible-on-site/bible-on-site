import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberate native MySQL checks: no jsdom setup and no default database fallback.
export default defineConfig({
	resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
	test: {
		environment: "node",
		include: ["tests/integration/whatsapp-mysql.test.ts"],
		fileParallelism: false,
	},
});
