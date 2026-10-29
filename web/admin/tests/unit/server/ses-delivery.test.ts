import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../util/deferred";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
	txQuery: vi.fn(),
	txQueryOne: vi.fn(),
	txExecute: vi.fn(),
	runtime: vi.fn(),
	readiness: vi.fn(),
	reserve: vi.fn(),
	prepared: vi.fn(),
	sendOne: vi.fn(),
	sesConfig: vi.fn(),
	sqs: vi.fn(),
	sqsConfig: vi.fn(),
	destroy: vi.fn(),
	parse: vi.fn(),
	delay: vi.fn(),
	whatsappProcess: vi.fn(),
	telegramProcess: vi.fn(),
	telegramSweep: vi.fn(),
	whatsappSweep: vi.fn(),
	scheduledProcess: vi.fn(),
}));
vi.mock("~/server/db", () => mocks);
vi.mock("~/server/daily-bulletins.server", () => ({
	readPreparedBulletin: mocks.prepared,
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
	class SesSuppressedError extends SesError {
		constructor() {
			super("Suppressed", "failed");
		}
	}
	return {
		SesError,
		SesSuppressedError,
		SesClient: class {
			constructor(config: unknown) {
				mocks.sesConfig(config);
			}
			sendOne = mocks.sendOne;
		},
	};
});
vi.mock("~/server/ses-settings.server", async () => {
	const { SesSuppressedError } = await import("~/server/ses-client.server");
	return {
		DeliverySuppressed: SesSuppressedError,
		loadEmailRuntime: mocks.runtime,
		getEmailReadiness: mocks.readiness,
		reserveSendSlot: mocks.reserve,
	};
});
vi.mock("~/server/ses-events.server", () => ({ parseSesEvent: mocks.parse }));
vi.mock("~/server/whatsapp-delivery.server", () => ({
	processWhatsAppJob: mocks.whatsappProcess,
	reconcileWhatsAppOutbox: mocks.whatsappSweep,
}));
vi.mock("~/server/telegram-delivery.server", () => ({
	processTelegramJob: mocks.telegramProcess,
	reconcileTelegramOutbox: mocks.telegramSweep,
}));
vi.mock("~/server/scheduled-bulletin.server", () => ({
	processScheduledBulletin: mocks.scheduledProcess,
}));
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.delay }));
vi.mock("@aws-sdk/client-sqs", () => ({
	SQSClient: class {
		constructor(config: unknown) {
			mocks.sqsConfig(config);
		}
		send = mocks.sqs;
		destroy = mocks.destroy;
	},
	SendMessageBatchCommand: class {
		kind = "batch";
		constructor(public input: unknown) {}
	},
	ReceiveMessageCommand: class {
		kind = "receive";
		constructor(public input: unknown) {}
	},
	DeleteMessageCommand: class {
		kind = "delete";
		constructor(public input: unknown) {}
	},
}));

import { SesError, SesSuppressedError } from "~/server/ses-client.server";
import {
	applySesEvent,
	enqueueBulletinEmail,
	processEmailRecipient,
	readLatestEmailJob,
	startEmailWorker,
} from "~/server/ses-delivery.server";
import type {
	SesDeliveryEvent,
	SesSubscriptionEvent,
} from "~/server/ses-events.server";

type Audience = "test" | "real";
interface Job {
	id: string;
	bulletin_date: string;
	audience: Audience;
	settings_revision: number;
	status: string;
	created_at: string;
	idempotency_key: string;
	last_error?: string | null;
}
interface Subscriber {
	id: number;
	email: string;
	audience: Audience;
	consent_status: string;
	consented_at: string | null;
	last_event_at: string | null;
}
interface Recipient {
	id: number;
	job_id: string;
	subscriber_id: number;
	email: string;
	status: string;
	attempt_token: string | null;
	message_id: string | null;
	started_at: string | null;
	event_at: string | null;
	last_error: string | null;
}
interface State {
	jobs: Job[];
	subscribers: Subscriber[];
	recipients: Recipient[];
	settings: { audience: Audience; revision: number };
	channel: string;
	legacyEmail: {
		attempt_count: number;
		provider_message_id: string | null;
		sent_at: string | null;
		lease_token: string | null;
		lease_until: string | null;
	} | null;
	writes: { sql: string; params: unknown[] }[];
}
let state: State;
const date = "2026-10-28";
const key = "12345678-1234-4234-8234-123456789012";
const key2 = "12345678-1234-4234-8234-123456789013";
const config = {
	region: "il-central-1",
	fromAddress: "bulletin@example.com",
	senderName: "Example",
	contactListName: "bulletin",
	configurationSetName: "events",
	queueUrl: "https://sqs.il-central-1.amazonaws.com/123456789012/bulletin",
	accountId: "123456789012",
};
const expected = { audience: "test" as const, revision: 0 };

function subscriber(id = 1, audience: Audience = "test"): Subscriber {
	return {
		id,
		email: `reader${id}@example.com`,
		audience,
		consent_status: "confirmed",
		consented_at: "2026-10-01 00:00:00.000",
		last_event_at: null,
	};
}
function job(audience: Audience = "test", status = "queued"): Job {
	return {
		id: "job-1",
		bulletin_date: date,
		audience,
		settings_revision: 0,
		status,
		created_at: "2026-10-28T12:00:00Z",
		idempotency_key: audience === "real" ? "production" : key,
	};
}
function seed(audience: Audience = "test", status = "queued"): Recipient {
	state.settings.audience = audience;
	state.jobs = [job(audience, status)];
	state.subscribers = [subscriber(1, audience)];
	const row = {
		id: 1,
		job_id: "job-1",
		subscriber_id: 1,
		email: "reader1@example.com",
		status,
		attempt_token: status === "queued" ? null : "token-1",
		message_id:
			status === "queued" || status === "sending" ? null : "message-1",
		started_at: status === "queued" ? null : "2026-10-28 12:00:00.000",
		event_at: null,
		last_error: null,
	};
	state.recipients = [row];
	return row;
}
function compact(sql: string) {
	return sql.replace(/\s+/g, " ").trim();
}
function read(sqlRaw: string, params: unknown[] = []): unknown[] {
	const sql = compact(sqlRaw);
	if (sql.includes("FROM tanah_daily_bulletin_delivery"))
		return state.legacyEmail
			? [{ status: state.channel, ...state.legacyEmail }]
			: [];
	if (sql.includes("FROM tanah_daily_bulletin_email_settings"))
		return [{ ...state.settings }];
	if (sql.includes("FROM tanah_daily_bulletin_subscriber"))
		return state.subscribers
			.filter(
				(s) => s.audience === params[0] && s.consent_status === "confirmed",
			)
			.map((s) => ({ ...s }));
	if (sql.includes("FROM tanah_daily_bulletin_email_job")) {
		if (sql.includes("idempotency_key = ?"))
			return state.jobs
				.filter(
					(j) =>
						j.bulletin_date === params[0] &&
						j.audience === params[1] &&
						j.idempotency_key === params[2],
				)
				.map((j) => ({ ...j }));
		if (
			sql.includes("status IN ('queued', 'sending', 'accepted', 'uncertain')")
		)
			return state.jobs
				.filter(
					(j) =>
						j.bulletin_date === params[0] &&
						j.audience === params[1] &&
						(["queued", "sending", "accepted", "uncertain"].includes(
							j.status,
						) ||
							state.recipients.some(
								(r) =>
									r.job_id === j.id &&
									["queued", "sending", "accepted", "uncertain"].includes(
										r.status,
									),
							)),
				)
				.map((j) => ({ ...j }));
		if (sql.includes("ORDER BY created_at"))
			return state.jobs
				.filter(
					(j) =>
						j.bulletin_date === params[0] &&
						(params[1] === undefined || j.audience === params[1]),
				)
				.slice(-1)
				.map((j) => ({ ...j }));
		return state.jobs.filter((j) => j.id === params[0]).map((j) => ({ ...j }));
	}
	if (sql.includes("FROM tanah_daily_bulletin_email_recipient")) {
		if (sql.includes("SELECT id, job_id") && sql.includes("status = 'sending'"))
			return state.recipients
				.filter(
					(r) =>
						r.status === "sending" &&
						(!r.started_at ||
							Date.parse(`${r.started_at.replace(/Z$/, "")}Z`) <
								Date.now() - 60_000),
				)
				.slice(0, 100)
				.map((r) => ({ id: r.id, job_id: r.job_id }));
		if (sql.includes("LIMIT 100"))
			return state.recipients
				.filter((r) => r.status === "queued")
				.slice(0, 100)
				.map((r) => ({ id: r.id }));
		if (sql.includes("GROUP BY status")) {
			const counts: Record<string, number> = {};
			for (const r of state.recipients.filter((r) => r.job_id === params[0]))
				counts[r.status] = (counts[r.status] ?? 0) + 1;
			return Object.entries(counts).map(([status, count]) => ({
				status,
				count,
			}));
		}
		if (sql.includes("status = 'queued' ORDER BY"))
			return state.recipients
				.filter((r) => r.job_id === params[0] && r.status === "queued")
				.map((r) => ({ id: r.id }));
		const row = state.recipients.find((r) => r.id === params[0]);
		if (!row) return [];
		if (sql.includes("JOIN tanah_daily_bulletin_email_job")) {
			const j = state.jobs.find((j) => j.id === row.job_id);
			const s = state.subscribers.find((s) => s.id === row.subscriber_id);
			if (!j || !s) return [];
			return [
				{
					...row,
					bulletin_date: j.bulletin_date,
					audience: j.audience,
					settings_revision: j.settings_revision,
					consent_status: s.consent_status,
					subscriber_email: s.email,
					subscriber_audience: s.audience,
				},
			];
		}
		return [{ ...row }];
	}
	throw new Error(`Unhandled read: ${sql}`);
}
function write(sqlRaw: string, p: unknown[] = []) {
	const sql = compact(sqlRaw);
	expect(sql.match(/\?/g)?.length ?? 0).toBe(p.length);
	state.writes.push({ sql, params: p });
	const result = (affectedRows = 1) => ({
		affectedRows,
		insertId: state.recipients.length,
	});
	if (sql.startsWith("INSERT INTO tanah_daily_bulletin_email_job")) {
		state.jobs.push({
			id: String(p[0]),
			bulletin_date: String(p[1]),
			audience: p[2] as Audience,
			idempotency_key: String(p[3]),
			settings_revision: Number(p[4]),
			status: "queued",
			created_at: "2026-10-28T12:00:00Z",
		});
		return result();
	}
	if (sql.startsWith("INSERT INTO tanah_daily_bulletin_email_recipient")) {
		state.recipients.push({
			id: state.recipients.length + 1,
			job_id: String(p[0]),
			subscriber_id: Number(p[1]),
			email: String(p[2]),
			status: "queued",
			attempt_token: null,
			message_id: null,
			started_at: null,
			event_at: null,
			last_error: null,
		});
		return result();
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_email_job")) {
		const row = state.jobs.find((j) => j.id === p[2]);
		if (!row) return result(0);
		row.status = String(p[0]);
		row.last_error = p[1] as string | null;
		return result();
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_delivery")) {
		state.channel = String(p[0]);
		return result();
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_subscriber")) {
		if (sql.includes("GREATEST")) {
			for (const s of state.subscribers.filter((s) => s.email === p[3])) {
				if (s.consent_status !== "complained") s.consent_status = String(p[0]);
				if (!s.last_event_at || s.last_event_at < String(p[1]))
					s.last_event_at = String(p[1]);
			}
		} else {
			for (const s of state.subscribers.filter(
				(s) =>
					s.email === p[2] &&
					s.audience === p[3] &&
					(!s.last_event_at ||
						s.last_event_at < String(p[4]) ||
						(p[5] && s.last_event_at === p[6])),
			)) {
				if (!["bounced", "complained"].includes(s.consent_status)) {
					if (p[0] && s.consent_status !== "pending")
						s.consent_status = "unsubscribed";
					else if (
						!p[0] &&
						s.consent_status === "unsubscribed" &&
						s.consented_at
					)
						s.consent_status = "confirmed";
				}
				s.last_event_at = String(p[1]);
			}
		}
		return result();
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_email_recipient")) {
		if (sql.includes("status = 'sending', attempt_token")) {
			const r = state.recipients.find(
				(r) => r.id === p[1] && r.status === "queued",
			);
			if (!r) return result(0);
			r.status = "sending";
			r.attempt_token = String(p[0]);
			r.started_at = new Date().toISOString();
			r.last_error = null;
			return result();
		}
		if (sql.includes("INTERVAL 60 SECOND")) {
			const r = state.recipients.find(
				(r) => r.id === p[1] && r.status === "sending",
			);
			if (
				!r ||
				(r.started_at &&
					Date.parse(`${r.started_at.replace(/Z$/, "")}Z`) >=
						Date.now() - 60_000)
			)
				return result(0);
			r.status = "uncertain";
			r.last_error = String(p[0]);
			return result();
		}
		if (sql.includes("SET message_id = ?")) {
			const event = sql.includes("event_at = ?");
			const id = Number(p[event ? 4 : 1]);
			const token = p[event ? 5 : 2];
			const r = state.recipients.find(
				(r) =>
					r.id === id &&
					r.attempt_token === token &&
					(r.message_id === null || r.message_id === p[0]),
			);
			if (!r) return result(0);
			r.message_id = String(p[0]);
			if (event) {
				r.status = String(p[1]);
				r.event_at = String(p[2]);
				r.last_error = p[3] as string | null;
			} else {
				if (["sending", "uncertain", "accepted"].includes(r.status))
					r.last_error = null;
				if (["sending", "uncertain"].includes(r.status)) r.status = "accepted";
			}
			return result();
		}
		const r = state.recipients.find(
			(r) =>
				r.id === p[2] &&
				r.attempt_token === p[3] &&
				["sending", "uncertain"].includes(r.status),
		);
		if (!r) return result(0);
		r.status = String(p[0]);
		r.last_error = String(p[1]);
		return result();
	}
	throw new Error(`Unhandled write: ${sql}`);
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const name of [
		"BULLETIN_TELEGRAM_BOT_TOKEN",
		"BULLETIN_TELEGRAM_BOT_USERNAME",
		"BULLETIN_TELEGRAM_TEST_CHAT_ID",
	])
		vi.stubEnv(name, "");
	mocks.telegramProcess.mockReset().mockResolvedValue(true);
	mocks.telegramSweep.mockReset().mockResolvedValue(undefined);
	for (const name of [
		"BULLETIN_WHATSAPP_API_TOKEN",
		"BULLETIN_WHATSAPP_INSTANCE_ID",
		"BULLETIN_WHATSAPP_TEST_GROUP_ID",
	])
		vi.stubEnv(name, "");
	mocks.whatsappProcess.mockReset().mockResolvedValue(true);
	mocks.whatsappSweep.mockReset().mockResolvedValue(undefined);
	state = {
		jobs: [],
		subscribers: [subscriber(), subscriber(2)],
		recipients: [],
		settings: { audience: "test", revision: 0 },
		channel: "pending",
		legacyEmail: {
			attempt_count: 0,
			provider_message_id: null,
			sent_at: null,
			lease_token: null,
			lease_until: null,
		},
		writes: [],
	};
	mocks.query.mockImplementation(async (sql, p) => read(sql, p));
	mocks.queryOne.mockImplementation(async (sql, p) => read(sql, p)[0] ?? null);
	mocks.execute.mockImplementation(async (sql, p) => write(sql, p));
	mocks.txQuery.mockImplementation(async (_c, sql, p) => read(sql, p));
	mocks.txQueryOne.mockImplementation(
		async (_c, sql, p) => read(sql, p)[0] ?? null,
	);
	mocks.txExecute.mockImplementation(async (_c, sql, p) => write(sql, p));
	let last = Promise.resolve();
	mocks.transaction.mockImplementation(async (callback) => {
		const previous = last;
		let release = () => {};
		last = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await callback({});
		} finally {
			release();
		}
	});
	mocks.runtime.mockReturnValue(config);
	mocks.readiness.mockResolvedValue({
		configured: true,
		canSend: true,
		canUseReal: true,
		blockers: [],
	});
	mocks.reserve.mockResolvedValue(undefined);
	mocks.prepared.mockResolvedValue({
		subject: "Prepared subject",
		emailHtml: "<p>Saved bulletin</p>",
	});
	mocks.sendOne.mockImplementation(async () => {
		await mocks.sesConfig.mock.lastCall?.[0].beforeSend();
		return "message-1";
	});
	mocks.sqs.mockImplementation(async (command) =>
		command.kind === "batch"
			? {
					Successful: command.input.Entries.map((entry: { Id: string }) => ({
						Id: entry.Id,
					})),
				}
			: {},
	);
	mocks.parse.mockReturnValue(null);
	mocks.delay.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("enqueue", () => {
	it("snapshots confirmed test recipients and publishes only committed work", async () => {
		state.subscribers.push(
			{ ...subscriber(3), consent_status: "pending" },
			subscriber(4, "real"),
		);
		const result = await enqueueBulletinEmail(date, key, expected);
		expect(result).toMatchObject({
			date,
			audience: "test",
			status: "queued",
			counts: { queued: 2 },
		});
		expect(state.recipients.map((r) => r.email)).toEqual([
			"reader1@example.com",
			"reader2@example.com",
		]);
		expect(mocks.sqsConfig).toHaveBeenCalledWith({
			region: config.region,
			maxAttempts: 1,
		});
		expect(
			mocks.sqs.mock.calls[0][0].input.Entries.map(
				(e: { MessageBody: string }) => JSON.parse(e.MessageBody),
			),
		).toEqual([
			{ kind: "send", recipientId: 1 },
			{ kind: "send", recipientId: 2 },
		]);
		expect(state.channel).toBe("pending");
	});
	it("uses chunks of ten and replays only queued rows", async () => {
		state.subscribers = Array.from({ length: 12 }, (_, i) => subscriber(i + 1));
		await enqueueBulletinEmail(date, key, expected);
		expect(mocks.sqs.mock.calls.map((c) => c[0].input.Entries.length)).toEqual([
			10, 2,
		]);
		expect(mocks.sqs.mock.calls[0][1].abortSignal).toBe(
			mocks.sqs.mock.calls[1][1].abortSignal,
		);
		state.recipients[0].status = "accepted";
		await enqueueBulletinEmail(date, key, expected);
		expect(state.jobs).toHaveLength(1);
		expect(
			mocks.sqs.mock.calls
				.slice(2)
				.flatMap((c) => c[0].input.Entries)
				.some((e: { Id: string }) => e.Id === "1"),
		).toBe(false);
	});
	it("recovers partial queue publication with the same idempotency key", async () => {
		mocks.sqs.mockResolvedValueOnce({
			Successful: [{ Id: "1" }],
			Failed: [{ Id: "2" }],
		});
		await expect(enqueueBulletinEmail(date, key, expected)).rejects.toThrow(
			"לתור",
		);
		expect(state.jobs).toHaveLength(1);
		expect(state.recipients.every((r) => r.status === "queued")).toBe(true);
		await enqueueBulletinEmail(date, key, expected);
		expect(state.jobs).toHaveLength(1);
	});
	it("keeps unsent recipients durable when the shared publication deadline expires between batches", async () => {
		state.subscribers = Array.from({ length: 12 }, (_, i) => subscriber(i + 1));
		const deadline = new AbortController();
		const timeout = vi
			.spyOn(AbortSignal, "timeout")
			.mockReturnValueOnce(deadline.signal);
		mocks.sqs.mockImplementationOnce(async (command) => {
			deadline.abort();
			return {
				Successful: command.input.Entries.map(({ Id }: { Id: string }) => ({
					Id,
				})),
			};
		});
		try {
			await expect(enqueueBulletinEmail(date, key, expected)).rejects.toThrow(
				"לתור",
			);
			expect(mocks.sqs).toHaveBeenCalledOnce();
			expect(state.recipients).toHaveLength(12);
			expect(state.recipients.every(({ status }) => status === "queued")).toBe(
				true,
			);
			expect(mocks.sendOne).not.toHaveBeenCalled();
		} finally {
			timeout.mockRestore();
		}
	});
	it("stops an outbox sweep on shutdown without polling or losing queued recipients", async () => {
		state.subscribers = Array.from({ length: 12 }, (_, i) => subscriber(i + 1));
		await enqueueBulletinEmail(date, key, expected);
		mocks.sqs.mockClear();
		mocks.destroy.mockClear();
		const shutdown = new AbortController();
		mocks.sqs.mockImplementationOnce(async (command, options) => {
			shutdown.abort();
			expect(options.abortSignal.aborted).toBe(true);
			return {
				Successful: command.input.Entries.map(({ Id }: { Id: string }) => ({
					Id,
				})),
			};
		});

		await startEmailWorker(shutdown.signal);

		expect(mocks.sqs).toHaveBeenCalledOnce();
		expect(mocks.sqs.mock.calls[0][0].kind).toBe("batch");
		expect(mocks.whatsappSweep).not.toHaveBeenCalled();
		expect(state.recipients.every(({ status }) => status === "queued")).toBe(
			true,
		);
		expect(mocks.sendOne).not.toHaveBeenCalled();
		expect(mocks.destroy).toHaveBeenCalledOnce();
	});
	it("serializes concurrent matching enqueue requests", async () => {
		const results = await Promise.all([
			enqueueBulletinEmail(date, key, expected),
			enqueueBulletinEmail(date, key, expected),
		]);
		expect(results[0].id).toBe(results[1].id);
		expect(state.recipients).toHaveLength(2);
	});
	it("forces a stable production key and never changes the selected mode", async () => {
		state.settings.audience = "real";
		state.subscribers = [subscriber(1, "real")];
		await enqueueBulletinEmail(date, key, { audience: "real", revision: 0 });
		await enqueueBulletinEmail(date, key2, { audience: "real", revision: 0 });
		expect(state.jobs).toHaveLength(1);
		expect(state.jobs[0].idempotency_key).toBe("production");
		expect(state.settings).toEqual({ audience: "real", revision: 0 });
		expect(state.channel).toBe("sending");
	});
	it.each([
		{ status: "sending" },
		{ status: "sent" },
		{ status: "failed" },
		{ status: "uncertain" },
		{ attempt_count: 1 },
		{ provider_message_id: "legacy-message" },
		{ sent_at: "2026-10-28 12:00:00" },
		{ lease_token: "legacy-lease" },
		{ lease_until: "2026-10-28 12:00:00" },
	])(
		"refuses new production work when legacy email history remains: %j",
		async (history) => {
			state.settings.audience = "real";
			state.subscribers = [subscriber(1, "real")];
			if ("status" in history && typeof history.status === "string")
				state.channel = history.status;
			Object.assign(state.legacyEmail ?? {}, history);

			await expect(
				enqueueBulletinEmail(date, key, { audience: "real", revision: 0 }),
			).rejects.toThrow("ניסיון דיוור קודם");

			expect(state.jobs).toHaveLength(0);
			expect(state.recipients).toHaveLength(0);
			expect(mocks.sqs).not.toHaveBeenCalled();
		},
	);
	it("refuses new production work when the saved channel record is missing", async () => {
		state.settings.audience = "real";
		state.subscribers = [subscriber(1, "real")];
		state.legacyEmail = null;
		await expect(
			enqueueBulletinEmail(date, key, { audience: "real", revision: 0 }),
		).rejects.toThrow("ניסיון דיוור קודם");
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it("does not publish production work if the legacy channel reservation fails", async () => {
		state.settings.audience = "real";
		state.subscribers = [subscriber(1, "real")];
		mocks.txExecute.mockImplementation(async (_connection, sql, parameters) =>
			sql.includes("AND status = 'pending' AND attempt_count = 0")
				? { affectedRows: 0 }
				: write(sql, parameters),
		);
		await expect(
			enqueueBulletinEmail(date, key, { audience: "real", revision: 0 }),
		).rejects.toThrow("Suppressed");
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it("returns an existing production job without interpreting its channel history as a new send", async () => {
		seed("real", "delivered");
		state.channel = "sent";
		Object.assign(state.legacyEmail ?? {}, {
			attempt_count: 1,
			provider_message_id: "legacy-message",
		});
		const result = await enqueueBulletinEmail(date, key2, {
			audience: "real",
			revision: 0,
		});
		expect(result.id).toBe("job-1");
		expect(result.status).toBe("delivered");
		expect(state.jobs).toHaveLength(1);
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it("allows an explicit test without changing previous production email history", async () => {
		state.channel = "sent";
		Object.assign(state.legacyEmail ?? {}, {
			attempt_count: 1,
			provider_message_id: "legacy-message",
		});
		const result = await enqueueBulletinEmail(date, key, expected);
		expect(result.audience).toBe("test");
		expect(state.channel).toBe("sent");
		expect(state.legacyEmail?.provider_message_id).toBe("legacy-message");
		expect(
			state.writes.some(({ sql }) =>
				sql.includes("UPDATE tanah_daily_bulletin_delivery"),
			),
		).toBe(false);
	});
	it.each(["queued", "sending", "accepted", "uncertain"])(
		"refuses a new test request while %s exists",
		async (status) => {
			seed("test", status);
			await expect(enqueueBulletinEmail(date, key2, expected)).rejects.toThrow(
				"בקשת שליחה",
			);
			expect(mocks.sqs).not.toHaveBeenCalled();
		},
	);
	it("blocks a new request when recipient uncertainty outlives a stale cached job status", async () => {
		seed("test", "uncertain");
		state.jobs[0].status = "accepted";
		await expect(enqueueBulletinEmail(date, key2, expected)).rejects.toThrow(
			"בקשת שליחה",
		);
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it.each([
		{ audience: "real", revision: 0 },
		{ audience: "test", revision: 1 },
	])(
		"rejects stale audience/revision %j under the settings lock",
		async (value) => {
			await expect(
				enqueueBulletinEmail(date, key, value as typeof expected),
			).rejects.toBeInstanceOf(SesSuppressedError);
			expect(state.jobs).toHaveLength(0);
			expect(mocks.sqs).not.toHaveBeenCalled();
		},
	);
	it("requires readiness, a prepared snapshot and confirmed recipients", async () => {
		mocks.readiness.mockResolvedValueOnce({ canSend: false });
		await expect(enqueueBulletinEmail(date, key, expected)).rejects.toThrow(
			"מוכן",
		);
		mocks.prepared.mockResolvedValueOnce(null);
		await expect(enqueueBulletinEmail(date, key, expected)).rejects.toThrow(
			"להכין",
		);
		state.subscribers = [];
		await expect(enqueueBulletinEmail(date, key, expected)).rejects.toThrow(
			"אין נמענים",
		);
		expect(state.jobs).toHaveLength(0);
	});
	it("refuses production while SES production access is unavailable", async () => {
		mocks.readiness.mockResolvedValue({ canSend: true, canUseReal: false });
		await expect(
			enqueueBulletinEmail(date, key, { audience: "real", revision: 0 }),
		).rejects.toThrow("מוכן");
	});
	it.each(["bad", "2026-02-30"])("validates date %s", async (value) => {
		await expect(enqueueBulletinEmail(value, key, expected)).rejects.toThrow();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
	it("validates the request key and expected settings", async () => {
		await expect(enqueueBulletinEmail(date, "bad", expected)).rejects.toThrow();
		await expect(
			enqueueBulletinEmail(date, key, { audience: "test", revision: -1 }),
		).rejects.toThrow();
	});
});

describe("recipient processing", () => {
	it("claims before sending, reserves final consent/mode slot and records accepted only", async () => {
		const row = seed();
		mocks.sendOne.mockImplementationOnce(async (input) => {
			expect(row.status).toBe("sending");
			expect(row.attempt_token).toMatch(/^[a-f0-9-]{36}$/);
			expect(input).toEqual({
				to: row.email,
				subject: "Prepared subject",
				html: "<p>Saved bulletin</p>",
				audience: "test",
				externalId: `1_${row.attempt_token}`,
			});
			await mocks.sesConfig.mock.lastCall?.[0].beforeSend();
			return "message-1";
		});
		await processEmailRecipient(1);
		expect(mocks.reserve).toHaveBeenCalledWith("test", 0, 1);
		expect(row.status).toBe("accepted");
		expect(row.message_id).toBe("message-1");
		expect(state.channel).toBe("pending");
	});
	it("sends once when duplicate queue handlers race", async () => {
		seed();
		await Promise.all([processEmailRecipient(1), processEmailRecipient(1)]);
		expect(mocks.sendOne).toHaveBeenCalledTimes(1);
	});
	it.each([
		"accepted",
		"delivered",
		"failed",
		"uncertain",
		"suppressed",
		"bounced",
		"complained",
	])("never automatically retries %s", async (status) => {
		seed("test", status);
		await processEmailRecipient(1);
		expect(mocks.sendOne).not.toHaveBeenCalled();
	});
	it("marks stale sending uncertain without another provider call", async () => {
		const row = seed("test", "sending");
		row.started_at = "2000-01-01 00:00:00.000";
		await processEmailRecipient(1);
		expect(row.status).toBe("uncertain");
		expect(mocks.sendOne).not.toHaveBeenCalled();
	});
	it("leaves a fresh in-flight attempt intact", async () => {
		const row = seed("test", "sending");
		row.started_at = new Date().toISOString();
		await processEmailRecipient(1);
		expect(row.status).toBe("sending");
		expect(mocks.sendOne).not.toHaveBeenCalled();
	});
	it.each(["unsubscribed", "pending", "bounced", "complained"])(
		"suppresses consent %s before provider access",
		async (consent) => {
			const row = seed();
			state.subscribers[0].consent_status = consent;
			await processEmailRecipient(1);
			expect(row.status).toBe("suppressed");
			expect(mocks.sendOne).not.toHaveBeenCalled();
		},
	);
	it("refuses changed subscriber identity", async () => {
		const row = seed();
		state.subscribers[0].email = "changed@example.com";
		await processEmailRecipient(1);
		expect(row.status).toBe("suppressed");
	});
	it("suppresses a mode or consent change during the final reservation", async () => {
		const row = seed();
		mocks.reserve
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new SesSuppressedError());
		await processEmailRecipient(1);
		expect(row.status).toBe("suppressed");
		expect(mocks.reserve).toHaveBeenCalledTimes(2);
	});
	it("checks and paces consent before the contact API read as well", async () => {
		const row = seed();
		mocks.reserve.mockRejectedValueOnce(new SesSuppressedError());
		await processEmailRecipient(1);
		expect(row.status).toBe("suppressed");
		expect(mocks.sendOne).not.toHaveBeenCalled();
	});
	it("records limiter failure before SendEmail as a deterministic failure", async () => {
		const row = seed();
		mocks.reserve
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("private limiter error"));
		await processEmailRecipient(1);
		expect(row.status).toBe("failed");
		expect(row.last_error).not.toContain("private");
	});
	it("suppresses native SES optout without retrying", async () => {
		const row = seed();
		mocks.sendOne.mockRejectedValue(new SesSuppressedError());
		await processEmailRecipient(1);
		expect(row.status).toBe("suppressed");
	});
	it.each(["failed", "uncertain"] as const)(
		"records sanitized provider outcome %s",
		async (outcome) => {
			const row = seed();
			mocks.sendOne.mockRejectedValue(
				new SesError("Provider secret must not persist", outcome),
			);
			await processEmailRecipient(1);
			expect(row.status).toBe(outcome);
			expect(row.last_error).not.toContain("secret");
		},
	);
	it("treats unknown errors after the final hook as uncertain", async () => {
		const row = seed();
		mocks.sendOne.mockImplementationOnce(async () => {
			await mocks.sesConfig.mock.lastCall?.[0].beforeSend();
			throw new Error("private");
		});
		await processEmailRecipient(1);
		expect(row.status).toBe("uncertain");
	});
	it("does not resend when accepted-message persistence fails", async () => {
		const row = seed();
		let fail = true;
		mocks.execute.mockImplementation(async (sql, p) => {
			if (compact(sql).includes("SET message_id") && fail) {
				fail = false;
				throw new Error("store unavailable");
			}
			return write(sql, p);
		});
		await processEmailRecipient(1);
		expect(row.status).toBe("uncertain");
		await processEmailRecipient(1);
		expect(mocks.sendOne).toHaveBeenCalledTimes(1);
	});
	it("leaves claimed sending durable if both acknowledgement and uncertainty persistence fail", async () => {
		const row = seed();
		mocks.execute.mockImplementation(async (sql, p) => {
			if (!compact(sql).includes("status = 'sending', attempt_token"))
				throw new Error("store unavailable");
			return write(sql, p);
		});
		await expect(processEmailRecipient(1)).rejects.toThrow("store unavailable");
		expect(row.status).toBe("sending");
		mocks.execute.mockImplementation(async (sql, p) => write(sql, p));
		await processEmailRecipient(1);
		expect(mocks.sendOne).toHaveBeenCalledTimes(1);
	});
	it("keeps a terminal event and its diagnostic when the provider ACK arrives later", async () => {
		const row = seed();
		mocks.sendOne.mockImplementationOnce(async () => {
			await mocks.sesConfig.mock.lastCall?.[0].beforeSend();
			row.status = "bounced";
			row.message_id = "message-1";
			row.last_error = "generic terminal error";
			return "message-1";
		});
		await processEmailRecipient(1);
		expect(row.status).toBe("bounced");
		expect(row.last_error).toBe("generic terminal error");
	});
	it("applies an actual delivery event racing ahead of the provider ACK", async () => {
		const row = seed("real");
		mocks.sendOne.mockImplementationOnce(async () => {
			await mocks.sesConfig.mock.lastCall?.[0].beforeSend();
			await applySesEvent({
				...delivery(),
				attemptId: `1_${row.attempt_token}`,
			});
			return "message-1";
		});
		await processEmailRecipient(1);
		expect(row.status).toBe("delivered");
		expect(row.message_id).toBe("message-1");
		expect(state.channel).toBe("sent");
	});
	it("updates the real channel to sending on acceptance, never sent", async () => {
		seed("real");
		await processEmailRecipient(1);
		expect(state.channel).toBe("sending");
	});
	it("requires a valid row ID and ignores missing rows", async () => {
		await expect(processEmailRecipient(0)).rejects.toThrow();
		await processEmailRecipient(123);
		expect(mocks.sendOne).not.toHaveBeenCalled();
	});
	it("fails safely when runtime configuration or prepared content disappeared", async () => {
		let row = seed();
		mocks.runtime.mockReturnValueOnce(null);
		await processEmailRecipient(1);
		expect(row.status).toBe("failed");
		row = seed();
		mocks.prepared.mockResolvedValueOnce(null);
		await processEmailRecipient(1);
		expect(row.status).toBe("failed");
		expect(mocks.sendOne).not.toHaveBeenCalled();
	});
});

function delivery(
	type: SesDeliveryEvent["type"] = "delivery",
	timestamp = "2026-10-28T12:01:00.000Z",
): SesDeliveryEvent {
	return {
		type,
		messageId: "message-1",
		attemptId: "1_token-1",
		email: "reader1@example.com",
		timestamp,
	};
}
function subscription(
	topics: SesSubscriptionEvent["topics"],
	timestamp = "2026-10-28T12:01:00.000Z",
	unsubscribeAll = false,
): SesSubscriptionEvent {
	return {
		type: "subscription",
		email: "reader1@example.com",
		timestamp,
		topics,
		unsubscribeAll,
	};
}

describe("SES events", () => {
	it("binds an early delivery to the exact claimed attempt before send ACK", async () => {
		const row = seed("real", "sending");
		await applySesEvent(delivery());
		expect(row.message_id).toBe("message-1");
		expect(row.status).toBe("delivered");
		expect(state.channel).toBe("sent");
	});
	it.each([
		{ attemptId: "2_token-1" },
		{ attemptId: "1_other-token" },
		{ messageId: "another-message" },
		{ email: "other@example.com" },
		{ attemptId: "invalid" },
	])("ignores mismatched delivery context %j", async (change) => {
		const row = seed("test", "accepted");
		await applySesEvent({ ...delivery(), ...change });
		expect(row.status).toBe("accepted");
	});
	it("ignores replayed or older events without downgrading delivery", async () => {
		const row = seed("test", "accepted");
		await applySesEvent(delivery());
		await applySesEvent(delivery("send", "2026-10-28T12:00:00.000Z"));
		await applySesEvent(delivery());
		expect(row.status).toBe("delivered");
		expect(state.channel).toBe("pending");
	});
	it("never lets a later send undo delivered status", async () => {
		const row = seed("test", "delivered");
		await applySesEvent(delivery("send"));
		expect(row.status).toBe("delivered");
	});
	it.each(["reject", "renderingFailure"] as const)(
		"records %s as failed",
		async (type) => {
			const row = seed("real", "accepted");
			await applySesEvent(delivery(type));
			expect(row.status).toBe("failed");
			expect(state.channel).toBe("failed");
		},
	);
	it("transient bounce fails delivery without revoking consent", async () => {
		const row = seed("test", "accepted");
		await applySesEvent({ ...delivery("bounce"), permanent: false });
		expect(row.status).toBe("failed");
		expect(state.subscribers[0].consent_status).toBe("confirmed");
	});
	it.each(["bounce", "complaint"] as const)(
		"permanent %s suppresses both audiences and cannot be undone",
		async (type) => {
			const row = seed("test", "accepted");
			state.subscribers.push({ ...subscriber(2, "real"), email: row.email });
			await applySesEvent({ ...delivery(type), permanent: true });
			await applySesEvent(delivery("delivery", "2026-10-28T12:02:00.000Z"));
			await applySesEvent(
				subscription(
					{ test: "OPT_IN", real: "OPT_IN" },
					"2026-10-28T12:03:00.000Z",
				),
			);
			expect(row.status).toBe(type === "bounce" ? "bounced" : "complained");
			expect(
				state.subscribers.every(
					(s) =>
						s.consent_status === (type === "bounce" ? "bounced" : "complained"),
				),
			).toBe(true);
		},
	);
	it("processes a negative signal even when a delivery has a newer timestamp", async () => {
		const row = seed("test", "delivered");
		row.event_at = "2026-10-28 12:03:00.000";
		state.subscribers[0].last_event_at = "2026-10-28 12:03:00.000";
		await applySesEvent({ ...delivery("bounce"), permanent: true });
		expect(row.status).toBe("bounced");
		expect(row.event_at).toBe("2026-10-28 12:03:00.000");
		expect(state.subscribers[0].consent_status).toBe("bounced");
	});
	it("negative event wins at an equal timestamp", async () => {
		const row = seed("test", "accepted");
		await applySesEvent(delivery());
		await applySesEvent({ ...delivery("bounce"), permanent: true });
		expect(row.status).toBe("bounced");
	});
	it("orders UTC event strings independently of the process timezone", async () => {
		const previous = process.env.TZ;
		process.env.TZ = "Asia/Jerusalem";
		try {
			const row = seed("test", "delivered");
			row.event_at = "2026-10-28T12:03:00.000000Z";
			await applySesEvent(delivery("send", "2026-10-28T12:02:00.000Z"));
			expect(row.status).toBe("delivered");
			expect(
				mocks.txQueryOne.mock.calls.some((call) =>
					call[1].includes("DATE_FORMAT(r.event_at"),
				),
			).toBe(true);
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});
	it("applies only the explicit subscription topic and ignores older preferences", async () => {
		seed();
		state.subscribers.push({
			...subscriber(2, "real"),
			email: "reader1@example.com",
		});
		await applySesEvent(subscription({ test: "OPT_OUT" }));
		expect(state.subscribers.map((s) => s.consent_status)).toEqual([
			"unsubscribed",
			"confirmed",
		]);
		await applySesEvent(
			subscription({ test: "OPT_IN" }, "2026-10-28T12:00:00.000Z"),
		);
		expect(state.subscribers[0].consent_status).toBe("unsubscribed");
	});
	it("gives optout precedence when topic notifications have identical timestamps", async () => {
		seed();
		await applySesEvent(subscription({ test: "OPT_IN" }));
		await applySesEvent(subscription({ test: "OPT_OUT" }));
		expect(state.subscribers[0].consent_status).toBe("unsubscribed");
		await applySesEvent(subscription({ test: "OPT_IN" }));
		expect(state.subscribers[0].consent_status).toBe("unsubscribed");
	});
	it("global optout updates both audiences but never creates a new subscriber", async () => {
		seed();
		state.subscribers.push({
			...subscriber(2, "real"),
			email: "reader1@example.com",
		});
		await applySesEvent(subscription({}, undefined, true));
		expect(
			state.subscribers.every((s) => s.consent_status === "unsubscribed"),
		).toBe(true);
		await applySesEvent({
			...subscription({}, undefined, true),
			email: "missing@example.com",
		});
		expect(state.subscribers).toHaveLength(2);
	});
	it("does not turn pending legacy records into confirmed via provider create/optin", async () => {
		seed();
		state.subscribers[0].consent_status = "pending";
		state.subscribers[0].consented_at = null;
		await applySesEvent(subscription({ test: "OPT_IN" }));
		expect(state.subscribers[0].consent_status).toBe("pending");
	});
	it("restores only previously consented unsubscribed records via newer explicit optin", async () => {
		seed();
		state.subscribers[0].consent_status = "unsubscribed";
		await applySesEvent(subscription({ test: "OPT_IN" }));
		expect(state.subscribers[0].consent_status).toBe("confirmed");
		state.subscribers[0].consent_status = "unsubscribed";
		state.subscribers[0].consented_at = null;
		await applySesEvent(
			subscription({ test: "OPT_IN" }, "2026-10-28T12:02:00.000Z"),
		);
		expect(state.subscribers[0].consent_status).toBe("unsubscribed");
	});
});

describe("summary and queue loop", () => {
	it.each([
		["deadline", "read"],
		["shutdown", "read"],
		["deadline", "write"],
		["shutdown", "write"],
		["deadline", "sync"],
		["shutdown", "sync"],
	] as const)(
		"bounds the whole sweep on %s during a held DB %s and stops its late continuation",
		async (reason, stage) => {
			const row = seed("real", "sending");
			row.started_at = "2000-01-01 00:00:00.000";
			const gate = deferred<void>();
			const deadline = new AbortController();
			const shutdown = new AbortController();
			vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
			if (stage === "read")
				mocks.query.mockImplementationOnce(async (sql, params) => {
					await gate.promise;
					return read(sql, params);
				});
			if (stage === "write")
				mocks.execute.mockImplementationOnce(async (sql, params) => {
					await gate.promise;
					return write(sql, params);
				});
			if (stage === "sync")
				mocks.txQueryOne.mockImplementationOnce(
					async (_connection, sql, params) => {
						await gate.promise;
						return read(sql, params)[0] ?? null;
					},
				);
			mocks.sqs.mockImplementation(async () => {
				shutdown.abort();
				return {};
			});
			const pending = startEmailWorker(shutdown.signal);
			for (let turn = 0; turn < 16; turn++) await Promise.resolve();
			expect(
				stage === "read"
					? mocks.query
					: stage === "write"
						? mocks.execute
						: mocks.txQueryOne,
			).toHaveBeenCalledOnce();
			(reason === "deadline" ? deadline : shutdown).abort();
			await pending;
			expect(mocks.sqs.mock.calls.map(([command]) => command.kind)).toEqual(
				reason === "deadline" ? ["receive"] : [],
			);
			gate.resolve();
			for (let turn = 0; turn < 16; turn++) await Promise.resolve();
			expect(mocks.query).toHaveBeenCalledOnce();
			expect(mocks.txExecute).not.toHaveBeenCalled();
			expect(mocks.txQuery).not.toHaveBeenCalled();
			expect(mocks.sendOne).not.toHaveBeenCalled();
			expect(mocks.whatsappProcess).not.toHaveBeenCalled();
			expect(mocks.destroy).toHaveBeenCalledOnce();
		},
	);
	it("reads a summary without network requests", async () => {
		expect(await readLatestEmailJob(date)).toBeNull();
		seed();
		expect(await readLatestEmailJob(date)).toMatchObject({
			id: "job-1",
			counts: { queued: 1 },
			status: "queued",
		});
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it("keeps the production job visible when a later test job exists", async () => {
		seed("real", "accepted");
		state.jobs.push({ ...job("test", "delivered"), id: "later-test" });
		expect((await readLatestEmailJob(date))?.id).toBe("later-test");
		expect((await readLatestEmailJob(date, "real"))?.id).toBe("job-1");
		expect((await readLatestEmailJob(date, "test"))?.id).toBe("later-test");
	});
	it("accepts UUIDv7 consistently with the shared API validator", async () => {
		await enqueueBulletinEmail(
			date,
			"12345678-1234-7234-8234-123456789012",
			expected,
		);
		expect(state.jobs).toHaveLength(1);
	});
	it.each([
		"uncertain",
		"sending",
		"queued",
		"failed",
		"bounced",
		"complained",
		"accepted",
		"delivered",
		"suppressed",
	])("aggregates %s correctly", async (status) => {
		seed("test", status);
		const result = await readLatestEmailJob(date);
		expect(result?.status).toBe(
			["bounced", "complained"].includes(status) ? "failed" : status,
		);
	});
	it.each([
		["accepted", "delivered", "accepted"],
		["accepted", "failed", "accepted"],
		["accepted", "bounced", "accepted"],
		["delivered", "suppressed", "delivered"],
		["delivered", "failed", "failed"],
		["uncertain", "queued", "uncertain"],
		["sending", "queued", "sending"],
	])("aggregates mixed %s/%s as %s", async (first, second, status) => {
		const row = seed("test", first);
		state.recipients.push({ ...row, id: 2, status: second });
		expect((await readLatestEmailJob(date))?.status).toBe(status);
	});
	it("exits with no polling when disabled or already aborted", async () => {
		mocks.runtime.mockReturnValueOnce(null);
		await startEmailWorker(new AbortController().signal);
		const c = new AbortController();
		c.abort();
		await startEmailWorker(c.signal);
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it("polls one item, handles safe duplicate work and deletes only after completion", async () => {
		seed("test", "accepted");
		const c = new AbortController();
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind === "receive")
				return {
					Messages: [
						{
							Body: '{"kind":"send","recipientId":1}',
							ReceiptHandle: "receipt",
						},
					],
				};
			c.abort();
			return {};
		});
		await startEmailWorker(c.signal);
		expect(mocks.sqs.mock.calls[0][0].input).toMatchObject({
			WaitTimeSeconds: 20,
			MaxNumberOfMessages: 1,
			VisibilityTimeout: 120,
		});
		expect(mocks.sqs.mock.calls[1][0].kind).toBe("delete");
		expect(mocks.destroy).toHaveBeenCalled();
	});
	it("passes parsed native events to the guarded parser and ACKs applied events", async () => {
		const row = seed("test", "accepted");
		const c = new AbortController();
		const payload = { eventType: "Delivery" };
		mocks.parse.mockReturnValue(delivery());
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind === "receive")
				return {
					Messages: [
						{ Body: JSON.stringify(payload), ReceiptHandle: "receipt" },
					],
				};
			c.abort();
			return {};
		});
		await startEmailWorker(c.signal);
		expect(mocks.parse).toHaveBeenCalledWith(payload, config);
		expect(row.status).toBe("delivered");
		expect(mocks.sqs.mock.calls[1][0].kind).toBe("delete");
	});
	it.each([
		"not-json",
		"{}",
		'{"kind":"send","recipientId":0}',
		'{"kind":"send","recipientId":"1"}',
	])("does not delete invalid or untrusted payload %s", async (body) => {
		const c = new AbortController();
		let count = 0;
		mocks.sqs.mockImplementation(async () => {
			if (count++ === 0)
				return { Messages: [{ Body: body, ReceiptHandle: "receipt" }] };
			c.abort();
			return {};
		});
		await startEmailWorker(c.signal);
		expect(
			mocks.sqs.mock.calls.every((call) => call[0].kind !== "delete"),
		).toBe(true);
	});
	it("backs off on receive failure and stops gracefully on cancellation", async () => {
		const c = new AbortController();
		mocks.sqs.mockRejectedValueOnce(new Error("private provider details"));
		mocks.delay.mockImplementationOnce(async () => {
			c.abort();
		});
		await startEmailWorker(c.signal);
		expect(mocks.delay).toHaveBeenCalledWith(1000, undefined, {
			signal: c.signal,
		});
		expect(mocks.destroy).toHaveBeenCalled();
	});
	it("does not ACK work when persistence fails", async () => {
		seed();
		const c = new AbortController();
		mocks.execute.mockRejectedValue(new Error("db unavailable"));
		mocks.sqs.mockImplementation(async (command) =>
			command.kind === "batch"
				? {
						Successful: command.input.Entries.map((entry: { Id: string }) => ({
							Id: entry.Id,
						})),
					}
				: {
						Messages: [
							{
								Body: '{"kind":"send","recipientId":1}',
								ReceiptHandle: "receipt",
							},
						],
					},
		);
		mocks.delay.mockImplementationOnce(async () => {
			c.abort();
		});
		await startEmailWorker(c.signal);
		expect(
			mocks.sqs.mock.calls.every((call) => call[0].kind !== "delete"),
		).toBe(true);
	});
	it("re-publishes the committed outbox after a partial publication or process crash", async () => {
		mocks.sqs.mockResolvedValueOnce({
			Successful: [{ Id: "1" }],
			Failed: [{ Id: "2" }],
		});
		await expect(enqueueBulletinEmail(date, key, expected)).rejects.toThrow(
			"לתור",
		);
		expect(state.recipients.every((r) => r.status === "queued")).toBe(true);
		mocks.sqs.mockClear();
		const c = new AbortController();
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind === "batch")
				return {
					Successful: command.input.Entries.map((entry: { Id: string }) => ({
						Id: entry.Id,
					})),
				};
			c.abort();
			return {};
		});
		await startEmailWorker(c.signal);
		expect(
			mocks.sqs.mock.calls
				.filter((call) => call[0].kind === "batch")
				.flatMap((call) =>
					call[0].input.Entries.map((entry: { Id: string }) => entry.Id),
				),
		).toEqual(["1", "2"]);
		expect(mocks.sendOne).not.toHaveBeenCalled();
		expect(state.jobs).toHaveLength(1);
	});
	it("bounds each sweep to one hundred queued recipients and excludes every other status", async () => {
		const row = seed();
		state.recipients = Array.from({ length: 101 }, (_, i) => ({
			...row,
			id: i + 1,
		}));
		state.recipients.push(
			{ ...row, id: 200, status: "uncertain" },
			{ ...row, id: 201, status: "sending" },
			{ ...row, id: 202, status: "accepted" },
		);
		const c = new AbortController();
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind === "batch")
				return {
					Successful: command.input.Entries.map((entry: { Id: string }) => ({
						Id: entry.Id,
					})),
				};
			c.abort();
			return {};
		});
		await startEmailWorker(c.signal);
		const ids = mocks.sqs.mock.calls
			.filter((call) => call[0].kind === "batch")
			.flatMap((call) =>
				call[0].input.Entries.map((entry: { Id: string }) => entry.Id),
			);
		expect(ids).toHaveLength(100);
		expect(ids).not.toContain("101");
		expect(ids).not.toContain("200");
	});
	it("reconciles queued rows again after thirty seconds without sending accepted recipients", async () => {
		seed();
		const c = new AbortController();
		let now = 0;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		let batches = 0;
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind === "batch") {
				if (++batches === 2) c.abort();
				return {
					Successful: command.input.Entries.map((entry: { Id: string }) => ({
						Id: entry.Id,
					})),
				};
			}
			now = 30_001;
			return {};
		});
		try {
			await startEmailWorker(c.signal);
			expect(batches).toBe(2);
			expect(mocks.sendOne).not.toHaveBeenCalled();
		} finally {
			vi.restoreAllMocks();
		}
	});
	it("bounds the long poll and propagates shutdown to its combined signal", async () => {
		const c = new AbortController();
		const timeout = vi.spyOn(AbortSignal, "timeout");
		mocks.sqs.mockImplementation(async (_command, options) => {
			c.abort();
			expect(options.abortSignal.aborted).toBe(true);
			return {};
		});
		try {
			await startEmailWorker(c.signal);
			expect(timeout).toHaveBeenCalledWith(35_000);
		} finally {
			timeout.mockRestore();
		}
	});
	it("recovers an expired claim even when its original message has reached the DLQ", async () => {
		const row = seed("real", "sending");
		row.started_at = "2000-01-01 00:00:00.000";
		const token = row.attempt_token;
		const c = new AbortController();
		mocks.sqs.mockImplementation(async () => {
			c.abort();
			return {};
		});
		await startEmailWorker(c.signal);
		expect(row.status).toBe("uncertain");
		expect(row.attempt_token).toBe(token);
		expect(state.jobs[0].status).toBe("uncertain");
		expect(state.channel).toBe("uncertain");
		expect(mocks.sendOne).not.toHaveBeenCalled();
		expect(mocks.sqs.mock.calls.every((call) => call[0].kind !== "batch")).toBe(
			true,
		);
	});
	it("periodic reconciliation leaves a fresh in-flight claim intact", async () => {
		const row = seed("test", "sending");
		row.started_at = new Date().toISOString();
		const c = new AbortController();
		mocks.sqs.mockImplementation(async () => {
			c.abort();
			return {};
		});
		await startEmailWorker(c.signal);
		expect(row.status).toBe("sending");
		expect(mocks.sendOne).not.toHaveBeenCalled();
		expect(mocks.sqs.mock.calls.every((call) => call[0].kind !== "batch")).toBe(
			true,
		);
	});
});

describe("optional WhatsApp dispatch in the existing worker", () => {
	function configureWhatsApp() {
		for (const name of [
			"INSTANCE_ID",
			"API_TOKEN",
			"API_URL",
			"MEDIA_URL",
			"SENDER_PHONE",
			"TEST_GROUP_ID",
			"TEST_PARTICIPANT_DIGEST",
		])
			vi.stubEnv(`BULLETIN_WHATSAPP_${name}`, "fixture-config");
	}

	const whatsappBody = (jobId = key) =>
		`{"kind":"whatsapp.send","jobId":"${jobId}"}`;

	function messages(controller: AbortController, bodies: string[]) {
		let next = 0;
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind !== "receive") return {};
			if (next >= bodies.length) {
				controller.abort();
				return {};
			}
			return {
				Messages: [
					{
						Body: bodies[next],
						ReceiptHandle: `receipt-${next++}`,
					},
				],
			};
		});
	}

	it.each([
		"BULLETIN_WHATSAPP_INSTANCE_ID",
		"BULLETIN_WHATSAPP_API_TOKEN",
		"BULLETIN_WHATSAPP_API_URL",
		"BULLETIN_WHATSAPP_MEDIA_URL",
		"BULLETIN_WHATSAPP_SENDER_PHONE",
		"BULLETIN_WHATSAPP_TEST_GROUP_ID",
		"BULLETIN_WHATSAPP_TEST_PARTICIPANT_DIGEST",
	])(
		"leaves WhatsApp unacknowledged without affecting email when %s is absent",
		async (name) => {
			configureWhatsApp();
			vi.stubEnv(name, " ");
			seed("test", "accepted");
			const controller = new AbortController();
			messages(controller, [whatsappBody(), '{"kind":"send","recipientId":1}']);

			await startEmailWorker(controller.signal);

			expect(mocks.whatsappSweep).not.toHaveBeenCalled();
			expect(mocks.whatsappProcess).not.toHaveBeenCalled();
			expect(
				mocks.sqs.mock.calls
					.filter(([command]) => command.kind === "delete")
					.map(([command]) => command.input.ReceiptHandle),
			).toEqual(["receipt-1"]);
		},
	);

	it("routes mixed jobs and native SES events through one consumer and acknowledges durable WhatsApp completion", async () => {
		configureWhatsApp();
		const row = seed("test", "accepted");
		const controller = new AbortController();
		const native = { eventType: "Delivery" };
		const order: string[] = [];
		mocks.parse.mockReturnValue(delivery());
		mocks.whatsappProcess.mockImplementationOnce(async () => {
			order.push("whatsapp-persisted");
			return true;
		});
		messages(controller, [
			`{"jobId":"${key.toUpperCase()}","kind":"whatsapp.send"}`,
			'{"kind":"send","recipientId":1}',
			'{"eventType":"Delivery"}',
		]);
		const receive = mocks.sqs.getMockImplementation();
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind === "delete") order.push(command.input.ReceiptHandle);
			return receive?.(command);
		});

		await startEmailWorker(controller.signal);

		expect(mocks.whatsappProcess).toHaveBeenCalledExactlyOnceWith(
			key,
			controller.signal,
		);
		expect(mocks.whatsappSweep).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ send: mocks.sqs }),
			config.queueUrl,
			controller.signal,
		);
		expect(mocks.sqsConfig).toHaveBeenCalledOnce();
		expect(mocks.parse).toHaveBeenCalledExactlyOnceWith(native, config);
		expect(row.status).toBe("delivered");
		expect(order).toEqual([
			"whatsapp-persisted",
			"receipt-0",
			"receipt-1",
			"receipt-2",
		]);
		expect(mocks.sendOne).not.toHaveBeenCalled();
	});

	it.each([
		'{"kind":"whatsapp.send"}',
		'{"kind":"whatsapp.send","jobId":1}',
		'{"kind":"whatsapp.send","jobId":"invalid"}',
		`{"kind":"whatsapp.send","jobId":"${key}","groupId":"120363000000000001@g.us"}`,
	])(
		"refuses malformed WhatsApp body %j before dispatch or SES parsing",
		async (body) => {
			configureWhatsApp();
			const controller = new AbortController();
			messages(controller, [body]);

			await startEmailWorker(controller.signal);

			expect(mocks.whatsappProcess).not.toHaveBeenCalled();
			expect(mocks.parse).not.toHaveBeenCalled();
			expect(
				mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
			).toBe(false);
		},
	);

	it("keeps unhandled WhatsApp work for recovery", async () => {
		configureWhatsApp();
		mocks.whatsappProcess.mockResolvedValueOnce(false);
		const controller = new AbortController();
		messages(controller, [whatsappBody()]);

		await startEmailWorker(controller.signal);

		expect(mocks.whatsappProcess).toHaveBeenCalledOnce();
		expect(
			mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
		).toBe(false);
	});

	it("does not acknowledge WhatsApp persistence errors or retry its provider mutation", async () => {
		configureWhatsApp();
		mocks.whatsappProcess.mockRejectedValueOnce(new Error("private details"));
		const controller = new AbortController();
		messages(controller, [whatsappBody()]);
		mocks.delay.mockImplementationOnce(async () => controller.abort());

		await startEmailWorker(controller.signal);

		expect(mocks.whatsappProcess).toHaveBeenCalledOnce();
		expect(
			mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
		).toBe(false);
		expect(mocks.destroy).toHaveBeenCalledOnce();
	});

	it("isolates WhatsApp outbox failure so a native email event still completes", async () => {
		configureWhatsApp();
		const row = seed("test", "accepted");
		const controller = new AbortController();
		mocks.parse.mockReturnValue(delivery());
		mocks.whatsappSweep.mockRejectedValueOnce(new Error("private details"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		messages(controller, ['{"eventType":"Delivery"}']);
		try {
			await startEmailWorker(controller.signal);
			expect(row.status).toBe("delivered");
			expect(log).toHaveBeenCalledExactlyOnceWith(
				"WhatsApp bulletin outbox reconciliation failed",
			);
			expect(
				mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
			).toBe(true);
		} finally {
			log.mockRestore();
		}
	});
});

describe("optional Telegram dispatch in the existing worker", () => {
	function configureTelegram() {
		vi.stubEnv("BULLETIN_TELEGRAM_BOT_TOKEN", "fixture-token");
		vi.stubEnv("BULLETIN_TELEGRAM_BOT_USERNAME", "fixture_bot");
		vi.stubEnv("BULLETIN_TELEGRAM_TEST_CHAT_ID", "-1001");
	}

	const telegramBody = (jobId = key) =>
		`{"kind":"telegram.send","jobId":"${jobId}"}`;

	function messages(controller: AbortController, bodies: string[]) {
		let next = 0;
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind !== "receive") return {};
			if (next >= bodies.length) {
				controller.abort();
				return {};
			}
			return {
				Messages: [
					{
						Body: bodies[next],
						ReceiptHandle: `receipt-${next++}`,
					},
				],
			};
		});
	}

	it.each([
		"BULLETIN_TELEGRAM_BOT_TOKEN",
		"BULLETIN_TELEGRAM_BOT_USERNAME",
		"BULLETIN_TELEGRAM_TEST_CHAT_ID",
	])(
		"leaves Telegram unacknowledged without affecting email when %s is absent",
		async (name) => {
			configureTelegram();
			vi.stubEnv(name, " ");
			seed("test", "accepted");
			const controller = new AbortController();
			messages(controller, [telegramBody(), '{"kind":"send","recipientId":1}']);

			await startEmailWorker(controller.signal);

			expect(mocks.telegramSweep).not.toHaveBeenCalled();
			expect(mocks.telegramProcess).not.toHaveBeenCalled();
			expect(
				mocks.sqs.mock.calls
					.filter(([command]) => command.kind === "delete")
					.map(([command]) => command.input.ReceiptHandle),
			).toEqual(["receipt-1"]);
		},
	);

	it("routes mixed jobs and native SES events through one consumer and acknowledges durable Telegram completion", async () => {
		configureTelegram();
		const row = seed("test", "accepted");
		const controller = new AbortController();
		const native = { eventType: "Delivery" };
		const order: string[] = [];
		mocks.parse.mockReturnValue(delivery());
		mocks.telegramProcess.mockImplementationOnce(async () => {
			order.push("telegram-persisted");
			return true;
		});
		messages(controller, [
			`{"jobId":"${key.toUpperCase()}","kind":"telegram.send"}`,
			'{"kind":"send","recipientId":1}',
			'{"eventType":"Delivery"}',
		]);
		const receive = mocks.sqs.getMockImplementation();
		mocks.sqs.mockImplementation(async (command) => {
			if (command.kind === "delete") order.push(command.input.ReceiptHandle);
			return receive?.(command);
		});

		await startEmailWorker(controller.signal);

		expect(mocks.telegramProcess).toHaveBeenCalledExactlyOnceWith(
			key,
			controller.signal,
		);
		expect(mocks.telegramSweep).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ send: mocks.sqs }),
			config.queueUrl,
			controller.signal,
		);
		expect(mocks.sqsConfig).toHaveBeenCalledOnce();
		expect(mocks.parse).toHaveBeenCalledExactlyOnceWith(native, config);
		expect(row.status).toBe("delivered");
		expect(order).toEqual([
			"telegram-persisted",
			"receipt-0",
			"receipt-1",
			"receipt-2",
		]);
		expect(mocks.sendOne).not.toHaveBeenCalled();
	});

	it.each([
		'{"kind":"telegram.send"}',
		'{"kind":"telegram.send","jobId":1}',
		'{"kind":"telegram.send","jobId":"invalid"}',
		`{"kind":"telegram.send","jobId":"${key}","chatId":"-1001"}`,
	])(
		"refuses malformed Telegram body %j before dispatch or SES parsing",
		async (body) => {
			configureTelegram();
			const controller = new AbortController();
			messages(controller, [body]);

			await startEmailWorker(controller.signal);

			expect(mocks.telegramProcess).not.toHaveBeenCalled();
			expect(mocks.parse).not.toHaveBeenCalled();
			expect(
				mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
			).toBe(false);
		},
	);

	it("keeps unhandled Telegram work for recovery", async () => {
		configureTelegram();
		mocks.telegramProcess.mockResolvedValueOnce(false);
		const controller = new AbortController();
		messages(controller, [telegramBody()]);

		await startEmailWorker(controller.signal);

		expect(mocks.telegramProcess).toHaveBeenCalledOnce();
		expect(
			mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
		).toBe(false);
	});

	it("does not acknowledge Telegram persistence errors or retry its provider mutation", async () => {
		configureTelegram();
		mocks.telegramProcess.mockRejectedValueOnce(new Error("private details"));
		const controller = new AbortController();
		messages(controller, [telegramBody()]);
		mocks.delay.mockImplementationOnce(async () => controller.abort());

		await startEmailWorker(controller.signal);

		expect(mocks.telegramProcess).toHaveBeenCalledOnce();
		expect(
			mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
		).toBe(false);
		expect(mocks.destroy).toHaveBeenCalledOnce();
	});

	it("isolates Telegram outbox failure so a native email event still completes", async () => {
		configureTelegram();
		const row = seed("test", "accepted");
		const controller = new AbortController();
		mocks.parse.mockReturnValue(delivery());
		mocks.telegramSweep.mockRejectedValueOnce(new Error("private details"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		messages(controller, ['{"eventType":"Delivery"}']);
		try {
			await startEmailWorker(controller.signal);
			expect(row.status).toBe("delivered");
			expect(log).toHaveBeenCalledExactlyOnceWith(
				"Telegram bulletin outbox reconciliation failed",
			);
			expect(
				mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
			).toBe(true);
		} finally {
			log.mockRestore();
		}
	});

	it.each(["bulletin.schedule", "bulletin.generate"])(
		"acknowledges %s only after its durable handler completes",
		async (kind) => {
			const controller = new AbortController();
			const body = JSON.stringify({
				kind,
				scheduledAt: "2026-10-29T08:00:00Z",
				...(kind === "bulletin.generate" ? { date: "2026-10-29" } : {}),
			});
			const gate = deferred<boolean>();
			mocks.scheduledProcess.mockReturnValueOnce(gate.promise);
			messages(controller, [body]);
			const running = startEmailWorker(controller.signal);
			await vi.waitFor(() =>
				expect(mocks.scheduledProcess).toHaveBeenCalledOnce(),
			);
			expect(
				mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
			).toBe(false);
			expect(mocks.scheduledProcess).toHaveBeenCalledWith(
				JSON.parse(body),
				controller.signal,
				{ client: expect.anything(), url: expect.stringContaining("sqs.") },
			);
			gate.resolve(true);
			await running;
			expect(
				mocks.sqs.mock.calls
					.filter(([command]) => command.kind === "delete")
					.map(([command]) => command.input.ReceiptHandle),
			).toEqual(["receipt-0"]);
			expect(mocks.parse).not.toHaveBeenCalled();
		},
	);
	it("retains a rejected scheduled message and continues native SES processing", async () => {
		const row = seed("test", "accepted");
		mocks.parse.mockReturnValue(delivery());
		mocks.scheduledProcess.mockResolvedValueOnce(false);
		const controller = new AbortController();
		messages(controller, [
			'{"kind":"bulletin.schedule","scheduledAt":"invalid"}',
			'{"eventType":"Delivery"}',
		]);
		await startEmailWorker(controller.signal);
		expect(row.status).toBe("delivered");
		expect(
			mocks.sqs.mock.calls
				.filter(([command]) => command.kind === "delete")
				.map(([command]) => command.input.ReceiptHandle),
		).toEqual(["receipt-1"]);
	});
	it("retains a failed scheduled attempt rather than acknowledging partial fan-out", async () => {
		const controller = new AbortController();
		mocks.scheduledProcess.mockRejectedValueOnce(
			new Error("sanitized scheduling failure"),
		);
		messages(controller, [
			'{"kind":"bulletin.schedule","scheduledAt":"2026-10-29T08:00:00Z"}',
		]);
		mocks.delay.mockImplementationOnce(async () => controller.abort());
		await startEmailWorker(controller.signal);
		expect(
			mocks.sqs.mock.calls.some(([command]) => command.kind === "delete"),
		).toBe(false);
		expect(mocks.destroy).toHaveBeenCalledOnce();
	});
	it("dispatches both configured channels and native email through one queue without crossing jobs", async () => {
		configureTelegram();
		for (const name of [
			"INSTANCE_ID",
			"API_TOKEN",
			"API_URL",
			"MEDIA_URL",
			"SENDER_PHONE",
			"TEST_GROUP_ID",
			"TEST_PARTICIPANT_DIGEST",
		])
			vi.stubEnv(`BULLETIN_WHATSAPP_${name}`, "fixture-config");
		const row = seed("test", "accepted");
		mocks.parse.mockReturnValue(delivery());
		const controller = new AbortController();
		messages(controller, [
			telegramBody(),
			`{"kind":"whatsapp.send","jobId":"${key}"}`,
			'{"kind":"send","recipientId":1}',
			'{"eventType":"Delivery"}',
		]);
		await startEmailWorker(controller.signal);
		expect(mocks.telegramProcess).toHaveBeenCalledExactlyOnceWith(
			key,
			controller.signal,
		);
		expect(mocks.whatsappProcess).toHaveBeenCalledExactlyOnceWith(
			key,
			controller.signal,
		);
		expect(mocks.telegramSweep).toHaveBeenCalledOnce();
		expect(mocks.whatsappSweep).toHaveBeenCalledOnce();
		expect(row.status).toBe("delivered");
		expect(
			mocks.sqs.mock.calls
				.filter(([command]) => command.kind === "delete")
				.map(([command]) => command.input.ReceiptHandle),
		).toEqual(["receipt-0", "receipt-1", "receipt-2", "receipt-3"]);
	});
	it("stops quietly if shutdown accompanies a Telegram sweep failure", async () => {
		configureTelegram();
		const controller = new AbortController();
		mocks.telegramSweep.mockImplementationOnce(async () => {
			controller.abort();
			throw new Error("private teardown failure");
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		await startEmailWorker(controller.signal);
		expect(log).not.toHaveBeenCalled();
		expect(mocks.sqs).not.toHaveBeenCalled();
		expect(mocks.whatsappSweep).not.toHaveBeenCalled();
		expect(mocks.destroy).toHaveBeenCalledOnce();
	});
});
