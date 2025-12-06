const { rmSync } = require("node:fs");
const { resolve } = require("node:path");

/** @param {import('@playwright/test').FullConfig} config */
// biome-ignore lint/correctness/noUnusedFunctionParameters: framework required function signature
module.exports = async function globalSetup(config) {
	rmSync(resolve(__dirname, ".cache", "playwright"), {
		recursive: true,
		force: true,
	});
};
