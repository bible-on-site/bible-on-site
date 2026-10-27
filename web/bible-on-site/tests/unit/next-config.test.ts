/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";

const configSource = readFileSync(
	path.resolve(__dirname, "../../next.config.mjs"),
	"utf8",
);

describe("next.config.mjs", () => {
	it("keeps dependency-graph CSS chunking enabled", () => {
		// #2735: the default merge-everything strategy shipped one ~85 KiB
		// shared chunk (with pedia-only styles) to perek pages. "graph" splits
		// CSS so routes download close to only what they import. A silent
		// revert restores the large shared chunk on ~4000 generated pages.
		expect(configSource).toMatch(/cssChunking:\s*"graph"/);
	});
});
