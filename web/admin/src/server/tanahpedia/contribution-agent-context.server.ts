import { createHash } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { canonicalJson } from "~/lib/canonical-json";
import { latestContributionAgentResponses } from "~/lib/tanahpedia/contribution-agent-responses";
import { contributionRecordId } from "~/lib/tanahpedia/contribution-identifiers";
import {
	CONTRIBUTION_RECORDS,
	isContributionRecordKind,
} from "~/lib/tanahpedia/contribution-records";
import { isContributionSourceFact } from "~/lib/tanahpedia/contribution-specials";
import {
	type ChangeState,
	type Contribution,
	type ContributionRevisionSnapshot,
	type ReviewedChange,
	reviewStatus,
} from "~/lib/tanahpedia/contributions";
import { txQuery, txQueryOne } from "../db";
import {
	readChangeState,
	readMetadataNames,
} from "./contribution-changes.server";
import {
	type ContributionReference,
	REFERENCE_SELECTS,
} from "./contribution-records.server";
import { readContributionSourceFact } from "./contribution-specials.server";
import { readContribution } from "./contribution-store.server";

export interface AgentCatalogue {
	people: { id: string; name: string }[];
	places: { id: string; name: string }[];
	entities: { id: string; name: string }[];
	targets: {
		id: string;
		kind: string;
		current?: ChangeState;
		label?: string;
	}[];
	references: Record<string, ContributionReference[]>;
}

const FAMILY_TABLES = {
	parent_child: "tanahpedia_person_parent_child",
	union: "tanahpedia_person_union",
	place: "tanahpedia_place_identification",
} as const;
const ALT_TABLES = [
	...new Set([
		...Object.values(FAMILY_TABLES),
		...Object.values(CONTRIBUTION_RECORDS)
			.filter((spec) =>
				Object.values(spec.fields).some(
					(field) => field.reference === "alternative",
				),
			)
			.map((spec) => spec.table),
	]),
];
const REFERENCES: Record<string, string> = {
	...REFERENCE_SELECTS,
	place_identification:
		"SELECT i.id,CONCAT(e.name,' - ',COALESCE(i.modern_name,'')) AS name FROM tanahpedia_place_identification i JOIN tanahpedia_place p ON p.id=i.place_id JOIN tanahpedia_entity e ON e.id=p.entity_id",
	alternative: ALT_TABLES.map(
		(table) =>
			`SELECT alt_group_id AS id,'קבוצת דעות חלופיות' AS name FROM ${table} WHERE alt_group_id IS NOT NULL`,
	).join(" UNION "),
};
const SPECIAL_SEARCHES: Record<string, string> = {
	metadata: REFERENCE_SELECTS.entity,
	entry: REFERENCE_SELECTS.entry,
	place: REFERENCES.place_identification,
	parent_child:
		"SELECT r.id,CONCAT(a.name,' / ',b.name) AS name FROM tanahpedia_person_parent_child r JOIN tanahpedia_person p ON p.id=r.parent_id JOIN tanahpedia_entity a ON a.id=p.entity_id JOIN tanahpedia_person c ON c.id=r.child_id JOIN tanahpedia_entity b ON b.id=c.entity_id",
	union:
		"SELECT r.id,CONCAT(a.name,' / ',b.name) AS name FROM tanahpedia_person_union r JOIN tanahpedia_person p ON p.id=r.person1_id JOIN tanahpedia_entity a ON a.id=p.entity_id JOIN tanahpedia_person c ON c.id=r.person2_id JOIN tanahpedia_entity b ON b.id=c.entity_id",
	alias_mapping:
		"SELECT MIN(id) AS id,name FROM tanahpedia_entry_synonym GROUP BY name",
	source_reference:
		"SELECT s.id,CONCAT(g.target_id,' / ',s.perek_id,' / ',COALESCE(s.pasuk_number,'')) AS name FROM tanahpedia_tanah_source s JOIN tanahpedia_source_group g ON g.id=s.source_group_id UNION ALL SELECT s.id,CONCAT(g.target_id,' / ',s.source_text) AS name FROM tanahpedia_non_tanah_source s JOIN tanahpedia_source_group g ON g.id=s.source_group_id",
};

function emptyCatalogue(): AgentCatalogue {
	return { people: [], places: [], entities: [], targets: [], references: {} };
}

function latest<T>(rows: T[], key: (row: T) => string): T[] {
	return [...new Map(rows.map((row) => [key(row), row])).values()];
}

export function mergeAgentCatalogues(
	...catalogues: AgentCatalogue[]
): AgentCatalogue {
	const key = (row: { id: string | number }) => String(row.id).toLowerCase();
	const families = new Set(
		catalogues.flatMap((catalogue) => Object.keys(catalogue.references)),
	);
	return {
		people: latest(
			catalogues.flatMap((catalogue) => catalogue.people),
			key,
		),
		places: latest(
			catalogues.flatMap((catalogue) => catalogue.places),
			key,
		),
		entities: latest(
			catalogues.flatMap((catalogue) => catalogue.entities),
			key,
		),
		targets: latest(
			catalogues.flatMap((catalogue) => catalogue.targets),
			(row) => `${row.kind}:${key(row)}`,
		),
		references: Object.fromEntries(
			[...families].map((family) => [
				family,
				latest(
					catalogues.flatMap((catalogue) => catalogue.references[family] ?? []),
					key,
				),
			]),
		),
	};
}

function hash(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function targetKind(value: string): ReviewedChange["kind"] {
	if (isContributionRecordKind(value) || Object.hasOwn(SPECIAL_SEARCHES, value))
		return value as ReviewedChange["kind"];
	throw new Error("Unsupported contribution target kind");
}

function referenceSql(kind: string): string {
	if (!Object.hasOwn(REFERENCES, kind))
		throw new Error("Unsupported contribution reference kind");
	return REFERENCES[kind];
}

function targetSql(kind: ReviewedChange["kind"]): string {
	if (!isContributionRecordKind(kind)) return SPECIAL_SEARCHES[kind];
	const spec = CONTRIBUTION_RECORDS[kind];
	const labels = Object.values(spec.fields)
		.filter((field) => field.type !== "blob")
		.map((field) => {
			if (field.reference && field.reference !== "alternative") {
				return `(SELECT named.name FROM (${referenceSql(field.reference)}) named WHERE named.id=r.${field.column})`;
			}
			if (field.lookup)
				return `(SELECT name FROM ${field.lookup} WHERE id=r.${field.column})`;
			return `CAST(r.${field.column} AS CHAR)`;
		});
	return `SELECT r.id,CONCAT_WS(' / ',r.id,${labels.join(",")}) AS name FROM ${spec.table} r${spec.where ? ` WHERE ${spec.where}` : ""}`;
}

function identifier(value: unknown): string | number {
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
		return value;
	if (typeof value === "string" && value.length > 0 && value.length <= 255)
		return value;
	throw new Error("Invalid contribution tool record identifier");
}

function pageArguments(args: Record<string, unknown>) {
	const cursor = args.cursor ?? 0;
	const limit = args.limit ?? 25;
	if (
		typeof cursor !== "number" ||
		!Number.isSafeInteger(cursor) ||
		cursor < 0 ||
		typeof limit !== "number" ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 50
	) {
		throw new Error("Invalid contribution tool page");
	}
	return { cursor, limit };
}

function page<T>(items: T[], cursor: number, limit: number) {
	return {
		items: items.slice(cursor, cursor + limit),
		total: items.length,
		nextCursor: cursor + limit < items.length ? cursor + limit : null,
	};
}

function argumentsFor(name: string, raw: unknown): Record<string, unknown> {
	const fields: Record<string, string[]> = {
		discussion: ["source", "filter", "cursor", "limit"],
		history: ["cursor", "limit"],
		search: ["kind", "query", "cursor", "limit"],
		record: ["kind", "id"],
		related: ["cursor", "limit", "id", "section"],
	};
	if (!Object.hasOwn(fields, name))
		throw new Error("Unsupported contribution agent tool");
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new Error("Invalid contribution tool arguments");
	const args = raw as Record<string, unknown>;
	if (Object.keys(args).some((key) => !fields[name].includes(key)))
		throw new Error("Unsupported contribution tool argument");
	return args;
}

class ContextReader {
	readonly catalogue = emptyCatalogue();
	readonly records: { kind: string; id: string | number; current: unknown }[] =
		[];
	private readonly seen = new Set<string>();
	constructor(
		private readonly conn: PoolConnection,
		private readonly alternativeId: string,
	) {}

	async reference(
		kind: string,
		id: string | number,
	): Promise<ContributionReference | null> {
		const key = `reference:${kind}:${String(id).toLowerCase()}`;
		if (this.seen.has(key))
			return (
				this.catalogue.references[kind]?.find(
					(row) => String(row.id).toLowerCase() === String(id).toLowerCase(),
				) ?? null
			);
		this.seen.add(key);
		const sql = referenceSql(kind);
		const row =
			kind === "alternative" &&
			String(id).toLowerCase() === this.alternativeId.toLowerCase()
				? { id, name: "קבוצת דעות חדשה לפנייה" }
				: await txQueryOne<ContributionReference>(
						this.conn,
						`SELECT candidate.* FROM (${sql}) candidate WHERE candidate.id=?`,
						[id],
					);
		this.records.push({ kind, id, current: row });
		if (!row) return null;
		this.catalogue.references[kind] ??= [];
		this.catalogue.references[kind].push(row);
		if (["person", "place", "entity"].includes(kind)) {
			const destination =
				kind === "person"
					? this.catalogue.people
					: kind === "place"
						? this.catalogue.places
						: this.catalogue.entities;
			destination.push({ id: String(row.id), name: row.name });
		}
		if (row.ownerId) {
			const owner =
				kind === "person_name" || kind === "king_role"
					? "person"
					: kind === "war_side"
						? "war"
						: "entity";
			await this.reference(owner, row.ownerId);
		}
		return row;
	}

	async target(
		kind: ReviewedChange["kind"],
		id: string,
		context?: ChangeState | null,
	): Promise<ChangeState | null> {
		const key = `target:${kind}:${id.toLowerCase()}`;
		if (this.seen.has(key))
			return (
				this.catalogue.targets.find(
					(row) =>
						row.kind === kind && row.id.toLowerCase() === id.toLowerCase(),
				)?.current ?? null
			);
		this.seen.add(key);
		const current = await readChangeState(this.conn, kind, id, context);
		this.records.push({ kind: `target:${kind}`, id, current });
		if (current) {
			this.catalogue.targets.push({ kind, id, current });
			await this.references(kind, current);
			if (kind === "metadata") {
				await this.reference("entity", id);
				const names = await readMetadataNames(this.conn, id);
				this.records.push({ kind: "metadata_names", id, current: names });
				for (const name of names) await this.reference("person_name", name.id);
			}
			if (kind === "entry") await this.reference("entry", id);
		}
		return current;
	}

	async references(
		kind: ReviewedChange["kind"],
		state: ChangeState,
	): Promise<void> {
		const fields: Record<string, string> = isContributionRecordKind(kind)
			? Object.fromEntries(
					Object.entries(CONTRIBUTION_RECORDS[kind].fields)
						.filter(([, field]) => field.reference)
						.map(([key, field]) => [key, field.reference ?? ""]),
				)
			: {
					parentId: "person",
					childId: "person",
					person1Id: "person",
					person2Id: "person",
					placeId: "place",
					altGroupId: "alternative",
				};
		if (kind === "metadata") fields.entityId = "entity";
		if (kind === "source_reference")
			Object.assign(fields, { perekId: "perek", perushId: "perush" });
		for (const [key, family] of Object.entries(fields)) {
			const id = state[key];
			if (typeof id === "string" || typeof id === "number")
				await this.reference(family, id);
		}
		if (kind === "alias_mapping" && Array.isArray(state.targets)) {
			for (const destination of state.targets)
				await this.reference("entry", destination.entryId);
		}
		if (
			kind === "source_reference" &&
			typeof state.targetKind === "string" &&
			typeof state.targetId === "string"
		) {
			if (isContributionSourceFact(state.targetKind)) {
				const sourceKey = `source:${state.targetKind}:${state.targetId.toLowerCase()}`;
				if (this.seen.has(sourceKey)) return;
				this.seen.add(sourceKey);
				const current = await readContributionSourceFact(
					this.conn,
					state.targetKind,
					state.targetId,
				);
				this.records.push({
					kind: `source:${state.targetKind}`,
					id: state.targetId,
					current,
				});
				if (current) {
					const kind =
						state.targetKind === "place_identification"
							? "place"
							: targetKind(state.targetKind);
					this.catalogue.targets.push({
						kind: state.targetKind,
						id: state.targetId,
						current,
					});
					await this.references(kind, current);
				}
			} else await this.reference(state.targetKind, state.targetId);
		}
	}
}

async function linkedIssue(
	conn: PoolConnection,
	item: Contribution,
): Promise<Contribution | null> {
	return item.kind === "issue"
		? item
		: item.issueId
			? readContribution(conn, item.issueId)
			: null;
}

function orderedEvents(item: Contribution) {
	return [...item.events].sort(
		(a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
	);
}

function pendingFeedback(item: Contribution) {
	const responses = latestContributionAgentResponses(item.events);
	return item.events
		.filter(
			(event) =>
				["comment", "changes_requested"].includes(event.kind) &&
				event.actor.kind === "human" &&
				responses.get(event.id)?.status !== "addressed",
		)
		.map((event) => ({
			...event,
			latestResponse: responses.get(event.id) ?? null,
		}));
}

async function relatedContributions(
	conn: PoolConnection,
	item: Contribution,
	window?: { cursor: number; limit: number },
) {
	const owner = item.kind === "issue" ? item.id : item.issueId;
	if (!owner) return { items: [], total: 0, nextCursor: null };
	const where = "FROM tanahpedia_contribution WHERE kind='pr' AND issue_id=?";
	const count = window
		? await txQueryOne<{ total: number }>(
				conn,
				`SELECT COUNT(*) AS total ${where}`,
				[owner],
			)
		: null;
	const rows = await txQuery<{ id: string }>(
		conn,
		`SELECT id ${where} ORDER BY number,id${window ? ` LIMIT ${window.limit} OFFSET ${window.cursor}` : ""}`,
		[owner],
	);
	const related = [];
	for (const row of rows) {
		const proposal = await readContribution(conn, row.id);
		if (
			proposal.kind !== "pr" ||
			proposal.issueId?.toLowerCase() !== owner.toLowerCase()
		)
			throw new Error("Related proposal no longer belongs to this issue");
		related.push(proposal);
	}
	const total = Number(count?.total ?? rows.length);
	return {
		items: related,
		total,
		nextCursor:
			window && rows.length > 0 && window.cursor + rows.length < total
				? window.cursor + rows.length
				: null,
	};
}

function orderedHistory(item: Contribution) {
	return [...(item.revisionHistory ?? [])].sort(
		(a, b) => a.revision - b.revision || a.at.localeCompare(b.at),
	);
}

export async function readContributionAgentTool(
	conn: PoolConnection,
	item: Contribution,
	name: string,
	raw: unknown,
): Promise<{ data: unknown; catalogue: AgentCatalogue }> {
	const args = argumentsFor(name, raw);
	const current = await readContribution(conn, item.id);
	const reader = new ContextReader(conn, current.issueId ?? current.id);
	if (name === "related") {
		const { cursor, limit } = pageArguments(args);
		const section = args.section ?? "items";
		if (
			section !== "items" &&
			section !== "discussion" &&
			section !== "history"
		)
			throw new Error("Invalid related proposal section");
		if (section === "items") {
			if (args.id !== undefined)
				throw new Error("Related proposal items do not accept an identifier");
			const proposals = await relatedContributions(conn, current, {
				cursor,
				limit,
			});
			return {
				data: { ...proposals, items: proposals.items.map(summary) },
				catalogue: reader.catalogue,
			};
		}
		const id = contributionRecordId(args.id, "id");
		const owner = current.kind === "issue" ? current.id : current.issueId;
		if (!owner) throw new Error("Proposal is not linked to this issue");
		const proposal = await readContribution(conn, id);
		if (
			proposal.kind !== "pr" ||
			proposal.issueId?.toLowerCase() !== owner.toLowerCase()
		)
			throw new Error("Proposal is not linked to this issue");
		return {
			data:
				section === "discussion"
					? page(orderedEvents(proposal), cursor, limit)
					: page(orderedHistory(proposal), cursor, limit),
			catalogue: reader.catalogue,
		};
	}
	if (name === "discussion" || name === "history") {
		const { cursor, limit } = pageArguments(args);
		if (name === "history")
			return {
				data: page(orderedHistory(current), cursor, limit),
				catalogue: reader.catalogue,
			};
		if (args.source !== "item" && args.source !== "issue")
			throw new Error("Invalid discussion source");
		const filter = args.filter === undefined ? "all" : args.filter;
		if (filter !== "all" && filter !== "pending_feedback")
			throw new Error("Invalid discussion filter");
		const source =
			args.source === "item" ? current : await linkedIssue(conn, current);
		return {
			data: page(
				source
					? filter === "pending_feedback"
						? pendingFeedback(source).reverse()
						: orderedEvents(source)
					: [],
				cursor,
				limit,
			),
			catalogue: reader.catalogue,
		};
	}
	if (typeof args.kind !== "string")
		throw new Error("Missing contribution tool kind");
	const isTarget = args.kind.startsWith("target:");
	const kind = isTarget ? targetKind(args.kind.slice(7)) : args.kind;
	const sql = isTarget
		? targetSql(kind as ReviewedChange["kind"])
		: referenceSql(kind);
	if (name === "record") {
		const id = identifier(args.id);
		const record = isTarget
			? await reader.target(
					kind as ReviewedChange["kind"],
					contributionRecordId(id, "id"),
				)
			: await reader.reference(kind, id);
		return {
			data: { kind: args.kind, id, record, records: reader.records },
			catalogue: reader.catalogue,
		};
	}
	const { cursor, limit } = pageArguments(args);
	if (typeof args.query !== "string" || args.query.length > 255)
		throw new Error("Invalid contribution catalogue search");
	const pattern = `%${args.query.replace(/=/g, "==").replace(/%/g, "=%").replace(/_/g, "=_")}%`;
	const where =
		"WHERE candidate.name LIKE ? ESCAPE '=' OR CAST(candidate.id AS CHAR) LIKE ? ESCAPE '='";
	const count = await txQueryOne<{ total: number }>(
		conn,
		`SELECT COUNT(*) AS total FROM (${sql}) candidate ${where}`,
		[pattern, pattern],
	);
	const total = Number(count?.total ?? 0);
	const rows = await txQuery<ContributionReference>(
		conn,
		`SELECT candidate.* FROM (${sql}) candidate ${where} ORDER BY candidate.name,candidate.id LIMIT ${limit} OFFSET ${cursor}`,
		[pattern, pattern],
	);
	const items = [];
	for (const row of rows) {
		if (isTarget) {
			const current = await reader.target(
				kind as ReviewedChange["kind"],
				String(row.id),
			);
			items.push({ kind, id: row.id, label: row.name, current });
		} else {
			await reader.reference(kind, row.id);
			items.push(row);
		}
	}
	return {
		data: {
			items,
			total,
			nextCursor:
				rows.length > 0 && cursor + rows.length < total
					? cursor + rows.length
					: null,
			records: reader.records,
		},
		catalogue: reader.catalogue,
	};
}

function semanticSnapshot(snapshot: ContributionRevisionSnapshot) {
	const { version: _version, ...semantic } = snapshot;
	return semantic;
}

function semanticItem(item: Contribution) {
	const {
		generation: _generation,
		version: _version,
		updatedAt: _updatedAt,
		...semantic
	} = item;
	return {
		...semantic,
		revisionHistory: item.revisionHistory?.map(semanticSnapshot),
		events: item.events.map((event) => ({
			...event,
			snapshot: event.snapshot ? semanticSnapshot(event.snapshot) : undefined,
		})),
	};
}

function summary(item: Contribution) {
	return {
		id: item.id,
		number: item.number,
		kind: item.kind,
		state: item.state,
		title: item.title,
		description: item.description,
		author: item.author,
		revisionAuthor: item.revisionAuthor ?? item.author,
		reviewStatus: item.kind === "pr" ? reviewStatus(item) : null,
		assignee: item.assignee,
		evidence: item.evidence,
		changes: item.changes,
		apiVersion: item.apiVersion ?? 1,
		apiMigration: item.apiMigration ?? null,
		apiMigrationHistory: item.apiMigrationHistory ?? [],
		domainConflict: item.domainConflict ?? null,
		rebasePending: item.rebasePending ?? false,
		deferredContentMerge: item.deferredContentMerge ?? null,
		closeIssue: item.closeIssue,
		revision: item.revision,
		issueId: item.issueId,
		eventCount: item.events.length,
		eventHash: hash(semanticItem(item).events),
		historyCount: item.revisionHistory?.length ?? 0,
		historyHash: hash(item.revisionHistory?.map(semanticSnapshot) ?? []),
	};
}

export async function readContributionAgentInitialContext(
	conn: PoolConnection,
	item: Contribution,
): Promise<{ data: unknown; catalogue: AgentCatalogue; hash: string }> {
	const current = await readContribution(conn, item.id);
	const issue = await linkedIssue(conn, current);
	const related = (await relatedContributions(conn, current)).items;
	const reader = new ContextReader(conn, issue?.id ?? current.id);
	await reader.reference("alternative", issue?.id ?? current.id);
	for (const change of current.changes) {
		// Failed migrations retain their untouched operations for recovery. They
		// remain visible in the summary but cannot select a domain SQL reader.
		if (
			!isContributionRecordKind(change.kind) &&
			!Object.hasOwn(SPECIAL_SEARCHES, change.kind)
		)
			continue;
		const state = await reader.target(
			targetKind(change.kind),
			change.targetId,
			change.before ?? change.after,
		);
		if (!state && current.kind === "pr" && !change.before && change.after) {
			// The proposal already owns this creation ID even before it exists
			// in the domain tables. Exact reads still report its absence.
			reader.catalogue.targets.push({ kind: change.kind, id: change.targetId });
		}
		if (change.before) await reader.references(change.kind, change.before);
		if (change.after) await reader.references(change.kind, change.after);
		if (change.kind === "metadata")
			await reader.reference("entity", change.targetId);
		if (change.kind === "entry")
			await reader.reference("entry", change.targetId);
	}
	const pending = pendingFeedback(current);
	const data = {
		item: summary(current),
		issue: issue ? summary(issue) : null,
		pendingFeedback: {
			...page([...pending].reverse(), 0, 10),
			readLocator: {
				tool: "discussion",
				arguments: {
					source: "item",
					filter: "pending_feedback",
					cursor: 0,
					limit: 10,
				},
			},
		},
		related: page(
			related.map((proposal) => ({
				id: proposal.id,
				number: proposal.number,
				state: proposal.state,
				title: proposal.title,
				revision: proposal.revision,
				eventCount: proposal.events.length,
			})),
			0,
			10,
		),
		pendingCommentIds: pending.map((event) => event.id),
		currentRecords: reader.records,
	};
	return {
		data,
		catalogue: reader.catalogue,
		hash: hash({
			item: semanticItem(current),
			issue: issue ? semanticItem(issue) : null,
			related: related.map(semanticItem),
			records: reader.records,
			catalogue: reader.catalogue,
		}),
	};
}
