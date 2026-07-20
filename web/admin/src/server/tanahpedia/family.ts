import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { execute, query, queryOne } from "../db";
import {
	type CreateFamilyPersonInput,
	type CreateParentChildLinkInput,
	type CreatePersonNameInput,
	type CreateUnionLinkInput,
	type DeleteFamilyPersonInput,
	type DeleteParentChildLinkInput,
	type DeletePersonNameInput,
	type DeleteUnionLinkInput,
	FAMILY_NAME_TYPES,
	FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES,
	FAMILY_PARENT_ROLES,
	FAMILY_UNION_END_REASONS,
	FAMILY_UNION_TYPES,
	type UpdateFamilyPersonInput,
	type UpdateParentChildLinkInput,
	type UpdatePersonNameInput,
	type UpdateUnionLinkInput,
} from "./family-api-spec";

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

async function getNameTypeIdByName(name: string): Promise<string> {
	const row = await queryOne<{ id: string }>(
		"SELECT id FROM tanahpedia_lookup_name_type WHERE name = ? LIMIT 1",
		[name],
	);
	if (!row) {
		throw new Error(`Missing tanahpedia_lookup_name_type row for ${name}`);
	}
	return row.id;
}

async function getGodId(): Promise<string> {
	const row = await queryOne<{ id: string }>(
		"SELECT id FROM tanahpedia_god LIMIT 1",
	);
	if (!row) throw new Error("Missing tanahpedia_god singleton row");
	return row.id;
}

/**
 * Upserts or deletes a person's single-row-per-person biographical fact
 * (sex, birth_date, death_date, death_cause, birth_place). Passing `null`
 * deletes the existing row (if any); passing a value inserts or updates it.
 */
async function upsertPersonSingleton(params: {
	table:
		| "tanahpedia_person_birth_date"
		| "tanahpedia_person_death_date"
		| "tanahpedia_person_death_cause"
		| "tanahpedia_person_birth_place";
	valueColumn: string;
	personId: string;
	value: string | number | null;
}): Promise<void> {
	const { table, valueColumn, personId, value } = params;
	if (value === null) {
		await execute(`DELETE FROM ${table} WHERE person_id = ?`, [personId]);
		return;
	}
	const existing = await queryOne<{ id: string }>(
		`SELECT id FROM ${table} WHERE person_id = ? LIMIT 1`,
		[personId],
	);
	if (existing) {
		await execute(`UPDATE ${table} SET ${valueColumn} = ? WHERE id = ?`, [
			value,
			existing.id,
		]);
	} else {
		await execute(
			`INSERT INTO ${table} (id, person_id, ${valueColumn}, alt_group_id) VALUES (?, ?, ?, NULL)`,
			[randomUUID(), personId, value],
		);
	}
}

/** Enables/disables a non-exclusive person role (prophet, king). */
async function setPersonRole(params: {
	table: "tanahpedia_person_role_prophet" | "tanahpedia_person_role_king";
	personId: string;
	enabled: boolean;
}): Promise<void> {
	const { table, personId, enabled } = params;
	if (!enabled) {
		await execute(`DELETE FROM ${table} WHERE person_id = ?`, [personId]);
		return;
	}
	const existing = await queryOne<{ id: string }>(
		`SELECT id FROM ${table} WHERE person_id = ? LIMIT 1`,
		[personId],
	);
	if (!existing) {
		await execute(`INSERT INTO ${table} (id, person_id) VALUES (?, ?)`, [
			randomUUID(),
			personId,
		]);
	}
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

function validateSex(
	rawSex: string | null | undefined,
): "MALE" | "FEMALE" | "UNKNOWN" | null {
	const sex = rawSex?.trim().toUpperCase() ?? null;
	if (sex !== null && sex !== "MALE" && sex !== "FEMALE" && sex !== "UNKNOWN") {
		throw new Error("sex must be MALE, FEMALE, UNKNOWN, or null");
	}
	return sex;
}

function assertAffected(
	result: { affectedRows: number },
	notFoundMessage: string,
): void {
	if (result.affectedRows === 0) {
		throw new Error(notFoundMessage);
	}
}

export const createFamilyPersonNode = createServerFn({ method: "POST" })
	.inputValidator((data: CreateFamilyPersonInput) => data)
	.handler(async ({ data }) => {
		const name = requiredNonEmpty(data.displayName, "displayName");
		const sex = validateSex(data.sex);

		const entityId = randomUUID();
		const personId = randomUUID();
		const mainNameTypeId = await getMainNameTypeId();

		await execute(
			`INSERT INTO tanahpedia_entity (id, entity_type, name) VALUES (?, 'PERSON', ?)`,
			[entityId, name],
		);
		await execute(
			`INSERT INTO tanahpedia_person (id, entity_id) VALUES (?, ?)`,
			[personId, entityId],
		);
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
		if (data.birthDate != null) {
			await upsertPersonSingleton({
				table: "tanahpedia_person_birth_date",
				valueColumn: "birth_date",
				personId,
				value: data.birthDate,
			});
		}
		if (data.deathDate != null) {
			await upsertPersonSingleton({
				table: "tanahpedia_person_death_date",
				valueColumn: "death_date",
				personId,
				value: data.deathDate,
			});
		}
		if (data.deathCause != null) {
			await upsertPersonSingleton({
				table: "tanahpedia_person_death_cause",
				valueColumn: "death_cause",
				personId,
				value: data.deathCause,
			});
		}
		if (data.birthPlaceId != null) {
			await upsertPersonSingleton({
				table: "tanahpedia_person_birth_place",
				valueColumn: "place_id",
				personId,
				value: data.birthPlaceId,
			});
		}
		if (data.isProphet) {
			await setPersonRole({
				table: "tanahpedia_person_role_prophet",
				personId,
				enabled: true,
			});
		}
		if (data.isKing) {
			await setPersonRole({
				table: "tanahpedia_person_role_king",
				personId,
				enabled: true,
			});
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

export const updateFamilyPersonNode = createServerFn({ method: "POST" })
	.inputValidator((data: UpdateFamilyPersonInput) => data)
	.handler(async ({ data }) => {
		const entityId = requiredNonEmpty(data.entityId, "entityId");
		if (
			data.displayName === undefined &&
			data.sex === undefined &&
			data.birthDate === undefined &&
			data.deathDate === undefined &&
			data.deathCause === undefined &&
			data.birthPlaceId === undefined &&
			data.isProphet === undefined &&
			data.isKing === undefined
		) {
			throw new Error("At least one field must be provided to update");
		}

		if (data.displayName !== undefined) {
			const name = requiredNonEmpty(data.displayName, "displayName");
			const result = await execute(
				`UPDATE tanahpedia_entity SET name = ? WHERE id = ?`,
				[name, entityId],
			);
			assertAffected(result, `Person entity not found: ${entityId}`);

			const person = await queryOne<{ id: string }>(
				`SELECT id FROM tanahpedia_person WHERE entity_id = ? LIMIT 1`,
				[entityId],
			);
			if (person) {
				const mainNameTypeId = await getMainNameTypeId();
				await execute(
					`UPDATE tanahpedia_person_name SET name = ? WHERE person_id = ? AND name_type_id = ?`,
					[name, person.id, mainNameTypeId],
				);
			}
		}

		if (data.sex !== undefined) {
			const sex = validateSex(data.sex);
			const person = await queryOne<{ id: string }>(
				`SELECT id FROM tanahpedia_person WHERE entity_id = ? LIMIT 1`,
				[entityId],
			);
			if (!person) throw new Error(`Person not found for entity: ${entityId}`);

			if (sex === null) {
				await execute(`DELETE FROM tanahpedia_person_sex WHERE person_id = ?`, [
					person.id,
				]);
			} else {
				const existing = await queryOne<{ id: string }>(
					`SELECT id FROM tanahpedia_person_sex WHERE person_id = ? LIMIT 1`,
					[person.id],
				);
				if (existing) {
					await execute(
						`UPDATE tanahpedia_person_sex SET sex = ? WHERE id = ?`,
						[sex, existing.id],
					);
				} else {
					await execute(
						`INSERT INTO tanahpedia_person_sex (id, person_id, sex, alt_group_id)
						 VALUES (?, ?, ?, NULL)`,
						[randomUUID(), person.id, sex],
					);
				}
			}
		}

		if (
			data.birthDate !== undefined ||
			data.deathDate !== undefined ||
			data.deathCause !== undefined ||
			data.birthPlaceId !== undefined ||
			data.isProphet !== undefined ||
			data.isKing !== undefined
		) {
			const person = await queryOne<{ id: string }>(
				`SELECT id FROM tanahpedia_person WHERE entity_id = ? LIMIT 1`,
				[entityId],
			);
			if (!person) throw new Error(`Person not found for entity: ${entityId}`);

			if (data.birthDate !== undefined) {
				await upsertPersonSingleton({
					table: "tanahpedia_person_birth_date",
					valueColumn: "birth_date",
					personId: person.id,
					value: data.birthDate,
				});
			}
			if (data.deathDate !== undefined) {
				await upsertPersonSingleton({
					table: "tanahpedia_person_death_date",
					valueColumn: "death_date",
					personId: person.id,
					value: data.deathDate,
				});
			}
			if (data.deathCause !== undefined) {
				await upsertPersonSingleton({
					table: "tanahpedia_person_death_cause",
					valueColumn: "death_cause",
					personId: person.id,
					value: data.deathCause,
				});
			}
			if (data.birthPlaceId !== undefined) {
				await upsertPersonSingleton({
					table: "tanahpedia_person_birth_place",
					valueColumn: "place_id",
					personId: person.id,
					value: data.birthPlaceId,
				});
			}
			if (data.isProphet !== undefined) {
				await setPersonRole({
					table: "tanahpedia_person_role_prophet",
					personId: person.id,
					enabled: data.isProphet,
				});
			}
			if (data.isKing !== undefined) {
				await setPersonRole({
					table: "tanahpedia_person_role_king",
					personId: person.id,
					enabled: data.isKing,
				});
			}
		}

		return { entityId };
	});

export const deleteFamilyPersonNode = createServerFn({ method: "POST" })
	.inputValidator((data: DeleteFamilyPersonInput) => data)
	.handler(async ({ data }) => {
		const entityId = requiredNonEmpty(data.entityId, "entityId");
		const person = await queryOne<{ id: string }>(
			`SELECT id FROM tanahpedia_person WHERE entity_id = ? LIMIT 1`,
			[entityId],
		);
		if (!person) throw new Error(`Person not found for entity: ${entityId}`);

		await execute(
			`DELETE FROM tanahpedia_person_union WHERE person1_id = ? OR person2_id = ?`,
			[person.id, person.id],
		);
		await execute(
			`DELETE FROM tanahpedia_person_parent_child WHERE parent_id = ? OR child_id = ?`,
			[person.id, person.id],
		);
		await execute(`DELETE FROM tanahpedia_person_name WHERE person_id = ?`, [
			person.id,
		]);
		await execute(`DELETE FROM tanahpedia_person_sex WHERE person_id = ?`, [
			person.id,
		]);
		await execute(`DELETE FROM tanahpedia_entry_entity WHERE entity_id = ?`, [
			entityId,
		]);
		await execute(`DELETE FROM tanahpedia_person WHERE id = ?`, [person.id]);
		const result = await execute(`DELETE FROM tanahpedia_entity WHERE id = ?`, [
			entityId,
		]);
		assertAffected(result, `Person entity not found: ${entityId}`);

		return { entityId };
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

		const parentPersonId = requiredNonEmpty(
			data.parentPersonId,
			"parentPersonId",
		);
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

export const updateParentChildLink = createServerFn({ method: "POST" })
	.inputValidator((data: UpdateParentChildLinkInput) => data)
	.handler(async ({ data }) => {
		const id = requiredNonEmpty(data.id, "id");

		const sets: string[] = [];
		const params: unknown[] = [];

		if (data.relationshipType !== undefined) {
			const relationshipType = data.relationshipType.trim().toUpperCase();
			if (!isOneOf(relationshipType, FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES)) {
				throw new Error("Invalid relationshipType");
			}
			const relationshipTypeId = await getLookupIdByName({
				table: "tanahpedia_lookup_parent_child_type",
				name: relationshipType,
			});
			sets.push("relationship_type_id = ?");
			params.push(relationshipTypeId);
		}

		if (data.parentRole !== undefined) {
			const parentRole = data.parentRole.trim().toUpperCase();
			if (!isOneOf(parentRole, FAMILY_PARENT_ROLES)) {
				throw new Error("Invalid parentRole");
			}
			const parentRoleId = await getLookupIdByName({
				table: "tanahpedia_lookup_parent_role",
				name: parentRole,
			});
			sets.push("parent_role_id = ?");
			params.push(parentRoleId);
		}

		if (data.altGroupId !== undefined) {
			sets.push("alt_group_id = ?");
			params.push(data.altGroupId);
		}

		if (data.sourceCitation !== undefined) {
			sets.push("source_citation = ?");
			params.push(data.sourceCitation);
		}

		if (sets.length === 0) {
			throw new Error("At least one field must be provided to update");
		}

		params.push(id);
		const result = await execute(
			`UPDATE tanahpedia_person_parent_child SET ${sets.join(", ")} WHERE id = ?`,
			params,
		);
		assertAffected(result, `Parent-child link not found: ${id}`);

		return { id };
	});

export const deleteParentChildLink = createServerFn({ method: "POST" })
	.inputValidator((data: DeleteParentChildLinkInput) => data)
	.handler(async ({ data }) => {
		const id = requiredNonEmpty(data.id, "id");
		const result = await execute(
			`DELETE FROM tanahpedia_person_parent_child WHERE id = ?`,
			[id],
		);
		assertAffected(result, `Parent-child link not found: ${id}`);

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

export const updateUnionLink = createServerFn({ method: "POST" })
	.inputValidator((data: UpdateUnionLinkInput) => data)
	.handler(async ({ data }) => {
		const id = requiredNonEmpty(data.id, "id");

		const sets: string[] = [];
		const params: unknown[] = [];

		if (data.unionType !== undefined) {
			const unionType = data.unionType.trim().toUpperCase();
			if (!isOneOf(unionType, FAMILY_UNION_TYPES)) {
				throw new Error("Invalid unionType");
			}
			const unionTypeId = await getLookupIdByName({
				table: "tanahpedia_lookup_union_type",
				name: unionType,
			});
			sets.push("union_type_id = ?");
			params.push(unionTypeId);
		}

		if (data.unionOrder !== undefined) {
			sets.push("union_order = ?");
			params.push(data.unionOrder);
		}

		if (data.startDate !== undefined) {
			sets.push("start_date = ?");
			params.push(data.startDate);
		}

		if (data.endDate !== undefined) {
			sets.push("end_date = ?");
			params.push(data.endDate);
		}

		if (data.endReason !== undefined) {
			let endReasonId: string | null = null;
			if (data.endReason !== null) {
				const endReason = data.endReason.trim().toUpperCase();
				if (!isOneOf(endReason, FAMILY_UNION_END_REASONS)) {
					throw new Error("Invalid endReason");
				}
				endReasonId = await getLookupIdByName({
					table: "tanahpedia_lookup_union_end_reason",
					name: endReason,
				});
			}
			sets.push("end_reason_id = ?");
			params.push(endReasonId);
		}

		if (data.altGroupId !== undefined) {
			sets.push("alt_group_id = ?");
			params.push(data.altGroupId);
		}

		if (data.sourceCitation !== undefined) {
			sets.push("source_citation = ?");
			params.push(data.sourceCitation);
		}

		if (sets.length === 0) {
			throw new Error("At least one field must be provided to update");
		}

		params.push(id);
		const result = await execute(
			`UPDATE tanahpedia_person_union SET ${sets.join(", ")} WHERE id = ?`,
			params,
		);
		assertAffected(result, `Union link not found: ${id}`);

		return { id };
	});

export const deleteUnionLink = createServerFn({ method: "POST" })
	.inputValidator((data: DeleteUnionLinkInput) => data)
	.handler(async ({ data }) => {
		const id = requiredNonEmpty(data.id, "id");
		const result = await execute(
			`DELETE FROM tanahpedia_person_union WHERE id = ?`,
			[id],
		);
		assertAffected(result, `Union link not found: ${id}`);

		return { id };
	});

export const createPersonName = createServerFn({ method: "POST" })
	.inputValidator((data: CreatePersonNameInput) => data)
	.handler(async ({ data }) => {
		const personId = requiredNonEmpty(data.personId, "personId");
		const name = requiredNonEmpty(data.name, "name");
		const nameType = data.nameType.trim().toUpperCase();
		if (!isOneOf(nameType, FAMILY_NAME_TYPES)) {
			throw new Error("Invalid nameType");
		}
		if (data.giverPersonId && data.isGodGiven) {
			throw new Error("giverPersonId and isGodGiven are mutually exclusive");
		}

		const nameTypeId = await getNameTypeIdByName(nameType);
		const id = randomUUID();
		await execute(
			`INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id, alt_group_id)
			 VALUES (?, ?, ?, ?, ?)`,
			[id, personId, name, nameTypeId, data.altGroupId ?? null],
		);

		if (data.giverPersonId) {
			await execute(
				`INSERT INTO tanahpedia_person_name_giver_person (id, person_name_id, giver_person_id, alt_group_id)
				 VALUES (?, ?, ?, NULL)`,
				[randomUUID(), id, data.giverPersonId],
			);
		}
		if (data.isGodGiven) {
			const godId = await getGodId();
			await execute(
				`INSERT INTO tanahpedia_person_name_giver_god (id, person_name_id, god_id, alt_group_id)
				 VALUES (?, ?, ?, NULL)`,
				[randomUUID(), id, godId],
			);
		}

		return { id };
	});

export const updatePersonName = createServerFn({ method: "POST" })
	.inputValidator((data: UpdatePersonNameInput) => data)
	.handler(async ({ data }) => {
		const id = requiredNonEmpty(data.id, "id");

		const sets: string[] = [];
		const params: unknown[] = [];

		if (data.name !== undefined) {
			sets.push("name = ?");
			params.push(requiredNonEmpty(data.name, "name"));
		}

		if (data.nameType !== undefined) {
			const nameType = data.nameType.trim().toUpperCase();
			if (!isOneOf(nameType, FAMILY_NAME_TYPES)) {
				throw new Error("Invalid nameType");
			}
			const nameTypeId = await getNameTypeIdByName(nameType);
			sets.push("name_type_id = ?");
			params.push(nameTypeId);
		}

		if (data.altGroupId !== undefined) {
			sets.push("alt_group_id = ?");
			params.push(data.altGroupId);
		}

		if (
			sets.length === 0 &&
			data.giverPersonId === undefined &&
			data.isGodGiven === undefined
		) {
			throw new Error("At least one field must be provided to update");
		}

		if (sets.length > 0) {
			params.push(id);
			const result = await execute(
				`UPDATE tanahpedia_person_name SET ${sets.join(", ")} WHERE id = ?`,
				params,
			);
			assertAffected(result, `Person name not found: ${id}`);
		} else {
			const existing = await queryOne<{ id: string }>(
				`SELECT id FROM tanahpedia_person_name WHERE id = ? LIMIT 1`,
				[id],
			);
			if (!existing) throw new Error(`Person name not found: ${id}`);
		}

		if (data.giverPersonId !== undefined) {
			await execute(
				`DELETE FROM tanahpedia_person_name_giver_person WHERE person_name_id = ?`,
				[id],
			);
			if (data.giverPersonId !== null) {
				await execute(
					`INSERT INTO tanahpedia_person_name_giver_person (id, person_name_id, giver_person_id, alt_group_id)
					 VALUES (?, ?, ?, NULL)`,
					[randomUUID(), id, data.giverPersonId],
				);
			}
		}

		if (data.isGodGiven !== undefined) {
			await execute(
				`DELETE FROM tanahpedia_person_name_giver_god WHERE person_name_id = ?`,
				[id],
			);
			if (data.isGodGiven) {
				const godId = await getGodId();
				await execute(
					`INSERT INTO tanahpedia_person_name_giver_god (id, person_name_id, god_id, alt_group_id)
					 VALUES (?, ?, ?, NULL)`,
					[randomUUID(), id, godId],
				);
			}
		}

		return { id };
	});

export const deletePersonName = createServerFn({ method: "POST" })
	.inputValidator((data: DeletePersonNameInput) => data)
	.handler(async ({ data }) => {
		const id = requiredNonEmpty(data.id, "id");
		const result = await execute(
			`DELETE FROM tanahpedia_person_name WHERE id = ?`,
			[id],
		);
		assertAffected(result, `Person name not found: ${id}`);

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
