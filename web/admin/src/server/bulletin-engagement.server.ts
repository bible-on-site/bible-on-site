import "@tanstack/react-start/server-only";
import type {
	EmailEditionStats,
	EmailEngagementPanel,
	InactiveSubscriber,
} from "~/lib/bulletin-email";
import { query, transaction, txExecute, txQueryOne } from "./db";
import { SesClient } from "./ses-client.server";
import { isMissingEngagementSchema } from "./ses-delivery.server";
import { loadEmailRuntime } from "./ses-settings.server";

/**
 * Open/click engagement views and the one-year inactivity review (#3707).
 *
 * Engagement is measured per delivery attempt from SES tracked events:
 * `opened_at`/`clicked_at` keep the latest recorded activity of each kind and
 * the counters keep raw event counts. Every metric counts a recipient once
 * per edition, only confirmed deliveries form the denominator, and editions
 * enqueued before tracking was enabled (`tracked = 0`) report as untracked
 * history rather than a measured zero. Test-audience jobs stay out of every
 * production number below.
 */

/** Delivered real editions with per-edition tracked engagement. */
const EDITION_STATS_SQL = `SELECT j.id AS job_id, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS date,
	j.tracked, j.cnt_delivered AS delivered,
	COALESCE(SUM(r.status = 'delivered' AND r.opened_at IS NOT NULL), 0) AS opened,
	COALESCE(SUM(r.status = 'delivered' AND r.clicked_at IS NOT NULL), 0) AS clicked
	FROM tanah_daily_bulletin_email_job j
	LEFT JOIN tanah_daily_bulletin_email_recipient r ON r.job_id = j.id
	WHERE j.audience = 'real'
	GROUP BY j.id, j.bulletin_date, j.tracked, j.cnt_delivered
	ORDER BY j.bulletin_date DESC, j.created_at DESC
	LIMIT 30`;

/**
 * The shared inactivity predicate, used verbatim by both the review list and
 * the confirmation recheck so a listed subscriber is confirmed under the same
 * rule: no delivered-but-untracked edition inside the trailing year (an
 * outage there cannot prove inactivity) and no recorded open or click during
 * that year (a tracked content click counts as activity even without opens).
 */
const INACTIVITY_FILTER = `
	AND NOT EXISTS (
		SELECT 1 FROM tanah_daily_bulletin_email_recipient ux
		JOIN tanah_daily_bulletin_email_job uj ON uj.id = ux.job_id
		WHERE ux.subscriber_id = s.id AND uj.audience = 'real' AND ux.status = 'delivered'
			AND uj.tracked = 0 AND uj.bulletin_date >= (UTC_DATE() - INTERVAL 1 YEAR))
	AND NOT EXISTS (
		SELECT 1 FROM tanah_daily_bulletin_email_recipient ax
		JOIN tanah_daily_bulletin_email_job aj ON aj.id = ax.job_id
		WHERE ax.subscriber_id = s.id AND aj.audience = 'real'
			AND (ax.opened_at >= (UTC_TIMESTAMP(3) - INTERVAL 1 YEAR)
				OR ax.clicked_at >= (UTC_TIMESTAMP(3) - INTERVAL 1 YEAR)))`;

/**
 * Eligible subscribers: at least one year of reliable tracked delivery
 * history (first tracked delivered edition a full year back), at least one
 * actual tracked delivery inside the trailing year, and no recorded activity
 * during it — measured from delivery, not from signup or cohort membership.
 */
const INACTIVITY_TABLES = `
	FROM tanah_daily_bulletin_subscriber s
	JOIN tanah_daily_bulletin_email_recipient r
		ON r.subscriber_id = s.id AND r.status = 'delivered'
	JOIN tanah_daily_bulletin_email_job j
		ON j.id = r.job_id AND j.audience = 'real' AND j.tracked = 1`;

const INACTIVITY_GROUP = `
	GROUP BY s.id, s.email
	HAVING MIN(j.bulletin_date) <= (UTC_DATE() - INTERVAL 1 YEAR)
		AND COALESCE(SUM(j.bulletin_date >= (UTC_DATE() - INTERVAL 1 YEAR)), 0) >= 1`;

const INACTIVITY_LIST_SQL = `SELECT s.id, s.email,
	DATE_FORMAT(MIN(j.bulletin_date), '%Y-%m-%d') AS first_tracked_delivery,
	COALESCE(SUM(j.bulletin_date >= (UTC_DATE() - INTERVAL 1 YEAR)), 0) AS tracked_last_year
	${INACTIVITY_TABLES}
	WHERE s.audience = 'real' AND s.consent_status = 'confirmed'
	${INACTIVITY_FILTER}
	${INACTIVITY_GROUP}
	ORDER BY first_tracked_delivery, s.id
	LIMIT 200`;

const INACTIVITY_RECHECK_SQL = `SELECT s.id, s.email
	${INACTIVITY_TABLES}
	WHERE s.id = ? AND s.audience = 'real' AND s.consent_status = 'confirmed'
	${INACTIVITY_FILTER}
	${INACTIVITY_GROUP}`;

/** Aggregate engagement panel; `null` while the engagement schema is absent. */
export async function readEmailEngagementPanel(): Promise<EmailEngagementPanel | null> {
	try {
		const [editions, inactive] = await Promise.all([
			query<{
				job_id: string;
				date: string;
				tracked: number;
				delivered: number | string;
				opened: number | string;
				clicked: number | string;
			}>(EDITION_STATS_SQL),
			query<{
				id: number;
				email: string;
				first_tracked_delivery: string;
				tracked_last_year: number | string;
			}>(INACTIVITY_LIST_SQL),
		]);
		return {
			editions: editions.map(
				(row): EmailEditionStats => ({
					jobId: row.job_id,
					date: row.date,
					tracked: Boolean(Number(row.tracked)),
					delivered: Number(row.delivered),
					opened: Number(row.opened),
					clicked: Number(row.clicked),
				}),
			),
			inactive: inactive.map(
				(row): InactiveSubscriber => ({
					id: Number(row.id),
					email: row.email,
					firstTrackedDelivery: row.first_tracked_delivery,
					trackedLastYear: Number(row.tracked_last_year),
				}),
			),
		};
	} catch (error) {
		if (isMissingEngagementSchema(error)) return null;
		throw error;
	}
}

/**
 * Confirms the admin inactivity unsubscribe for one subscriber (#3707).
 * Eligibility is re-derived under the subscriber lock — a late open or click
 * cancels the action — then the opt-out is recorded locally with the acting
 * admin before SES mirrors the native unsubscribe. Local consent stays
 * authoritative, so a removed member can never be re-admitted by the
 * original-list rollout, and a failed SES call never restores the
 * subscription.
 */
export async function confirmInactivityUnsubscribe(
	subscriberId: number,
	actor: string,
): Promise<void> {
	const runtime = loadEmailRuntime();
	if (!runtime) throw new Error("שירות הדיוור טרם הוגדר");
	const email = await transaction(async (connection) => {
		const subscriber = await txQueryOne<{
			id: number;
			email: string;
			consent_status: string;
			admin_action: string | null;
		}>(
			connection,
			"SELECT id, email, consent_status, admin_action FROM tanah_daily_bulletin_subscriber WHERE id = ? FOR UPDATE",
			[subscriberId],
		);
		if (!subscriber) throw new Error("המנוי אינו פעיל או שאינו נמצא");
		if (
			subscriber.consent_status === "unsubscribed" &&
			subscriber.admin_action === "inactivity-unsubscribe"
		)
			// Idempotent retry: the local opt-out already landed and only the
			// SES mirror below failed on a previous attempt.
			return subscriber.email;
		if (subscriber.consent_status !== "confirmed")
			throw new Error("המנוי אינו פעיל או שאינו נמצא");
		const eligible = await txQueryOne<{ id: number; email: string }>(
			connection,
			INACTIVITY_RECHECK_SQL,
			[subscriberId],
		);
		if (!eligible)
			throw new Error(
				"המנוי כבר אינו עומד בתנאי ההסרה. נרשמה פעילות או שההיסטוריה אינה מלאה.",
			);
		const removed = await txExecute(
			connection,
			`UPDATE tanah_daily_bulletin_subscriber SET consent_status = 'unsubscribed',
			 last_event_at = UTC_TIMESTAMP(3),
			 admin_action = 'inactivity-unsubscribe', admin_actor = ?, admin_action_at = UTC_TIMESTAMP(3)
			 WHERE id = ? AND consent_status = 'confirmed'`,
			[actor.slice(0, 120), subscriberId],
		);
		if (removed.affectedRows !== 1)
			throw new Error("המנוי אינו פעיל או שאינו נמצא");
		return subscriber.email;
	});
	const client = new SesClient(runtime);
	try {
		await client.unsubscribeContact(email, "real");
	} finally {
		client.destroy();
	}
}
