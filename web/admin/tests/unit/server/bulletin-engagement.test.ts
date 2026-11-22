import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
	txQuery: vi.fn(),
	txQueryOne: vi.fn(),
	txExecute: vi.fn(),
	runtime: vi.fn(),
	unsubscribeContact: vi.fn(),
	sesConfig: vi.fn(),
	sesDestroy: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/db", () => mocks);
vi.mock("~/server/ses-client.server", () => ({
	SesClient: class {
		constructor(config: unknown) {
			mocks.sesConfig(config);
		}
		unsubscribeContact = mocks.unsubscribeContact;
		destroy = mocks.sesDestroy;
	},
}));
vi.mock("~/server/ses-settings.server", () => ({
	loadEmailRuntime: mocks.runtime,
}));
vi.mock("~/server/ses-delivery.server", () => ({
	isMissingEngagementSchema: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(
			(error as { code?: string }).code ?? "",
		),
}));

import {
	confirmInactivityUnsubscribe,
	readEmailEngagementPanel,
} from "~/server/bulletin-engagement.server";

const runtime = {
	region: "il-central-1",
	fromAddress: "bulletin@example.com",
	contactListName: "bulletin",
	configurationSetName: "events",
	queueUrl: "https://sqs.il-central-1.amazonaws.com/123456789012/bulletin",
	accountId: "123456789012",
	trackingEnabled: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.runtime.mockReturnValue(runtime);
	mocks.transaction.mockImplementation(async (callback) => callback({}));
	mocks.unsubscribeContact.mockResolvedValue(undefined);
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe("engagement panel", () => {
	it("maps tracked edition stats and the inactivity review list", async () => {
		mocks.query
			.mockResolvedValueOnce([
				{
					job_id: "job-1",
					date: "2026-10-28",
					tracked: 1,
					delivered: "50",
					opened: "20",
					clicked: "5",
				},
				{
					job_id: "job-0",
					date: "2026-10-27",
					tracked: 0,
					delivered: "48",
					opened: "0",
					clicked: "0",
				},
			])
			.mockResolvedValueOnce([
				{
					id: 7,
					email: "silent@example.com",
					first_tracked_delivery: "2025-10-28",
					tracked_last_year: "40",
				},
			]);
		expect(await readEmailEngagementPanel()).toEqual({
			editions: [
				{
					jobId: "job-1",
					date: "2026-10-28",
					tracked: true,
					delivered: 50,
					opened: 20,
					clicked: 5,
				},
				{
					jobId: "job-0",
					date: "2026-10-27",
					tracked: false,
					delivered: 48,
					opened: 0,
					clicked: 0,
				},
			],
			inactive: [
				{
					id: 7,
					email: "silent@example.com",
					firstTrackedDelivery: "2025-10-28",
					trackedLastYear: 40,
				},
			],
		});
	});
	it("degrades to null rather than zero while the schema is not deployed", async () => {
		mocks.query.mockRejectedValue(
			Object.assign(new Error("unknown column"), {
				code: "ER_BAD_FIELD_ERROR",
			}),
		);
		expect(await readEmailEngagementPanel()).toBeNull();
	});
	it("propagates real failures rather than masking them as undeployed", async () => {
		mocks.query.mockRejectedValue(new Error("connection lost"));
		await expect(readEmailEngagementPanel()).rejects.toThrow("connection lost");
	});
});

describe("inactivity unsubscribe confirmation", () => {
	function eligibleSubscriber(overrides: Record<string, unknown> = {}) {
		mocks.txQueryOne
			.mockResolvedValueOnce({
				id: 7,
				email: "silent@example.com",
				consent_status: "confirmed",
				admin_action: null,
				...overrides,
			})
			.mockResolvedValueOnce({ id: 7, email: "silent@example.com" });
		mocks.txExecute.mockResolvedValue({ affectedRows: 1 });
	}
	it("rechecks eligibility, records the admin and mirrors the SES opt-out", async () => {
		eligibleSubscriber();
		await confirmInactivityUnsubscribe(7, "admin-1234");
		const update = mocks.txExecute.mock.calls.find((call) =>
			String(call[1]).includes("inactivity-unsubscribe"),
		);
		expect(update?.[2]).toEqual(["admin-1234", 7]);
		expect(mocks.unsubscribeContact).toHaveBeenCalledExactlyOnceWith(
			"silent@example.com",
			"real",
		);
		expect(mocks.sesDestroy).toHaveBeenCalledOnce();
	});
	it("rejects a subscriber whose eligibility vanished after listing", async () => {
		mocks.txQueryOne
			.mockResolvedValueOnce({
				id: 7,
				email: "silent@example.com",
				consent_status: "confirmed",
				admin_action: null,
			})
			.mockResolvedValueOnce(null);
		await expect(confirmInactivityUnsubscribe(7, "admin-1234")).rejects.toThrow(
			"אינו עומד בתנאי ההסרה",
		);
		expect(mocks.txExecute).not.toHaveBeenCalled();
		expect(mocks.unsubscribeContact).not.toHaveBeenCalled();
	});
	it.each([
		{ consent_status: "unsubscribed", admin_action: null },
		{ consent_status: "pending", admin_action: null },
		{ consent_status: "bounced", admin_action: null },
	])("refuses non-active consent %j without touching SES", async (row) => {
		mocks.txQueryOne.mockResolvedValueOnce({
			id: 7,
			email: "silent@example.com",
			...row,
		});
		await expect(confirmInactivityUnsubscribe(7, "admin-1234")).rejects.toThrow(
			"אינו פעיל",
		);
		expect(mocks.unsubscribeContact).not.toHaveBeenCalled();
	});
	it("retries the SES mirror when a previous confirm already opted out", async () => {
		mocks.txQueryOne.mockResolvedValueOnce({
			id: 7,
			email: "silent@example.com",
			consent_status: "unsubscribed",
			admin_action: "inactivity-unsubscribe",
		});
		await confirmInactivityUnsubscribe(7, "admin-1234");
		expect(mocks.txExecute).not.toHaveBeenCalled();
		expect(mocks.unsubscribeContact).toHaveBeenCalledExactlyOnceWith(
			"silent@example.com",
			"real",
		);
	});
	it("keeps the local opt-out when the SES mirror fails", async () => {
		eligibleSubscriber();
		mocks.unsubscribeContact.mockRejectedValue(new Error("SES timeout"));
		await expect(confirmInactivityUnsubscribe(7, "admin-1234")).rejects.toThrow(
			"SES timeout",
		);
		expect(mocks.sesDestroy).toHaveBeenCalledOnce();
	});
	it("refuses to run without a configured mail runtime", async () => {
		mocks.runtime.mockReturnValue(null);
		await expect(confirmInactivityUnsubscribe(7, "admin-1234")).rejects.toThrow(
			"טרם הוגדר",
		);
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
});
