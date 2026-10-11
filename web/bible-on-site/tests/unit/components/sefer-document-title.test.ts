/**
 * @jest-environment jsdom
 */
import {
	articleDocumentTitle,
	buildSeferDocumentTitleResolver,
	buildSeferPerekTitles,
	perekDocumentTitle,
	perushDocumentTitle,
	releaseSeferDocumentTitle,
	setSeferDocumentTitle,
} from "@/app/929/[number]/components/sefer-document-title";
import { CONTENT_OFFSET } from "@/app/929/[number]/components/sefer-page-utils";
import type { SefarimItem } from "@/data/db/tanah-view-types";

function seferWithPerakim(perakimCount: number, name = "בראשית") {
	return {
		name,
		perakim: Array.from({ length: perakimCount }, () => ({})),
	} as unknown as SefarimItem;
}

function seferWithAdditionals() {
	return {
		name: "שמואל",
		additionals: [
			{ name: "שמואל א", perakim: [{}] },
			{ name: "שמואל ב", perakim: [{}, {}] },
		],
	} as unknown as SefarimItem;
}

describe("sefer-document-title", () => {
	describe("buildSeferPerekTitles", () => {
		it("builds qualified sources for a regular sefer", () => {
			expect(buildSeferPerekTitles(seferWithPerakim(2))).toEqual([
				{ source: "בראשית א", seferName: "בראשית", perekHeb: "א" },
				{ source: "בראשית ב", seferName: "בראשית", perekHeb: "ב" },
			]);
		});

		it("restarts perek numbering for sefarim with additionals", () => {
			expect(buildSeferPerekTitles(seferWithAdditionals())).toEqual([
				{ source: "שמואל א א", seferName: "שמואל", perekHeb: "א" },
				{ source: "שמואל ב א", seferName: "שמואל", perekHeb: "א" },
				{ source: "שמואל ב ב", seferName: "שמואל", perekHeb: "ב" },
			]);
		});
	});

	describe("standalone page title formats", () => {
		it("matches the flat perek page title", () => {
			expect(perekDocumentTitle("בראשית א")).toBe('בראשית א | תנ"ך על הפרק');
		});

		it("matches the standalone article page title", () => {
			expect(
				articleDocumentTitle({ name: "מאמר ראשון", authorName: "הרב ישראל" }),
			).toBe('מאמר ראשון | הרב ישראל | תנ"ך על הפרק');
		});

		it("matches the standalone perush page title", () => {
			expect(
				perushDocumentTitle(
					{ name: 'רש"י' },
					{ source: "שמואל ב א", seferName: "שמואל", perekHeb: "א" },
				),
			).toBe('רש"י על שמואל א | תנ"ך על הפרק');
		});
	});

	describe("buildSeferDocumentTitleResolver", () => {
		const pereks = buildSeferPerekTitles(seferWithPerakim(2));
		const backCoverPageIndex = CONTENT_OFFSET + 4;
		const resolve = buildSeferDocumentTitleResolver(
			"בראשית",
			pereks,
			backCoverPageIndex,
		);

		it("names the sefer on the front cover", () => {
			expect(resolve(0)).toBe('ספר בראשית | תנ"ך על הפרק');
		});

		it("names the contents page on the TOC spread", () => {
			expect(resolve(1)).toBe('ספר בראשית - תוכן העניינים | תנ"ך על הפרק');
			expect(resolve(2)).toBe('ספר בראשית - תוכן העניינים | תנ"ך על הפרק');
		});

		it("names the perek on content pages like the flat page", () => {
			expect(resolve(CONTENT_OFFSET)).toBe('בראשית א | תנ"ך על הפרק');
			expect(resolve(CONTENT_OFFSET + 2)).toBe('בראשית ב | תנ"ך על הפרק');
		});

		it("keeps the companion blank page on the same perek title", () => {
			expect(resolve(CONTENT_OFFSET + 1)).toBe('בראשית א | תנ"ך על הפרק');
			expect(resolve(CONTENT_OFFSET + 3)).toBe('בראשית ב | תנ"ך על הפרק');
		});

		it("marks the back cover", () => {
			expect(resolve(backCoverPageIndex)).toBe(
				'ספר בראשית - גב הספר | תנ"ך על הפרק',
			);
		});

		it("names divided sefarim like their flat pages", () => {
			const shmuel = buildSeferPerekTitles(seferWithAdditionals());
			const resolveShmuel = buildSeferDocumentTitleResolver(
				"שמואל",
				shmuel,
				CONTENT_OFFSET + shmuel.length * 2,
			);
			expect(resolveShmuel(CONTENT_OFFSET)).toBe('שמואל א א | תנ"ך על הפרק');
			expect(resolveShmuel(CONTENT_OFFSET + 2)).toBe(
				'שמואל ב א | תנ"ך על הפרק',
			);
			expect(resolveShmuel(CONTENT_OFFSET + 4)).toBe(
				'שמואל ב ב | תנ"ך על הפרק',
			);
		});

		it("returns null for pages outside the book", () => {
			expect(resolve(backCoverPageIndex + 1)).toBeNull();
			expect(resolve(-1)).toBeNull();
			expect(resolve(Number.NaN)).toBeNull();
			expect(resolve(2.5)).toBeNull();
		});
	});

	describe("title ownership", () => {
		beforeEach(() => {
			document.title = "";
			releaseSeferDocumentTitle("");
		});

		it("writes the title while the reader owns it", () => {
			setSeferDocumentTitle('בראשית א | תנ"ך על הפרק');
			expect(document.title).toBe('בראשית א | תנ"ך על הפרק');
		});

		it("restores the fallback when the reader still owns the title", () => {
			setSeferDocumentTitle("book title");
			releaseSeferDocumentTitle("flat title");
			expect(document.title).toBe("flat title");
		});

		it("leaves a newer title alone when the reader no longer owns it", () => {
			setSeferDocumentTitle("book title");
			document.title = "other page title";
			releaseSeferDocumentTitle("flat title");
			expect(document.title).toBe("other page title");
		});

		it("does not restore twice after ownership was released", () => {
			setSeferDocumentTitle("book title");
			releaseSeferDocumentTitle("flat title");
			document.title = "other page title";
			releaseSeferDocumentTitle("stale title");
			expect(document.title).toBe("other page title");
		});
	});
});
