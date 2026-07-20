import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import {
	FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES,
	FAMILY_PARENT_ROLES,
	FAMILY_UNION_END_REASONS,
	FAMILY_UNION_TYPES,
	type CreateFamilyPersonInput,
	type CreateParentChildLinkInput,
	type CreateUnionLinkInput,
} from "./family-api-spec";
import { execute, query, queryOne } from "../db";

function requiredNonEmpty(v: string, field: string): string {
	const s = v.trim();
	if (!s) throw new Error(`${field} is required`);
	return s;
}

function isOneOf<T extends readonly string[]>(
	value: string,
	allowed: T,
): value is T[number] {
	return (allowed as readonly string[]).includes(value);
}

async function getMainNameTypeId(): Promise<string> {
	const row = await queryOne<{ id: string }>(
		"SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1",
	);
	if (!row) {
		throw new Error("Missing tanahpedia_lookup_name_type row for MAIN");
	}
	return row.id;
}

async function getLookupIdByName(params: {
	table:
		| "tanahpedia_lookup_parent_child_type"
		| "tanahpedia_lookup_parent_role"
		| "tanahpedia_lookup_union_type"
		| "tanahpedia_lookup_union_end_reason";
	name: string;
}): Promise<string> {
	const row = await queryOne<{ id: string }>(
		`SELECT id FROM ${params.table} WHERE name = ? LIMIT 1`,
		[params.name],
	);
	if (!row) throw new Error(`Missing ${params.table} row for ${params.name}`);
	return row.id;
}

export const createFamilyPersonNode = createServerFn({ method: "POST" })
	.inputValidator((data: CreateFamilyPersonInput) => data)
	.handler(async ({ data }) => {
		const name = requiredNonEmpty(data.displayName, "displayName");
		const sex = data.sex?.trim().toUpperCase() ?? null;
		if (
			sex !== null &&
			sex !== "MALE" &&
			sex !== "FEMALE" &&
			sex !== "UNKNOWN"
		) {
			throw new Error("sex must be MALE, FEMALE, UNKNOWN, or null");
		}

		const entityId = randomUUID();
		const personId = randomUUID();
		const mainNameTypeId = await getMainNameTypeId();

		await execute(
			`INSERT INTO tanahpedia_entity (id, entity_type, name) VALUES (?, 'PERSON', ?)`,
			[entityId, name],
		);
		await execute(`INSERT INTO tanahpedia_person (id, entity_id) VALUES (?, ?)`, [
			personId,
			entityId,
		]);
		await execute(
			`INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
			 VALUES (?, ?, ?, ?, NULL)`,
			[randomUUID(), personId, name, mainNameTypeId],
		);
		if (sex) {
			await execute(
				`INSERT INTO tanahpedia_person_sex (id, person_id, sex, alt_group_id)
				 VALUES (?, ?, ?, NULL)`,
				[randomUUID(), personId, sex],
			);
		}

		let linkId: string | null = null;
		if (data.linkToEntryId?.trim()) {
			linkId = randomUUID();
			await execute(
				`INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id) VALUES (?, ?, ?)`,
				[linkId, data.linkToEntryId.trim(), entityId],
			);
		}

		return { entityId, personId, linkId };
	});

export const createParentChildLink = createServerFn({ method: "POST" })
	.inputValidator((data: CreateParentChildLinkInput) => data)
	.handler(async ({ data }) => {
		const relationshipType = data.relationshipType.trim().toUpperCase();
		if (!isOneOf(relationshipType, FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES)) {
			throw new Error("Invalid relationshipType");
		}
		const parentRole = data.parentRole.trim().toUpperCase();
		if (!isOneOf(parentRole, FAMILY_PARENT_ROLES)) {
			throw new Error("Invalid parentRole");
		}

		const parentPersonId = requiredNonEmpty(data.parentPersonId, "parentPersonId");
		const childPersonId = requiredNonEmpty(data.childPersonId, "childPersonId");

		const relationshipTypeId = await getLookupIdByName({
			table: "tanahpedia_lookup_parent_child_type",
			name: relationshipType,
		});
		const parentRoleId = await getLookupIdByName({
			table: "tanahpedia_lookup_parent_role",
			name: parentRole,
		});

		const id = randomUUID();
		await execute(
			`INSERT INTO tanahpedia_person_parent_child
			 (id, parent_id, child_id, relationship_type_id, parent_role_id, alt_group_id, source_citation)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				parentPersonId,
				childPersonId,
				relationshipTypeId,
				parentRoleId,
				data.altGroupId ?? null,
				data.sourceCitation ?? null,
			],
		);

		return { id };
	});

export const createUnionLink = createServerFn({ method: "POST" })
	.inputValidator((data: CreateUnionLinkInput) => data)
	.handler(async ({ data }) => {
		const unionType = data.unionType.trim().toUpperCase();
		if (!isOneOf(unionType, FAMILY_UNION_TYPES)) {
			throw new Error("Invalid unionType");
		}
		const person1Id = requiredNonEmpty(data.person1Id, "person1Id");
		const person2Id = requiredNonEmpty(data.person2Id, "person2Id");
		if (person1Id === person2Id) {
			throw new Error("person1Id and person2Id must be different");
		}

		let endReasonId: string | null = null;
		if (data.endReason) {
			const endReason = data.endReason.trim().toUpperCase();
			if (!isOneOf(endReason, FAMILY_UNION_END_REASONS)) {
				throw new Error("Invalid endReason");
			}
			endReasonId = await getLookupIdByName({
				table: "tanahpedia_lookup_union_end_reason",
				name: endReason,
			});
		}

		const unionTypeId = await getLookupIdByName({
			table: "tanahpedia_lookup_union_type",
			name: unionType,
		});

		const id = randomUUID();
		await execute(
			`INSERT INTO tanahpedia_person_union
			 (id, person1_id, person2_id, union_type_id, union_order, start_date, end_date, end_reason_id, alt_group_id, source_citation)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				person1Id,
				person2Id,
				unionTypeId,
				data.unionOrder ?? null,
				data.startDate ?? null,
				data.endDate ?? null,
				endReasonId,
				data.altGroupId ?? null,
				data.sourceCitation ?? null,
			],
		);

		return { id };
	});

export const getFamilyLookups = createServerFn({ method: "GET" }).handler(
	async () => {
		const [relationshipTypes, parentRoles, unionTypes, unionEndReasons] =
			await Promise.all([
				query<{ id: string; name: string }>(
					"SELECT id, name FROM tanahpedia_lookup_parent_child_type ORDER BY name",
				),
				query<{ id: string; name: string }>(
					"SELECT id, name FROM tanahpedia_lookup_parent_role ORDER BY name",
				),
				query<{ id: string; name: string }>(
					"SELECT id, name FROM tanahpedia_lookup_union_type ORDER BY name",
				),
				query<{ id: string; name: string }>(
					"SELECT id, name FROM tanahpedia_lookup_union_end_reason ORDER BY name",
				),
			]);

		return {
			relationshipTypes,
			parentRoles,
			unionTypes,
			unionEndReasons,
		};
	},
);
