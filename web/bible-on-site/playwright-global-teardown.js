import { addCoverageReport } from "monocart-reporter";
import { CDPClient } from "monocart-coverage-reports";
import { getRouterDebugPort } from "./get-debug-port";

const globalTeardown = async (config) => {
  console.log("globalTeardown ...");

  const client = await CDPClient({
    port: getRouterDebugPort(),
  });

  const coverageData = await client.getIstanbulCoverage();
  await client.close();
  const SRC_DIR = __dirname + "\\src";
  for (const file in coverageData) {
    if (!coverageData[file].path.startsWith(SRC_DIR)) {
      delete coverageData[file];
    }
  }
  // console.log(Object.keys(coverageData));

  // there is no test info on teardown, just mock one with required config
  const mockTestInfo = {
    config,
  };
  if (Object.keys(coverageData).length > 0) {
    await addCoverageReport(coverageData, mockTestInfo);
  }
};

export default globalTeardown;
