/** @jest-environment node */
import { execFileSync } from "node:child_process";
import path from "node:path";

test("standalone runtime dependencies and canonical bytes survive the shared tracing root", () => {
	const output = execFileSync(
		process.execPath,
		[
			"--test",
			"--test-reporter=tap",
			path.resolve("scripts/standalone-layout.test.mjs"),
		],
		{
			encoding: "utf8",
			timeout: 20_000,
		},
	);
	expect(output).toContain("# fail 0");
});
