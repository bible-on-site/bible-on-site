import { describe, expect, it } from "vitest";
import {
	admissionLocalDate,
	rolloutAdmits,
	rolloutDelivers,
	rolloutTransition,
	validateRolloutChange,
} from "~/lib/bulletin-rollout";

describe("admissionLocalDate", () => {
	it.each([
		// Jerusalem is UTC+2 in winter and UTC+3 in summer; the boundary is local midnight.
		["2026-01-15T21:59:59.999Z", "2026-01-15"],
		["2026-01-15T22:00:00.000Z", "2026-01-16"],
		["2026-07-15T20:59:59.999Z", "2026-07-15"],
		["2026-07-15T21:00:00.000Z", "2026-07-16"],
		// Spring forward (2026-03-27 02:00 IST → 03:00 IDT) keeps one calendar day.
		["2026-03-26T22:30:00.000Z", "2026-03-27"],
		["2026-03-27T00:30:00.000Z", "2026-03-27"],
		["2026-03-27T21:30:00.000Z", "2026-03-28"],
		// Fall back (2026-10-25 02:00 IDT → 01:00 IST) keeps one calendar day.
		["2026-10-24T23:30:00.000Z", "2026-10-25"],
		["2026-10-25T21:59:59.999Z", "2026-10-25"],
		["2026-10-25T22:00:00.000Z", "2026-10-26"],
	])("maps %s to Jerusalem date %s", (instant, expected) => {
		expect(admissionLocalDate(new Date(instant))).toBe(expected);
	});
});

describe("rollout state machine", () => {
	it.each([
		["disabled", false, false],
		["running", true, true],
		["paused", false, true],
		["completed", false, true],
		[null, false, false],
		[undefined, false, false],
	] as const)("state %s admits=%s delivers=%s", (state, admits, delivers) => {
		expect(rolloutAdmits(state)).toBe(admits);
		expect(rolloutDelivers(state)).toBe(delivers);
	});
	it.each([
		["disabled", "enable", "running"],
		["running", "pause", "paused"],
		["paused", "resume", "running"],
		["running", "disable", "disabled"],
		["paused", "disable", "disabled"],
		["completed", "disable", "disabled"],
		["disabled", "disable", "disabled"],
	] as const)("allows %s + %s → %s", (state, action, expected) => {
		expect(rolloutTransition(state, action)).toBe(expected);
	});
	it.each([
		["disabled", "pause"],
		["disabled", "resume"],
		["running", "enable"],
		["running", "resume"],
		["paused", "enable"],
		["paused", "pause"],
		["completed", "enable"],
		["completed", "pause"],
		["completed", "resume"],
	] as const)("rejects %s + %s", (state, action) => {
		expect(rolloutTransition(state, action)).toBeNull();
	});
});

describe("validateRolloutChange", () => {
	it("accepts a revision-checked control", () => {
		expect(validateRolloutChange({ action: "pause", revision: 7 })).toEqual({
			action: "pause",
			revision: 7,
		});
	});
	it.each([
		null,
		"pause",
		{ revision: 0 },
		{ action: "pause" },
		{ action: "delete", revision: 0 },
		{ action: "pause", revision: -1 },
		{ action: "pause", revision: 1.5 },
		{ action: "pause", revision: "1" },
	])("rejects %j", (value) => {
		expect(() => validateRolloutChange(value)).toThrow(
			"מצב ההפעלה ההדרגתית אינו תקין",
		);
	});
});
