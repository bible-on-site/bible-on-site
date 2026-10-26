import { createServerFn } from "@tanstack/react-start";
import {
	CATEGORY_LABELS,
	type CategoryKey,
	ENTITY_TYPES,
	type EntityType,
} from "~/lib/tanahpedia/labels";
import type { EntryRevisionRow } from "~/lib/tanahpedia/revisions-shared";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQueryOne,
} from "../db";
import { recomputeEntryMetrics } from "../reading-metrics";
import {
	pediaEntryPath,
	pediaInvalidation,
	revalidateWebsite,
} from "../website-revalidate";
import { loadTanahpediaEntryById } from "./entry-loader.server";
import { pediaInvalidationForEntryIds } from "./paths";
import {
	assertEntryFieldsValid,
	saveEntryRevisioned,
	translateEntryWriteError,
} from "./revisions";

const ANIMAL_KIND_KEYS = ["BEHEMA", "CHAYA", "OF", "SHERETZ"] as const;
const ANIMAL_PURITY_KEYS = ["TAHOR", "TAMEH"] as const;
const PERSON_ROLE_KEYS = ["PROPHET", "KING"] as const;

function isCategoryKey(s: string): s is CategoryKey {
	return Object.hasOwn(CATEGORY_LABELS, s);
}

export interface TanahpediaEntry {
	id: string;
	unique_name: string;
	title: string;
	content: string | null;
	created_at: string;
	updated_at: string;
}

export interface TanahpediaEntryEntity {
	id: string;
	entry_id: string;
	entity_id: string;
	entity_type: EntityType;
}

export type TanahpediaEntryListItem = Omit<TanahpediaEntry, "content">;

export const getEntries = createServerFn({ method: "GET" }).handler(
	async () => {
		return await query<TanahpediaEntryListItem>(
			"SELECT id, unique_name, title, created_at, updated_at FROM tanahpedia_entry ORDER BY title",
		);
	},
);

/**
 * Filter entries by website category (entity type or subcategory) and/or search
 * (title / unique_name). Mirrors public tanahpedia category resolution.
 */
export const listTanahpediaEntriesForAdmin = createServerFn({ method: "POST" })
	.validator(
		(data: { category?: string; q?: string } | undefined) => data ?? {},
	)
	.handler(async ({ data }) => {
		const q = data.q?.trim();
		const needle = q ? `%${q}%` : null;
		const limit = needle ? 300 : 500;
		const searchSql = needle
			? " AND (ent.title LIKE ? OR ent.unique_name LIKE ?)"
			: "";
		const searchParams: unknown[] = needle ? [needle, needle] : [];

		const raw = data.category?.trim().toUpperCase() ?? "";
		const category = raw && isCategoryKey(raw) ? raw : undefined;

		if (!category) {
			if (needle) {
				return await query<TanahpediaEntryListItem>(
					`SELECT id, unique_name, title, created_at, updated_at FROM tanahpedia_entry
					 WHERE title LIKE ? OR unique_name LIKE ?
					 ORDER BY title
					 LIMIT ${limit}`,
					[needle, needle],
				);
			}
			return await query<TanahpediaEntryListItem>(
				`SELECT id, unique_name, title, created_at, updated_at FROM tanahpedia_entry
				 ORDER BY title
				 LIMIT ${limit}`,
			);
		}

		if (
			PERSON_ROLE_KEYS.includes(category as (typeof PERSON_ROLE_KEYS)[number])
		) {
			const roleTable =
				category === "PROPHET"
					? "tanahpedia_person_role_prophet"
					: "tanahpedia_person_role_king";
			return await query<TanahpediaEntryListItem>(
				`SELECT DISTINCT ent.id, ent.unique_name, ent.title, ent.created_at, ent.updated_at
				 FROM tanahpedia_entry ent
				 INNER JOIN tanahpedia_entry_entity ee ON ee.entry_id = ent.id
				 INNER JOIN tanahpedia_entity e ON e.id = ee.entity_id
				 INNER JOIN tanahpedia_person p ON p.entity_id = e.id
				 INNER JOIN ${roleTable} r ON r.person_id = p.id
				 WHERE 1=1${searchSql}
				 ORDER BY ent.title
				 LIMIT ${limit}`,
				searchParams,
			);
		}

		if (
			ANIMAL_KIND_KEYS.includes(category as (typeof ANIMAL_KIND_KEYS)[number])
		) {
			return await query<TanahpediaEntryListItem>(
				`SELECT DISTINCT ent.id, ent.unique_name, ent.title, ent.created_at, ent.updated_at
				 FROM tanahpedia_entry ent
				 INNER JOIN tanahpedia_entry_entity ee ON ee.entry_id = ent.id
				 INNER JOIN tanahpedia_entity e ON e.id = ee.entity_id
				 INNER JOIN tanahpedia_animal a ON a.entity_id = e.id
				 INNER JOIN tanahpedia_animal_kind ak ON ak.animal_id = a.id AND ak.kind = ?
				 WHERE 1=1${searchSql}
				 ORDER BY ent.title
				 LIMIT ${limit}`,
				[category, ...searchParams],
			);
		}

		if (
			ANIMAL_PURITY_KEYS.includes(
				category as (typeof ANIMAL_PURITY_KEYS)[number],
			)
		) {
			return await query<TanahpediaEntryListItem>(
				`SELECT DISTINCT ent.id, ent.unique_name, ent.title, ent.created_at, ent.updated_at
				 FROM tanahpedia_entry ent
				 INNER JOIN tanahpedia_entry_entity ee ON ee.entry_id = ent.id
				 INNER JOIN tanahpedia_entity e ON e.id = ee.entity_id
				 INNER JOIN tanahpedia_animal a ON a.entity_id = e.id
				 INNER JOIN tanahpedia_animal_purity ap ON ap.animal_id = a.id AND ap.purity = ?
				 WHERE 1=1${searchSql}
				 ORDER BY ent.title
				 LIMIT ${limit}`,
				[category, ...searchParams],
			);
		}

		if (ENTITY_TYPES.includes(category as EntityType)) {
			return await query<TanahpediaEntryListItem>(
				`SELECT DISTINCT ent.id, ent.unique_name, ent.title, ent.created_at, ent.updated_at
				 FROM tanahpedia_entry ent
				 INNER JOIN tanahpedia_entry_entity ee ON ee.entry_id = ent.id
				 INNER JOIN tanahpedia_entity e ON e.id = ee.entity_id
				 WHERE e.entity_type = ?${searchSql}
				 ORDER BY ent.title
				 LIMIT ${limit}`,
				[category, ...searchParams],
			);
		}

		return await query<TanahpediaEntryListItem>(
			`SELECT id, unique_name, title, created_at, updated_at FROM tanahpedia_entry
			 ORDER BY title
			 LIMIT ${limit}`,
		);
	});

/** Category counts for admin UI (same logic as public site). */
export const getTanahpediaCategoryCounts = createServerFn({
	method: "GET",
}).handler(async () => {
	const [entityRows, roleRows, animalRows] = await Promise.all([
		query<{ entityType: EntityType; cnt: number }>(
			`SELECT e.entity_type AS entityType, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_entry_entity ee
			 JOIN tanahpedia_entity e ON e.id = ee.entity_id
			 GROUP BY e.entity_type`,
		),
		query<{ role: string; cnt: number }>(
			`SELECT 'PROPHET' AS role, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_person_role_prophet pr
			 JOIN tanahpedia_person p ON p.id = pr.person_id
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = p.entity_id
			 UNION ALL
			 SELECT 'KING' AS role, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_person_role_king pk
			 JOIN tanahpedia_person p ON p.id = pk.person_id
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = p.entity_id`,
		),
		query<{ cat: string; cnt: number }>(
			`SELECT ak.kind AS cat, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_animal_kind ak
			 JOIN tanahpedia_animal a ON a.id = ak.animal_id
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = a.entity_id
			 GROUP BY ak.kind
			 UNION ALL
			 SELECT ap.purity AS cat, COUNT(DISTINCT ee.entry_id) AS cnt
			 FROM tanahpedia_animal_purity ap
			 JOIN tanahpedia_animal a ON a.id = ap.animal_id
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = a.entity_id
			 GROUP BY ap.purity`,
		),
	]);

	const counts = {} as Record<CategoryKey, number>;
	for (const t of ENTITY_TYPES) counts[t] = 0;
	counts.PROPHET = 0;
	counts.KING = 0;
	counts.BEHEMA = 0;
	counts.CHAYA = 0;
	counts.OF = 0;
	counts.SHERETZ = 0;
	counts.TAHOR = 0;
	counts.TAMEH = 0;

	for (const row of entityRows) counts[row.entityType] = Number(row.cnt);
	for (const row of roleRows) counts[row.role as CategoryKey] = Number(row.cnt);
	for (const row of animalRows)
		counts[row.cat as CategoryKey] = Number(row.cnt);

	return { counts, labels: CATEGORY_LABELS };
});

export const getEntry = createServerFn({ method: "GET" })
	.validator((data: string) => data)
	.handler(async ({ data: id }) => {
		const entry = await loadTanahpediaEntryById(id);
		if (!entry) throw new Error("Entry not found");
		// Head is resolved topologically — the APPLIED row no APPLIED child
		// bases on — because second-resolution created_at plus random UUIDs
		// cannot order two commits made within the same second.
		const head = await queryOne<Pick<EntryRevisionRow, "id">>(
			`SELECT id FROM tanahpedia_entry_revision
			 WHERE entry_id = ? AND status = 'APPLIED'
			 AND NOT EXISTS (
				 SELECT 1 FROM tanahpedia_entry_revision c
				 WHERE c.entry_id = ? AND c.status = 'APPLIED'
				   AND c.base_revision_id = tanahpedia_entry_revision.id
			 )
			 ORDER BY created_at DESC, id DESC
			 LIMIT 1`,
			[id, id],
		);
		return { ...entry, currentRevisionId: head?.id ?? null };
	});

export const createEntry = createServerFn({ method: "POST" })
	.validator(
		(data: {
			id: string;
			unique_name: string;
			title: string;
			content: string;
			source?: string;
			notes?: string | null;
		}) => data,
	)
	.handler(async ({ data }) => {
		assertEntryFieldsValid(data);
		const created = await transaction(async (conn) => {
			const headId = crypto.randomUUID();
			try {
				await txExecute(
					conn,
					"INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (?, ?, ?, ?)",
					[data.id, data.unique_name, data.title, data.content || null],
				);
				await txExecute(
					conn,
					`INSERT INTO tanahpedia_entry_revision
					 (id, entry_id, proposed_unique_name, proposed_title, proposed_content,
					  source, notes, status, base_revision_id)
					 VALUES (?, ?, ?, ?, ?, ?, ?, 'APPLIED', NULL)`,
					[
						headId,
						data.id,
						data.unique_name,
						data.title,
						data.content || null,
						data.source?.trim() || "admin",
						data.notes?.trim() || null,
					],
				);
			} catch (err) {
				throw translateEntryWriteError(err);
			}
			const entry = await txQueryOne<TanahpediaEntry>(
				conn,
				"SELECT id, unique_name, title, content, created_at, updated_at FROM tanahpedia_entry WHERE id = ?",
				[data.id],
			);
			if (!entry) throw new Error("Entry not found");
			// Same-transaction reading metrics (#2607).
			await recomputeEntryMetrics(conn, data.id, entry.content);
			return { ...entry, headRevisionId: headId };
		});
		await revalidateWebsite(
			pediaInvalidation(pediaEntryPath(created.unique_name)),
		);
		return created;
	});

export const updateEntry = createServerFn({ method: "POST" })
	.validator(
		(data: {
			id: string;
			unique_name: string;
			title: string;
			content: string;
			baseRevisionId?: string | null;
			source?: string;
			notes?: string | null;
		}) => data,
	)
	.handler(async ({ data }) => {
		assertEntryFieldsValid(data);
		const updated = await transaction(async (conn) => {
			const { entry, headRevisionId, unchanged, previousUniqueName } =
				await saveEntryRevisioned(conn, data);
			return { ...entry, headRevisionId, unchanged, previousUniqueName };
		});
		// A no-op save changes no public content, so nothing expires.
		if (!updated.unchanged) {
			// A rename leaves the old URL stale — notify both.
			const urls = new Set([pediaEntryPath(updated.unique_name)]);
			if (updated.previousUniqueName) {
				urls.add(pediaEntryPath(updated.previousUniqueName));
			}
			await revalidateWebsite(pediaInvalidation(...urls));
		}
		// previousUniqueName is notification bookkeeping, not part of the
		// handler's public result.
		const { previousUniqueName, ...result } = updated;
		return result;
	});

export const deleteEntry = createServerFn({ method: "POST" })
	.validator((data: string) => data)
	.handler(async ({ data: id }) => {
		// Resolve the public URL before the delete — the row is gone after.
		const previous = await queryOne<{ unique_name: string }>(
			"SELECT unique_name FROM tanahpedia_entry WHERE id = ?",
			[id],
		);
		await execute("DELETE FROM tanahpedia_entry WHERE id = ?", [id]);
		await revalidateWebsite(
			pediaInvalidation(
				...(previous ? [pediaEntryPath(previous.unique_name)] : []),
			),
		);
		return { success: true };
	});

export const getEntryEntities = createServerFn({ method: "GET" })
	.validator((data: string) => data)
	.handler(async ({ data: entryId }) => {
		return await query<TanahpediaEntryEntity>(
			`SELECT ee.id, ee.entry_id, ee.entity_id, e.entity_type AS entity_type
			 FROM tanahpedia_entry_entity ee
			 JOIN tanahpedia_entity e ON e.id = ee.entity_id
			 WHERE ee.entry_id = ?`,
			[entryId],
		);
	});

export const assignEntity = createServerFn({ method: "POST" })
	.validator(
		(data: { id: string; entry_id: string; entity_id: string }) => data,
	)
	.handler(async ({ data }) => {
		await execute(
			"INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id) VALUES (?, ?, ?)",
			[data.id, data.entry_id, data.entity_id],
		);
		await revalidateWebsite(
			await pediaInvalidationForEntryIds([data.entry_id]),
		);
		return { success: true };
	});

export const removeEntity = createServerFn({ method: "POST" })
	.validator((data: string) => data)
	.handler(async ({ data: id }) => {
		// The link row is deleted below — find the affected entry first.
		const link = await queryOne<{ entry_id: string }>(
			"SELECT entry_id FROM tanahpedia_entry_entity WHERE id = ?",
			[id],
		);
		await execute("DELETE FROM tanahpedia_entry_entity WHERE id = ?", [id]);
		await revalidateWebsite(
			await pediaInvalidationForEntryIds(link ? [link.entry_id] : []),
		);
		return { success: true };
	});
