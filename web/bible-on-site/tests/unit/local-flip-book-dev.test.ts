/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

test("local flip-book development preserves current builds and cached startup", async () => {
	try {
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
	} catch (error) {
		const failure = error as Error & { stdout?: string; stderr?: string };
		throw new Error(
			[failure.message, failure.stdout, failure.stderr]
				.filter(Boolean)
				.join("\n"),
			{ cause: error },
		);
	}
}, 25_000);
