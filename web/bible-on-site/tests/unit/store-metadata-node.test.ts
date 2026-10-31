/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

test("store metadata snapshot uses Node's explicit module format", async () => {
	const { stderr } = await promisify(execFile)(
		process.execPath,
		[
			"--trace-warnings",
			path.resolve("scripts/collect-store-metadata.mts"),
			"--ensure",
		],
		{
			timeout: 10_000,
			// Exercise the native loader even when the parent runner configures it.
			env: { ...process.env, NODE_OPTIONS: "", NODE_NO_WARNINGS: "" },
		},
	);

	expect(stderr).not.toContain("MODULE_TYPELESS_PACKAGE_JSON");
}, 15_000);
