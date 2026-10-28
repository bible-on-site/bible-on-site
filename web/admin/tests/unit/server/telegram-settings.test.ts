import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	queryOne: vi.fn(),
	txQueryOne: vi.fn(),
	txExecute: vi.fn(),
	transaction: vi.fn(),
	verify: vi.fn(),
	wait: vi.fn(),
}));
vi.mock("~/server/db", () => mocks);
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.wait }));
vi.mock("~/server/telegram-client.server", () => {
	class TelegramSuppressedError extends Error {}
	return {
		TelegramSuppressedError,
		TelegramClient: class {
			verifyTarget = mocks.verify;
		},
	};
});

const token = "123456:abcdefghijklmnopqrstuvwxyz_0123456789";
function configure() {
	vi.stubEnv("BULLETIN_TELEGRAM_BOT_TOKEN", token);
	vi.stubEnv("BULLETIN_TELEGRAM_BOT_USERNAME", "ExampleBot");
	vi.stubEnv("BULLETIN_TELEGRAM_TEST_CHAT_ID", "-100111");
	vi.stubEnv(
		"BULLETIN_EMAIL_QUEUE_URL",
		"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin",
	);
	vi.stubEnv("BULLETIN_SES_ACCOUNT_ID", "123456789012");
	vi.stubEnv("BULLETIN_SES_REGION", "il-central-1");
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	for (const name of [
		"BULLETIN_TELEGRAM_BOT_TOKEN",
		"BULLETIN_TELEGRAM_BOT_USERNAME",
		"BULLETIN_TELEGRAM_TEST_CHAT_ID",
		"BULLETIN_TELEGRAM_REAL_CHAT_ID",
	])
		vi.stubEnv(name, "");
	mocks.transaction.mockImplementation((callback) => callback({}));
	mocks.txExecute.mockResolvedValue({ affectedRows: 1 });
	mocks.wait.mockResolvedValue(undefined);
});

describe("Telegram private runtime configuration", () => {
	it("is disabled without Telegram configuration and performs no database or provider operation", async () => {
		const service = await import("~/server/telegram-settings.server");
		expect(service.loadTelegramRuntime()).toBeNull();
		expect(mocks.queryOne).not.toHaveBeenCalled();
		expect(mocks.verify).not.toHaveBeenCalled();
	});
	it("uses the existing queue contract and keeps real target optional", async () => {
		configure();
		const { loadTelegramRuntime } = await import(
			"~/server/telegram-settings.server"
		);
		expect(loadTelegramRuntime()).toMatchObject({
			token,
			expectedBotUsername: "ExampleBot",
			testChatId: -100111,
			realChatId: null,
			region: "il-central-1",
		});
	});
	it.each([
		["BULLETIN_TELEGRAM_BOT_TOKEN", ""],
		["BULLETIN_TELEGRAM_BOT_TOKEN", "secret token"],
		["BULLETIN_TELEGRAM_TEST_CHAT_ID", "@private"],
		["BULLETIN_TELEGRAM_TEST_CHAT_ID", "100111"],
		["BULLETIN_TELEGRAM_TEST_CHAT_ID", "-9007199254740992"],
		["BULLETIN_TELEGRAM_TEST_CHAT_ID", "-0100111"],
		["BULLETIN_TELEGRAM_REAL_CHAT_ID", "-100111"],
		["BULLETIN_TELEGRAM_BOT_USERNAME", "@ExampleBot"],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/000000000000/bulletin",
		],
		["BULLETIN_EMAIL_QUEUE_URL", "https://evil.example/123456789012/bulletin"],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin?x=1",
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
			"https://sqs.il-central-1.amazonaws.com/123456789012/bulletin%2Fextra",
		],
		[
			"BULLETIN_EMAIL_QUEUE_URL",
			"https://sqs.il-central-1.amazonaws.com/123456789012/",
		],
	])(
		"fails closed for invalid %s without exposing credentials",
		async (name, value) => {
			configure();
			vi.stubEnv(name, value);
			const { loadTelegramRuntime } = await import(
				"~/server/telegram-settings.server"
			);
			expect(() => loadTelegramRuntime()).toThrow(
				"הגדרות שירות הטלגרם אינן תקינות",
			);
			try {
				loadTelegramRuntime();
			} catch (error) {
				expect(String(error)).not.toContain(token);
			}
			expect(mocks.queryOne).not.toHaveBeenCalled();
		},
	);
	it("never resolves an application SSM parameter instead of a token", async () => {
		configure();
		vi.stubEnv("BULLETIN_TELEGRAM_BOT_TOKEN", "");
		vi.stubEnv("BULLETIN_TELEGRAM_BOT_TOKEN_PARAMETER", "/private/test");
		expect(() => awaitModule.loadTelegramRuntime()).toThrow();
	});
});

// Reload per test so readiness cache cannot leak between fixtures.
let awaitModule: typeof import("~/server/telegram-settings.server");
beforeEach(async () => {
	awaitModule = await import("~/server/telegram-settings.server");
});

describe("Telegram settings and target readiness", () => {
	it("rejects missing, malformed and unsafe persisted settings", () => {
		for (const row of [
			null,
			{ audience: "other", revision: 0 },
			{ audience: "test", revision: -1 },
			{ audience: "test", revision: "9007199254740992" },
		])
			expect(() => awaitModule.settingsFromRow(row)).toThrow();
	});
	it("reads a persisted revision without unsafe bigint conversion", async () => {
		mocks.queryOne.mockResolvedValue({ audience: "real", revision: "12" });
		expect(await awaitModule.readTelegramSettings()).toEqual({
			audience: "real",
			revision: 12,
		});
	});
	it("caches sanitized readiness but re-verifies after token/target rotation", async () => {
		configure();
		mocks.verify.mockImplementation(async ({ chatId, audience }) => ({
			botId: 123456,
			chatId,
			title: audience,
			username: audience === "real" ? "BibleOnSite" : null,
		}));
		const runtime = awaitModule.loadTelegramRuntime();
		expect(runtime).not.toBeNull();
		if (!runtime) throw new Error("fixture");
		const targets = await awaitModule.verifyTelegramTargets(runtime);
		expect(awaitModule.telegramReadiness(targets, "test")).toEqual({
			configured: true,
			canSend: true,
			canUseReal: false,
			blockers: [],
		});
		expect(awaitModule.targetView(targets.test)).toEqual({
			title: "test",
			username: null,
		});
		await awaitModule.verifyTelegramTargets(runtime);
		expect(mocks.verify).toHaveBeenCalledTimes(1);
		await awaitModule.verifyTelegramTargets({ ...runtime, token: `${token}x` });
		expect(mocks.verify).toHaveBeenCalledTimes(2);
	});
	it("keeps failures generic and does not expose provider errors", async () => {
		configure();
		vi.stubEnv("BULLETIN_TELEGRAM_REAL_CHAT_ID", "-100222");
		mocks.verify.mockRejectedValue(
			new Error(`https://api.telegram.org/bot${token}/getMe`),
		);
		const runtime = awaitModule.loadTelegramRuntime();
		if (!runtime) throw new Error("fixture");
		const targets = await awaitModule.verifyTelegramTargets(runtime);
		expect(targets).toEqual({ test: null, real: null });
		expect(
			JSON.stringify(awaitModule.telegramReadiness(targets, "real")),
		).not.toContain(token);
	});
});

describe("last-moment Telegram send slot", () => {
	function ready(waitMs = 0) {
		configure();
		mocks.txQueryOne.mockImplementation(async (_unused, sql) => {
			if (
				sql.includes("FROM tanah_daily_bulletin_telegram_settings") &&
				sql.includes("FOR UPDATE")
			)
				return { audience: "test", revision: 2 };
			if (sql.includes("FROM tanah_daily_bulletin_telegram_job"))
				return {
					audience: "test",
					settings_revision: 2,
					status: "sending",
					attempt_token: "claim",
				};
			return { wait_ms: waitMs };
		});
		mocks.queryOne.mockResolvedValue({
			audience: "test",
			settings_revision: 2,
			status: "sending",
			attempt_token: "claim",
			target_chat_id: -100111,
		});
	}
	it("allocates pacing under the lock and waits only after transaction completion", async () => {
		ready(250);
		let locked = false;
		mocks.transaction.mockImplementation(async (callback) => {
			locked = true;
			const result = await callback({});
			locked = false;
			return result;
		});
		mocks.wait.mockImplementation(async () => {
			expect(locked).toBe(false);
		});
		await awaitModule.reserveTelegramSendSlot("job", "claim");
		expect(mocks.wait).toHaveBeenCalledWith(250);
		expect(mocks.txExecute).toHaveBeenCalledTimes(1);
		expect(mocks.queryOne).toHaveBeenCalledTimes(1);
	});
	it.each(["mode", "revision", "token", "status", "missing"])(
		"suppresses changed %s before reserving or sending",
		async (kind) => {
			ready();
			mocks.txQueryOne.mockImplementation(async (_unused, sql) => {
				if (sql.includes("telegram_settings"))
					return { audience: "test", revision: 2 };
				if (kind === "missing") return null;
				return {
					audience: kind === "mode" ? "real" : "test",
					settings_revision: kind === "revision" ? 3 : 2,
					status: kind === "status" ? "uncertain" : "sending",
					attempt_token: kind === "token" ? "other" : "claim",
				};
			});
			await expect(
				awaitModule.reserveTelegramSendSlot("job", "claim"),
			).rejects.toThrow();
			expect(mocks.txExecute).not.toHaveBeenCalled();
		},
	);
	it("rechecks configuration and claimed target after pacing", async () => {
		ready(1);
		mocks.wait.mockImplementation(async () => {
			vi.stubEnv("BULLETIN_TELEGRAM_TEST_CHAT_ID", "-100333");
		});
		await expect(
			awaitModule.reserveTelegramSendSlot("job", "claim"),
		).rejects.toThrow();
	});
	it("refuses an unreasonable stored delay instead of extending send deadlines", async () => {
		ready(6_000);
		await expect(
			awaitModule.reserveTelegramSendSlot("job", "claim"),
		).rejects.toThrow();
		expect(mocks.wait).not.toHaveBeenCalled();
	});
});
