import assert from "node:assert/strict";
import test from "node:test";
import { warmUpAuditTarget } from "./lighthouse-warmup.mjs";

// Recording stub: only the call order and arguments matter.
function recordingPage() {
	const calls = [];
	return {
		calls,
		goto: async (url, options) => {
			calls.push(["goto", url, options]);
		},
		close: async () => {
			calls.push(["close"]);
		},
	};
}

test("warmUpAuditTarget unloads the warmed document before closing", async () => {
	const page = recordingPage();
	await warmUpAuditTarget(page, "http://127.0.0.1:3001/929/686");
	assert.deepEqual(page.calls, [
		["goto", "http://127.0.0.1:3001/929/686", { waitUntil: "networkidle" }],
		["goto", "about:blank", undefined],
		["close"],
	]);
});

test("warmUpAuditTarget never closes with the warmed document still loaded", async () => {
	const page = recordingPage();
	await warmUpAuditTarget(page, "http://127.0.0.1:3001/");
	const closeIndex = page.calls.findIndex(([name]) => name === "close");
	const blankIndex = page.calls.findIndex(
		([name, url]) => name === "goto" && url === "about:blank",
	);
	// Reversing these would defer document teardown into the audited
	// navigation's trace window — the modeled-TBT contamination of #3163.
	assert.ok(blankIndex !== -1 && blankIndex < closeIndex);
});
