/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

test("local flip-book development preserves current builds and cached startup", async () => {
	const { stdout } = await promisify(execFile)(
		process.execPath,
		[
			"--test",
			"--test-reporter=tap",
			path.resolve("scripts/copy-local-flip-book.test.mjs"),
		],
		{ timeout: 20_000 },
	);
	expect(stdout).toContain("# fail 0");
}, 25_000);
