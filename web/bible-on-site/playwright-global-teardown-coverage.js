import { addCoverageReport } from "monocart-reporter";
import { sanitizeCoverage } from "./tests/util/coverage/sanitize-coverage";

const WEB_SERVER_URL = "http://127.0.0.1:3001";

/**
 * Drains the dev server's remaining `global.__coverage__` one last time.
 *
 * Per-test coverage already flows through `window.__coverage__` (browser) and
 * `GET /api/dev/coverage` (server) in tests/util/playwright/test-fixture.ts —
 * all of it produced by the same swc-plugin-coverage-instrument instrumentation.
 * This final drain captures server counters that accumulated after the last
 * test context closed (e.g. trailing fetches or late module registrations).
 *
 * The previous implementation pulled V8 coverage over CDP
 * (`CDPClient.getIstanbulCoverage()`). V8->Istanbul conversion uses a
 * different coordinate system than the SWC plugin and only enumerates scripts
 * the dev server happened to compile during the run, so it polluted the report
 * with generated modules and a run-dependent denominator (#2670).
 */
const globalTeardown = async (config) => {
	let coverageData;
	try {
		// Loopback drain of the dev server's coverage counters — the hardcoded
		// 127.0.0.1 playwright webServer never leaves this machine.
		// nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
		const res = await fetch(`${WEB_SERVER_URL}/api/dev/coverage`);
		if (!res.ok) {
			console.warn(
				`[coverage] Server coverage drain returned ${res.status}. ` +
					"Residual server coverage will not be collected.",
			);
			return;
		}
		coverageData = await res.json();
	} catch {
		// The server is already down or was never started by Playwright
		// (reuseExistingServer may attach to a production server without the
		// dev-only /api/dev/coverage route).
		console.warn(
			`[coverage] Could not reach ${WEB_SERVER_URL}/api/dev/coverage. ` +
				"Residual server coverage will not be collected.",
		);
		return;
	}
	if (!coverageData || typeof coverageData !== "object") {
		return;
	}
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
