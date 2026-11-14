import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberate native MySQL checks: no jsdom setup and no default database fallback.
export default defineConfig({
	resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
	test: {
		environment: "node",
		include: [
			"tests/integration/archive-mysql.test.ts",
			"tests/integration/whatsapp-mysql.test.ts",
			"tests/integration/bulletin-approval-mysql.test.ts",
			"tests/integration/join-links-mysql.test.ts",
		],
		fileParallelism: false,
	},
});
