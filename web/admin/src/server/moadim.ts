import { createServerFn } from "@tanstack/react-start";
import type mysql from "mysql2/promise";
import { query, queryOne, transaction, txExecute, txQuery } from "./db";
import { isMoedSchemaMissing } from "./moadim-links.server";
import { moedChange, revalidateWebsite } from "./website-revalidate";

/**
 * מועדים על הפרק management (#3101): the catalogue list/editor reads and the
 * transactional upsert/delete the moed form uses. Everything degrades
 * gracefully while the moed schema is not deployed — reads return
 * `undefined`-shaped "unavailable" state instead of errors, exactly like
 * the covering-source schema conventions.
 *
 * Client-safety contract: this module is importable from routes, so every
 * top-level export must be a `createServerFn` stub or a pure function.
 * Plain db helpers (the article↔moed link set) live in
 * moadim-links.server.ts — a surviving export that touches ./db would ship
 * mysql2 into the browser bundle and crash at module init.
 */

/** One moed row in the admin list. */
export interface AdminMoed {
	id: number;
	slug: string;
	name: string;
	summary: string | null;
	hebrewMonth: string | null;
	dateLabel: string | null;
	annualOrder: number;
	published: boolean;
	sectionCount: number;
	rangeCount: number;
	articleCount: number;
}

/** One inclusive canonical range inside a section. */
export interface MoedRangeInput {
	perekIdStart: number;
	pasukStart: number;
	perekIdEnd: number;
	pasukEnd: number;
}

/** One labelled reading section with its ordered ranges. */
export interface MoedSectionInput {
	label: string;
	ranges: MoedRangeInput[];
}

/** The full moed editor payload. */
export interface AdminMoedDetail {
	id: number;
	slug: string;
	name: string;
	summary: string | null;
	hebrewMonth: string | null;
	dateLabel: string | null;
	annualOrder: number;
	published: boolean;
	sections: (MoedSectionInput & { id: number })[];
	/** Article ids explicitly linked to this moed. */
	articleIds: number[];
}

export interface MoedUpsert {
	name: string;
	slug?: string;
	summary?: string | null;
	hebrewMonth?: string | null;
	dateLabel?: string | null;
	annualOrder: number;
	published: boolean;
	/** Omitted keeps the stored sections; supplied replaces the full set. */
	sections?: MoedSectionInput[];
}

/** Normalizes a slug the same way the API's `normalize_moed_slug` does. */
export function normalizeMoedSlug(raw: string): string {
	const slug = raw
		.replace(/["'׳״]/g, "")
		.split(/\s+/)
		.filter(Boolean)
		.join("-");
	const valid =
		slug.length > 0 &&
		slug.length <= 191 &&
		[...slug].every((c) => c === "-" || /[a-zA-Z0-9֐-׿]/u.test(c)) &&
		!slug.startsWith("-") &&
		!slug.endsWith("-") &&
		!slug.includes("--");
	if (!valid) {
		throw new Error(
			`סלאג מועד לא תקין '${raw}' — אותיות עבריות, ספרות ומקפים בלבד`,
		);
	}
	return slug;
}

/** Validates one range's coordinates against the canonical perek bounds. */
async function assertMoedRangesExist(
	conn: mysql.PoolConnection,
	ranges: MoedRangeInput[],
): Promise<void> {
	const perekIds = [
		...new Set(ranges.flatMap((r) => [r.perekIdStart, r.perekIdEnd])),
	];
	if (perekIds.length === 0) return;
	const placeholders = perekIds.map(() => "?").join(",");
	const bounds = await txQuery<{ id: number; pasuk_count: number | null }>(
		conn,
		`SELECT id, pasuk_count FROM tanah_perek WHERE id IN (${placeholders})`,
		perekIds,
	);
	const byId = new Map(bounds.map((b) => [b.id, b.pasuk_count]));
	for (const perekId of perekIds) {
		const bound = byId.get(perekId);
		if (bound === undefined) {
			throw new Error(`פרק ${perekId} לא קיים`);
		}
		if (bound === null) {
			throw new Error(
				`חסר מספר פסוקים קנוני לפרק ${perekId}; החל את tanah_perek_pasuk_count_data.sql`,
			);
		}
	}
	for (const [index, range] of ranges.entries()) {
		const field = `טווח ${index + 1}`;
		for (const [perekId, pasuk] of [
			[range.perekIdStart, range.pasukStart],
			[range.perekIdEnd, range.pasukEnd],
		] as const) {
			const bound = byId.get(perekId);
			if (
				bound !== undefined &&
				bound !== null &&
				(pasuk < 1 || pasuk > bound)
			) {
				throw new Error(
					`${field}: פסוק ${pasuk} מחוץ לתחום של פרק ${perekId} (1-${bound})`,
				);
			}
		}
		if (
			range.perekIdStart > range.perekIdEnd ||
			(range.perekIdStart === range.perekIdEnd &&
				range.pasukStart > range.pasukEnd)
		) {
			throw new Error(`${field}: נקודת ההתחלה באה אחרי נקודת הסוף`);
		}
	}
}

/** The catalogue for the admin list — all moadim incl. drafts + counts. */
export const listMoadim = createServerFn({ method: "GET" }).handler(
	async (): Promise<AdminMoed[] | undefined> => {
		try {
			const rows = await query<{
				id: number;
				slug: string;
				name: string;
				summary: string | null;
				hebrew_month: string | null;
				date_label: string | null;
				annual_order: number;
				published: number;
				section_count: number;
				range_count: number;
				article_count: number;
			}>(
				`SELECT m.id, m.slug, m.name, m.summary, m.hebrew_month, m.date_label,
				        m.annual_order, m.published,
				        (SELECT COUNT(*) FROM tanah_moed_section s WHERE s.moed_id = m.id) AS section_count,
				        (SELECT COUNT(*) FROM tanah_moed_range r
				         JOIN tanah_moed_section s2 ON s2.id = r.section_id
				         WHERE s2.moed_id = m.id) AS range_count,
				        (SELECT COUNT(*) FROM tanah_article_moed am WHERE am.moed_id = m.id) AS article_count
				 FROM tanah_moed m ORDER BY m.annual_order`,
			);
			return rows.map((row) => ({
				id: row.id,
				slug: row.slug,
				name: row.name,
				summary: row.summary,
				hebrewMonth: row.hebrew_month,
				dateLabel: row.date_label,
				annualOrder: row.annual_order,
				published: row.published !== 0,
				sectionCount: row.section_count,
				rangeCount: row.range_count,
				articleCount: row.article_count,
			}));
		} catch (error) {
			if (!isMoedSchemaMissing(error)) throw error;
			return undefined;
		}
	},
);

/** The full moed editor payload. */
export const getMoed = createServerFn({ method: "GET" })
	.validator((data: number) => data)
	.handler(async ({ data: moedId }): Promise<AdminMoedDetail | null> => {
		const row = await queryOne<{
			id: number;
			slug: string;
			name: string;
			summary: string | null;
			hebrew_month: string | null;
			date_label: string | null;
			annual_order: number;
			published: number;
		}>(
			`SELECT id, slug, name, summary, hebrew_month, date_label, annual_order, published
			 FROM tanah_moed WHERE id = ?`,
			[moedId],
		);
		if (!row) return null;
		const sections = await query<{
			id: number;
			label: string;
			position: number;
		}>(
			"SELECT id, label, position FROM tanah_moed_section WHERE moed_id = ? ORDER BY position",
			[moedId],
		);
		const ranges = sections.length
			? await query<{
					id: number;
					section_id: number;
					position: number;
					perek_id_start: number;
					pasuk_start: number;
					perek_id_end: number;
					pasuk_end: number;
				}>(
					`SELECT r.id, r.section_id, r.position, r.perek_id_start, r.pasuk_start,
					        r.perek_id_end, r.pasuk_end
					 FROM tanah_moed_range r
					 JOIN tanah_moed_section s ON s.id = r.section_id
					 WHERE s.moed_id = ? ORDER BY s.position, r.position`,
					[moedId],
				)
			: [];
		const bySection = new Map<number, typeof ranges>();
		for (const range of ranges) {
			const list = bySection.get(range.section_id) ?? [];
			list.push(range);
			bySection.set(range.section_id, list);
		}
		const articleRows = await query<{ article_id: number }>(
			"SELECT article_id FROM tanah_article_moed WHERE moed_id = ? ORDER BY article_id",
			[moedId],
		);
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			summary: row.summary,
			hebrewMonth: row.hebrew_month,
			dateLabel: row.date_label,
			annualOrder: row.annual_order,
			published: row.published !== 0,
			sections: sections.map((section) => ({
				id: section.id,
				label: section.label,
				ranges: (bySection.get(section.id) ?? []).map((range) => ({
					perekIdStart: range.perek_id_start,
					pasukStart: range.pasuk_start,
					perekIdEnd: range.perek_id_end,
					pasukEnd: range.pasuk_end,
				})),
			})),
			articleIds: articleRows.map((r) => r.article_id),
		};
	});

/** Create/update one moed + optionally its full section set, atomically. */
export const upsertMoed = createServerFn({ method: "POST" })
	.validator((data: { id?: number } & MoedUpsert) => data)
	.handler(async ({ data }) => {
		const slug = normalizeMoedSlug(data.slug?.trim() ? data.slug : data.name);
		if (!data.name.trim()) throw new Error("שם המועד הוא חובה");
		if (data.annualOrder < 1) throw new Error("annualOrder חייב להיות >= 1");
		for (const section of data.sections ?? []) {
			if (!section.label.trim())
				throw new Error("תווית סעיף של מועד לא יכולה להיות ריקה");
			if (section.ranges.length === 0)
				throw new Error(`סעיף '${section.label}' חייב לכלול לפחות טווח אחד`);
		}

		let previousSlug: string | null = null;
		const savedId = await transaction(async (conn) => {
			const conflict = await txQuery<{ id: number; slug: string }>(
				conn,
				"SELECT id, slug FROM tanah_moed WHERE (slug = ? OR annual_order = ?) AND id != ?",
				[slug, data.annualOrder, data.id ?? -1],
			);
			if (conflict.length > 0) {
				throw new Error(
					conflict[0].slug === slug
						? `הסלאג '${slug}' כבר בשימוש במועד ${conflict[0].id}`
						: `annualOrder ${data.annualOrder} כבר בשימוש במועד ${conflict[0].id}`,
				);
			}
			if (data.id !== undefined) {
				const prev = await txQuery<{ slug: string }>(
					conn,
					"SELECT slug FROM tanah_moed WHERE id = ? FOR UPDATE",
					[data.id],
				);
				if (prev.length === 0) throw new Error("Moed not found");
				previousSlug = prev[0].slug;
				await txExecute(
					conn,
					`UPDATE tanah_moed SET slug = ?, name = ?, summary = ?, hebrew_month = ?,
					        date_label = ?, annual_order = ?, published = ? WHERE id = ?`,
					[
						slug,
						data.name.trim(),
						data.summary?.trim() || null,
						data.hebrewMonth || null,
						data.dateLabel || null,
						data.annualOrder,
						data.published === true,
						data.id,
					],
				);
			}
			const moedId =
				data.id ??
				(
					await txExecute(
						conn,
						`INSERT INTO tanah_moed (slug, name, summary, hebrew_month, date_label, annual_order, published)
						 VALUES (?, ?, ?, ?, ?, ?, ?)`,
						[
							slug,
							data.name.trim(),
							data.summary?.trim() || null,
							data.hebrewMonth || null,
							data.dateLabel || null,
							data.annualOrder,
							data.published === true,
						],
					)
				).insertId;

			if (data.sections !== undefined) {
				for (const section of data.sections) {
					await assertMoedRangesExist(conn, section.ranges);
				}
				await txExecute(
					conn,
					"DELETE FROM tanah_moed_section WHERE moed_id = ?",
					[moedId],
				);
				for (const [position, section] of data.sections.entries()) {
					const sectionResult = await txExecute(
						conn,
						"INSERT INTO tanah_moed_section (moed_id, label, position) VALUES (?, ?, ?)",
						[moedId, section.label.trim(), position + 1],
					);
					for (const [rangePosition, range] of section.ranges.entries()) {
						await txExecute(
							conn,
							`INSERT INTO tanah_moed_range
							 (section_id, position, perek_id_start, pasuk_start, perek_id_end, pasuk_end)
							 VALUES (?, ?, ?, ?, ?, ?)`,
							[
								sectionResult.insertId,
								rangePosition + 1,
								range.perekIdStart,
								range.pasukStart,
								range.perekIdEnd,
								range.pasukEnd,
							],
						);
					}
				}
			}
			return moedId;
		});
		// Post-commit: expire the moed's surfaces — renamed slugs expire the
		// old route too (the website resolves the change kind to paths/tags).
		await revalidateWebsite([
			moedChange({
				id: savedId,
				slug,
				...(previousSlug && previousSlug !== slug
					? { oldSlug: previousSlug }
					: {}),
			}),
		]);
		return { id: savedId, slug };
	});

/** Delete one moed — sections/ranges/article links cascade. */
export const deleteMoed = createServerFn({ method: "POST" })
	.validator((data: number) => data)
	.handler(async ({ data: moedId }) => {
		const slug = await transaction(async (conn) => {
			const row = await txQuery<{ slug: string }>(
				conn,
				"SELECT slug FROM tanah_moed WHERE id = ? FOR UPDATE",
				[moedId],
			);
			if (row.length === 0) throw new Error("Moed not found");
			await txExecute(conn, "DELETE FROM tanah_moed WHERE id = ?", [moedId]);
			return row[0].slug;
		});
		await revalidateWebsite([moedChange({ id: moedId, slug, oldSlug: slug })]);
		return { success: true };
	});
