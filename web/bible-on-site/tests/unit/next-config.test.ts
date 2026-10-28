/** @jest-environment node */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

function cssChunking(turbopack: string) {
	const url = pathToFileURL(
		path.resolve(__dirname, "../../next.config.mjs"),
	).href;
	return JSON.parse(
		execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const config = await import(${JSON.stringify(url)}); console.log(JSON.stringify(config.default.experimental.cssChunking));`,
			],
			{ encoding: "utf8", env: { ...process.env, TURBOPACK: turbopack } },
		).trim(),
	);
}

describe("next.config.mjs", () => {
	it("keeps dependency-graph CSS chunking enabled", () => {
		// #2735: the default merge-everything strategy shipped one ~85 KiB
		// shared chunk (with pedia-only styles) to perek pages. "graph" splits
		// CSS so routes download close to only what they import. A silent
		// revert restores the large shared chunk on ~4000 generated pages.
		expect(cssChunking("auto")).toBe("graph");
		expect(cssChunking("1")).toBe("graph");
	});
	it("supports the documented webpack development command", () => {
		expect(cssChunking("")).toBe(true);
	});
});
