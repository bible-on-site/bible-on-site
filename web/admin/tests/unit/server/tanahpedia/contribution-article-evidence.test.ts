import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
import {
	type ChangeInput,
	validateEvidence,
} from "~/lib/tanahpedia/contributions";
import {
	appendAgentArticleEvidence,
	refreshArticleLinkEvidence,
} from "~/server/tanahpedia/contribution-article-evidence.server";
import type { ModelCatalogue } from "~/server/tanahpedia/contribution-llm.server";

const read = vi.hoisted(() => vi.fn());
const perek = vi.hoisted(() => vi.fn());
vi.mock("~/server/tanahpedia/contribution-article-links.server", () => ({
	readArticleLinkContext: read,
}));
vi.mock("~/server/tanahpedia/contribution-perek-reads.server", () => ({
	readAgentPerek: perek,
}));
const chapterCoordinates = {
	seferName: "בראשית",
	additionalLetter: null,
	perekInContext: 1,
	pasukCount: 31,
};
const chapterFingerprint = createHash("sha256")
	.update(canonicalJson(chapterCoordinates))
	.digest("hex");
const source = {
	articleId: "123",
	contentHash: "a".repeat(32),
	sourceHash: "b".repeat(64),
	spanStart: 3,
	spanEnd: 8,
};
const evidence = () =>
	validateEvidence([
		{
			citation: "מקור",
			quote: " ציטוט",
			note: "",
			url: null,
			articleSource: { ...source, spanEnd: 9 },
		},
	]);
const changes = [{ kind: "article_links", targetId: "123" }] as never;
const literalChange: ChangeInput = {
	kind: "article_links",
	targetId: "123",
	after: {
		commands: [
			{
				relationshipKey: "coveringSources",
				action: "add",
				target: { pasukCoordinates: [{ perekId: 1, pasuk: 26 }] },
			},
		],
	},
};
const literalCatalogue = (): ModelCatalogue => ({
	people: [],
	places: [],
	entities: [],
	targets: [],
	articleGroundings: [
		{
			articleId: "123",
			sourceHash: "d".repeat(64),
			coordinates: [{ perekId: 1, pasuk: 26 }],
			chapters: [{ id: 1, fingerprint: chapterFingerprint }],
			citations: [
				{
					perekId: 1,
					pasuk: 26,
					pasukTo: 27,
					label: "בראשית א כו-כז",
					quote: " ציטוט",
					spanStart: 3,
					spanEnd: 9,
				},
			],
		},
	],
});
beforeEach(() => {
	vi.resetAllMocks();
	perek.mockResolvedValue({ id: 1, coordinates: chapterCoordinates });
	read.mockResolvedValue({
		plainText: "חדש ציטוט",
		state: { contentHash: "c".repeat(32), sourceHash: "d".repeat(64) },
	});
});
it("preserves exact structured quote whitespace while keeping free evidence semantics", () => {
	expect(evidence()[0].quote).toBe(" ציטוט");
	expect(
		validateEvidence([
			{ citation: " מקור ", quote: " ציטוט ", note: "", url: null },
		])[0].quote,
	).toBe("ציטוט");
});
it("attaches actual read spans to selected article links and retains all existing human evidence", async () => {
	const original = [
		{ citation: " מקור חופשי ", quote: " מקור ", note: " אדם ", url: null },
	];
	const result = await appendAgentArticleEvidence(
		{} as never,
		[literalChange],
		literalCatalogue(),
		original,
	);
	expect(result).toHaveLength(2);
	expect(result[0]).toBe(original[0]);
	expect(result[1]).toMatchObject({
		citation: "בראשית א כו-כז",
		quote: " ציטוט",
		articleSource: {
			articleId: "123",
			contentHash: "c".repeat(32),
			sourceHash: "d".repeat(64),
			spanStart: 3,
			spanEnd: 9,
		},
	});
	expect(original).toHaveLength(1);
	expect(read).toHaveBeenCalledWith({}, "123", { current: true });
});
it("keeps repeated pages and repeated revisions idempotent while preserving an editor's evidence notes", async () => {
	const catalogue = literalCatalogue();
	catalogue.articleGroundings?.push(
		structuredClone(catalogue.articleGroundings[0]),
	);
	const first = await appendAgentArticleEvidence(
		{} as never,
		[literalChange, literalChange],
		catalogue,
		[],
	);
	first[0].note = "הערה של העורך";
	first[0].citation = "תווית של העורך";
	expect(first).toHaveLength(1);
	expect(
		await appendAgentArticleEvidence(
			{} as never,
			[literalChange],
			catalogue,
			first,
		),
	).toBe(first);
	expect(first[0].note).toBe("הערה של העורך");
	expect(first[0].citation).toBe("תווית של העורך");
});
it("retains legacy grounding without quotes and skips unrequested articles and nonadding changes", async () => {
	const catalogue = literalCatalogue();
	const legacy = structuredClone(catalogue);
	delete legacy.articleGroundings?.[0].citations;
	const original = [
		{ citation: "מקור חופשי", quote: "ציטוט", note: "", url: null },
	];
	for (const [proposals, current] of [
		[[], catalogue],
		[[{ kind: "metadata", after: { displayName: "Name" } }], catalogue],
		[[{ ...literalChange, targetId: "9" }], catalogue],
		[[literalChange], legacy],
		[[literalChange], { ...catalogue, articleGroundings: undefined }],
		[
			[
				{
					...literalChange,
					after: {
						commands: [
							{
								relationshipKey: "primaryPerek",
								action: "replace",
								target: { perekId: 1 },
							},
						],
					},
				},
			],
			catalogue,
		],
	] as [ChangeInput[], ModelCatalogue][]) {
		expect(
			await appendAgentArticleEvidence(
				{} as never,
				proposals,
				current,
				original,
			),
		).toBe(original);
	}
	expect(read).not.toHaveBeenCalled();
});
it("attaches only citations intersecting a proposed coordinate, without guessing other read references", async () => {
	const catalogue = literalCatalogue();
	const grounding = catalogue.articleGroundings?.[0];
	if (!grounding?.citations) throw new Error("Missing fixture citations");
	grounding.citations.push({ ...grounding.citations[0], perekId: 2 });
	grounding.citations.push({
		...grounding.citations[0],
		pasuk: 28,
		pasukTo: 29,
	});
	const result = await appendAgentArticleEvidence(
		{} as never,
		[literalChange],
		catalogue,
		[],
	);
	expect(result).toHaveLength(1);
});
it.each(["hash", "span"])(
	"rejects changed citation %s before returning any generated evidence",
	async (changed) => {
		const catalogue = literalCatalogue();
		const grounding = catalogue.articleGroundings?.[0];
		if (!grounding?.citations) throw new Error("Missing fixture citations");
		if (changed === "hash") grounding.sourceHash = "e".repeat(64);
		else grounding.citations[0].quote = "מקור אחר";
		await expect(
			appendAgentArticleEvidence(
				{} as never,
				[literalChange],
				catalogue,
				evidence(),
			),
		).rejects.toThrow(
			changed === "hash" ? "source changed" : "exact source span",
		);
	},
);
it("fails explicitly at the evidence limit instead of dropping human sources", async () => {
	const original = Array.from({ length: 30 }, (_, i) => ({
		citation: `מקור ${i}`,
		quote: "אדם",
		note: "",
		url: null,
	}));
	await expect(
		appendAgentArticleEvidence(
			{} as never,
			[literalChange],
			literalCatalogue(),
			original,
		),
	).rejects.toThrow("maximum 30 sources");
	expect(original).toHaveLength(30);
});
it.each([1, 30])(
	"refreshes a shifted unique quotation before deduplication with %i existing sources",
	async (count) => {
		read.mockResolvedValue({
			plainText: "😀חדש ציטוט",
			state: { contentHash: "c".repeat(32), sourceHash: "d".repeat(64) },
		});
		const catalogue = literalCatalogue();
		const citation = catalogue.articleGroundings?.[0].citations?.[0];
		if (!citation) throw new Error("Missing source citation");
		citation.spanStart = 5;
		citation.spanEnd = 11;
		const original = [
			...evidence(),
			...Array.from({ length: count - 1 }, (_, index) => ({
				citation: `מקור ${index}`,
				quote: "מקור אדם",
				note: "",
				url: null,
			})),
		];
		original[0].citation = "תווית אנושית";
		original[0].note = "הערת עורך";
		const before = structuredClone(original);
		const result = await appendAgentArticleEvidence(
			{} as never,
			[literalChange],
			catalogue,
			original,
		);
		expect(result).toHaveLength(count);
		expect(result[0]).toMatchObject({
			citation: "תווית אנושית",
			quote: " ציטוט",
			note: "הערת עורך",
			articleSource: {
				spanStart: 5,
				spanEnd: 11,
				contentHash: "c".repeat(32),
				sourceHash: "d".repeat(64),
			},
		});
		expect(result.slice(1)).toEqual(original.slice(1));
		expect(original).toEqual(before);
	},
);
it.each(["removed", "renamed", "bounds", "missing receipt"])(
	"rejects a %s chapter before attaching source evidence",
	async (mode) => {
		const catalogue = literalCatalogue();
		if (mode === "removed") perek.mockResolvedValue(null);
		if (mode === "renamed")
			perek.mockResolvedValue({
				id: 1,
				coordinates: { ...chapterCoordinates, seferName: "שמות" },
			});
		if (mode === "bounds")
			perek.mockResolvedValue({
				id: 1,
				coordinates: { ...chapterCoordinates, pasukCount: 25 },
			});
		if (mode === "missing receipt" && catalogue.articleGroundings)
			catalogue.articleGroundings[0].chapters = [];
		await expect(
			appendAgentArticleEvidence(
				{} as never,
				[literalChange],
				catalogue,
				evidence(),
			),
		).rejects.toThrow("citation chapter changed");
		expect(perek).toHaveBeenCalledWith({}, 1, true);
	},
);
it("refreshes source hashes and exact UTF-16 spans without mutating stored input", async () => {
	const original = evidence();
	const result = await refreshArticleLinkEvidence({} as never, {
		changes,
		evidence: original,
	});
	expect(result[0].articleSource).toEqual({
		...source,
		contentHash: "c".repeat(32),
		sourceHash: "d".repeat(64),
		spanStart: 3,
		spanEnd: 9,
	});
	expect(original[0].articleSource?.contentHash).toBe("a".repeat(32));
	expect(read).toHaveBeenCalledWith({}, "123", { current: true });
});
it("relocates one surviving quote with UTF-16 emoji offsets", async () => {
	read.mockResolvedValue({
		plainText: "😀פתיח ציטוט",
		state: { contentHash: "c".repeat(32), sourceHash: "d".repeat(64) },
	});
	const result = await refreshArticleLinkEvidence({} as never, {
		changes,
		evidence: evidence(),
	});
	expect(result[0].articleSource).toMatchObject({ spanStart: 6, spanEnd: 12 });
});
it.each(["אין כאן מקור", " ציטוט כאן וגם ציטוט"])(
	"blocks removed or ambiguous structured quotes: %s",
	async (plainText) => {
		read.mockResolvedValue({
			plainText,
			state: { contentHash: "c".repeat(32), sourceHash: "d".repeat(64) },
		});
		await expect(
			refreshArticleLinkEvidence({} as never, {
				changes,
				evidence: evidence(),
			}),
		).rejects.toThrow("one exact quote");
	},
);
it("does not guess a different article target", async () => {
	await expect(
		refreshArticleLinkEvidence({} as never, {
			changes: [],
			evidence: evidence(),
		}),
	).rejects.toThrow("proposed article");
	expect(read).not.toHaveBeenCalled();
});
it("keeps free text untouched and performs no source read", async () => {
	const values = validateEvidence([
		{ citation: "Evidence", quote: "free text", note: "", url: null },
	]);
	expect(
		await refreshArticleLinkEvidence({} as never, {
			changes: [],
			evidence: values,
		}),
	).toBe(values);
	expect(read).not.toHaveBeenCalled();
});
it("refreshes multiple sources in numeric order while preserving unrelated free text and article spans", async () => {
	const original = [
		...evidence(),
		{
			...evidence()[0],
			articleSource: { ...source, spanEnd: 9, articleId: "9" },
		},
		{ citation: "Free", quote: "Free evidence", note: "", url: null },
	];
	const result = await refreshArticleLinkEvidence({} as never, {
		changes: [
			{ kind: "article_links", targetId: "123" },
			{ kind: "article_links", targetId: "9" },
		] as never,
		evidence: original,
	});
	expect(read.mock.calls.map(([, id]) => id)).toEqual(["9", "123"]);
	expect(result.map((e) => e.articleSource?.articleId)).toEqual([
		"123",
		"9",
		undefined,
	]);
	expect(result[2]).toEqual(original[2]);
	expect(original[0].articleSource?.contentHash).toBe(source.contentHash);
});
it("returns unchanged structured evidence without inventing another revision", async () => {
	const values = evidence();
	read.mockResolvedValue({
		plainText: "חדש ציטוט",
		state: { contentHash: source.contentHash, sourceHash: source.sourceHash },
	});
	expect(
		await refreshArticleLinkEvidence({} as never, {
			changes,
			evidence: values,
		}),
	).toBe(values);
});
it.each([
	{ articleId: "0123" },
	{ contentHash: "bad" },
	{ sourceHash: "bad" },
	{ spanStart: -1 },
	{ spanStart: 3.5 },
	{ spanEnd: 4000001 },
	{ spanEnd: 8 },
	{ unknown: true },
])("rejects malformed structured metadata %j", (overrides) => {
	expect(() =>
		validateEvidence([
			{
				citation: "Evidence",
				quote: " ציטוט",
				note: "",
				url: null,
				articleSource: { ...source, spanEnd: 9, ...overrides },
			},
		]),
	).toThrow();
});
it("propagates current-read storage failures", async () => {
	read.mockRejectedValue(new Error("DB unavailable"));
	await expect(
		refreshArticleLinkEvidence({} as never, { changes, evidence: evidence() }),
	).rejects.toThrow("DB unavailable");
});
