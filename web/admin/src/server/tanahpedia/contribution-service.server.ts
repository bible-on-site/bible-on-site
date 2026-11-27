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
	type ContributionGeneration,
	type Contributor,
	contributionHasEffect,
	contributionSnapshot,
	record,
	sameState,
	textField,
	uuidField,
	validateAssignee,
	validateChanges,
	validateEvidence,
	validateIssueScope,
} from "~/lib/tanahpedia/contributions";
import { query } from "../db";
import { pediaInvalidation, revalidateWebsite } from "../website-revalidate";
import { getAssignedContributionAgent } from "./contribution-agent-registry.server";
import { notifyContributionAgentWork } from "./contribution-agent-runtime.server";
import { refreshArticleLinkEvidence } from "./contribution-article-evidence.server";
import {
	applyReviewedArticleLinks,
	assertArticleLinkMergeBase,
	assertNoArticleLinkMerge,
	invalidateMergedArticleLinks,
	isArticleLinkPr,
} from "./contribution-article-merge.server";
import {
	applyChange,
	assertMetadataNames,
	prepareChanges,
	readChangeState,
} from "./contribution-changes.server";
import { readCurrentContribution } from "./contribution-migrations.server";
import { contributionApplyRank } from "./contribution-records.server";
import {
	assertDistinctContributionAliases,
	readContributionSourceFact,
} from "./contribution-specials.server";
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

function editedChanges(item: Contribution, value: unknown) {
	// A successful API conversion may explicitly retire every operation. Editing
	// its description/evidence must not invent an operation to retain that PR.
	if (
		Array.isArray(value) &&
		value.length === 0 &&
		item.changes.length === 0 &&
		item.apiMigration?.status === "succeeded"
	)
		return [];
	return validateChanges(value);
}

/** Apply a validated model-authored revision inside the worker's lease/result
 * transaction. The caller saves its response and completion receipt atomically. */
export async function applyContributionAgentRevision(
	conn: PoolConnection,
	item: Contribution,
	draft: {
		title?: unknown;
		description?: unknown;
		evidence?: unknown;
		changes?: unknown;
	},
	actor: Contributor,
	options: { verbatimFields?: readonly ("title" | "description")[] } = {},
): Promise<boolean> {
	assertNoArticleLinkMerge(item);
	if (item.kind !== "pr" || item.state !== "open")
		throw new Error("Agent revisions require an open PR");
	if (!["local_llm", "aws_llm"].includes(actor.kind) || actor.isDoradsoft)
		throw new Error("Agent revisions require model authorship");
	const fieldText = (
		value: unknown,
		field: "title" | "description",
		max: number,
	) => {
		const validated = textField(value, field, max);
		if (!options.verbatimFields?.includes(field)) return validated;
		if (typeof value !== "string" || value.length > max)
			throw new Error(`${field}: exceeds maximum length`);
		return value;
	};
	const title =
		draft.title === undefined
			? item.title
			: fieldText(draft.title, "title", 255);
	const description =
		draft.description === undefined
			? item.description
			: fieldText(draft.description, "description", 20000);
	let evidence =
		draft.evidence === undefined
			? item.evidence
			: validateEvidence(draft.evidence);
	if (!evidence.length) throw new Error("PRs require evidence");
	const changes = await prepareChanges(
		conn,
		editedChanges(
			item,
			draft.changes === undefined
				? item.changes.map(({ kind, targetId, after }) => ({
						kind,
						targetId,
						after,
					}))
				: draft.changes,
		),
		{ refresh: true },
	);
	evidence = await refreshArticleLinkEvidence(conn, { changes, evidence });
	if (
		sameState(
			{ title, description, evidence, changes },
			{
				title: item.title,
				description: item.description,
				evidence: item.evidence,
				changes: item.changes,
			},
		)
	)
		return false;
	rememberRevision(item);
	item.title = title;
	item.description = description;
	item.evidence = evidence;
	item.changes = changes;
	item.revisionAuthor = actor;
	item.apiVersion = CONTRIBUTION_API_VERSION;
	if (changes.length !== 0) delete item.apiMigration;
	delete item.domainConflict;
	item.revision++;
	addEvent(
		item,
		actor,
		"edited",
		"הסוכן עדכן את ההצעה. נדרש אישור לגרסה המעודכנת.",
	);
	return true;
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

/** Accepted human feedback must not disappear behind an interrupted API merge.
 * Serialize on the PR, retain the attempt receipt, and refresh any observed
 * partial result before queueing the ordinary comment-resolution pass. */
async function reconcileInterruptedArticleFeedback(
	conn: PoolConnection,
	item: Contribution,
): Promise<void> {
	const attempt = item.articleLinkMerge;
	if (!attempt) return;
	let changes = item.changes;
	let evidence = item.evidence;
	let conflict: string | undefined;
	try {
		changes = await prepareChanges(
			conn,
			validateChanges(
				item.changes.map(({ kind, targetId, after }) => ({
					kind,
					targetId,
					after,
				})),
			),
			{ refresh: true },
		);
		evidence = await refreshArticleLinkEvidence(conn, { changes, evidence });
	} catch (error) {
		if (error && typeof error === "object" && "code" in error) throw error;
		conflict =
			error instanceof Error
				? error.message
				: "Could not refresh the interrupted article merge";
	}
	const changed =
		Boolean(conflict) ||
		!sameState(
			{ changes, evidence },
			{ changes: item.changes, evidence: item.evidence },
		);
	if (changed) {
		rememberRevision(item);
		item.changes = changes;
		item.evidence = evidence;
		item.revision++;
		item.revisionAuthor = {
			id: "system:article-merge-feedback",
			name: "המערכת",
			kind: "system",
			isDoradsoft: false,
		};
		item.domainConflict = conflict;
	}
	delete item.articleLinkMerge;
	addEvent(
		item,
		{
			id: "system:article-merge-feedback",
			name: "המערכת",
			kind: "system",
			isDoradsoft: false,
		},
		changed ? "rebased" : "comment",
		`ניסיון מיזוג ${attempt.id} נשמר בהיסטוריה לאחר תגובה חדשה. ${changed ? "ההשוואה רועננה לפי המצב בפועל ונדרשת סקירה מחודשת." : "ההשוואה לא השתנתה."}`,
	);
}

/** Assignment and human feedback commit their durable work request together.
 * Replacing an active job revokes its lease; a stale model cannot overwrite it. */
export async function queueAssignedContributionAgent(
	conn: PoolConnection,
	item: Contribution,
	actor: Contributor,
	trigger: NonNullable<ContributionGeneration["trigger"]>,
	triggerEventIds: string[] = [],
): Promise<boolean> {
	if (
		item.state !== "open" ||
		item.articleLinkMerge ||
		!["human", "system"].includes(actor.kind) ||
		(item.assignee.kind !== "local_llm" && item.assignee.kind !== "aws_llm")
	)
		return false;
	const agent = await getAssignedContributionAgent(conn, item.assignee);
	const canRun = agent.enabled && Boolean(agent.model);
	const previousTriggers =
		item.generation &&
		["queued", "running", "needs_input"].includes(item.generation.status)
			? (item.generation.triggerEventIds ?? [])
			: [];
	item.generation = {
		id: randomUUID(),
		status: canRun ? "queued" : "needs_input",
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
		error: !agent.enabled
			? "הסוכן מושבת. ניתן להפעיל אותו בעמוד הסוכנים."
			: !agent.model
				? "יש להגדיר מודל לסוכן בעמוד הסוכנים."
				: null,
		task: item.kind === "issue" ? "issue_implementation" : "pr_resolution",
		provider: agent.provider,
		agentId: agent.id,
		bundleVersion: agent.installedVersion,
		bundleHash: agent.bundleHash,
		agentVersion: agent.version,
		trigger,
		triggerEventIds: [...new Set([...previousTriggers, ...triggerEventIds])],
	};
	addEvent(
		item,
		actor,
		"generation_queued",
		canRun ? "המשימה נשלחה לסוכן המשויך" : (item.generation.error ?? ""),
	);
	const event = item.events[item.events.length - 1];
	event.run = {
		jobId: item.generation.id,
		agentId: agent.id,
		bundleVersion: agent.installedVersion,
		model: agent.model ?? "",
	};
	return true;
}

function wakeAgent(item: Contribution): Contribution {
	if (item.generation?.status === "queued") notifyContributionAgentWork();
	return item;
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
	const scope = validateIssueScope(input.scope);
	if (input.kind !== "issue" && scope)
		throw new Error("Only issues support a change scope");
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
		const preparedChanges = await prepareChanges(conn, changes);
		const freshEvidence = await refreshArticleLinkEvidence(conn, {
			changes: preparedChanges,
			evidence,
		});
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
			...(scope ? { scope } : {}),
			evidence: freshEvidence,
			changes: preparedChanges,
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
		await queueAssignedContributionAgent(conn, item, actor, "assignment", [
			item.events[0].id,
		]);
		return insertContribution(conn, item);
	};
	return existingConn
		? create(existingConn)
		: withContributions(create).then(wakeAgent);
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
		const scope =
			input.scope === undefined ? item.scope : validateIssueScope(input.scope);
		if (item.kind !== "issue" && scope)
			throw new Error("Only issues support a change scope");
		const changes =
			item.kind === "pr"
				? await prepareChanges(conn, editedChanges(item, input.changes), {
						// Existing proposals may retain operations satisfied by another
						// merge. Re-read all bases and references while allowing no-ops.
						refresh: true,
					})
				: [];
		if (item.kind === "pr" && evidence.length === 0)
			throw new Error("PRs require evidence");
		const freshEvidence = await refreshArticleLinkEvidence(conn, {
			changes,
			evidence,
		});
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
				scope: item.scope,
			},
			{
				title,
				description,
				evidence: freshEvidence,
				changes,
				closeIssue: input.closeIssue !== false,
				scope,
			},
		);
		if (item.articleLinkMerge && !contentChanged)
			assertNoArticleLinkMerge(item);
		if (!contentChanged && !assignmentChanged) return item;
		if (assignmentChanged) {
			cancelGeneration(item, "The issue assignee changed");
			item.assignee = assignee;
			addEvent(item, actor, "assigned", assigneeLabel(assignee));
		}
		if (!contentChanged) {
			await queueAssignedContributionAgent(conn, item, actor, "assignment", [
				item.events[item.events.length - 1].id,
			]);
			return saveContribution(conn, item);
		}
		rememberRevision(item);
		if (item.articleLinkMerge) {
			addEvent(
				item,
				actor,
				"comment",
				`ניסיון מיזוג ${item.articleLinkMerge.id} נשמר בהיסטוריה. העריכה קראה מחדש את המצב בפועל; נדרש אישור להשוואה החדשה.`,
			);
			delete item.articleLinkMerge;
		}
		item.title = title;
		cancelGeneration(
			item,
			"The issue was edited after generation was requested",
		);
		item.description = description;
		item.scope = scope;
		item.evidence = freshEvidence;
		item.changes = changes;
		delete item.domainConflict;
		item.revisionAuthor = actor;
		item.apiVersion = CONTRIBUTION_API_VERSION;
		if (changes.length !== 0) delete item.apiMigration;
		item.closeIssue = input.closeIssue !== false;
		item.revision += 1;
		addEvent(item, actor, "edited", "העדכון מבטל אישורים של גרסאות קודמות");
		await queueAssignedContributionAgent(conn, item, actor, "edit", [
			item.events[item.events.length - 1].id,
		]);
		return saveContribution(conn, item);
	}).then(wakeAgent);
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
		delete item.articleLinkMerge;
		item.changes = await prepareChanges(conn, changes);
		delete item.domainConflict;
		try {
			item.evidence = await refreshArticleLinkEvidence(conn, item);
		} catch (error) {
			if (error && typeof error === "object" && "code" in error) throw error;
			// Recover the executable vocabulary first so the ordinary editor can
			// repair obsolete evidence. Do not trap a gray PR behind its raw-only UI.
			item.domainConflict =
				error instanceof Error
					? error.message
					: "Structured evidence requires repair";
		}
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
		await queueAssignedContributionAgent(conn, item, actor, "edit", [
			item.events[item.events.length - 1].id,
		]);
		return saveContribution(conn, item);
	}).then(wakeAgent);
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
		if (input.action !== "comment") assertNoArticleLinkMerge(item);
		if (input.action === "comment") {
			if (actor.kind === "human")
				await reconcileInterruptedArticleFeedback(conn, item);
			addEvent(item, actor, "comment", textField(input.body, "comment", 10000));
			if (actor.kind === "human")
				await queueAssignedContributionAgent(conn, item, actor, "comment", [
					item.events[item.events.length - 1].id,
				]);
		} else if (input.action === "assign") {
			if (item.state !== "open")
				throw new Error("Only open items can be assigned");
			const assignee = validateAssignee(input.assignee);
			if (!sameState(item.assignee, assignee))
				cancelGeneration(item, "The issue assignee changed");
			item.assignee = assignee;
			addEvent(item, actor, "assigned", assigneeLabel(item.assignee));
			await queueAssignedContributionAgent(conn, item, actor, "assignment", [
				item.events[item.events.length - 1].id,
			]);
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
			if (input.action === "request_changes")
				await queueAssignedContributionAgent(conn, item, actor, "comment", [
					item.events[item.events.length - 1].id,
				]);
		} else if (input.action === "run_agent") {
			if (
				actor.kind !== "human" ||
				!(await queueAssignedContributionAgent(conn, item, actor, "manual"))
			) {
				throw new Error(
					"Run an agent on an open issue or PR assigned to an LLM",
				);
			}
		} else if (input.action === "queue_generation") {
			if (item.generation?.task)
				throw new Error("Use run_agent for registered agent work");
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
			await queueAssignedContributionAgent(conn, item, actor, "reopen", [
				item.events[item.events.length - 1].id,
			]);
		} else {
			throw new Error("Unsupported issue/PR action");
		}
		return saveContribution(conn, item);
	}).then(wakeAgent);
}

async function applyReviewedChanges(
	conn: PoolConnection,
	item: Contribution,
): Promise<void> {
	await assertDistinctContributionAliases(conn, item.changes);
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
		if (
			change.sourceTarget &&
			!sameState(
				await readContributionSourceFact(
					conn,
					change.sourceTarget.kind,
					change.sourceTarget.id,
				),
				change.sourceTarget.state,
			)
		)
			throw new Error(
				"Conflict: the cited fact changed. Refresh the source proposal before merging.",
			);
		if (!sameState(current, change.before))
			throw new Error(
				`Conflict: ${change.kind} changed since this PR was prepared. Edit the PR to review a fresh diff.`,
			);
	}
	for (const change of [...changes].sort(
		(a, b) => contributionApplyRank(a) - contributionApplyRank(b),
	))
		if (contributionHasEffect(change))
			await applyChange(conn, change, `contribution-pr:${item.number}`);
}

export async function mergeContribution(
	raw: unknown,
	actor: Contributor,
): Promise<Contribution> {
	const input = record(raw),
		id = uuidField(input.id, "id");
	let prepared = await withContributions(async (conn) => {
		return readCurrentContribution(conn, id, (current) =>
			assertVersion(current, input.version),
		);
	});
	if (isArticleLinkPr(prepared)) {
		// A rolling deployment may receive a manual/agent PR before startup
		// backfill finishes. Fence the retired writers before canonical calls;
		// DDL stays outside every contribution transaction (implicit commit).
		const { ensureArticleLinkPromotionSchema } = await import(
			"./contribution-article-import.server"
		);
		await ensureArticleLinkPromotionSchema();
		prepared = await withContributions(async (conn) => {
			const item = await readContribution(conn, id, true);
			assertVersion(item, prepared.version);
			assertMergeAllowed(item);
			if (!item.articleLinkMerge) {
				await assertArticleLinkMergeBase(conn, item);
				item.articleLinkMerge = {
					id: randomUUID(),
					revision: item.revision,
					startedAt: new Date().toISOString(),
				};
				// Commit recovery intent only after old writers have drained and
				// the reviewed base has been compared against their final state.
				await saveContribution(conn, item);
			}
			return item;
		});
	}
	let merged = await withContributions(async (conn) => {
		// Agent completions lock the issue before its related PRs. Keep that
		// order when merging may close the issue, including leave-open merges.
		const issue = prepared.issueId
			? await readContribution(conn, prepared.issueId, true)
			: null;
		const item = await readContribution(conn, id, true);
		// Preparation may migrate the API or reconcile deferred comparisons.
		// Any later authored edit/review still requires the caller to reload.
		assertVersion(item, prepared.version);
		assertMergeAllowed(item);
		if (isArticleLinkPr(item)) await applyReviewedArticleLinks(conn, item);
		else await applyReviewedChanges(conn, item);
		item.state = "merged";
		delete item.articleLinkMerge;
		item.rebasePending = true;
		addEvent(
			item,
			actor,
			"merged",
			`${item.changes.filter(contributionHasEffect).length} שינויים הוחלו`,
		);
		await saveContribution(conn, item);
		if (issue && item.closeIssue) {
			if (issue.state === "open") {
				issue.state = "closed";
				cancelGeneration(issue, "The linked PR was merged");
				addEvent(issue, actor, "closed", `מוזג ב-PR #${item.number}`);
				await saveContribution(conn, issue);
			}
		}
		return item;
	});
	try {
		const { resumePendingContributionRebases } = await import(
			"./contribution-rebases.server"
		);
		await resumePendingContributionRebases();
		merged = await withContributions((conn) =>
			readContribution(conn, merged.id),
		);
	} catch (error) {
		console.error(
			"Content merged; pending comparison refresh remains queued",
			error instanceof Error ? error.message : "unknown error",
		);
	}
	// Invalidate only after committing; a website read must see merged data.
	if (isArticleLinkPr(merged)) {
		await invalidateMergedArticleLinks(merged);
		return merged;
	}
	try {
		const people = new Set<string>(),
			entities = new Set<string>(),
			places = new Set<string>();
		for (const change of merged.changes) {
			if (change.kind === "metadata") entities.add(change.targetId);
			if (change.kind === "place_profile" && !change.after?.entry)
				places.add(change.targetId);
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
					.filter(
						(change) =>
							change.kind === "entry" ||
							(change.kind === "place_profile" && change.after?.entry != null),
					)
					.map((change) => change.targetId),
			),
		]);
		await revalidateWebsite(
			merged.changes.some(
				(c) =>
					![
						"parent_child",
						"union",
						"place",
						"metadata",
						"entry",
						"place_profile",
					].includes(c.kind),
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
