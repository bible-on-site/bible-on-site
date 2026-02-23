import {
	CONTENT_OFFSET,
	buildHistoryMapper,
	buildPageSemantics,
	computeInitialTurnedLeaves,
	toHebrewWithPunctuation,
	wrapDownloadResult,
} from "@/app/929/[number]/components/sefer-page-utils";

describe("sefer-page-utils", () => {
	describe("toHebrewWithPunctuation", () => {
		it("adds geresh to single-letter numbers", () => {
			expect(toHebrewWithPunctuation(1)).toBe("א'");
			expect(toHebrewWithPunctuation(5)).toBe("ה'");
		});

		it("keeps gershaim for multi-letter numbers", () => {
			const result = toHebrewWithPunctuation(11);
			expect(result).toContain('"');
			expect(result).not.toContain("'");
		});
	});

	describe("buildPageSemantics", () => {
		const perakimLength = 5;
		const headers = ["אחרי הדברים", "ויהי", undefined, "בראשית", "ויקרא"];
		const semantics = buildPageSemantics(perakimLength, headers);

		describe("indexToSemanticName", () => {
			it("returns empty for cover pages", () => {
				expect(semantics.indexToSemanticName(0)).toBe("");
				expect(semantics.indexToSemanticName(1)).toBe("");
				expect(semantics.indexToSemanticName(2)).toBe("");
			});

			it("returns empty for blank (odd offset) pages", () => {
				expect(semantics.indexToSemanticName(CONTENT_OFFSET + 1)).toBe("");
			});

			it("returns hebrew numeral for content pages", () => {
				expect(semantics.indexToSemanticName(CONTENT_OFFSET)).toBe("א'");
				expect(semantics.indexToSemanticName(CONTENT_OFFSET + 2)).toBe("ב'");
			});

			it("returns empty for pages beyond perakim", () => {
				const beyondIndex = CONTENT_OFFSET + perakimLength * 2;
				expect(semantics.indexToSemanticName(beyondIndex)).toBe("");
			});
		});

		describe("semanticNameToIndex", () => {
			it("returns page index for valid hebrew numeral", () => {
				expect(semantics.semanticNameToIndex("א")).toBe(CONTENT_OFFSET);
				expect(semantics.semanticNameToIndex("ב")).toBe(CONTENT_OFFSET + 2);
			});

			it("returns null for zero or invalid input", () => {
				expect(semantics.semanticNameToIndex("")).toBeNull();
			});

			it("returns null for perek beyond range", () => {
				expect(semantics.semanticNameToIndex("ק")).toBeNull();
			});
		});

		describe("indexToTitle", () => {
			it("returns empty for cover pages", () => {
				expect(semantics.indexToTitle(0)).toBe("");
			});

			it("returns empty for blank pages", () => {
				expect(semantics.indexToTitle(CONTENT_OFFSET + 1)).toBe("");
			});

			it("returns header when available", () => {
				expect(semantics.indexToTitle(CONTENT_OFFSET)).toBe("אחרי הדברים");
			});

			it("falls back to פרק X when header is missing", () => {
				expect(semantics.indexToTitle(CONTENT_OFFSET + 4)).toBe("פרק ג'");
			});

			it("returns empty for pages beyond perakim", () => {
				const beyondIndex = CONTENT_OFFSET + perakimLength * 2;
				expect(semantics.indexToTitle(beyondIndex)).toBe("");
			});
		});
	});

	describe("buildHistoryMapper", () => {
		const perekIds = [100, 101, 102];
		const pageSemantics = buildPageSemantics(3, ["a", "b", "c"]);
		const mapper = buildHistoryMapper(perekIds, pageSemantics);

		describe("pageToRoute", () => {
			it("returns null for cover pages", () => {
				expect(mapper.pageToRoute(0, undefined)).toBeNull();
				expect(mapper.pageToRoute(1, undefined)).toBeNull();
				expect(mapper.pageToRoute(2, undefined)).toBeNull();
			});

			it("returns route with ?book for content pages", () => {
				expect(mapper.pageToRoute(CONTENT_OFFSET, undefined)).toBe("/929/100?book");
				expect(mapper.pageToRoute(CONTENT_OFFSET + 2, undefined)).toBe("/929/101?book");
			});

			it("clamps to last perekId for pages beyond range", () => {
				expect(mapper.pageToRoute(CONTENT_OFFSET + 100, undefined)).toBe("/929/102?book");
			});

			it("returns null when perekIds is undefined", () => {
				const noIds = buildHistoryMapper(undefined, pageSemantics);
				expect(noIds.pageToRoute(CONTENT_OFFSET, undefined)).toBeNull();
			});
		});

		describe("routeToPage", () => {
			it("resolves /929/{id}?book routes", () => {
				expect(mapper.routeToPage("/929/101?book")).toBe(CONTENT_OFFSET + 2);
			});

			it("returns null for routes without ?book", () => {
				expect(mapper.routeToPage("/929/101")).toBeNull();
			});

			it("returns null for unknown perekId", () => {
				expect(mapper.routeToPage("/929/999?book")).toBeNull();
			});

			it("handles hash-based bookmarks", () => {
				expect(mapper.routeToPage("#page/א")).toBe(CONTENT_OFFSET);
			});

			it("returns null for non-matching routes", () => {
				expect(mapper.routeToPage("/other/path")).toBeNull();
			});

			it("returns null for ?book route that does not match /929/ pattern", () => {
				expect(mapper.routeToPage("/other?book")).toBeNull();
			});

			it("returns null when perekIds is undefined and route is ?book", () => {
				const noIds = buildHistoryMapper(undefined, pageSemantics);
				expect(noIds.routeToPage("/929/100?book")).toBeNull();
			});
		});
	});

	describe("computeInitialTurnedLeaves", () => {
		it("returns leaf indices up to current perek", () => {
			const result = computeInitialTurnedLeaves([10, 20, 30], 20);
			const expectedPageIndex = 1 * 2 + CONTENT_OFFSET; // idx=1
			const expectedTurned = Math.ceil(expectedPageIndex / 2);
			expect(result).toEqual(
				Array.from({ length: expectedTurned }, (_, i) => i),
			);
		});

		it("returns undefined when perekId not found", () => {
			expect(computeInitialTurnedLeaves([10, 20, 30], 999)).toBeUndefined();
		});

		it("returns undefined when perekIds is undefined", () => {
			expect(computeInitialTurnedLeaves(undefined, 10)).toBeUndefined();
		});
	});

	describe("wrapDownloadResult", () => {
		it("returns null for error results", () => {
			expect(wrapDownloadResult({ error: "something failed" })).toBeNull();
		});

		it("returns ext and data for success results", () => {
			const result = wrapDownloadResult({ ext: "pdf", data: "base64content" });
			expect(result).toEqual({ ext: "pdf", data: "base64content" });
		});
	});
});
