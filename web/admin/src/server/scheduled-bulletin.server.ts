import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { SendMessageBatchCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { rolloutDelivers } from "~/lib/bulletin-rollout";
import {
	bulletinDatesForRun,
	scheduledBulletinDate,
} from "~/lib/bulletin-schedule";
import { prepareBulletin } from "./daily-bulletins.server";
import { getBulletinRolloutSummary } from "./rollout-state.server";
import {
	enqueueBulletinEmail,
	enqueueBulletinRolloutEmail,
	NoConfirmedRecipientsError,
} from "./ses-delivery.server";
import { readAudienceSettings } from "./ses-settings.server";
import { enqueueBulletinTelegram } from "./telegram-delivery.server";
import { readTelegramSettings } from "./telegram-settings.server";
import { enqueueBulletinWhatsApp } from "./whatsapp-delivery.server";
import { readWhatsAppSettings } from "./whatsapp-settings.server";

/** Stable across queue redelivery, overlapping tasks and process restarts. */
export function scheduledBulletinRequestKey(
	date: string,
	channel: string,
): string {
	const hex = createHash("sha256")
		.update(`tanah/daily-bulletin/v1/${date}/${channel}`)
		.digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Internal queue messages cannot override the calendar, recipients, audiences or targets. */
export async function processScheduledBulletin(
	payload: unknown,
	signal: AbortSignal,
	queue: { client: SQSClient; url: string },
	now = new Date(),
): Promise<boolean> {
	if (
		!payload ||
		typeof payload !== "object" ||
		Array.isArray(payload) ||
		!("kind" in payload) ||
		!("scheduledAt" in payload)
	)
		return false;
	const generate = payload.kind === "bulletin.generate";
	if (
		(!generate && payload.kind !== "bulletin.schedule") ||
		Object.keys(payload).length !== (generate ? 3 : 2) ||
		(generate && !("date" in payload))
	)
		return false;
	if (process.env.BULLETIN_SCHEDULE_ENABLED !== "true" || signal.aborted)
		return false;
	const date = scheduledBulletinDate(payload.scheduledAt, now);
	if (!date) throw new Error("Scheduled bulletin timestamp rejected");
	const dates = bulletinDatesForRun(date);
	if (!dates.length) return true;
	if (!generate) {
		// One render per receipt keeps a three-day holiday advance within the existing
		// 120-second visibility/shutdown contract. Duplicate child messages reuse job keys.
		const result = await queue.client.send(
			new SendMessageBatchCommand({
				QueueUrl: queue.url,
				Entries: dates.map((targetDate) => ({
					Id: targetDate,
					MessageBody: JSON.stringify({
						kind: "bulletin.generate",
						scheduledAt: payload.scheduledAt,
						date: targetDate,
					}),
				})),
			}),
			{ abortSignal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) },
		);
		if (result.Failed?.length || result.Successful?.length !== dates.length)
			throw new Error("Scheduled bulletin date publication incomplete");
		return true;
	}
	if (
		!("date" in payload) ||
		typeof payload.date !== "string" ||
		!dates.includes(payload.date)
	)
		return false;
	const targetDate = payload.date;
	const [email, telegram, whatsapp, rollout] = await Promise.all([
		readAudienceSettings(),
		readTelegramSettings(),
		readWhatsAppSettings(),
		getBulletinRolloutSummary(),
	]);
	// Fixed rollout policy. An admin audience change pauses automation until reviewed.
	if (
		email.audience !== "test" ||
		telegram.audience !== "real" ||
		whatsapp.audience !== "real"
	)
		throw new Error("Scheduled bulletin audience policy mismatch");
	if (signal.aborted) return false;
	await prepareBulletin(targetDate);
	if (signal.aborted) return false;
	// Each channel retains its durable claim, frozen target and consent checks.
	// One enqueue failure must not prevent the other channels from being queued.
	const enqueues: Promise<unknown>[] = [
		enqueueBulletinEmail(
			targetDate,
			scheduledBulletinRequestKey(targetDate, "email"),
			{
				audience: "test",
				revision: email.revision,
			},
		),
		enqueueBulletinTelegram({
			date: targetDate,
			requestKey: scheduledBulletinRequestKey(targetDate, "telegram"),
			expectedAudience: "real",
			expectedRevision: telegram.revision,
		}),
		enqueueBulletinWhatsApp(
			{
				date: targetDate,
				requestKey: scheduledBulletinRequestKey(targetDate, "whatsapp"),
				expectedAudience: "real",
				expectedRevision: whatsapp.revision,
			},
			{ refreshRealTarget: true },
		),
	];
	// The original-cohort rollout adds a second, limited 'real' email job once
	// confirmed cohort members exist (#3382). The durable job/ledger contract
	// keeps it cumulative and idempotent across redeliveries.
	if (rollout && rolloutDelivers(rollout.state) && rollout.admitted > 0)
		enqueues.push(
			enqueueBulletinRolloutEmail(
				targetDate,
				scheduledBulletinRequestKey(targetDate, "email"),
				email.revision,
			).catch((error: unknown) => {
				// A last admitted member may still opt out between the gate and the
				// enqueue; an empty cohort is a skip, never a failed bulletin run.
				if (error instanceof NoConfirmedRecipientsError) return null;
				throw error;
			}),
		);
	const results = await Promise.allSettled(enqueues);
	if (results.some((result) => result.status === "rejected"))
		throw new Error("Scheduled bulletin channel enqueue incomplete");
	return true;
}
