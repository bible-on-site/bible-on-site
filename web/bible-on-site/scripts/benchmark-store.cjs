const {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} = require("node:fs");
const { join } = require("node:path");

function writeBenchmark(directory, entry) {
	if (!Number.isFinite(entry.value))
		throw new Error(`Non-finite benchmark: ${entry.name}`);
	const fragments = join(directory, "fragments");
	mkdirSync(fragments, { recursive: true });
	// Playwright workers are separate processes. Each owns its file; simultaneous
	// browser/build/memory tests cannot overwrite another worker's measurements.
	const file = join(fragments, `${process.pid}.json`);
	const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
	const metric = { value: entry.value };
	if (entry.lowerValue !== undefined) metric.lower_value = entry.lowerValue;
	if (entry.upperValue !== undefined) metric.upper_value = entry.upperValue;
	data[entry.name] ||= {};
	data[entry.name][entry.measure] = metric;
	writeFileSync(file, JSON.stringify(data, null, 2));
}

function finalizeBenchmarks(directory) {
	const fragments = join(directory, "fragments");
	const merged = {};
	// A retry can publish the same benchmark from a newer worker. Prefer its
	// completed fragment, matching the previous last-measurement behavior.
	const files = existsSync(fragments)
		? readdirSync(fragments).filter((name) => name.endsWith(".json"))
		: [];
	files.sort(
		(a, b) =>
			statSync(join(fragments, a)).mtimeMs -
			statSync(join(fragments, b)).mtimeMs,
	);
	for (const file of files) {
		const data = JSON.parse(readFileSync(join(fragments, file), "utf8"));
		for (const [name, measures] of Object.entries(data))
			merged[name] = { ...merged[name], ...measures };
	}
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "benchmark.json"),
		JSON.stringify(merged, null, 2),
	);
	return merged;
}

// Explicit CommonJS exports work in both Playwright's TS transform and its
// native-ESM global teardown without creating competing module namespaces.
exports.writeBenchmark = writeBenchmark;
exports.finalizeBenchmarks = finalizeBenchmarks;
