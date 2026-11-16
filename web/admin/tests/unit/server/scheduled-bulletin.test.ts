import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../util/deferred";

const m = vi.hoisted(() => ({
	prepare: vi.fn(),
	email: vi.fn(),
	rolloutEmail: vi.fn(),
	telegram: vi.fn(),
	whatsapp: vi.fn(),
	emailSettings: vi.fn(),
	telegramSettings: vi.fn(),
	whatsappSettings: vi.fn(),
	rolloutSummary: vi.fn(),
	NoConfirmedRecipientsError: class extends Error {
		constructor() {
			super("אין נמענים שאישרו קבלת דיוור ברשימה שנבחרה");
			this.name = "NoConfirmedRecipientsError";
		}
	},
}));
vi.mock("~/server/daily-bulletins.server", () => ({
	prepareBulletin: m.prepare,
}));
vi.mock("~/server/ses-delivery.server", () => ({
	enqueueBulletinEmail: m.email,
	enqueueBulletinRolloutEmail: m.rolloutEmail,
	NoConfirmedRecipientsError: m.NoConfirmedRecipientsError,
}));
vi.mock("~/server/rollout-state.server", () => ({
	getBulletinRolloutSummary: m.rolloutSummary,
}));
vi.mock("~/server/ses-settings.server", () => ({
	readAudienceSettings: m.emailSettings,
}));
vi.mock("~/server/telegram-delivery.server", () => ({
	enqueueBulletinTelegram: m.telegram,
}));
vi.mock("~/server/telegram-settings.server", () => ({
	readTelegramSettings: m.telegramSettings,
}));
vi.mock("~/server/whatsapp-delivery.server", () => ({
	enqueueBulletinWhatsApp: m.whatsapp,
}));
vi.mock("~/server/whatsapp-settings.server", () => ({
	readWhatsAppSettings: m.whatsappSettings,
}));

import {
	processScheduledBulletin,
	scheduledBulletinRequestKey,
} from "~/server/scheduled-bulletin.server";

const payload = {
	kind: "bulletin.generate",
	date: "2026-10-29",
	scheduledAt: "2026-10-29T08:00:00Z",
};
const now = new Date("2026-10-29T08:01:00Z");
const send = vi.fn();
const queue = {
	client: { send } as unknown as import("@aws-sdk/client-sqs").SQSClient,
	url: "https://sqs.il-central-1.amazonaws.com/250598594267/worker",
};
let controller: AbortController;
const run = (value: unknown = payload) =>
	processScheduledBulletin(value, controller.signal, queue, now);
beforeEach(() => {
	vi.resetAllMocks();
	send.mockImplementation(async (command) => ({
		Successful: command.input.Entries.map((entry: { Id: string }) => ({
			Id: entry.Id,
		})),
	}));
	vi.stubEnv("BULLETIN_SCHEDULE_ENABLED", "true");
	controller = new AbortController();
	m.emailSettings.mockResolvedValue({ audience: "test", revision: 2 });
	m.telegramSettings.mockResolvedValue({ audience: "real", revision: 3 });
	m.whatsappSettings.mockResolvedValue({ audience: "real", revision: 4 });
	m.rolloutSummary.mockResolvedValue(null);
	m.rolloutEmail.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
describe("scheduled bulletin orchestration", () => {
	it("prepares once, then enqueues the same immutable date to the three intended audiences", async () => {
		m.email.mockImplementation(() => {
			expect(m.prepare).toHaveResolved();
		});
		expect(await run()).toBe(true);
		expect(m.prepare).toHaveBeenCalledExactlyOnceWith("2026-10-29");
		expect(m.email).toHaveBeenCalledExactlyOnceWith(
			"2026-10-29",
			scheduledBulletinRequestKey("2026-10-29", "email"),
			{ audience: "test", revision: 2 },
		);
		expect(m.telegram).toHaveBeenCalledExactlyOnceWith({
			date: "2026-10-29",
			requestKey: scheduledBulletinRequestKey("2026-10-29", "telegram"),
			expectedAudience: "real",
			expectedRevision: 3,
		});
		expect(m.whatsapp).toHaveBeenCalledExactlyOnceWith(
			{
				date: "2026-10-29",
				requestKey: scheduledBulletinRequestKey("2026-10-29", "whatsapp"),
				expectedAudience: "real",
				expectedRevision: 4,
			},
			{ refreshRealTarget: true },
		);
	});
	it("redelivery reuses every durable request key; distinct dates/channels stay distinct", async () => {
		await run();
		await run();
		for (const fn of [m.email, m.telegram, m.whatsapp])
			expect(fn.mock.calls[1]).toEqual(fn.mock.calls[0]);
		const keys = ["email", "telegram", "whatsapp"].flatMap((channel) =>
			["2026-10-29", "2026-11-01"].map((date) =>
				scheduledBulletinRequestKey(date, channel),
			),
		);
		expect(new Set(keys).size).toBe(6);
		for (const key of keys)
			expect(key).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
			);
	});
	it.each([
		null,
		[],
		"bulletin.schedule",
		{},
		{ kind: "other", scheduledAt: payload.scheduledAt },
		{ ...payload, date: "2026-11-01" },
		{ ...payload, audience: "real" },
		{ kind: "bulletin.schedule" },
	])(
		"rejects malformed or override payload %j before any side effect",
		async (value) => {
			expect(await run(value)).toBe(false);
			expect(m.prepare).not.toHaveBeenCalled();
			expect(m.emailSettings).not.toHaveBeenCalled();
		},
	);
	it("does nothing when disabled or shutdown has begun", async () => {
		vi.stubEnv("BULLETIN_SCHEDULE_ENABLED", "false");
		expect(await run()).toBe(false);
		vi.stubEnv("BULLETIN_SCHEDULE_ENABLED", "true");
		controller.abort();
		expect(await run()).toBe(false);
		expect(m.emailSettings).not.toHaveBeenCalled();
	});
	it("rejects old/future timestamp without preparing or enqueuing", async () => {
		await expect(
			run({ ...payload, scheduledAt: "2026-10-28T08:00:00Z" }),
		).rejects.toThrow("timestamp rejected");
		expect(m.prepare).not.toHaveBeenCalled();
	});
	it("skips holidays and weekends without reading settings or preparing", async () => {
		for (const date of ["2026-10-30", "2026-10-31", "2026-09-21"]) {
			expect(
				await processScheduledBulletin(
					{
						kind: "bulletin.schedule",
						scheduledAt: `${date}T${date === "2026-09-21" ? "07" : "08"}:00:00Z`,
					},
					controller.signal,
					queue,
					new Date(`${date}T12:00:00Z`),
				),
			).toBe(true);
		}
		expect(m.prepare).not.toHaveBeenCalled();
		expect(m.emailSettings).not.toHaveBeenCalled();
	});
	it.each(["emailSettings", "telegramSettings", "whatsappSettings"] as const)(
		"stops on changed %s without overriding the admin",
		async (name) => {
			m[name].mockResolvedValue({
				audience: name === "emailSettings" ? "real" : "test",
				revision: 5,
			});
			await expect(run()).rejects.toThrow("audience policy mismatch");
			expect(m.prepare).not.toHaveBeenCalled();
		},
	);
	it("stops before rendering when settings fail or shutdown arrives during their read", async () => {
		m.emailSettings.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(run()).rejects.toThrow("database unavailable");
		expect(m.prepare).not.toHaveBeenCalled();
		m.telegramSettings.mockImplementationOnce(() => {
			controller.abort();
			return { audience: "real", revision: 3 };
		});
		expect(await run()).toBe(false);
		expect(m.prepare).not.toHaveBeenCalled();
	});
	it("does not enqueue after a render failure or delayed rendering during shutdown", async () => {
		m.prepare.mockRejectedValueOnce(new Error("render failed"));
		await expect(run()).rejects.toThrow("render failed");
		expect(m.email).not.toHaveBeenCalled();
		const pending = deferred<void>();
		m.prepare.mockReturnValueOnce(pending.promise);
		const running = run();
		await vi.waitFor(() => expect(m.prepare).toHaveBeenCalledTimes(2));
		controller.abort();
		pending.resolve();
		expect(await running).toBe(false);
		expect(m.telegram).not.toHaveBeenCalled();
	});
	it.each(["email", "telegram", "whatsapp"] as const)(
		"continues the other two channels if %s enqueue fails, and retains the SQS receipt",
		async (name) => {
			m[name].mockRejectedValueOnce(
				new Error("provider secret should not escape"),
			);
			await expect(run()).rejects.toThrow(
				"Scheduled bulletin channel enqueue incomplete",
			);
			for (const fn of [m.email, m.telegram, m.whatsapp])
				expect(fn).toHaveBeenCalledTimes(1);
		},
	);
	it("adds the limited real-cohort email job only while the rollout delivers admitted members", async () => {
		m.rolloutSummary.mockResolvedValue({
			state: "running",
			admitted: 3,
			remaining: 49,
			excluded: 0,
		});
		expect(await run()).toBe(true);
		expect(m.rolloutEmail).toHaveBeenCalledExactlyOnceWith(
			"2026-10-29",
			scheduledBulletinRequestKey("2026-10-29", "email"),
			2,
		);
	});
	it.each([
		{ state: "paused", admitted: 2 },
		{ state: "completed", admitted: 52 },
	])("keeps the cohort job while deliveries continue (%j)", async (rollout) => {
		m.rolloutSummary.mockResolvedValue(rollout);
		expect(await run()).toBe(true);
		expect(m.rolloutEmail).toHaveBeenCalledTimes(1);
	});
	it.each([
		null,
		{ state: "disabled", admitted: 0, remaining: 52 },
		{ state: "running", admitted: 0, remaining: 52 },
		{ state: "paused", admitted: 0, remaining: 52 },
	])(
		"skips the cohort job without a delivering, non-empty cohort (%j)",
		async (rollout) => {
			m.rolloutSummary.mockResolvedValue(rollout);
			expect(await run()).toBe(true);
			expect(m.rolloutEmail).not.toHaveBeenCalled();
			expect(m.email).toHaveBeenCalledTimes(1);
		},
	);
	it("treats a cohort emptied between the gate and the enqueue as a skip, not a failure", async () => {
		m.rolloutSummary.mockResolvedValue({ state: "running", admitted: 1 });
		m.rolloutEmail.mockRejectedValueOnce(new m.NoConfirmedRecipientsError());
		expect(await run()).toBe(true);
		expect(m.rolloutEmail).toHaveBeenCalledTimes(1);
	});
	it("fails the run when the cohort enqueue rejects for another reason", async () => {
		m.rolloutSummary.mockResolvedValue({ state: "running", admitted: 1 });
		m.rolloutEmail.mockRejectedValueOnce(new Error("provider down"));
		await expect(run()).rejects.toThrow(
			"Scheduled bulletin channel enqueue incomplete",
		);
	});

	it("fans out holiday dates as separate render receipts with exact wire JSON", async () => {
		const trigger = {
			kind: "bulletin.schedule",
			scheduledAt: "2025-09-22T07:00:00Z",
		};
		const clock = new Date("2025-09-22T07:01:00Z");
		expect(
			await processScheduledBulletin(trigger, controller.signal, queue, clock),
		).toBe(true);
		const messages = send.mock.calls[0][0].input.Entries.map(
			(entry: { MessageBody: string }) => JSON.parse(entry.MessageBody),
		);
		expect(messages).toEqual(
			["2025-09-22", "2025-09-23", "2025-09-24"].map((date) => ({
				kind: "bulletin.generate",
				scheduledAt: trigger.scheduledAt,
				date,
			})),
		);
		expect(m.prepare).not.toHaveBeenCalled();
		for (const message of messages)
			expect(
				await processScheduledBulletin(
					message,
					controller.signal,
					queue,
					clock,
				),
			).toBe(true);
		expect(m.prepare.mock.calls).toEqual([
			["2025-09-22"],
			["2025-09-23"],
			["2025-09-24"],
		]);
		expect(new Set(m.email.mock.calls.map((args) => args[1])).size).toBe(3);
	});
	it.each([{ Failed: [{ Id: "date" }] }, { Successful: [] }, {}])(
		"retains a trigger after incomplete date publication %j",
		async (response) => {
			send.mockResolvedValue(response);
			await expect(
				run({ kind: "bulletin.schedule", scheduledAt: payload.scheduledAt }),
			).rejects.toThrow("date publication incomplete");
			expect(m.prepare).not.toHaveBeenCalled();
		},
	);
	it("rejects a child date outside its validated calendar and a malformed child", async () => {
		expect(await run({ ...payload, date: "2026-11-01" })).toBe(false);
		expect(
			await run({
				kind: "bulletin.generate",
				scheduledAt: payload.scheduledAt,
				ignored: true,
			}),
		).toBe(false);
		expect(await run({ ...payload, date: 42 })).toBe(false);
		expect(m.prepare).not.toHaveBeenCalled();
	});
});
