import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const conn = { marker: "tx-conn" };
	return {
		conn,
		promote: vi.fn().mockResolvedValue([]),
		literalGuard: vi.fn().mockResolvedValue(undefined),
		prIds: vi.fn().mockResolvedValue(["ordinary-pr"]),
		legacy: vi
			.fn()
			.mockResolvedValue({ id: "ordinary-pr", number: 42, state: "open" }),
		identity: vi
			.fn()
			.mockResolvedValue({ id: "owner", kind: "human", isDoradsoft: true }),
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

vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	ensureContributionSchema: vi.fn().mockResolvedValue(undefined),
	withContributions: (fn: (conn: unknown) => unknown) => fn(mocks.conn),
}));
vi.mock("~/server/tanahpedia/contribution-article-import.server", () => ({
	promoteLegacyArticleLinkProposals: mocks.promote,
	ensureArticleLinkPromotionSchema: vi.fn().mockResolvedValue(undefined),
	articleLinkContributionIds: mocks.prIds,
	legacyArticleLinkContribution: mocks.legacy,
}));
vi.mock("~/server/tanahpedia/contribution-article-grounding.server", () => ({
	assertCurrentAgentArticleGrounding: mocks.literalGuard,
}));
vi.mock("~/server/tanahpedia/contribution-identity.server", () => ({
	contributionIdentity: mocks.identity,
}));

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

import { canonicalJson } from "~/lib/canonical-json";
import {
	_resetLinkSchemaCache,
	_setLinkLlmCaller,
} from "~/server/article-link-pipeline";
import {
	applyLinkProposals,
	generateLinkProposals,
	getArticleLinkContribution,
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
	if (sql.includes("tanah_article_link_proposal"))
		return sql.includes("WHERE p.id = ?")
			? proposalRow
				? [proposalRow]
				: []
			: proposalRows;
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

/** Simulate persisted checkpoint keys so reruns exercise the read/write contract. */
function trackCheckpoints(initial: unknown[][] = []) {
	const keys = new Set(initial.map((key) => JSON.stringify(key)));
	mocks.queryOne.mockImplementation(async (sql: string, params: unknown[]) => {
		if (sql.includes("tanah_article_link_checkpoint")) {
			return keys.has(JSON.stringify(params)) ? { article_id: 7 } : null;
		}
		return dispatchQueryOne(sql);
	});
	mocks.txExecute.mockImplementation(
		async (_conn: unknown, sql: string, params: unknown[]) => {
			if (sql.includes("INSERT INTO tanah_article_link_checkpoint")) {
				keys.add(JSON.stringify(params.slice(0, 4)));
			}
			return { affectedRows: 1, insertId: 1 };
		},
	);
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
			mocks.promote,
			mocks.literalGuard,
			mocks.prIds,
			mocks.legacy,
			mocks.identity,
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
		mocks.promote.mockResolvedValue([]);
		mocks.literalGuard.mockResolvedValue(undefined);
		mocks.prIds.mockResolvedValue(["ordinary-pr"]);
		mocks.legacy.mockResolvedValue({
			id: "ordinary-pr",
			number: 42,
			state: "open",
		});
		mocks.identity.mockResolvedValue({
			id: "owner",
			kind: "human",
			isDoradsoft: true,
		});
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
			const inserts = mocks.txExecute.mock.calls.filter((call) =>
				String(call[1]).includes(
					"INSERT IGNORE INTO tanah_article_link_proposal",
				),
			);
			for (const [index, call] of inserts.entries()) {
				const draft = result.outcomes[0].proposals[index];
				const historicalKey = createHash("sha256")
					.update(
						canonicalJson([
							"dedupe",
							"heuristic-citations:v1",
							"linking-v1",
							7,
							HASH,
							draft.relationshipKey,
							draft.action,
							draft.target,
						]),
					)
					.digest("hex");
				expect(call[2][12]).toBe(historicalKey);
				expect(call[2][16]).toBe("linking-v1");
			}
			const checkpoint = mocks.txExecute.mock.calls.find((call) =>
				String(call[1]).includes("INSERT INTO tanah_article_link_checkpoint"),
			);
			expect(checkpoint?.[2]).toEqual([
				7,
				"heuristic-citations:v1",
				"linking-v1",
				HASH,
				result.runId,
				inserts.length,
			]);
			expect(mocks.literalGuard).toHaveBeenCalledWith(
				mocks.conn,
				expect.arrayContaining([
					expect.objectContaining({ kind: "article_links", targetId: "7" }),
				]),
				expect.objectContaining({
					articleGroundings: [
						expect.objectContaining({
							articleId: "7",
							coordinates: [
								{ perekId: 18, pasuk: 2 },
								{ perekId: 605, pasuk: 7 },
							],
						}),
					],
				}),
			);
			expect(mocks.literalGuard.mock.invocationCallOrder[0]).toBeLessThan(
				mocks.txExecute.mock.invocationCallOrder[0],
			);
		});

		it("rejects stale transactional grounding before any proposal, promotion or checkpoint write", async () => {
			mocks.literalGuard.mockRejectedValueOnce(
				new Error("Article source changed"),
			);
			const result = await generateLinkProposals({ data: { articleIds: [7] } });
			expect(result.outcomes[0]).toMatchObject({
				outcome: "error",
				proposals: [],
				error: "Article source changed",
			});
			expect(mocks.literalGuard).toHaveBeenCalledTimes(1);
			expect(mocks.txExecute).not.toHaveBeenCalled();
			expect(mocks.promote).not.toHaveBeenCalled();
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
			const insert = mocks.txExecute.mock.calls.find((call) =>
				String(call[1]).includes(
					"INSERT IGNORE INTO tanah_article_link_proposal",
				),
			);
			expect(insert?.[2][16]).toBe("linking-v3");
			const draft = llmDrafts[0];
			const expectedKey = createHash("sha256")
				.update(
					canonicalJson([
						"dedupe",
						insert?.[2][14],
						"linking-v3",
						7,
						HASH,
						draft.relationshipKey,
						draft.action,
						draft.target,
					]),
				)
				.digest("hex");
			expect(insert?.[2][12]).toBe(expectedKey);
			const checkpoint = mocks.txExecute.mock.calls.find((call) =>
				String(call[1]).includes("INSERT INTO tanah_article_link_checkpoint"),
			);
			expect(checkpoint?.[2].slice(0, 4)).toEqual([
				7,
				insert?.[2][14],
				"linking-v3",
				HASH,
			]);
		});
		it.each([false, true])(
			"rejects an unresolved LLM coverage addition even for dryRun=%s",
			async (dryRun) => {
				_setLinkLlmCaller(async () => ({
					content: JSON.stringify({
						proposals: [
							{
								relationshipKey: "coveringSources",
								action: "add",
								target: {
									citations: [{ sefer: "לא ידוע", perek: "א", pasuk: "א" }],
								},
								evidence: [{ quote: "בראשית יח, ב" }],
							},
						],
					}),
					model: "mock-model",
					promptTokens: 10,
					completionTokens: 5,
				}));
				const result = await generateLinkProposals({
					data: { articleIds: [7], engine: "llm", dryRun },
				});
				expect(result.outcomes[0]).toMatchObject({
					outcome: "error",
					proposals: [],
					error: expect.stringContaining(
						"Literal citations could not be resolved",
					),
				});
				expect(mocks.literalGuard).not.toHaveBeenCalled();
				expect(mocks.txExecute).not.toHaveBeenCalled();
				expect(mocks.promote).not.toHaveBeenCalled();
			},
		);

		it.each([
			{
				description: "valid empty proposals",
				output: { proposals: [] },
			},
			{
				description: "valid empty abstentions",
				output: { abstentions: [] },
			},
			{
				description: "author-only proposals",
				output: {
					proposals: [
						{
							relationshipKey: "author",
							action: "replace",
							target: { authorId: 9 },
							evidence: [{ quote: "המאמר" }],
						},
					],
				},
			},
			{
				description: "abstentions without proposals",
				output: {
					proposals: [],
					abstentions: [
						{ relationshipKey: "coveringSources", reason: "no evidence" },
					],
				},
			},
		])(
			"checkpoints $description so reruns avoid another paid call",
			async ({ output }) => {
				trackCheckpoints();
				mocks.llmCall.mockResolvedValue({
					content: JSON.stringify(output),
					model: "mock",
					promptTokens: 10,
					completionTokens: 5,
				});
				const input = { data: { articleIds: [7], engine: "llm" as const } };
				const first = await generateLinkProposals(input);
				const second = await generateLinkProposals(input);
				expect(first.outcomes[0]).toMatchObject({
					outcome: "generated",
					proposals: [],
				});
				expect(second.outcomes[0].outcome).toBe("skipped-checkpoint");
				expect(mocks.llmCall).toHaveBeenCalledTimes(1);
				const writes = mocks.txExecute.mock.calls.filter((call) =>
					String(call[1]).includes("INSERT INTO tanah_article_link_checkpoint"),
				);
				expect(writes).toHaveLength(1);
				expect(writes[0][2][2]).toBe("linking-v3");
				expect(writes[0][2][5]).toBe(0);
				expect(
					mocks.txExecute.mock.calls.some((call) =>
						String(call[1]).includes(
							"INSERT IGNORE INTO tanah_article_link_proposal",
						),
					),
				).toBe(false);
			},
		);

		it.each(["proposals", "abstentions"])(
			"retries malformed-only %s and checkpoints the corrected response",
			async (collection) => {
				trackCheckpoints();
				const candidate = {
					relationshipKey: "coveringSources",
					action: "add",
					target: { citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }] },
					evidence: [{ quote: "בראשית יח, ב" }],
				};
				const reply = (output: unknown) => ({
					content: JSON.stringify(output),
					model: "mock",
					promptTokens: 10,
					completionTokens: 5,
				});
				const malformed =
					collection === "proposals"
						? { proposals: [{ ...candidate, action: "bogus" }] }
						: { abstentions: [{ reason: "missing relationshipKey" }] };
				mocks.llmCall
					.mockResolvedValueOnce(reply(malformed))
					.mockResolvedValueOnce(reply({ proposals: [candidate] }));
				const input = { data: { articleIds: [7], engine: "llm" as const } };

				const first = await generateLinkProposals(input);
				expect(first.outcomes[0].outcome).toBe("error");
				expect(first.outcomes[0].error).toContain("malformed proposals");
				expect(mocks.txExecute).not.toHaveBeenCalled();

				const corrected = await generateLinkProposals(input);
				expect(corrected.outcomes[0].outcome).toBe("generated");
				expect(corrected.outcomes[0].proposals).toHaveLength(1);
				expect(corrected.outcomes[0].proposals[0].status).toBe("pending");
				const writes = mocks.txExecute.mock.calls.filter((call) =>
					String(call[1]).includes("INSERT INTO tanah_article_link_checkpoint"),
				);
				expect(writes).toHaveLength(1);
				expect(writes[0][2][5]).toBe(1);

				const repeated = await generateLinkProposals(input);
				expect(repeated.outcomes[0].outcome).toBe("skipped-checkpoint");
				expect(mocks.llmCall).toHaveBeenCalledTimes(2);
			},
		);

		it.each([
			{ description: "an empty object", output: {} },
			{ description: "an array", output: [] },
			{ description: "null", output: null },
			{ description: "a string", output: "unexpected" },
			{ description: "a number", output: 42 },
			{ description: "a boolean", output: true },
			{
				description: "an object instead of proposals",
				output: { proposals: {} },
			},
			{
				description: "a string instead of proposals",
				output: { proposals: "unexpected" },
			},
			{ description: "null instead of proposals", output: { proposals: null } },
			{
				description: "an object instead of abstentions",
				output: { abstentions: {} },
			},
			{
				description: "a string instead of abstentions",
				output: { abstentions: "unexpected" },
			},
			{
				description: "null instead of abstentions",
				output: { abstentions: null },
			},
			{
				description: "a malformed optional collection",
				output: { proposals: [], abstentions: false },
			},
		])(
			"leaves $description retryable instead of checkpointing malformed response shape",
			async ({ output }) => {
				trackCheckpoints();
				mocks.llmCall
					.mockResolvedValueOnce({
						content: JSON.stringify(output),
						model: "mock",
						promptTokens: 10,
						completionTokens: 5,
					})
					.mockResolvedValueOnce({
						content: JSON.stringify({ proposals: [] }),
						model: "mock",
						promptTokens: 10,
						completionTokens: 5,
					});
				const input = { data: { articleIds: [7], engine: "llm" as const } };
				const malformed = await generateLinkProposals(input);
				expect(malformed.outcomes[0].outcome).toBe("error");
				expect(malformed.outcomes[0].error).toContain(
					"proposals and/or abstentions arrays",
				);
				expect(mocks.txExecute).not.toHaveBeenCalled();

				const corrected = await generateLinkProposals(input);
				const repeated = await generateLinkProposals(input);
				expect(corrected.outcomes[0].outcome).toBe("generated");
				expect(repeated.outcomes[0].outcome).toBe("skipped-checkpoint");
				expect(mocks.llmCall).toHaveBeenCalledTimes(2);
			},
		);

		it.each(["draft", "abstention"])(
			"checkpoints mixed malformed output when a usable %s remains",
			async (usable) => {
				trackCheckpoints();
				mocks.llmCall.mockResolvedValue({
					content: JSON.stringify({
						proposals: [
							{ relationshipKey: "coveringSources", action: "bogus" },
							...(usable === "draft"
								? [
										{
											relationshipKey: "coveringSources",
											action: "add",
											target: {
												citations: [
													{ sefer: "בראשית", perek: "יח", pasuk: "ב" },
												],
											},
											evidence: [{ quote: "בראשית יח, ב" }],
										},
									]
								: []),
						],
						abstentions:
							usable === "abstention"
								? [
										{
											relationshipKey: "coveringSources",
											reason: "no evidence",
										},
									]
								: [],
					}),
					model: "mock",
					promptTokens: 10,
					completionTokens: 5,
				});
				const input = { data: { articleIds: [7], engine: "llm" as const } };
				const first = await generateLinkProposals(input);
				const repeated = await generateLinkProposals(input);
				expect(first.outcomes[0].outcome).toBe("generated");
				expect(repeated.outcomes[0].outcome).toBe("skipped-checkpoint");
				expect(mocks.llmCall).toHaveBeenCalledTimes(1);
			},
		);

		it("does not rewrite a skipped heuristic checkpoint when only the LLM runs", async () => {
			trackCheckpoints([[7, "heuristic-citations:v1", "linking-v1", HASH]]);
			mocks.llmCall.mockResolvedValue({
				content: JSON.stringify({ proposals: [] }),
				model: "mock",
				promptTokens: 10,
				completionTokens: 5,
			});
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "both" },
			});
			expect(result.outcomes[0]).toMatchObject({
				outcome: "generated",
				proposals: [],
			});
			const writes = mocks.txExecute.mock.calls.filter((call) =>
				String(call[1]).includes("INSERT INTO tanah_article_link_checkpoint"),
			);
			expect(writes).toHaveLength(1);
			expect(writes[0][2][1]).toMatch(/^openai:/);
			expect(writes[0][2][2]).toBe("linking-v3");
			expect(writes[0][2][5]).toBe(0);
		});

		it("never checkpoints a dry-run even when the LLM returns no drafts", async () => {
			trackCheckpoints();
			mocks.llmCall.mockResolvedValue({
				content: JSON.stringify({ proposals: [] }),
				model: "mock",
				promptTokens: 10,
				completionTokens: 5,
			});
			const input = {
				data: { articleIds: [7], engine: "llm" as const, dryRun: true },
			};
			const first = await generateLinkProposals(input);
			const second = await generateLinkProposals(input);
			expect(first.outcomes[0].outcome).toBe("dry-run");
			expect(second.outcomes[0].outcome).toBe("dry-run");
			expect(mocks.llmCall).toHaveBeenCalledTimes(2);
			expect(mocks.txExecute).not.toHaveBeenCalled();
		});

		it.each(["caller error", "invalid JSON"])(
			"leaves %s retryable without a checkpoint",
			async (failure) => {
				trackCheckpoints();
				if (failure === "caller error") {
					mocks.llmCall.mockRejectedValue(new Error("provider unavailable"));
				} else {
					mocks.llmCall.mockResolvedValue({
						content: "not valid JSON",
						model: "mock",
						promptTokens: 10,
						completionTokens: 5,
					});
				}
				const input = { data: { articleIds: [7], engine: "llm" as const } };
				const first = await generateLinkProposals(input);
				const second = await generateLinkProposals(input);
				expect(first.outcomes[0].outcome).toBe("error");
				expect(second.outcomes[0].outcome).toBe("error");
				expect(mocks.llmCall).toHaveBeenCalledTimes(2);
				expect(mocks.txExecute).not.toHaveBeenCalled();
			},
		);
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

		it("skips an article whose historical heuristic v1 checkpoint is fresh", async () => {
			trackCheckpoints([[7, "heuristic-citations:v1", "linking-v1", HASH]]);
			const result = await generateLinkProposals({
				data: { articleIds: [7] },
			});
			expect(result.outcomes[0].outcome).toBe("skipped-checkpoint");
			expect(mocks.txExecute).not.toHaveBeenCalled();
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

		it("lists proposals when the article content-hash column is undeployed", async () => {
			const schemaErr = Object.assign(
				new Error("Unknown column 'a.content_hash'"),
				{ code: "ER_BAD_FIELD_ERROR" },
			);
			proposalRows = [makeProposalRow({ live_hash: undefined })];
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("HEX(a.content_hash)")) throw schemaErr;
				return dispatchQuery(sql);
			});
			const rows = await listLinkProposals({ data: {} });
			expect(rows).toHaveLength(1);
			expect(rows[0].staleNow).toBe(false);
			expect(
				mocks.query.mock.calls.some((c) =>
					String(c[0]).includes("NULL AS live_hash"),
				),
			).toBe(true);
		});

		it("returns the detail view when the article content-hash column is undeployed", async () => {
			const schemaErr = Object.assign(
				new Error("Unknown column 'a.content_hash'"),
				{ code: "ER_BAD_FIELD_ERROR" },
			);
			proposalRow = makeProposalRow();
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("HEX(a.content_hash)")) throw schemaErr;
				return dispatchQuery(sql);
			});
			mocks.queryOne.mockImplementation(async (sql: string) => {
				if (sql.includes("AS h FROM tanah_article")) throw schemaErr;
				return dispatchQueryOne(sql);
			});
			const detail = await getLinkProposal({ data: "prop-1" });
			expect(detail?.proposal.id).toBe("prop-1");
			expect(detail?.liveContentHash).toBe("");
		});

		it("rethrows non-schema errors from the proposal listing query", async () => {
			mocks.query.mockImplementation(async (sql: string) => {
				if (sql.includes("tanah_article_link_proposal"))
					throw new Error("list boom");
				return dispatchQuery(sql);
			});
			await expect(listLinkProposals({ data: {} })).rejects.toThrow(
				"list boom",
			);
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

		it.each(["llm", "both"] as const)(
			"rejects an unsupported coverage claim before any %s proposals are persisted",
			async (engine) => {
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
					data: { articleIds: [7], engine },
				});
				expect(result.outcomes[0]).toMatchObject({
					outcome: "error",
					proposals: [],
					error: expect.stringContaining("explicit literal citations"),
				});
				expect(mocks.literalGuard).not.toHaveBeenCalled();
				expect(mocks.txExecute).not.toHaveBeenCalled();
				expect(mocks.promote).not.toHaveBeenCalled();
			},
		);
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
	describe("ordinary PR bridge", () => {
		it("rejects legacy approval with the ordinary PR review location and no canonical write", async () => {
			await expect(
				reviewLinkProposal({ data: { id: "proposal-1", decision: "approve" } }),
			).rejects.toThrow("/?tab=prs&id=ordinary-pr");
			expect(mocks.updateApi).not.toHaveBeenCalled();
			expect(mocks.applyDed).not.toHaveBeenCalled();
			expect(mocks.txExecute).not.toHaveBeenCalled();
		});
		it("does not retain a separate legacy rejection workflow", async () => {
			await expect(
				reviewLinkProposal({ data: { id: "proposal-1", decision: "reject" } }),
			).rejects.toThrow("PR #42");
			expect(mocks.txExecute).not.toHaveBeenCalled();
		});
		it("requires the ordinary PR merge and reports already-merged history without applying twice", async () => {
			expect(
				await applyLinkProposals({ data: { ids: ["proposal-1"] } }),
			).toEqual({
				outcomes: [
					{
						id: "proposal-1",
						outcome: "conflict",
						detail: expect.stringContaining("/?tab=prs&id=ordinary-pr"),
					},
				],
			});
			mocks.legacy.mockResolvedValue({
				id: "ordinary-pr",
				number: 42,
				state: "merged",
			});
			expect(
				(await applyLinkProposals({ data: { ids: ["proposal-1"] } }))
					.outcomes[0].outcome,
			).toBe("already-applied");
			expect(mocks.updateApi).not.toHaveBeenCalled();
			expect(mocks.applyDed).not.toHaveBeenCalled();
		});
		it("preserves missing-record failures without inventing a PR", async () => {
			mocks.legacy.mockResolvedValue(null);
			await expect(
				reviewLinkProposal({ data: { id: "missing", decision: "approve" } }),
			).rejects.toThrow("לא נמצאה");
			expect(
				(await applyLinkProposals({ data: { ids: ["missing"] } })).outcomes[0]
					.outcome,
			).toBe("error");
		});
		it("requires verified contribution identity before deterministic generation can persist proposals", async () => {
			mocks.identity.mockRejectedValue(
				new Error("Authenticated editor required"),
			);
			await expect(
				generateLinkProposals({
					data: { articleIds: [7], engine: "heuristic" },
				}),
			).rejects.toThrow("Authenticated editor required");
			expect(mocks.transaction).not.toHaveBeenCalled();
			expect(mocks.promote).not.toHaveBeenCalled();
		});
		it("promotes inside the same proposal/checkpoint transaction and returns stable PR identities", async () => {
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "heuristic" },
			});
			expect(mocks.promote).toHaveBeenCalledWith(mocks.conn, 7);
			expect(result.prIds).toEqual(["ordinary-pr"]);
		});
		it("does not promote or look up PRs on a dry run", async () => {
			const result = await generateLinkProposals({
				data: { articleIds: [7], engine: "heuristic", dryRun: true },
			});
			expect(result.prIds).toEqual([]);
			expect(mocks.promote).not.toHaveBeenCalled();
			expect(mocks.prIds).not.toHaveBeenCalled();
		});
	});

	describe("legacy URL resolution", () => {
		it("authenticates before resolving a stable legacy proposal identity", async () => {
			const id = "00000000-0000-4000-8000-000000000001";
			expect(await getArticleLinkContribution({ data: { id } })).toBe(
				"ordinary-pr",
			);
			expect(mocks.legacy).toHaveBeenCalledWith(id);
			mocks.legacy.mockResolvedValue(null);
			expect(await getArticleLinkContribution({ data: { id } })).toBeNull();
		});
		it("returns the existing article PR and leaves an unfiltered queue lookup inert", async () => {
			expect(await getArticleLinkContribution({ data: { articleId: 7 } })).toBe(
				"ordinary-pr",
			);
			expect(mocks.promote).toHaveBeenCalledWith(mocks.conn, 7);
			mocks.promote.mockClear();
			expect(await getArticleLinkContribution({ data: {} })).toBeNull();
			expect(mocks.promote).not.toHaveBeenCalled();
			mocks.prIds.mockResolvedValue([]);
			expect(
				await getArticleLinkContribution({ data: { articleId: 7 } }),
			).toBeNull();
		});
		it.each([
			null,
			[],
			{ id: 7 },
			{ id: "invalid" },
			{ articleId: 0 },
			{ articleId: -1 },
			{ articleId: 1.5 },
			{ articleId: "7" },
			{ articleId: 2147483648 },
		])("rejects invalid locators %j", (data) => {
			expect(() => getArticleLinkContribution({ data })).toThrow();
		});
	});
});
