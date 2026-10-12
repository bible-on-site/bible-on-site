import assert from "node:assert/strict";
import { test } from "node:test";
import { codecovReportState } from "./codecov-report-state.mjs";

// Shape and totals from PR #2023's completed, six-session coverage response.
const complete = {
	state: "complete", ci_passed: null,
	report: {
		files: [{ name: "web/bible-on-site/src/example.ts" }],
		totals: { files: 282, lines: 20265, sessions: 6 },
	},
};

test("completed uploads are present while upstream CI is unresolved", () => {
	assert.equal(codecovReportState(complete), "reported");
	assert.equal(codecovReportState({ ...complete, ci_passed: true }), "passed");
});

test("an explicit CI failure wins even when every upload is present", () => {
	assert.equal(codecovReportState({ ...complete, ci_passed: false }), "failed");
});

test("completed processing without a report remains a lost-upload failure", () => {
	for (const report of [null, {}, { files: [], totals: complete.report.totals },
		{ files: complete.report.files },
		{ files: complete.report.files, totals: { files: 0, lines: 0, sessions: 0 } }]) {
		for (const ci_passed of [null, true]) {
			assert.equal(codecovReportState({ ...complete, report, ci_passed }), "missing");
		}
	}
});

test("a CI result alone does not prove that coverage processing finished", () => {
	for (const state of ["pending", "processing", null]) {
		assert.equal(codecovReportState({ ...complete, state, ci_passed: true }), "pending");
	}
});
