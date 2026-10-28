import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ci = readFileSync(
	new URL("../../../.github/workflows/ci.yml", import.meta.url),
	"utf8",
).replace(/\r\n/g, "\n");

/**
 * Threshold flag groups of the `bencher run` invocation in the Website
 * Performance job. Bencher zips repeated `--threshold-*` options
 * positionally: the Nth occurrence of each option applies to the Nth
 * `--threshold-measure`, and `_` leaves a value unset. So the parser
 * collects each option's values in order and pairs them by index —
 * proximity in the command does NOT scope a flag to a measure.
 * Returns Map<measure, { [flag]: value }>.
 */
function thresholdGroups() {
	const step = ci
		.split("- name: Track Performance with Bencher")[1]
		?.split("      - name: ")[0];
	assert.ok(step, "the Bencher step must exist in ci.yml");
	const commandLines = step
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("#"))
		.join("\n");
	const values = new Map();
	for (const flag of commandLines.matchAll(/--(threshold-[a-z-]+)\s+(\S+)/g)) {
		const [, option, value] = flag;
		if (!values.has(option)) values.set(option, []);
		values.get(option).push(value);
	}
	const measures = values.get("threshold-measure") ?? [];
	const groups = new Map();
	for (const [index, measure] of measures.entries()) {
		assert.ok(!groups.has(measure), `duplicate threshold for ${measure}`);
		const group = {};
		for (const [option, occurrences] of values) {
			if (option === "threshold-measure" || index >= occurrences.length)
				continue;
			group[option] = occurrences[index];
		}
		groups.set(measure, group);
	}
	return groups;
}

test("every measure emitted by the perf suite has a threshold group", () => {
	const benchmarkSource = readFileSync(
		new URL(
			"../../../web/bible-on-site/tests/util/benchmark.ts",
			import.meta.url,
		),
		"utf8",
	);
	const union = benchmarkSource.split("export type BencherMeasure")[1]?.split(";")[0];
	assert.ok(union, "extract the BencherMeasure union");
	const emitted = [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
	assert.ok(emitted.length >= 5, "union members must be extracted");
	for (const measure of emitted)
		assert.ok(
			thresholdGroups().has(measure),
			`missing bencher threshold group for ${measure}`,
		);
});

test("cls_ratio uses a static Lighthouse-good bound and no sampling options", () => {
	// A percentage test derives the boundary limit from the historical mean:
	// limit = mean + mean * boundary. On a zero CLS baseline the upper limit
	// collapses to 0, so every nonzero (still-good) reading alerts — the
	// false `webvitals: CLS` alerts of #2718. A static test compares the new
	// metric to the literal boundary instead; 0.1 is the Lighthouse "good"
	// CLS bound.
	const cls = thresholdGroups().get("cls_ratio");
	assert.ok(cls, "cls_ratio threshold group must exist");
	assert.equal(cls["threshold-test"], "static");
	assert.equal(cls["threshold-upper-boundary"], "0.1");
	assert.equal(cls["threshold-lower-boundary"], "_");
	// Bencher rejects history-sampling values for the static test. Every
	// other group passes --threshold-max-sample-size, and the positional
	// zip would give cls_ratio a stray 64 unless it is explicitly unset.
	assert.equal(
		cls["threshold-max-sample-size"],
		"_",
		"static test requires an explicitly unset max sample size",
	);
	for (const option of ["threshold-min-sample-size", "threshold-window"])
		assert.equal(cls[option], undefined, `${option} is invalid for static`);
});

test("every threshold group uses the same option set", () => {
	// Bencher pairs the Nth occurrence of each --threshold-* option with the
	// Nth --threshold-measure. A group that omits an option the others use
	// silently absorbs the value meant for the next group (the cls_ratio
	// sample-size bug of #2718); a value must be `_` to unset it instead.
	const signatures = [...thresholdGroups().entries()].map(
		([measure, group]) => [measure, Object.keys(group).sort().join(",")],
	);
	const [first, expected] = signatures[0];
	for (const [measure, signature] of signatures)
		assert.equal(
			signature,
			expected,
			`${measure} uses different threshold options than ${first}`,
		);
});

test("the shared ratio measure stays percentage for the sefer-flip baseline", () => {
	const ratio = thresholdGroups().get("ratio");
	assert.ok(ratio, "ratio threshold group must exist");
	assert.equal(ratio["threshold-test"], "percentage");
	assert.equal(ratio["threshold-upper-boundary"], "20.00");
});

test("only the sefer-flip benchmark still emits the shared ratio measure", () => {
	// `ratio` keeps a percentage model, so any other zero-baseline-prone
	// metric emitted under it would reproduce the CLS alert bug. Every other
	// ratio-class metric must use its own measure (e.g. `cls_ratio`).
	const perfDir = new URL(
		"../../../web/bible-on-site/tests/perf/",
		import.meta.url,
	);
	const offenders = [];
	for (const file of readdirSync(perfDir)) {
		if (!file.endsWith(".ts") || file === "sefer-flip-lag.test.ts") continue;
		const source = readFileSync(new URL(file, perfDir), "utf8");
		if (source.includes('"ratio"')) offenders.push(file);
	}
	assert.deepEqual(offenders, []);
});

test("each threshold group sets a lower or upper boundary", () => {
	for (const [measure, group] of thresholdGroups())
		assert.ok(
			[group["threshold-lower-boundary"], group["threshold-upper-boundary"]].some(
				(value) => value !== undefined && value !== "_",
			),
			`${measure} needs a lower or upper boundary`,
		);
});
