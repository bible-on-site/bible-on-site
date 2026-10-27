import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ci = readFileSync(
	new URL("../../../.github/workflows/ci.yml", import.meta.url),
	"utf8",
).replace(/\r\n/g, "\n");

/**
 * Threshold flag groups of the `bencher run` invocation in the Website
 * Performance job. Each `--threshold-measure <name>` starts a group that
 * collects every following `--threshold-*` flag until the next measure.
 * Returns Map<measure, { [flag]: value }>.
 */
function thresholdGroups() {
	const step = ci
		.split("- name: Track Performance with Bencher")[1]
		?.split("      - name: ")[0];
	assert.ok(step, "the Bencher step must exist in ci.yml");
	const groups = new Map();
	let current;
	for (const flag of step.matchAll(/--(threshold-[a-z-]+)\s+(\S+)/g)) {
		const [, option, value] = flag;
		if (option === "threshold-measure") {
			current = {};
			assert.ok(!groups.has(value), `duplicate threshold for ${value}`);
			groups.set(value, current);
		} else if (current) {
			current[option] = value;
		}
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
	// Bencher rejects history-sampling options for the static test.
	for (const option of [
		"threshold-min-sample-size",
		"threshold-max-sample-size",
		"threshold-window",
	])
		assert.equal(cls[option], undefined, `${option} is invalid for static`);
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
