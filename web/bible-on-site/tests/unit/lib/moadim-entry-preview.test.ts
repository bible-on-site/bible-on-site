/**
 * @jest-environment node
 *
 * The moed ↔ Tanahpedia preview (#3381): the stored moed name resolves
 * through the same contract /pedia/[slug] applies — a canonical
 * unique_name wins, a single-target alias follows to its canonical
 * entry, ambiguity or absence yields no preview. The body renders as
 * the first 20 readable words; the retired `summary` never appears.
 */
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html: string) => html },
}));

jest.mock("../../../src/lib/tanahpedia/synonym-resolution", () => ({
	entryHref: (uniqueName: string) => `/pedia/${encodeURIComponent(uniqueName)}`,
	resolveSynonymSlug: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import { getMoedEntryPreview } from "../../../src/lib/moadim/entry-preview";
import { resolveSynonymSlug } from "../../../src/lib/tanahpedia/synonym-resolution";
import type { SlugResolution } from "../../../src/lib/tanahpedia/synonym-resolution";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockResolve = resolveSynonymSlug as jest.MockedFunction<
	typeof resolveSynonymSlug
>;

interface EntryRow {
	unique_name: string;
	content: string | null;
}

const entry = (content: string | null, uniqueName = "פסח"): EntryRow => ({
	unique_name: uniqueName,
	content,
});

/** Dispatch the entry-body read; synonym resolution is mocked directly. */
function stubEntries(rowsByName: Record<string, EntryRow[]>) {
	mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
		if (!/FROM tanahpedia_entry\s+WHERE unique_name/.test(sql))
			throw new Error(`unstubbed SQL: ${sql}`);
		return rowsByName[String(params?.[0])] ?? [];
	});
}

function resolution(kind: SlugResolution["kind"], uniqueName = "חג הפסח") {
	if (kind === "alias")
		return {
			kind,
			target: {
				entryId: "e1",
				uniqueName,
				title: uniqueName,
				label: null,
			},
		} as SlugResolution;
	if (kind === "disambiguation")
		return { kind, targets: [] } as SlugResolution;
	return { kind } as SlugResolution;
}

describe("getMoedEntryPreview", () => {
	beforeEach(() => jest.resetAllMocks());

	it("previews the first 20 words of a directly named entry and links it canonically", async () => {
		const words = Array.from({ length: 24 }, (_, i) => `מילה${i + 1}`);
		stubEntries({ פסח: [entry(`<p>${words.join(" ")}</p>`)] });
		const preview = await getMoedEntryPreview("פסח");
		expect(preview).toEqual({
			href: `/pedia/${encodeURIComponent("פסח")}`,
			text: `${words.slice(0, 20).join(" ")}…`,
		});
		// A canonical unique_name resolves without touching synonyms.
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it("keeps a shorter body whole without an ellipsis", async () => {
		stubEntries({ פסח: [entry("<p>חג חירותנו ומתן תורה</p>")] });
		const preview = await getMoedEntryPreview("פסח");
		expect(preview?.text).toBe("חג חירותנו ומתן תורה");
	});

	it("flattens markup, markers and entities but keeps whole words", async () => {
		stubEntries({
			פסח: [
				entry(
					'<p>ראשון&nbsp;שני</p><sup><a href="#n">1</a></sup><p>שלישי &amp; רביעי</p>',
				),
			],
		});
		const preview = await getMoedEntryPreview("פסח");
		// The sup marker's digits are excluded, the paragraph boundary
		// separates words, and &nbsp;/&amp; decode to text.
		expect(preview?.text).toBe("ראשון שני שלישי & רביעי");
	});

	it("preserves Hebrew combining marks and attached punctuation", async () => {
		stubEntries({ פסח: [entry("<p>פֶּסַח, חַג הַמַּצּוֹת.</p>")] });
		const preview = await getMoedEntryPreview("פסח");
		expect(preview?.text).toBe("פֶּסַח, חַג הַמַּצּוֹת.");
	});

	it("follows a single-target alias to the canonical entry", async () => {
		stubEntries({ "חג הפסח": [entry("<p>ערך קנוני</p>", "חג הפסח")] });
		mockResolve.mockResolvedValue(resolution("alias", "חג הפסח"));
		const preview = await getMoedEntryPreview("חג חירותנו");
		expect(mockResolve).toHaveBeenCalledWith("חג חירותנו");
		expect(preview).toEqual({
			href: `/pedia/${encodeURIComponent("חג הפסח")}`,
			text: "ערך קנוני",
		});
	});

	it.each(["disambiguation", "missing"] as const)(
		"returns null when the name resolves to %s",
		async (kind) => {
			stubEntries({});
			mockResolve.mockResolvedValue(resolution(kind));
			expect(await getMoedEntryPreview("מועד")).toBeNull();
		},
	);

	it.each([null, "", "<p></p>", "<p>&nbsp;</p>", "<sup>1</sup>"] as const)(
		"returns null for an empty or marker-only body (%j)",
		async (content) => {
			stubEntries({ פסח: [entry(content)] });
			expect(await getMoedEntryPreview("פסח")).toBeNull();
		},
	);

	it("returns null for a blank moed name without querying", async () => {
		expect(await getMoedEntryPreview("   ")).toBeNull();
		expect(mockQuery).not.toHaveBeenCalled();
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it("degrades to null while the pedia schema is not deployed", async () => {
		const missing = Object.assign(new Error("no table"), {
			code: "ER_NO_SUCH_TABLE",
		});
		mockQuery.mockRejectedValue(missing);
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		expect(await getMoedEntryPreview("פסח")).toBeNull();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Tanahpedia schema is not deployed"),
		);
		warn.mockRestore();
	});

	it("propagates a real database failure rather than caching a wrong absence", async () => {
		mockQuery.mockRejectedValue(new Error("connection lost"));
		await expect(getMoedEntryPreview("פסח")).rejects.toThrow(
			"connection lost",
		);
	});
});
