/** @jest-environment node */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

test("upgrades existing raw reader assets to Brotli without rewriting compressed assets", () => {
	const temporaryDirectory = realpathSync(tmpdir());
	const fixture = mkdtempSync(
		join(temporaryDirectory, "reader-asset-upgrade-"),
	);
	try {
		for (const directory of [
			"scripts",
			"src/data/db",
			"public/generated/sefarim",
		])
			mkdirSync(join(fixture, directory), { recursive: true });
		const source = {
			name: "Test book",
			helek: "Test",
			perekFrom: 1,
			perekTo: 929,
			perakim: Array.from({ length: 929 }, () => ({ date: [] })),
		};
		writeFileSync(
			join(fixture, "src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json"),
			JSON.stringify([source]),
		);
		const script = join(fixture, "scripts/generate-client-catalog.mjs");
		copyFileSync(
			join(process.cwd(), "scripts/generate-client-catalog.mjs"),
			script,
		);
		const payload = `${JSON.stringify(source)}\n`;
		const digest = createHash("sha256").update(payload).digest("hex");
		const asset = join(fixture, "public/generated/sefarim", `1.${digest}.json`);
		// Previous generator versions wrote raw JSON at this same public URL.
		writeFileSync(asset, payload);
		execFileSync(process.execPath, [script]);
		expect(brotliDecompressSync(readFileSync(asset)).toString("utf8")).toBe(
			payload,
		);

		const unchangedTime = new Date("2000-01-01T00:00:00Z");
		utimesSync(asset, unchangedTime, unchangedTime);
		execFileSync(process.execPath, [script]);
		expect(statSync(asset).mtimeMs).toBe(unchangedTime.getTime());
	} finally {
		expect(dirname(realpathSync(fixture))).toBe(temporaryDirectory);
		rmSync(fixture, { recursive: true, force: true });
	}
});
