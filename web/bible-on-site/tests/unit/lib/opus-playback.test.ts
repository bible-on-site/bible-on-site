/** @jest-environment node */
import { execFileSync } from "node:child_process";

test("shipped offline Opus decoder preserves pre-skip, final frames and exact selected ranges", () => {
	const output = execFileSync(
		process.execPath,
		["scripts/check-opus-decoder.mjs"],
		{ cwd: process.cwd(), encoding: "utf8" },
	);
	expect(output).toContain("96000 frames; exact range lengths");
});
