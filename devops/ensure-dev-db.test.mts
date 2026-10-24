import assert from "node:assert/strict";
import test from "node:test";
import { isStampFresh } from "./ensure-dev-db.mts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-24T12:00:00Z");

test("isStampFresh", async (t) => {
	await t.test("returns true for a stamp within the window", () => {
		assert.equal(
			isStampFresh("2026-10-24T10:00:00Z", 24 * HOUR, NOW),
			true,
		);
	});

	await t.test("returns false for a stamp older than the window", () => {
		assert.equal(
			isStampFresh("2026-10-23T11:00:00Z", 24 * HOUR, NOW),
			false,
		);
	});

	await t.test("returns false for a zero window so sync is forced", () => {
		assert.equal(isStampFresh(new Date(NOW).toISOString(), 0, NOW), false);
	});

	await t.test("returns false for a corrupt stamp", () => {
		assert.equal(isStampFresh("not-a-date", 24 * HOUR, NOW), false);
	});

	await t.test("returns false for a stamp in the future", () => {
		assert.equal(
			isStampFresh("2026-10-24T13:00:00Z", 24 * HOUR, NOW),
			false,
		);
	});
});
