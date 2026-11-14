import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { CONTRIBUTION_RECORDS } from "~/lib/tanahpedia/contribution-records";
import {
	type AliasMapping,
	SOURCE_TARGETS,
	type SourceReference,
} from "~/lib/tanahpedia/contribution-specials";
import type {
	ChangeState,
	ReviewedChange,
} from "~/lib/tanahpedia/contributions";
import { txExecute, txQuery, txQueryOne } from "../db";
import {
	loadContributionReference,
	REFERENCE_SELECTS,
	validateScriptureVerse,
} from "./contribution-records.server";

function sourceTable(kind: string): string {
	const table = Object.hasOwn(SOURCE_TARGETS, kind)
		? SOURCE_TARGETS[kind]
		: undefined;
	if (!table) throw new Error("Unsupported source target");
	return table;
}
export async function readAliasMapping(
	conn: PoolConnection,
	id: string,
	context?: ChangeState | null,
): Promise<ChangeState | null> {
	const row = await txQueryOne<{ name: string }>(
		conn,
		"SELECT name FROM tanahpedia_entry_synonym WHERE id=? FOR UPDATE",
		[id],
	);
	const name = row?.name ?? context?.name;
	if (typeof name !== "string") return null;
	const synonyms = await txQuery<{ id: string; entryId: string }>(
		conn,
		"SELECT id,entry_id AS entryId FROM tanahpedia_entry_synonym WHERE name=? ORDER BY id FOR UPDATE",
		[name],
	);
	if (!synonyms.length) return null;
	const labels = await txQuery<{ entryId: string; label: string }>(
		conn,
		"SELECT d.entry_id AS entryId,d.disambiguation_label AS label FROM tanahpedia_entry_synonym_disambiguation d JOIN tanahpedia_entry_synonym s ON s.id=d.synonym_id WHERE s.name=? ORDER BY d.id FOR UPDATE",
		[name],
	);
	const targets = new Map<string, string>();
	for (const row of [
		...synonyms.map((s) => ({ entryId: s.entryId, label: "" })),
		...labels,
	])
		if (!targets.get(row.entryId)) targets.set(row.entryId, row.label ?? "");
	return {
		name,
		targets: [...targets]
			.map(([entryId, label]) => ({ entryId, label }))
			.sort((a, b) => a.entryId.localeCompare(b.entryId)),
	};
}
export async function aliasReferenceLabels(
	conn: PoolConnection,
	state: ChangeState,
): Promise<Record<string, string>> {
	const a = state as unknown as AliasMapping,
		labels: Record<string, string> = {};
	const holder = await txQueryOne(
		conn,
		"SELECT id FROM tanahpedia_entry WHERE unique_name=? FOR SHARE",
		[a.name],
	);
	if (holder)
		throw new Error("Alias collides with an existing canonical entry address");
	for (const target of a.targets) {
		const row = await txQueryOne<{ name: string }>(
			conn,
			"SELECT title AS name FROM tanahpedia_entry WHERE id=? FOR SHARE",
			[target.entryId],
		);
		if (!row) throw new Error("Alias target entry does not exist");
		labels[target.entryId] = row.name;
	}
	return labels;
}
export async function applyAliasMapping(
	conn: PoolConnection,
	change: ReviewedChange,
): Promise<void> {
	const a = change.after as unknown as AliasMapping | null,
		b = change.before as unknown as AliasMapping | null;
	if (a && b && a.name !== b.name)
		throw new Error("Create a separate alias to introduce another address");
	if (change.after) await aliasReferenceLabels(conn, change.after);
	const name = a?.name ?? b?.name;
	if (!name) throw new Error("Missing alias name");
	await txExecute(conn, "DELETE FROM tanahpedia_entry_synonym WHERE name=?", [
		name,
	]);
	for (const [index, target] of (a?.targets ?? []).entries()) {
		const id = index === 0 ? change.targetId : randomUUID();
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_entry_synonym (id,name,entry_id) VALUES (?,?,?)",
			[id, name, target.entryId],
		);
		if (a && a.targets.length > 1)
			await txExecute(
				conn,
				"INSERT INTO tanahpedia_entry_synonym_disambiguation (id,synonym_id,entry_id,disambiguation_label) VALUES (?,?,?,?)",
				[randomUUID(), id, target.entryId, target.label],
			);
	}
}
export async function readSourceReference(
	conn: PoolConnection,
	id: string,
): Promise<ChangeState | null> {
	const scripture = await txQueryOne<ChangeState & { targetTable: string }>(
		conn,
		"SELECT g.target_table AS targetTable,g.target_id AS targetId,s.perek_id AS perekId,s.pasuk_number AS pasukNumber,s.perush_id AS perushId FROM tanahpedia_tanah_source s JOIN tanahpedia_source_group g ON g.id=s.source_group_id WHERE s.id=? FOR UPDATE",
		[id],
	);
	const other = await txQueryOne<ChangeState & { targetTable: string }>(
		conn,
		"SELECT g.target_table AS targetTable,g.target_id AS targetId,s.source_text AS sourceText FROM tanahpedia_non_tanah_source s JOIN tanahpedia_source_group g ON g.id=s.source_group_id WHERE s.id=? FOR UPDATE",
		[id],
	);
	if (scripture && other)
		throw new Error("Ambiguous source ID; repair the raw sequence");
	const row = scripture ?? other;
	if (!row) return null;
	const targets = SOURCE_TARGETS;
	const targetKind = Object.keys(targets).find(
		(k) => targets[k] === row.targetTable,
	);
	if (!targetKind)
		throw new Error("Unsupported existing source attachment target");
	return {
		targetKind,
		targetId: row.targetId,
		sourceType: scripture ? "tanah" : "other",
		perekId: scripture?.perekId ?? null,
		pasukNumber: scripture?.pasukNumber ?? null,
		perushId: scripture?.perushId ?? null,
		sourceText: other?.sourceText ?? null,
	};
}
export async function sourceReferenceLabels(
	conn: PoolConnection,
	state: ChangeState,
): Promise<Record<string, string>> {
	const a = state as unknown as SourceReference,
		table = sourceTable(a.targetKind),
		labels: Record<string, string> = {};
	const target = await txQueryOne(
		conn,
		`SELECT id FROM ${table} WHERE id=? FOR SHARE`,
		[a.targetId],
	);
	if (!target) throw new Error("Source attachment target does not exist");
	const sql = REFERENCE_SELECTS[a.targetKind];
	if (sql) {
		const row = await txQueryOne<{ name: string }>(
			conn,
			`SELECT name FROM (${sql}) candidate WHERE id=?`,
			[a.targetId],
		);
		if (row) labels[`targetId:${a.targetId}`] = row.name;
	} else
		labels[`targetId:${a.targetId}`] =
			CONTRIBUTION_RECORDS[a.targetKind as keyof typeof CONTRIBUTION_RECORDS]
				?.label ?? a.targetKind;
	if (a.sourceType === "tanah") {
		const perek = await loadContributionReference(conn, "perek", a.perekId);
		if (!perek) throw new Error("Scripture chapter does not exist");
		labels[`perekId:${a.perekId}`] = perek.name;
		await validateScriptureVerse(conn, a.perekId, a.pasukNumber);
		if (a.perushId) {
			const row = await txQueryOne<{ name: string }>(
				conn,
				"SELECT name FROM perush WHERE id=? FOR SHARE",
				[a.perushId],
			);
			if (!row) throw new Error("Commentary does not exist");
			labels[`perushId:${a.perushId}`] = row.name;
		}
	}
	return labels;
}
async function removeSourceChild(
	conn: PoolConnection,
	id: string,
	table: string,
): Promise<void> {
	const row = await txQueryOne<{ groupId: string }>(
		conn,
		`SELECT source_group_id AS groupId FROM ${table} WHERE id=? FOR UPDATE`,
		[id],
	);
	if (!row) return;
	await txExecute(conn, `DELETE FROM ${table} WHERE id=?`, [id]);
	const remaining = await txQueryOne<{ id: string }>(
		conn,
		"SELECT id FROM tanahpedia_tanah_source WHERE source_group_id=? LIMIT 1 FOR UPDATE",
		[row.groupId],
	);
	const other = await txQueryOne<{ id: string }>(
		conn,
		"SELECT id FROM tanahpedia_non_tanah_source WHERE source_group_id=? LIMIT 1 FOR UPDATE",
		[row.groupId],
	);
	if (!remaining && !other)
		await txExecute(conn, "DELETE FROM tanahpedia_source_group WHERE id=?", [
			row.groupId,
		]);
}
export async function applySourceReference(
	conn: PoolConnection,
	change: ReviewedChange,
): Promise<void> {
	const a = change.after as unknown as SourceReference | null;
	if (change.after) await sourceReferenceLabels(conn, change.after);
	// A source owns only its child row, even when the old group is shared.
	await removeSourceChild(conn, change.targetId, "tanahpedia_tanah_source");
	await removeSourceChild(conn, change.targetId, "tanahpedia_non_tanah_source");
	if (!a) return;
	const groupId = randomUUID();
	await txExecute(
		conn,
		"INSERT INTO tanahpedia_source_group (id,target_table,target_id) VALUES (?,?,?)",
		[groupId, sourceTable(a.targetKind), a.targetId],
	);
	if (a.sourceType === "tanah")
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_tanah_source (id,source_group_id,perush_id,perek_id,pasuk_number) VALUES (?,?,?,?,?)",
			[change.targetId, groupId, a.perushId, a.perekId, a.pasukNumber],
		);
	else
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_non_tanah_source (id,source_group_id,source_text) VALUES (?,?,?)",
			[change.targetId, groupId, a.sourceText],
		);
}
export async function specialContributionTargets(conn: PoolConnection) {
	const result: {
		kind: string;
		id: string;
		label: string;
		after: ChangeState;
	}[] = [];

	const aliases = await txQuery<{ id: string; name: string; entryId: string }>(
		conn,
		"SELECT id,name,entry_id AS entryId FROM tanahpedia_entry_synonym ORDER BY name,id",
	);
	const labels = await txQuery<{
		name: string;
		entryId: string;
		label: string;
	}>(
		conn,
		"SELECT s.name,d.entry_id AS entryId,d.disambiguation_label AS label FROM tanahpedia_entry_synonym_disambiguation d JOIN tanahpedia_entry_synonym s ON s.id=d.synonym_id ORDER BY d.id",
	);
	const grouped = new Map<
		string,
		{ id: string; targets: Map<string, string> }
	>();
	for (const alias of aliases) {
		let group = grouped.get(alias.name);
		if (!group) {
			group = { id: alias.id, targets: new Map() };
			grouped.set(alias.name, group);
		}
		group.targets.set(alias.entryId, "");
	}
	for (const label of labels) {
		const group = grouped.get(label.name);
		if (group && !group.targets.get(label.entryId))
			group.targets.set(label.entryId, label.label ?? "");
	}
	for (const [name, group] of grouped)
		result.push({
			kind: "alias_mapping",
			id: group.id,
			label: name,
			after: {
				name,
				targets: [...group.targets]
					.map(([entryId, label]) => ({ entryId, label }))
					.sort((a, b) => a.entryId.localeCompare(b.entryId)),
			},
		});
	const scripture = await txQuery<
		ChangeState & { id: string; targetTable: string }
	>(
		conn,
		"SELECT s.id,g.target_table AS targetTable,g.target_id AS targetId,s.perek_id AS perekId,s.pasuk_number AS pasukNumber,s.perush_id AS perushId FROM tanahpedia_tanah_source s JOIN tanahpedia_source_group g ON g.id=s.source_group_id ORDER BY s.id",
	);
	const other = await txQuery<
		ChangeState & { id: string; targetTable: string }
	>(
		conn,
		"SELECT s.id,g.target_table AS targetTable,g.target_id AS targetId,s.source_text AS sourceText FROM tanahpedia_non_tanah_source s JOIN tanahpedia_source_group g ON g.id=s.source_group_id ORDER BY s.id",
	);
	const otherIds = new Set(other.map((r) => r.id));
	const ambiguous = new Set(
		scripture.filter((r) => otherIds.has(r.id)).map((r) => r.id),
	);
	for (const [sourceType, rows] of [
		["tanah", scripture],
		["other", other],
	] as const)
		for (const row of rows) {
			const targetKind = Object.keys(SOURCE_TARGETS).find(
				(k) => SOURCE_TARGETS[k] === row.targetTable,
			);
			if (!targetKind || ambiguous.has(row.id)) continue;
			const after: ChangeState = {
				targetKind,
				targetId: row.targetId,
				sourceType,
				perekId: row.perekId ?? null,
				pasukNumber: row.pasukNumber ?? null,
				perushId: row.perushId ?? null,
				sourceText: row.sourceText ?? null,
			};
			result.push({
				kind: "source_reference",
				id: row.id,
				label: String(
					row.sourceText ?? `${row.perekId} / ${row.pasukNumber ?? ""}`,
				),
				after,
			});
		}
	return result;
}
