const { transformSync } = require("@swc/core");

// Minimal webpack loader for bundling-level tests: strips TS types via SWC
// and keeps ESM syntax so webpack still performs its own dependency analysis
// (dead-branch skipping, import() chunking, scheme checks).
module.exports = function swcTsLoader(source) {
	const { code } = transformSync(source, {
		filename: this.resourcePath,
		jsc: { parser: { syntax: "typescript" }, target: "es2022" },
		module: { type: "es6" },
	});
	return code;
};
