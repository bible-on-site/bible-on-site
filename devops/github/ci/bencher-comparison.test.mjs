import assert from "node:assert/strict";
import { test } from "node:test";
import { bencherComparisonArgs } from "./bencher-comparison.mjs";

const sha = "076668f6eb354813b2075a928ee1983db87167a4";
const comparison = ["--start-point", "master", "--start-point-hash", sha,
	"--start-point-clone-thresholds", "--start-point-reset"];

test("pull requests inherit the tested merge base even when the payload is stale", () => {
	assert.deepEqual(bencherComparisonArgs("pull_request", {
		pull_request: { base: { ref: "master", sha: "a".repeat(40) } },
	}, sha), comparison);
});

test("merge queues strip the ref prefix and inherit the tested queue base", () => {
	assert.deepEqual(bencherComparisonArgs("merge_group", {
		merge_group: { base_ref: "refs/heads/master", base_sha: sha },
	}), comparison);
});

test("master pushes and manual runs retain their accumulated history", () => {
	assert.deepEqual(bencherComparisonArgs("push", {}), []);
	assert.deepEqual(bencherComparisonArgs("workflow_dispatch", {}), []);
});

test("missing or malformed base metadata fails instead of dropping the comparison", () => {
	for (const base of [{},
		{ ref: "master\n--other-option", sha }, { ref: "refs/heads/", sha }]) {
		assert.throws(() => bencherComparisonArgs("pull_request", { pull_request: { base } }, sha));
	}
	assert.throws(() => bencherComparisonArgs("pull_request", { pull_request: { base: { ref: "master", sha } } }));
	assert.throws(() => bencherComparisonArgs("pull_request", { pull_request: { base: { ref: "master", sha } } }, "missing"));
	assert.throws(() => bencherComparisonArgs("merge_group", {}));
	assert.throws(() => bencherComparisonArgs("unknown", {}));
});
