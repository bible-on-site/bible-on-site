import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const conn = { marker: "tx-conn" };
	return {
		conn,
		execute: vi.fn(),
		query: vi.fn(),
		queryOne: vi.fn(),
		txExecute: vi.fn(),
		txQueryOne: vi.fn(),
		transaction: vi.fn(async (fn: (c: typeof conn) => unknown) => fn(conn)),
		updateApi: vi.fn(),
		applyDed: vi.fn(),
		llmCall: vi.fn(),
		apiConfigured: vi.fn(() => true),
		llmIsConfigured: vi.fn(() => true),
	};
});

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));
vi.mock("~/server/db", () => ({
	execute: mocks.execute,
	query: mocks.query,
	queryOne: mocks.queryOne,
	transaction: mocks.transaction,
	txExecute: mocks.txExecute,
	txQueryOne: mocks.txQueryOne,
}));
vi.mock("~/server/article-relationships-api", () => ({
	articleApiConfigured: mocks.apiConfigured,
	updateArticleRelationships: mocks.updateApi,
}));
vi.mock("~/server/dedication-targets.server", () => ({
	applyArticleDedicationLink: mocks.applyDed,
}));
vi.mock("~/server/editor-identity", () => ({
	resolveEditorIdentity: async () => ({ id: "editor-test" }),
}));
vi.mock("~/server/llm-json", () => ({
	callOpenAiJson: mocks.llmCall,
	llmConfigured: mocks.llmIsConfigured,
}));

import {
	_resetLinkSchemaCache,
	_setLinkLlmCaller,
} from "~/server/article-link-pipeline";
import {
	applyLinkProposals,
	generateLinkProposals,
	getLinkPipelineStatus,
	getLinkProposal,
	listLinkProposals,
	listLinkRuns,
	reviewLinkProposal,
} from "~/server/article-link-proposals";

const HASH = "abcdef0123456789abcdef0123456789";

const articleRow = {
	id: 7,
	perek_id: 1,
	author_id: 2,
	name: "מאמר בדיקה",
	abstract: null,
	content: "<p>המאמר דן בבראשית יח, ב ובשמואל ב ה, ז.</p>",
	coverage_verified: 1,
	content_hash: HASH,
};

const perakimRows = [
	{
		id: 1,
		sefer_name: "בראשית",
		additional_letter: null,
		perek_in_context: 1,
		pasuk_count: 31,
	},
	{
		id: 18,
		sefer_name: "בראשית",
		additional_letter: null,
		perek_in_context: 18,
		pasuk_count: 33,
	},
	{
		id: 605,
		sefer_name: "שמואל",
		additional_letter: "ב",
		perek_in_context: 5,
		pasuk_count: 25,
	},
];

function dispatchQuery(sql: string): unknown[] {
	if (sql.includes("tanah_perek_view")) return perakimRows;
	if (sql.includes("FROM tanah_author")) return [{ id: 2, name: "הרב קוק" }];
	if (sql.includes("FROM tanah_dedication"))
		return [{ id: 5, subject: "לעילוי נשמת" }];
	if (sql.includes("tanah_article_covering_source"))
		return [{ perekId: 1, pasuk: 1 }];
	if (sql.includes("tanah_article_dedication")) return [];
	if (sql.includes("tanah_article_link_proposal")) return proposalRows;
	if (sql.includes("tanah_article_link_checkpoint")) return [];
	if (sql.includes("FROM tanah_article WHERE id")) return [];
	return [];
}

function dispatchQueryOne(sql: string): unknown {
	if (sql.includes("AS h FROM tanah_article")) return { h: HASH };
	if (sql.includes("FROM tanah_article WHERE id")) return articleRow;
	if (sql.includes("tanah_article_link_checkpoint")) return null;
	if (sql.includes("tanah_article_link_proposal")) return proposalRow;
	return null;
}

let proposalRows: unknown[] = [];
let proposalRow: Record<string, unknown> | null = null;

function makeProposalRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "prop-1",
		run_id: "run-1",
		article_id: 7,
		relationship_key: "coveringSources",
		action: "add",
		target_json: JSON.stringify({
			pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
		}),
		target_label: "בראשית יח ב",
		evidence_json: JSON.stringify([
			{ quote: "בראשית יח, ב", spanStart: 20, spanEnd: 34 },
		]),
		rationale: null,
		confidence: null,
		conflict: null,
		status: "approved",
		dedupe_key: "d".repeat(64),
		decision_key: "e".repeat(64),
		generator: "heuristic-citations:v1",
		model: null,
		prompt_version: "linking-v1",
		base_content_hash: HASH,
		base_snapshot_json: null,
		prompt_tokens: null,
		completion_tokens: null,
		review_patch_json: null,
		review_notes: null,
		reviewer: "editor-test",
		reviewed_at: null,
		applied_at: null,
		applied_snapshot_json: null,
		created_at: "2026-01-01 00:00:00",
		updated_at: "2026-01-01 00:00:00",
		live_hash: HASH,
		...overrides,
	};
}

const apiResult = {
	revalidation: "APPLIED",
	relationships: {
		perekId: 1,
		authorId: 2,
		coverageVerified: true,
		contentHash: HASH,
		coveringSources: [
			{ perekId: 1, pasuk: 1 },
			{ perekId: 18, pasuk: 2 },
		],
	},
	previous: {
		perekId: 1,
		authorId: 2,
		coverageVerified: true,
		contentHash: HASH,
		coveringSources: [{ perekId: 1, pasuk: 1 }],
	},
};

describe("article link proposals server", () => {
	beforeEach(() => {
		for (const mock of [
			mocks.execute,
			mocks.query,
			mocks.queryOne,
			mocks.txExecute,
			mocks.txQueryOne,
			mocks.updateApi,
			mocks.applyDed,
			mocks.llmCall,
			mocks.apiConfigured,
			mocks.llmIsConfigured,
		])
			mock.mockReset();
		mocks.apiConfigured.mockReturnValue(true);
		mocks.llmIsConfigured.mockReturnValue(true);
		mocks.execute.mockResolvedValue({ affectedRows: 0 });
		mocks.txExecute.mockResolvedValue({ affectedRows: 1, insertId: 1 });
		mocks.query.mockImplementation(async (sql: string) => dispatchQuery(sql));
		mocks.queryOne.mockImplementation(async (sql: string) =>
			dispatchQueryOne(sql),
		);
		mocks.updateApi.mockResolvedValue(apiResult);
		mocks.applyDed.mockResolvedValue({ changed: true });
		proposalRows = [];
		proposalRow = null;
		_resetLinkSchemaCache();
		_setLinkLlmCaller(null);
	});

	describe("generateLinkProposals", () => {
		it("inserts heuristic drafts and a checkpoint in one transaction", async () => {
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
			expect(result.outcomes[0].proposals.length).toBeGreaterThan(0);
			const sqls = mocks.txExecute.mock.calls.map((c) => String(c[1]));
			expect(
				sqls.some((s) =>
					s.includes("INSERT IGNORE INTO tanah_article_link_proposal"),
				),
			).toBe(true);
			expect(
				sqls.some((s) => s.includes("tanah_article_link_checkpoint")),
			).toBe(true);
		});

		it("persists nothing on dry-run", async () => {
			const result = await generateLinkProposals({
				data: { articleIds: [7], dryRun: true },
			});
			expect(result.outcomes[0].outcome).toBe("dry-run");
			expect(
				mocks.txExecute.mock.calls.some((c) =>
					String(c[1]).includes("tanah_article_link_proposal"),
				),
			).toBe(false);
		});

		it("produces drafts through the injected LLM caller", async () => {
			_setLinkLlmCaller(async () => ({
				content: JSON.stringify({
					proposals: [
						{
							relationshipKey: "coveringSources",
							action: "add",
							target: {
								citations: [
									{ sefer: "שמואל", additional: "ב", perek: "ה", pasuk: "ז" },
								],
							},
							evidence: [{ quote: "שמואל ב ה, ז" }],
							confidence: 0.8,
						},
					],
				}),
				model: "mock-model",
				promptTokens: 10,
				completionTokens: 5,
			}));
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "llm" },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
			const llmDrafts = result.outcomes[0].proposals.filter(
				(d) => d.confidence !== null,
			);
			expect(llmDrafts.length).toBeGreaterThan(0);
		});
	});

	describe("reviewLinkProposal", () => {
		it("approves a pending proposal and records the reviewer", async () => {
			proposalRow = makeProposalRow({ status: "pending" });
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await reviewLinkProposal({
				data: { id: "prop-1", decision: "approve" },
			});
			expect(result.status).toBe("approved");
			const update = mocks.txExecute.mock.calls.find((c) =>
				String(c[1]).includes("SET status = 'approved'"),
			);
			expect(update).toBeTruthy();
			expect(update?.[2]?.[0]).toBe("editor-test");
		});

		it("rejects and keeps the row in history", async () => {
			proposalRow = makeProposalRow({ status: "pending" });
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await reviewLinkProposal({
				data: { id: "prop-1", decision: "reject", reviewNotes: "לא רלוונטי" },
			});
			expect(result.status).toBe("rejected");
		});

		it("refuses approving a held proposal without a patch", async () => {
			proposalRow = makeProposalRow({ status: "held" });
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			await expect(
				reviewLinkProposal({
					data: { id: "prop-1", decision: "approve" },
				}),
			).rejects.toThrow(/מוקפאת|תיקון/);
		});

		it("refuses approving when the article changed since generation", async () => {
			proposalRow = makeProposalRow({ status: "pending" });
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("HEX(content_hash)")) return { h: "0".repeat(32) };
				return dispatchQueryOne(sql);
			});
			await expect(
				reviewLinkProposal({
					data: { id: "prop-1", decision: "approve" },
				}),
			).rejects.toThrow(/השתנה/);
		});
	});

	describe("applyLinkProposals", () => {
		it("applies an approved covering add through the API contract", async () => {
			proposalRow = makeProposalRow();
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("applied");
			expect(mocks.updateApi).toHaveBeenCalledOnce();
			const input = mocks.updateApi.mock.calls[0][1] as {
				coveringSources?: { perekId: number; pasuk: number }[];
				expectedContentHash?: string;
			};
			expect(input.coveringSources).toContainEqual({ perekId: 18, pasuk: 2 });
			expect(input.expectedContentHash).toBe(HASH);
			expect(
				mocks.txExecute.mock.calls.some((c) =>
					String(c[1]).includes("SET status = 'applied'"),
				),
			).toBe(true);
		});

		it("marks the proposal stale when content changed", async () => {
			proposalRow = makeProposalRow();
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("HEX(content_hash)")) return { h: "0".repeat(32) };
				return dispatchQueryOne(sql);
			});
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("stale");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it("returns already-applied on repeat apply", async () => {
			proposalRow = makeProposalRow({ status: "applied" });
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("already-applied");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it("completes the record when the live state already matches", async () => {
			// Retry after a crash between the write and the mark: the covering
			// set already contains the proposed coordinate.
			proposalRow = makeProposalRow();
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_covering_source")) {
					return [
						{ perekId: 1, pasuk: 1 },
						{ perekId: 18, pasuk: 2 },
					];
				}
				return dispatchQuery(sql);
			});
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("already-applied");
		});

		it("refuses applying a non-approved proposal", async () => {
			proposalRow = makeProposalRow({ status: "pending" });
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("error");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});
	});

	describe("listLinkProposals", () => {
		it("maps rows and flags stale proposals", async () => {
			proposalRows = [
				makeProposalRow({ live_hash: "0".repeat(32) }),
				makeProposalRow({ id: "prop-2", status: "pending" }),
			];
			const rows = await listLinkProposals({ data: {} });
			expect(rows).toHaveLength(2);
			expect(rows[0].staleNow).toBe(true);
			expect(rows[1].staleNow).toBe(false);
		});

		it("applies status/article/run filters and a bounded limit", async () => {
			await listLinkProposals({
				data: {
					status: "pending",
					articleId: 7,
					runId: "run-1",
					limit: 9000,
				},
			});
			const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
			expect(sql).toContain("p.status = ?");
			expect(sql).toContain("p.article_id = ?");
			expect(sql).toContain("p.run_id = ?");
			expect(params).toEqual(["pending", 7, "run-1", 500]);
		});
	});

	describe("generateLinkProposals validation", () => {
		it("rejects an empty article list", () => {
			expect(() => generateLinkProposals({ data: { articleIds: [] } })).toThrow(
				/מאמר/,
			);
		});

		it("rejects a run above the per-run cap", () => {
			expect(() =>
				generateLinkProposals({
					data: { articleIds: Array.from({ length: 501 }, (_, i) => i + 1) },
				}),
			).toThrow(/מאמרים/);
		});
	});

	describe("generateLinkProposals outcomes", () => {
		it("reports an error for a missing article", async () => {
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("FROM tanah_article WHERE id")) return null;
				return dispatchQueryOne(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("error");
			expect(result.outcomes[0].error).toBe("article not found");
		});

		it("skips an article whose checkpoint is fresh", async () => {
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_link_checkpoint"))
					return { article_id: 7 };
				return dispatchQueryOne(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("skipped-checkpoint");
		});

		it("regenerates over a fresh checkpoint when forced", async () => {
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_link_checkpoint"))
					return { article_id: 7 };
				return dispatchQueryOne(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7], force: true },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
		});

		it("reports the missing key for an llm engine without credentials", async () => {
			mocks.llmIsConfigured.mockReturnValue(false);
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "llm" },
			});
			expect(result.outcomes[0].outcome).toBe("error");
			expect(result.outcomes[0].error).toContain("OPENAI_API_KEY");
		});

		it("records invalid model JSON as a per-article error", async () => {
			_setLinkLlmCaller(async () => ({
				content: "not json at all",
				model: "mock",
				promptTokens: null,
				completionTokens: null,
			}));
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "llm" },
			});
			expect(result.outcomes[0].outcome).toBe("error");
			expect(result.outcomes[0].error).toContain("JSON");
		});

		it("notes the dedupe count when INSERT IGNORE swallows rows", async () => {
			mocks.txExecute.mockResolvedValue({ affectedRows: 0, insertId: 0 });
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].error).toContain("dedupe");
		});
	});

	describe("reviewLinkProposal edge paths", () => {
		it.each([undefined, { authorId: 99 }])(
			"refuses to approve a legacy author proposal with patch %j",
			async (reviewPatch) => {
				mocks.txQueryOne.mockResolvedValue(
					makeProposalRow({
						relationship_key: "author",
						status: "pending",
					}),
				);
				await expect(
					reviewLinkProposal({
						data: { id: "prop-1", decision: "approve", reviewPatch },
					}),
				).rejects.toThrow(/author attribution is fixed/);
				expect(mocks.txExecute).not.toHaveBeenCalled();
				expect(mocks.updateApi).not.toHaveBeenCalled();
			},
		);

		it("allows rejection of a legacy author proposal", async () => {
			mocks.txQueryOne.mockResolvedValue(
				makeProposalRow({ relationship_key: "author", status: "pending" }),
			);
			const result = await reviewLinkProposal({
				data: { id: "prop-1", decision: "reject" },
			});
			expect(result.status).toBe("rejected");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it("throws when the proposal does not exist", async () => {
			mocks.txQueryOne.mockResolvedValue(null);
			await expect(
				reviewLinkProposal({ data: { id: "nope", decision: "approve" } }),
			).rejects.toThrow(/לא נמצאה/);
		});

		it("refuses to review an applied proposal", async () => {
			mocks.txQueryOne.mockResolvedValue(
				makeProposalRow({ status: "applied" }),
			);
			await expect(
				reviewLinkProposal({ data: { id: "prop-1", decision: "reject" } }),
			).rejects.toThrow(/יושמה/);
		});

		it("treats a repeat reject as idempotent", async () => {
			mocks.txQueryOne.mockResolvedValue(
				makeProposalRow({ status: "rejected" }),
			);
			const result = await reviewLinkProposal({
				data: { id: "prop-1", decision: "reject" },
			});
			expect(result.status).toBe("rejected");
		});

		it("stores a normalized human patch on approve", async () => {
			mocks.txQueryOne.mockResolvedValue(makeProposalRow({ status: "held" }));
			const result = await reviewLinkProposal({
				data: {
					id: "prop-1",
					decision: "approve",
					reviewPatch: {
						pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
					},
				},
			});
			expect(result.status).toBe("approved");
			const update = mocks.txExecute.mock.calls.find((c) =>
				String(c[1]).includes("review_patch_json = ?"),
			);
			expect(update?.[2]?.[0]).toBe("editor-test");
			expect(update?.[2]?.[1]).toBe(
				JSON.stringify({ pasukCoordinates: [{ perekId: 18, pasuk: 2 }] }),
			);
		});

		it("rejects an invalid human patch", async () => {
			mocks.txQueryOne.mockResolvedValue(makeProposalRow({ status: "held" }));
			await expect(
				reviewLinkProposal({
					data: {
						id: "prop-1",
						decision: "approve",
						reviewPatch: {
							pasukCoordinates: [{ perekId: 9999, pasuk: 1 }],
						},
					},
				}),
			).rejects.toThrow(/אינו חוקי/);
		});
	});

	describe("applyLinkProposals edge paths", () => {
		it("requires the API write path to be configured", async () => {
			mocks.apiConfigured.mockReturnValue(false);
			await expect(
				applyLinkProposals({ data: { ids: ["prop-1"] } }),
			).rejects.toThrow(/ARTICLE_API_KEY/);
		});

		it("rejects an empty id list at the validator", () => {
			expect(() => applyLinkProposals({ data: { ids: [] } })).toThrow(/הצעות/);
		});

		it("reports a missing proposal row", async () => {
			mocks.txQueryOne.mockResolvedValue(null);
			const result = await applyLinkProposals({
				data: { ids: ["nope"] },
			});
			expect(result.outcomes[0]).toEqual({
				id: "nope",
				outcome: "error",
				detail: "not found",
			});
		});

		it("marks a conflict when the plan cannot apply", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "primaryPerek",
				action: "add",
				target_json: JSON.stringify({ perekId: 18 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it("marks a conflict when the API rejects the write", async () => {
			proposalRow = makeProposalRow();
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			mocks.updateApi.mockRejectedValue(new Error("freshness mismatch"));
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
			expect(result.outcomes[0].detail).toContain("freshness mismatch");
		});

		it("applies a dedication assignment through the aggregate", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "dedicationAssignments",
				target_json: JSON.stringify({ dedicationId: 5 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("applied");
			expect(mocks.applyDed).toHaveBeenCalledWith(
				expect.objectContaining({
					dedicationId: 5,
					articleId: 7,
					op: "add",
				}),
			);
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it("completes a dedication retry when the link already exists", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "dedicationAssignments",
				target_json: JSON.stringify({ dedicationId: 5 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			mocks.applyDed.mockResolvedValue({ changed: false });
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_dedication"))
					return [{ dedication_id: 5 }];
				return dispatchQuery(sql);
			});
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("already-applied");
		});

		it("marks a conflict when the dedication write is refused", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "dedicationAssignments",
				target_json: JSON.stringify({ dedicationId: 5 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			mocks.applyDed.mockResolvedValue({
				changed: false,
				reason: "dedication retired",
			});
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
			expect(result.outcomes[0].detail).toContain("dedication retired");
		});
	});

	describe("getLinkProposal / listLinkRuns / status", () => {
		it("returns the detail view with the live snapshot", async () => {
			proposalRow = makeProposalRow();
			mocks.queryOne.mockImplementation(async (sql: string) =>
				sql.includes("SELECT name FROM tanah_article")
					? { name: "מאמר בדיקה" }
					: dispatchQueryOne(sql),
			);
			const detail = await getLinkProposal({ data: "prop-1" });
			expect(detail?.articleName).toBe("מאמר בדיקה");
			expect(detail?.liveContentHash).toBe(HASH);
			expect(detail?.liveSnapshot.coveringSources).toEqual([
				{ perekId: 1, pasuk: 1 },
			]);
		});

		it("returns null for a missing proposal", async () => {
			mocks.queryOne.mockImplementation(async () => null);
			expect(await getLinkProposal({ data: "nope" })).toBeNull();
		});

		it("maps run summaries", async () => {
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("GROUP BY run_id")) {
					return [
						{
							run_id: "run-9",
							generator: "heuristic-citations:v1",
							proposals: 3,
							pending: 1,
							held: 1,
							approved: 1,
							applied: 0,
							rejected: 0,
							started_at: "2026-01-01 00:00:00",
						},
					];
				}
				return dispatchQuery(sql);
			});
			const runs = await listLinkRuns({});
			expect(runs).toHaveLength(1);
			expect(runs[0].runId).toBe("run-9");
			expect(runs[0].pending).toBe(1);
		});

		it("surfaces pipeline capability", async () => {
			const status = await getLinkPipelineStatus({});
			expect(status.schemaReady).toBe(true);
			expect(status.llmEnabled).toBe(true);
			expect(status.articleApiConfigured).toBe(true);
			expect(status.supportedKeys).toContain("coveringSources");
			expect(status.supportedKeys).not.toContain("author");
			expect(status.supportedKeys).toContain("moadim");
			expect(status.pendingKeys).toContain("recurringHebrewDate");
		});

		it("reports the schema as not deployed when ensure fails", async () => {
			mocks.execute.mockRejectedValue(
				Object.assign(new Error("missing"), {
					code: "ER_NO_SUCH_TABLE",
				}),
			);
			const status = await getLinkPipelineStatus({});
			expect(status.schemaReady).toBe(false);
		});
	});

	describe("schema-missing and parse fallbacks", () => {
		it("generates when the covering-source columns are absent", async () => {
			const schemaErr = Object.assign(new Error("bad column"), {
				code: "ER_BAD_FIELD_ERROR",
			});
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("HEX(content_hash)")) throw schemaErr;
				if (sql.includes("0 AS coverage_verified")) return articleRow;
				return dispatchQueryOne(sql);
			});
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_covering_source")) throw schemaErr;
				return dispatchQuery(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
		});

		it("survives an unparseable stored JSON column", async () => {
			proposalRows = [
				makeProposalRow({ target_json: "{broken", evidence_json: "[" }),
			];
			const rows = await listLinkProposals({ data: {} });
			expect(rows).toHaveLength(1);
			expect(rows[0].target).toEqual({});
		});
	});

	describe("applyLinkProposals idempotency", () => {
		it("completes a covering remove the live state already satisfies", async () => {
			proposalRow = makeProposalRow({
				action: "remove",
				target_json: JSON.stringify({
					pasukCoordinates: [{ perekId: 18, pasuk: 9 }],
				}),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("already-applied");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it("marks a conflict for a dedication target without an id", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "dedicationAssignments",
				target_json: JSON.stringify({ dedicationId: "x" }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
		});

		it("marks a conflict for a dedication action outside add/remove", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "dedicationAssignments",
				action: "replace",
				target_json: JSON.stringify({ dedicationId: 5 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
		});

		it("processes every id in the batch", async () => {
			mocks.txQueryOne
				.mockResolvedValueOnce(makeProposalRow())
				.mockResolvedValueOnce(
					makeProposalRow({ id: "prop-2", status: "applied" }),
				);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1", "prop-2"] },
			});
			expect(result.outcomes).toHaveLength(2);
			expect(result.outcomes[1].outcome).toBe("already-applied");
		});
	});

	describe("LLM generation fallbacks", () => {
		it("labels catalogue misses with raw identifiers", async () => {
			_setLinkLlmCaller(async () => ({
				content: JSON.stringify({ proposals: [] }),
				model: "mock",
				promptTokens: null,
				completionTokens: null,
			}));
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("FROM tanah_article WHERE id"))
					return { ...articleRow, perek_id: 999 };
				return dispatchQueryOne(sql);
			});
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_covering_source"))
					return [{ perekId: 999, pasuk: 1 }];
				return dispatchQuery(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "llm" },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
		});
	});

	describe("row mapping and loader fallbacks", () => {
		it("passes through mysql2-parsed JSON columns", async () => {
			proposalRows = [
				makeProposalRow({
					target_json: {
						pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
					} as unknown as string,
				}),
			];
			const rows = await listLinkProposals({ data: {} });
			expect(rows[0].target).toEqual({
				pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
			});
		});

		it("maps nullable row fields to their empty defaults", async () => {
			proposalRows = [
				makeProposalRow({
					live_hash: undefined,
					confidence: "0.750",
					reviewed_at: new Date("2026-02-02T10:00:00Z"),
					created_at: null,
					updated_at: null,
				}),
			];
			const rows = await listLinkProposals({ data: {} });
			expect(rows[0].confidence).toBe(0.75);
			expect(rows[0].reviewedAt).toBe("2026-02-02T10:00:00.000Z");
			expect(rows[0].createdAt).toBe("");
			expect(rows[0].updatedAt).toBe("");
			expect(rows[0].staleNow).toBe(false);
		});

		it("lists proposals without a filter payload", async () => {
			await listLinkProposals({ data: undefined });
			expect(mocks.query).toHaveBeenCalled();
		});

		it("rethrows non-schema errors from the article loader", async () => {
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (
					sql.includes("coverage_verified") &&
					sql.includes("FROM tanah_article")
				)
					throw new Error("connection lost");
				return dispatchQueryOne(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("error");
			expect(result.outcomes[0].error).toBe("connection lost");
		});

		it("rethrows non-schema errors from the covering-source loader", async () => {
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_covering_source"))
					throw new Error("covering boom");
				return dispatchQuery(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("error");
			expect(result.outcomes[0].error).toBe("covering boom");
		});

		it("fails the article when its row vanishes between reads", async () => {
			let articleReads = 0;
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (
					sql.includes("coverage_verified") &&
					sql.includes("FROM tanah_article")
				) {
					articleReads += 1;
					return articleReads === 1 ? articleRow : null;
				}
				return dispatchQueryOne(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("error");
			expect(result.outcomes[0].error).toContain("לא נמצא");
		});

		it("treats a missing stored content hash as empty", async () => {
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (
					sql.includes("coverage_verified") &&
					sql.includes("FROM tanah_article")
				)
					return { ...articleRow, content_hash: null };
				return dispatchQueryOne(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
		});

		it("generates for an article without content", async () => {
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (
					sql.includes("coverage_verified") &&
					sql.includes("FROM tanah_article")
				)
					return { ...articleRow, content: null, abstract: "תקציר" };
				return dispatchQueryOne(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
		});

		it("returns an empty live hash when the hash row is gone", async () => {
			proposalRow = makeProposalRow();
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("AS h FROM tanah_article")) return null;
				return dispatchQueryOne(sql);
			});
			const detail = await getLinkProposal({ data: "prop-1" });
			expect(detail?.liveContentHash).toBe("");
		});

		it("falls back to an empty live hash when the column is undeployed", async () => {
			const schemaErr = Object.assign(new Error("bad column"), {
				code: "ER_BAD_FIELD_ERROR",
			});
			proposalRow = makeProposalRow();
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("AS h FROM tanah_article")) throw schemaErr;
				return dispatchQueryOne(sql);
			});
			const detail = await getLinkProposal({ data: "prop-1" });
			expect(detail?.liveContentHash).toBe("");
		});

		it("surfaces a live-hash read failure", async () => {
			proposalRow = makeProposalRow();
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("AS h FROM tanah_article"))
					throw new Error("hash boom");
				return dispatchQueryOne(sql);
			});
			await expect(getLinkProposal({ data: "prop-1" })).rejects.toThrow(
				"hash boom",
			);
		});

		it("falls back to the numeric article id when the name row is gone", async () => {
			proposalRow = makeProposalRow();
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("SELECT name FROM tanah_article")) return null;
				return dispatchQueryOne(sql);
			});
			const detail = await getLinkProposal({ data: "prop-1" });
			expect(detail?.articleName).toBe("#7");
		});

		it("maps a run with a null start timestamp", async () => {
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("GROUP BY run_id")) {
					return [
						{
							run_id: "run-x",
							generator: "heuristic-citations:v1",
							proposals: 1,
							pending: 0,
							held: 0,
							approved: 0,
							applied: 0,
							rejected: 0,
							started_at: null,
						},
					];
				}
				return dispatchQuery(sql);
			});
			const runs = await listLinkRuns({});
			expect(runs[0].startedAt).toBe("");
		});
	});

	describe("generation prompt and draft edge paths", () => {
		it("labels missing catalogue entries with null names in the prompt", async () => {
			_setLinkLlmCaller(async () => ({
				content: JSON.stringify({ proposals: [] }),
				model: "mock",
				promptTokens: null,
				completionTokens: null,
			}));
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (
					sql.includes("coverage_verified") &&
					sql.includes("FROM tanah_article")
				)
					return { ...articleRow, perek_id: 999, author_id: 99 };
				return dispatchQueryOne(sql);
			});
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_dedication"))
					return [{ dedication_id: 5 }, { dedication_id: 99 }];
				if (sql.includes("tanah_article_covering_source"))
					return [{ perekId: 999, pasuk: 1 }];
				return dispatchQuery(sql);
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "llm" },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
		});

		it("reports partial inserts when dedupe drops drafts", async () => {
			mocks.txExecute.mockResolvedValue({ affectedRows: 0, insertId: 0 });
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
			expect(result.outcomes[0].error).toContain("dedupe");
		});

		it("records a non-Error generator failure as a string", async () => {
			_setLinkLlmCaller(async () => {
				throw "kaput";
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "llm" },
			});
			expect(result.outcomes[0].outcome).toBe("error");
			expect(result.outcomes[0].error).toBe("kaput");
		});

		it("inserts pending and held drafts with their conflict fields", async () => {
			_setLinkLlmCaller(async () => ({
				content: JSON.stringify({
					proposals: [
						{
							relationshipKey: "coveringSources",
							action: "add",
							target: {
								citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }],
							},
							evidence: [{ quote: "בראשית יח, ב" }],
						},
						{
							relationshipKey: "coveringSources",
							action: "add",
							target: {
								citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ג" }],
							},
							evidence: [{ quote: "ציטוט שלא קיים במאמר" }],
						},
					],
				}),
				model: "mock",
				promptTokens: null,
				completionTokens: null,
			}));
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "llm" },
			});
			expect(result.outcomes[0].outcome).toBe("generated");
			expect(result.outcomes[0].proposals.map((p) => p.status).sort()).toEqual([
				"held",
				"pending",
			]);
		});
	});

	describe("reviewLinkProposal remaining paths", () => {
		it("rejects without optional notes", async () => {
			proposalRow = makeProposalRow({ status: "pending" });
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await reviewLinkProposal({
				data: { id: "prop-1", decision: "reject" },
			});
			expect(result.status).toBe("rejected");
		});
	});

	describe("applyLinkProposals idempotency edges", () => {
		it("maps an unparseable stored target to the empty patch", async () => {
			proposalRow = makeProposalRow({ target_json: "{broken" });
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("already-applied");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it("completes a redundant primaryPerek replace as already applied", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "primaryPerek",
				action: "replace",
				target_json: JSON.stringify({ perekId: 1 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("already-applied");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it.each([2, 99])(
			"blocks a legacy approved author replace targeting %i",
			async (authorId) => {
				proposalRow = makeProposalRow({
					relationship_key: "author",
					action: "replace",
					target_json: JSON.stringify({ authorId }),
				});
				mocks.txQueryOne.mockResolvedValue(proposalRow);
				const result = await applyLinkProposals({
					data: { ids: ["prop-1"] },
				});
				expect(result.outcomes[0].outcome).toBe("conflict");
				expect(result.outcomes[0].detail).toContain(
					"author attribution is fixed",
				);
				expect(mocks.updateApi).not.toHaveBeenCalled();
				expect(mocks.applyDed).not.toHaveBeenCalled();
			},
		);

		it("conflicts an author action the write contract cannot express", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "author",
				action: "add",
				target_json: JSON.stringify({ authorId: 2 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
			expect(mocks.updateApi).not.toHaveBeenCalled();
		});

		it("conflicts a proposal key with no write path", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "moadim",
				action: "add",
				target_json: JSON.stringify({ moedName: "סוכות" }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
			expect(result.outcomes[0].detail).toContain("no applicable write path");
		});

		it("completes a dedication remove the live state already satisfies", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "dedicationAssignments",
				action: "remove",
				target_json: JSON.stringify({ dedicationId: 5 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("already-applied");
		});

		it("conflicts when the dedication write refuses without a reason", async () => {
			proposalRow = makeProposalRow({
				relationship_key: "dedicationAssignments",
				target_json: JSON.stringify({ dedicationId: 5 }),
			});
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			mocks.applyDed.mockResolvedValue({ changed: false });
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
			expect(result.outcomes[0].detail).toBeUndefined();
			expect(
				mocks.txExecute.mock.calls.some((c) =>
					String(c[2]?.[0]).includes("dedication write refused"),
				),
			).toBe(true);
		});

		it("records a non-Error API rejection", async () => {
			proposalRow = makeProposalRow();
			mocks.txQueryOne.mockResolvedValue(proposalRow);
			mocks.updateApi.mockRejectedValue("api exploded");
			const result = await applyLinkProposals({
				data: { ids: ["prop-1"] },
			});
			expect(result.outcomes[0].outcome).toBe("conflict");
			expect(result.outcomes[0].detail).toBe("api exploded");
		});
	});

	describe("pipeline status", () => {
		it("reports llmEnabled for an injected caller without server config", async () => {
			mocks.llmIsConfigured.mockReturnValue(false);
			_setLinkLlmCaller(async () => ({
				content: "{}",
				model: "mock",
				promptTokens: null,
				completionTokens: null,
			}));
			const status = await getLinkPipelineStatus({});
			expect(status.llmEnabled).toBe(true);
		});
	});
});
