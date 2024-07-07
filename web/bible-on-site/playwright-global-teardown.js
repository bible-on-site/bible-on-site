import { CDPClient } from "monocart-coverage-reports";
import { addCoverageReport } from "monocart-reporter";
import { getRouterDebugPort } from "./get-debug-port";
import { filterOutCoverageRedundantFiles } from "./tests/util/coverage/filter-out-coverage-redundant-files";

const globalTeardown = async (config) => {
	const client = await CDPClient({
		port: getRouterDebugPort(),
	});

	const coverageData = await client.getIstanbulCoverage();
	await client.close();
	filterOutCoverageRedundantFiles(coverageData);

	// there is no test info on teardown, just mock one with required config
	const mockTestInfo = {
		config,
	};
	if (Object.keys(coverageData).length > 0) {
		await addCoverageReport(coverageData, mockTestInfo);
	}
};

export default globalTeardown;
