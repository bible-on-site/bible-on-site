import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
		state.settings = {
			audience: params[0] as TelegramAudience,
			revision: state.settings.revision + 1,
		};
		return { affectedRows: 1 };
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_delivery")) {
		if (sql.includes("SET status = 'sending'")) {
			state.channel = "sending";
			return { affectedRows: 1 };
		}
		state.channel = params[0] as string;
		state.channelAttempts = Number(params[4]);
		return { affectedRows: 1 };
	}
	if (sql.includes("SET status = 'sending'")) {
		const row = state.jobs.find(
			(j) => j.id === params[1] && j.status === "queued",
		);
		if (!row) return { affectedRows: 0 };
		row.status = "sending";
		row.attempt_token = params[0] as string;
		return { affectedRows: 1 };
	}
	if (sql.includes("SET status = 'uncertain'")) {
		const row = state.jobs.find(
			(j) => j.id === params[1] && j.status === "sending" && j.stale,
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
	mocks.reserve.mockResolvedValue(undefined);
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
		state.jobs.push(fixture("real"));
		await processTelegramJob(key);
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
		await reconcileTelegramOutbox(
			{ send: mocks.sqs } as unknown as SQSClient,
			config.queueUrl,
			shutdown.signal,
		);
		expect(state.jobs.map((job) => job.status)).toEqual([
			"uncertain",
			"sending",
		]);
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
