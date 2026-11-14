import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import globalSetup from "./playwright-global-setup.js";

export default async function setup(config) {
	// Keep performance cleanup out of the shared E2E setup: running E2E after
	// performance tests must not erase the saved performance diagnostics.
	for (const directory of ["bencher/fragments", "diagnostics"]) {
		rmSync(
			fileURLToPath(
				new URL(`.playwright-report/perf/${directory}`, import.meta.url),
			),
			{ recursive: true, force: true },
		);
	}
	await globalSetup(config);
}
