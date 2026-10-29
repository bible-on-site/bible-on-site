import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../util/deferred";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
	txQueryOne: vi.fn(),
	txExecute: vi.fn(),
	runtime: vi.fn(),
	settings: vi.fn(),
	targets: vi.fn(),
	reserve: vi.fn(),
	prepared: vi.fn(),
	send: vi.fn(),
	sqs: vi.fn(),
	destroy: vi.fn(),
	sqsConfig: vi.fn(),
}));
vi.mock("~/server/db", () => mocks);
vi.mock("~/server/daily-bulletins.server", () => ({
	readPreparedBulletin: mocks.prepared,
}));
vi.mock("~/server/telegram-client.server", () => {
	class TelegramError extends Error {
		constructor(public outcome: "failed" | "uncertain") {
			super("generic");
		}
	}
	class TelegramSuppressedError extends TelegramError {
		constructor() {
			super("failed");
		}
	}
	return {
		TelegramError,
		TelegramSuppressedError,
		TelegramClient: class {
			sendDocument = mocks.send;
		},
	};
});
vi.mock("~/server/telegram-settings.server", async () => {
	const { TelegramSuppressedError } = await import(
		"~/server/telegram-client.server"
	);
	return {
		loadTelegramRuntime: mocks.runtime,
		readTelegramSettings: mocks.settings,
		verifyTelegramTargets: mocks.targets,
		reserveTelegramSendSlot: mocks.reserve,
		settingsFromRow(row: { audience: string; revision: number } | null) {
			if (!row) throw new Error("missing");
			return { audience: row.audience, revision: Number(row.revision) };
		},
		targetChatId(runtime: typeof config, audience: string) {
			const id = audience === "test" ? runtime.testChatId : runtime.realChatId;
			if (!id) throw new TelegramSuppressedError();
			return id;
		},
		targetView(target: unknown) {
			return target;
		},
		telegramReadiness(
			targets: { test: unknown; real: unknown },
			audience: "test" | "real",
		) {
			return {
				configured: true,
				canSend: !!targets[audience],
				canUseReal: !!targets.real,
				blockers: [],
			};
		},
	};
});
vi.mock("@aws-sdk/client-sqs", () => ({
	SQSClient: class {
		constructor(config: unknown) {
			mocks.sqsConfig(config);
		}
		send = mocks.sqs;
		destroy = mocks.destroy;
	},
	SendMessageBatchCommand: class {
		constructor(
			public input: {
				QueueUrl: string;
				Entries: { Id: string; MessageBody: string }[];
			},
		) {}
	},
}));

import type { SQSClient } from "@aws-sdk/client-sqs";
import type {
	TelegramAudience,
	TelegramJobStatus,
} from "~/lib/bulletin-telegram";
import {
	TelegramError,
	TelegramSuppressedError,
} from "~/server/telegram-client.server";
import {
	enqueueBulletinTelegram,
	getBulletinTelegramState,
	processTelegramJob,
	reconcileTelegramOutbox,
	setTelegramAudience,
} from "~/server/telegram-delivery.server";

const date = "2026-10-28";
const key = "12345678-1234-7234-8234-123456789012";
const key2 = "12345678-1234-7234-8234-123456789013";
const config = {
	token: "123456:abcdefghijklmnopqrstuvwxyz_0123456789",
	expectedBotUsername: "ExampleBot",
	testChatId: -100111,
	realChatId: -100222,
	queueUrl: "https://sqs.il-central-1.amazonaws.com/123456789012/bulletin",
	region: "il-central-1",
};
const pdf = Buffer.from("%PDF-1.7\nimmutable fixture\n%%EOF");
const prepared = {
	pdfBase64: pdf.toString("base64"),
	filename: "daily.pdf",
	source: "תהלים א",
	input: { perekId: 502, hebrewDate: "יז חשוון תשפז" },
};
interface Job {
	id: string;
	bulletin_date: string;
	audience: TelegramAudience;
	settings_revision: number;
	idempotency_key: string;
	bot_id: number;
	target_chat_id: number;
	pdf_sha256: string;
	filename: string;
	caption: string;
	status: TelegramJobStatus;
	attempt_token: string | null;
	stale: boolean;
	provider_message_id: number | null;
	provider_file_id: string | null;
	created_at: string;
	sent_at: string | null;
	last_error: string | null;
}
let state: {
	settings: { audience: TelegramAudience; revision: number };
	jobs: Job[];
	channel: string;
	channelAttempts: number;
	channelHistory: {
		provider_message_id: string | null;
		sent_at: string | null;
		lease_token: string | null;
		lease_until: string | null;
	};
	writes: { sql: string; params: unknown[] }[];
};
let transactionTail: Promise<void>;
let failAccepted = false;
let failOutcome = false;
async function flush() {
	for (let index = 0; index < 30; index++) await Promise.resolve();
}
function configureRealSlot() {
	vi.stubEnv("BULLETIN_TELEGRAM_BOT_TOKEN", config.token);
	vi.stubEnv("BULLETIN_TELEGRAM_BOT_USERNAME", config.expectedBotUsername);
	vi.stubEnv("BULLETIN_TELEGRAM_TEST_CHAT_ID", String(config.testChatId));
	vi.stubEnv("BULLETIN_TELEGRAM_REAL_CHAT_ID", String(config.realChatId));
	vi.stubEnv("BULLETIN_EMAIL_QUEUE_URL", config.queueUrl);
	vi.stubEnv("BULLETIN_SES_ACCOUNT_ID", "123456789012");
	vi.stubEnv("BULLETIN_SES_REGION", config.region);
}
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllEnvs();
});
const request = (
	requestKey = key,
	audience: TelegramAudience = "test",
	revision = 0,
) => ({
	date,
	requestKey,
	expectedAudience: audience,
	expectedRevision: revision,
});
function fixture(
	audience: TelegramAudience = "test",
	status: TelegramJobStatus = "queued",
): Job {
	return {
		id: key,
		bulletin_date: date,
		audience,
		settings_revision: 0,
		idempotency_key: audience === "test" ? key : "production",
		bot_id: 123456,
		target_chat_id: audience === "test" ? -100111 : -100222,
		pdf_sha256: createHash("sha256").update(pdf).digest("hex"),
		filename: prepared.filename,
		caption: "frozen caption",
		status,
		attempt_token: null,
		stale: false,
		provider_message_id: null,
		provider_file_id: null,
		created_at: `${date}T12:00:00Z`,
		sent_at: null,
		last_error: null,
	};
}
function select(sql: string, params: unknown[] = []): unknown {
	if (sql.includes("AS wait_ms")) return { wait_ms: 0 };
	if (sql.includes("LEFT JOIN tanah_daily_bulletin_delivery")) {
		const job = state.jobs.find((j) => j.id === params[0]);
		if (
			!job ||
			job.audience !== state.settings.audience ||
			job.settings_revision !== state.settings.revision
		)
			return null;
		if (
			job.audience === "real" &&
			(state.channel !== "sending" ||
				state.channelAttempts !== 1 ||
				state.channelHistory.provider_message_id !== `telegram-job:${job.id}` ||
				state.channelHistory.lease_token !== job.attempt_token ||
				state.channelHistory.sent_at !== null ||
				state.channelHistory.lease_until !== null)
		)
			return null;
		return structuredClone(job);
	}
	if (sql.includes("telegram_settings")) return structuredClone(state.settings);
	if (sql.includes("FROM tanah_daily_bulletin_delivery"))
		return {
			status: state.channel,
			attempt_count: state.channelAttempts,
			...state.channelHistory,
		};
	if (sql.includes("idempotency_key = ?"))
		return structuredClone(
			state.jobs.find(
				(j) =>
					j.bulletin_date === params[0] &&
					j.audience === params[1] &&
					j.idempotency_key === params[2],
			) ?? null,
		);
	if (sql.includes("status IN ('queued','sending','uncertain')"))
		return structuredClone(
			state.jobs.find(
				(j) =>
					(!params.length ||
						(j.bulletin_date === params[0] && j.audience === params[1])) &&
					["queued", "sending", "uncertain"].includes(j.status),
			) ?? null,
		);
	if (sql.includes("ORDER BY created_at DESC"))
		return structuredClone(
			state.jobs
				.filter(
					(j) => j.bulletin_date === params[0] && j.audience === params[1],
				)
				.at(-1) ?? null,
		);
	if (sql.includes("WHERE id = ?"))
		return structuredClone(state.jobs.find((j) => j.id === params[0]) ?? null);
	throw new Error(`Unexpected read: ${sql}`);
}
function write(sql: string, params: unknown[] = []) {
	state.writes.push({ sql, params });
	if (sql.startsWith("INSERT INTO tanah_daily_bulletin_telegram_job")) {
		const row = fixture(params[2] as TelegramAudience);
		Object.assign(row, {
			id: params[0],
			bulletin_date: params[1],
			audience: params[2],
			idempotency_key: params[3],
			settings_revision: params[4],
			bot_id: params[5],
			target_chat_id: params[6],
			pdf_sha256: params[7],
			filename: params[8],
			caption: params[9],
		});
		state.jobs.push(row);
		return { affectedRows: 1 };
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_telegram_settings")) {
		if (sql.includes("SET next_send_at")) return { affectedRows: 1 };
		state.settings = {
			audience: params[0] as TelegramAudience,
			revision: state.settings.revision + 1,
		};
		return { affectedRows: 1 };
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_delivery")) {
		if (sql.includes("SET attempt_count = 1")) {
			if (
				state.channel !== "sending" ||
				state.channelAttempts !== 0 ||
				state.channelHistory.provider_message_id !== params[2] ||
				state.channelHistory.sent_at !== null ||
				state.channelHistory.lease_token !== null ||
				state.channelHistory.lease_until !== null
			)
				return { affectedRows: 0 };
			state.channelAttempts = 1;
			state.channelHistory.lease_token = params[0] as string;
			return { affectedRows: 1 };
		}
		if (sql.includes("SET status = 'sending'")) {
			state.channel = "sending";
			state.channelHistory.provider_message_id = params[0] as string;
			return { affectedRows: 1 };
		}
		if (sql.includes("provider_message_id IN")) {
			if (
				![params[5], params[6]].includes(
					state.channelHistory.provider_message_id,
				) ||
				(state.channel !== "sending" && state.channel !== params[7]) ||
				!(
					(state.channelAttempts === 0 &&
						state.channelHistory.lease_token === null) ||
					(state.channelAttempts === 1 &&
						state.channelHistory.lease_token === params[8])
				) ||
				state.channelHistory.lease_until !== null ||
				(state.channelHistory.sent_at !== null &&
					!(
						state.channel === "sent" &&
						params[9] === "sent" &&
						state.channelHistory.provider_message_id === params[10]
					))
			)
				return { affectedRows: 0 };
			state.channelHistory.provider_message_id = params[1] as string;
			if (params[0] === "sent")
				state.channelHistory.sent_at ??= `${date}T12:01:00.000Z`;
			state.channel = params[0] as string;
			return { affectedRows: 1 };
		}
		state.channel = params[0] as string;
		state.channelAttempts = Number(params[4]);
		return { affectedRows: 1 };
	}
	if (sql.includes("SET status = 'sending'")) {
		const row = state.jobs.find(
			(j) =>
				j.id === params[1] &&
				j.status === "queued" &&
				j.attempt_token === null &&
				j.provider_message_id === null &&
				j.provider_file_id === null &&
				j.sent_at === null,
		);
		if (!row) return { affectedRows: 0 };
		row.status = "sending";
		row.attempt_token = params[0] as string;
		return { affectedRows: 1 };
	}
	if (sql.includes("SET status = 'uncertain'")) {
		const row = state.jobs.find(
			(j) =>
				j.id === params[1] &&
				(sql.includes("status = 'queued'")
					? j.status === "queued" &&
						(j.attempt_token !== null ||
							j.provider_message_id !== null ||
							j.provider_file_id !== null ||
							j.sent_at !== null)
					: j.status === "sending" && j.stale),
		);
		if (!row) return { affectedRows: 0 };
		row.status = "uncertain";
		row.last_error = params[0] as string;
		return { affectedRows: 1 };
	}
	if (sql.includes("SET status = 'sent'")) {
		if (failAccepted) throw new Error("database unavailable after accepted");
		const row = state.jobs.find(
			(j) =>
				j.id === params[2] &&
				j.status === "sending" &&
				j.attempt_token === params[3],
		);
		if (!row) return { affectedRows: 0 };
		Object.assign(row, {
			status: "sent",
			provider_message_id: params[0],
			provider_file_id: params[1],
			sent_at: `${date}T12:01:00.000Z`,
			last_error: null,
		});
		return { affectedRows: 1 };
	}
	if (sql.includes("SET status = ?")) {
		if (failOutcome) throw new Error("database unavailable");
		const row = state.jobs.find(
			(j) =>
				j.id === params[2] &&
				j.status === "sending" &&
				j.attempt_token === params[3],
		);
		if (!row) return { affectedRows: 0 };
		row.status = params[0] as TelegramJobStatus;
		row.last_error = params[1] as string;
		return { affectedRows: 1 };
	}
	throw new Error(`Unexpected write: ${sql}`);
}
beforeEach(() => {
	vi.clearAllMocks();
	failAccepted = false;
	failOutcome = false;
	transactionTail = Promise.resolve();
	state = {
		settings: { audience: "test", revision: 0 },
		jobs: [],
		channel: "pending",
		channelAttempts: 0,
		channelHistory: {
			provider_message_id: null,
			sent_at: null,
			lease_token: null,
			lease_until: null,
		},
		writes: [],
	};
	mocks.runtime.mockReturnValue(config);
	mocks.settings.mockImplementation(async () =>
		structuredClone(state.settings),
	);
	mocks.targets.mockResolvedValue({
		test: { botId: 123456, chatId: -100111, title: "Private", username: null },
		real: {
			botId: 123456,
			chatId: -100222,
			title: "Public",
			username: "alhaperek",
		},
	});
	mocks.prepared.mockResolvedValue(prepared);
	mocks.reserve.mockImplementation(async (id, token, signal?: AbortSignal) => {
		signal?.throwIfAborted();
		const job = state.jobs.find((j) => j.id === id);
		if (job?.audience === "real") {
			if (
				state.channel !== "sending" ||
				state.channelHistory.provider_message_id !== `telegram-job:${id}` ||
				state.channelAttempts !== 0 ||
				state.channelHistory.sent_at !== null ||
				state.channelHistory.lease_token !== null ||
				state.channelHistory.lease_until !== null
			)
				throw new TelegramSuppressedError();
			state.channelAttempts = 1;
			state.channelHistory.lease_token = token;
		}
	});
	mocks.send.mockImplementation(async (input) => {
		await input.beforeSend();
		return { messageId: 10, fileId: "file-1" };
	});
	mocks.sqs.mockImplementation(async (command) => ({
		Successful: command.input.Entries.map(({ Id }: { Id: string }) => ({ Id })),
	}));
	mocks.queryOne.mockImplementation(async (sql, params) => select(sql, params));
	mocks.txQueryOne.mockImplementation(async (_unused, sql, params) =>
		select(sql, params),
	);
	mocks.execute.mockImplementation(async (sql, params) => write(sql, params));
	mocks.txExecute.mockImplementation(async (_unused, sql, params) =>
		write(sql, params),
	);
	mocks.query.mockImplementation(async (sql, params = []) =>
		state.jobs
			.filter((j) =>
				sql.includes("status = 'sending'")
					? j.status === "sending" && j.stale
					: j.status === "queued" && (!params.length || j.id === params[0]),
			)
			.slice(0, 100)
			.map((j) => ({ id: j.id })),
	);
	mocks.transaction.mockImplementation(async (callback) => {
		const previous = transactionTail;
		let unlock = () => {};
		transactionTail = new Promise((resolve) => {
			unlock = resolve;
		});
		await previous;
		const snapshot = structuredClone(state);
		try {
			return await callback({});
		} catch (error) {
			state = snapshot;
			throw error;
		} finally {
			unlock();
		}
	});
});

describe("Telegram enqueue and UI state", () => {
	it("keeps the worker disabled without configuration and makes no audit or provider query", async () => {
		mocks.runtime.mockReturnValue(null);
		expect(await processTelegramJob(key)).toBe(false);
		await reconcileTelegramOutbox(
			{ send: mocks.sqs } as unknown as SQSClient,
			config.queueUrl,
		);
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.queryOne).not.toHaveBeenCalled();
		expect(mocks.targets).not.toHaveBeenCalled();
	});
	it("keeps invalid configuration and database errors generic", async () => {
		mocks.runtime.mockImplementation(() => {
			throw new Error(config.token);
		});
		expect(JSON.stringify(await getBulletinTelegramState(date))).not.toContain(
			config.token,
		);
		mocks.runtime.mockReturnValue(config);
		mocks.settings.mockRejectedValue(new Error(config.token));
		await expect(getBulletinTelegramState(date)).rejects.toThrow(
			"לא ניתן לקרוא",
		);
	});
	it.each(["missing", "invalid"])(
		"preserves persisted REAL mode and its job when provider config is %s",
		async (kind) => {
			state.settings = { audience: "real", revision: 8 };
			state.jobs.push(fixture("real", "sent"));
			if (kind === "missing") mocks.runtime.mockReturnValue(null);
			else
				mocks.runtime.mockImplementation(() => {
					throw new Error(config.token);
				});
			const result = await getBulletinTelegramState(date);
			expect(result.settings).toEqual({ audience: "real", revision: 8 });
			expect(result.job?.audience).toBe("real");
			expect(result.job?.status).toBe("sent");
			expect(result.readiness.canSend).toBe(false);
			expect(mocks.targets).not.toHaveBeenCalled();
		},
	);
	it("allows disabling REAL to TEST without a token or provider request", async () => {
		state.settings = { audience: "real", revision: 8 };
		mocks.runtime.mockReturnValue(null);
		expect(
			await setTelegramAudience({
				audience: "test",
				expectedRevision: 8,
				confirmReal: false,
			}),
		).toEqual({ audience: "test", revision: 9 });
		expect(mocks.runtime).not.toHaveBeenCalled();
		expect(mocks.targets).not.toHaveBeenCalled();
	});
	it("freezes the saved PDF, metadata and numeric target before publishing a token-free message", async () => {
		const job = await enqueueBulletinTelegram(request());
		expect(job.status).toBe("queued");
		expect(state.jobs[0]).toMatchObject({
			pdf_sha256: createHash("sha256").update(pdf).digest("hex"),
			bot_id: 123456,
			target_chat_id: -100111,
			filename: "daily.pdf",
		});
		expect(state.jobs[0].caption).toContain("https://xn--febl3a.co.il/929/502");
		expect(
			JSON.parse(mocks.sqs.mock.calls[0][0].input.Entries[0].MessageBody),
		).toEqual({ kind: "telegram.send", jobId: job.id });
		expect(JSON.stringify(mocks.sqs.mock.calls)).not.toContain(config.token);
		expect(state.channel).toBe("pending");
	});
	it("serializes concurrent identical requests to one durable job", async () => {
		const [one, two] = await Promise.all([
			enqueueBulletinTelegram(request()),
			enqueueBulletinTelegram(request()),
		]);
		expect(one.id).toBe(two.id);
		expect(state.jobs).toHaveLength(1);
	});
	it.each(["queued", "sending", "uncertain"] as const)(
		"rejects a fresh key while existing test is %s",
		async (status) => {
			state.jobs.push(fixture("test", status));
			await expect(enqueueBulletinTelegram(request(key2))).rejects.toThrow();
			expect(state.jobs).toHaveLength(1);
		},
	);
	it.each(["sent", "failed", "uncertain", "suppressed"] as const)(
		"returns existing %s without provider lookup or republishing",
		async (status) => {
			state.jobs.push(fixture("test", status));
			expect((await enqueueBulletinTelegram(request())).status).toBe(status);
			expect(mocks.targets).not.toHaveBeenCalled();
			expect(mocks.sqs).not.toHaveBeenCalled();
		},
	);
	it("refuses stale audience/revision before network or job writes", async () => {
		state.settings = { audience: "real", revision: 1 };
		await expect(enqueueBulletinTelegram(request())).rejects.toThrow();
		expect(mocks.targets).not.toHaveBeenCalled();
		expect(state.jobs).toHaveLength(0);
	});
	it("never prepares implicitly and refuses a missing or malformed PDF", async () => {
		mocks.prepared.mockResolvedValueOnce(null);
		await expect(enqueueBulletinTelegram(request())).rejects.toThrow(
			"יש להכין",
		);
		mocks.prepared.mockResolvedValueOnce({
			...prepared,
			pdfBase64: Buffer.from("not pdf").toString("base64"),
		});
		await expect(enqueueBulletinTelegram(request())).rejects.toThrow();
		expect(state.jobs).toHaveLength(0);
	});
	it("real mode uses one fixed daily key and refuses legacy attempts", async () => {
		state.settings.audience = "real";
		const first = await enqueueBulletinTelegram(request(key, "real"));
		expect((await enqueueBulletinTelegram(request(key2, "real"))).id).toBe(
			first.id,
		);
		expect(state.jobs[0].idempotency_key).toBe("production");
		state.jobs = [];
		state.channel = "sent";
		await expect(enqueueBulletinTelegram(request(key, "real"))).rejects.toThrow(
			"ניסיון",
		);
	});
	it.each([
		"provider_message_id",
		"sent_at",
		"lease_token",
		"lease_until",
	] as const)(
		"blocks legacy %s even when status and attempts were manually reset",
		async (field) => {
			state.settings.audience = "real";
			state.channelHistory[field] = "prior-history";
			await expect(
				enqueueBulletinTelegram(request(key, "real")),
			).rejects.toThrow("ניסיון");
			expect(state.jobs).toHaveLength(0);
			expect(mocks.sqs).not.toHaveBeenCalled();
		},
	);
	it("test enqueue ignores and preserves all production channel history", async () => {
		state.channel = "sent";
		state.channelAttempts = 3;
		state.channelHistory = {
			provider_message_id: "prior",
			sent_at: "prior",
			lease_token: "prior",
			lease_until: "prior",
		};
		const before = structuredClone(state.channelHistory);
		await enqueueBulletinTelegram(request());
		expect(state.channel).toBe("sent");
		expect(state.channelAttempts).toBe(3);
		expect(state.channelHistory).toEqual(before);
	});
	it("reads latest job for the persisted audience even if a newer test exists", async () => {
		state.settings.audience = "real";
		const real = fixture("real", "sent");
		const test = { ...fixture("test", "failed"), id: key2 };
		state.jobs = [real, test];
		expect((await getBulletinTelegramState(date)).job?.audience).toBe("real");
	});
	it("requires explicit real confirmation, current revision and no active job", async () => {
		await expect(
			setTelegramAudience({
				audience: "real",
				expectedRevision: 0,
				confirmReal: false,
			}),
		).rejects.toThrow("אישור");
		state.jobs.push(fixture());
		await expect(
			setTelegramAudience({
				audience: "real",
				expectedRevision: 0,
				confirmReal: true,
			}),
		).rejects.toThrow("פעיל");
		state.jobs = [];
		expect(
			await setTelegramAudience({
				audience: "real",
				expectedRevision: 0,
				confirmReal: true,
			}),
		).toEqual({ audience: "real", revision: 1 });
		await expect(
			setTelegramAudience({
				audience: "test",
				expectedRevision: 0,
				confirmReal: false,
			}),
		).rejects.toThrow();
	});
});

describe("Telegram durable attempt and recovery", () => {
	it("runs the real final reservation before ACK without a premature audit attempt", async () => {
		configureRealSlot();
		const actual = await vi.importActual<
			typeof import("~/server/telegram-settings.server")
		>("~/server/telegram-settings.server");
		mocks.reserve.mockImplementation(actual.reserveTelegramSendSlot);
		state.settings.audience = "real";
		const job = await enqueueBulletinTelegram(request(key, "real"));
		expect(state.channelAttempts).toBe(0);
		expect(state.channelHistory.lease_token).toBeNull();
		await processTelegramJob(job.id);
		expect(state.jobs[0].status).toBe("sent");
		expect(state.channel).toBe("sent");
		expect(state.channelAttempts).toBe(1);
		expect(state.channelHistory).toMatchObject({
			provider_message_id: "telegram:-100222:10",
			lease_token: state.jobs[0].attempt_token,
		});
		expect(mocks.send).toHaveBeenCalledOnce();
		await processTelegramJob(job.id);
		expect(mocks.send).toHaveBeenCalledOnce();
	});
	it.each(["status", "attempt", "provider", "sent", "lease", "until"])(
		"preserves an external legacy %s change with the same reserved job",
		async (field) => {
			configureRealSlot();
			const actual = await vi.importActual<
				typeof import("~/server/telegram-settings.server")
			>("~/server/telegram-settings.server");
			mocks.reserve.mockImplementation(actual.reserveTelegramSendSlot);
			state.settings.audience = "real";
			const job = await enqueueBulletinTelegram(request(key, "real"));
			if (field === "status") state.channel = "sent";
			if (field === "attempt") state.channelAttempts = 1;
			if (field === "provider")
				state.channelHistory.provider_message_id = "external-provider-message";
			if (field === "sent") state.channelHistory.sent_at = "external-sent-time";
			if (field === "lease")
				state.channelHistory.lease_token = "external-lease";
			if (field === "until")
				state.channelHistory.lease_until = "external-lease-until";
			const before = structuredClone({
				channel: state.channel,
				count: state.channelAttempts,
				history: state.channelHistory,
			});
			let uploads = 0;
			mocks.send.mockImplementation(async (input) => {
				await input.beforeSend();
				uploads++;
				return { messageId: 10, fileId: "file" };
			});
			await processTelegramJob(job.id);
			expect(uploads).toBe(0);
			expect(state.jobs[0].status).toBe("suppressed");
			expect({
				channel: state.channel,
				count: state.channelAttempts,
				history: state.channelHistory,
			}).toEqual(before);
		},
	);
	it.each([
		"attempt_token",
		"provider_message_id",
		"provider_file_id",
		"sent_at",
	] as const)(
		"never reuploads a queued row retaining prior %s",
		async (field) => {
			const job = fixture();
			Object.assign(job, {
				[field]: field === "provider_message_id" ? 12 : "retained-history",
			});
			state.jobs.push(job);
			await processTelegramJob(job.id);
			expect(job.status).toBe("uncertain");
			expect(mocks.prepared).not.toHaveBeenCalled();
			expect(mocks.send).not.toHaveBeenCalled();
		},
	);
	it.each(["read", "claim", "prepared", "reservation"])(
		"shutdown during %s cannot start a new provider upload or reset a durable claim",
		async (stage) => {
			const shutdown = new AbortController();
			state.jobs.push(fixture());
			if (stage === "read")
				mocks.queryOne.mockImplementationOnce(async (sql, params) => {
					const result = select(sql, params);
					shutdown.abort();
					return result;
				});
			if (stage === "claim")
				mocks.execute.mockImplementationOnce(async (sql, params) => {
					const result = write(sql, params);
					shutdown.abort();
					return result;
				});
			if (stage === "prepared")
				mocks.prepared.mockImplementationOnce(async () => {
					shutdown.abort();
					return prepared;
				});
			if (stage === "reservation")
				mocks.reserve.mockImplementationOnce(async () => {
					shutdown.abort();
				});
			let uploads = 0;
			mocks.send.mockImplementation(async (input) => {
				await input.beforeSend();
				uploads++;
				return { messageId: 10, fileId: "file" };
			});
			expect(await processTelegramJob(key, shutdown.signal)).toBe(false);
			expect(uploads).toBe(0);
			expect(state.jobs[0].status).toBe(
				stage === "read" ? "queued" : "sending",
			);
			if (stage !== "read") expect(state.jobs[0].attempt_token).not.toBeNull();
		},
	);
	it("allows an upload already issued before shutdown to drain and persist its acknowledgement", async () => {
		const shutdown = new AbortController();
		state.jobs.push(fixture());
		mocks.send.mockImplementation(async (input) => {
			await input.beforeSend();
			shutdown.abort();
			return { messageId: 10, fileId: "file" };
		});
		expect(await processTelegramJob(key, shutdown.signal)).toBe(true);
		expect(state.jobs[0].status).toBe("sent");
		expect(state.jobs[0].provider_message_id).toBe(10);
	});
	it("an already stopped process job performs no runtime, database or provider work", async () => {
		const shutdown = new AbortController();
		shutdown.abort();
		expect(await processTelegramJob(key, shutdown.signal)).toBe(false);
		expect(mocks.runtime).not.toHaveBeenCalled();
		expect(mocks.queryOne).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("two simultaneous queue deliveries perform one provider POST", async () => {
		state.jobs.push(fixture());
		await Promise.all([processTelegramJob(key), processTelegramJob(key)]);
		expect(mocks.send).toHaveBeenCalledTimes(1);
		expect(state.jobs[0].status).toBe("sent");
		expect(state.jobs[0].provider_message_id).toBe(10);
		expect(mocks.reserve).toHaveBeenCalledTimes(1);
		expect(state.channel).toBe("pending");
	});
	it("passes exact immutable PDF bytes and frozen caption to the client", async () => {
		state.jobs.push(fixture());
		await processTelegramJob(key);
		expect(mocks.send.mock.calls[0][0]).toMatchObject({
			pdf,
			caption: "frozen caption",
			botId: 123456,
			chatId: -100111,
			filename: "daily.pdf",
		});
	});
	it.each(["sent", "failed", "uncertain", "suppressed"] as const)(
		"never repeats terminal %s jobs",
		async (status) => {
			state.jobs.push(fixture("test", status));
			expect(await processTelegramJob(key)).toBe(true);
			expect(mocks.send).not.toHaveBeenCalled();
		},
	);
	it("suppresses changed PDF/filename/target and final mode before posting", async () => {
		state.jobs.push(fixture());
		mocks.prepared.mockResolvedValue({
			...prepared,
			filename: "different.pdf",
		});
		await processTelegramJob(key);
		expect(state.jobs[0].status).toBe("suppressed");
		expect(mocks.send).not.toHaveBeenCalled();
		state.jobs = [fixture()];
		mocks.prepared.mockResolvedValue(prepared);
		mocks.reserve.mockRejectedValue(new TelegramSuppressedError());
		await processTelegramJob(key);
		expect(state.jobs[0].status).toBe("suppressed");
	});
	it.each(["failed", "uncertain"] as const)(
		"persists typed provider %s with no retry or raw error",
		async (outcome) => {
			state.jobs.push(fixture());
			mocks.send.mockRejectedValue(new TelegramError(outcome));
			await processTelegramJob(key);
			await processTelegramJob(key);
			expect(state.jobs[0].status).toBe(outcome);
			expect(mocks.send).toHaveBeenCalledTimes(1);
			expect(state.jobs[0].last_error).not.toContain(config.token);
		},
	);
	it("unknown error after beforeSend becomes uncertain; beforeSend DB failure is known unsent", async () => {
		state.jobs.push(fixture());
		mocks.send.mockImplementation(async (input) => {
			await input.beforeSend();
			throw new Error(config.token);
		});
		await processTelegramJob(key);
		expect(state.jobs[0].status).toBe("uncertain");
		state.jobs = [fixture()];
		mocks.reserve.mockRejectedValue(new Error(config.token));
		await processTelegramJob(key);
		expect(state.jobs[0].status).toBe("failed");
	});
	it("accepted provider result followed by storage failure cannot be sent again", async () => {
		state.jobs.push(fixture());
		failAccepted = true;
		await processTelegramJob(key);
		expect(state.jobs[0].status).toBe("uncertain");
		await processTelegramJob(key);
		expect(mocks.send).toHaveBeenCalledTimes(1);
	});
	it("total database failure leaves the claim sending and surfaces failure without resend", async () => {
		state.jobs.push(fixture());
		failAccepted = true;
		failOutcome = true;
		await expect(processTelegramJob(key)).rejects.toThrow("לשמור");
		expect(state.jobs[0].status).toBe("sending");
		await processTelegramJob(key);
		expect(mocks.send).toHaveBeenCalledTimes(1);
	});
	it("real accepted posting alone updates Telegram production state and never email", async () => {
		state.settings.audience = "real";
		const job = await enqueueBulletinTelegram(request(key, "real"));
		await processTelegramJob(job.id);
		expect(state.channel).toBe("sent");
		expect(
			state.writes
				.filter((w) => w.sql.includes("UPDATE tanah_daily_bulletin_delivery"))
				.every((w) => w.sql.includes("channel = 'telegram'")),
		).toBe(true);
	});
	it("startup/periodic sweep recovers committed queued work after partial SQS failure", async () => {
		mocks.sqs.mockResolvedValueOnce({ Failed: [{ Id: key }] });
		await expect(enqueueBulletinTelegram(request())).rejects.toThrow("לתור");
		expect(state.jobs[0].status).toBe("queued");
		await reconcileTelegramOutbox(
			{ send: mocks.sqs } as unknown as SQSClient,
			config.queueUrl,
		);
		expect(mocks.sqs).toHaveBeenCalledTimes(2);
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("marks stale sending uncertain after60s without republishing it", async () => {
		state.jobs.push({ ...fixture("test", "sending"), stale: true });
		await reconcileTelegramOutbox(
			{ send: mocks.sqs } as unknown as SQSClient,
			config.queueUrl,
		);
		expect(state.jobs[0].status).toBe("uncertain");
		expect(mocks.sqs).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("uses one15s deadline for every publication batch instead of resetting per batch", async () => {
		state.jobs = Array.from({ length: 25 }, (_, index) => ({
			...fixture(),
			id: `job-${index}`,
		}));
		const timeout = vi.spyOn(AbortSignal, "timeout");
		try {
			await reconcileTelegramOutbox(
				{ send: mocks.sqs } as unknown as SQSClient,
				config.queueUrl,
			);
			expect(mocks.sqs).toHaveBeenCalledTimes(3);
			const signals = mocks.sqs.mock.calls.map((call) => call[1].abortSignal);
			expect(new Set(signals).size).toBe(1);
			expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
			expect(state.jobs.every((job) => job.status === "queued")).toBe(true);
		} finally {
			timeout.mockRestore();
		}
	});
	it("shared deadline expiring after a successful first batch stops further batches and retains the outbox", async () => {
		state.jobs = Array.from({ length: 25 }, (_, index) => ({
			...fixture(),
			id: `job-${index}`,
		}));
		const deadline = new AbortController();
		const timeout = vi
			.spyOn(AbortSignal, "timeout")
			.mockReturnValue(deadline.signal);
		mocks.sqs.mockImplementation(async (command) => {
			deadline.abort();
			return {
				Successful: command.input.Entries.map(({ Id }: { Id: string }) => ({
					Id,
				})),
			};
		});
		try {
			await expect(
				reconcileTelegramOutbox(
					{ send: mocks.sqs } as unknown as SQSClient,
					config.queueUrl,
				),
			).rejects.toThrow("לתור");
			expect(mocks.sqs).toHaveBeenCalledTimes(1);
			expect(state.jobs.every((job) => job.status === "queued")).toBe(true);
			expect(mocks.send).not.toHaveBeenCalled();
		} finally {
			timeout.mockRestore();
		}
	});
	it("shutdown cancels publication between batches and never mutates provider delivery", async () => {
		state.jobs = Array.from({ length: 25 }, (_, index) => ({
			...fixture(),
			id: `job-${index}`,
		}));
		const shutdown = new AbortController();
		mocks.sqs.mockImplementation(async (command) => {
			shutdown.abort();
			return {
				Successful: command.input.Entries.map(({ Id }: { Id: string }) => ({
					Id,
				})),
			};
		});
		await expect(
			reconcileTelegramOutbox(
				{ send: mocks.sqs } as unknown as SQSClient,
				config.queueUrl,
				shutdown.signal,
			),
		).rejects.toThrow("לתור");
		expect(mocks.sqs).toHaveBeenCalledTimes(1);
		expect(mocks.sqs.mock.calls[0][1].abortSignal.aborted).toBe(true);
		expect(state.jobs.every((job) => job.status === "queued")).toBe(true);
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("already cancelled sweep performs no database or queue work", async () => {
		const shutdown = new AbortController();
		shutdown.abort();
		await reconcileTelegramOutbox(
			{ send: mocks.sqs } as unknown as SQSClient,
			config.queueUrl,
			shutdown.signal,
		);
		expect(mocks.runtime).not.toHaveBeenCalled();
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it("shutdown during stale recovery stops after the current durable update", async () => {
		state.jobs = [
			{ ...fixture("test", "sending"), stale: true },
			{ ...fixture("test", "sending"), id: key2, stale: true },
		];
		const shutdown = new AbortController();
		mocks.execute.mockImplementation(async (sql, params) => {
			const result = write(sql, params);
			shutdown.abort();
			return result;
		});
		await expect(
			reconcileTelegramOutbox(
				{ send: mocks.sqs } as unknown as SQSClient,
				config.queueUrl,
				shutdown.signal,
			),
		).rejects.toThrow("לתור");
		expect(state.jobs.map((job) => job.status)).toEqual([
			"uncertain",
			"sending",
		]);
		expect(mocks.sqs).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("returns at15s when the initial database lookup never resolves", async () => {
		vi.useFakeTimers();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), milliseconds);
			return controller.signal;
		});
		mocks.query.mockImplementationOnce(() => new Promise(() => {}));
		let finished = false;
		const pending = reconcileTelegramOutbox(
			{ send: mocks.sqs } as unknown as SQSClient,
			config.queueUrl,
		);
		const stopped = expect(pending).rejects.toThrow("לתור");
		void pending.then(
			() => {
				finished = true;
			},
			() => {
				finished = true;
			},
		);
		await vi.advanceTimersByTimeAsync(14_999);
		expect(finished).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await stopped;
		expect(finished).toBe(true);
		expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(15_000);
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(mocks.sqs).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it.each(["stale-read", "stale-write", "audit-lock", "queued-read"])(
		"shutdown observes a late %s without any further database work or publication",
		async (stage) => {
			const shutdown = new AbortController();
			const held = deferred<unknown>();
			state.jobs.push({ ...fixture("real", "sending"), stale: true });
			if (stage === "stale-read")
				mocks.query.mockImplementationOnce(() => held.promise);
			if (stage === "stale-write")
				mocks.execute.mockImplementationOnce(() => held.promise);
			if (stage === "audit-lock")
				mocks.txQueryOne.mockImplementationOnce(() => held.promise);
			if (stage === "queued-read") {
				state.jobs = [fixture()];
				mocks.query
					.mockResolvedValueOnce([])
					.mockImplementationOnce(() => held.promise);
			}
			const pending = reconcileTelegramOutbox(
				{ send: mocks.sqs } as unknown as SQSClient,
				config.queueUrl,
				shutdown.signal,
			);
			const stopped = expect(pending).rejects.toThrow("לתור");
			await flush();
			shutdown.abort();
			await stopped;
			const calls = [
				mocks.query.mock.calls.length,
				mocks.execute.mock.calls.length,
				mocks.txQueryOne.mock.calls.length,
				mocks.txExecute.mock.calls.length,
			];
			held.resolve(
				stage === "stale-write"
					? { affectedRows: 1 }
					: stage === "audit-lock"
						? fixture("real", "uncertain")
						: [{ id: key }],
			);
			await flush();
			expect([
				mocks.query.mock.calls.length,
				mocks.execute.mock.calls.length,
				mocks.txQueryOne.mock.calls.length,
				mocks.txExecute.mock.calls.length,
			]).toEqual(calls);
			expect(mocks.sqs).not.toHaveBeenCalled();
			expect(mocks.send).not.toHaveBeenCalled();
		},
	);
	it("observes a database rejection after shutdown without later publication", async () => {
		const shutdown = new AbortController();
		const held = deferred<unknown>();
		mocks.query.mockImplementationOnce(() => held.promise);
		const pending = reconcileTelegramOutbox(
			{ send: mocks.sqs } as unknown as SQSClient,
			config.queueUrl,
			shutdown.signal,
		);
		const stopped = expect(pending).rejects.toThrow("לתור");
		await flush();
		shutdown.abort();
		await stopped;
		held.reject(new Error("private late database detail"));
		await flush();
		expect(mocks.query).toHaveBeenCalledOnce();
		expect(mocks.sqs).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("rejects unknown/invalid jobs and wrong queue without provider calls", async () => {
		expect(await processTelegramJob("not-a-uuid")).toBe(false);
		expect(await processTelegramJob(key)).toBe(false);
		await expect(
			reconcileTelegramOutbox(
				{ send: mocks.sqs } as unknown as SQSClient,
				"https://evil.example",
			),
		).rejects.toThrow();
		expect(mocks.send).not.toHaveBeenCalled();
	});
});

describe("Telegram failure and concurrency boundaries", () => {
	it.each(["missing-runtime", "unverified-channel"])(
		"cannot activate real delivery with %s",
		async (kind) => {
			if (kind === "missing-runtime") mocks.runtime.mockReturnValue(null);
			else mocks.targets.mockResolvedValue({ test: null, real: null });
			await expect(
				setTelegramAudience({
					audience: "real",
					expectedRevision: 0,
					confirmReal: true,
				}),
			).rejects.toThrow("הערוץ הציבורי טרם הוגדר ואומת");
			expect(mocks.transaction).not.toHaveBeenCalled();
			expect(state.settings).toEqual({ audience: "test", revision: 0 });
		},
	);
	it("keeps a same-audience request idempotent at the largest safe revision", async () => {
		state.settings.revision = Number.MAX_SAFE_INTEGER;
		expect(
			await setTelegramAudience({
				audience: "test",
				expectedRevision: Number.MAX_SAFE_INTEGER,
				confirmReal: false,
			}),
		).toEqual(state.settings);
		expect(state.writes).toHaveLength(0);
		await expect(
			setTelegramAudience({
				audience: "real",
				expectedRevision: Number.MAX_SAFE_INTEGER,
				confirmReal: true,
			}),
		).rejects.toThrow("הפרסום נעצר");
		expect(state.settings).toEqual({
			audience: "test",
			revision: Number.MAX_SAFE_INTEGER,
		});
		expect(state.writes).toHaveLength(0);
	});
	it("refuses enqueue when runtime is absent without reading or creating a job", async () => {
		mocks.runtime.mockReturnValue(null);
		await expect(enqueueBulletinTelegram(request())).rejects.toThrow(
			"שירות הטלגרם טרם הוגדר",
		);
		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(mocks.prepared).not.toHaveBeenCalled();
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it.each([
		{ pdfBase64: "" },
		{ filename: "" },
		{ filename: "x".repeat(256) },
		{ filename: "../private.pdf" },
		{ filename: "private\\file.pdf" },
		{ filename: "private\nfile.pdf" },
		{ source: "x".repeat(1025) },
		{ input: { ...prepared.input, perekId: 0 } },
		{ input: { ...prepared.input, perekId: 930 } },
		{ input: { ...prepared.input, perekId: 1.5 } },
	])(
		"refuses invalid frozen bulletin content before target lookup or publication (%#)",
		async (change) => {
			mocks.prepared.mockResolvedValue({ ...prepared, ...change });
			await expect(enqueueBulletinTelegram(request())).rejects.toThrow(
				"פרסום העלון נכשל",
			);
			expect(state.jobs).toHaveLength(0);
			expect(mocks.targets).not.toHaveBeenCalled();
			expect(mocks.sqs).not.toHaveBeenCalled();
		},
	);
	it.each([
		null,
		{ botId: 123456, chatId: -100999, title: "Changed target", username: null },
	])(
		"does not create work for a missing or changed verified destination (%#)",
		async (target) => {
			mocks.targets.mockResolvedValue({ test: target, real: null });
			await expect(enqueueBulletinTelegram(request())).rejects.toBeInstanceOf(
				TelegramSuppressedError,
			);
			expect(state.jobs).toHaveLength(0);
			expect(mocks.sqs).not.toHaveBeenCalled();
		},
	);
	it("rolls back the job if the production ledger reservation loses ownership", async () => {
		state.settings.audience = "real";
		mocks.txExecute.mockImplementation(async (_connection, sql, params) =>
			sql.includes("SET status = 'sending'")
				? { affectedRows: 0 }
				: write(sql, params),
		);
		await expect(
			enqueueBulletinTelegram(request(key, "real")),
		).rejects.toBeInstanceOf(TelegramSuppressedError);
		expect(state.jobs).toHaveLength(0);
		expect(state.channel).toBe("pending");
		expect(state.channelHistory.provider_message_id).toBeNull();
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it("rolls back an insert that cannot be read back instead of publishing incomplete work", async () => {
		mocks.txQueryOne.mockImplementation(async (_connection, sql, params) =>
			sql.endsWith("WHERE id = ?") ? null : select(sql, params),
		);
		await expect(enqueueBulletinTelegram(request())).rejects.toThrow(
			"פרסום העלון נכשל",
		);
		expect(state.jobs).toHaveLength(0);
		expect(mocks.sqs).not.toHaveBeenCalled();
	});
	it.each(["uncertain", "suppressed", "failed"] as const)(
		"shows a sanitized %s explanation without exposing stored provider details",
		async (status) => {
			const row = fixture("test", status);
			row.last_error = `private provider ${config.token}`;
			state.jobs.push(row);
			const result = await getBulletinTelegramState(date);
			expect(result.job).toMatchObject({ status, error: expect.any(String) });
			expect(result.job?.error).not.toContain(config.token);
			expect(result.job?.error).not.toContain("private provider");
		},
	);
	it.each([{ bot_id: 0 }, { bot_id: 1.5 }, { target_chat_id: -100999 }])(
		"suppresses a stale frozen identity without calling the provider (%#)",
		async (change) => {
			state.jobs.push({ ...fixture(), ...change });
			expect(await processTelegramJob(key)).toBe(true);
			expect(state.jobs[0].status).toBe("suppressed");
			expect(mocks.prepared).not.toHaveBeenCalled();
			expect(mocks.send).not.toHaveBeenCalled();
		},
	);
	it("suppresses a claimed job whose saved bulletin disappeared", async () => {
		state.jobs.push(fixture());
		mocks.prepared.mockResolvedValue(null);
		await processTelegramJob(key);
		expect(state.jobs[0].status).toBe("suppressed");
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("marks a stale in-flight real job uncertain and never reuploads it", async () => {
		const row = fixture("real", "sending");
		row.stale = true;
		row.attempt_token = "original-claim";
		state.jobs.push(row);
		state.channel = "sending";
		state.channelHistory.provider_message_id = `telegram-job:${key}`;
		expect(await processTelegramJob(key)).toBe(true);
		expect(state.jobs[0].status).toBe("uncertain");
		expect(state.channel).toBe("uncertain");
		expect(await processTelegramJob(key)).toBe(true);
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("keeps an upload uncertain when its acknowledgement update loses the claim", async () => {
		state.jobs.push(fixture());
		mocks.execute.mockImplementation(async (sql, params) =>
			sql.includes("SET status = 'sent'")
				? { affectedRows: 0 }
				: write(sql, params),
		);
		await processTelegramJob(key);
		expect(state.jobs[0].status).toBe("uncertain");
		expect(state.jobs[0].provider_message_id).toBeNull();
		await processTelegramJob(key);
		expect(mocks.send).toHaveBeenCalledOnce();
	});
});
