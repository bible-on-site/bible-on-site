import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import type mysql from "mysql2/promise";
import { VALIDATION_PREFIX } from "~/lib/server-fn-errors";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQueryOne,
} from "../db";
import { revalidateWebsite } from "../website-revalidate";
import { pediaChangesForEntities, pediaChangesForEntryIds } from "./paths";
import { isMissingMysqlSchema } from "./sql-helpers";

/**
 * Admin management of Tanahpedia image galleries (#3769).
 *
 * `tanahpedia_image` stores the asset (URL + attribution/provenance) once;
 * `tanahpedia_entry_image` and `tanahpedia_entity_image` attach it to an
 * entry and/or an entity with a per-link `sort_order` and `is_primary` flag.
 * The generated `primary_owner` unique index enforces at most one primary
 * link per owner — setting a link primary clears the siblings inside the
 * same transaction.
 *
 * The entry page panel edits both scopes: the entry's own links plus the
 * links of every entity attached to the entry (the public entry gallery
 * renders both, mirroring `get_entity_images_for_entry` in the API).
 *
 * Every write commits and then notifies the website through the shared
 * revalidation lifecycle (`pedia-entry`/`pedia-entity` changes).
 */

export type ImageOwnerKind = "ENTRY" | "ENTITY";

export interface PediaImageAssetView {
	imageId: string;
	url: string;
	width: number | null;
	height: number | null;
	altText: string;
	caption: string | null;
	creator: string | null;
	creditLine: string | null;
	sourceName: string | null;
	sourceUrl: string | null;
	licenseName: string | null;
	licenseUrl: string | null;
	isPublicDomain: boolean;
	modifications: string | null;
	permissionEvidence: string | null;
	isPublic: boolean;
}

export interface PediaImageLinkView {
	id: string;
	ownerKind: ImageOwnerKind;
	ownerId: string;
	sortOrder: number;
	isPrimary: boolean;
	image: PediaImageAssetView;
}

export interface EntityImageGroup {
	entityId: string;
	entityType: string;
	entityName: string;
	links: PediaImageLinkView[];
}

export interface EntryImageBundle {
	entryLinks: PediaImageLinkView[];
	entityGroups: EntityImageGroup[];
}

export interface PediaImageAssetInput {
	/** null → create a fresh asset id; otherwise update that row. */
	id?: string | null;
	url: string;
	width?: number | null;
	height?: number | null;
	altText: string;
	caption?: string | null;
	creator?: string | null;
	creditLine?: string | null;
	sourceName?: string | null;
	sourceUrl?: string | null;
	licenseName?: string | null;
	licenseUrl?: string | null;
	isPublicDomain?: boolean | null;
	modifications?: string | null;
	permissionEvidence?: string | null;
	isPublic?: boolean | null;
}

export interface PediaImageLinkInput {
	/** null → attach `imageId` to the owner; otherwise update that link. */
	id?: string | null;
	ownerKind: ImageOwnerKind;
	ownerId: string;
	imageId?: string | null;
	sortOrder?: number | null;
	isPrimary?: boolean | null;
}

interface AssetRow {
	imageId: string;
	url: string;
	width: number | null;
	height: number | null;
	altText: string;
	caption: string | null;
	creator: string | null;
	creditLine: string | null;
	sourceName: string | null;
	sourceUrl: string | null;
	licenseName: string | null;
	licenseUrl: string | null;
	isPublicDomain: number;
	modifications: string | null;
	permissionEvidence: string | null;
	isPublic: number;
}

interface LinkRow extends AssetRow {
	id: string;
	ownerId: string;
	sortOrder: number;
	isPrimary: number;
}

const OWNER_SPEC: Record<ImageOwnerKind, { table: string; column: string }> = {
	ENTRY: { table: "tanahpedia_entry_image", column: "entry_id" },
	ENTITY: { table: "tanahpedia_entity_image", column: "entity_id" },
};

const ASSET_COLUMNS = `i.id AS imageId, i.url AS url, i.width AS width,
	i.height AS height, i.alt_text AS altText, i.caption AS caption,
	i.creator AS creator, i.credit_line AS creditLine, i.source_name AS sourceName,
	i.source_url AS sourceUrl, i.license_name AS licenseName,
	i.license_url AS licenseUrl, i.is_public_domain AS isPublicDomain,
	i.modifications AS modifications, i.permission_evidence AS permissionEvidence,
	i.is_public AS isPublic`;

function linkSelect(table: string, ownerColumn: string): string {
	return `SELECT l.id AS id, l.${ownerColumn} AS ownerId, l.sort_order AS sortOrder,
		l.is_primary AS isPrimary, ${ASSET_COLUMNS}
	 FROM ${table} l JOIN tanahpedia_image i ON i.id = l.image_id`;
}

function rowToAsset(row: AssetRow): PediaImageAssetView {
	return {
		imageId: row.imageId,
		url: row.url,
		width: row.width,
		height: row.height,
		altText: row.altText,
		caption: row.caption,
		creator: row.creator,
		creditLine: row.creditLine,
		sourceName: row.sourceName,
		sourceUrl: row.sourceUrl,
		licenseName: row.licenseName,
		licenseUrl: row.licenseUrl,
		isPublicDomain: Number(row.isPublicDomain) === 1,
		modifications: row.modifications,
		permissionEvidence: row.permissionEvidence,
		isPublic: Number(row.isPublic) === 1,
	};
}

function rowToLink(
	row: LinkRow,
	ownerKind: ImageOwnerKind,
): PediaImageLinkView {
	return {
		id: row.id,
		ownerKind,
		ownerId: row.ownerId,
		sortOrder: row.sortOrder,
		isPrimary: Number(row.isPrimary) === 1,
		image: rowToAsset(row),
	};
}

async function linkRows(
	ownerKind: ImageOwnerKind,
	ownerId: string,
): Promise<PediaImageLinkView[]> {
	const { table, column } = OWNER_SPEC[ownerKind];
	const rows = await query<LinkRow>(
		`${linkSelect(table, column)}
		 WHERE l.${column} = ? ORDER BY l.sort_order, l.id`,
		[ownerId],
	);
	return rows.map((row) => rowToLink(row, ownerKind));
}

function blankToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

function validationError(message: string): Error {
	return new Error(`${VALIDATION_PREFIX}: ${message}`);
}

/** The entry/entity rows an asset's edits or deletion must revalidate. */
async function assetOwners(imageId: string): Promise<{
	entryIds: string[];
	entityIds: string[];
}> {
	const [entries, entities] = await Promise.all([
		query<{ entry_id: string }>(
			"SELECT entry_id FROM tanahpedia_entry_image WHERE image_id = ?",
			[imageId],
		),
		query<{ entity_id: string }>(
			"SELECT entity_id FROM tanahpedia_entity_image WHERE image_id = ?",
			[imageId],
		),
	]);
	return {
		entryIds: entries.map((row) => row.entry_id),
		entityIds: entities.map((row) => row.entity_id),
	};
}

/** The entry + entity groups the panel renders for one entry. Reads degrade
 * to an empty bundle while the image tables are pending deploy. */
export const getEntryImageBundle = createServerFn({ method: "GET" })
	.validator((data: string) => data)
	.handler(async ({ data: entryId }): Promise<EntryImageBundle> => {
		try {
			// Every entity linked to the entry gets a group — image rows join in,
			// so an entity with no links still offers "הוסף תמונה".
			const [entryLinks, entities, entityRows] = await Promise.all([
				linkRows("ENTRY", entryId),
				query<{ entityId: string; entityType: string; entityName: string }>(
					`SELECT en.id AS entityId, en.entity_type AS entityType,
						en.name AS entityName
					 FROM tanahpedia_entry_entity ee
					 JOIN tanahpedia_entity en ON en.id = ee.entity_id
					 WHERE ee.entry_id = ? ORDER BY en.name`,
					[entryId],
				),
				query<LinkRow & { entityType: string; entityName: string }>(
					`SELECT l.id AS id, l.entity_id AS ownerId, l.sort_order AS sortOrder,
						l.is_primary AS isPrimary, en.entity_type AS entityType,
						en.name AS entityName, ${ASSET_COLUMNS}
					 FROM tanahpedia_entity_image l
					 JOIN tanahpedia_image i ON i.id = l.image_id
					 JOIN tanahpedia_entry_entity ee ON ee.entity_id = l.entity_id
					 JOIN tanahpedia_entity en ON en.id = l.entity_id
					 WHERE ee.entry_id = ?
					 ORDER BY l.entity_id, l.sort_order, l.id`,
					[entryId],
				),
			]);
			const groups = new Map<string, EntityImageGroup>(
				entities.map((entity) => [
					entity.entityId,
					{
						entityId: entity.entityId,
						entityType: entity.entityType,
						entityName: entity.entityName,
						links: [],
					},
				]),
			);
			for (const row of entityRows) {
				groups.get(row.ownerId)?.links.push(rowToLink(row, "ENTITY"));
			}
			return { entryLinks, entityGroups: [...groups.values()] };
		} catch (error) {
			if (isMissingMysqlSchema(error)) {
				return { entryLinks: [], entityGroups: [] };
			}
			throw error;
		}
	});

export const putImageAsset = createServerFn({ method: "POST" })
	.validator((data: PediaImageAssetInput) => data)
	.handler(async ({ data }): Promise<PediaImageAssetView> => {
		const url = data.url?.trim() ?? "";
		if (!url) throw validationError("כתובת התמונה חייבת להיות מלאה");
		const altText = data.altText?.trim() ?? "";
		if (!altText) throw validationError("טקסט חלופי (alt) חייב להיות מלא");
		const isPublic = data.isPublic === true;
		const permissionEvidence = blankToNull(data.permissionEvidence);
		if (isPublic && !permissionEvidence) {
			throw validationError(
				"יש לתעד ראיות רשות או נחלת הכלל לפני פרסום התמונה",
			);
		}

		const id = data.id?.trim() || randomUUID();
		const existing = data.id?.trim()
			? await queryOne<{ id: string }>(
					"SELECT id FROM tanahpedia_image WHERE id = ?",
					[id],
				)
			: null;
		if (data.id?.trim() && !existing) {
			throw validationError("התמונה לא נמצאה");
		}

		const fields: [string, unknown][] = [
			["url", url],
			["width", data.width ?? null],
			["height", data.height ?? null],
			["alt_text", altText],
			["caption", blankToNull(data.caption)],
			["creator", blankToNull(data.creator)],
			["credit_line", blankToNull(data.creditLine)],
			["source_name", blankToNull(data.sourceName)],
			["source_url", blankToNull(data.sourceUrl)],
			["license_name", blankToNull(data.licenseName)],
			["license_url", blankToNull(data.licenseUrl)],
			["is_public_domain", data.isPublicDomain === true ? 1 : 0],
			["modifications", blankToNull(data.modifications)],
			["permission_evidence", permissionEvidence],
			["is_public", isPublic ? 1 : 0],
		];
		if (existing) {
			const assignments = fields.map(([column]) => `${column} = ?`).join(", ");
			await execute(`UPDATE tanahpedia_image SET ${assignments} WHERE id = ?`, [
				...fields.map(([, v]) => v),
				id,
			]);
		} else {
			const columns = fields.map(([column]) => column).join(", ");
			const ph = fields.map(() => "?").join(", ");
			await execute(
				`INSERT INTO tanahpedia_image (id, ${columns}) VALUES (?, ${ph})`,
				[id, ...fields.map(([, v]) => v)],
			);
		}

		// Credit/provenance changes surface wherever the asset renders.
		const owners = await assetOwners(id);
		await revalidateWebsite([
			...(await pediaChangesForEntryIds(owners.entryIds)),
			...(await pediaChangesForEntities(owners.entityIds)),
		]);

		const row = await queryOne<AssetRow>(
			`SELECT ${ASSET_COLUMNS} FROM tanahpedia_image i WHERE i.id = ?`,
			[id],
		);
		if (!row) throw new Error("Image asset disappeared after write");
		return rowToAsset(row);
	});

export const deleteImageAsset = createServerFn({ method: "POST" })
	.validator((data: string) => data)
	.handler(async ({ data: imageId }): Promise<{ deleted: boolean }> => {
		// Resolve the revalidation surface before the cascade removes the links.
		const owners = await assetOwners(imageId);
		const result = await execute("DELETE FROM tanahpedia_image WHERE id = ?", [
			imageId,
		]);
		if (result.affectedRows > 0) {
			await revalidateWebsite([
				...(await pediaChangesForEntryIds(owners.entryIds)),
				...(await pediaChangesForEntities(owners.entityIds)),
			]);
		}
		return { deleted: result.affectedRows > 0 };
	});

async function assertOwnerExists(
	conn: mysql.PoolConnection,
	ownerKind: ImageOwnerKind,
	ownerId: string,
): Promise<void> {
	const table =
		ownerKind === "ENTRY" ? "tanahpedia_entry" : "tanahpedia_entity";
	const found = await txQueryOne<{ id: string }>(
		conn,
		`SELECT id FROM ${table} WHERE id = ?`,
		[ownerId],
	);
	if (!found) {
		throw validationError(
			ownerKind === "ENTRY" ? "הערך לא נמצא" : "הישות לא נמצאה",
		);
	}
}

export const putImageLink = createServerFn({ method: "POST" })
	.validator((data: PediaImageLinkInput) => data)
	.handler(async ({ data }): Promise<PediaImageLinkView> => {
		const { table, column } = OWNER_SPEC[data.ownerKind];
		const ownerId = data.ownerId?.trim() ?? "";
		if (!ownerId) {
			throw validationError(
				data.ownerKind === "ENTRY"
					? "ערך חייב להיות מלא"
					: "ישות חייבת להיות מלאה",
			);
		}
		const linkId = data.id?.trim() || null;
		const imageId = data.imageId?.trim() ?? "";
		if (!linkId && !imageId) {
			throw validationError("תמונה חייבת להיות מלאה");
		}

		const effectiveId = await transaction(async (conn) => {
			await assertOwnerExists(conn, data.ownerKind, ownerId);
			if (!linkId) {
				const image = await txQueryOne<{ id: string }>(
					conn,
					"SELECT id FROM tanahpedia_image WHERE id = ?",
					[imageId],
				);
				if (!image) throw validationError("התמונה לא נמצאה");
			}

			// Clear the incumbent primary before the target row becomes primary:
			// the generated unique index rejects even a transient second primary,
			// and the transaction rolls the clear back if the write itself fails.
			const effectiveId = linkId ?? randomUUID();
			if (data.isPrimary === true) {
				await txExecute(
					conn,
					`UPDATE ${table} SET is_primary = 0 WHERE ${column} = ? AND id <> ?`,
					[ownerId, effectiveId],
				);
			}

			if (linkId) {
				const updated = await txExecute(
					conn,
					`UPDATE ${table} SET sort_order = COALESCE(?, sort_order),
					 is_primary = COALESCE(?, is_primary) WHERE id = ? AND ${column} = ?`,
					[data.sortOrder ?? null, data.isPrimary ?? null, linkId, ownerId],
				);
				if (updated.affectedRows === 0) {
					throw validationError("הקישור לתמונה לא נמצא");
				}
			} else {
				const next =
					data.sortOrder ??
					(
						await txQueryOne<{ next: number }>(
							conn,
							`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ${table} WHERE ${column} = ?`,
							[ownerId],
						)
					)?.next ??
					0;
				await txExecute(
					conn,
					`INSERT INTO ${table} (id, ${column}, image_id, sort_order, is_primary)
					 VALUES (?, ?, ?, ?, ?)`,
					[effectiveId, ownerId, imageId, next, data.isPrimary === true ? 1 : 0],
				);
			}
			return effectiveId;
		});

		await revalidateWebsite(
			data.ownerKind === "ENTRY"
				? await pediaChangesForEntryIds([ownerId])
				: await pediaChangesForEntities([ownerId]),
		);

		const link = (await linkRows(data.ownerKind, ownerId)).find(
			(row) => row.id === effectiveId,
		);
		if (!link) throw new Error("Image link disappeared after write");
		return link;
	});

export const removeImageLink = createServerFn({ method: "POST" })
	.validator((data: { ownerKind: ImageOwnerKind; id: string }) => data)
	.handler(async ({ data }): Promise<{ removed: boolean }> => {
		const { table, column } = OWNER_SPEC[data.ownerKind];
		const owner = await queryOne<{ ownerId: string }>(
			`SELECT ${column} AS ownerId FROM ${table} WHERE id = ?`,
			[data.id],
		);
		const result = await execute(`DELETE FROM ${table} WHERE id = ?`, [
			data.id,
		]);
		if (result.affectedRows > 0 && owner) {
			await revalidateWebsite(
				data.ownerKind === "ENTRY"
					? await pediaChangesForEntryIds([owner.ownerId])
					: await pediaChangesForEntities([owner.ownerId]),
			);
		}
		return { removed: result.affectedRows > 0 };
	});

export const clearPrimaryImage = createServerFn({ method: "POST" })
	.validator((data: { ownerKind: ImageOwnerKind; ownerId: string }) => data)
	.handler(async ({ data }): Promise<{ cleared: boolean }> => {
		const { table, column } = OWNER_SPEC[data.ownerKind];
		const result = await execute(
			`UPDATE ${table} SET is_primary = 0 WHERE ${column} = ?`,
			[data.ownerId],
		);
		if (result.affectedRows > 0) {
			await revalidateWebsite(
				data.ownerKind === "ENTRY"
					? await pediaChangesForEntryIds([data.ownerId])
					: await pediaChangesForEntities([data.ownerId]),
			);
		}
		return { cleared: result.affectedRows > 0 };
	});
