import type {
	JoinChannel,
	JoinLinkAuditEntry,
	JoinLinkChange,
	JoinLinkState,
} from "~/lib/bulletin-join";
import { JOIN_CHANNELS, validateJoinDestination } from "~/lib/bulletin-join";
import { query, transaction, txExecute, txQueryOne } from "./db";

/**
 * Persistence for the admin-managed public join destinations (#2939).
 * Updates are compare-and-swap on `revision` inside a transaction and every
 * change appends an immutable audit row.
 */

interface JoinLinkRow {
	channel: string;
	enabled: number | boolean;
	destination: string | null;
	revision: number | string;
	updated_by: string | null;
	updated_at: Date | string | null;
}

const toIso = (value: Date | string | null) =>
	value instanceof Date ? value.toISOString() : value || null;

function toState(row: JoinLinkRow): JoinLinkState {
	return {
		channel: row.channel as JoinChannel,
		enabled: Boolean(row.enabled),
		destination: row.destination,
		revision: Number(row.revision),
		updatedBy: row.updated_by,
		updatedAt: toIso(row.updated_at),
	};
}

/**
 * Current state for every channel, in canonical order. Channels missing a
 * row (a migration that has not run yet) are reported disabled rather than
 * hidden, so the admin screen always shows the whole contract.
 */
export async function readJoinLinks(): Promise<JoinLinkState[]> {
	const rows = await query<JoinLinkRow>(
		"SELECT channel, enabled, destination, revision, updated_by, updated_at FROM tanah_daily_bulletin_join_link",
	);
	const byChannel = new Map(rows.map((row) => [row.channel, toState(row)]));
	return JOIN_CHANNELS.map(
		(channel) =>
			byChannel.get(channel) ?? {
				channel,
				enabled: false,
				destination: null,
				revision: 0,
				updatedBy: null,
				updatedAt: null,
			},
	);
}

/** Recent audit entries, newest first, optionally per channel. */
export async function readJoinLinkAudit(
	channel?: JoinChannel,
	limit = 20,
): Promise<JoinLinkAuditEntry[]> {
	const rows = await query<{
		id: number | string;
		channel: string;
		enabled: number | boolean;
		destination: string | null;
		revision: number | string;
		changed_by: string | null;
		changed_at: Date | string;
	}>(
		`SELECT id, channel, enabled, destination, revision, changed_by, changed_at
		 FROM tanah_daily_bulletin_join_link_audit
		 ${channel ? "WHERE channel = ?" : ""}
		 ORDER BY id DESC LIMIT ?`,
		channel ? [channel, limit] : [limit],
	);
	return rows.map((row) => ({
		id: Number(row.id),
		channel: row.channel as JoinChannel,
		enabled: Boolean(row.enabled),
		destination: row.destination,
		revision: Number(row.revision),
		changedBy: row.changed_by,
		changedAt: toIso(row.changed_at) ?? "",
	}));
}

/**
 * Compare-and-swap update: fails with a Hebrew conflict error when the
 * stored revision moved past what the editor saw. Re-validates the
 * destination against the same public contract before writing — the DB is
 * trusted, but the public route re-validates on read as well.
 */
export async function updateJoinLink(
	change: JoinLinkChange & { changedBy: string },
): Promise<JoinLinkState> {
	const destination = change.destination
		? validateJoinDestination(change.channel, change.destination)
		: null;
	if (change.destination && destination === null) {
		throw new Error("כתובת ההצטרפות אינה תקינה");
	}
	return transaction(async (conn) => {
		const row = await txQueryOne<JoinLinkRow>(
			conn,
			"SELECT channel, enabled, destination, revision, updated_by, updated_at FROM tanah_daily_bulletin_join_link WHERE channel = ? FOR UPDATE",
			[change.channel],
		);
		const revision = row ? Number(row.revision) : 0;
		if (revision !== change.expectedRevision) {
			throw new Error("ההגדרה השתנה על ידי עורך אחר. רעננו את המסך ונסו שוב.");
		}
		const nextRevision = revision + 1;
		if (row) {
			await txExecute(
				conn,
				`UPDATE tanah_daily_bulletin_join_link
				 SET enabled = ?, destination = ?, revision = ?, updated_by = ?
				 WHERE channel = ?`,
				[
					change.enabled,
					destination,
					nextRevision,
					change.changedBy,
					change.channel,
				],
			);
		} else {
			await txExecute(
				conn,
				`INSERT INTO tanah_daily_bulletin_join_link
				 (channel, enabled, destination, revision, updated_by)
				 VALUES (?, ?, ?, ?, ?)`,
				[
					change.channel,
					change.enabled,
					destination,
					nextRevision,
					change.changedBy,
				],
			);
		}
		await txExecute(
			conn,
			`INSERT INTO tanah_daily_bulletin_join_link_audit
			 (channel, enabled, destination, revision, changed_by)
			 VALUES (?, ?, ?, ?, ?)`,
			[
				change.channel,
				change.enabled,
				destination,
				nextRevision,
				change.changedBy,
			],
		);
		return {
			channel: change.channel,
			enabled: change.enabled,
			destination,
			revision: nextRevision,
			updatedBy: change.changedBy,
			updatedAt: new Date().toISOString(),
		};
	});
}
