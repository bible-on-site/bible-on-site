/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";

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

// A failing or execFile-killed suite still wrote a TAP stream to stdout — but
// the default execFile error message keeps only "Command failed: …", so the
// stall that timed the child out reports nothing about which subtest hung.
// Reject with the positional stdout/stderr (the error object's own .stdout is
// not populated on every platform) so the TAP detail names the failing file.
const runSuite = (suite: string) =>
	new Promise<string>((resolve, reject) => {
		execFile(
			process.execPath,
			["--test", "--test-reporter=tap", path.resolve(`scripts/${suite}`)],
			{ timeout: 20_000 },
			(error, stdout, stderr) => {
				if (error) {
					reject(
						new Error(
							[error.message, stdout, stderr].filter(Boolean).join("\n"),
							{ cause: error },
						),
					);
					return;
				}
				resolve(stdout);
			},
		);
	});

for (const suite of suites) {
	test.concurrent(`${suite} passes its real child-process and HTTP checks`, async () => {
		const stdout = await runSuite(suite);
		expect(stdout).toContain("# fail 0");
	}, 25_000);
}
