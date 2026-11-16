/** Original-cohort enrollment plan (#3382). Pure validation + guarded SQL — never applies it. */

export interface CohortSnapshotMember {
	subscriberId: number;
	email: string;
	consentStatus: string;
}

export interface CohortPlanRow {
	subscriberId: number;
	position: number;
	status: "pending" | "admitted" | "excluded";
	excludedReason: string | null;
}

export interface CohortPlan {
	total: number;
	pending: number;
	admitted: number;
	excluded: number;
	rows: CohortPlanRow[];
}

function validEmail(value: string): boolean {
	return (
		value.length <= 254 &&
		/^[\x21-\x7e]+$/.test(value) &&
		!/[<>(),;:"]/.test(value) &&
		/^[^@]+@[^@]+\.[^@]+$/.test(value)
	);
}

function validId(id: number): boolean {
	return Number.isSafeInteger(id) && id > 0;
}

/**
 * Validates the reconciled snapshot of the authoritative original list and
 * assigns each member its cohort status. The array order IS the original
 * signup/import order and becomes `position`. Pending members await the daily
 * admission; confirmed members are recorded as already admitted so they are
 * never re-activated nor double-counted; every other consent state is
 * permanently excluded with its provenance. Duplicate addresses and IDs are
 * rejected — the list must reconcile exactly with the subscriber rows.
 */
export function planBulletinCohort(
	members: CohortSnapshotMember[],
): CohortPlan {
	if (!Array.isArray(members) || !members.length)
		throw new Error("Empty original cohort snapshot");
	const seenIds = new Set<number>();
	const seenEmails = new Set<string>();
	const rows: CohortPlanRow[] = [];
	for (const [index, member] of members.entries()) {
		if (
			!member ||
			typeof member !== "object" ||
			!validId(member.subscriberId) ||
			seenIds.has(member.subscriberId) ||
			typeof member.email !== "string" ||
			!validEmail(member.email) ||
			![
				"pending",
				"confirmed",
				"unsubscribed",
				"bounced",
				"complained",
			].includes(member.consentStatus)
		)
			throw new Error("Invalid original cohort snapshot");
		seenIds.add(member.subscriberId);
		const email = member.email.trim().toLowerCase();
		if (seenEmails.has(email))
			throw new Error("Invalid original cohort snapshot");
		seenEmails.add(email);
		const position = index + 1;
		if (member.consentStatus === "pending")
			rows.push({
				subscriberId: member.subscriberId,
				position,
				status: "pending",
				excludedReason: null,
			});
		else if (member.consentStatus === "confirmed")
			rows.push({
				subscriberId: member.subscriberId,
				position,
				status: "admitted",
				excludedReason: null,
			});
		else
			rows.push({
				subscriberId: member.subscriberId,
				position,
				status: "excluded",
				excludedReason: member.consentStatus,
			});
	}
	return {
		total: rows.length,
		pending: rows.filter((row) => row.status === "pending").length,
		admitted: rows.filter((row) => row.status === "admitted").length,
		excluded: rows.filter((row) => row.status === "excluded").length,
		rows,
	};
}

function sqlEmail(value: string): string {
	if (!validEmail(value) || value.includes("\\"))
		throw new Error("Invalid cohort email");
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * SQL for the database deployment path or a reviewed manual operation.
 * Temporary tables survive the deployment rewrite; the guard aborts the whole
 * transaction when the live rows no longer match the snapshot exactly —
 * consent, audience and email must all still agree. The insert is strict:
 * existing cohort rows or a partial operation roll everything back instead of
 * silently merging cohorts.
 */
export function bulletinCohortSql(
	members: CohortSnapshotMember[],
	plan: CohortPlan,
): string {
	if (members.length !== plan.rows.length)
		throw new Error("Invalid cohort plan");
	const values = members
		.map((member, index) => {
			const row = plan.rows[index];
			if (
				!row ||
				row.subscriberId !== member.subscriberId ||
				row.position !== index + 1
			)
				throw new Error("Invalid cohort plan");
			const reason = row.excludedReason ? `'${row.excludedReason}'` : "NULL";
			return `(${row.subscriberId},${row.position},'${row.status}',${reason},${sqlEmail(member.email.trim().toLowerCase())},'${member.consentStatus}')`;
		})
		.join(",\n");
	const count = plan.rows.length;
	return (
		"CREATE TEMPORARY TABLE bulletin_cohort_plan (subscriber_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,position INT UNSIGNED NOT NULL UNIQUE,status ENUM('pending','admitted','excluded') NOT NULL,excluded_reason VARCHAR(60) NULL,email VARCHAR(254) NOT NULL,consent_status VARCHAR(20) NOT NULL);\n" +
		`INSERT INTO bulletin_cohort_plan VALUES\n${values};\n` +
		"CREATE TEMPORARY TABLE bulletin_cohort_guard (ok TINYINT NOT NULL,CHECK(ok=1));\n" +
		"START TRANSACTION;\n" +
		"SELECT s.id FROM tanah_daily_bulletin_subscriber s JOIN bulletin_cohort_plan p ON p.subscriber_id = s.id ORDER BY s.id FOR UPDATE;\n" +
		`INSERT INTO bulletin_cohort_guard SELECT IF(COUNT(*)=${count},1,0) FROM tanah_daily_bulletin_subscriber s JOIN bulletin_cohort_plan p ON p.subscriber_id = s.id WHERE s.audience = 'real' AND LOWER(s.email) = p.email AND s.consent_status = p.consent_status;\n` +
		"INSERT INTO tanah_daily_bulletin_email_cohort (cohort, subscriber_id, position, status, excluded_reason) SELECT 'original', p.subscriber_id, p.position, p.status, p.excluded_reason FROM bulletin_cohort_plan p;\n" +
		"SET @bulletinCohortWritten=ROW_COUNT();\n" +
		`INSERT INTO bulletin_cohort_guard SELECT IF(@bulletinCohortWritten=${count} AND COUNT(*)=${count},1,0) FROM tanah_daily_bulletin_email_cohort c JOIN bulletin_cohort_plan p ON p.subscriber_id = c.subscriber_id WHERE c.cohort = 'original' AND c.position = p.position AND c.status = p.status;\n` +
		"COMMIT;\n"
	);
}
