import { createHash } from "node:crypto";
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
	prepared: vi.fn(),
	sqs: vi.fn(),
	destroy: vi.fn(),
}));
vi.mock("~/server/db", () => mocks);
vi.mock("~/server/daily-bulletins.server", () => ({
	readPreparedBulletin: mocks.prepared,
}));
vi.mock("@aws-sdk/client-sqs", () => ({
	SQSClient: class {
		send = mocks.sqs;
		destroy = mocks.destroy;
	},
	SendMessageBatchCommand: class {
		constructor(
			public input: { Entries: { Id: string; MessageBody: string }[] },
		) {}
	},
}));

import { SQSClient } from "@aws-sdk/client-sqs";
import type {
	WhatsAppAudience,
	WhatsAppJobStatus,
} from "~/lib/bulletin-whatsapp";
import {
	WhatsAppClient,
	WhatsAppDeferredError,
	WhatsAppError,
	WhatsAppSuppressedError,
} from "~/server/whatsapp-client.server";
import {
	enqueueBulletinWhatsApp,
	getBulletinWhatsAppState,
	processWhatsAppJob,
	reconcileWhatsAppOutbox,
	setWhatsAppAudience,
	verifyBulletinWhatsApp,
} from "~/server/whatsapp-delivery.server";
import {
	type CachedWhatsAppTarget,
	loadWhatsAppRuntime,
	targetGroupId,
	whatsAppConfigDigest,
} from "~/server/whatsapp-settings.server";

const date = "2026-10-28";
const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pdf = Buffer.from("%PDF-1.7\nimmutable fixture\n%%EOF");
const token = "a".repeat(48);
const digest = `sha256:${"b".repeat(64)}`;
const configEnv = {
	INSTANCE_ID: "7107123456",
	API_TOKEN: token,
	API_URL: "https://api.green-api.com",
	MEDIA_URL: "https://media.green-api.com",
	SENDER_PHONE: "15555550101",
	TEST_GROUP_ID: "120363000000000001@g.us",
	TEST_PARTICIPANT_DIGEST: digest,
	REAL_GROUP_ID: "120363000000000002@g.us",
};
const prepared = {
	pdfBase64: pdf.toString("base64"),
	filename: "daily.pdf",
	source: "הושע ב",
	input: { date, perekId: 502, hebrewDate: "יז חשוון תשפז" },
};
interface Job {
	id: string;
	bulletin_date: string;
	audience: WhatsAppAudience;
	idempotency_key: string;
	settings_revision: number;
	status: WhatsAppJobStatus;
	instance_id: string;
	target_group_id: string;
	sender_id: string;
	sender_phone: string;
	participant_digest: string;
	config_sha256: string;
	pdf_sha256: string;
	filename: string;
	caption: string;
	attempt_token: string | null;
	upload_started_at: string | null;
	provider_message_id: string | null;
	provider_status: string | null;
	reconcile_attempts: number;
	reconcile_token: string | null;
	created_at: string;
	sent_at: string | null;
	last_error: string | null;
	stale: boolean;
	available: boolean;
	due: number;
	leased: boolean;
}
interface Legacy {
	status: string;
	attempt_count: number;
	provider_message_id: string | null;
	sent_at: string | null;
	lease_token: string | null;
	lease_until: string | null;
}
let state: {
	settings: {
		audience: WhatsAppAudience;
		revision: number;
		groupBusy: boolean;
		month: string;
		used: number;
		checkBusy: boolean;
	};
	jobs: Job[];
	targets: CachedWhatsAppTarget[];
	legacy: Legacy | null;
	writes: { sql: string; params: unknown[] }[];
};
let serial: Promise<unknown>;
function config() {
	const runtime = loadWhatsAppRuntime();
	if (!runtime) throw new Error("fixture");
	return runtime;
}
function target(audience: WhatsAppAudience = "test"): CachedWhatsAppTarget {
	const runtime = config();
	return {
		audience,
		config_sha256: whatsAppConfigDigest(runtime, audience),
		verified: 1,
		connection_state: "authorized",
		group_id: targetGroupId(runtime, audience),
		title: `Example ${audience}`,
		member_count: 2,
		sender_id: "15555550101@c.us",
		sender_phone: runtime.expectedSenderPhone,
		participant_digest: digest,
		checked_at: new Date(Date.now() - 1000).toISOString(),
		expires_at: new Date(Date.now() + 600_000).toISOString(),
	};
}
function job(
	status: WhatsAppJobStatus = "queued",
	audience: WhatsAppAudience = "test",
): Job {
	const runtime = config();
	return {
		id: key,
		bulletin_date: date,
		audience,
		idempotency_key: audience === "real" ? "production" : key,
		settings_revision: 0,
		status,
		instance_id: runtime.instanceId,
		target_group_id: targetGroupId(runtime, audience),
		sender_id: "15555550101@c.us",
		sender_phone: runtime.expectedSenderPhone,
		participant_digest: digest,
		config_sha256: whatsAppConfigDigest(runtime, audience),
		pdf_sha256: createHash("sha256").update(pdf).digest("hex"),
		filename: prepared.filename,
		caption: "Frozen caption",
		attempt_token: status === "queued" ? null : otherKey,
		upload_started_at: status === "queued" ? null : "2026-10-28T12:00:00Z",
		provider_message_id:
			status === "accepted" || status === "sent"
				? "EXAMPLE_MESSAGE_00000001"
				: null,
		provider_status: null,
		reconcile_attempts: 0,
		reconcile_token: null,
		created_at: "2026-10-28T12:00:00Z",
		sent_at: null,
		last_error: null,
		stale: false,
		available: true,
		due: 0,
		leased: false,
	};
}
function seed(
	status: WhatsAppJobStatus = "queued",
	audience: WhatsAppAudience = "test",
) {
	const row = job(status, audience);
	state.settings.audience = audience;
	state.jobs = [row];
	if (audience === "real" && state.legacy) {
		state.legacy.status = "sending";
		state.legacy.provider_message_id = `whatsapp-job:${row.id}`;
	}
	return row;
}
function read(raw: string, params: unknown[] = []): unknown[] {
	const sql = raw.replace(/\s+/g, " ");
	if (sql.includes("FROM tanah_daily_bulletin_whatsapp_settings"))
		return [
			{
				...state.settings,
				busy: sql.includes("group_lookup_until")
					? Number(state.settings.groupBusy)
					: Number(state.settings.checkBusy),
				current_month: "2026-10",
				message_check_month: state.settings.month,
				message_checks_used: state.settings.used,
			},
		];
	if (sql.includes("FROM tanah_daily_bulletin_whatsapp_verification"))
		return structuredClone(state.targets);
	if (sql.includes("FROM tanah_daily_bulletin_delivery"))
		return state.legacy ? [structuredClone(state.legacy)] : [];
	if (sql.includes("FROM tanah_daily_bulletin_whatsapp_job")) {
		let rows = state.jobs;
		if (sql.includes("idempotency_key = ?"))
			rows = rows.filter(
				(row) =>
					row.bulletin_date === params[0] &&
					row.audience === params[1] &&
					row.idempotency_key === params[2],
			);
		else if (sql.includes("WHERE id = ?"))
			rows = rows.filter((row) => row.id === params[0]);
		else if (sql.includes("WHERE bulletin_date = ?"))
			rows = rows.filter(
				(row) => row.bulletin_date === params[0] && row.audience === params[1],
			);
		if (sql.includes("status IN ('queued','sending','accepted','uncertain')"))
			rows = rows.filter((row) =>
				["queued", "sending", "accepted", "uncertain"].includes(row.status),
			);
		if (sql.includes("status = 'queued'"))
			rows = rows.filter((row) => row.status === "queued" && row.available);
		if (sql.includes("status = 'sending'"))
			rows = rows.filter((row) => row.status === "sending" && row.stale);
		if (sql.includes("status = 'accepted'"))
			rows = rows.filter(
				(row) => row.status === "accepted" && row.due === 1 && !row.leased,
			);
		if (sql.includes("ORDER BY created_at DESC"))
			rows = rows.slice(-1).reverse();
		return structuredClone(rows);
	}
	throw new Error(`Unhandled fixture SELECT: ${sql}`);
}
function write(raw: string, params: unknown[] = []) {
	const sql = raw.replace(/\s+/g, " ");
	state.writes.push({ sql, params });
	if (sql.startsWith("INSERT INTO tanah_daily_bulletin_whatsapp_job")) {
		const [
			id,
			day,
			audience,
			requestKey,
			revision,
			instance,
			group,
			senderId,
			phone,
			members,
			configDigest,
			pdfHash,
			filename,
			caption,
		] = params;
		state.jobs.push({
			...job(),
			id: String(id),
			bulletin_date: String(day),
			audience: audience as WhatsAppAudience,
			idempotency_key: String(requestKey),
			settings_revision: Number(revision),
			instance_id: String(instance),
			target_group_id: String(group),
			sender_id: String(senderId),
			sender_phone: String(phone),
			participant_digest: String(members),
			config_sha256: String(configDigest),
			pdf_sha256: String(pdfHash),
			filename: String(filename),
			caption: String(caption),
		});
		return { affectedRows: 1 };
	}
	if (
		sql.includes("UPDATE tanah_daily_bulletin_whatsapp_settings SET audience")
	) {
		state.settings.audience = params[0] as WhatsAppAudience;
		state.settings.revision++;
		return { affectedRows: 1 };
	}
	if (sql.includes("SET group_lookup_token = ?")) {
		state.settings.groupBusy = true;
		return { affectedRows: 1 };
	}
	if (sql.includes("group_lookup_token = NULL")) {
		state.settings.groupBusy = false;
		return { affectedRows: 1 };
	}
	if (sql.includes("message_checks_used = CASE")) {
		state.settings.used =
			state.settings.month === "2026-10" ? state.settings.used + 1 : 1;
		state.settings.month = "2026-10";
		return { affectedRows: 1 };
	}
	if (
		sql.startsWith("INSERT INTO tanah_daily_bulletin_whatsapp_verification")
	) {
		const audience = params[0] as WhatsAppAudience;
		const row = target(audience);
		row.config_sha256 = String(params[1]);
		if (sql.includes("FALSE")) {
			row.verified = 0;
			row.connection_state =
				params[2] as CachedWhatsAppTarget["connection_state"];
			row.title = null;
		}
		state.targets = [
			...state.targets.filter((item) => item.audience !== audience),
			row,
		];
		return { affectedRows: 1 };
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_delivery")) {
		if (!state.legacy) return { affectedRows: 0 };
		if (sql.includes("SET status = 'sending'")) {
			if (
				state.legacy.status !== "pending" ||
				state.legacy.attempt_count !== 0 ||
				state.legacy.provider_message_id ||
				state.legacy.sent_at ||
				state.legacy.lease_token ||
				state.legacy.lease_until
			)
				return { affectedRows: 0 };
			state.legacy.status = "sending";
			state.legacy.provider_message_id = String(params[0]);
		} else {
			if (
				![params[7], params[8]].includes(state.legacy.provider_message_id) ||
				!["sending", params[9]].includes(state.legacy.status) ||
				state.legacy.attempt_count > Number(params[10]) ||
				(state.legacy.lease_token !== null &&
					state.legacy.lease_token !== params[11]) ||
				state.legacy.lease_until !== null ||
				(state.legacy.sent_at !== null &&
					!(state.legacy.status === "sent" && params[12] === "sent"))
			)
				return { affectedRows: 0 };
			state.legacy.status = String(params[0]);
			state.legacy.provider_message_id = String(params[1]);
			state.legacy.lease_token = params[3] as string | null;
			state.legacy.attempt_count = Math.max(
				state.legacy.attempt_count,
				Number(params[4]),
			);
		}
		return { affectedRows: 1 };
	}
	if (sql.startsWith("UPDATE tanah_daily_bulletin_whatsapp_job")) {
		let row: Job | undefined;
		if (sql.includes("SET status = 'sending'")) {
			row = state.jobs.find(
				(item) =>
					item.id === params[1] &&
					item.status === "queued" &&
					item.available &&
					item.attempt_token === null &&
					item.upload_started_at === null &&
					item.provider_message_id === null,
			);
			if (!row) return { affectedRows: 0 };
			row.status = "sending";
			row.attempt_token = String(params[0]);
		} else if (sql.includes("SET upload_started_at")) {
			row = state.jobs.find(
				(item) =>
					item.id === params[0] &&
					item.status === "sending" &&
					item.attempt_token === params[1] &&
					item.upload_started_at === null,
			);
			if (!row) return { affectedRows: 0 };
			row.upload_started_at = "2026-10-28T12:00:00Z";
		} else if (sql.includes("SET status = 'accepted'")) {
			row = state.jobs.find(
				(item) =>
					item.id === params[1] &&
					item.status === "sending" &&
					item.attempt_token === params[2],
			);
			if (!row) return { affectedRows: 0 };
			row.status = "accepted";
			row.provider_message_id = String(params[0]);
			row.due = 0;
			row.last_error = null;
		} else if (sql.includes("SET status = 'queued'")) {
			row = state.jobs.find(
				(item) =>
					item.id === params[1] &&
					item.status === "sending" &&
					item.attempt_token === params[2] &&
					item.upload_started_at === null,
			);
			if (!row) return { affectedRows: 0 };
			row.status = "queued";
			row.attempt_token = null;
			row.available = false;
			row.last_error = String(params[0]);
		} else if (sql.includes("SET status = 'uncertain'")) {
			row = state.jobs.find((item) => item.id === params[1]);
			if (
				!row ||
				(sql.includes("status = 'sending'") &&
					(row.status !== "sending" || !row.stale))
			)
				return { affectedRows: 0 };
			row.status = "uncertain";
			row.last_error = String(params[0]);
		} else if (sql.includes("SET reconcile_token")) {
			row = state.jobs.find(
				(item) => item.id === params[1] && item.status === "accepted",
			);
			if (!row) return { affectedRows: 0 };
			row.reconcile_token = String(params[0]);
			row.reconcile_attempts++;
			row.leased = true;
		} else if (sql.includes("SET next_reconcile_at")) {
			row = state.jobs.find((item) => item.id === params[1]);
			if (!row) return { affectedRows: 0 };
			row.due = 0;
			row.last_error = String(params[0]);
		} else if (sql.includes("provider_status = ?")) {
			row = state.jobs.find(
				(item) =>
					item.id === params[6] &&
					item.status === "accepted" &&
					item.reconcile_token === params[7],
			);
			if (!row) return { affectedRows: 0 };
			row.status = params[0] as WhatsAppJobStatus;
			row.provider_status = String(params[1]);
			row.last_error = params[2] as string | null;
			row.reconcile_token = null;
			row.leased = false;
			row.due = 0;
			if (row.status === "sent") row.sent_at = "2026-10-28T12:03:00Z";
		} else {
			row = state.jobs.find(
				(item) =>
					item.id === params[2] &&
					item.status === "sending" &&
					item.attempt_token === params[3],
			);
			if (!row) return { affectedRows: 0 };
			row.status = params[0] as WhatsAppJobStatus;
			row.last_error = String(params[1]);
		}
		return { affectedRows: 1 };
	}
	throw new Error(`Unhandled fixture mutation: ${sql}`);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	for (const [name, value] of Object.entries(configEnv))
		vi.stubEnv(`BULLETIN_WHATSAPP_${name}`, value);
	vi.stubEnv(
		"BULLETIN_EMAIL_QUEUE_URL",
		"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin",
	);
	vi.stubEnv("BULLETIN_SES_ACCOUNT_ID", "123456789012");
	vi.stubEnv("BULLETIN_SES_REGION", "il-central-1");
	state = {
		settings: {
			audience: "test",
			revision: 0,
			groupBusy: false,
			month: "2026-10",
			used: 0,
			checkBusy: false,
		},
		jobs: [],
		targets: [],
		legacy: {
			status: "pending",
			attempt_count: 0,
			provider_message_id: null,
			sent_at: null,
			lease_token: null,
			lease_until: null,
		},
		writes: [],
	};
	state.targets = [target(), target("real")];
	serial = Promise.resolve();
	mocks.query.mockImplementation(async (sql, params) => read(sql, params));
	mocks.queryOne.mockImplementation(
		async (sql, params) => read(sql, params)[0] ?? null,
	);
	mocks.txQuery.mockImplementation(async (_connection, sql, params) =>
		read(sql, params),
	);
	mocks.txQueryOne.mockImplementation(
		async (_connection, sql, params) => read(sql, params)[0] ?? null,
	);
	mocks.execute.mockImplementation(async (sql, params) => write(sql, params));
	mocks.txExecute.mockImplementation(async (_connection, sql, params) =>
		write(sql, params),
	);
	mocks.transaction.mockImplementation((callback) => {
		const result = serial.then(async () => {
			const saved = structuredClone(state);
			try {
				return await callback({});
			} catch (error) {
				state = saved;
				throw error;
			}
		});
		serial = result.catch(() => undefined);
		return result;
	});
	mocks.prepared.mockResolvedValue(structuredClone(prepared));
	mocks.sqs.mockImplementation(async (command) => ({
		Successful: command.input.Entries.map((entry: { Id: string }) => ({
			Id: entry.Id,
		})),
	}));
	vi.spyOn(WhatsAppClient.prototype, "verifyTarget").mockImplementation(
		async (request) => ({
			groupId: request.groupId,
			title: "Example verified",
			size: 2,
			senderId: "15555550101@c.us",
			senderPhone: config().expectedSenderPhone,
			participantDigest: digest,
			outgoingStatusesEnabled: true,
		}),
	);
	vi.spyOn(WhatsAppClient.prototype, "sendDocument").mockImplementation(
		async (request) => {
			const release = await request.beforeGroupData?.(
				new AbortController().signal,
			);
			await release?.();
			await request.beforeSend();
			return { messageId: "EXAMPLE_MESSAGE_00000001" };
		},
	);
	vi.spyOn(WhatsAppClient.prototype, "getMessage").mockResolvedValue({
		status: "sent",
	});
});
afterEach(() => vi.restoreAllMocks());

describe("durable WhatsApp state and explicit verification", () => {
	it("reads stored mode/job/cache without a provider request", async () => {
		seed("accepted", "real");
		const result = await getBulletinWhatsAppState(date);
		expect(result.settings).toEqual({ audience: "real", revision: 0 });
		expect(result.job?.status).toBe("accepted");
		expect(result.audienceLocked).toBe(true);
		expect(JSON.stringify(result)).not.toContain(config().testGroupId);
		expect(JSON.stringify(result)).not.toContain(token);
		expect(WhatsAppClient.prototype.verifyTarget).not.toHaveBeenCalled();
		expect(WhatsAppClient.prototype.getMessage).not.toHaveBeenCalled();
	});
	it.each(["missing", "invalid"])(
		"retains real mode when provider configuration is %s",
		async (kind) => {
			state.settings.audience = "real";
			for (const name of Object.keys(configEnv))
				vi.stubEnv(`BULLETIN_WHATSAPP_${name}`, "");
			if (kind === "invalid")
				vi.stubEnv("BULLETIN_WHATSAPP_API_TOKEN", "partial");
			const result = await getBulletinWhatsAppState(date);
			expect(result.settings.audience).toBe("real");
			expect(result.readiness.canSend).toBe(false);
		},
	);
	it("does not fabricate TEST on database or verification-table failure", async () => {
		mocks.queryOne.mockRejectedValueOnce(new Error("private database detail"));
		await expect(getBulletinWhatsAppState(date)).rejects.toThrow(
			"לא ניתן לקרוא",
		);
		mocks.query.mockRejectedValueOnce(new Error("private database detail"));
		await expect(getBulletinWhatsAppState(date)).rejects.toThrow(
			"לא ניתן לקרוא את אימות",
		);
	});
	it("verification refreshes only one target per deliberate action, preferring missing current then other", async () => {
		state.targets = [];
		await verifyBulletinWhatsApp(date);
		expect(WhatsAppClient.prototype.verifyTarget).toHaveBeenLastCalledWith(
			expect.objectContaining({ audience: "test" }),
		);
		await verifyBulletinWhatsApp(date);
		expect(WhatsAppClient.prototype.verifyTarget).toHaveBeenLastCalledWith(
			expect.objectContaining({ audience: "real" }),
		);
		await verifyBulletinWhatsApp(date);
		expect(WhatsAppClient.prototype.verifyTarget).toHaveBeenLastCalledWith(
			expect.objectContaining({ audience: "test" }),
		);
	});
	it("reports a deferred verification without a hidden retry", async () => {
		vi.mocked(WhatsAppClient.prototype.verifyTarget).mockRejectedValueOnce(
			new WhatsAppDeferredError(),
		);
		const result = await verifyBulletinWhatsApp(date);
		expect(result.readiness.canSend).toBe(false);
		expect(WhatsAppClient.prototype.verifyTarget).toHaveBeenCalledOnce();
	});
	it("persists sanitized provider failure and hides unknown internal errors", async () => {
		vi.mocked(WhatsAppClient.prototype.verifyTarget).mockRejectedValueOnce(
			new WhatsAppError("failed", "blocked"),
		);
		expect(
			(await verifyBulletinWhatsApp(date)).verification.connectionState,
		).toBe("blocked");
		vi.mocked(WhatsAppClient.prototype.verifyTarget).mockRejectedValueOnce(
			new Error("private"),
		);
		await expect(verifyBulletinWhatsApp(date)).rejects.toThrow(
			"לא ניתן להשלים",
		);
	});
});

describe("audience compare-and-set", () => {
	it("requires explicit real confirmation and fresh verified real metadata", async () => {
		await expect(
			setWhatsAppAudience({
				audience: "real",
				expectedRevision: 0,
				confirmReal: false,
			}),
		).rejects.toThrow();
		state.targets = [target()];
		await expect(
			setWhatsAppAudience({
				audience: "real",
				expectedRevision: 0,
				confirmReal: true,
			}),
		).rejects.toThrow();
		state.targets.push(target("real"));
		expect(
			await setWhatsAppAudience({
				audience: "real",
				expectedRevision: 0,
				confirmReal: true,
			}),
		).toEqual({ audience: "real", revision: 1 });
	});
	it("allows return to TEST without real configuration and keeps idempotent same audience", async () => {
		state.settings.audience = "real";
		vi.stubEnv("BULLETIN_WHATSAPP_REAL_GROUP_ID", "");
		expect(
			await setWhatsAppAudience({
				audience: "test",
				expectedRevision: 0,
				confirmReal: false,
			}),
		).toEqual({ audience: "test", revision: 1 });
		expect(
			await setWhatsAppAudience({
				audience: "test",
				expectedRevision: 1,
				confirmReal: false,
			}),
		).toEqual({ audience: "test", revision: 1 });
	});
	it.each(["queued", "sending", "accepted", "uncertain"] as const)(
		"blocks switches for %s work on another date",
		async (status) => {
			const row = seed(status);
			row.bulletin_date = "2026-10-27";
			await expect(
				setWhatsAppAudience({
					audience: "real",
					expectedRevision: 0,
					confirmReal: true,
				}),
			).rejects.toThrow("יש פרסום פעיל");
			expect((await getBulletinWhatsAppState(date)).audienceLocked).toBe(true);
		},
	);
	it("rejects stale revisions and overflow without changing stored mode", async () => {
		await expect(
			setWhatsAppAudience({
				audience: "real",
				expectedRevision: 1,
				confirmReal: true,
			}),
		).rejects.toBeInstanceOf(WhatsAppSuppressedError);
		state.settings.revision = Number.MAX_SAFE_INTEGER;
		await expect(
			setWhatsAppAudience({
				audience: "real",
				expectedRevision: Number.MAX_SAFE_INTEGER,
				confirmReal: true,
			}),
		).rejects.toThrow();
		expect(state.settings.audience).toBe("test");
	});
});

describe("immutable durable enqueue and legacy preservation", () => {
	const enqueue = (requestKey = key, audience: WhatsAppAudience = "test") =>
		enqueueBulletinWhatsApp({
			date,
			requestKey,
			expectedAudience: audience,
			expectedRevision: 0,
		});
	it("freezes the exact PDF, target, sender, caption and hash before publishing", async () => {
		const result = await enqueue();
		const row = state.jobs[0];
		expect(result.status).toBe("queued");
		expect(row.pdf_sha256).toBe(createHash("sha256").update(pdf).digest("hex"));
		expect(row.target_group_id).toBe(config().testGroupId);
		expect(row.caption).toContain("https://xn--febl3a.co.il/929/502");
		expect(mocks.sqs.mock.calls[0][0].input.Entries[0].MessageBody).toBe(
			JSON.stringify({ kind: "whatsapp.send", jobId: row.id }),
		);
		expect(mocks.destroy).toHaveBeenCalledOnce();
		expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
	});
	it("concurrent identical requests create one job and retain the first snapshot", async () => {
		const results = await Promise.all([enqueue(), enqueue()]);
		expect(state.jobs).toHaveLength(1);
		expect(results[0].id).toBe(results[1].id);
	});
	it("retains durable queued work on partial or unknown SQS publication", async () => {
		mocks.sqs.mockResolvedValueOnce({
			Successful: [],
			Failed: [{ Id: "failed" }],
		});
		await expect(enqueue()).rejects.toThrow("הבקשה נשמרה");
		expect(state.jobs).toHaveLength(1);
		const saved = state.jobs[0].id;
		expect((await enqueue()).id).toBe(saved);
		expect(state.jobs).toHaveLength(1);
	});
	it("returns an existing real request before inspecting already reserved history", async () => {
		const row = seed("sent", "real");
		expect((await enqueue(otherKey, "real")).id).toBe(row.id);
		expect(state.jobs).toHaveLength(1);
	});
	it.each([
		{ status: "sent" },
		{ status: "failed" },
		{ attempt_count: 1 },
		{ provider_message_id: "legacy" },
		{ sent_at: "2020-01-01" },
		{ lease_token: "legacy-lease" },
		{ lease_until: "2020-01-01" },
	])("refuses real posting over legacy history %j", async (change) => {
		state.settings.audience = "real";
		Object.assign(state.legacy ?? {}, change);
		const before = structuredClone(state.legacy);
		await expect(enqueue(key, "real")).rejects.toThrow("קיים ניסיון");
		expect(state.jobs).toHaveLength(0);
		expect(state.legacy).toEqual(before);
	});
	it("requires and atomically reserves an untouched legacy real row", async () => {
		state.settings.audience = "real";
		const result = await enqueue(key, "real");
		expect(state.legacy).toMatchObject({
			status: "sending",
			provider_message_id: `whatsapp-job:${result.id}`,
			attempt_count: 0,
		});
	});
	it("leaves old real history entirely unchanged for a test send", async () => {
		if (state.legacy) {
			state.legacy.status = "sent";
			state.legacy.provider_message_id = "old-real";
		}
		const saved = structuredClone(state.legacy);
		await enqueue();
		expect(state.legacy).toEqual(saved);
	});
	it.each([
		null,
		{ ...prepared, pdfBase64: "invalid" },
		{ ...prepared, filename: "../daily.pdf" },
		{ ...prepared, filename: "daily.txt" },
		{ ...prepared, filename: `${"x".repeat(256)}.pdf` },
		{ ...prepared, input: { ...prepared.input, perekId: 0 } },
		{ ...prepared, input: { ...prepared.input, date: "2026-10-27" } },
		{ ...prepared, source: "x".repeat(1025) },
	])(
		"rejects missing or corrupt prepared content before publishing",
		async (snapshot) => {
			mocks.prepared.mockResolvedValueOnce(snapshot);
			await expect(enqueue()).rejects.toThrow();
			expect(state.jobs).toHaveLength(0);
			expect(mocks.sqs).not.toHaveBeenCalled();
		},
	);
	it("rejects changed mode/revision, unverified group and a second active request", async () => {
		state.settings.revision = 1;
		await expect(enqueue()).rejects.toBeInstanceOf(WhatsAppSuppressedError);
		state.settings.revision = 0;
		state.targets = [];
		await expect(enqueue()).rejects.toBeInstanceOf(WhatsAppSuppressedError);
		state.targets = [target()];
		seed("accepted");
		await expect(enqueue(otherKey)).rejects.toThrow("יש בקשת פרסום פתוחה");
	});
});

describe("single claim and no ambiguous upload retry", () => {
	it("never uploads when an in-flight DB reservation acknowledges after shutdown", async () => {
		seed();
		vi.mocked(WhatsAppClient.prototype.sendDocument).mockRestore();
		const upload = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				Response.json({ idMessage: "EXAMPLE_MESSAGE_00000001" }),
			);
		const gate = deferred<void>();
		mocks.txExecute.mockImplementation(async (_connection, sql, params) => {
			const result = write(sql, params);
			if (sql.includes("SET upload_started_at")) await gate.promise;
			return result;
		});
		const shutdown = new AbortController();
		const pending = processWhatsAppJob(key, shutdown.signal);
		await vi.waitFor(() =>
			expect(state.jobs[0].upload_started_at).not.toBeNull(),
		);
		shutdown.abort();
		await pending;
		gate.resolve();
		for (let turn = 0; turn < 16; turn++) await Promise.resolve();
		expect(upload).not.toHaveBeenCalled();
		expect(state.jobs[0].upload_started_at).not.toBeNull();
		expect(["sending", "uncertain"]).toContain(state.jobs[0].status);
		await processWhatsAppJob(key);
		expect(upload).not.toHaveBeenCalled();
	});
	it.each([
		{ attempt_token: otherKey },
		{ upload_started_at: "2026-10-28T12:00:00Z" },
		{ provider_message_id: "EXAMPLE_OLDER_MESSAGE" },
	])(
		"never uploads a queued job carrying prior attempt history: %j",
		async (change) => {
			Object.assign(seed(), change);
			await processWhatsAppJob(key);
			await processWhatsAppJob(key);
			expect(state.jobs[0].status).toBe("uncertain");
			expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
		},
	);
	it.each([
		{ status: "sent" },
		{ provider_message_id: "EXAMPLE_EXTERNAL_MESSAGE" },
		{ attempt_count: 2 },
		{ sent_at: "2026-10-28T11:00:00Z" },
		{ lease_token: otherKey },
		{ lease_until: "2026-10-28T13:00:00Z" },
	])(
		"preserves external real-delivery changes at the final upload boundary: %j",
		async (change) => {
			seed("queued", "real");
			if (!state.legacy) throw new Error("Missing test legacy row");
			Object.assign(state.legacy, change);
			const before = structuredClone(state.legacy);
			await processWhatsAppJob(key);
			expect(state.jobs[0]).toMatchObject({
				status: "suppressed",
				upload_started_at: null,
			});
			expect(state.legacy).toEqual(before);
		},
	);
	it("does not repeat an acknowledged upload when its acknowledgement cannot be saved", async () => {
		seed();
		const execute = mocks.execute.getMockImplementation();
		if (!execute) throw new Error("Missing test executor");
		mocks.execute.mockImplementation(async (sql, params) =>
			sql.includes("SET status = 'accepted'")
				? { affectedRows: 0 }
				: execute(sql, params),
		);
		await processWhatsAppJob(key);
		await processWhatsAppJob(key);
		expect(state.jobs[0].status).toBe("uncertain");
		expect(WhatsAppClient.prototype.sendDocument).toHaveBeenCalledOnce();
	});
	it("claims once, sends immutable bytes, and records accepted rather than delivered", async () => {
		seed();
		expect(await processWhatsAppJob(key)).toBe(true);
		expect(
			WhatsAppClient.prototype.sendDocument,
		).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				pdf,
				filename: "daily.pdf",
				caption: "Frozen caption",
			}),
		);
		expect(state.jobs[0]).toMatchObject({
			status: "accepted",
			provider_message_id: "EXAMPLE_MESSAGE_00000001",
			sent_at: null,
		});
		expect(await processWhatsAppJob(key)).toBe(true);
		expect(WhatsAppClient.prototype.sendDocument).toHaveBeenCalledOnce();
		expect(WhatsAppClient.prototype.getMessage).not.toHaveBeenCalled();
	});
	it("allows only one upload for concurrent consumers", async () => {
		seed();
		await Promise.all([processWhatsAppJob(key), processWhatsAppJob(key)]);
		expect(WhatsAppClient.prototype.sendDocument).toHaveBeenCalledOnce();
		expect(state.jobs[0].status).toBe("accepted");
	});
	it("keeps a busy group lease queued without uploading or sleeping", async () => {
		seed();
		state.settings.groupBusy = true;
		expect(await processWhatsAppJob(key)).toBe(false);
		expect(state.jobs[0]).toMatchObject({
			status: "queued",
			attempt_token: null,
			upload_started_at: null,
		});
		expect(state.jobs[0].available).toBe(false);
	});
	it.each([
		{ target_group_id: "120363000000000009@g.us" },
		{ instance_id: "7107999999" },
		{ sender_phone: "15555550102" },
		{ config_sha256: "changed" },
		{ participant_digest: `sha256:${"c".repeat(64)}` },
		{ pdf_sha256: "changed" },
		{ filename: "changed.pdf" },
	])(
		"suppresses changed frozen target/content before upload: %j",
		async (change) => {
			const row = seed();
			Object.assign(row, change);
			await processWhatsAppJob(key);
			expect(state.jobs[0].status).toBe("suppressed");
			expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
		},
	);
	it("checks the final mode/revision immediately before the upload boundary", async () => {
		seed();
		state.settings.revision = 1;
		await processWhatsAppJob(key);
		expect(state.jobs[0].status).toBe("suppressed");
		expect(state.jobs[0].upload_started_at).toBeNull();
	});
	it.each([
		new WhatsAppError("failed"),
		new WhatsAppError("uncertain"),
		new WhatsAppSuppressedError(),
		new Error("unknown"),
	])(
		"classifies pre-upload failure without exposing details",
		async (error) => {
			seed();
			vi.mocked(WhatsAppClient.prototype.sendDocument).mockRejectedValueOnce(
				error,
			);
			await processWhatsAppJob(key);
			expect(state.jobs[0].status).toBe(
				error instanceof WhatsAppSuppressedError
					? "suppressed"
					: error instanceof WhatsAppError
						? error.outcome
						: "failed",
			);
		},
	);
	it("marks unknown post-upload failures uncertain and never uploads again", async () => {
		seed();
		vi.mocked(WhatsAppClient.prototype.sendDocument).mockImplementationOnce(
			async (request) => {
				await request.beforeSend();
				throw new Error("private HTTP detail");
			},
		);
		await processWhatsAppJob(key);
		await processWhatsAppJob(key);
		expect(state.jobs[0].status).toBe("uncertain");
		expect(WhatsAppClient.prototype.sendDocument).toHaveBeenCalledOnce();
	});
	it("does not reuse stale sending attempts or call providers for invalid/missing jobs", async () => {
		const row = seed("sending");
		expect(await processWhatsAppJob(key)).toBe(false);
		row.stale = true;
		expect(await processWhatsAppJob(key)).toBe(true);
		expect(row.status).toBe("uncertain");
		expect(await processWhatsAppJob("bad")).toBe(false);
		state.jobs = [];
		expect(await processWhatsAppJob(key)).toBe(false);
		expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
	});
	it("does not claim when shutdown is already requested", async () => {
		seed();
		const abort = new AbortController();
		abort.abort();
		expect(await processWhatsAppJob(key, abort.signal)).toBe(false);
		expect(state.jobs[0].status).toBe("queued");
	});
});

describe("bounded reconciliation of known accepted IDs", () => {
	it.each(["sent", "delivered", "read"] as const)(
		"records sent only after a verified %s status",
		async (status) => {
			const row = seed("accepted");
			row.due = 1;
			vi.mocked(WhatsAppClient.prototype.getMessage).mockResolvedValueOnce({
				status,
			});
			await processWhatsAppJob(key);
			expect(row.status).toBe("sent");
			expect(row.sent_at).not.toBeNull();
			expect(state.settings.used).toBe(1);
			expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
		},
	);
	it.each(["failed", "suspended", "noAccount", "notInGroup"] as const)(
		"stores provider failure %s without resending",
		async (status) => {
			const row = seed("accepted");
			row.due = 1;
			vi.mocked(WhatsAppClient.prototype.getMessage).mockResolvedValueOnce({
				status,
			});
			await processWhatsAppJob(key);
			expect(row.status).toBe("failed");
			expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
		},
	);
	it("defers pending/not-yet-visible records and provider read failures, with a finite check cap", async () => {
		const row = seed("accepted");
		row.due = 1;
		vi.mocked(WhatsAppClient.prototype.getMessage).mockResolvedValueOnce({
			status: "pending",
		});
		await processWhatsAppJob(key);
		expect(row.status).toBe("accepted");
		expect(row.reconcile_attempts).toBe(1);
		expect(row.due).toBe(0);
		row.due = 1;
		row.reconcile_attempts = 5;
		vi.mocked(WhatsAppClient.prototype.getMessage).mockRejectedValueOnce(
			new WhatsAppError("failed"),
		);
		await processWhatsAppJob(key);
		expect(row.status).toBe("uncertain");
		expect(row.reconcile_attempts).toBe(6);
		expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
	});
	it("enforces the global monthly quota and renews it only at a new UTC month", async () => {
		const row = seed("accepted");
		row.due = 1;
		state.settings.used = 1000;
		await processWhatsAppJob(key);
		expect(WhatsAppClient.prototype.getMessage).not.toHaveBeenCalled();
		expect(row.status).toBe("accepted");
		row.due = 1;
		state.settings.month = "2026-09";
		await processWhatsAppJob(key);
		expect(state.settings.used).toBe(1);
		expect(WhatsAppClient.prototype.getMessage).toHaveBeenCalledOnce();
	});
	it("does not query a replaced provider identity or exceed the per-job check cap", async () => {
		const row = seed("accepted");
		row.due = 1;
		row.instance_id = "7107999999";
		await processWhatsAppJob(key);
		expect(row.status).toBe("uncertain");
		expect(WhatsAppClient.prototype.getMessage).not.toHaveBeenCalled();
		const capped = seed("accepted");
		capped.due = 1;
		capped.reconcile_attempts = 6;
		await processWhatsAppJob(key);
		expect(capped.status).toBe("uncertain");
	});
	it("updates real delivery audit only for its own frozen job/provider marker", async () => {
		const row = seed("accepted", "real");
		row.due = 1;
		await processWhatsAppJob(key);
		expect(state.legacy?.status).toBe("sent");
		expect(state.legacy?.attempt_count).toBe(1);
	});
});

describe("durable WhatsApp outbox", () => {
	async function drainLateDatabaseResult() {
		for (let turn = 0; turn < 12; turn++) await Promise.resolve();
	}
	function sweepStop(reason: "deadline" | "shutdown") {
		const deadline = new AbortController();
		const shutdown = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		return {
			signal: shutdown.signal,
			stop: () => (reason === "deadline" ? deadline : shutdown).abort(),
		};
	}
	it.each(["deadline", "shutdown"] as const)(
		"returns on %s during the first DB read and ignores its late result",
		async (reason) => {
			const gate = deferred<{ id: string }[]>();
			mocks.query.mockReturnValueOnce(gate.promise);
			const stop = sweepStop(reason);
			const pending = reconcileWhatsAppOutbox(
				new SQSClient({}),
				config().queueUrl,
				stop.signal,
			);
			const stopped = expect(pending).rejects.toThrow("sweep stopped");
			await drainLateDatabaseResult();
			expect(mocks.query).toHaveBeenCalledOnce();
			stop.stop();
			await stopped;
			gate.resolve([{ id: key }]);
			await drainLateDatabaseResult();
			expect(mocks.query).toHaveBeenCalledOnce();
			expect(mocks.execute).not.toHaveBeenCalled();
			expect(mocks.transaction).not.toHaveBeenCalled();
			expect(mocks.sqs).not.toHaveBeenCalled();
			expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
			expect(WhatsAppClient.prototype.getMessage).not.toHaveBeenCalled();
		},
	);
	it.each(["deadline", "shutdown"] as const)(
		"returns on %s during a fenced stale-audit write without starting later work",
		async (reason) => {
			const row = seed("sending");
			row.stale = true;
			const gate = deferred<void>();
			mocks.execute.mockImplementationOnce(async (sql, params) => {
				await gate.promise;
				return write(sql, params);
			});
			const stop = sweepStop(reason);
			const pending = reconcileWhatsAppOutbox(
				new SQSClient({}),
				config().queueUrl,
				stop.signal,
			);
			const stopped = expect(pending).rejects.toThrow("sweep stopped");
			await drainLateDatabaseResult();
			expect(mocks.execute).toHaveBeenCalledOnce();
			stop.stop();
			await stopped;
			gate.resolve();
			await drainLateDatabaseResult();
			expect(row.status).toBe("uncertain");
			expect(mocks.query).toHaveBeenCalledOnce();
			expect(mocks.transaction).not.toHaveBeenCalled();
			expect(mocks.sqs).not.toHaveBeenCalled();
			expect(WhatsAppClient.prototype.sendDocument).not.toHaveBeenCalled();
		},
	);
	it.each(["deadline", "shutdown"] as const)(
		"returns on %s during audit synchronization and cannot write after its late read",
		async (reason) => {
			seed("sending", "real").stale = true;
			const before = structuredClone(state.legacy);
			const gate = deferred<void>();
			mocks.txQueryOne.mockImplementationOnce(
				async (_connection, sql, params) => {
					await gate.promise;
					return read(sql, params)[0] ?? null;
				},
			);
			const stop = sweepStop(reason);
			const pending = reconcileWhatsAppOutbox(
				new SQSClient({}),
				config().queueUrl,
				stop.signal,
			);
			const stopped = expect(pending).rejects.toThrow("sweep stopped");
			await drainLateDatabaseResult();
			expect(mocks.txQueryOne).toHaveBeenCalledOnce();
			stop.stop();
			await stopped;
			gate.resolve();
			await drainLateDatabaseResult();
			expect(state.legacy).toEqual(before);
			expect(mocks.txExecute).not.toHaveBeenCalled();
			expect(mocks.query).toHaveBeenCalledOnce();
			expect(mocks.sqs).not.toHaveBeenCalled();
			expect(WhatsAppClient.prototype.getMessage).not.toHaveBeenCalled();
		},
	);
	it("reconciles stale claims to uncertain and republishes only queued work", async () => {
		const stale = seed("sending");
		stale.stale = true;
		const queued = { ...job(), id: otherKey };
		state.jobs.push(queued);
		await reconcileWhatsAppOutbox(new SQSClient({}), config().queueUrl);
		expect(stale.status).toBe("uncertain");
		expect(mocks.sqs).toHaveBeenCalledOnce();
		expect(
			mocks.sqs.mock.calls[0][0].input.Entries.map(
				(entry: { Id: string }) => entry.Id,
			),
		).toEqual([otherKey]);
	});
	it("does not poll or publish after shutdown or to another queue", async () => {
		const abort = new AbortController();
		abort.abort();
		await reconcileWhatsAppOutbox(
			new SQSClient({}),
			config().queueUrl,
			abort.signal,
		);
		expect(mocks.query).not.toHaveBeenCalled();
		await expect(
			reconcileWhatsAppOutbox(new SQSClient({}), "https://example.com/queue"),
		).rejects.toThrow();
	});
	it("bounds every batch under one shared publication budget and retains rows on expiry", async () => {
		state.jobs = Array.from({ length: 11 }, (_, index) => ({
			...job(),
			id: index === 0 ? key : `job-${index}`,
		}));
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		mocks.sqs.mockImplementationOnce(async (command) => {
			deadline.abort();
			return {
				Successful: command.input.Entries.map((entry: { Id: string }) => ({
					Id: entry.Id,
				})),
			};
		});
		await expect(
			reconcileWhatsAppOutbox(new SQSClient({}), config().queueUrl),
		).rejects.toThrow();
		expect(mocks.sqs).toHaveBeenCalledOnce();
		expect(state.jobs.every((row) => row.status === "queued")).toBe(true);
	});
});
