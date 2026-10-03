import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { againstRefForEvent } from "./is-version-newer-than-baseline.ts";

describe("againstRefForEvent", () => {
	it("compares pull requests with origin/master", () => {
		assert.equal(againstRefForEvent("pull_request", {}), "origin/master");
	});

	it("compares merge-queue groups with their base, which includes PRs queued ahead", () => {
		// #1908 was queued behind #1909: both set the website to 0.2.436 while
		// origin/master was still 0.2.435, so only the group base exposes the reuse.
		const event = { merge_group: { base_sha: "49e1c47528cac7283672a86f659aeb861a05eda7" } };
		assert.equal(
			againstRefForEvent("merge_group", event),
			"49e1c47528cac7283672a86f659aeb861a05eda7",
		);
	});

	it("rejects merge-queue events without a base", () => {
		assert.throws(() => againstRefForEvent("merge_group", {}), /base_sha/);
	});

	it("only checks released tags on other events", () => {
		assert.equal(againstRefForEvent("push", {}), undefined);
		assert.equal(againstRefForEvent(undefined, {}), undefined);
	});
});
