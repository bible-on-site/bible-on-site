import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
	txExecute: vi.fn(),
	txQueryOne: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/db", () => m);

import {
	getBulletinRolloutSummary,
	isMissingRolloutSchema,
	readRolloutDeliveryState,
	readRolloutRow,
	rolloutDeliveryStateForUpdate,
	setRolloutState,
} from "~/server/rollout-state.server";

const connection = {};
const missing = () =>
	Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
const rolloutRow = (state = "running", revision = 4) => ({
	state,
	cohort: "original",
	revision,
	last_error: null,
});

beforeEach(() => {
	vi.resetAllMocks();
	m.transaction.mockImplementation(async (fn) => fn(connection));
	m.txExecute.mockResolvedValue({ affectedRows: 1 });
});

describe("isMissingRolloutSchema", () => {
	it.each(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"])(
		"recognizes the absent-migration code %s",
		(code) => {
			expect(isMissingRolloutSchema({ code })).toBe(true);
		},
	);
	it("does not swallow unrelated failures", () => {
		expect(isMissingRolloutSchema(new Error("denied"))).toBe(false);
		expect(isMissingRolloutSchema({ code: "ER_DUP_ENTRY" })).toBe(false);
	});
});

describe("readRolloutRow", () => {
	it("returns null when no row is persisted or the schema is absent", async () => {
		m.queryOne.mockResolvedValue(null);
		expect(await readRolloutRow()).toBeNull();
		m.queryOne.mockRejectedValue(missing());
		expect(await readRolloutRow()).toBeNull();
	});
	it("rethrows failures unrelated to a missing migration", async () => {
		m.queryOne.mockRejectedValue(new Error("denied"));
		await expect(readRolloutRow()).rejects.toThrow("denied");
	});
	it("returns null for a malformed singleton row", async () => {
		m.queryOne.mockResolvedValue({
			state: "bogus",
			cohort: "original",
			revision: 1,
			last_error: null,
		});
		expect(await readRolloutRow()).toBeNull();
		m.queryOne.mockResolvedValue({
			state: "running",
			cohort: 7,
			revision: 1,
			last_error: null,
		});
		expect(await readRolloutRow()).toBeNull();
	});
});

describe("readRolloutDeliveryState", () => {
	it("returns the persisted state, or null while the schema is absent", async () => {
		m.queryOne.mockResolvedValue({ state: "paused" });
		expect(await readRolloutDeliveryState()).toBe("paused");
		m.queryOne.mockRejectedValue(missing());
		expect(await readRolloutDeliveryState()).toBeNull();
		m.queryOne.mockRejectedValue(new Error("gone"));
		await expect(readRolloutDeliveryState()).rejects.toThrow("gone");
	});
	it("locks the row inside a caller transaction", async () => {
		m.txQueryOne.mockResolvedValue({ state: "running" });
		expect(await rolloutDeliveryStateForUpdate(connection as never)).toBe(
			"running",
		);
		expect(m.txQueryOne.mock.calls[0][1]).toContain("FOR UPDATE");
	});
	it("degrades to no license while the schema is absent and rethrows other failures", async () => {
		m.txQueryOne.mockRejectedValue(missing());
		expect(
			await rolloutDeliveryStateForUpdate(connection as never),
		).toBeNull();
		m.txQueryOne.mockRejectedValue(new Error("denied"));
		await expect(
			rolloutDeliveryStateForUpdate(connection as never),
		).rejects.toThrow("denied");
	});
});

describe("getBulletinRolloutSummary", () => {
	it("aggregates cohort members by cohort status and consent", async () => {
		m.queryOne.mockResolvedValueOnce(rolloutRow()).mockResolvedValueOnce({
			local_date: "2026-11-02",
			status: "admitted",
			subscriber_id: 9,
			last_error: null,
		});
		m.query.mockResolvedValue([
			{ status: "admitted", consent_status: "confirmed", n: 3 },
			{ status: "admitted", consent_status: "unsubscribed", n: 1 },
			{ status: "pending", consent_status: "pending", n: 40 },
			{ status: "pending", consent_status: "confirmed", n: 2 },
			{ status: "excluded", consent_status: "bounced", n: 6 },
		]);
		const summary = await getBulletinRolloutSummary(
			new Date("2026-11-02T06:00:00Z"),
		);
		expect(summary).toMatchObject({
			state: "running",
			cohort: "original",
			revision: 4,
			admitted: 4,
			remaining: 40,
			excluded: 8,
			admission: {
				localDate: "2026-11-02",
				status: "admitted",
				subscriberId: 9,
			},
		});
	});
	it("returns null while the rollout schema is absent", async () => {
		m.queryOne.mockRejectedValue(missing());
		expect(await getBulletinRolloutSummary()).toBeNull();
	});
	it("reports an empty reservation and accepts a driver-typed Date", async () => {
		m.queryOne.mockResolvedValueOnce(rolloutRow()).mockResolvedValueOnce({
			local_date: new Date("2026-11-02T00:00:00Z"),
			status: "reserved",
			subscriber_id: null,
			last_error: "provider timeout",
		});
		m.query.mockResolvedValue([]);
		const summary = await getBulletinRolloutSummary(
			new Date("2026-11-02T06:00:00Z"),
		);
		expect(summary?.admission).toEqual({
			localDate: "2026-11-02",
			status: "reserved",
			subscriberId: null,
			lastError: "provider timeout",
		});
	});
	it("omits the admission when none or an undated one is recorded", async () => {
		m.queryOne.mockResolvedValueOnce(rolloutRow()).mockResolvedValueOnce(
			null,
		);
		m.query.mockResolvedValue([]);
		let summary = await getBulletinRolloutSummary(
			new Date("2026-11-02T06:00:00Z"),
		);
		expect(summary?.admission).toBeNull();
		m.queryOne.mockResolvedValueOnce(rolloutRow()).mockResolvedValueOnce({
			local_date: null,
			status: "reserved",
			subscriber_id: null,
			last_error: null,
		});
		summary = await getBulletinRolloutSummary(
			new Date("2026-11-02T06:00:00Z"),
		);
		expect(summary?.admission).toBeNull();
	});
	it("degrades to null on a mid-read missing schema and rethrows other failures", async () => {
		m.queryOne
			.mockResolvedValueOnce(rolloutRow())
			.mockRejectedValueOnce(missing());
		m.query.mockResolvedValue([]);
		expect(
			await getBulletinRolloutSummary(new Date("2026-11-02T06:00:00Z")),
		).toBeNull();
		m.queryOne
			.mockResolvedValueOnce(rolloutRow())
			.mockRejectedValueOnce(new Error("denied"));
		await expect(
			getBulletinRolloutSummary(new Date("2026-11-02T06:00:00Z")),
		).rejects.toThrow("denied");
	});
});

describe("setRolloutState", () => {
	it("performs a revision-checked transition inside one transaction", async () => {
		m.txQueryOne.mockResolvedValue({ state: "running", revision: 4 });
		expect(await setRolloutState({ action: "pause", revision: 4 })).toEqual({
			state: "paused",
			revision: 5,
		});
		expect(m.txExecute.mock.calls[0][1]).toContain("state = ?");
		expect(m.txExecute.mock.calls[0][2][0]).toBe("paused");
	});
	it("rejects a stale revision and an invalid transition", async () => {
		m.txQueryOne.mockResolvedValue({ state: "running", revision: 9 });
		await expect(
			setRolloutState({ action: "pause", revision: 4 }),
		).rejects.toThrow("מצב ההפעלה השתנה. רעננו את המסך.");
		m.txQueryOne.mockResolvedValue({ state: "completed", revision: 4 });
		await expect(
			setRolloutState({ action: "resume", revision: 4 }),
		).rejects.toThrow("פעולת ההפעלה אינה תקינה למצב הנוכחי");
		expect(m.txExecute).not.toHaveBeenCalled();
	});
	it("reports a missing schema as not-yet-configured", async () => {
		m.txQueryOne.mockRejectedValue(missing());
		await expect(
			setRolloutState({ action: "enable", revision: 0 }),
		).rejects.toThrow("ההפעלה ההדרגתית טרם הוגדרה");
	});
	it("disables from a completed rollout and keeps history", async () => {
		m.txQueryOne.mockResolvedValue({ state: "completed", revision: 4 });
		expect(await setRolloutState({ action: "disable", revision: 4 })).toEqual({
			state: "disabled",
			revision: 5,
		});
	});
	it("rethrows unrelated lock-read failures", async () => {
		m.txQueryOne.mockRejectedValue(new Error("denied"));
		await expect(
			setRolloutState({ action: "pause", revision: 4 }),
		).rejects.toThrow("denied");
	});
	it("leaves the revision untouched when the action keeps the state", async () => {
		m.txQueryOne.mockResolvedValue({ state: "disabled", revision: 4 });
		expect(await setRolloutState({ action: "disable", revision: 4 })).toEqual(
			{ state: "disabled", revision: 4 },
		);
		expect(m.txExecute).not.toHaveBeenCalled();
	});
});
