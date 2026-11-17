import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { canonicalJson } from "~/lib/canonical-json";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import { validateArticleLinkChange } from "~/lib/tanahpedia/contribution-article-links";
import {
	type Contribution,
	type Contributor,
	type ReviewedChange,
	validateEvidence,
} from "~/lib/tanahpedia/contributions";
import { query, txExecute, txQuery, txQueryOne } from "../db";
import { normalizeExpiry } from "../dedication-targets.server";
import { refreshArticleLinkEvidence } from "./contribution-article-evidence.server";
import { ensureArticleLinkStatusFence } from "./contribution-article-import-schema.server";
import { prepareArticleLinkChange } from "./contribution-article-links.server";
import { addEvent } from "./contribution-service.server";
import {
	ensureContributionSchema,
	insertContribution,
	withContributions,
} from "./contribution-store.server";

const importer: Contributor = {
	id: "system:article-link-import",
	name: "הצעות קישורי מאמרים",
	kind: "system",
	isDoradsoft: false,
};

let promotionSchema: Promise<void> | undefined;
/** DDL precedes promotion transactions, including restarts between the two
 * metadata-only status-fence steps. No promotion starts before verification. */
export function ensureArticleLinkPromotionSchema(): Promise<void> {
	promotionSchema ??= (async () => {
		const { ensureLinkSchema } = await import("../article-link-pipeline");
		await ensureLinkSchema();
		await ensureContributionSchema();
		await ensureArticleLinkStatusFence();
	})().catch((error: unknown) => {
		promotionSchema = undefined;
		throw error;
	});
	return promotionSchema;
}
type LegacyRow = Record<string, unknown> & {
	id: string;
	article_id: number;
	status: string;
	relationship_key: string;
	action: string;
	base_content_hash: string;
};

function json(value: unknown): unknown {
	return typeof value === "string" ? JSON.parse(value) : value;
}

async function legacyCommand(conn: PoolConnection, row: LegacyRow) {
	let target = json(row.review_patch_json ?? row.target_json);
	if (target && typeof target === "object" && !Array.isArray(target)) {
		const original = target as Record<string, unknown>;
		if (
			row.relationship_key === "moadim" &&
			typeof original.moedName === "string" &&
			Object.keys(original).length === 1
		) {
			if (row.action === "clear") target = { moedIds: [] };
			else {
				const matches = await txQuery<{ id: number }>(
					conn,
					"SELECT id FROM tanah_moed WHERE name=? ORDER BY id LIMIT 2",
					[original.moedName],
				);
				if (matches.length !== 1)
					throw new Error(
						"Legacy moed name is missing or ambiguous; choose an existing target during recovery",
					);
				target = { moedIds: [Number(matches[0].id)] };
			}
		} else if (
			row.relationship_key === "dedicationAssignments" &&
			(original.expiresAt === undefined ||
				original.expiresAt === null ||
				typeof original.expiresAt === "string")
		) {
			target = {
				...original,
				expiresAt: normalizeExpiry(
					original.expiresAt as string | null | undefined,
				),
			};
		}
	}
	return { relationshipKey: row.relationship_key, action: row.action, target };
}

/** Keep each persisted legacy identity and its full audit independently. The
 * article mutex and unique proposal key make concurrent generation/backfill
 * retries atomic, including INSERT IGNORE returning an older persisted row. */
export async function promoteLegacyArticleLinkProposals(
	conn: PoolConnection,
	articleId: number,
): Promise<string[]> {
	await txExecute(
		conn,
		"INSERT IGNORE INTO tanahpedia_article_link_import_lock (article_id) VALUES (?)",
		[articleId],
	);
	await txQueryOne(
		conn,
		"SELECT article_id FROM tanahpedia_article_link_import_lock WHERE article_id=? FOR UPDATE",
		[articleId],
	);
	const rows = await txQuery<LegacyRow>(
		conn,
		"SELECT p.*,p.legacy_status AS status FROM tanah_article_link_proposal p LEFT JOIN tanahpedia_article_link_import i ON i.proposal_id=p.id COLLATE utf8mb4_unicode_ci WHERE p.article_id=? AND i.proposal_id IS NULL ORDER BY p.created_at,p.id FOR UPDATE",
		[articleId],
	);
	const result: string[] = [];
	for (const state of ["open", "merged", "closed"] as const) {
		const matching = rows.filter((row) =>
			state === "merged"
				? row.status === "applied"
				: state === "closed"
					? row.status === "rejected"
					: !["applied", "rejected"].includes(row.status),
		);
		// A bounded batch normally groups all suggestions for the article. Very
		// large historical runs retain every origin across consecutive batches.
		for (let offset = 0; offset < matching.length; offset += 40) {
			const batch = matching.slice(offset, offset + 40);
			const commands: unknown[] = [];
			const evidence: unknown[] = [];
			let failure: string | undefined;
			for (const row of batch) {
				try {
					const command = await legacyCommand(conn, row);
					if (
						!commands.some(
							(value) => canonicalJson(value) === canonicalJson(command),
						)
					)
						commands.push(command);
					const quotes = json(row.evidence_json);
					if (Array.isArray(quotes))
						for (const raw of quotes) {
							const quote = raw as {
								quote?: unknown;
								spanStart?: unknown;
								spanEnd?: unknown;
							};
							evidence.push({
								citation: `מאמר ${articleId}`,
								quote:
									typeof quote.quote === "string"
										? quote.quote.slice(0, 8000)
										: "",
								url: null,
								note: "קטע מהמאמר התומך בקישור המוצע.",
								...(typeof quote.quote === "string" &&
								quote.quote.length > 0 &&
								quote.quote.length <= 8000 &&
								Number.isSafeInteger(quote.spanStart) &&
								Number(quote.spanStart) >= 0 &&
								Number.isSafeInteger(quote.spanEnd) &&
								Number(quote.spanEnd) <= 4000000 &&
								Number(quote.spanEnd) - Number(quote.spanStart) ===
									quote.quote.length &&
								/^[0-9a-f]{32}$/.test(row.base_content_hash)
									? {
											articleSource: {
												articleId: String(articleId),
												contentHash: row.base_content_hash,
												spanStart: quote.spanStart,
												spanEnd: quote.spanEnd,
											},
										}
									: {}),
							});
						}
				} catch (error) {
					if (error && typeof error === "object" && "code" in error)
						throw error;
					failure =
						error instanceof SyntaxError
							? "Legacy proposal contains invalid JSON; the original record is preserved for manual recovery"
							: error instanceof Error
								? error.message
								: "Legacy target could not be translated";
				}
			}
			let changes: ReviewedChange[] = [];
			const rawSequence = [
				{
					kind: "article_links",
					targetId: String(articleId),
					after: { commands },
				},
			];
			try {
				if (failure) throw new Error(failure);
				const input = validateArticleLinkChange(rawSequence[0]);
				changes = [
					await prepareArticleLinkChange(conn, input, { refresh: true }),
				];
			} catch (error) {
				if (error && typeof error === "object" && "code" in error) throw error;
				failure =
					error instanceof Error
						? error.message
						: "Legacy operation cannot be translated";
				// Deliberately invalid latest-vocabulary input remains gray and raw;
				// recovery uses the same normal PR and captures new authoritative bases.
				changes = [
					{ ...rawSequence[0], legacyProposals: batch },
				] as unknown as ReviewedChange[];
			}
			const now = new Date().toISOString();
			const articleTitle =
				changes[0]?.labels?.[`article:${articleId}`] ?? `#${articleId}`;
			const item: Contribution = {
				id: randomUUID(),
				number: 0,
				kind: "pr",
				state,
				title: `קישורי מאמר: ${articleTitle}`.slice(0, 255),
				description: [
					`הצעה לעדכון הקישורים של המאמר ${articleTitle}, על בסיס ההפניות והאסמכתאות המצורפות.`,
					"השינויים יוחלו לאחר סקירה ומיזוג של ההצעה.",
					...[
						...new Set(
							batch.flatMap((row) =>
								typeof row.review_notes === "string" && row.review_notes.trim()
									? [`הערת סקירה קודמת: ${row.review_notes.trim()}`]
									: [],
							),
						),
					],
				]
					.join("\n\n")
					.slice(0, 20000),
				author: importer,
				revisionAuthor: importer,
				assignee: { kind: "unassigned" },
				evidence: validateEvidence(
					evidence.length
						? evidence.slice(0, 30).map((raw) => ({
								...(raw as Record<string, unknown>),
								citation: `${articleTitle} (מאמר ${articleId})`.slice(0, 500),
							}))
						: [
								{
									citation: `${articleTitle} (מאמר ${articleId})`.slice(0, 500),
									quote: "",
									url: null,
									note: "יש לבדוק את ההפניה במאמר לפני אישור הקישור.",
								},
							],
				),
				changes,
				issueId: null,
				revision: 1,
				version: 1,
				events: [],
				createdAt: now,
				updatedAt: now,
				closeIssue: false,
				provenance: null,
				apiVersion: CONTRIBUTION_API_VERSION,
				legacyArticleLinks: {
					articleId,
					proposalIds: batch.map((row) => row.id),
				},
			};
			if (failure) {
				item.apiMigration = {
					id: randomUUID(),
					status: "failed",
					from: CONTRIBUTION_API_VERSION,
					to: CONTRIBUTION_API_VERSION,
					at: now,
					steps: [],
					error: failure,
					sequence: JSON.stringify(changes),
				};
				item.apiMigrationHistory = [structuredClone(item.apiMigration)];
			} else if (
				state === "open" &&
				batch.some(
					(row) =>
						row.status === "held" ||
						row.status === "stale" ||
						(row.base_content_hash &&
							row.base_content_hash !== changes[0].before?.contentHash),
				)
			) {
				item.domainConflict =
					"Legacy evidence or held targets require a fresh reviewed revision. Original source spans and hashes are preserved.";
			}
			addEvent(
				item,
				importer,
				"created",
				"יובא מסלול הצעות הקישור. החלטות ישנות נשמרו כהיסטוריה ואינן אישור doradsoft לרצף הנוכחי.",
			);
			if (state === "open" && !failure) {
				try {
					item.evidence = await refreshArticleLinkEvidence(conn, item);
				} catch (error) {
					if (error && typeof error === "object" && "code" in error)
						throw error;
					item.domainConflict =
						error instanceof Error
							? error.message
							: "Structured evidence could not be refreshed";
				}
			}
			if (state !== "open")
				addEvent(
					item,
					importer,
					state === "merged" ? "merged" : "closed",
					"מצב היסטורי בלבד; הייבוא לא הפעיל אף קריאת API ולא החיל תוכן מחדש.",
				);
			const stored = await insertContribution(conn, item);
			for (const row of batch) {
				await txExecute(
					conn,
					"INSERT INTO tanahpedia_article_link_import (proposal_id,contribution_id,article_id,original) VALUES (?,?,?,?)",
					[row.id, stored.id, articleId, JSON.stringify(row)],
				);
			}
			result.push(stored.id);
		}
	}
	return result;
}

export async function importLegacyArticleLinkProposals(): Promise<{
	articles: number;
	prIds: string[];
}> {
	await ensureArticleLinkPromotionSchema();
	const result = { articles: 0, prIds: [] as string[] };
	let cursor = 0;
	for (;;) {
		const rows = await query<{ articleId: number }>(
			"SELECT DISTINCT p.article_id AS articleId FROM tanah_article_link_proposal p LEFT JOIN tanahpedia_article_link_import i ON i.proposal_id=p.id COLLATE utf8mb4_unicode_ci WHERE p.article_id>? AND i.proposal_id IS NULL ORDER BY p.article_id LIMIT 100",
			[cursor],
		);
		if (!rows.length) return result;
		for (const row of rows) {
			result.prIds.push(
				...(await withContributions((conn) =>
					promoteLegacyArticleLinkProposals(conn, Number(row.articleId)),
				)),
			);
			result.articles++;
		}
		cursor = Number(rows[rows.length - 1].articleId);
	}
}

export async function articleLinkContributionIds(
	articleIds: number[],
): Promise<string[]> {
	if (!articleIds.length) return [];
	const rows = await query<{ id: string }>(
		"SELECT DISTINCT c.id,c.number,c.state FROM tanahpedia_article_link_import i JOIN tanahpedia_contribution c ON c.id=i.contribution_id WHERE i.article_id IN (SELECT id FROM JSON_TABLE(?, '$[*]' COLUMNS (id INT PATH '$')) ids) ORDER BY c.state='open' DESC,c.number DESC",
		[JSON.stringify(articleIds)],
	);
	return rows.map((row) => row.id);
}

export async function legacyArticleLinkContribution(id: string): Promise<{
	id: string;
	number: number;
	state: Contribution["state"];
} | null> {
	await ensureArticleLinkPromotionSchema();
	const row = await query<{ articleId: number }>(
		"SELECT article_id AS articleId FROM tanah_article_link_proposal WHERE id=?",
		[id],
	);
	if (!row.length) return null;
	await withContributions((conn) =>
		promoteLegacyArticleLinkProposals(conn, Number(row[0].articleId)),
	);
	const mapped = await query<{
		id: string;
		number: number;
		state: Contribution["state"];
	}>(
		"SELECT c.id,c.number,c.state FROM tanahpedia_article_link_import i JOIN tanahpedia_contribution c ON c.id=i.contribution_id WHERE i.proposal_id=?",
		[id],
	);
	return mapped[0] ?? null;
}
