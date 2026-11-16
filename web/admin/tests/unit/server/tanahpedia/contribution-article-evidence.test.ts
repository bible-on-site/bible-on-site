import { beforeEach, expect, it, vi } from "vitest";
import { validateEvidence } from "~/lib/tanahpedia/contributions";
import { refreshArticleLinkEvidence } from "~/server/tanahpedia/contribution-article-evidence.server";

const read = vi.hoisted(() => vi.fn());
vi.mock("~/server/tanahpedia/contribution-article-links.server", () => ({
	readArticleLinkContext: read,
}));
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
beforeEach(() => {
	vi.resetAllMocks();
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
