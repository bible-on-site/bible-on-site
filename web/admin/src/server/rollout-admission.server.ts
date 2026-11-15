import "@tanstack/react-start/server-only";
import type { PoolConnection } from "mysql2/promise";
import {
	admissionLocalDate,
	MAX_DAILY_ADMISSION_ATTEMPTS,
	MAX_STALE_RESERVATIONS,
	rolloutAdmits,
} from "~/lib/bulletin-rollout";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQueryOne,
} from "./db";
import { runOutboxSweep } from "./outbox-deadline.server";
import {
	isMissingRolloutSchema,
	readRolloutDeliveryState,
} from "./rollout-state.server";
import { SesClient } from "./ses-client.server";
import { loadEmailRuntime } from "./ses-settings.server";

/**
 * Original-cohort daily admission (#3382).
 *
 * The email worker's periodic sweep admits at most one additional eligible
 * original subscriber per Asia/Jerusalem calendar day. The `(cohort,
 * local_date)` admission row is the atomic reservation: it is claimed inside
 * one transaction that also selects the next member by cohort position, so
 * overlapping workers, redeliveries, deploys and operator re-runs cannot
 * activate a second person on the same day. A missed day is never caught up —
 * only the current local date gets a new reservation, while older `reserved`
 * rows merely finish reconciling the same recorded subscriber.
 *
 * Activation never fabricates consent: only a subscriber still `pending`
 * becomes `confirmed`, and only after SES shows the `real` topic subscribed.
 * An existing opted-out contact is authoritative and excludes the member; a
 * member absent from SES is provisioned the opt-in because cohort membership
 * itself is the consent evidence from the authoritative original list. A
 * member whose consent lapsed mid-flight is excluded and the same day's
 * reservation selects the next eligible member — still one committed
 * activation per day. Pausing or disabling freezes in-flight reservations:
 * the activation transaction re-reads the locked control row, so nothing
 * commits after the operator's transition.
 */

interface AdmissionCandidate {
	cohort: string;
	localDate: string;
	/** The recorded member; `null` only for an abandoned empty reservation. */
	subscriberId: number | null;
	reselectable: boolean;
}

interface SubscriberRow {
	id: number;
	email: string;
	consent_status: string;
}

const INELIGIBLE = new Set(["unsubscribed", "bounced", "complained"]);

/**
 * Claims the local day's reservation and selects the next eligible member, or
 * re-selects inside the same day's reservation after an ineligible candidate.
 * Returns `null` when nothing may proceed: rollout not running, the day is
 * already admitted/exhausted, every eligible member is held by an outstanding
 * reservation (the day idles — the rollout keeps running), or the cohort is
 * done (recorded `exhausted` and the rollout completes).
 */
async function claimOrReselect(
	connection: PoolConnection,
	localDate: string,
): Promise<AdmissionCandidate | null> {
	const rollout = await txQueryOne<{ state: string; cohort: string }>(
		connection,
		"SELECT state, cohort FROM tanah_daily_bulletin_email_rollout WHERE id = 1 FOR UPDATE",
	);
	if (rollout?.state !== "running") return null;
	const cohort = rollout.cohort;
	await txExecute(
		connection,
		"INSERT IGNORE INTO tanah_daily_bulletin_email_admission (cohort, local_date) VALUES (?, ?)",
		[cohort, localDate],
	);
	const admission = await txQueryOne<{
		status: string;
		subscriber_id: number | null;
	}>(
		connection,
		"SELECT status, subscriber_id FROM tanah_daily_bulletin_email_admission WHERE cohort = ? AND local_date = ? FOR UPDATE",
		[cohort, localDate],
	);
	if (admission?.status !== "reserved") return null;
	if (admission.subscriber_id !== null)
		return {
			cohort,
			localDate,
			subscriberId: Number(admission.subscriber_id),
			reselectable: true,
		};
	// Already-confirmed members (e.g. a direct signup ahead of their turn) are
	// admitted without consuming the day's reservation; ineligible consent is
	// excluded and never re-activated.
	await txExecute(
		connection,
		`UPDATE tanah_daily_bulletin_email_cohort c
		 JOIN tanah_daily_bulletin_subscriber s ON s.id = c.subscriber_id
		 SET c.status = 'admitted'
		 WHERE c.cohort = ? AND c.status = 'pending' AND s.consent_status = 'confirmed'`,
		[cohort],
	);
	await txExecute(
		connection,
		`UPDATE tanah_daily_bulletin_email_cohort c
		 JOIN tanah_daily_bulletin_subscriber s ON s.id = c.subscriber_id
		 SET c.status = 'excluded', c.excluded_reason = s.consent_status
		 WHERE c.cohort = ? AND c.status = 'pending' AND s.consent_status <> 'pending'`,
		[cohort],
	);
	// A member already held by any outstanding reservation (e.g. an older date
	// still retrying a provider error) is never re-claimed under a second date.
	const next = await txQueryOne<{ subscriber_id: number }>(
		connection,
		`SELECT c.subscriber_id FROM tanah_daily_bulletin_email_cohort c
		 JOIN tanah_daily_bulletin_subscriber s ON s.id = c.subscriber_id
		 WHERE c.cohort = ? AND c.status = 'pending' AND s.consent_status = 'pending'
		 AND NOT EXISTS (
		 SELECT 1 FROM tanah_daily_bulletin_email_admission a
		 WHERE a.cohort = c.cohort AND a.status = 'reserved' AND a.subscriber_id = c.subscriber_id)
		 ORDER BY c.position LIMIT 1`,
		[cohort],
	);
	if (!next) {
		// An empty selection is not exhaustion while eligible members remain —
		// they are all held by outstanding reservations that keep retrying
		// under their own dates. The day idles (still a running rollout): if a
		// held member is excluded or activated today, a later sweep can claim
		// whoever is next under this same reservation.
		const held = await txQueryOne<{ subscriber_id: number }>(
			connection,
			`SELECT c.subscriber_id FROM tanah_daily_bulletin_email_cohort c
			 JOIN tanah_daily_bulletin_subscriber s ON s.id = c.subscriber_id
			 WHERE c.cohort = ? AND c.status = 'pending' AND s.consent_status = 'pending'
			 LIMIT 1`,
			[cohort],
		);
		if (held) return null;
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_email_admission SET status = 'exhausted' WHERE cohort = ? AND local_date = ? AND status = 'reserved' AND subscriber_id IS NULL",
			[cohort, localDate],
		);
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_email_rollout SET state = 'completed', completed_at = UTC_TIMESTAMP(3), revision = revision + 1 WHERE id = 1 AND state = 'running'",
		);
		return null;
	}
	await txExecute(
		connection,
		"UPDATE tanah_daily_bulletin_email_admission SET subscriber_id = ?, last_error = NULL WHERE cohort = ? AND local_date = ? AND status = 'reserved'",
		[next.subscriber_id, cohort, localDate],
	);
	return {
		cohort,
		localDate,
		subscriberId: Number(next.subscriber_id),
		reselectable: true,
	};
}

/**
 * The recorded candidate is dropped without activation. For the current local
 * date the reservation is cleared so the same day may select the next eligible
 * member; an older reservation instead records `lapsed` — a past day never
 * activates a substitute. Every transition is conditioned on the recorded
 * member (`<=>` matches NULL), so a superseded worker can never clear or lapse
 * a reservation another worker already re-populated.
 */
async function releaseCandidate(
	candidate: AdmissionCandidate,
	reason: string,
): Promise<void> {
	await transaction(async (connection) => {
		if (candidate.subscriberId !== null)
			await txExecute(
				connection,
				`UPDATE tanah_daily_bulletin_email_cohort SET status = 'excluded', excluded_reason = ?
				 WHERE cohort = ? AND subscriber_id = ? AND status = 'pending'`,
				[reason.slice(0, 60), candidate.cohort, candidate.subscriberId],
			);
		await txExecute(
			connection,
			candidate.reselectable
				? `UPDATE tanah_daily_bulletin_email_admission SET subscriber_id = NULL, last_error = ?
					 WHERE cohort = ? AND local_date = ? AND status = 'reserved' AND subscriber_id <=> ?`
				: `UPDATE tanah_daily_bulletin_email_admission SET status = 'lapsed', last_error = ?
					 WHERE cohort = ? AND local_date = ? AND status = 'reserved' AND subscriber_id <=> ?`,
			[
				reason.slice(0, 255),
				candidate.cohort,
				candidate.localDate,
				candidate.subscriberId,
			],
		);
	});
}

async function recordAdmissionError(
	candidate: AdmissionCandidate,
	error: unknown,
): Promise<void> {
	const reason =
		error instanceof Error && error.message ? error.message : "provider";
	await execute(
		`UPDATE tanah_daily_bulletin_email_admission SET last_error = ?
		 WHERE cohort = ? AND local_date = ? AND status = 'reserved'`,
		[reason.slice(0, 255), candidate.cohort, candidate.localDate],
	);
}

/**
 * Reconciles one recorded candidate: SES contact must be `real`-subscribed
 * before the guarded pending→confirmed activation commits. Returns `true`
 * when the day's reservation was cleared for the next eligible member.
 */
async function settleCandidate(
	candidate: AdmissionCandidate,
	runtime: NonNullable<ReturnType<typeof loadEmailRuntime>>,
	abort: AbortSignal,
): Promise<boolean> {
	if (candidate.subscriberId === null) return candidate.reselectable;
	const subscriber = await queryOne<SubscriberRow>(
		"SELECT id, email, consent_status FROM tanah_daily_bulletin_subscriber WHERE id = ?",
		[candidate.subscriberId],
	);
	if (!subscriber || INELIGIBLE.has(subscriber.consent_status)) {
		await releaseCandidate(
			candidate,
			subscriber ? subscriber.consent_status : "missing-subscriber",
		);
		return candidate.reselectable;
	}
	const client = new SesClient(runtime);
	let result: "subscribed" | "opted_out";
	try {
		// SES is authoritative for prior opt-outs. A member absent from the
		// contact list is provisioned with the 'real' opt-in: cohort membership
		// is itself the consent evidence (the private authoritative original
		// list), and the SES record exists so sends can honor native
		// topic-level unsubscribe.
		result = await client.ensureSubscribedContact(subscriber.email, "real");
	} catch (error) {
		// An uncertain provider write keeps the same reservation; the next sweep
		// resumes it rather than activating a substitute.
		await recordAdmissionError(candidate, error);
		return false;
	} finally {
		client.destroy();
	}
	abort.throwIfAborted();
	if (result === "opted_out") {
		// SES is authoritative that the recipient opted out — record it first so
		// a later failure still lets the claim sweep exclude the member itself.
		await execute(
			`UPDATE tanah_daily_bulletin_subscriber SET consent_status = 'unsubscribed',
			 last_event_at = UTC_TIMESTAMP(3)
			 WHERE id = ? AND consent_status IN ('pending', 'confirmed')`,
			[subscriber.id],
		);
		await releaseCandidate(candidate, "ses-opted-out");
		return candidate.reselectable;
	}
	const committed = await transaction(async (connection) => {
		// Only a running rollout may commit an activation. Locking the control
		// row serializes against the operator disable/pause transition: an
		// in-flight reservation freezes instead of confirming past the gate.
		const rollout = await txQueryOne<{ state: string }>(
			connection,
			"SELECT state FROM tanah_daily_bulletin_email_rollout WHERE id = 1 FOR UPDATE",
		);
		if (rollout?.state !== "running") return "blocked" as const;
		const current = await txQueryOne<{ consent_status: string }>(
			connection,
			"SELECT consent_status FROM tanah_daily_bulletin_subscriber WHERE id = ? FOR UPDATE",
			[subscriber.id],
		);
		// A late unsubscribe/bounce/complaint is never undone by this admission.
		if (
			!current ||
			(current.consent_status !== "pending" &&
				current.consent_status !== "confirmed")
		)
			return "ineligible" as const;
		// Conclude only the reservation this candidate was recorded under; a
		// superseded worker touches nothing and nobody else is activated.
		const done = await txExecute(
			connection,
			`UPDATE tanah_daily_bulletin_email_admission SET status = 'admitted', last_error = NULL
			 WHERE cohort = ? AND local_date = ? AND status = 'reserved' AND subscriber_id <=> ?`,
			[candidate.cohort, candidate.localDate, candidate.subscriberId],
		);
		if (done.affectedRows !== 1) return "concluded" as const;
		await txExecute(
			connection,
			// Consent provenance comes from the authoritative original list, not
			// the SES contact we may have just provisioned — record it durably.
			`UPDATE tanah_daily_bulletin_subscriber SET consent_status = 'confirmed',
			 consented_at = COALESCE(consented_at, UTC_TIMESTAMP(3)),
			 consent_source = COALESCE(consent_source, 'Original subscriber list rollout'),
			 last_event_at = UTC_TIMESTAMP(3)
			 WHERE id = ? AND consent_status = 'pending'`,
			[subscriber.id],
		);
		await txExecute(
			connection,
			`UPDATE tanah_daily_bulletin_email_cohort SET status = 'admitted', admission_date = ?
			 WHERE cohort = ? AND subscriber_id = ? AND status = 'pending'`,
			[candidate.localDate, candidate.cohort, subscriber.id],
		);
		return "admitted" as const;
	});
	if (committed === "ineligible") {
		// The recipient opted out between the SES check and activation. Mirror the
		// opt-out back so SES cannot keep the subscription we just created, then
		// skip to the next eligible member within the same day.
		const revert = new SesClient(runtime);
		try {
			await revert.unsubscribeContact(subscriber.email, "real");
		} catch {
			// Local consent is authoritative for every future send; SES events also
			// reconcile the topic preference once the recipient manages it.
		} finally {
			revert.destroy();
		}
		await releaseCandidate(candidate, "late-event");
		return candidate.reselectable;
	}
	return false;
}

/**
 * One sweep pass: claim today's admission if the rollout runs, settle the
 * recorded candidate (re-selecting same-day after ineligible outcomes), then
 * finish older in-flight reservations — never admitting extras for past days.
 */
export async function reconcileRolloutAdmission(
	signal?: AbortSignal,
	now = new Date(),
): Promise<void> {
	await runOutboxSweep(signal, async (abort) => {
		try {
			const runtime = loadEmailRuntime();
			if (!runtime) return;
			// Only a running rollout admits or settles: pausing and disabling
			// freeze in-flight reservations rather than activating them, and the
			// cheap gate avoids wasted provider calls while the rollout is off.
			if (!rolloutAdmits(await readRolloutDeliveryState())) return;
			const localDate = admissionLocalDate(now);
			// Older in-flight reservations settle first: their recorded member was
			// legitimately claimed on that past Jerusalem day, so finishing it does
			// not consume today's reservation nor re-claim the member under today.
			const stale = await query<{
				cohort: string;
				local_date: Date | string;
				subscriber_id: number | null;
			}>(
				`SELECT cohort, DATE_FORMAT(local_date, '%Y-%m-%d') AS local_date, subscriber_id
				 FROM tanah_daily_bulletin_email_admission
				 WHERE status = 'reserved' AND local_date < ? ORDER BY local_date LIMIT ?`,
				[localDate, MAX_STALE_RESERVATIONS],
			);
			for (const row of stale) {
				abort.throwIfAborted();
				const candidate: AdmissionCandidate = {
					cohort: row.cohort,
					localDate:
						typeof row.local_date === "string"
							? row.local_date.slice(0, 10)
							: row.local_date.toISOString().slice(0, 10),
					subscriberId:
						row.subscriber_id === null ? null : Number(row.subscriber_id),
					reselectable: false,
				};
				if (candidate.subscriberId === null) {
					await releaseCandidate(candidate, "lapsed-reservation");
					continue;
				}
				await settleCandidate(candidate, runtime, abort);
			}
			for (let attempt = 0; attempt < MAX_DAILY_ADMISSION_ATTEMPTS; attempt++) {
				abort.throwIfAborted();
				const candidate = await transaction((connection) =>
					claimOrReselect(connection, localDate),
				);
				if (!candidate) break;
				const cleared = await settleCandidate(candidate, runtime, abort);
				if (!cleared) break;
			}
		} catch (error) {
			// A not-yet-deployed rollout schema is not a worker failure.
			if (isMissingRolloutSchema(error)) return;
			// Surface sweep-level failures on the control row the panel reads;
			// recording is best-effort so the original failure still propagates.
			try {
				await execute(
					"UPDATE tanah_daily_bulletin_email_rollout SET last_error = ? WHERE id = 1",
					[(error instanceof Error ? error.message : "sweep").slice(0, 255)],
				);
			} catch {
				// The failure record is informational only.
			}
			throw error;
		}
	});
}
