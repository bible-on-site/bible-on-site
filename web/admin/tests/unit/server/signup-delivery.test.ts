import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
	txQuery: vi.fn(),
	txQueryOne: vi.fn(),
	txExecute: vi.fn(),
	sweep: vi.fn(),
	runtime: vi.fn(),
	sesConfig: vi.fn(),
	sendTransactional: vi.fn(),
	resubscribe: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/db", () => mocks);
vi.mock("~/server/outbox-deadline.server", () => ({
	runOutboxSweep: mocks.sweep,
}));
vi.mock("~/server/ses-settings.server", () => ({
	loadEmailRuntime: mocks.runtime,
}));
vi.mock("~/server/ses-client.server", () => {
	class SesError extends Error {
		constructor(
			message: string,
			public outcome: "failed" | "uncertain",
		) {
			super(message);
		}
	}
	return {
		SesError,
		SesClient: class {
			constructor(config: unknown) {
				mocks.sesConfig(config);
			}
			sendTransactional = mocks.sendTransactional;
			resubscribeContact = mocks.resubscribe;
		},
	};
});

import { SesError } from "~/server/ses-client.server";
import {
	applySignupSesEvent,
	reconcileSignupOutbox,
	signupConfirmUrl,
} from "~/server/signup-delivery.server";

const connection = {};
const now = "2026-10-28T08:00:00.000Z";
const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

function intent(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		email: "reader@example.com",
		send_token: null,
		status: "pending",
		ses_status: "pending",
		ses_attempts: 0,
		subscriber_id: null,
		...overrides,
	};
}

function event(overrides: Record<string, unknown> = {}) {
	return {
		messageId: "ses-message-1",
		attemptId: "7_send-token-1",
		signupIntentId: 7,
		email: "reader@example.com",
		type: "bounce" as const,
		timestamp: "2026-10-28T08:02:03.456Z",
		permanent: true,
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
	mocks.queryOne.mockResolvedValue(null);
	mocks.execute.mockResolvedValue({ affectedRows: 1 });
	mocks.txExecute.mockResolvedValue({ affectedRows: 1 });
	mocks.transaction.mockImplementation(async (fn) => fn(connection));
	mocks.sendTransactional.mockResolvedValue("ses-message-1");
	mocks.resubscribe.mockResolvedValue("subscribed");
});

afterEach(() => {
	vi.useRealTimers();
});

describe("signupConfirmUrl", () => {
	it("builds the website confirmation URL with an encoded token", () => {
		expect(signupConfirmUrl("a+b/c=")).toBe(
			"http://localhost:3001/join/email/confirm?t=a%2Bb%2Fc%3D",
		);
	});
});

describe("reconcileSignupOutbox", () => {
	it("marks stale in-flight sends uncertain before anything else", async () => {
		mocks.runtime.mockReturnValue(null);
		await reconcileSignupOutbox();
		const [sql, params] = mocks.execute.mock.calls[0];
		expect(sql).toContain("status = 'uncertain'");
		expect(sql).toContain("status = 'sending'");
		expect(sql).toContain("send_started_at");
		expect(params[0]).toContain("אינה ודאית");
	});

	it("does nothing else when email delivery is not configured", async () => {
		mocks.runtime.mockReturnValue(null);
		await reconcileSignupOutbox();
		expect(mocks.sesConfig).not.toHaveBeenCalled();
		expect(mocks.query).not.toHaveBeenCalled();
	});

	it("synchronizes confirmed subscribers into SES before new sends", async () => {
		mocks.query.mockImplementation(async (sql: string) =>
			sql.includes("status = 'confirmed'")
				? [intent({ status: "confirmed" })]
				: [],
		);
		await reconcileSignupOutbox();
		expect(mocks.resubscribe).toHaveBeenCalledWith(
			"reader@example.com",
			"real",
		);
		const syncUpdate = mocks.execute.mock.calls.find(([sql]: [string]) =>
			sql.includes("ses_status = ?"),
		);
		expect(syncUpdate?.[1]).toEqual(["subscribed", 7]);
		expect(mocks.sendTransactional).not.toHaveBeenCalled();
	});

	it("backs off SES sync retries and fails permanently at the cap", async () => {
		mocks.resubscribe.mockRejectedValue(new Error("SES unavailable"));
		mocks.query.mockImplementation(async (sql: string) =>
			sql.includes("status = 'confirmed'")
				? [intent({ status: "confirmed", ses_attempts: 4 })]
				: [],
		);
		await reconcileSignupOutbox();
		const retry = mocks.execute.mock.calls.find(([sql]: [string]) =>
			sql.includes("ses_next_attempt_at"),
		);
		expect(retry?.[0]).toContain("ses_attempts + 1 >=");
		expect(retry?.[1]).toEqual([7]);
	});

	it("claims a pending intent, stores only the challenge hash and sends", async () => {
		mocks.query.mockImplementation(async (sql: string) =>
			sql.includes("status = 'pending'") ? [{ id: 7 }] : [],
		);
		mocks.queryOne.mockResolvedValue(
			intent({ send_token: "claimed-by-me", status: "sending" }),
		);
		// The send_token minted at claim time is a random uuid the test cannot
		// know; answer the re-read with whatever token the claim wrote.
		mocks.execute.mockImplementation(async (sql: string, params: unknown[]) => {
			if (sql.includes("status = 'sending'") && sql.includes("send_token = ?")) {
				mocks.queryOne.mockResolvedValue(
					intent({ send_token: params[0], status: "sending" }),
				);
			}
			return { affectedRows: 1 };
		});
		await reconcileSignupOutbox();
		const claim = mocks.execute.mock.calls.find(([sql]: [string]) =>
			sql.includes("send_token = ?"),
		);
		expect(claim?.[0]).toContain("challenge_hash = ?");
		expect(mocks.sendTransactional).toHaveBeenCalledOnce();
		const input = mocks.sendTransactional.mock.calls[0][0];
		expect(input.to).toBe("reader@example.com");
		expect(input.externalId).toMatch(/^7_[0-9a-f-]{36}$/);
		const token = /confirm\?t=([A-Za-z0-9_-]+)/.exec(input.html)?.[1];
		expect(token).toBeTruthy();
		// Only the sha256 of the mailed token may persist.
		expect(claim?.[1][1]).toBe(sha256(token ?? ""));
		expect(input.html).not.toContain(claim?.[1][1]);
		const sent = mocks.execute.mock.calls.find(([sql]: [string]) =>
			sql.includes("status = 'sent'"),
		);
		expect(sent?.[1]).toEqual(["ses-message-1", 7, claim?.[1][0]]);
	});

	it("does not send when another worker claimed the intent first", async () => {
		mocks.query.mockImplementation(async (sql: string) =>
			sql.includes("status = 'pending'") ? [{ id: 7 }] : [],
		);
		mocks.execute.mockImplementation(async (sql: string) =>
			sql.includes("status = 'sending'")
				? { affectedRows: 0 }
				: { affectedRows: 1 },
		);
		await reconcileSignupOutbox();
		expect(mocks.sendTransactional).not.toHaveBeenCalled();
	});

	it("records a truthful failed state when SES rejects before accepting", async () => {
		mocks.sendTransactional.mockRejectedValue(
			new SesError("rejected", "failed"),
		);
		mocks.query.mockImplementation(async (sql: string) =>
			sql.includes("status = 'pending'") ? [{ id: 7 }] : [],
		);
		mocks.execute.mockImplementation(async (sql: string, params: unknown[]) => {
			if (sql.includes("status = 'sending'") && sql.includes("send_token = ?")) {
				mocks.queryOne.mockResolvedValue(
					intent({ send_token: params[0], status: "sending" }),
				);
			}
			return { affectedRows: 1 };
		});
		await reconcileSignupOutbox();
		const failure = mocks.execute.mock.calls.find(
			([sql, params]: [string, unknown[]]) =>
				sql.includes("status = ?") && params[0] === "failed",
		);
		expect(failure?.[1][0]).toBe("failed");
		expect(failure?.[1][1]).toContain("נכשלה");
	});

	it("records an uncertain state when SES acceptance is unknown", async () => {
		mocks.sendTransactional.mockRejectedValue(
			new SesError("timeout", "uncertain"),
		);
		mocks.query.mockImplementation(async (sql: string) =>
			sql.includes("status = 'pending'") ? [{ id: 7 }] : [],
		);
		mocks.execute.mockImplementation(async (sql: string, params: unknown[]) => {
			if (sql.includes("status = 'sending'") && sql.includes("send_token = ?")) {
				mocks.queryOne.mockResolvedValue(
					intent({ send_token: params[0], status: "sending" }),
				);
			}
			return { affectedRows: 1 };
		});
		await reconcileSignupOutbox();
		const failure = mocks.execute.mock.calls.find(
			([sql, params]: [string, unknown[]]) =>
				sql.includes("status = ?") && params[0] === "uncertain",
		);
		expect(failure?.[1][1]).toContain("אינה ודאית");
	});
});

describe("applySignupSesEvent", () => {
	it.each([
		[{ signupIntentId: null }],
		[{ attemptId: "no-underscore" }],
		[{ attemptId: "7_" }],
		[{ type: "delivery" as const, permanent: false }],
		[{ type: "bounce" as const, permanent: false }],
	])("ignores a non-actionable event %j", async (overrides) => {
		await applySignupSesEvent(event(overrides));
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("fails the intent and records the provider suppression on a permanent bounce", async () => {
		mocks.txQueryOne.mockResolvedValue(
			intent({ send_token: "send-token-1", status: "sent" }),
		);
		await applySignupSesEvent(event());
		const [, failSql, failParams] = mocks.txExecute.mock.calls[0];
		expect(failSql).toContain("status = 'failed'");
		expect(failParams[1]).toBe(7);
		const [, suppressionSql, suppressionParams] = mocks.txExecute.mock.calls[1];
		expect(suppressionSql).toContain("tanah_daily_bulletin_subscriber");
		expect(suppressionParams).toEqual([
			"reader@example.com",
			"real",
			"bounced",
			"2026-10-28 08:02:03.456",
		]);
	});

	it("records a complaint as complained, never bounced", async () => {
		mocks.txQueryOne.mockResolvedValue(
			intent({ send_token: "send-token-1", status: "sent" }),
		);
		await applySignupSesEvent(event({ type: "complaint" }));
		expect(mocks.txExecute.mock.calls[1][2][2]).toBe("complained");
	});

	it.each([
		[intent({ send_token: "another-token" }), "a different send owns the row"],
		[intent({ email: "other@example.com", send_token: "send-token-1" }), "a different recipient"],
		[null, "no intent row"],
	])("writes nothing when %s", async (row) => {
		mocks.txQueryOne.mockResolvedValue(row);
		await applySignupSesEvent(event());
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});
});
