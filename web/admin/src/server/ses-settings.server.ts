import "@tanstack/react-start/server-only";
import { setTimeout as wait } from "node:timers/promises";
import {
	GetAccountCommand,
	GetEmailIdentityCommand,
	SESv2Client,
} from "@aws-sdk/client-sesv2";
import type {
	BulletinEmailState,
	EmailAudience,
	EmailAudienceSettings,
	EmailReadiness,
	SubscriberChange,
} from "~/lib/bulletin-email";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQueryOne,
} from "./db";
import {
	SesClient,
	type SesConfig,
	SesSuppressedError,
} from "./ses-client.server";

export { SesSuppressedError as DeliverySuppressed } from "./ses-client.server";
export interface EmailRuntime extends SesConfig {
	queueUrl: string;
	accountId: string;
}

export function loadEmailRuntime(): EmailRuntime | null {
	const fromAddress = process.env.BULLETIN_SES_FROM?.trim();
	const contactListName = process.env.BULLETIN_SES_CONTACT_LIST?.trim();
	const configurationSetName =
		process.env.BULLETIN_SES_CONFIGURATION_SET?.trim();
	const queueUrl = process.env.BULLETIN_EMAIL_QUEUE_URL?.trim();
	const accountId = process.env.BULLETIN_SES_ACCOUNT_ID?.trim();
	if (
		!fromAddress ||
		!contactListName ||
		!configurationSetName ||
		!queueUrl ||
		!accountId
	)
		return null;
	if (
		!/^\d{12}$/.test(accountId) ||
		!/^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9_-]+$/.test(
			queueUrl,
		) ||
		!queueUrl.includes(`/${accountId}/`)
	)
		throw new Error("הגדרות התור אינן תקינות");
	return {
		region:
			process.env.BULLETIN_SES_REGION ||
			process.env.AWS_REGION ||
			"il-central-1",
		fromAddress,
		replyToAddress: process.env.BULLETIN_SES_REPLY_TO || fromAddress,
		senderName: process.env.BULLETIN_SES_SENDER_NAME || 'תנ"ך על הפרק',
		contactListName,
		configurationSetName,
		queueUrl,
		accountId,
	};
}

export async function readAudienceSettings(): Promise<EmailAudienceSettings> {
	const row = await queryOne<{ audience: EmailAudience; revision: number }>(
		"SELECT audience, revision FROM tanah_daily_bulletin_email_settings WHERE id = 1",
	);
	if (!row) throw new Error("הגדרות הדיוור טרם נוצרו");
	return { audience: row.audience, revision: Number(row.revision) };
}

let readinessCache:
	| { key: string; until: number; value: Promise<EmailReadiness> }
	| undefined;

export async function getEmailReadiness(): Promise<EmailReadiness> {
	const runtime = loadEmailRuntime();
	if (!runtime)
		return {
			configured: false,
			canSend: false,
			canUseReal: false,
			blockers: ["שירות הדיוור טרם הוגדר"],
		};
	const key = JSON.stringify([runtime.region, runtime.fromAddress]);
	if (readinessCache?.key === key && readinessCache.until > Date.now())
		return readinessCache.value;
	const value = (async (): Promise<EmailReadiness> => {
		const client = new SESv2Client({ region: runtime.region, maxAttempts: 1 });
		try {
			const [account, identity] = await Promise.all([
				client.send(new GetAccountCommand({}), {
					abortSignal: AbortSignal.timeout(15_000),
				}),
				client.send(
					new GetEmailIdentityCommand({
						EmailIdentity: runtime.fromAddress.split("@")[1],
					}),
					{ abortSignal: AbortSignal.timeout(15_000) },
				),
			]);
			const blockers: string[] = [];
			if (!account.SendingEnabled) blockers.push("השליחה מושבתת בחשבון SES");
			if (
				!identity.VerifiedForSendingStatus ||
				identity.DkimAttributes?.Status !== "SUCCESS" ||
				!identity.DkimAttributes.SigningEnabled ||
				identity.DkimAttributes.SigningAttributesOrigin !== "AWS_SES"
			)
				blockers.push("אימות כתובת השולח וחתימת DKIM טרם הושלמו");
			return {
				configured: true,
				canSend: blockers.length === 0,
				canUseReal:
					blockers.length === 0 && account.ProductionAccessEnabled === true,
				blockers,
			};
		} catch {
			return {
				configured: true,
				canSend: false,
				canUseReal: false,
				blockers: ["לא ניתן לאמת את מוכנות שירות הדיוור"],
			};
		} finally {
			client.destroy();
		}
	})();
	readinessCache = { key, until: Date.now() + 30_000, value };
	return value;
}

export async function subscriberSummary(): Promise<{
	testRecipients: string[];
	realRecipients: number;
	unverifiedRecipients: number;
}> {
	const rows = await query<{
		email: string;
		audience: EmailAudience;
		consent_status: string;
	}>(
		"SELECT email, audience, consent_status FROM tanah_daily_bulletin_subscriber ORDER BY email",
	);
	return {
		testRecipients: rows
			.filter((r) => r.audience === "test" && r.consent_status === "confirmed")
			.map((r) => r.email),
		realRecipients: rows.filter(
			(r) => r.audience === "real" && r.consent_status === "confirmed",
		).length,
		unverifiedRecipients: rows.filter(
			(r) => r.audience === "real" && r.consent_status === "pending",
		).length,
	};
}

export async function getBulletinEmailState(
	date: string,
): Promise<BulletinEmailState> {
	const readiness = await getEmailReadiness();
	if (!readiness.configured)
		return {
			settings: { audience: "test", revision: 0 },
			readiness,
			testRecipients: [],
			realRecipients: 0,
			unverifiedRecipients: 0,
			job: null,
		};
	const { readLatestEmailJob } = await import("./ses-delivery.server");
	const settings = await readAudienceSettings();
	const [summary, job] = await Promise.all([
		subscriberSummary(),
		readLatestEmailJob(date, settings.audience),
	]);
	return { settings, readiness, ...summary, job };
}

export async function setEmailAudience(
	value: EmailAudienceSettings & { confirmReal: boolean },
): Promise<EmailAudienceSettings> {
	if (!loadEmailRuntime()) throw new Error("שירות הדיוור טרם הוגדר");
	if (value.audience === "real") {
		if (!value.confirmReal) throw new Error("נדרש אישור מפורש לשליחה למנויים");
		const [readiness, subscribers] = await Promise.all([
			getEmailReadiness(),
			subscriberSummary(),
		]);
		if (!readiness.canUseReal)
			throw new Error("חשבון SES עדיין אינו מאושר לשליחה למנויים");
		if (!subscribers.realRecipients)
			throw new Error("אין מנויים בעלי הסכמה מאושרת");
	}
	return transaction(async (connection) => {
		const settings = await txQueryOne<{
			audience: EmailAudience;
			revision: number;
		}>(
			connection,
			"SELECT audience, revision FROM tanah_daily_bulletin_email_settings WHERE id = 1 FOR UPDATE",
		);
		if (!settings || Number(settings.revision) !== value.revision)
			throw new Error("מצב השליחה השתנה. רעננו את המסך.");
		const active = await txQueryOne<{ n: number }>(
			connection,
			"SELECT COUNT(*) AS n FROM tanah_daily_bulletin_email_recipient WHERE status = 'sending'",
		);
		if (Number(active?.n))
			throw new Error("יש משלוח פעיל. המתינו לסיומו לפני שינוי הקהל.");
		if (settings.audience === value.audience)
			return {
				audience: settings.audience,
				revision: Number(settings.revision),
			};
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_email_settings SET audience = ?, revision = revision + 1 WHERE id = 1",
			[value.audience],
		);
		return { audience: value.audience, revision: value.revision + 1 };
	});
}

export async function changeSubscriber(value: SubscriberChange): Promise<void> {
	const runtime = loadEmailRuntime();
	if (!runtime) throw new Error("שירות הדיוור טרם הוגדר");
	if (value.action === "unsubscribe") {
		await execute(
			"UPDATE tanah_daily_bulletin_subscriber SET consent_status = IF(consent_status IN ('bounced','complained'), consent_status, 'unsubscribed'), last_event_at = UTC_TIMESTAMP(3) WHERE email = ?",
			[value.email],
		);
		await new SesClient(runtime).unsubscribeContact(
			value.email,
			value.audience,
		);
		return;
	}
	const current = await queryOne<{ consent_status: string }>(
		"SELECT consent_status FROM tanah_daily_bulletin_subscriber WHERE email = ? AND audience = ?",
		[value.email, value.audience],
	);
	if (
		current &&
		["unsubscribed", "bounced", "complained"].includes(current.consent_status)
	)
		throw new Error("המנוי חסום לדיוור. נדרשת הרשמה מחודשת של הנמען.");
	const result = await new SesClient(runtime).ensureSubscribedContact(
		value.email,
		value.audience,
	);
	if (result !== "subscribed")
		throw new Error(
			"המנוי הסיר את הסכמתו. אין להחזירו לרשימה ללא הרשמה מחודשת.",
		);
	await execute(
		`INSERT INTO tanah_daily_bulletin_subscriber (email, audience, consent_status, consent_source, consented_at, last_event_at)
		VALUES (?, ?, 'confirmed', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE
		consent_status = IF(consent_status IN ('unsubscribed','bounced','complained'), consent_status, 'confirmed'),
		consent_source = IF(consent_status = 'confirmed', VALUES(consent_source), consent_source),
		consented_at = IF(consent_status = 'confirmed', UTC_TIMESTAMP(3), consented_at),
		last_event_at = IF(consent_status = 'confirmed', UTC_TIMESTAMP(3), last_event_at)`,
		[value.email, value.audience, value.source],
	);
}

export async function reserveSendSlot(
	expectedAudience: EmailAudience,
	expectedRevision: number,
	subscriberId: number,
): Promise<void> {
	const delay = await transaction(async (connection) => {
		const settings = await txQueryOne<{
			audience: EmailAudience;
			revision: number;
			next_send_at: string | null;
			now_at: string;
		}>(
			connection,
			"SELECT audience, revision, DATE_FORMAT(next_send_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS next_send_at, DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ') AS now_at FROM tanah_daily_bulletin_email_settings WHERE id = 1 FOR UPDATE",
		);
		if (
			!settings ||
			settings.audience !== expectedAudience ||
			Number(settings.revision) !== expectedRevision
		)
			throw new SesSuppressedError();
		const subscriber = await txQueryOne<{
			consent_status: string;
			audience: EmailAudience;
		}>(
			connection,
			"SELECT consent_status, audience FROM tanah_daily_bulletin_subscriber WHERE id = ? FOR UPDATE",
			[subscriberId],
		);
		if (
			subscriber?.consent_status !== "confirmed" ||
			subscriber.audience !== expectedAudience
		)
			throw new SesSuppressedError();
		const now = Date.parse(settings.now_at);
		const next = settings.next_send_at
			? new Date(settings.next_send_at).getTime()
			: now;
		const slot = Math.max(now, next);
		if (!Number.isFinite(slot) || slot - now > 5_000)
			throw new Error("שירות הדיוור עמוס. יש לבדוק את התור.");
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_email_settings SET next_send_at = ? WHERE id = 1",
			[new Date(slot + 1_000).toISOString().slice(0, 23).replace("T", " ")],
		);
		return slot - now;
	});
	if (delay > 0) await wait(delay);
	const latest = await queryOne<{
		audience: EmailAudience;
		revision: number;
		consent_status: string;
	}>(
		"SELECT s.audience, s.revision, p.consent_status FROM tanah_daily_bulletin_email_settings s JOIN tanah_daily_bulletin_subscriber p ON p.id = ? WHERE s.id = 1 AND p.audience = s.audience",
		[subscriberId],
	);
	if (
		!latest ||
		latest.audience !== expectedAudience ||
		Number(latest.revision) !== expectedRevision ||
		latest.consent_status !== "confirmed"
	)
		throw new SesSuppressedError();
}
