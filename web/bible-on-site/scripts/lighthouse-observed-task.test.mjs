import assert from "node:assert/strict";
import test from "node:test";
import { largestTopLevelTask } from "./lighthouse-observed-task.mjs";

// Minimal TaskNode shape; only the fields the selector reads matter.
const task = (overrides = {}) => ({
	event: { name: "RunTask" },
	children: [],
	parent: undefined,
	unbounded: false,
	startTime: 0,
	endTime: 0,
	duration: 0,
	selfTime: 0,
	attributableURLs: [],
	group: { id: "other" },
	...overrides,
});

test("largestTopLevelTask returns the biggest observed top-level task", () => {
	const small = task({ duration: 8, startTime: 8.7 });
	const mid = task({ duration: 28.4, startTime: 110.5 });
	const largest = task({ duration: 36.119, startTime: 20.46 });
	assert.equal(largestTopLevelTask([small, mid, largest]), largest);
});

test("largestTopLevelTask ignores child tasks and tasks at the audit floor", () => {
	const parent = task({ duration: 20, startTime: 10 });
	const child = task({ duration: 90, startTime: 11, parent });
	const floor = task({ duration: 5, startTime: 200 });
	const eligible = task({ duration: 12, startTime: 50 });
	assert.equal(largestTopLevelTask([child, floor, eligible]), eligible);
});

test("largestTopLevelTask returns null without a sizable top-level task", () => {
	assert.equal(largestTopLevelTask([]), null);
	assert.equal(
		largestTopLevelTask([task({ duration: 5 }), task({ duration: 3 })]),
		null,
	);
	assert.equal(
		largestTopLevelTask([task({ duration: 40, parent: task({}) })]),
		null,
	);
});
