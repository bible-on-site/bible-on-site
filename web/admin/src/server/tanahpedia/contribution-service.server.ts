import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import {
	CONTRIBUTION_API_VERSION,
	migrationBlocked,
} from "~/lib/tanahpedia/contribution-api";
import {
	assertMergeAllowed,
	assigneeLabel,
	type Contribution,
	type ContributionEvent,
	type Contributor,
	contributionSnapshot,
	record,
	sameState,
	textField,
	uuidField,
	validateAssignee,
	validateChanges,
	validateEvidence,
} from "~/lib/tanahpedia/contributions";
import { query } from "../db";
import { pediaInvalidation, revalidateWebsite } from "../website-revalidate";
import {
	applyChange,
	assertMetadataNames,
	prepareChanges,
	readChangeState,
} from "./contribution-changes.server";
import { contributionApplyRank } from "./contribution-records.server";
import {
	insertContribution,
	readContribution,
	saveContribution,
	withContributions,
} from "./contribution-store.server";
import {
	pediaChangesForEntities,
	pediaChangesForEntryIds,
	pediaChangesForPersons,
} from "./paths";

export function addEvent(
	item: Contribution,
	actor: Contributor,
	kind: ContributionEvent["kind"],
	body: string,
): void {
	if (item.events.length >= 1000 && kind === "comment")
		throw new Error("This discussion has reached its event limit");
	item.events.push({
		id: randomUUID(),
		actor,
		kind,
		body,
		at: new Date().toISOString(),
		revision: item.revision,
		...(["approved", "changes_requested", "merged"].includes(kind)
			? { snapshot: contributionSnapshot(item) }
			: {}),
	});
}

function rememberRevision(item: Contribution): void {
	item.revisionHistory = [
		...(item.revisionHistory ?? []),
		contributionSnapshot(item),
	];
}

export function assertVersion(item: Contribution, version: unknown): void {
	if (!Number.isSafeInteger(version) || item.version !== version)
		throw new Error("This issue or PR changed. Reload before retrying.");
}

function cancelGeneration(item: Contribution, reason: string): void {
	if (
		item.generation &&
		["queued", "running"].includes(item.generation.status)
	) {
		item.generation.status = "cancelled";
		item.generation.error = reason;
	}
}

export async function createContribution(
	raw: unknown,
	actor: Contributor,
	provenance: Contribution["provenance"] = null,
	existingConn?: PoolConnection,
): Promise<Contribution> {
	const input = record(raw);
	if (input.kind !== "issue" && input.kind !== "pr")
		throw new Error("kind must be issue or pr");
	const title = textField(input.title, "title"),
		description = textField(input.description, "description", 20000);
	const evidence = validateEvidence(input.evidence ?? []);
	const assignee = validateAssignee(input.assignee ?? { kind: "unassigned" });
	const changes = input.kind === "pr" ? validateChanges(input.changes) : [];
	if (input.kind === "pr" && evidence.length === 0)
		throw new Error("PRs require at least one evidence source");
	const issueId =
		input.issueId == null ? null : uuidField(input.issueId, "issueId");
	if (input.kind === "issue" && issueId)
		throw new Error("An issue cannot resolve another issue");
	const create = async (conn: PoolConnection) => {
		if (issueId) {
			const issue = await readContribution(conn, issueId, true);
			if (issue.kind !== "issue" || issue.state !== "open")
				throw new Error("The linked issue must be open");
			if (input.issueVersion !== undefined)
				assertVersion(issue, input.issueVersion);
		}
		const now = new Date().toISOString();
		const item: Contribution = {
			id: randomUUID(),
			number: 0,
			kind: input.kind as Contribution["kind"],
			state: "open",
			title,
			description,
			author: actor,
			revisionAuthor: actor,
			assignee,
			evidence,
			changes: await prepareChanges(conn, changes),
			issueId,
			revision: 1,
			version: 1,
			events: [],
			createdAt: now,
			updatedAt: now,
			closeIssue: input.closeIssue !== false,
			provenance,
			apiVersion: CONTRIBUTION_API_VERSION,
		};
		addEvent(item, actor, "created", "");
		return insertContribution(conn, item);
	};
	return existingConn ? create(existingConn) : withContributions(create);
}

export async function editContribution(
	raw: unknown,
	actor: Contributor,
): Promise<Contribution> {
	const input = record(raw),
		id = uuidField(input.id, "id");
	const title = textField(input.title, "title"),
		description = textField(input.description, "description", 20000);
	const evidence = validateEvidence(input.evidence ?? []);
	return withContributions(async (conn) => {
		const item = await readContribution(conn, id, true);
		assertVersion(item, input.version);
		if (item.state !== "open") throw new Error("Reopen before editing");
		const changes =
			item.kind === "pr"
				? await prepareChanges(conn, validateChanges(input.changes))
				: [];
		if (item.kind === "pr" && evidence.length === 0)
			throw new Error("PRs require evidence");
		const assignee =
			input.assignee === undefined
				? item.assignee
				: validateAssignee(input.assignee);
		const assignmentChanged = !sameState(item.assignee, assignee);
		const contentChanged = !sameState(
			{
				title: item.title,
				description: item.description,
				evidence: item.evidence,
				changes: item.changes,
				closeIssue: item.closeIssue,
			},
			{
				title,
				description,
				evidence,
				changes,
				closeIssue: input.closeIssue !== false,
			},
		);
		if (!contentChanged && !assignmentChanged) return item;
		if (assignmentChanged) {
			cancelGeneration(item, "The issue assignee changed");
			item.assignee = assignee;
			addEvent(item, actor, "assigned", assigneeLabel(assignee));
		}
		if (!contentChanged) return saveContribution(conn, item);
		rememberRevision(item);
		item.title = title;
		cancelGeneration(
			item,
			"The issue was edited after generation was requested",
		);
		item.description = description;
		item.evidence = evidence;
		item.changes = changes;
		item.revisionAuthor = actor;
		item.apiVersion = CONTRIBUTION_API_VERSION;
		delete item.apiMigration;
		item.closeIssue = input.closeIssue !== false;
		item.revision += 1;
		addEvent(item, actor, "edited", "העדכון מבטל אישורים של גרסאות קודמות");
		return saveContribution(conn, item);
	});
}

/** Human recovery is an authored edit. Recapture authoritative base states and
 * names instead of trusting editable before/labels from the raw sequence. */
export async function recoverContributionSequence(
	raw: unknown,
	actor: Contributor,
): Promise<Contribution> {
	const input = record(raw),
		id = uuidField(input.id, "id");
	if (input.apiVersion !== CONTRIBUTION_API_VERSION)
		throw new Error("Recovery must target the latest API version");
	if (!Array.isArray(input.sequence) || input.sequence.length > 40)
		throw new Error("Recovery requires at most 40 operations");
	// Recovery accepts current operation inputs; stored bases/preconditions are
	// discarded and recaptured authoritatively after the PR lock is acquired.
	const sequence = input.sequence.map((raw) => record(raw, "operation"));
	const changes = validateChanges(
		sequence.map(({ kind, targetId, after }) => ({ kind, targetId, after })),
	);
	return withContributions(async (conn) => {
		const item = await readContribution(conn, id, true);
		assertVersion(item, input.version);
		if (item.state !== "open" || !migrationBlocked(item))
			throw new Error("Only an incompatible open PR can be recovered");
		rememberRevision(item);
		item.changes = await prepareChanges(conn, changes);
		item.revisionAuthor = actor;
		item.apiVersion = CONTRIBUTION_API_VERSION;
		delete item.apiMigration;
		item.revision++;
		addEvent(
			item,
			actor,
			"edited",
			"רצף הפעולות שוחזר ידנית. הרצף הקודם נשמר בהיסטוריה; נדרש אישור לגרסה הערוכה.",
		);
		return saveContribution(conn, item);
	});
}

export async function updateContribution(
	raw: unknown,
	actor: Contributor,
): Promise<Contribution> {
	const input = record(raw),
		id = uuidField(input.id, "id");
	return withContributions(async (conn) => {
		const item = await readContribution(conn, id, true);
		assertVersion(item, input.version);
		if (input.action === "comment") {
			addEvent(item, actor, "comment", textField(input.body, "comment", 10000));
		} else if (input.action === "assign") {
			if (item.state !== "open")
				throw new Error("Only open items can be assigned");
			const assignee = validateAssignee(input.assignee);
			if (!sameState(item.assignee, assignee))
				cancelGeneration(item, "The issue assignee changed");
			item.assignee = assignee;
			addEvent(item, actor, "assigned", assigneeLabel(item.assignee));
		} else if (
			input.action === "approve" ||
			input.action === "request_changes"
		) {
			if (item.kind !== "pr" || item.state !== "open")
				throw new Error("Only open PRs can be reviewed");
			if (actor.kind !== "human" || !actor.isDoradsoft)
				throw new Error("Only doradsoft can approve or request changes");
			addEvent(
				item,
				actor,
				input.action === "approve" ? "approved" : "changes_requested",
				typeof input.body === "string" ? input.body.trim().slice(0, 10000) : "",
			);
		} else if (input.action === "queue_generation") {
			if (
				item.kind !== "issue" ||
				item.state !== "open" ||
				item.assignee.kind !== "local_llm" ||
				actor.kind !== "human"
			)
				throw new Error(
					"Queue generation for an open issue assigned to Local LLM",
				);
			if (!item.evidence.length)
				throw new Error("Add evidence before requesting generation");
			if (
				item.generation &&
				(item.generation.status === "queued" ||
					(item.generation.status === "running" &&
						Date.parse(item.generation.leaseExpiresAt ?? "") > Date.now()))
			)
				throw new Error("Local generation is already queued or running");
			item.generation = {
				id: randomUUID(),
				status: "queued",
				requestedAt: new Date().toISOString(),
				requestedBy: actor.id,
				attempts: 0,
				apiVersion: CONTRIBUTION_API_VERSION,
				worker: null,
				model: null,
				leaseHash: null,
				leaseExpiresAt: null,
				claimedVersion: null,
				contextHash: null,
				outputHash: null,
				prIds: [],
				error: null,
			};
			addEvent(
				item,
				actor,
				"generation_queued",
				"נשלח לעובד Local LLM בתחנת העבודה",
			);
		} else if (input.action === "close") {
			if (item.state !== "open") throw new Error("Item is already closed");
			item.state = "closed";
			cancelGeneration(item, "The issue was closed");
			addEvent(item, actor, "closed", "");
		} else if (input.action === "reopen") {
			if (item.state !== "closed")
				throw new Error("Only closed items can reopen");
			rememberRevision(item);
			item.state = "open";
			item.revision += 1;
			addEvent(item, actor, "reopened", "");
		} else {
			throw new Error("Unsupported issue/PR action");
		}
		return saveContribution(conn, item);
	});
}

async function applyReviewedChanges(
	conn: PoolConnection,
	item: Contribution,
): Promise<void> {
	// Stable ordering prevents two PRs touching overlapping rows from locking
	// their target sets in opposite orders. All freshness checks precede writes.
	const changes = [...item.changes].sort((a, b) =>
		`${a.kind}:${a.targetId}`.localeCompare(`${b.kind}:${b.targetId}`),
	);
	for (const change of changes) {
		const current = await readChangeState(
			conn,
			change.kind,
			change.targetId,
			change.after ?? change.before,
		);
		// Match preparation's entity -> person -> MAIN-name lock order.
		await assertMetadataNames(conn, change);
		if (!sameState(current, change.before))
			throw new Error(
				`Conflict: ${change.kind} changed since this PR was prepared. Edit the PR to review a fresh diff.`,
			);
	}
	for (const change of [...changes].sort(
		(a, b) => contributionApplyRank(a) - contributionApplyRank(b),
	))
		await applyChange(conn, change, `contribution-pr:${item.number}`);
}

export async function mergeContribution(
	raw: unknown,
	actor: Contributor,
): Promise<Contribution> {
	const input = record(raw),
		id = uuidField(input.id, "id");
	const merged = await withContributions(async (conn) => {
		const item = await readContribution(conn, id, true);
		assertVersion(item, input.version);
		assertMergeAllowed(item);
		await applyReviewedChanges(conn, item);
		item.state = "merged";
		addEvent(item, actor, "merged", `${item.changes.length} שינויים הוחלו`);
		await saveContribution(conn, item);
		if (item.issueId && item.closeIssue) {
			const issue = await readContribution(conn, item.issueId, true);
			if (issue.state === "open") {
				issue.state = "closed";
				cancelGeneration(issue, "The linked PR was merged");
				addEvent(issue, actor, "closed", `מוזג ב-PR #${item.number}`);
				await saveContribution(conn, issue);
			}
		}
		return item;
	});
	// Invalidate only after committing; a website read must see merged data.
	try {
		const people = new Set<string>(),
			entities = new Set<string>(),
			places = new Set<string>();
		for (const change of merged.changes) {
			if (change.kind === "metadata") entities.add(change.targetId);
			for (const state of [change.before, change.after]) {
				for (const key of ["parentId", "childId", "person1Id", "person2Id"])
					if (typeof state?.[key] === "string") people.add(state[key]);
				if (typeof state?.placeId === "string") places.add(state.placeId);
			}
		}
		if (places.size) {
			const rows = await query<{ entity_id: string }>(
				`SELECT entity_id FROM tanahpedia_place WHERE id IN (${[...places].map(() => "?").join(",")})`,
				[...places],
			);
			for (const row of rows) entities.add(row.entity_id);
		}
		const requests = await Promise.all([
			pediaChangesForPersons([...people]),
			pediaChangesForEntities([...entities]),
			pediaChangesForEntryIds(
				merged.changes
					.filter((change) => change.kind === "entry")
					.map((change) => change.targetId),
			),
		]);
		await revalidateWebsite(
			merged.changes.some(
				(c) =>
					!["parent_child", "union", "place", "metadata", "entry"].includes(
						c.kind,
					),
			)
				? pediaInvalidation()
				: requests.flat(),
		);
	} catch {
		// Content is already committed. A scoped-resolution failure must not
		// report a failed merge or leave the affected pages cached indefinitely.
		console.error(
			"PR merged; scoped cache resolution failed, applying full pedia invalidation",
		);
		await revalidateWebsite(pediaInvalidation());
	}
	return merged;
}
