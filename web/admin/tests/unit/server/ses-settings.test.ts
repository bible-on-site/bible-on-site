import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
	txExecute: vi.fn(),
	txQueryOne: vi.fn(),
	ensureSubscribed: vi.fn(),
	unsubscribe: vi.fn(),
	sesConfig: vi.fn(),
	sdkConfig: vi.fn(),
	sdkSend: vi.fn(),
	destroy: vi.fn(),
	wait: vi.fn(),
	latestJob: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/db", () => mocks);
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.wait }));
vi.mock("~/server/ses-delivery.server", () => ({
	readLatestEmailJob: mocks.latestJob,
}));
vi.mock("~/server/ses-client.server", () => ({
	SesSuppressedError: class extends Error {},
	SesClient: class {
		constructor(config: unknown) {
			mocks.sesConfig(config);
		}
		ensureSubscribedContact = mocks.ensureSubscribed;
		unsubscribeContact = mocks.unsubscribe;
	},
}));
vi.mock("@aws-sdk/client-sesv2", () => ({
	SESv2Client: class {
		constructor(config: unknown) {
			mocks.sdkConfig(config);
		}
		send = mocks.sdkSend;
		destroy = mocks.destroy;
	},
	GetAccountCommand: class {
		kind = "account";
		constructor(public input: unknown) {}
	},
	GetEmailIdentityCommand: class {
		kind = "identity";
		constructor(public input: unknown) {}
	},
}));

const environment = {
	BULLETIN_SES_FROM: "sender@example.com",
	BULLETIN_SES_CONTACT_LIST: "bulletin-contacts",
	BULLETIN_SES_CONFIGURATION_SET: "bulletin-events",
	BULLETIN_EMAIL_QUEUE_URL:
		"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin-email",
	BULLETIN_SES_ACCOUNT_ID: "123456789012",
};
const connection = {};
const now = "2026-10-28T08:00:00.000Z";
const consent = {
	email: "reader@example.com",
	audience: "test" as const,
	action: "confirm" as const,
	source: "Explicit newsletter signup",
};
let settings: typeof import("~/server/ses-settings.server");
let account: Record<string, unknown>;
let identity: Record<string, unknown>;

function configured() {
	for (const [name, value] of Object.entries(environment))
		vi.stubEnv(name, value);
}

function latest(overrides: Record<string, unknown> = {}) {
	return {
		audience: "test",
		revision: 3,
		consent_status: "confirmed",
		...overrides,
	};
}

function slot(overrides: Record<string, unknown> = {}) {
	return {
		audience: "test",
		revision: 3,
		next_send_at: null,
		now_at: now,
		...overrides,
	};
}

function mockSlot(value = slot()) {
	mocks.txQueryOne.mockImplementation(async (_conn, sql: string) =>
		sql.includes("email_settings")
			? value
			: { audience: "test", consent_status: "confirmed" },
	);
	mocks.queryOne.mockResolvedValue(latest());
}

beforeEach(async () => {
	vi.resetModules();
	vi.resetAllMocks();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(now);
	for (const name of [
		...Object.keys(environment),
		"BULLETIN_SES_REGION",
		"AWS_REGION",
		"BULLETIN_SES_REPLY_TO",
		"BULLETIN_SES_SENDER_NAME",
	]) {
		vi.stubEnv(name, undefined);
	}
	configured();
	account = { SendingEnabled: true, ProductionAccessEnabled: false };
	identity = {
		VerifiedForSendingStatus: true,
		DkimAttributes: {
			Status: "SUCCESS",
			SigningEnabled: true,
			SigningAttributesOrigin: "AWS_SES",
		},
	};
	mocks.sdkSend.mockImplementation(async (command: { kind: string }) =>
		command.kind === "account" ? account : identity,
	);
	mocks.transaction.mockImplementation(async (fn) => fn(connection));
	mocks.query.mockResolvedValue([]);
	mocks.execute.mockResolvedValue({ affectedRows: 1 });
	mocks.txExecute.mockResolvedValue({ affectedRows: 1 });
	mocks.wait.mockResolvedValue(undefined);
	mocks.ensureSubscribed.mockResolvedValue("subscribed");
	mocks.unsubscribe.mockResolvedValue(undefined);
	settings = await import("~/server/ses-settings.server");
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("SES runtime and account readiness", () => {
	it.each(Object.keys(environment))(
		"disables delivery when %s is absent",
		(name) => {
			vi.stubEnv(name, undefined);
			expect(settings.loadEmailRuntime()).toBeNull();
			expect(mocks.sdkSend).not.toHaveBeenCalled();
		},
	);

	it("reports unconfigured delivery without making provider calls", async () => {
		vi.stubEnv("BULLETIN_SES_FROM", "");
		expect(await settings.getEmailReadiness()).toMatchObject({
			configured: false,
			canSend: false,
			canUseReal: false,
		});
		expect(mocks.sdkSend).not.toHaveBeenCalled();
	});

	it("uses explicit region, sender and reply settings, trimming identifiers", () => {
		vi.stubEnv("BULLETIN_SES_FROM", " sender@example.com ");
		vi.stubEnv("BULLETIN_SES_REGION", "eu-west-1");
		vi.stubEnv("BULLETIN_SES_REPLY_TO", "reply@example.com");
		vi.stubEnv("BULLETIN_SES_SENDER_NAME", "Newsletter");
		expect(settings.loadEmailRuntime()).toMatchObject({
			region: "eu-west-1",
			fromAddress: "sender@example.com",
			replyToAddress: "reply@example.com",
			senderName: "Newsletter",
			accountId: environment.BULLETIN_SES_ACCOUNT_ID,
		});
	});

	it("falls back through AWS region and the sender reply address", () => {
		vi.stubEnv("AWS_REGION", "eu-central-1");
		expect(settings.loadEmailRuntime()).toMatchObject({
			region: "eu-central-1",
			replyToAddress: "sender@example.com",
		});
		vi.stubEnv("AWS_REGION", undefined);
		expect(settings.loadEmailRuntime()?.region).toBe("il-central-1");
	});

	it.each([
		["BULLETIN_SES_ACCOUNT_ID", "not-an-account"],
		["BULLETIN_SES_ACCOUNT_ID", "12345678901"],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"http://sqs.il-central-1.amazonaws.com/123456789012/bulletin",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/999999999999/bulletin",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com.evil.test/123456789012/bulletin",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin?other=queue",
		],
	])("rejects invalid account/queue setting %s", (name, value) => {
		vi.stubEnv(name, value);
		expect(() => settings.loadEmailRuntime()).toThrow();
		expect(mocks.sdkSend).not.toHaveBeenCalled();
	});

	it("permits tests in the sandbox but does not permit the real audience", async () => {
		expect(await settings.getEmailReadiness()).toEqual({
			configured: true,
			canSend: true,
			canUseReal: false,
			blockers: [],
		});
		expect(mocks.sdkConfig).toHaveBeenCalledWith({
			region: "il-central-1",
			maxAttempts: 1,
		});
		expect(mocks.sdkSend.mock.calls.map(([command]) => command.input)).toEqual([
			{},
			{ EmailIdentity: "example.com" },
		]);
		expect(mocks.destroy).toHaveBeenCalledOnce();
	});

	it("requires production access as well as sending and Easy DKIM", async () => {
		account.ProductionAccessEnabled = true;
		expect(await settings.getEmailReadiness()).toMatchObject({
			canSend: true,
			canUseReal: true,
		});
	});

	it.each([
		{ VerifiedForSendingStatus: false },
		{ DkimAttributes: undefined },
		{
			DkimAttributes: {
				Status: "PENDING",
				SigningEnabled: true,
				SigningAttributesOrigin: "AWS_SES",
			},
		},
		{
			DkimAttributes: {
				Status: "SUCCESS",
				SigningEnabled: false,
				SigningAttributesOrigin: "AWS_SES",
			},
		},
		{
			DkimAttributes: {
				Status: "SUCCESS",
				SigningEnabled: true,
				SigningAttributesOrigin: "EXTERNAL",
			},
		},
		{ DkimAttributes: { Status: "SUCCESS", SigningEnabled: true } },
	])("blocks delivery without verified Easy DKIM %j", async (override) => {
		identity = { ...identity, ...override };
		const result = await settings.getEmailReadiness();
		expect(result).toMatchObject({
			configured: true,
			canSend: false,
			canUseReal: false,
		});
		expect(result.blockers.length).toBeGreaterThan(0);
	});

	it("blocks an account whose sending is disabled", async () => {
		account = { SendingEnabled: false, ProductionAccessEnabled: true };
		expect(await settings.getEmailReadiness()).toMatchObject({
			canSend: false,
			canUseReal: false,
		});
	});

	it("returns a safe readiness failure and releases the client after API errors", async () => {
		mocks.sdkSend.mockRejectedValue(new Error("private provider diagnostics"));
		const result = await settings.getEmailReadiness();
		expect(result).toMatchObject({
			configured: true,
			canSend: false,
			canUseReal: false,
		});
		expect(JSON.stringify(result)).not.toContain(
			"private provider diagnostics",
		);
		expect(mocks.destroy).toHaveBeenCalledOnce();
	});

	it("shares readiness calls, refreshes expired data and separates sender identities", async () => {
		await Promise.all([
			settings.getEmailReadiness(),
			settings.getEmailReadiness(),
		]);
		expect(mocks.sdkSend).toHaveBeenCalledTimes(2);
		vi.setSystemTime(Date.now() + 30_001);
		await settings.getEmailReadiness();
		expect(mocks.sdkSend).toHaveBeenCalledTimes(4);
		vi.stubEnv("BULLETIN_SES_FROM", "different@another.example.com");
		await settings.getEmailReadiness();
		expect(mocks.sdkSend).toHaveBeenCalledTimes(6);
		expect(mocks.sdkSend.mock.calls[5][0].input).toEqual({
			EmailIdentity: "another.example.com",
		});
	});
});

describe("audience settings and subscriber overview", () => {
	it("returns a safe test-only empty panel before provider setup", async () => {
		vi.stubEnv("BULLETIN_SES_FROM", undefined);
		expect(await settings.getBulletinEmailState("2026-10-28")).toMatchObject({
			settings: { audience: "test", revision: 0 },
			readiness: { configured: false, canSend: false, canUseReal: false },
			testRecipients: [],
			realRecipients: 0,
			unverifiedRecipients: 0,
			job: null,
		});
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.queryOne).not.toHaveBeenCalled();
		expect(mocks.latestJob).not.toHaveBeenCalled();
	});

	it("combines the persisted audience, consent counts and latest job", async () => {
		mocks.queryOne.mockResolvedValue({ audience: "test", revision: 3 });
		mocks.query.mockResolvedValue([
			{
				email: "reader@example.com",
				audience: "test",
				consent_status: "confirmed",
			},
		]);
		const job = { id: "job", status: "accepted" };
		mocks.latestJob.mockResolvedValue(job);
		expect(await settings.getBulletinEmailState("2026-10-28")).toMatchObject({
			settings: { audience: "test", revision: 3 },
			readiness: { canSend: true, canUseReal: false },
			testRecipients: ["reader@example.com"],
			realRecipients: 0,
			unverifiedRecipients: 0,
			job,
		});
		expect(mocks.latestJob).toHaveBeenCalledWith("2026-10-28", "test");
	});

	it("reads the persisted audience and numeric revision", async () => {
		mocks.queryOne.mockResolvedValue({ audience: "test", revision: "3" });
		expect(await settings.readAudienceSettings()).toEqual({
			audience: "test",
			revision: 3,
		});
		mocks.queryOne.mockResolvedValue(null);
		await expect(settings.readAudienceSettings()).rejects.toThrow();
	});

	it("exposes confirmed recipients separately from pending and suppressed contacts", async () => {
		mocks.query.mockResolvedValue([
			{
				email: "test@example.com",
				audience: "test",
				consent_status: "confirmed",
			},
			{
				email: "test-pending@example.com",
				audience: "test",
				consent_status: "pending",
			},
			{
				email: "real@example.com",
				audience: "real",
				consent_status: "confirmed",
			},
			{
				email: "pending@example.com",
				audience: "real",
				consent_status: "pending",
			},
			...["unsubscribed", "bounced", "complained"].map((consent_status) => ({
				email: `${consent_status}@example.com`,
				audience: "real",
				consent_status,
			})),
		]);
		expect(await settings.subscriberSummary()).toEqual({
			testRecipients: ["test@example.com"],
			realRecipients: 1,
			unverifiedRecipients: 1,
		});
	});

	it("switches audience using the locked persisted revision", async () => {
		mocks.txQueryOne
			.mockResolvedValueOnce({ audience: "real", revision: 3 })
			.mockResolvedValueOnce({ n: 0 });
		expect(
			await settings.setEmailAudience({
				audience: "test",
				revision: 3,
				confirmReal: false,
			}),
		).toEqual({ audience: "test", revision: 4 });
		expect(mocks.txQueryOne.mock.calls[0][1]).toContain("FOR UPDATE");
		expect(mocks.txExecute.mock.calls[0][2]).toEqual(["test"]);
	});

	it("does not create a new revision when the requested audience is already selected", async () => {
		mocks.txQueryOne
			.mockResolvedValueOnce({ audience: "test", revision: "3" })
			.mockResolvedValueOnce({ n: "0" });
		expect(
			await settings.setEmailAudience({
				audience: "test",
				revision: 3,
				confirmReal: false,
			}),
		).toEqual({ audience: "test", revision: 3 });
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});

	it.each([null, { audience: "test", revision: 4 }])(
		"rejects missing or stale settings %j",
		async (row) => {
			mocks.txQueryOne.mockResolvedValue(row);
			await expect(
				settings.setEmailAudience({
					audience: "test",
					revision: 3,
					confirmReal: false,
				}),
			).rejects.toThrow();
			expect(mocks.txExecute).not.toHaveBeenCalled();
		},
	);

	it("prevents audience changes while a recipient is being sent", async () => {
		mocks.txQueryOne
			.mockResolvedValueOnce({ audience: "real", revision: 3 })
			.mockResolvedValueOnce({ n: 1 });
		await expect(
			settings.setEmailAudience({
				audience: "test",
				revision: 3,
				confirmReal: false,
			}),
		).rejects.toThrow();
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});

	it("requires explicit real-audience confirmation before reading provider state", async () => {
		await expect(
			settings.setEmailAudience({
				audience: "real",
				revision: 3,
				confirmReal: false,
			}),
		).rejects.toThrow();
		expect(mocks.sdkSend).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("requires production approval and confirmed subscribers before selecting real delivery", async () => {
		mocks.query.mockResolvedValue([
			{
				audience: "real",
				consent_status: "confirmed",
				email: "reader@example.com",
			},
		]);
		await expect(
			settings.setEmailAudience({
				audience: "real",
				revision: 3,
				confirmReal: true,
			}),
		).rejects.toThrow();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("does not select the real audience when all imported contacts are pending", async () => {
		account.ProductionAccessEnabled = true;
		mocks.query.mockResolvedValue([
			{
				audience: "real",
				consent_status: "pending",
				email: "reader@example.com",
			},
		]);
		await expect(
			settings.setEmailAudience({
				audience: "real",
				revision: 3,
				confirmReal: true,
			}),
		).rejects.toThrow();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("permits an explicitly approved real audience only after all gates pass", async () => {
		account.ProductionAccessEnabled = true;
		mocks.query.mockResolvedValue([
			{
				audience: "real",
				consent_status: "confirmed",
				email: "reader@example.com",
			},
		]);
		mocks.txQueryOne
			.mockResolvedValueOnce({ audience: "test", revision: 3 })
			.mockResolvedValueOnce({ n: 0 });
		expect(
			await settings.setEmailAudience({
				audience: "real",
				revision: 3,
				confirmReal: true,
			}),
		).toEqual({ audience: "real", revision: 4 });
	});

	it("cannot change audiences before the provider is configured", async () => {
		vi.stubEnv("BULLETIN_SES_FROM", undefined);
		await expect(
			settings.setEmailAudience({
				audience: "test",
				revision: 3,
				confirmReal: false,
			}),
		).rejects.toThrow();
	});
});

describe("consent management", () => {
	it.each(["unsubscribed", "bounced", "complained"])(
		"never restores a locally %s contact automatically",
		async (consent_status) => {
			mocks.queryOne.mockResolvedValue({ consent_status });
			await expect(settings.changeSubscriber(consent)).rejects.toThrow();
			expect(mocks.ensureSubscribed).not.toHaveBeenCalled();
			expect(mocks.execute).not.toHaveBeenCalled();
		},
	);

	it("does not persist consent when SES records a recipient opt-out", async () => {
		mocks.queryOne.mockResolvedValue(null);
		mocks.ensureSubscribed.mockResolvedValue("opted_out");
		await expect(settings.changeSubscriber(consent)).rejects.toThrow();
		expect(mocks.execute).not.toHaveBeenCalled();
	});

	it("persists verified consent after provider setup with atomic suppression and event-time guards", async () => {
		mocks.queryOne.mockResolvedValue({ consent_status: "pending" });
		await settings.changeSubscriber(consent);
		expect(mocks.ensureSubscribed).toHaveBeenCalledWith(consent.email, "test");
		expect(mocks.ensureSubscribed.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.execute.mock.invocationCallOrder[0],
		);
		const [sql, params] = mocks.execute.mock.calls[0];
		expect(params).toEqual([consent.email, "test", consent.source]);
		expect(sql).toContain("'unsubscribed','bounced','complained'");
		expect(sql).toContain("last_event_at");
	});

	it("leaves local consent untouched if provider setup fails", async () => {
		mocks.queryOne.mockResolvedValue(null);
		mocks.ensureSubscribed.mockRejectedValue(new Error("Provider unavailable"));
		await expect(settings.changeSubscriber(consent)).rejects.toThrow();
		expect(mocks.execute).not.toHaveBeenCalled();
	});

	it("persists global unsubscribe before calling SES and preserves bounced/complained guards", async () => {
		await settings.changeSubscriber({ ...consent, action: "unsubscribe" });
		const [sql, params] = mocks.execute.mock.calls[0];
		expect(params).toEqual([consent.email]);
		expect(sql).not.toContain("AND audience");
		expect(sql).toContain("'bounced','complained'");
		expect(sql).toContain("last_event_at");
		expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.unsubscribe.mock.invocationCallOrder[0],
		);
		expect(mocks.unsubscribe).toHaveBeenCalledWith(consent.email, "test");
	});

	it("keeps the durable unsubscribe even if the native provider update fails", async () => {
		mocks.unsubscribe.mockRejectedValue(new Error("Provider unavailable"));
		await expect(
			settings.changeSubscriber({ ...consent, action: "unsubscribe" }),
		).rejects.toThrow();
		expect(mocks.execute).toHaveBeenCalledOnce();
		expect(mocks.ensureSubscribed).not.toHaveBeenCalled();
	});

	it("does not contact SES if the local unsubscribe cannot be persisted", async () => {
		mocks.execute.mockRejectedValue(new Error("Database unavailable"));
		await expect(
			settings.changeSubscriber({ ...consent, action: "unsubscribe" }),
		).rejects.toThrow();
		expect(mocks.unsubscribe).not.toHaveBeenCalled();
	});

	it("cannot manage contacts when the provider configuration is missing", async () => {
		vi.stubEnv("BULLETIN_SES_FROM", undefined);
		await expect(settings.changeSubscriber(consent)).rejects.toThrow();
		expect(mocks.ensureSubscribed).not.toHaveBeenCalled();
	});
});

describe("send-slot reservation", () => {
	it("reserves one slot with both settings and consent locked and checks them again", async () => {
		mockSlot();
		await settings.reserveSendSlot("test", 3, 42);
		expect(
			mocks.txQueryOne.mock.calls.every(([, sql]) =>
				sql.includes("FOR UPDATE"),
			),
		).toBe(true);
		expect(mocks.txQueryOne.mock.calls[1][2]).toEqual([42]);
		expect(mocks.txQueryOne.mock.calls[0][1]).toContain(
			"DATE_FORMAT(next_send_at",
		);
		expect(mocks.txExecute.mock.calls[0][2][0]).toBe("2026-10-28 08:00:01.000");
		expect(mocks.wait).not.toHaveBeenCalled();
		expect(mocks.queryOne).toHaveBeenCalledOnce();
	});

	it.each([null, slot({ audience: "real" }), slot({ revision: 4 })])(
		"suppresses a slot for missing or changed settings %j",
		async (row) => {
			mocks.txQueryOne.mockResolvedValue(row);
			await expect(
				settings.reserveSendSlot("test", 3, 42),
			).rejects.toBeInstanceOf(settings.DeliverySuppressed);
			expect(mocks.txExecute).not.toHaveBeenCalled();
		},
	);

	it.each([
		null,
		{ audience: "real", consent_status: "confirmed" },
		...["pending", "unsubscribed", "bounced", "complained"].map(
			(consent_status) => ({ audience: "test", consent_status }),
		),
	])("suppresses missing or unconfirmed subscription %j", async (row) => {
		mocks.txQueryOne.mockResolvedValueOnce(slot()).mockResolvedValueOnce(row);
		await expect(
			settings.reserveSendSlot("test", 3, 42),
		).rejects.toBeInstanceOf(settings.DeliverySuppressed);
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});

	it("waits for the reserved future slot without holding the transaction open", async () => {
		mockSlot(slot({ next_send_at: "2026-10-28T08:00:01.000Z" }));
		let committed = false;
		mocks.transaction.mockImplementation(async (fn) => {
			const result = await fn(connection);
			committed = true;
			return result;
		});
		mocks.wait.mockImplementation(async () => expect(committed).toBe(true));
		await settings.reserveSendSlot("test", 3, 42);
		expect(mocks.wait).toHaveBeenCalledWith(1_000);
	});

	it.each([
		null,
		latest({ audience: "real" }),
		latest({ revision: 4 }),
		latest({ consent_status: "unsubscribed" }),
	])(
		"rechecks mode, revision and consent after waiting %j",
		async (latestState) => {
			mockSlot(slot({ next_send_at: "2026-10-28T08:00:01.000Z" }));
			mocks.wait.mockImplementation(async () =>
				mocks.queryOne.mockResolvedValue(latestState),
			);
			await expect(
				settings.reserveSendSlot("test", 3, 42),
			).rejects.toBeInstanceOf(settings.DeliverySuppressed);
		},
	);

	it.each([
		slot({ now_at: "invalid" }),
		slot({ next_send_at: "invalid" }),
		slot({ next_send_at: "2026-10-28T08:00:06.000Z" }),
	])(
		"fails closed for invalid or excessive reservation time %j",
		async (value) => {
			mockSlot(value);
			await expect(settings.reserveSendSlot("test", 3, 42)).rejects.toThrow();
			expect(mocks.txExecute).not.toHaveBeenCalled();
			expect(mocks.wait).not.toHaveBeenCalled();
		},
	);

	it("serializes competing reservations into separate one-second slots", async () => {
		let tail = Promise.resolve();
		let next: string | null = null;
		mocks.transaction.mockImplementation(async (fn) => {
			const previous = tail;
			let release = () => {};
			tail = new Promise<void>((resolve) => {
				release = resolve;
			});
			await previous;
			try {
				return await fn(connection);
			} finally {
				release();
			}
		});
		mocks.txQueryOne.mockImplementation(async (_conn, sql: string) =>
			sql.includes("email_settings")
				? slot({ next_send_at: next })
				: { audience: "test", consent_status: "confirmed" },
		);
		mocks.txExecute.mockImplementation(async (_conn, _sql, params) => {
			next = `${params[0].replace(" ", "T")}Z`;
			return { affectedRows: 1 };
		});
		mocks.queryOne.mockResolvedValue(latest());
		await Promise.all([
			settings.reserveSendSlot("test", 3, 42),
			settings.reserveSendSlot("test", 3, 43),
		]);
		expect(mocks.wait.mock.calls).toEqual([[1_000]]);
		expect(mocks.txExecute).toHaveBeenCalledTimes(2);
		expect(next).toBe("2026-10-28T08:00:02.000Z");
	});
});
