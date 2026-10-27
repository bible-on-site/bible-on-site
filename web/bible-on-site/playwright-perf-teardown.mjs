import { fileURLToPath } from "node:url";
import { finalizeBenchmarks } from "./scripts/benchmark-store.cjs";

export default function teardown() {
	finalizeBenchmarks(
		fileURLToPath(new URL(".playwright-report/perf/bencher", import.meta.url)),
	);
}
