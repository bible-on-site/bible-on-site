import "@tanstack/react-start/server-only";
import type { PoolConnection } from "mysql2/promise";
import {
	admissionLocalDate,
	type EmailAdmissionRecord,
	type EmailRolloutChange,
	type EmailRolloutState,
	type EmailRolloutSummary,
	rolloutTransition,
} from "~/lib/bulletin-rollout";
import { query, queryOne, transaction, txExecute, txQueryOne } from "./db";

/** ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR — the rollout upgrade is not deployed yet. */
export function isMissingRolloutSchema(error: unknown): boolean {
	const code = (error as { code?: string })?.code;
	return code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR";
}

export interface EmailRolloutRow {
	state: EmailRolloutState;
	cohort: string;
	revision: number;
	last_error: string | null;
}

function rolloutStateOf(
	row: { state?: string } | null,
): EmailRolloutState | null {
	return row &&
		(row.state === "disabled" ||
			row.state === "running" ||
			row.state === "paused" ||
			row.state === "completed")
		? row.state
		: null;
}

/** The persisted rollout row; `null` while the rollout schema is absent. */
export async function readRolloutRow(): Promise<EmailRolloutRow | null> {
	try {
		const row = await queryOne<{
			state: string;
			cohort: string;
			revision: number | string;
			last_error: string | null;
		}>(
			"SELECT state, cohort, revision, last_error FROM tanah_daily_bulletin_email_rollout WHERE id = 1",
		);
		if (!row) return null;
		const state = rolloutStateOf(row);
		// A malformed singleton row is not a deployed rollout — show nothing
		// rather than fake counts or a license.
		if (state === null || typeof row.cohort !== "string") return null;
		return {
			state,
			cohort: row.cohort,
			revision: Number(row.revision),
			last_error: row.last_error,
		};
	} catch (error) {
		if (isMissingRolloutSchema(error)) return null;
		throw error;
	}
}

/**
 * The delivery license for the limited real cohort inside a caller
 * transaction. `FOR UPDATE` serializes the license read against the admin
 * disable transition. `null` = no license (missing or disabled rollout).
 */
export async function rolloutDeliveryStateForUpdate(
	connection: PoolConnection,
): Promise<EmailRolloutState | null> {
	try {
		const row = await txQueryOne<{ state: string }>(
			connection,
			"SELECT state FROM tanah_daily_bulletin_email_rollout WHERE id = 1 FOR UPDATE",
		);
		return rolloutStateOf(row);
	} catch (error) {
		if (isMissingRolloutSchema(error)) return null;
		throw error;
	}
}

/** Non-transactional variant for schedule/queue-time license checks. */
export async function readRolloutDeliveryState(): Promise<EmailRolloutState | null> {
	try {
		const row = await queryOne<{ state: string }>(
			"SELECT state FROM tanah_daily_bulletin_email_rollout WHERE id = 1",
		);
		return rolloutStateOf(row);
	} catch (error) {
		if (isMissingRolloutSchema(error)) return null;
		throw error;
	}
}

/** Aggregate operator view; `null` while the rollout schema is absent. */
export async function getBulletinRolloutSummary(
	now = new Date(),
): Promise<EmailRolloutSummary | null> {
	try {
		const row = await readRolloutRow();
		if (!row) return null;
		const localDate = admissionLocalDate(now);
		const [counts, admission] = await Promise.all([
			query<{ status: string; consent_status: string; n: number | string }>(
				`SELECT c.status, s.consent_status, COUNT(*) AS n
				 FROM tanah_daily_bulletin_email_cohort c
				 JOIN tanah_daily_bulletin_subscriber s ON s.id = c.subscriber_id
				 WHERE c.cohort = ? GROUP BY c.status, s.consent_status`,
				[row.cohort],
			),
			queryOne<{
				local_date: Date | string;
				status: string;
				subscriber_id: number | null;
				last_error: string | null;
			}>(
				`SELECT DATE_FORMAT(local_date, '%Y-%m-%d') AS local_date, status, subscriber_id, last_error
				 FROM tanah_daily_bulletin_email_admission
				 WHERE cohort = ? AND local_date = ?`,
				[row.cohort, localDate],
			),
		]);
		let admitted = 0;
		let remaining = 0;
		let excluded = 0;
		for (const count of counts) {
			const n = Number(count.n);
			if (count.status === "admitted") admitted += n;
			else if (count.status === "pending" && count.consent_status === "pending")
				remaining += n;
			else excluded += n;
		}
		return {
			state: row.state,
			cohort: row.cohort,
			revision: row.revision,
			admitted,
			remaining,
			excluded,
			admission: (() => {
				const raw = admission?.local_date;
				const localDate =
					typeof raw === "string"
						? raw.slice(0, 10)
						: raw instanceof Date
							? raw.toISOString().slice(0, 10)
							: null;
				return admission && localDate
					? ({
							localDate,
							status: admission.status as EmailAdmissionRecord["status"],
							subscriberId:
								admission.subscriber_id === null
									? null
									: Number(admission.subscriber_id),
							lastError: admission.last_error,
						} satisfies EmailAdmissionRecord)
					: null;
			})(),
			lastError: row.last_error,
		};
	} catch (error) {
		if (isMissingRolloutSchema(error)) return null;
		throw error;
	}
}

/**
 * Revision-checked operator control. Enabling starts daily admissions at the
 * next worker sweep; pausing keeps deliveries to already admitted subscribers;
 * disabling is the full rollback — no admissions and no cohort delivery.
 */
export async function setRolloutState(
	change: EmailRolloutChange,
): Promise<{ state: EmailRolloutState; revision: number }> {
	return transaction(async (connection) => {
		let row: { state: string; revision: number | string } | null;
		try {
			row = await txQueryOne<{
				state: string;
				revision: number | string;
			}>(
				connection,
				"SELECT state, revision FROM tanah_daily_bulletin_email_rollout WHERE id = 1 FOR UPDATE",
			);
		} catch (error) {
			if (isMissingRolloutSchema(error))
				throw new Error("ההפעלה ההדרגתית טרם הוגדרה במסד הנתונים");
			throw error;
		}
		const state = rolloutStateOf(row);
		if (state === null || Number(row?.revision) !== change.revision)
			throw new Error("מצב ההפעלה השתנה. רעננו את המסך.");
		const next = rolloutTransition(state, change.action);
		if (next === null) throw new Error("פעולת ההפעלה אינה תקינה למצב הנוכחי");
		if (next === state) return { state, revision: change.revision };
		await txExecute(
			connection,
			`UPDATE tanah_daily_bulletin_email_rollout SET state = ?, revision = revision + 1, last_error = NULL,
			 started_at = IF(? = 'running' AND started_at IS NULL, UTC_TIMESTAMP(3), started_at),
			 completed_at = IF(? = 'completed' AND completed_at IS NULL, UTC_TIMESTAMP(3), completed_at)
			 WHERE id = 1`,
			[next, next, next],
		);
		return { state: next, revision: change.revision + 1 };
	});
}
