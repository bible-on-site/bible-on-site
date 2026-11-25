import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDocument } from "yaml";

const document = parseDocument(
	readFileSync(
		new URL("../../../.github/workflows/store-listing.yml", import.meta.url),
		"utf8",
	),
);
assert.deepEqual(document.errors, []);
const workflow = document.toJS();

test("pushes the versioned listing only from master and on demand", () => {
	assert.deepEqual(workflow.on.push.branches, ["master"]);
	assert.equal(workflow.on.workflow_dispatch, null);
});

// The Google Play listing is last-writer-wins: overlapping runs let an older
// run finishing last revert newer copy, so every sync must queue on one
// shared group without cancelling the in-progress run.
test("serializes every sync on one shared group", () => {
	assert.equal(
		workflow.concurrency?.group,
		"${{ github.repository }}-store-listing",
		"a repo-wide group, never a per-run or per-ref one",
	);
	assert.equal(workflow.concurrency?.["cancel-in-progress"], false);
});
