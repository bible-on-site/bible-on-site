import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const scriptDir = join(process.cwd(), "scripts");
const manifestPath = join(scriptDir, "link-eval-manifest.json");
const runtimesPath = join(scriptDir, "link-eval-runtimes.json");

const corpus = JSON.parse(
	readFileSync(join(scriptDir, "link-eval-corpus.json"), "utf-8"),
) as { articles: { id: number }[] };
const articleIds = corpus.articles.map((a) => a.id);

interface Manifest {
	proposals: Record<string, { relationshipKey: string }[]>;
	llmCalls: Record<
		string,
		{
			articleId: number;
			promptTokens: number | null;
			completionTokens: number | null;
		}
	>;
}

const readManifest = (): Manifest =>
	JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;

const mocks = vi.hoisted(() => ({
	llmCaller: null as
		| null
		| ((params: { system: string; user: string }) => Promise<{
				content: string;
				model: string;
				promptTokens: number | null;
				completionTokens: number | null;
		  }>),
	runGeneration: vi.fn(),
	callOpenAi: vi.fn(),
}));

vi.mock("~/server/db", () => ({
	pool: { end: vi.fn(async () => {}) },
	execute: vi.fn(),
	queryOne: vi.fn(),
}));

vi.mock("~/server/article-link-pipeline", () => ({
	_setLinkLlmCaller: (caller: unknown) => {
		mocks.llmCaller = caller as typeof mocks.llmCaller;
	},
	ensureLinkSchema: vi.fn(),
	listProposals: vi.fn(async () => []),
	reviewProposal: vi.fn(),
	runLinkGeneration: (input: unknown) => mocks.runGeneration(input),
}));

vi.mock("~/server/llm-json", () => ({
	callOpenAiJson: (params: unknown) => mocks.callOpenAi(params),
	llmConfigured: vi.fn(() => true),
}));

// The script runs main() on import and resolves its state files relative to
// scripts/ — preserve any real evaluation output around the test run.
const savedFiles = new Map<string, string | null>();
let originalArgv: string[];

beforeAll(() => {
	originalArgv = process.argv;
	for (const p of [manifestPath, runtimesPath]) {
		savedFiles.set(p, existsSync(p) ? readFileSync(p, "utf-8") : null);
	}
});

afterAll(() => {
	process.argv = originalArgv;
	for (const [p, content] of savedFiles) {
		if (content === null) rmSync(p, { force: true });
		else writeFileSync(p, content);
	}
});

beforeEach(() => {
	rmSync(manifestPath, { force: true });
	rmSync(runtimesPath, { force: true });
	mocks.llmCaller = null;
	mocks.runGeneration.mockReset();
	mocks.callOpenAi.mockReset();
	vi.spyOn(console, "info").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

async function importScript(...argv: string[]): Promise<void> {
	vi.resetModules();
	process.argv = [process.argv[0], "link-eval.mts", ...argv];
	// Dynamic so each test re-executes the script's top level under its own
	// argv and a fresh module registry.
	await import("../../../scripts/link-eval.mts");
}

describe("link-eval generate", () => {
	it("records live provider usage per invocation, replacing stale usage", async () => {
		// A fixture evaluation leaves usage entries behind; a live rerun must
		// replace them with real provider tokens — including calls that emit
		// zero drafts (no proposal row exists to recover usage from).
		const stale = Object.fromEntries(
			articleIds.map((id) => [
				String(id),
				{ articleId: id, promptTokens: 999, completionTokens: 888 },
			]),
		);
		writeFileSync(
			manifestPath,
			JSON.stringify({ proposals: {}, llmCalls: stale }),
		);

		mocks.callOpenAi.mockImplementation(async () => ({
			content: JSON.stringify({ proposals: [] }),
			model: "live-model",
			promptTokens: 11,
			completionTokens: 7,
		}));
		mocks.runGeneration.mockImplementation(
			async (input: { articleIds: number[] }) => {
				// The pipeline invokes the injected caller once per article it
				// actually sends to the provider.
				await mocks.llmCaller?.({ system: "s", user: "u" });
				return {
					runId: "run-live",
					outcomes: [
						{
							articleId: input.articleIds[0],
							outcome: "generated",
							proposals: [],
						},
					],
				};
			},
		);

		await importScript("generate", "--engine", "llm", "--live");

		await vi.waitFor(() =>
			expect(mocks.runGeneration).toHaveBeenCalledTimes(articleIds.length),
		);
		await vi.waitFor(() => {
			const manifest = readManifest();
			expect(Object.keys(manifest.llmCalls)).toHaveLength(articleIds.length);
		});
		const manifest = readManifest();
		for (const id of articleIds) {
			expect(manifest.llmCalls[String(id)]).toEqual({
				articleId: id,
				promptTokens: 11,
				completionTokens: 7,
			});
		}
		expect(mocks.callOpenAi).toHaveBeenCalledTimes(articleIds.length);
	});

	it("persists each committed article's manifest membership before the next article", async () => {
		const [first] = articleIds;
		mocks.runGeneration
			.mockImplementationOnce(async () => ({
				runId: "run-1",
				outcomes: [
					{
						articleId: first,
						outcome: "generated",
						proposals: [
							{
								relationshipKey: "dedicates",
								action: "add",
								target: { dedicationId: 1 },
								targetLabel: "dedication 1",
								evidence: [],
								rationale: null,
								confidence: null,
								conflict: null,
								status: "pending",
							},
						],
					},
				],
			}))
			.mockImplementationOnce(async () => {
				throw new Error("simulated crash between articles");
			});

		await importScript("generate", "--engine", "heuristic");

		await vi.waitFor(() => expect(process.exitCode).toBe(1));
		// The first article committed proposals + a checkpoint before the
		// crash — its manifest membership must already be on disk, or a rerun
		// would skip it and hide its drafts from review/report.
		const manifest = readManifest();
		expect(manifest.proposals[`heuristic:${first}`]).toEqual([
			{
				relationshipKey: "dedicates",
				action: "add",
				targetJson: '{"dedicationId":1}',
			},
		]);
		const runtimes = JSON.parse(readFileSync(runtimesPath, "utf-8")) as Record<
			string,
			{ outcome: string }
		>;
		expect(runtimes[`heuristic:${first}`].outcome).toBe("generated");
	});
});
