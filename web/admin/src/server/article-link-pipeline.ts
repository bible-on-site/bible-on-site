/**
 * The LLM/heuristic article-linking pipeline (#3103): generation produces
 * evidence-backed DRAFT proposals only — never a relationship write, never
 * coverage verification, never content edits, never SQL from the model.
 * Persisted suggestions are grouped into ordinary contribution PRs in the
 * proposal/checkpoint transaction. Review and merge use that PR's doradsoft
 * gate, guarded API executor and durable recovery intent. Legacy rows retain
 * their original model/reviewer audit; they no longer own an apply workflow.
 *
 * Server-only implementation module — the public server-fn wrappers that
 * client routes may import live in ./article-link-proposals.
 */
import { createHash, randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import {
	cataloguePasukLabel,
	cataloguePerekLabel,
	type TargetCatalogue,
} from "~/lib/article-linking/catalogue";
import { buildHeuristicDrafts } from "~/lib/article-linking/heuristic";
import { extractPlainText } from "~/lib/article-linking/html-text";
import {
	buildArticleLinkSystemPrompt,
	buildArticleLinkUserMessage,
	HEURISTIC_GENERATOR_ID,
	HEURISTIC_PROMPT_VERSION,
	LINK_PROMPT_VERSION,
} from "~/lib/article-linking/prompt";
import type {
	ArticleGenerationOutcome,
	ArticleLinkSnapshot,
	DraftProposal,
	LinkProposal,
	LinkProposalStatus,
	PasukCoordinate,
	ProposalTarget,
} from "~/lib/article-linking/types";
import {
	type RawModelOutput,
	validateModelOutput,
} from "~/lib/article-linking/validate";
import { ARTICLE_RELATIONSHIP_REGISTRY } from "~/lib/article-relationships";
import { canonicalJson } from "~/lib/canonical-json";
import { articleApiConfigured } from "./article-relationships-api";
import { isCoveringSourceSchemaMissing } from "./covering-sources";
import { execute, query, queryOne, transaction, txExecute } from "./db";
import { callOpenAiJson, llmConfigured } from "./llm-json";
import {
	articleLinkContributionIds,
	ensureArticleLinkPromotionSchema,
	promoteLegacyArticleLinkProposals,
} from "./tanahpedia/contribution-article-import.server";

// ---------------------------------------------------------------------------
// Lazy schema ensure — same DDL as data/mysql/tanah_article_link_proposal_upgrade.sql,
// run once per process outside transactions (MySQL DDL implicitly commits).
// ---------------------------------------------------------------------------

const ENSURE_PROPOSAL_SQL = `CREATE TABLE IF NOT EXISTS tanah_article_link_proposal (
	id CHAR(36) NOT NULL,
	run_id CHAR(36) NOT NULL COMMENT 'generation run grouping',
	article_id MEDIUMINT NOT NULL,
	relationship_key VARCHAR(40) NOT NULL COMMENT 'shared registry key (#3102)',
	action VARCHAR(10) NOT NULL COMMENT 'add|remove|replace|clear',
	target_json JSON NOT NULL COMMENT 'canonical normalized target payload',
	target_label VARCHAR(500) NOT NULL,
	evidence_json JSON NULL COMMENT '[{quote,spanStart,spanEnd}] in the plain-text view',
	rationale TEXT NULL,
	confidence DECIMAL(4,3) NULL COMMENT 'advisory only — never auto-approves',
	conflict VARCHAR(500) NULL COMMENT 'collision/ambiguity surfaced to the reviewer',
	status VARCHAR(12) NOT NULL DEFAULT 'pending' COMMENT 'pending|held|approved|rejected|applied|stale',
	dedupe_key CHAR(64) NOT NULL COMMENT 'sha256 incl. generator+prompt_version+content_hash',
	decision_key CHAR(64) NOT NULL COMMENT 'sha256 of article+relationship+action+canonical target',
	generator VARCHAR(120) NOT NULL COMMENT 'openai:<model> | heuristic:<ver>',
	model VARCHAR(120) NULL,
	prompt_version VARCHAR(40) NOT NULL,
	base_content_hash CHAR(32) NOT NULL DEFAULT '' COMMENT 'freshness token; empty when undeployed',
	base_snapshot_json JSON NULL,
	prompt_tokens INT NULL,
	completion_tokens INT NULL,
	review_patch_json JSON NULL COMMENT 'human-edited final patch, separate from model output',
	review_notes VARCHAR(1000) NULL,
	reviewer VARCHAR(200) NULL COMMENT 'Cognito sub, or local in dev',
	reviewed_at TIMESTAMP(6) NULL,
	applied_at TIMESTAMP(6) NULL,
	applied_snapshot_json JSON NULL COMMENT 'post-apply relationship state',
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	UNIQUE KEY uq_link_proposal_dedupe (dedupe_key),
	KEY idx_link_proposal_queue (status, article_id),
	KEY idx_link_proposal_run (run_id),
	KEY idx_link_proposal_decision (decision_key),
	CONSTRAINT fk_link_proposal_article FOREIGN KEY (article_id)
		REFERENCES tanah_article (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const ENSURE_CHECKPOINT_SQL = `CREATE TABLE IF NOT EXISTS tanah_article_link_checkpoint (
	article_id MEDIUMINT NOT NULL,
	generator VARCHAR(120) NOT NULL,
	prompt_version VARCHAR(40) NOT NULL,
	content_hash CHAR(32) NOT NULL DEFAULT '',
	run_id CHAR(36) NOT NULL,
	proposal_count INT NOT NULL DEFAULT 0,
	processed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (article_id, generator, prompt_version, content_hash),
	CONSTRAINT fk_link_checkpoint_article FOREIGN KEY (article_id)
		REFERENCES tanah_article (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

let linkSchemaReady: Promise<void> | null = null;

export function ensureLinkSchema(): Promise<void> {
	linkSchemaReady ??= execute(ENSURE_PROPOSAL_SQL)
		.then(() => execute(ENSURE_CHECKPOINT_SQL))
		.then(() => undefined)
		.catch((err: unknown) => {
			linkSchemaReady = null;
			throw err;
		});
	return linkSchemaReady;
}

/** Test hook: resets the memoized ensure so tests re-run it. */
export function _resetLinkSchemaCache(): void {
	linkSchemaReady = null;
}

/** Does the proposal schema respond? Drives the panel's unavailable state. */
export async function linkSchemaDeployed(): Promise<boolean> {
	try {
		await ensureLinkSchema();
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

interface ArticleGenRow {
	id: number;
	perek_id: number;
	author_id: number;
	name: string;
	abstract: string | null;
	content: string | null;
	coverage_verified: number;
	content_hash: string | null;
}

async function loadArticleRow(
	articleId: number,
): Promise<ArticleGenRow | null> {
	try {
		return await queryOne<ArticleGenRow>(
			`SELECT id, perek_id, author_id, name, abstract, content,
			        coverage_verified, LOWER(HEX(content_hash)) AS content_hash
			 FROM tanah_article WHERE id = ?`,
			[articleId],
		);
	} catch (error) {
		if (!isCoveringSourceSchemaMissing(error)) throw error;
		const row = await queryOne<ArticleGenRow>(
			`SELECT id, perek_id, author_id, name, abstract, content,
			        0 AS coverage_verified, NULL AS content_hash
			 FROM tanah_article WHERE id = ?`,
			[articleId],
		);
		return row;
	}
}

/** The bounded target catalogue — perakim, authors, dedications. */
async function loadTargetCatalogue(): Promise<TargetCatalogue> {
	const [perakim, authors, dedications] = await Promise.all([
		query<{
			id: number;
			sefer_name: string | null;
			additional_letter: string | null;
			perek_in_context: number | null;
			pasuk_count: number | null;
		}>(
			`SELECT id, sefer_name, additional_letter, perek_in_context, pasuk_count
			 FROM tanah_perek_view ORDER BY perek_id`,
		),
		query<{ id: number; name: string }>(
			"SELECT id, name FROM tanah_author ORDER BY id",
		),
		query<{ id: number; subject: string }>(
			"SELECT id, subject FROM tanah_dedication ORDER BY id",
		),
	]);
	return {
		perakim: perakim
			.filter((p) => p.sefer_name && p.perek_in_context !== null)
			.map((p) => ({
				id: p.id,
				seferName: p.sefer_name as string,
				additionalLetter: p.additional_letter,
				perekInContext: p.perek_in_context as number,
				pasukCount: p.pasuk_count,
			})),
		authors,
		dedications,
	};
}

async function loadCoveringSources(
	articleId: number,
): Promise<PasukCoordinate[]> {
	try {
		return await query<PasukCoordinate>(
			`SELECT perek_id AS perekId, pasuk
			 FROM tanah_article_covering_source WHERE article_id = ?
			 ORDER BY perek_id, pasuk`,
			[articleId],
		);
	} catch (error) {
		if (!isCoveringSourceSchemaMissing(error)) throw error;
		return [];
	}
}

async function loadDedicationIds(articleId: number): Promise<number[]> {
	const rows = await query<{ dedication_id: number }>(
		"SELECT dedication_id FROM tanah_article_dedication WHERE article_id = ? ORDER BY dedication_id",
		[articleId],
	);
	return rows.map((r) => r.dedication_id);
}

async function loadSnapshot(articleId: number): Promise<ArticleLinkSnapshot> {
	const [row, coveringSources, dedicationIds] = await Promise.all([
		loadArticleRow(articleId),
		loadCoveringSources(articleId),
		loadDedicationIds(articleId),
	]);
	if (!row) throw new Error(`מאמר ${articleId} לא נמצא`);
	return {
		perekId: row.perek_id,
		authorId: row.author_id,
		coverageVerified: row.coverage_verified === 1,
		coveringSources,
		dedicationIds,
	};
}

/** The article's current generated content hash ("" when undeployed). */
async function liveContentHash(articleId: number): Promise<string> {
	try {
		const row = await queryOne<{ h: string | null }>(
			"SELECT LOWER(HEX(content_hash)) AS h FROM tanah_article WHERE id = ?",
			[articleId],
		);
		return row?.h ?? "";
	} catch (error) {
		if (!isCoveringSourceSchemaMissing(error)) throw error;
		return "";
	}
}

/** The plain-text matching view the model and the extractor both see. */
function articlePlainText(row: ArticleGenRow): string {
	return [row.name, row.abstract ?? "", row.content ?? ""]
		.map((part) => extractPlainText(part))
		.filter(Boolean)
		.join("\n");
}

// ---------------------------------------------------------------------------
// Proposal row mapping
// ---------------------------------------------------------------------------

interface ProposalRow {
	id: string;
	run_id: string;
	article_id: number;
	relationship_key: string;
	action: string;
	target_json: string;
	target_label: string;
	evidence_json: string | null;
	rationale: string | null;
	confidence: string | null;
	conflict: string | null;
	status: string;
	dedupe_key: string;
	decision_key: string;
	generator: string;
	model: string | null;
	prompt_version: string;
	base_content_hash: string;
	base_snapshot_json: string | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	review_patch_json: string | null;
	review_notes: string | null;
	reviewer: string | null;
	reviewed_at: string | Date | null;
	applied_at: string | Date | null;
	applied_snapshot_json: string | null;
	created_at: string | Date;
	updated_at: string | Date;
	live_hash?: string | null;
}

function parseJson<T>(value: unknown): T | null {
	if (value === null || value === undefined) return null;
	// mysql2 already parses JSON columns into objects — pass them through.
	if (typeof value !== "string") return value as T;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

const toIso = (v: string | Date | null): string | null =>
	v === null ? null : v instanceof Date ? v.toISOString() : String(v);

function rowToProposal(row: ProposalRow): LinkProposal {
	const liveHash = row.live_hash ?? null;
	return {
		id: row.id,
		runId: row.run_id,
		articleId: row.article_id,
		relationshipKey: row.relationship_key,
		action: row.action as LinkProposal["action"],
		target:
			parseJson<ProposalTarget>(row.target_json) ?? ({} as ProposalTarget),
		targetLabel: row.target_label,
		evidence: parseJson(row.evidence_json),
		rationale: row.rationale,
		confidence: row.confidence === null ? null : Number(row.confidence),
		conflict: row.conflict,
		status: row.status as LinkProposalStatus,
		dedupeKey: row.dedupe_key,
		decisionKey: row.decision_key,
		generator: row.generator,
		model: row.model,
		promptVersion: row.prompt_version,
		baseContentHash: row.base_content_hash,
		baseSnapshot: parseJson(row.base_snapshot_json),
		promptTokens: row.prompt_tokens,
		completionTokens: row.completion_tokens,
		reviewPatch: parseJson(row.review_patch_json),
		reviewNotes: row.review_notes,
		reviewer: row.reviewer,
		reviewedAt: toIso(row.reviewed_at),
		appliedAt: toIso(row.applied_at),
		appliedSnapshot: parseJson(row.applied_snapshot_json),
		createdAt: toIso(row.created_at) ?? "",
		updatedAt: toIso(row.updated_at) ?? "",
		staleNow:
			row.base_content_hash !== "" &&
			liveHash !== null &&
			liveHash !== row.base_content_hash,
	};
}

const PROPOSAL_SELECT = `SELECT p.*, LOWER(HEX(a.content_hash)) AS live_hash
	 FROM tanah_article_link_proposal p
	 JOIN tanah_article a ON a.id = p.article_id`;

/** Same rows when the article content-hash upgrade is not deployed yet. */
const PROPOSAL_SELECT_NO_HASH = `SELECT p.*, NULL AS live_hash
	 FROM tanah_article_link_proposal p`;

/** Query proposals with the freshness join, degrading to no-hash rows when
 *  tanah_article.content_hash is undeployed (ER_BAD_FIELD_ERROR). */
async function queryProposals(
	suffix: string,
	params: unknown[],
): Promise<ProposalRow[]> {
	try {
		return await query<ProposalRow>(`${PROPOSAL_SELECT} ${suffix}`, params);
	} catch (error) {
		if (!isCoveringSourceSchemaMissing(error)) throw error;
		return await query<ProposalRow>(
			`${PROPOSAL_SELECT_NO_HASH} ${suffix}`,
			params,
		);
	}
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

// canonicalJson (~/lib/canonical-json) is the dedupe/decision key input.

const sha256 = (input: string) =>
	createHash("sha256").update(input).digest("hex");

function dedupeKey(
	generator: string,
	promptVersion: string,
	articleId: number,
	contentHash: string,
	draft: DraftProposal,
): string {
	return sha256(
		canonicalJson([
			"dedupe",
			generator,
			promptVersion,
			articleId,
			contentHash,
			draft.relationshipKey,
			draft.action,
			draft.target,
		]),
	);
}

function decisionKey(articleId: number, draft: DraftProposal): string {
	return sha256(
		canonicalJson([
			"decision",
			articleId,
			draft.relationshipKey,
			draft.action,
			draft.target,
		]),
	);
}

/** Injectable for tests — the production default calls OpenAI. */
type LlmCaller = (params: { system: string; user: string }) => Promise<{
	content: string;
	model: string;
	promptTokens: number | null;
	completionTokens: number | null;
}>;
let llmCaller: LlmCaller = callOpenAiJson;
export function _setLinkLlmCaller(caller: LlmCaller | null): void {
	llmCaller = caller ?? callOpenAiJson;
}

const MAX_ARTICLES_PER_RUN = 50;

export interface GenerateLinkProposalsInput {
	articleIds: number[];
	/** Re-generate even when a checkpoint for unchanged content exists. */
	force?: boolean;
	/** Validate + compute drafts without persisting (reviewer preview). */
	dryRun?: boolean;
	/** "heuristic" (default, offline) | "llm" | "both". */
	engine?: "heuristic" | "llm" | "both";
}

interface InsertableProposal {
	id: string;
	runId: string;
	articleId: number;
	draft: DraftProposal;
	generator: string;
	model: string | null;
	promptTokens: number | null;
	completionTokens: number | null;
	baseContentHash: string;
	snapshot: ArticleLinkSnapshot;
}

function promptVersionFor(generator: string): string {
	return generator === HEURISTIC_GENERATOR_ID
		? HEURISTIC_PROMPT_VERSION
		: LINK_PROMPT_VERSION;
}

async function insertProposals(
	conn: mysql.PoolConnection,
	items: InsertableProposal[],
): Promise<number> {
	let inserted = 0;
	for (const item of items) {
		const promptVersion = promptVersionFor(item.generator);
		const result = await txExecute(
			conn,
			`INSERT IGNORE INTO tanah_article_link_proposal
			 (id, run_id, article_id, relationship_key, action, target_json,
			  target_label, evidence_json, rationale, confidence, conflict,
			  legacy_status, dedupe_key, decision_key, generator, model,
			  prompt_version, base_content_hash, base_snapshot_json,
			  prompt_tokens, completion_tokens)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				item.id,
				item.runId,
				item.articleId,
				item.draft.relationshipKey,
				item.draft.action,
				JSON.stringify(item.draft.target),
				item.draft.targetLabel.slice(0, 500),
				item.draft.evidence.length ? JSON.stringify(item.draft.evidence) : null,
				item.draft.rationale,
				item.draft.confidence,
				item.draft.conflict?.slice(0, 500) ?? null,
				item.draft.status,
				dedupeKey(
					item.generator,
					promptVersion,
					item.articleId,
					item.baseContentHash,
					item.draft,
				),
				decisionKey(item.articleId, item.draft),
				item.generator.slice(0, 120),
				item.model?.slice(0, 120) ?? null,
				promptVersion,
				item.baseContentHash,
				JSON.stringify(item.snapshot),
				item.promptTokens,
				item.completionTokens,
			],
		);
		if (result.affectedRows > 0) inserted += 1;
	}
	return inserted;
}

async function upsertCheckpoint(
	conn: mysql.PoolConnection,
	articleId: number,
	generator: string,
	contentHash: string,
	runId: string,
	proposalCount: number,
): Promise<void> {
	await txExecute(
		conn,
		`INSERT INTO tanah_article_link_checkpoint
		 (article_id, generator, prompt_version, content_hash, run_id, proposal_count)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE run_id = VALUES(run_id),
		     proposal_count = VALUES(proposal_count), processed_at = CURRENT_TIMESTAMP(6)`,
		[
			articleId,
			generator.slice(0, 120),
			promptVersionFor(generator),
			contentHash,
			runId,
			proposalCount,
		],
	);
}

async function checkpointExists(
	articleId: number,
	generator: string,
	contentHash: string,
): Promise<boolean> {
	const row = await queryOne<{ article_id: number }>(
		`SELECT article_id FROM tanah_article_link_checkpoint
		 WHERE article_id = ? AND generator = ? AND prompt_version = ? AND content_hash = ?`,
		[
			articleId,
			generator.slice(0, 120),
			promptVersionFor(generator),
			contentHash,
		],
	);
	return row !== null;
}

/** Generation input guard — shared with the server-fn validator. */
export function validateGenerateInput(
	data: GenerateLinkProposalsInput,
): GenerateLinkProposalsInput {
	if (!Array.isArray(data.articleIds) || data.articleIds.length === 0) {
		throw new Error("יש לבחור לפחות מאמר אחד");
	}
	if (data.articleIds.length > MAX_ARTICLES_PER_RUN) {
		throw new Error(`ניתן לעבד עד ${MAX_ARTICLES_PER_RUN} מאמרים בהרצה אחת`);
	}
	return data;
}

/**
 * Draft generation for a bounded article set. Generation ONLY writes
 * proposal/checkpoint rows — relationship tables stay untouched, and the
 * checkpoint makes unchanged articles cost zero on rerun.
 */
export async function runLinkGeneration(
	data: GenerateLinkProposalsInput,
): Promise<{
	runId: string;
	outcomes: ArticleGenerationOutcome[];
	prIds: string[];
}> {
	await ensureLinkSchema();
	if (!data.dryRun) await ensureArticleLinkPromotionSchema();
	const runId = randomUUID();
	const engine = data.engine ?? "heuristic";
	const wantsLlm = engine === "llm" || engine === "both";
	const catalogue = await loadTargetCatalogue();
	const outcomes: ArticleGenerationOutcome[] = [];

	for (const articleId of data.articleIds) {
		try {
			const row = await loadArticleRow(articleId);
			if (!row) {
				outcomes.push({
					articleId,
					outcome: "error",
					proposals: [],
					error: "article not found",
				});
				continue;
			}
			const contentHash = row.content_hash ?? "";
			const plainText = articlePlainText(row);
			const snapshot = await loadSnapshot(articleId);
			const drafts: InsertableProposal[] = [];
			const successfulGenerators = new Set<string>();

			const wantHeuristic = engine === "heuristic" || engine === "both";
			const llmGenerator = `openai:${process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini"}`;
			const runHeuristic =
				wantHeuristic &&
				(data.force ||
					!(await checkpointExists(
						articleId,
						HEURISTIC_GENERATOR_ID,
						contentHash,
					)));
			const runLlm =
				wantsLlm &&
				(llmConfigured() || llmCaller !== callOpenAiJson) &&
				(data.force ||
					!(await checkpointExists(articleId, llmGenerator, contentHash)));
			if (!runHeuristic && !runLlm) {
				outcomes.push({
					articleId,
					outcome:
						wantsLlm && !llmConfigured() && llmCaller === callOpenAiJson
							? "error"
							: "skipped-checkpoint",
					proposals: [],
					error:
						wantsLlm && !llmConfigured() && llmCaller === callOpenAiJson
							? "OPENAI_API_KEY is not configured"
							: undefined,
				});
				continue;
			}

			if (runHeuristic) {
				const { drafts: heuristicDrafts } = buildHeuristicDrafts(
					plainText,
					catalogue,
					snapshot,
				);
				for (const draft of heuristicDrafts) {
					drafts.push({
						id: randomUUID(),
						runId,
						articleId,
						draft,
						generator: HEURISTIC_GENERATOR_ID,
						model: null,
						promptTokens: null,
						completionTokens: null,
						baseContentHash: contentHash,
						snapshot,
					});
				}
				successfulGenerators.add(HEURISTIC_GENERATOR_ID);
			}

			if (runLlm) {
				const generator = llmGenerator;
				const perekModel = catalogue.perakim.find((p) => p.id === row.perek_id);
				const perekLabel = perekModel
					? cataloguePerekLabel(perekModel)
					: `פרק ${row.perek_id}`;
				const llmResult = await llmCaller({
					system: buildArticleLinkSystemPrompt(),
					user: buildArticleLinkUserMessage({
						articleId,
						articleName: row.name,
						articleAbstract: row.abstract,
						plainText,
						current: {
							perekId: row.perek_id,
							perekLabel,
							authorId: row.author_id,
							authorName:
								catalogue.authors.find((a) => a.id === row.author_id)?.name ??
								null,
							coverageVerified: row.coverage_verified === 1,
							coveringSources: snapshot.coveringSources.map((c) => {
								const perek = catalogue.perakim.find((p) => p.id === c.perekId);
								return {
									perekId: c.perekId,
									pasuk: c.pasuk,
									label: perek
										? cataloguePasukLabel(perek, c.pasuk)
										: `${c.perekId}:${c.pasuk}`,
								};
							}),
							dedications: snapshot.dedicationIds.map((id) => ({
								dedicationId: id,
								subject:
									catalogue.dedications.find((d) => d.id === id)?.subject ??
									null,
							})),
						},
						catalogue,
					}),
				});
				let parsed: RawModelOutput;
				try {
					parsed = JSON.parse(llmResult.content) as RawModelOutput;
				} catch {
					throw new Error("המודל החזיר JSON לא תקין");
				}
				if (
					!parsed ||
					typeof parsed !== "object" ||
					Array.isArray(parsed) ||
					(!Object.hasOwn(parsed, "proposals") &&
						!Object.hasOwn(parsed, "abstentions")) ||
					(Object.hasOwn(parsed, "proposals") &&
						!Array.isArray(parsed.proposals)) ||
					(Object.hasOwn(parsed, "abstentions") &&
						!Array.isArray(parsed.abstentions))
				) {
					throw new Error(
						"LLM response must be an object containing proposals and/or abstentions arrays; correct the response and retry generation",
					);
				}
				const validated = validateModelOutput(parsed, {
					catalogue,
					plainText,
					snapshot,
				});
				const submittedItems =
					(parsed.proposals?.length ?? 0) + (parsed.abstentions?.length ?? 0);
				if (
					submittedItems > 0 &&
					validated.drafts.length === 0 &&
					validated.abstentions.length === 0
				) {
					throw new Error(
						"LLM returned only malformed proposals or abstentions; correct the response and retry generation",
					);
				}
				for (const draft of validated.drafts) {
					drafts.push({
						id: randomUUID(),
						runId,
						articleId,
						draft,
						generator,
						model: llmResult.model,
						promptTokens: llmResult.promptTokens,
						completionTokens: llmResult.completionTokens,
						baseContentHash: contentHash,
						snapshot,
					});
				}
				successfulGenerators.add(generator);
			}

			if (data.dryRun) {
				outcomes.push({
					articleId,
					outcome: "dry-run",
					proposals: drafts.map((d) => d.draft),
				});
				continue;
			}

			const inserted = await transaction(async (conn) => {
				const count = await insertProposals(conn, drafts);
				await promoteLegacyArticleLinkProposals(conn, articleId);
				for (const generator of successfulGenerators) {
					await upsertCheckpoint(
						conn,
						articleId,
						generator,
						contentHash,
						runId,
						drafts.filter((draft) => draft.generator === generator).length,
					);
				}
				return count;
			});
			outcomes.push({
				articleId,
				outcome: "generated",
				proposals: drafts.map((d) => d.draft),
				error:
					inserted === drafts.length
						? undefined
						: `${inserted}/${drafts.length} inserted (dedupe)`,
			});
		} catch (error) {
			outcomes.push({
				articleId,
				outcome: "error",
				proposals: [],
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return {
		runId,
		outcomes,
		prIds: data.dryRun ? [] : await articleLinkContributionIds(data.articleIds),
	};
}

// ---------------------------------------------------------------------------
// Review queue + detail
// ---------------------------------------------------------------------------

export interface ListProposalsFilter {
	status?: LinkProposalStatus;
	articleId?: number;
	runId?: string;
	limit?: number;
}

export async function listProposals(
	data: ListProposalsFilter,
): Promise<LinkProposal[]> {
	await ensureLinkSchema();
	const clauses: string[] = [];
	const params: unknown[] = [];
	if (data.status) {
		clauses.push("p.status = ?");
		params.push(data.status);
	}
	if (data.articleId) {
		clauses.push("p.article_id = ?");
		params.push(data.articleId);
	}
	if (data.runId) {
		clauses.push("p.run_id = ?");
		params.push(data.runId);
	}
	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = Math.min(Math.max(data.limit ?? 200, 1), 500);
	const rows = await queryProposals(
		`${where}
			 ORDER BY p.created_at DESC, p.id LIMIT ?`,
		[...params, limit],
	);
	return rows.map(rowToProposal);
}

export interface LinkProposalDetail {
	proposal: LinkProposal;
	articleName: string;
	liveSnapshot: ArticleLinkSnapshot;
	liveContentHash: string;
}

export async function getProposalDetail(
	id: string,
): Promise<LinkProposalDetail | null> {
	await ensureLinkSchema();
	const rows = await queryProposals("WHERE p.id = ?", [id]);
	const row = rows[0];
	if (!row) return null;
	const article = await queryOne<{ name: string }>(
		"SELECT name FROM tanah_article WHERE id = ?",
		[row.article_id],
	);
	return {
		proposal: rowToProposal(row),
		articleName: article?.name ?? `#${row.article_id}`,
		liveSnapshot: await loadSnapshot(row.article_id),
		liveContentHash: await liveContentHash(row.article_id),
	};
}

export interface LinkRunSummary {
	runId: string;
	generator: string;
	proposals: number;
	pending: number;
	held: number;
	approved: number;
	applied: number;
	rejected: number;
	startedAt: string;
}

/** Run-grouped view of generation history for the queue header. */
export async function listRuns(): Promise<LinkRunSummary[]> {
	await ensureLinkSchema();
	const rows = await query<{
		run_id: string;
		generator: string;
		proposals: number;
		pending: number;
		held: number;
		approved: number;
		applied: number;
		rejected: number;
		started_at: string | Date;
	}>(
		`SELECT run_id, MIN(generator) AS generator, COUNT(*) AS proposals,
			        SUM(status = 'pending') AS pending,
			        SUM(status = 'held') AS held,
			        SUM(status = 'approved') AS approved,
			        SUM(status = 'applied') AS applied,
			        SUM(status = 'rejected') AS rejected,
			        MIN(created_at) AS started_at
			 FROM tanah_article_link_proposal
			 GROUP BY run_id ORDER BY started_at DESC LIMIT 50`,
	);
	return rows.map((row) => ({
		runId: row.run_id,
		generator: row.generator,
		proposals: Number(row.proposals),
		pending: Number(row.pending),
		held: Number(row.held),
		approved: Number(row.approved),
		applied: Number(row.applied),
		rejected: Number(row.rejected),
		startedAt: toIso(row.started_at) ?? "",
	}));
}

// ---------------------------------------------------------------------------
// Review (approve / reject / edit) — the human gate. Generation never
// approves its own output; every decision records the editor identity.
// ---------------------------------------------------------------------------

export interface ReviewInput {
	id: string;
	decision: "approve" | "reject";
	reviewPatch?: ProposalTarget;
	reviewNotes?: string;
}

/** Legacy review/apply URLs remain resolvable, but all decisions now belong to
 * the ordinary PR. A caller-supplied old reviewer string cannot grant authority. */
export async function reviewProposal(
	data: ReviewInput,
	_reviewer: string,
): Promise<{ id: string; status: LinkProposalStatus }> {
	const { legacyArticleLinkContribution } = await import(
		"./tanahpedia/contribution-article-import.server"
	);
	await ensureLinkSchema();
	const pr = await legacyArticleLinkContribution(data.id);
	if (!pr) throw new Error("ההצעה לא נמצאה");
	throw new Error(`יש לסקור את PR #${pr.number}: /?tab=prs&id=${pr.id}`);
}

export interface ApplyOutcome {
	id: string;
	outcome: "applied" | "already-applied" | "stale" | "conflict" | "error";
	detail?: string;
}

export async function applyProposals(
	ids: string[],
	_reviewer: string,
): Promise<{ outcomes: ApplyOutcome[] }> {
	await ensureLinkSchema();
	const { legacyArticleLinkContribution } = await import(
		"./tanahpedia/contribution-article-import.server"
	);
	const outcomes: ApplyOutcome[] = [];
	for (const id of ids) {
		const pr = await legacyArticleLinkContribution(id);
		outcomes.push(
			pr
				? {
						id,
						outcome: pr.state === "merged" ? "already-applied" : "conflict",
						detail: `יש לסקור ולמזג את PR #${pr.number}: /?tab=prs&id=${pr.id}`,
					}
				: { id, outcome: "error", detail: "ההצעה לא נמצאה" },
		);
	}
	return { outcomes };
}

export interface LinkPipelineStatus {
	schemaReady: boolean;
	llmEnabled: boolean;
	articleApiConfigured: boolean;
	contractVersion: number;
	supportedKeys: string[];
	pendingKeys: string[];
}

/** Pipeline capability surface for the admin panel. */
export async function pipelineStatus(): Promise<LinkPipelineStatus> {
	return {
		schemaReady: await linkSchemaDeployed(),
		llmEnabled: llmConfigured() || llmCaller !== callOpenAiJson,
		articleApiConfigured: articleApiConfigured(),
		contractVersion: ARTICLE_RELATIONSHIP_REGISTRY.contractVersion,
		supportedKeys: ARTICLE_RELATIONSHIP_REGISTRY.relationships
			.filter(
				(r) =>
					r.key !== "author" &&
					r.status === "supported" &&
					r.operations.length > 1,
			)
			.map((r) => r.key),
		pendingKeys: ARTICLE_RELATIONSHIP_REGISTRY.relationships
			.filter((r) => r.status === "pending-schema")
			.map((r) => r.key),
	};
}
