/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("checks a real PDF without any filesystem write permission", () => {
	const dir = join(tmpdir(), `calendar-pdf-check-${randomUUID()}`);
	const result = spawnSync(
		process.execPath,
		[
			"--permission",
			"--allow-fs-read=*",
			"--allow-child-process",
			"--allow-worker",
			"--import",
			"tsx",
			"scripts/generate-calendar-pdfs.mts",
			"--check",
			"--sample",
			"1",
			"--dir",
			dir,
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			env: { ...process.env, TSX_DISABLE_CACHE: "1" },
			timeout: 60_000,
		},
	);
	if (result.error || result.status !== 0) {
		throw new Error(result.stderr, { cause: result.error });
	}
	const report = JSON.parse(result.stdout.trim());
	expect(report.mode).toBe("check");
	expect(report.sampleSmokeOnly).toBe(1);
	expect(report.sampleMismatched).toEqual([]);
	expect(existsSync(dir)).toBe(false);
}, 65_000);
