import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	sweep: vi.fn(),
	runtime: vi.fn(),
	sesConfig: vi.fn(),
	ensureSubscribed: vi.fn(),
	sesDestroy: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/db", () => mocks);
vi.mock("~/server/outbox-deadline.server", () => ({
	runOutboxSweep: mocks.sweep,
}));
vi.mock("~/server/ses-settings.server", () => ({
	loadEmailRuntime: mocks.runtime,
}));
vi.mock("~/server/ses-client.server", () => ({
	SesClient: class {
		constructor(config: unknown) {
			mocks.sesConfig(config);
		}
		ensureSubscribedContact = mocks.ensureSubscribed;
		destroy = mocks.sesDestroy;
	},
}));

import { reconcileSignupOutbox } from "~/server/signup-delivery.server";

const now = "2026-10-28T08:00:00.000Z";

function intent(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		email: "reader@example.com",
		ses_attempts: 0,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(now);
	mocks.sweep.mockImplementation(async (_shutdown, operation) =>
		operation(new AbortController().signal),
	);
	mocks.runtime.mockReturnValue({ fromAddress: "sender@example.com" });
	mocks.query.mockResolvedValue([]);
	mocks.queryOne.mockResolvedValue({ consent_status: "confirmed" });
	mocks.execute.mockResolvedValue({ affectedRows: 1 });
	mocks.ensureSubscribed.mockResolvedValue("subscribed");
});

afterEach(() => {
	vi.useRealTimers();
});

describe("reconcileSignupOutbox", () => {
	it("retires legacy in-flight confirmation intents first", async () => {
		mocks.runtime.mockReturnValue(null);
		await reconcileSignupOutbox();
		const [sql, params] = mocks.execute.mock.calls[0];
		expect(sql).toContain("status = 'failed'");
		expect(sql).toContain("'pending'");
		expect(sql).toContain("'sending'");
		expect(sql).toContain("'sent'");
		expect(sql).toContain("'uncertain'");
		expect(params[0]).toContain("בוטל");
	});

	it("does nothing else when email delivery is not configured", async () => {
		mocks.runtime.mockReturnValue(null);
		await reconcileSignupOutbox();
		expect(mocks.sesConfig).not.toHaveBeenCalled();
		expect(mocks.query).not.toHaveBeenCalled();
	});

	it("synchronizes confirmed subscribers into the SES contact list", async () => {
		mocks.query.mockResolvedValue([intent()]);
		await reconcileSignupOutbox();
		const select = mocks.query.mock.calls[0]?.[0] as string;
		expect(select).toContain("status = 'confirmed'");
		expect(select).toContain("ses_status = 'pending'");
		expect(mocks.ensureSubscribed).toHaveBeenCalledWith(
			"reader@example.com",
			"real",
		);
		const syncUpdate = mocks.execute.mock.calls.find(([sql]) =>
			(sql as string).includes("ses_status = ?"),
		);
		expect(syncUpdate?.[1]).toEqual(["subscribed", 7]);
	});

	it("skips the SES sync when consent is no longer confirmed", async () => {
		mocks.query.mockResolvedValue([intent()]);
		mocks.queryOne.mockResolvedValue({ consent_status: "unsubscribed" });
		await reconcileSignupOutbox();
		expect(mocks.ensureSubscribed).not.toHaveBeenCalled();
		const settled = mocks.execute.mock.calls.find(([sql]) =>
			(sql as string).includes("ses_status = ?"),
		);
		expect(settled?.[1]).toEqual(["opted_out", 7]);
	});

	it("keeps local suppression without rewriting SES when an opt-out lands during sync", async () => {
		mocks.query.mockResolvedValue([intent()]);
		mocks.queryOne
			.mockResolvedValueOnce({ consent_status: "confirmed" })
			.mockResolvedValueOnce({ consent_status: "unsubscribed" });
		await reconcileSignupOutbox();
		expect(mocks.ensureSubscribed).toHaveBeenCalledWith(
			"reader@example.com",
			"real",
		);
		const settled = mocks.execute.mock.calls.find(([sql]) =>
			(sql as string).includes("ses_status = ?"),
		);
		expect(settled?.[1]).toEqual(["opted_out", 7]);
	});

	it("persists the SES opt-out outcome without a consent re-check", async () => {
		mocks.query.mockResolvedValue([intent()]);
		mocks.ensureSubscribed.mockResolvedValue("opted_out");
		await reconcileSignupOutbox();
		expect(mocks.queryOne).toHaveBeenCalledTimes(1);
		const settled = mocks.execute.mock.calls.find(([sql]) =>
			(sql as string).includes("ses_status = ?"),
		);
		expect(settled?.[1]).toEqual(["opted_out", 7]);
	});

	it("backs off SES sync retries and fails permanently at the cap", async () => {
		mocks.ensureSubscribed.mockRejectedValue(new Error("SES unavailable"));
		mocks.query.mockResolvedValue([intent({ ses_attempts: 4 })]);
		await reconcileSignupOutbox();
		const retry = mocks.execute.mock.calls.find(([sql]) =>
			(sql as string).includes("ses_next_attempt_at"),
		);
		expect(retry?.[0]).toContain("ses_attempts + 1 >=");
		expect(retry?.[1]).toEqual([7]);
	});

	it("releases the SES client after a successful sweep", async () => {
		await reconcileSignupOutbox();
		expect(mocks.sesConfig).toHaveBeenCalledOnce();
		expect(mocks.sesDestroy).toHaveBeenCalledOnce();
	});

	it("releases the SES client even when the sweep fails", async () => {
		mocks.query.mockRejectedValue(new Error("db down"));
		await expect(reconcileSignupOutbox()).rejects.toThrow("db down");
		expect(mocks.sesDestroy).toHaveBeenCalledOnce();
	});
});
