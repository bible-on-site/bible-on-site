import type { FullConfig } from "@playwright/test";
import { CDPClient } from "monocart-coverage-reports";
import { addCoverageReport } from "monocart-reporter";
import { E2E_SERVER_DEBUG_PORT } from "./e2e-debug-port";

/**
 * Pulls V8 coverage from the Vite/Nitro dev server (launched with
 * NODE_OPTIONS=--inspect by tests/util/launch-e2e-server.mts) and feeds it to
 * monocart-reporter. Mirrors the website's playwright-global-teardown-coverage.js.
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
	if (!client?.getIstanbulCoverage) {
		console.warn(
			`[coverage] Debug port ${E2E_SERVER_DEBUG_PORT} connected but Istanbul coverage not available.`,
		);
		return;
	}
	const coverageData = await client.getIstanbulCoverage();
	await client.close();

	// There is no test info on teardown — mock the shape monocart needs.
	const mockTestInfo = { config } as Parameters<typeof addCoverageReport>[1];
	if (Object.keys(coverageData).length > 0) {
		await addCoverageReport(coverageData, mockTestInfo);
	}
};

export default globalTeardown;
