import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { FullConfig } from "@playwright/test";
import { CDPClient } from "monocart-coverage-reports";
import { addCoverageReport } from "monocart-reporter";
import { E2E_SERVER_DEBUG_PORT } from "./e2e-debug-port";

const V8_COVERAGE_DIR = ".coverage/e2e/.v8";

/**
 * Collects the Vite/Nitro dev server's V8 coverage. The launcher starts Vite
 * with NODE_V8_COVERAGE=<dir> and --inspect; this teardown asks the process to
 * exit over CDP, which makes Node flush coverage-*.json files into that dir —
 * they are then fed to monocart-reporter.
 */
const globalTeardown = async (config: FullConfig) => {
	let client: Awaited<ReturnType<typeof CDPClient>> | undefined;
	try {
		client = await CDPClient({ port: E2E_SERVER_DEBUG_PORT });
	} catch {
		// The server wasn't started with --inspect — e.g. reuseExistingServer
		// picked up a dev server that was already running without coverage.
		console.warn(
			`[coverage] Could not connect to debug port ${E2E_SERVER_DEBUG_PORT}. ` +
				"Server-side coverage will not be collected. " +
				"Stop any existing dev server and let Playwright start a fresh instrumented one.",
		);
		return;
	}

	if (!client) return;
	// `session` is not part of the public type surface but exists at runtime.
	const session = (
		client as unknown as {
			session?: {
				send: (
					method: string,
					params?: Record<string, unknown>,
				) => Promise<unknown>;
			};
		}
	).session;
	if (!session) {
		console.warn(
			`[coverage] Debug port ${E2E_SERVER_DEBUG_PORT} connected without a CDP session.`,
		);
		return;
	}
	await session.send("Runtime.enable");
	// The target exits while evaluating, so the response and the websocket close
	// can race — never await this call.
	void session
		.send("Runtime.evaluate", { expression: "process.exit(0)" })
		.catch(() => {});
	void client.close().catch(() => {});

	// Wait for NODE_V8_COVERAGE to flush coverage-*.json to disk.
	const v8Dir = join(process.cwd(), V8_COVERAGE_DIR);
	let files: string[] = [];
	for (let i = 0; i < 50; i++) {
		files = readdirSync(v8Dir).filter((f) => f.endsWith(".json"));
		if (files.length > 0) break;
		await delay(200);
	}
	if (files.length === 0) {
		console.warn(
			`[coverage] No server coverage files in ${v8Dir} — was Vite started with NODE_V8_COVERAGE?`,
		);
		return;
	}

	// There is no test info on teardown — mock the shape monocart needs.
	const mockTestInfo = { config } as Parameters<typeof addCoverageReport>[1];
	for (const file of files) {
		const data = JSON.parse(readFileSync(join(v8Dir, file), "utf8"));
		if (data?.result?.length) {
			await addCoverageReport(data, mockTestInfo);
		}
	}
};

export default globalTeardown;
