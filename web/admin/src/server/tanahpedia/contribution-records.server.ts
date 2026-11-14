import type { PoolConnection } from "mysql2/promise";
import { cataloguePerekLabel } from "~/lib/article-linking/catalogue";
import {
	CONTRIBUTION_RECORDS,
	type ContributionRecordKind,
	type ContributionRecordSpec,
	isContributionRecordKind,
} from "~/lib/tanahpedia/contribution-records";
import type {
	ChangeState,
	ReviewedChange,
} from "~/lib/tanahpedia/contributions";
import { txExecute, txQuery, txQueryOne } from "../db";

export interface ContributionReference {
	id: string | number;
	name: string;
	ownerId?: string;
}
const ROOTS = [
	"person",
	"place",
	"nation",
	"event",
	"war",
	"animal",
	"object",
	"temple_tool",
	"plant",
	"astronomical_object",
	"sefer",
	"saying",
	"prophecy",
] as const;
export const REFERENCE_SELECTS: Record<string, string> = {
	...Object.fromEntries(
		ROOTS.map((kind) => [
			kind,
			`SELECT r.id,e.name,r.entity_id AS ownerId FROM tanahpedia_${kind} r JOIN tanahpedia_entity e ON e.id=r.entity_id`,
		]),
	),
	entity: "SELECT id,name FROM tanahpedia_entity",
	entry: "SELECT id,title AS name FROM tanahpedia_entry",
	person_name:
		"SELECT n.id,n.person_id AS ownerId,CONCAT(e.name,' - ',n.name) AS name FROM tanahpedia_person_name n JOIN tanahpedia_person p ON p.id=n.person_id JOIN tanahpedia_entity e ON e.id=p.entity_id",
	king_role:
		"SELECT r.id,r.person_id AS ownerId,e.name FROM tanahpedia_person_role_king r JOIN tanahpedia_person p ON p.id=r.person_id JOIN tanahpedia_entity e ON e.id=p.entity_id",
	war_side:
		"SELECT r.id,r.war_id AS ownerId,CONCAT(e.name,' - ',r.side_number) AS name FROM tanahpedia_war_side r JOIN tanahpedia_war w ON w.id=r.war_id JOIN tanahpedia_entity e ON e.id=w.entity_id",
	god: "SELECT id,'אלוהים' AS name FROM tanahpedia_god",
	tanah_sefer: "SELECT id,name FROM tanah_sefer",
	perek:
		"SELECT id,CONCAT(sefer_name,' ',perek_in_context) AS name FROM tanah_perek_view",
	perush: "SELECT id,name FROM perush",
};
export async function loadContributionReference(
	conn: PoolConnection,
	kind: string,
	id: unknown,
): Promise<ContributionReference | null> {
	if (kind === "perek") {
		const row = await txQueryOne<{
			id: number;
			seferName: string;
			perekInContext: number;
			additionalLetter: string | null;
			pasukCount: number | null;
		}>(
			conn,
			"SELECT id,sefer_name AS seferName,perek_in_context AS perekInContext,additional_letter AS additionalLetter,pasuk_count AS pasukCount FROM tanah_perek_view WHERE id=?",
			[id],
		);
		return row ? { id: row.id, name: cataloguePerekLabel(row) } : null;
	}
	const sql = REFERENCE_SELECTS[kind];
	if (!sql) throw new Error("Missing reference contract");
	return txQueryOne<ContributionReference>(
		conn,
		`SELECT id,name FROM (${sql}) candidate WHERE id=? FOR SHARE`,
		[id],
	);
}
function columns(spec: ContributionRecordSpec) {
	return Object.entries(spec.fields)
		.map(
			([key, f]) =>
				`${f.lookup ? `(SELECT name FROM ${f.lookup} WHERE id=r.${f.column})` : `r.${f.column}`} AS \`${key}\``,
		)
		.join(",");
}
function normalize(
	kind: ContributionRecordKind,
	row: ChangeState,
): ChangeState {
	for (const [key, f] of Object.entries(CONTRIBUTION_RECORDS[kind].fields))
		if (f.type === "boolean") row[key] = Boolean(row[key]);
	return row;
}
export async function readContributionRecord(
	conn: PoolConnection,
	kind: ContributionRecordKind,
	id: string,
): Promise<ChangeState | null> {
	const spec = CONTRIBUTION_RECORDS[kind];
	const row = await txQueryOne<ChangeState>(
		conn,
		`SELECT ${columns(spec)} FROM ${spec.table} r WHERE r.id=?${spec.where ? ` AND ${spec.where}` : ""} FOR UPDATE`,
		[id],
	);
	return row ? normalize(kind, row) : null;
}
export async function structuredReferenceLabels(
	conn: PoolConnection,
	kind: ContributionRecordKind,
	state: ChangeState,
): Promise<Record<string, string>> {
	const labels: Record<string, string> = {};
	for (const [key, field] of Object.entries(
		CONTRIBUTION_RECORDS[kind].fields,
	)) {
		if (
			field.type !== "reference" ||
			state[key] == null ||
			field.reference === "alternative"
		)
			continue;
		const row = await loadContributionReference(
			conn,
			field.reference ?? "",
			state[key],
		);
		if (!row) throw new Error(`Referenced ${field.label} does not exist`);
		labels[`${key}:${String(state[key])}`] = row.name;
	}
	if (kind === "entity_source")
		await validateScriptureVerse(conn, state.perekId, state.pasukNumber);
	return labels;
}
export async function validateScriptureVerse(
	conn: PoolConnection,
	perekId: unknown,
	pasukNumber: unknown,
): Promise<void> {
	if (pasukNumber == null) return;
	const row = await txQueryOne<{ count: number | null }>(
		conn,
		"SELECT pasuk_count AS count FROM tanah_perek WHERE id=?",
		[perekId],
	);
	if (
		!row?.count ||
		typeof pasukNumber !== "number" ||
		!Number.isInteger(pasukNumber) ||
		pasukNumber < 1 ||
		pasukNumber > row.count
	)
		throw new Error("The cited scripture verse does not exist");
}
/** Refuse implicit cascades: dependent facts must be removed in explicit
 * reviewed operations first. Locking reads see the current committed state. */
export async function assertNoContributionDependents(
	conn: PoolConnection,
	table: string,
	id: string,
): Promise<void> {
	const keys = await txQuery<{ tableName: string; columnName: string }>(
		conn,
		`SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id'`,
		[table],
	);
	for (const key of keys) {
		if (
			!/^tanahpedia_[a-z0-9_]+$/.test(key.tableName) ||
			!/^[a-z0-9_]+$/.test(key.columnName)
		)
			throw new Error("Unsupported dependent table");
		const child = await txQueryOne(
			conn,
			`SELECT id FROM \`${key.tableName}\` WHERE \`${key.columnName}\`=? LIMIT 1 FOR SHARE NOWAIT`,
			[id],
		);
		if (child)
			throw new Error(
				"This record still has dependent facts. Propose their removal explicitly first.",
			);
	}
	const source = await txQueryOne(
		conn,
		"SELECT id FROM tanahpedia_source_group WHERE target_table=? AND target_id=? LIMIT 1 FOR SHARE NOWAIT",
		[table, id],
	);
	if (source)
		throw new Error(
			"This record still has source references. Remove them explicitly first.",
		);
}
export async function applyContributionRecord(
	conn: PoolConnection,
	change: ReviewedChange,
): Promise<void> {
	if (!isContributionRecordKind(change.kind))
		throw new Error("Unsupported structured operation");
	const spec = CONTRIBUTION_RECORDS[change.kind],
		a = change.after;
	if (!a) {
		await assertNoContributionDependents(conn, spec.table, change.targetId);
		await txExecute(conn, `DELETE FROM ${spec.table} WHERE id=?`, [
			change.targetId,
		]);
		return;
	}
	for (const key of spec.immutable ?? [])
		if (change.before && change.before[key] !== a[key])
			throw new Error(
				"The owner of this record cannot be changed; create a separate record",
			);
	await structuredReferenceLabels(conn, change.kind, a);
	const fields = Object.entries(spec.fields),
		values: unknown[] = [];
	for (const [key, f] of fields) {
		if (f.lookup) {
			const row = await txQueryOne<{ id: string }>(
				conn,
				`SELECT id FROM ${f.lookup} WHERE name=?`,
				[a[key]],
			);
			if (!row) throw new Error("Missing canonical lookup value");
			values.push(row.id);
		} else values.push(a[key]);
	}
	if (change.before)
		await txExecute(
			conn,
			`UPDATE ${spec.table} SET ${fields.map(([, f]) => `${f.column}=?`).join(",")} WHERE id=?`,
			[...values, change.targetId],
		);
	else {
		if (spec.updateOnly) throw new Error("An existing target is required");
		await txExecute(
			conn,
			`INSERT INTO ${spec.table} (id,${fields.map(([, f]) => f.column).join(",")}) VALUES (${[change.targetId, ...values].map(() => "?").join(",")})`,
			[change.targetId, ...values],
		);
	}
}
export async function structuredContributionCatalogue(conn: PoolConnection) {
	const references: Record<string, ContributionReference[]> = {};
	for (const [kind, sql] of Object.entries(REFERENCE_SELECTS).filter(
		([kind]) => kind !== "perek",
	))
		references[kind] = await txQuery<ContributionReference>(
			conn,
			`${sql} ORDER BY name,id`,
		);
	const chapters = await txQuery<{
		id: number;
		seferName: string;
		perekInContext: number;
		additionalLetter: string | null;
	}>(
		conn,
		"SELECT id,sefer_name AS seferName,perek_in_context AS perekInContext,additional_letter AS additionalLetter FROM tanah_perek_view ORDER BY id",
	);
	references.perek = chapters.map((p) => ({
		id: p.id,
		name: cataloguePerekLabel(p as Parameters<typeof cataloguePerekLabel>[0]),
	}));
	const referenceNames = Object.fromEntries(
		Object.entries(references).map(([kind, rows]) => [
			kind,
			new Map(rows.map((r) => [r.id, r.name])),
		]),
	);
	const targets: {
		kind: string;
		id: string;
		label: string;
		after: ChangeState;
	}[] = [];
	for (const [kind, spec] of Object.entries(CONTRIBUTION_RECORDS)) {
		const rows = await txQuery<ChangeState & { id: string }>(
			conn,
			`SELECT r.id,${columns(spec)} FROM ${spec.table} r${spec.where ? ` WHERE ${spec.where}` : ""} ORDER BY r.id`,
		);
		for (const { id, ...state } of rows) {
			const after = normalize(kind as ContributionRecordKind, state);
			const subject = spec.updateOnly
				? referenceNames.saying.get(id)
				: Object.entries(spec.fields)
						.filter(([, f]) => f.reference && f.reference !== "alternative")
						.map(([key, f]) =>
							referenceNames[f.reference ?? ""]?.get(
								after[key] as string | number,
							),
						)
						.filter(Boolean)
						.join(" / ");
			targets.push({
				kind,
				id,
				label: `${spec.label}${subject ? ` - ${subject}` : ""}`,
				after,
			});
		}
	}
	return { references, targets };
}
export function contributionApplyRank(change: ReviewedChange): number {
	if (change.kind === "source_reference") return change.after ? 100 : -100;
	const parent = ["king_role", "war_side", "person_name"].includes(change.kind);
	return change.after ? (parent ? 0 : 10) : parent ? -10 : -20;
}
