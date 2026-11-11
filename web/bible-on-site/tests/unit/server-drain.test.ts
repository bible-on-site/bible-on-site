/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

// node --test runs each file in its own process, in parallel. Splitting the
// jest wrapper per file gives every suite its own execFile budget: under CI
// coverage load the whole-suite invocation exceeded the shared 20s timeout
// even though each file finishes in a fraction of it.
const suites = [
	"start-server-drain.test.mjs",
	"start-server-remote.test.mjs",
	"start-server-signals.test.mjs",
	"start-server-lifecycle.test.mjs",
	"start-server-probe.test.mjs",
];

for (const suite of suites) {
	test.concurrent(`passes ${suite}'s real child-process and HTTP checks`, async () => {
		let stdout: string;
		try {
			({ stdout } = await promisify(execFile)(
				process.execPath,
				["--test", "--test-reporter=tap", path.resolve(`scripts/${suite}`)],
				{ timeout: 20_000 },
			));
		} catch (error) {
			const failure = error as Error & { stdout?: string; stderr?: string };
			throw new Error(
				`${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
				{ cause: error },
			);
		}
		expect(stdout).toContain("# fail 0");
	}, 25_000);
}
