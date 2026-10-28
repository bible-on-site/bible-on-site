import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import type {
	TelegramAudience,
	TelegramReadiness,
	TelegramSettings,
	TelegramTargetView,
} from "~/lib/bulletin-telegram";
import { queryOne, transaction, txExecute, txQueryOne } from "./db";
import {
	TelegramClient,
	type TelegramClientConfig,
	TelegramSuppressedError,
	type VerifiedTelegramTarget,
} from "./telegram-client.server";

const CONFIG_ERROR = "הגדרות שירות הטלגרם אינן תקינות";
export interface TelegramRuntime extends TelegramClientConfig {
	testChatId: number;
	realChatId: number | null;
	queueUrl: string;
	region: string;
}

function chatId(value: string): number {
	if (!/^-[1-9][0-9]*$/.test(value)) throw new Error(CONFIG_ERROR);
	const id = Number(value);
	if (!Number.isSafeInteger(id)) throw new Error(CONFIG_ERROR);
	return id;
}

export function loadTelegramRuntime(): TelegramRuntime | null {
	const token = process.env.BULLETIN_TELEGRAM_BOT_TOKEN?.trim();
	const expectedBotUsername =
		process.env.BULLETIN_TELEGRAM_BOT_USERNAME?.trim();
	const test = process.env.BULLETIN_TELEGRAM_TEST_CHAT_ID?.trim();
	const real = process.env.BULLETIN_TELEGRAM_REAL_CHAT_ID?.trim();
	if (!token && !expectedBotUsername && !test && !real) return null;
	if (
		!token ||
		!expectedBotUsername ||
		!test ||
		!/^[0-9]{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token) ||
		!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(expectedBotUsername)
	)
		throw new Error(CONFIG_ERROR);
	const testChatId = chatId(test);
	const realChatId = real ? chatId(real) : null;
	if (realChatId === testChatId) throw new Error(CONFIG_ERROR);
	const region =
		process.env.BULLETIN_SES_REGION || process.env.AWS_REGION || "il-central-1";
	const account = process.env.BULLETIN_SES_ACCOUNT_ID;
	const queueUrl = process.env.BULLETIN_EMAIL_QUEUE_URL?.trim();
	if (!account || !/^[0-9]{12}$/.test(account) || !queueUrl)
		throw new Error(CONFIG_ERROR);
	let url: URL;
	try {
		url = new URL(queueUrl);
	} catch {
		throw new Error(CONFIG_ERROR);
	}
	const queuePath = url.pathname.split("/");
	if (
		url.protocol !== "https:" ||
		url.hostname !== `sqs.${region}.amazonaws.com` ||
		url.port ||
		url.search ||
		url.hash ||
		url.username ||
		url.password ||
		queuePath.length !== 3 ||
		queuePath[1] !== account ||
		!/^[A-Za-z0-9_-]+$/.test(queuePath[2] ?? "")
	)
		throw new Error(CONFIG_ERROR);
	return {
		token,
		expectedBotUsername,
		testChatId,
		realChatId,
		queueUrl,
		region,
	};
}

export function targetChatId(
	runtime: TelegramRuntime,
	audience: TelegramAudience,
): number {
	const target = audience === "test" ? runtime.testChatId : runtime.realChatId;
	if (target === null) throw new TelegramSuppressedError();
	return target;
}

export function settingsFromRow(
	row: { audience: string; revision: number | string } | null,
): TelegramSettings {
	const revision = Number(row?.revision);
	if (
		!row ||
		(row.audience !== "test" && row.audience !== "real") ||
		!Number.isSafeInteger(revision) ||
		revision < 0
	)
		throw new Error("הגדרות הטלגרם טרם נוצרו");
	return { audience: row.audience, revision };
}

export async function readTelegramSettings(): Promise<TelegramSettings> {
	return settingsFromRow(
		await queryOne<{ audience: string; revision: number | string }>(
			"SELECT audience, revision FROM tanah_daily_bulletin_telegram_settings WHERE id = 1",
		),
	);
}

export interface TelegramTargets {
	test: VerifiedTelegramTarget | null;
	real: VerifiedTelegramTarget | null;
}
let cache:
	| { key: string; until: number; value: Promise<TelegramTargets> }
	| undefined;

export async function verifyTelegramTargets(
	runtime: TelegramRuntime,
): Promise<TelegramTargets> {
	const key = createHash("sha256")
		.update(
			JSON.stringify([
				runtime.token,
				runtime.expectedBotUsername,
				runtime.testChatId,
				runtime.realChatId,
			]),
		)
		.digest("hex");
	if (cache?.key === key && cache.until > Date.now()) return cache.value;
	const client = new TelegramClient(runtime);
	const value = (async () => {
		const [test, real] = await Promise.all([
			client
				.verifyTarget({ chatId: runtime.testChatId, audience: "test" })
				.catch(() => null),
			runtime.realChatId === null
				? null
				: client
						.verifyTarget({ chatId: runtime.realChatId, audience: "real" })
						.catch(() => null),
		]);
		return { test, real };
	})();
	cache = { key, until: Date.now() + 30_000, value };
	return value;
}

export function telegramReadiness(
	targets: TelegramTargets,
	audience: TelegramAudience,
): TelegramReadiness {
	const target = targets[audience];
	return {
		configured: true,
		canSend: target !== null,
		canUseReal: targets.real !== null,
		blockers: target
			? []
			: [
					audience === "test"
						? "לא ניתן לאמת את הערוץ הפרטי והרשאות הבוט"
						: "הערוץ הציבורי טרם הוגדר ואומת",
				],
	};
}

export function targetView(
	target: VerifiedTelegramTarget | null,
): TelegramTargetView | null {
	return target ? { title: target.title, username: target.username } : null;
}

/** Lock settings and the claimed job together, then wait outside the transaction. */
export async function reserveTelegramSendSlot(
	id: string,
	token: string,
): Promise<void> {
	const delayMs = await transaction(async (connection) => {
		const settings = settingsFromRow(
			await txQueryOne<{ audience: string; revision: number | string }>(
				connection,
				"SELECT audience, revision FROM tanah_daily_bulletin_telegram_settings WHERE id = 1 FOR UPDATE",
			),
		);
		const job = await txQueryOne<{
			audience: TelegramAudience;
			settings_revision: number;
			status: string;
			attempt_token: string;
		}>(
			connection,
			"SELECT audience, settings_revision, status, attempt_token FROM tanah_daily_bulletin_telegram_job WHERE id = ? FOR UPDATE",
			[id],
		);
		if (
			job?.status !== "sending" ||
			job.attempt_token !== token ||
			job.audience !== settings.audience ||
			Number(job.settings_revision) !== settings.revision
		)
			throw new TelegramSuppressedError();
		const timing = await txQueryOne<{ wait_ms: number }>(
			connection,
			"SELECT GREATEST(0, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), next_send_at) DIV 1000) AS wait_ms FROM tanah_daily_bulletin_telegram_settings WHERE id = 1",
		);
		const milliseconds = Number(timing?.wait_ms ?? 0);
		if (!Number.isFinite(milliseconds) || milliseconds > 5_000)
			throw new Error(CONFIG_ERROR);
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_telegram_settings SET next_send_at = TIMESTAMPADD(SECOND, 1, GREATEST(COALESCE(next_send_at, UTC_TIMESTAMP(3)), UTC_TIMESTAMP(3))) WHERE id = 1",
		);
		return milliseconds;
	});
	if (delayMs > 0) await wait(delayMs);
	// A database/config change during pacing must still stop before the POST.
	const runtime = loadTelegramRuntime();
	const current = await queryOne<{
		audience: TelegramAudience;
		settings_revision: number;
		status: string;
		attempt_token: string;
		target_chat_id: number;
	}>(
		"SELECT j.audience, j.settings_revision, j.status, j.attempt_token, j.target_chat_id FROM tanah_daily_bulletin_telegram_job j JOIN tanah_daily_bulletin_telegram_settings s ON s.id = 1 AND s.audience = j.audience AND s.revision = j.settings_revision WHERE j.id = ?",
		[id],
	);
	if (
		!runtime ||
		!current ||
		current.status !== "sending" ||
		current.attempt_token !== token ||
		Number(current.target_chat_id) !== targetChatId(runtime, current.audience)
	)
		throw new TelegramSuppressedError();
}
