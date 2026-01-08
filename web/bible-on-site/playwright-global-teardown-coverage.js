import { CDPClient } from "monocart-coverage-reports";
import { addCoverageReport } from "monocart-reporter";
import { getRouterDebugPort } from "./get-debug-port";
import { sanitizeCoverage } from "./tests/util/coverage/sanitize-coverage";

const globalTeardown = async (config) => {
	let client;
	try {
		client = await CDPClient({
			port: getRouterDebugPort(),
		});
	} catch {
		// If we can't connect to the debug port, the server wasn't started with --inspect
		// This happens when reuseExistingServer picks up a pre-running dev server
		console.warn(
			`[coverage] Could not connect to debug port ${getRouterDebugPort()}. ` +
				"Coverage data will not be collected. " +
				"Stop any existing dev server and let Playwright start a fresh one with coverage instrumentation.",
		);
		return;
	}
	if (!client || !client.getIstanbulCoverage) {
		console.warn(
			`[coverage] Debug port ${getRouterDebugPort()} connected but Istanbul coverage not available. ` +
				"The dev server may not have been started with --inspect flag.",
		);
		return;
	}
	const coverageData = await client.getIstanbulCoverage();
	await client.close();
	sanitizeCoverage(coverageData);

	// there is no test info on teardown, just mock one with required config
	const mockTestInfo = {
		config,
	};
	if (Object.keys(coverageData).length > 0) {
		await addCoverageReport(coverageData, mockTestInfo);
	}
};

export default globalTeardown;
