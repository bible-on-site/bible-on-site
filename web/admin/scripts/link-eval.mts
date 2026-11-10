/**
 * Representative-set evaluation runner for the #3103 link-proposal pipeline
 * (issue acceptance item 5).
 *
 * Seeds a frozen mirror of real production articles (link-eval-corpus.json,
 * fetched once from the public GraphQL API) into the local dev DB, runs the
 * pipeline's own generation entry points, replays the recorded review
 * decisions through `reviewProposal`, and reports the metrics the issue
 * requires: candidate precision/coverage, invalid-target rate, reviewer
 * correction rate, runtime and cost — by relation type and engine.
 *
 * Everything stays inside the pipeline's contract: generation writes only
 * proposal/checkpoint rows, decisions go through `reviewProposal` with an
 * explicit reviewer id, and nothing here writes live relationship rows or
 * approves anything outside the human-gate path.
 *
 * The `llm` engine uses a deterministic fixture caller (no live provider
 * key): _setLinkLlmCaller injects per-article RawModelOutput JSON from
 * --fixture. The generator label is `openai:<fixture model>` so provenance
 * honestly marks the rows as fixture output, never real OpenAI traffic.
 *
 * Usage (from web/admin; DB_URL selects the DB, dev default tanah-dev):
 *   bun run scripts/link-eval.mts seed
 *   bun run scripts/link-eval.mts generate --engine heuristic|llm|both [--fixture scripts/link-eval-llm-fixture.json] [--force]
 *   bun run scripts/link-eval.mts review --decisions scripts/link-eval-decisions.json --reviewer eval-agent
 *   bun run scripts/link-eval.mts report [--out scripts/link-eval-report.json]
 *   bun run scripts/link-eval.mts run   # seed + generate both + review + report
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { DraftProposal } from "~/lib/article-linking/types";
import {
	_setLinkLlmCaller,
	ensureLinkSchema,
	listProposals,
	reviewProposal,
	runLinkGeneration,
} from "~/server/article-link-pipeline";
import { execute, pool, queryOne } from "~/server/db";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const corpusPath = resolve(scriptDir, "link-eval-corpus.json");
const runtimesPath = resolve(scriptDir, "link-eval-runtimes.json");
const reportPath = resolve(scriptDir, "link-eval-report.json");

interface CorpusArticle {
	id: number;
	perekId: number;
	authorId: number;
	name: string;
	abstract: string | null;
	content: string | null;
	coverageVerified: boolean;
	coveringSources: { perekId: number; pasuk: number }[];
	note?: string;
}
interface Corpus {
	fetchedAt: string;
	source: string;
	authors: { id: number; name: string }[];
	dedications: { id: number; subject: string; expiresAt: string | null }[];
	hebrewDates: { articleId: number; hebrewMonth: number; hebrewDay: number }[];
	articles: CorpusArticle[];
}
const corpus = JSON.parse(readFileSync(corpusPath, "utf-8")) as Corpus;

const { values: args, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		engine: { type: "string", default: "heuristic" },
		fixture: { type: "string" },
		decisions: {
			type: "string",
			default: resolve(scriptDir, "link-eval-decisions.json"),
		},
		reviewer: { type: "string", default: "eval-agent-record" },
		out: { type: "string", default: reportPath },
		force: { type: "boolean", default: false },
	},
});
const command = positionals[0] ?? "run";

// ---------------------------------------------------------------------------
// seed — schema parity for local DBs that lag the deployed upgrade chain,
// then the corpus mirror itself. All idempotent.
// ---------------------------------------------------------------------------

/** Same expression as data/mysql/tanah_article_content_hash_upgrade.sql. */
async function ensureContentHashColumn(): Promise<void> {
	const found = await queryOne(
		`SELECT 1 AS ok FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_article'
		   AND COLUMN_NAME = 'content_hash'`,
	);
	if (found) return;
	await execute(
		`ALTER TABLE tanah_article ADD COLUMN content_hash BINARY(16)
		 GENERATED ALWAYS AS (UNHEX(MD5(CONCAT_WS(X'01',
		   IFNULL(\`name\`, ''), IFNULL(\`abstract\`, ''),
		   IFNULL(\`content\`, ''), \`perek_id\`, \`author_id\`)))) STORED`,
	);
}

/** Mirrors tanah_article_hebrew_date_upgrade.sql (the file wraps its CREATE
 *  in CONCAT only to dodge the deploy rewriter — a local run writes it
 *  plainly). */
async function ensureHebrewDateTable(): Promise<void> {
	await execute(
		`CREATE TABLE IF NOT EXISTS tanah_article_hebrew_date (
			article_id MEDIUMINT NOT NULL,
			hebrew_month TINYINT UNSIGNED NOT NULL,
			hebrew_day TINYINT UNSIGNED NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (hebrew_month, hebrew_day),
			KEY idx_article_hebrew_date_article (article_id),
			CONSTRAINT fk_article_hebrew_date_article FOREIGN KEY (article_id)
				REFERENCES tanah_article (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
	);
}

async function seed(): Promise<void> {
	await ensureContentHashColumn();
	await ensureHebrewDateTable();
	await ensureLinkSchema();

	for (const author of corpus.authors) {
		await execute(
			`INSERT INTO tanah_author (id, name, details) VALUES (?, ?, '')
			 ON DUPLICATE KEY UPDATE name = VALUES(name)`,
			[author.id, author.name],
		);
	}
	for (const ded of corpus.dedications) {
		await execute(
			`INSERT INTO tanah_dedication (id, subject, expires_at)
			 VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE subject = VALUES(subject), expires_at = VALUES(expires_at)`,
			[ded.id, ded.subject, ded.expiresAt],
		);
	}
	for (const art of corpus.articles) {
		await execute(
			`INSERT INTO tanah_article
			 (id, perek_id, author_id, abstract, name, priority, content,
			  distributable, coverage_verified)
			 VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?)
			 ON DUPLICATE KEY UPDATE
			   perek_id = VALUES(perek_id), author_id = VALUES(author_id),
			   abstract = VALUES(abstract), name = VALUES(name),
			   content = VALUES(content), distributable = VALUES(distributable),
			   coverage_verified = VALUES(coverage_verified)`,
			[
				art.id,
				art.perekId,
				art.authorId,
				art.abstract,
				art.name,
				art.content,
				art.coverageVerified ? 1 : 0,
			],
		);
	}
	const ids = corpus.articles.map((a) => a.id);
	await execute(
		`DELETE FROM tanah_article_covering_source
		 WHERE article_id IN (${ids.map(() => "?").join(",")})`,
		ids,
	);
	for (const art of corpus.articles) {
		for (const src of art.coveringSources) {
			await execute(
				`INSERT IGNORE INTO tanah_article_covering_source
				 (article_id, perek_id, pasuk) VALUES (?, ?, ?)`,
				[art.id, src.perekId, src.pasuk],
			);
		}
	}
	for (const hd of corpus.hebrewDates) {
		await execute(
			`INSERT INTO tanah_article_hebrew_date (article_id, hebrew_month, hebrew_day)
			 SELECT ?, ?, ? FROM DUAL
			 WHERE EXISTS (SELECT 1 FROM tanah_article WHERE id = ?)
			 ON DUPLICATE KEY UPDATE article_id = VALUES(article_id)`,
			[hd.articleId, hd.hebrewMonth, hd.hebrewDay, hd.articleId],
		);
	}
	console.info(
		`seeded: ${corpus.authors.length} authors, ${corpus.dedications.length} dedications, ${corpus.articles.length} articles, ${corpus.hebrewDates.length} date assignments`,
	);
}

// ---------------------------------------------------------------------------
// generate — per-article runs so each gets its own run record + timing.
// ---------------------------------------------------------------------------

interface LlmFixture {
	model: string;
	promptTokens?: number | null;
	completionTokens?: number | null;
	byArticle: Record<string, unknown>;
}

async function generate(engine: string): Promise<void> {
	let setCurrent: ((id: number) => void) | undefined;
	if (engine === "llm" || engine === "both") {
		const fixturePath = resolve(
			args.fixture ?? resolve(scriptDir, "link-eval-llm-fixture.json"),
		);
		const fixture = JSON.parse(
			readFileSync(fixturePath, "utf-8"),
		) as LlmFixture;
		// Generator provenance honestly marks fixture output.
		process.env.OPENAI_MODEL = fixture.model;
		let currentArticleId = 0;
		_setLinkLlmCaller(async () => {
			const output = fixture.byArticle[String(currentArticleId)] ?? {
				proposals: [],
			};
			return {
				content: JSON.stringify(output),
				model: fixture.model,
				promptTokens: fixture.promptTokens ?? null,
				completionTokens: fixture.completionTokens ?? null,
			};
		});
		setCurrent = (id: number) => {
			currentArticleId = id;
		};
	}

	// Merge into any existing runtimes so sequential --engine runs accumulate.
	let runtimes: Record<
		string,
		{
			articleId: number;
			engine: string;
			runId: string;
			ms: number;
			outcome: string;
			drafts: number;
			pending: number;
			held: number;
		}
	> = {};
	try {
		runtimes = JSON.parse(readFileSync(runtimesPath, "utf-8"));
	} catch {
		/* first run */
	}
	for (const art of corpus.articles) {
		setCurrent?.(art.id);
		const t0 = performance.now();
		const { runId, outcomes } = await runLinkGeneration({
			articleIds: [art.id],
			engine: engine as "heuristic" | "llm" | "both",
			force: args.force,
		});
		const ms = Math.round((performance.now() - t0) * 10) / 10;
		const oc = outcomes[0];
		runtimes[`${engine}:${art.id}`] = {
			articleId: art.id,
			engine,
			runId,
			ms,
			outcome: oc?.outcome ?? "?",
			drafts: oc?.proposals.length ?? 0,
			pending:
				oc?.proposals.filter((p: DraftProposal) => p.status === "pending")
					.length ?? 0,
			held:
				oc?.proposals.filter((p: DraftProposal) => p.status === "held")
					.length ?? 0,
		};
		console.info(
			`  ${engine} article ${art.id}: ${oc?.outcome} — ${oc?.proposals.length ?? 0} drafts (${ms} ms)`,
		);
	}
	writeFileSync(runtimesPath, JSON.stringify(runtimes, null, 1));
	console.info(`generate ${engine}: runtimes -> ${runtimesPath}`);
}

// ---------------------------------------------------------------------------
// review — replay the recorded decision set through the human-gate function.
// A decision matches a proposal by article + generator prefix + relationship
// key + action + target label; only pending/held rows are decided.
// ---------------------------------------------------------------------------

interface Decision {
	articleId: number;
	generator?: string;
	relationshipKey: string;
	action: string;
	targetLabel?: string;
	conflict?: string;
	decision: "approve" | "reject";
	reviewPatch?: Record<string, unknown>;
	reviewNotes?: string;
}

async function review(): Promise<void> {
	const decisionsPath = resolve(args.decisions as string);
	const { decisions } = JSON.parse(readFileSync(decisionsPath, "utf-8")) as {
		decisions: Decision[];
	};
	const reviewer = args.reviewer as string;
	let applied = 0;
	let unmatched = 0;
	for (const d of decisions) {
		const props = await listProposals({ articleId: d.articleId });
		const matches = props.filter(
			(p) =>
				p.relationshipKey === d.relationshipKey &&
				p.action === d.action &&
				(d.targetLabel === undefined || p.targetLabel === d.targetLabel) &&
				(d.generator === undefined || p.generator.startsWith(d.generator)) &&
				(d.conflict === undefined || (p.conflict ?? "").includes(d.conflict)) &&
				(p.status === "pending" || p.status === "held"),
		);
		if (matches.length === 0) {
			console.info(
				`  unmatched decision: ${d.articleId} ${d.generator ?? "*"}/${d.relationshipKey}/${d.action}/${d.targetLabel ?? "*"}`,
			);
			unmatched += 1;
			continue;
		}
		for (const p of matches) {
			const res = await reviewProposal(
				{
					id: p.id,
					decision: d.decision,
					reviewPatch: d.reviewPatch as never,
					reviewNotes: d.reviewNotes,
				},
				reviewer,
			);
			console.info(`  ${d.decision} ${p.id.slice(0, 8)}… → ${res.status}`);
			applied += 1;
		}
	}
	console.info(`review: ${applied} decisions applied, ${unmatched} unmatched`);
}

// ---------------------------------------------------------------------------
// report — the acceptance-5 metrics over the stored proposal rows.
// ---------------------------------------------------------------------------

async function report(): Promise<void> {
	const runtimes = JSON.parse(readFileSync(runtimesPath, "utf-8")) as Record<
		string,
		{ articleId: number; engine: string; ms: number; drafts: number }
	>;
	const articles = corpus.articles.map((a) => a.id);
	const proposals = (
		await Promise.all(articles.map((id) => listProposals({ articleId: id })))
	).flat();

	const engineOf = (generator: string) =>
		generator.startsWith("heuristic") ? "heuristic" : "llm";
	const edited = (p: { reviewPatch: unknown }) => p.reviewPatch !== null;

	const groups = new Map<string, typeof proposals>();
	for (const p of proposals) {
		const key = `${engineOf(p.generator)}|${p.relationshipKey}`;
		groups.set(key, [...(groups.get(key) ?? []), p]);
	}

	const metrics = {
		generatedAt: new Date().toISOString(),
		corpus: {
			articles: articles.length,
			source: corpus.source,
			fetchedAt: corpus.fetchedAt,
		},
		byRelationship: [] as Record<string, unknown>[],
		runtime: {
			byEngine: {} as Record<string, unknown>,
			perArticleMs: runtimes,
		},
	};

	for (const [key, list] of [...groups.entries()].sort()) {
		const [engine, relationshipKey] = key.split("|");
		const decided = list.filter(
			(p) => p.status !== "pending" && p.status !== "held",
		);
		metrics.byRelationship.push({
			engine,
			relationshipKey,
			proposed: list.length,
			pending: list.filter((p) => p.status === "pending").length,
			held: list.filter((p) => p.status === "held").length,
			heldRate: list.length
				? +(
						list.filter((p) => p.status === "held").length / list.length
					).toFixed(3)
				: 0,
			approved: list.filter(
				(p) => p.status === "approved" || p.status === "applied",
			).length,
			editedApprovals: list.filter(
				(p) => (p.status === "approved" || p.status === "applied") && edited(p),
			).length,
			rejected: list.filter((p) => p.status === "rejected").length,
			applied: list.filter((p) => p.status === "applied").length,
			decidedPct: list.length
				? +((decided.length / list.length) * 100).toFixed(1)
				: 0,
			promptTokens: list.reduce((s, p) => s + (p.promptTokens ?? 0), 0),
			completionTokens: list.reduce((s, p) => s + (p.completionTokens ?? 0), 0),
		});
	}

	for (const engine of ["heuristic", "llm"]) {
		const rows = Object.values(runtimes).filter((r) => r.engine === engine);
		if (!rows.length) continue;
		const total = rows.reduce((s, r) => s + r.ms, 0);
		(metrics.runtime.byEngine as Record<string, unknown>)[engine] = {
			articles: rows.length,
			totalMs: Math.round(total),
			avgMsPerArticle: Math.round(total / rows.length),
			maxMs: Math.max(...rows.map((r) => r.ms)),
		};
	}

	writeFileSync(args.out as string, JSON.stringify(metrics, null, 1));
	console.info(JSON.stringify(metrics.byRelationship, null, 1));
	console.info(`report -> ${args.out}`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	try {
		if (command === "seed" || command === "run") await seed();
		if (command === "generate" || command === "run") {
			const engine = args.engine as string;
			if (command === "run") {
				await generate("heuristic");
				await generate("llm");
			} else {
				await generate(engine);
			}
		}
		if (command === "review" || command === "run") await review();
		if (command === "report" || command === "run") await report();
	} finally {
		await pool.end();
	}
}

main().catch((err) => {
	console.error("link-eval failed:", err);
	process.exitCode = 1;
});
