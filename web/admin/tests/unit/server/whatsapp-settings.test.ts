import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
	txQuery: vi.fn(),
	txQueryOne: vi.fn(),
	txExecute: vi.fn(),
}));
vi.mock("~/server/db", () => mocks);

import {
	WhatsAppClient,
	WhatsAppDeferredError,
	WhatsAppError,
	WhatsAppSuppressedError,
} from "~/server/whatsapp-client.server";
import * as service from "~/server/whatsapp-settings.server";

const token = "a".repeat(48);
const digest = `sha256:${"b".repeat(64)}`;
const queue = "https://sqs.il-central-1.amazonaws.com/123456789012/bulletin";
function configure() {
	for (const [name, value] of Object.entries({
		INSTANCE_ID: "7107123456",
		API_TOKEN: token,
		API_URL: "https://api.green-api.com",
		MEDIA_URL: "https://media.green-api.com",
		SENDER_PHONE: "15555550101",
		TEST_GROUP_ID: "120363000000000001@g.us",
		TEST_PARTICIPANT_DIGEST: digest,
	}))
		vi.stubEnv(`BULLETIN_WHATSAPP_${name}`, value);
	vi.stubEnv("BULLETIN_EMAIL_QUEUE_URL", queue);
	vi.stubEnv("BULLETIN_SES_ACCOUNT_ID", "123456789012");
	vi.stubEnv("BULLETIN_SES_REGION", "il-central-1");
}
function runtime(real = false) {
	configure();
	if (real)
		vi.stubEnv("BULLETIN_WHATSAPP_REAL_GROUP_ID", "120363000000000002@g.us");
	const result = service.loadWhatsAppRuntime();
	if (!result) throw new Error("fixture");
	return result;
}
function cached(
	config = runtime(),
	audience: "test" | "real" = "test",
): service.CachedWhatsAppTarget {
	return {
		audience,
		config_sha256: service.whatsAppConfigDigest(config, audience),
		verified: 1,
		connection_state: "authorized",
		group_id: service.targetGroupId(config, audience),
		title: `Example ${audience}`,
		member_count: 2,
		sender_id: "15555550101@c.us",
		sender_phone: config.expectedSenderPhone,
		participant_digest: digest,
		checked_at: new Date(Date.now() - 1000).toISOString(),
		expires_at: new Date(Date.now() + 600_000).toISOString(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	for (const name of [
		"INSTANCE_ID",
		"API_TOKEN",
		"API_URL",
		"MEDIA_URL",
		"SENDER_PHONE",
		"TEST_GROUP_ID",
		"TEST_PARTICIPANT_DIGEST",
		"REAL_GROUP_ID",
	])
		vi.stubEnv(`BULLETIN_WHATSAPP_${name}`, "");
	mocks.transaction.mockImplementation((callback) => callback({}));
	mocks.txExecute.mockResolvedValue({ affectedRows: 1 });
	mocks.execute.mockResolvedValue({ affectedRows: 1 });
});
afterEach(() => vi.restoreAllMocks());

describe("WhatsApp server-owned runtime", () => {
	it("is absent without configuration and does not query or fetch", () => {
		const provider = vi.spyOn(WhatsAppClient.prototype, "verifyTarget");
		expect(service.loadWhatsAppRuntime()).toBeNull();
		expect(mocks.queryOne).not.toHaveBeenCalled();
		expect(provider).not.toHaveBeenCalled();
	});
	it("uses only the injected secret and existing queue, with real optional", () => {
		const config = runtime();
		expect(config).toMatchObject({
			apiToken: token,
			queueUrl: queue,
			realGroupId: null,
			testParticipantDigest: digest,
		});
		expect(() => service.targetGroupId(config, "real")).toThrow(
			WhatsAppSuppressedError,
		);
		expect(service.targetGroupId(config, "test")).toBe(config.testGroupId);
		expect(mocks.query).not.toHaveBeenCalled();
	});
	it.each([
		["BULLETIN_WHATSAPP_INSTANCE_ID", ""],
		["BULLETIN_WHATSAPP_INSTANCE_ID", "invalid"],
		["BULLETIN_WHATSAPP_API_TOKEN", ""],
		["BULLETIN_WHATSAPP_API_TOKEN", "private token"],
		["BULLETIN_WHATSAPP_SENDER_PHONE", "+15555550101"],
		["BULLETIN_WHATSAPP_TEST_GROUP_ID", "15555550101@c.us"],
		["BULLETIN_WHATSAPP_TEST_PARTICIPANT_DIGEST", "not-a-hash"],
		["BULLETIN_WHATSAPP_REAL_GROUP_ID", "120363000000000001@g.us"],
		["BULLETIN_WHATSAPP_REAL_GROUP_ID", "not-a-group"],
		["BULLETIN_WHATSAPP_API_URL", "https://example.com"],
		["BULLETIN_EMAIL_QUEUE_URL", "invalid"],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"http://sqs.il-central-1.amazonaws.com/123456789012/bulletin",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/000000000000/bulletin",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com:8443/123456789012/bulletin",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin/extra",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin?extra=1",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin#fragment",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://user@sqs.il-central-1.amazonaws.com/123456789012/bulletin",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/123456789012/",
		],
		["BULLETIN_SES_ACCOUNT_ID", ""],
		["BULLETIN_SES_ACCOUNT_ID", "invalid"],
	])(
		"refuses invalid %s without exposing the injected secret",
		(name, value) => {
			configure();
			vi.stubEnv(name, value);
			expect(() => service.loadWhatsAppRuntime()).toThrow();
			try {
				service.loadWhatsAppRuntime();
			} catch (error) {
				expect(String(error)).not.toContain(token);
			}
			expect(mocks.queryOne).not.toHaveBeenCalled();
		},
	);
	it("does not retrieve a secret parameter from the application", () => {
		configure();
		vi.stubEnv("BULLETIN_WHATSAPP_API_TOKEN", "");
		vi.stubEnv("BULLETIN_WHATSAPP_API_TOKEN_PARAMETER", "/private/example");
		expect(() => service.loadWhatsAppRuntime()).toThrow();
	});
	it("keeps token material out of persisted fingerprints and isolates audience targets", () => {
		const config = runtime(true);
		expect(
			service.whatsAppConfigDigest(
				{ ...config, apiToken: "c".repeat(48) },
				"test",
			),
		).toBe(service.whatsAppConfigDigest(config, "test"));
		expect(service.whatsAppConfigDigest(config, "test")).not.toBe(
			service.whatsAppConfigDigest(config, "real"),
		);
	});
});

describe("persisted settings and cached verification", () => {
	it.each([
		null,
		{ audience: "other", revision: 0 },
		{ audience: "test", revision: -1 },
		{ audience: "test", revision: "9007199254740992" },
	])("never fabricates a default from invalid settings %j", (row) =>
		expect(() => service.settingsFromRow(row)).toThrow(),
	);
	it("reads a durable real revision even when provider configuration is unavailable", async () => {
		mocks.queryOne.mockResolvedValue({ audience: "real", revision: "7" });
		expect(await service.readWhatsAppSettings()).toEqual({
			audience: "real",
			revision: 7,
		});
	});
	it("filters other configurations and unknown audience rows, supporting transactional reads", async () => {
		const config = runtime();
		const target = cached(config);
		const rows = [
			target,
			{ ...target, audience: "invalid" },
			{ ...target, audience: "real" },
			{ ...target, config_sha256: "x" },
		];
		mocks.query.mockResolvedValue(rows);
		mocks.txQuery.mockResolvedValue(rows);
		expect(await service.readWhatsAppTargets(config)).toEqual({
			test: target,
			real: null,
		});
		expect(await service.readWhatsAppTargets(config, {} as never)).toEqual({
			test: target,
			real: null,
		});
		expect(mocks.txQuery.mock.calls[0][1]).toContain("FOR UPDATE");
	});
	it("exposes only display fields and makes no provider call on cache reads", async () => {
		const config = runtime(true);
		const test = cached(config);
		const real = cached(config, "real");
		mocks.query.mockResolvedValue([test, real]);
		const provider = vi.spyOn(WhatsAppClient.prototype, "verifyTarget");
		const targets = await service.readWhatsAppTargets(config);
		expect(service.whatsAppReadiness(config, targets, "test")).toEqual({
			configured: true,
			canSend: true,
			canUseReal: true,
			blockers: [],
		});
		expect(service.whatsAppTargetView(test)).toEqual({
			title: "Example test",
			memberCount: 2,
			verifiedAt: test.checked_at,
		});
		expect(provider).not.toHaveBeenCalled();
	});
	it.each([
		{ verified: 0 },
		{ connection_state: "blocked" },
		{ config_sha256: "different" },
		{ group_id: "120363000000000002@g.us" },
		{ title: "" },
		{ title: "x".repeat(256) },
		{ sender_id: "" },
		{ sender_phone: "15555550102" },
		{ participant_digest: "invalid" },
		{ member_count: 0 },
		{ member_count: 3 },
		{ checked_at: "invalid" },
		{ checked_at: "2099-01-01T00:00:00Z" },
		{ expires_at: "2000-01-01T00:00:00Z" },
	])("refuses stale or changed test metadata %j", (change) => {
		const config = runtime();
		const target = {
			...cached(config),
			...change,
		} as service.CachedWhatsAppTarget;
		expect(service.usableWhatsAppTarget(config, "test", target)).toBe(false);
		expect(
			service.whatsAppReadiness(config, { test: target, real: null }, "test")
				.canSend,
		).toBe(false);
	});
	it("allows a verified real group to grow without the test-only two-member restriction", () => {
		const config = runtime(true);
		const row = { ...cached(config, "real"), member_count: 200 };
		expect(service.usableWhatsAppTarget(config, "real", row)).toBe(true);
	});
	it("returns safe unknown and absent display values for incomplete cached metadata", () => {
		const config = runtime();
		const row = {
			...cached(config),
			connection_state: "private-provider-detail",
			checked_at: "bad",
			expires_at: "bad",
			title: null,
		} as unknown as service.CachedWhatsAppTarget;
		expect(service.whatsAppVerification({ test: null, real: null })).toEqual({
			connectionState: "unknown",
			checkedAt: null,
			expiresAt: null,
		});
		expect(service.whatsAppVerification({ test: row, real: null })).toEqual({
			connectionState: "unknown",
			checkedAt: null,
			expiresAt: null,
		});
		expect(service.whatsAppTargetView(row)).toBeNull();
		expect(
			service.whatsAppTargetView({
				...row,
				title: "Old target",
				member_count: Number.NaN,
				verified: false,
			}),
		).toEqual({ title: "Old target", memberCount: null, verifiedAt: null });
		expect(
			service.whatsAppReadiness(config, { test: null, real: null }, "real")
				.blockers,
		).toContain("הקבוצה הרגילה טרם הוגדרה");
	});
});

describe("explicit provider verification and global group lease", () => {
	it("reserves the rate slot transactionally and releases it once using the exact token", async () => {
		mocks.txQueryOne.mockResolvedValue({
			audience: "test",
			revision: 0,
			busy: 0,
		});
		const release = await service.reserveWhatsAppGroupLookup(
			new AbortController().signal,
		);
		const tokenValue = mocks.txExecute.mock.calls[0][2][0];
		expect(tokenValue).toMatch(/^[a-f0-9-]{36}$/);
		await release();
		await release();
		expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("group_lookup_token = ?"),
			[tokenValue],
		);
	});
	it("defers a busy lease without requesting provider data or sleeping", async () => {
		mocks.txQueryOne.mockResolvedValue({
			audience: "test",
			revision: 0,
			busy: 1,
		});
		await expect(
			service.reserveWhatsAppGroupLookup(new AbortController().signal),
		).rejects.toBeInstanceOf(WhatsAppDeferredError);
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});
	it("does not allocate a lease when shutdown was already requested", async () => {
		const abort = new AbortController();
		abort.abort();
		await expect(
			service.reserveWhatsAppGroupLookup(abort.signal),
		).rejects.toThrow();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
	it("cancels before reservation if shutdown occurs while acquiring the database lock", async () => {
		const abort = new AbortController();
		mocks.txQueryOne.mockImplementation(async () => {
			abort.abort();
			return { audience: "test", revision: 0, busy: 0 };
		});
		await expect(
			service.reserveWhatsAppGroupLookup(abort.signal),
		).rejects.toThrow();
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});
	it("persists only verified metadata after the explicit provider action", async () => {
		const config = runtime();
		const target = {
			groupId: config.testGroupId,
			title: "Example",
			size: 2,
			senderId: "15555550101@c.us",
			senderPhone: config.expectedSenderPhone,
			participantDigest: digest,
			outgoingStatusesEnabled: true as const,
		};
		const verify = vi
			.spyOn(WhatsAppClient.prototype, "verifyTarget")
			.mockResolvedValue(target);
		expect(await service.verifyWhatsAppTarget(config, "test")).toEqual(target);
		expect(verify).toHaveBeenCalledExactlyOnceWith({
			groupId: config.testGroupId,
			audience: "test",
			expectedParticipantDigest: digest,
			beforeGroupData: service.reserveWhatsAppGroupLookup,
		});
		expect(mocks.execute.mock.calls[0][1]).not.toContain(token);
		expect(mocks.execute.mock.calls[0][0]).toContain("verified = TRUE");
	});
	it("does not persist false provider failure when the global lease is busy", async () => {
		const config = runtime();
		vi.spyOn(WhatsAppClient.prototype, "verifyTarget").mockRejectedValue(
			new WhatsAppDeferredError(),
		);
		await expect(
			service.verifyWhatsAppTarget(config, "test"),
		).rejects.toBeInstanceOf(WhatsAppDeferredError);
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it.each([
		new WhatsAppError("failed", "blocked"),
		new Error("private-provider-detail"),
	])(
		"stores sanitized failure metadata without provider error text",
		async (error) => {
			const config = runtime(true);
			vi.spyOn(WhatsAppClient.prototype, "verifyTarget").mockRejectedValue(
				error,
			);
			await expect(service.verifyWhatsAppTarget(config, "real")).rejects.toBe(
				error,
			);
			expect(mocks.execute.mock.calls[0][0]).toContain("verified = FALSE");
			expect(mocks.execute.mock.calls[0][1]).not.toContain(
				"private-provider-detail",
			);
		},
	);
});
