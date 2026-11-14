import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import {
	CONTRIBUTION_RECORDS,
	isContributionRecordKind,
} from "~/lib/tanahpedia/contribution-records";
import {
	type ChangeInput,
	type ChangeState,
	type ReviewedChange,
	sameState,
	validateChange,
} from "~/lib/tanahpedia/contributions";
import { txExecute, txQuery, txQueryOne } from "../db";
import { recomputeEntryMetrics } from "../reading-metrics";
import {
	applyContributionRecord,
	readContributionRecord,
	structuredContributionCatalogue,
	structuredReferenceLabels,
} from "./contribution-records.server";
import {
	aliasReferenceLabels,
	applyAliasMapping,
	applySourceReference,
	readAliasMapping,
	readSourceReference,
	sourceReferenceLabels,
	specialContributionTargets,
} from "./contribution-specials.server";
import { assertEntryFieldsValid } from "./revisions";

type State = ChangeState;

export async function readMetadataNames(
	conn: PoolConnection,
	entityId: string,
): Promise<{ id: string; name: string }[]> {
	const people = await txQuery<{ id: string }>(
		conn,
		"SELECT id FROM tanahpedia_person WHERE entity_id = ? ORDER BY id FOR UPDATE",
		[entityId],
	);
	if (!people.length) return [];
	return txQuery<{ id: string; name: string }>(
		conn,
		"SELECT n.id, n.name FROM tanahpedia_person_name n JOIN tanahpedia_person p ON p.id = n.person_id JOIN tanahpedia_lookup_name_type t ON t.id = n.name_type_id WHERE p.entity_id = ? AND t.name = 'MAIN' ORDER BY n.id FOR UPDATE",
		[entityId],
	);
}

export async function assertMetadataNames(
	conn: PoolConnection,
	change: ReviewedChange,
): Promise<void> {
	if (change.kind !== "metadata") return;
	const current = await readMetadataNames(conn, change.targetId);
	if (!sameState(current, change.personNames ?? []))
		throw new Error(
			"Conflict: the person's main names changed. Edit the PR to review a fresh diff.",
		);
}

const READS = {
	parent_child: `SELECT pc.parent_id AS parentId, pc.child_id AS childId,
	 t.name AS relationshipType, r.name AS parentRole, pc.source_citation AS sourceCitation,
	 pc.alt_group_id AS altGroupId, pc.birth_order AS birthOrder
	 FROM tanahpedia_person_parent_child pc
	 JOIN tanahpedia_lookup_parent_child_type t ON t.id = pc.relationship_type_id
	 JOIN tanahpedia_lookup_parent_role r ON r.id = pc.parent_role_id WHERE pc.id = ? FOR UPDATE`,
	union: `SELECT u.person1_id AS person1Id, u.person2_id AS person2Id, t.name AS unionType,
	 u.union_order AS unionOrder, u.start_date AS startDate, u.end_date AS endDate,
	 r.name AS endReason, u.source_citation AS sourceCitation, u.person_source_citation AS personSourceCitation,
	 u.alt_group_id AS altGroupId FROM tanahpedia_person_union u
	 JOIN tanahpedia_lookup_union_type t ON t.id = u.union_type_id
	 LEFT JOIN tanahpedia_lookup_union_end_reason r ON r.id = u.end_reason_id WHERE u.id = ? FOR UPDATE`,
	place: `SELECT place_id AS placeId, modern_name AS modernName, latitude, longitude, alt_group_id AS altGroupId
	 FROM tanahpedia_place_identification WHERE id = ? FOR UPDATE`,
	metadata:
		"SELECT name AS displayName FROM tanahpedia_entity WHERE id = ? FOR UPDATE",
	entry:
		"SELECT title, unique_name AS uniqueName FROM tanahpedia_entry WHERE id = ? FOR UPDATE",
};

export async function readChangeState(
	conn: PoolConnection,
	kind: ReviewedChange["kind"],
	targetId: string,
	context?: State | null,
): Promise<State | null> {
	if (isContributionRecordKind(kind))
		return readContributionRecord(conn, kind, targetId);
	if (kind === "alias_mapping")
		return readAliasMapping(conn, targetId, context);
	if (kind === "source_reference") return readSourceReference(conn, targetId);
	const row = await txQueryOne<State>(conn, READS[kind], [targetId]);
	if (row && kind === "place") {
		for (const key of ["latitude", "longitude"])
			if (row[key] !== null) row[key] = Number(row[key]);
	}
	return row;
}

async function lookup(
	conn: PoolConnection,
	table: string,
	name: unknown,
): Promise<string> {
	const row = await txQueryOne<{ id: string }>(
		conn,
		`SELECT id FROM ${table} WHERE name = ?`,
		[name],
	);
	if (!row) throw new Error(`Missing lookup value: ${String(name)}`);
	return row.id;
}

async function referenceLabels(
	conn: PoolConnection,
	change: ChangeInput,
): Promise<Record<string, string>> {
	const labels: Record<string, string> = {};
	if (!change.after) return labels;
	if (isContributionRecordKind(change.kind))
		return structuredReferenceLabels(
			conn,
			change.kind,
			change.after as unknown as State,
		);
	if (change.kind === "alias_mapping")
		return aliasReferenceLabels(conn, change.after as unknown as State);
	if (change.kind === "source_reference")
		return sourceReferenceLabels(conn, change.after as unknown as State);
	const after = change.after as unknown as State;
	for (const key of [
		"parentId",
		"childId",
		"person1Id",
		"person2Id",
		"placeId",
	]) {
		if (!after[key]) continue;
		const table = key === "placeId" ? "tanahpedia_place" : "tanahpedia_person";
		const row = await txQueryOne<{ name: string }>(
			conn,
			`SELECT e.name FROM ${table} p JOIN tanahpedia_entity e ON e.id = p.entity_id WHERE p.id = ? FOR UPDATE`,
			[after[key]],
		);
		if (!row) throw new Error(`Referenced ${key} does not exist`);
		labels[String(after[key])] = row.name;
	}
	return labels;
}

export async function prepareChanges(
	conn: PoolConnection,
	inputs: ChangeInput[],
): Promise<ReviewedChange[]> {
	const changes: ReviewedChange[] = [];
	for (const input of inputs) {
		const targetId = input.targetId ?? randomUUID();
		const before = await readChangeState(
			conn,
			input.kind,
			targetId,
			input.after as unknown as State,
		);
		if (input.kind === "alias_mapping" && !input.targetId && before)
			throw new Error(
				"Choose the existing alias to edit its complete target set",
			);
		if (
			isContributionRecordKind(input.kind) &&
			CONTRIBUTION_RECORDS[input.kind].updateOnly &&
			!before
		)
			throw new Error("Record not found");
		if (input.kind === "entry") {
			if (before) throw new Error("New-entry target already exists");
			assertEntryFieldsValid({
				title: input.after.title,
				unique_name: input.after.uniqueName,
			});
		}
		if (input.kind === "metadata" && !before)
			throw new Error("Entity not found");
		if (input.after === null && !before)
			throw new Error(
				"The deleted relationship or identification does not exist",
			);
		const after = input.after as unknown as State | null;
		if (sameState(before, after))
			throw new Error("This proposal does not change the target");
		const labels = await referenceLabels(conn, input);
		// Preserve the old graph's names when a relationship changes members.
		if (before && input.kind !== "metadata" && input.kind !== "entry") {
			Object.assign(
				labels,
				await referenceLabels(conn, { ...input, after: before } as ChangeInput),
			);
		}
		changes.push({
			kind: input.kind,
			targetId,
			before,
			after,
			labels,
			...(input.kind === "metadata"
				? { personNames: await readMetadataNames(conn, targetId) }
				: {}),
		});
	}
	return changes;
}

/** Typed domain API operations. Called inside the PR's single merge transaction. */
export async function applyChange(
	conn: PoolConnection,
	change: ReviewedChange,
	source: string,
): Promise<void> {
	const input = validateChange({
		kind: change.kind,
		targetId: change.targetId,
		after: change.after,
	});
	if (isContributionRecordKind(input.kind)) {
		await applyContributionRecord(conn, change);
		return;
	}
	if (input.kind === "alias_mapping") {
		await applyAliasMapping(conn, change);
		return;
	}
	if (input.kind === "source_reference") {
		await applySourceReference(conn, change);
		return;
	}
	const a = change.after;
	const id = change.targetId;
	if (!a) {
		const table = {
			parent_child: "tanahpedia_person_parent_child",
			union: "tanahpedia_person_union",
			place: "tanahpedia_place_identification",
		}[input.kind as "parent_child" | "union" | "place"];
		if (!table) throw new Error("Unsupported deletion");
		await txExecute(conn, `DELETE FROM ${table} WHERE id = ?`, [id]);
		return;
	}
	await referenceLabels(conn, input);
	if (input.kind === "metadata") {
		await assertMetadataNames(conn, change);
		await txExecute(
			conn,
			"UPDATE tanahpedia_entity SET name = ? WHERE id = ?",
			[a.displayName, id],
		);
		await txExecute(
			conn,
			"UPDATE tanahpedia_person_name n JOIN tanahpedia_person p ON p.id = n.person_id JOIN tanahpedia_lookup_name_type t ON t.id = n.name_type_id SET n.name = ? WHERE p.entity_id = ? AND t.name = 'MAIN'",
			[a.displayName, id],
		);
		return;
	}
	if (input.kind === "place") {
		await txExecute(
			conn,
			`INSERT INTO tanahpedia_place_identification (id, place_id, modern_name, latitude, longitude, alt_group_id)
		 VALUES (?, ?, ?, ?, ?, ?) AS proposed ON DUPLICATE KEY UPDATE place_id = proposed.place_id, modern_name = proposed.modern_name,
		 latitude = proposed.latitude, longitude = proposed.longitude, alt_group_id = proposed.alt_group_id`,
			[id, a.placeId, a.modernName, a.latitude, a.longitude, a.altGroupId],
		);
		return;
	}
	if (input.kind === "parent_child") {
		const type = await lookup(
			conn,
			"tanahpedia_lookup_parent_child_type",
			a.relationshipType,
		);
		const role = await lookup(
			conn,
			"tanahpedia_lookup_parent_role",
			a.parentRole,
		);
		await txExecute(
			conn,
			`INSERT INTO tanahpedia_person_parent_child (id, parent_id, child_id, relationship_type_id, parent_role_id, source_citation, alt_group_id, birth_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS proposed ON DUPLICATE KEY UPDATE parent_id = proposed.parent_id, child_id = proposed.child_id,
		 relationship_type_id = proposed.relationship_type_id, parent_role_id = proposed.parent_role_id, source_citation = proposed.source_citation,
		 alt_group_id = proposed.alt_group_id, birth_order = proposed.birth_order`,
			[
				id,
				a.parentId,
				a.childId,
				type,
				role,
				a.sourceCitation,
				a.altGroupId,
				a.birthOrder,
			],
		);
		return;
	}
	if (input.kind === "union") {
		const type = await lookup(
			conn,
			"tanahpedia_lookup_union_type",
			a.unionType,
		);
		const reason = a.endReason
			? await lookup(conn, "tanahpedia_lookup_union_end_reason", a.endReason)
			: null;
		await txExecute(
			conn,
			`INSERT INTO tanahpedia_person_union (id, person1_id, person2_id, union_type_id, union_order, start_date, end_date, end_reason_id, source_citation, person_source_citation, alt_group_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS proposed ON DUPLICATE KEY UPDATE person1_id = proposed.person1_id, person2_id = proposed.person2_id,
		 union_type_id = proposed.union_type_id, union_order = proposed.union_order, start_date = proposed.start_date, end_date = proposed.end_date,
		 end_reason_id = proposed.end_reason_id, source_citation = proposed.source_citation, person_source_citation = proposed.person_source_citation, alt_group_id = proposed.alt_group_id`,
			[
				id,
				a.person1Id,
				a.person2Id,
				type,
				a.unionOrder,
				a.startDate,
				a.endDate,
				reason,
				a.sourceCitation,
				a.personSourceCitation,
				a.altGroupId,
			],
		);
		return;
	}
	if (input.kind !== "entry") throw new Error("Unsupported operation");
	assertEntryFieldsValid({
		title: input.after.title,
		unique_name: input.after.uniqueName,
	});
	const entityId = randomUUID(),
		subtypeId = randomUUID();
	const subtypeTables: Partial<Record<string, string>> = {
		PERSON: "tanahpedia_person",
		PLACE: "tanahpedia_place",
		EVENT: "tanahpedia_event",
		ANIMAL: "tanahpedia_animal",
		OBJECT: "tanahpedia_object",
		PLANT: "tanahpedia_plant",
		ASTRONOMICAL_OBJECT: "tanahpedia_astronomical_object",
		SAYING: "tanahpedia_saying",
		SEFER: "tanahpedia_sefer",
		NATION: "tanahpedia_nation",
	};
	await txExecute(
		conn,
		"INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (?, ?, ?, '<p></p>')",
		[id, a.uniqueName, a.title],
	);
	await txExecute(
		conn,
		"INSERT INTO tanahpedia_entry_revision (id, entry_id, proposed_unique_name, proposed_title, proposed_content, source, notes, status, base_revision_id) VALUES (?, ?, ?, ?, '<p></p>', ?, ?, 'APPLIED', NULL)",
		[
			randomUUID(),
			id,
			a.uniqueName,
			a.title,
			source,
			"Metadata-only contribution merge",
		],
	);
	await txExecute(
		conn,
		"INSERT INTO tanahpedia_entity (id, entity_type, name) VALUES (?, ?, ?)",
		[entityId, a.entityType, a.displayName],
	);
	const derivedTypes: Partial<
		Record<string, { table: string; parentTable: string; parentKey: string }>
	> = {
		WAR: {
			table: "tanahpedia_war",
			parentTable: "tanahpedia_event",
			parentKey: "event_id",
		},
		TEMPLE_TOOL: {
			table: "tanahpedia_temple_tool",
			parentTable: "tanahpedia_object",
			parentKey: "object_id",
		},
		PROPHECY: {
			table: "tanahpedia_prophecy",
			parentTable: "tanahpedia_saying",
			parentKey: "saying_id",
		},
	};
	const derived = derivedTypes[input.after.entityType];
	if (derived) {
		const parentId = randomUUID();
		await txExecute(
			conn,
			`INSERT INTO ${derived.parentTable} (id, entity_id) VALUES (?, ?)`,
			[parentId, entityId],
		);
		await txExecute(
			conn,
			`INSERT INTO ${derived.table} (id, ${derived.parentKey}, entity_id) VALUES (?, ?, ?)`,
			[subtypeId, parentId, entityId],
		);
	} else {
		await txExecute(
			conn,
			`INSERT INTO ${subtypeTables[input.after.entityType]} (id, entity_id) VALUES (?, ?)`,
			[subtypeId, entityId],
		);
	}
	if (input.after.entityType === "PERSON") {
		const nameType = await lookup(conn, "tanahpedia_lookup_name_type", "MAIN");
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id) VALUES (?, ?, ?, ?, NULL)",
			[randomUUID(), subtypeId, a.displayName, nameType],
		);
	}
	await txExecute(
		conn,
		"INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id) VALUES (?, ?, ?)",
		[randomUUID(), id, entityId],
	);
	await recomputeEntryMetrics(conn, id, "<p></p>");
}

export async function contributionCatalogue(conn: PoolConnection) {
	const [people, places, entities] = await Promise.all([
		txQuery<{ id: string; name: string }>(
			conn,
			"SELECT p.id, e.name FROM tanahpedia_person p JOIN tanahpedia_entity e ON e.id = p.entity_id ORDER BY e.name LIMIT 2000",
		),
		txQuery<{ id: string; name: string }>(
			conn,
			"SELECT p.id, e.name FROM tanahpedia_place p JOIN tanahpedia_entity e ON e.id = p.entity_id ORDER BY e.name LIMIT 2000",
		),
		txQuery<{ id: string; name: string; entityType: string }>(
			conn,
			"SELECT id, name, entity_type AS entityType FROM tanahpedia_entity ORDER BY name LIMIT 4000",
		),
	]);
	const [parentChild, unions, identifications] = await Promise.all([
		txQuery<State & { id: string; label: string }>(
			conn,
			`SELECT pc.id, CONCAT(e1.name, ' → ', e2.name) AS label,
		 pc.parent_id AS parentId, pc.child_id AS childId, t.name AS relationshipType, r.name AS parentRole,
		 pc.source_citation AS sourceCitation, pc.alt_group_id AS altGroupId, pc.birth_order AS birthOrder
		 FROM tanahpedia_person_parent_child pc JOIN tanahpedia_person p1 ON p1.id = pc.parent_id
		 JOIN tanahpedia_person p2 ON p2.id = pc.child_id JOIN tanahpedia_entity e1 ON e1.id = p1.entity_id
		 JOIN tanahpedia_entity e2 ON e2.id = p2.entity_id JOIN tanahpedia_lookup_parent_child_type t ON t.id = pc.relationship_type_id
		 JOIN tanahpedia_lookup_parent_role r ON r.id = pc.parent_role_id ORDER BY e1.name, e2.name LIMIT 3000`,
		),
		txQuery<State & { id: string; label: string }>(
			conn,
			`SELECT u.id, CONCAT(e1.name, ' ↔ ', e2.name) AS label,
		 u.person1_id AS person1Id, u.person2_id AS person2Id, t.name AS unionType, u.union_order AS unionOrder,
		 u.start_date AS startDate, u.end_date AS endDate, r.name AS endReason, u.source_citation AS sourceCitation,
		 u.person_source_citation AS personSourceCitation, u.alt_group_id AS altGroupId FROM tanahpedia_person_union u
		 JOIN tanahpedia_person p1 ON p1.id = u.person1_id JOIN tanahpedia_person p2 ON p2.id = u.person2_id
		 JOIN tanahpedia_entity e1 ON e1.id = p1.entity_id JOIN tanahpedia_entity e2 ON e2.id = p2.entity_id
		 JOIN tanahpedia_lookup_union_type t ON t.id = u.union_type_id LEFT JOIN tanahpedia_lookup_union_end_reason r ON r.id = u.end_reason_id
		 ORDER BY e1.name, e2.name LIMIT 3000`,
		),
		txQuery<State & { id: string; label: string }>(
			conn,
			`SELECT i.id, CONCAT(e.name, ' - ', COALESCE(i.modern_name, '')) AS label,
		 i.place_id AS placeId, i.modern_name AS modernName, i.latitude, i.longitude, i.alt_group_id AS altGroupId
		 FROM tanahpedia_place_identification i JOIN tanahpedia_place p ON p.id = i.place_id
		 JOIN tanahpedia_entity e ON e.id = p.entity_id ORDER BY e.name LIMIT 2000`,
		),
	]);
	const targets = [
		...parentChild.map(({ id, label, ...after }) => ({
			kind: "parent_child",
			id,
			label,
			after,
		})),
		...unions.map(({ id, label, ...after }) => ({
			kind: "union",
			id,
			label,
			after,
		})),
		...identifications.map(({ id, label, ...after }) => ({
			kind: "place",
			id,
			label,
			after: {
				...after,
				latitude: after.latitude === null ? null : Number(after.latitude),
				longitude: after.longitude === null ? null : Number(after.longitude),
			} as State,
		})),
	];
	const structured = await structuredContributionCatalogue(conn);
	const special = await specialContributionTargets(conn);
	structured.references.place_identification = targets
		.filter((t) => t.kind === "place")
		.map((t) => ({ id: t.id, name: t.label }));
	return {
		people,
		places,
		entities,
		references: structured.references,
		targets: [...targets, ...structured.targets, ...special],
	};
}
