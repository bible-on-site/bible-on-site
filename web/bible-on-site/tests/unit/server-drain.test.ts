/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

test("production launcher passes its real child-process and HTTP checks", async () => {
	const { stdout } = await promisify(execFile)(
		process.execPath,
		["--test", "--test-reporter=tap", path.resolve("scripts/start-server.test.mjs")],
		{ timeout: 20_000 },
	);
	expect(stdout).toContain("# fail 0");
}, 25_000);
