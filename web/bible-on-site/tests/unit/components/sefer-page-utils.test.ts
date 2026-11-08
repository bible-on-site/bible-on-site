import {
	bookPageFromPath,
	bookPageFromQuery,
	buildHistoryMapper,
	buildPageSemantics,
	CONTENT_OFFSET,
	computeInitialTurnedLeaves,
	DOWNLOAD_FAILED_MESSAGE,
	DownloadFailedError,
	downloadErrorMessage,
	runDownload,
	seferBookExitPath,
	toHebrewChapterNumber,
} from "@/app/929/[number]/components/sefer-page-utils";

describe("sefer-page-utils", () => {
	describe("toHebrewChapterNumber", () => {
		it("uses plain Hebrew letters for single-letter numbers", () => {
			expect(toHebrewChapterNumber(1)).toBe("א");
			expect(toHebrewChapterNumber(5)).toBe("ה");
		});

		it("uses plain Hebrew letters for multi-letter numbers", () => {
			expect(toHebrewChapterNumber(11)).toBe("יא");
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
				expect(semantics.indexToSemanticName(CONTENT_OFFSET)).toBe("א");
				expect(semantics.indexToSemanticName(CONTENT_OFFSET + 2)).toBe("ב");
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
				expect(semantics.indexToTitle(CONTENT_OFFSET + 4)).toBe("פרק ג");
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
		const mapper = buildHistoryMapper(perekIds, pageSemantics, "בראשית");

		describe("pageToRoute", () => {
			it("gives both covers shareable book routes", () => {
				expect(mapper.pageToRoute(0, undefined)).toBe("/929/בראשית/כריכה?book");
				expect(mapper.pageToRoute(9, undefined)).toBe("/929/בראשית/גב?book");
			});

			it("gives the TOC a shareable book route", () => {
				expect(mapper.pageToRoute(1, undefined)).toBe("/929/בראשית/תוכן?book");
				expect(mapper.pageToRoute(2, undefined)).toBe("/929/בראשית/תוכן?book");
			});

			it("returns route with ?book for content pages", () => {
				expect(mapper.pageToRoute(CONTENT_OFFSET, undefined)).toBe(
					"/929/100?book",
				);
				expect(mapper.pageToRoute(CONTENT_OFFSET + 2, undefined)).toBe(
					"/929/101?book",
				);
			});

			it("clamps to last perekId for pages beyond range", () => {
				expect(mapper.pageToRoute(CONTENT_OFFSET + 100, undefined)).toBe(
					"/929/102?book",
				);
			});

			it("ignores a page index before the book", () => {
				expect(mapper.pageToRoute(-1, undefined)).toBeNull();
			});

			it("does not create a route from a malformed saved page index", () => {
				expect(mapper.pageToRoute(Number.NaN, undefined)).toBeNull();
			});

			it("returns null when perekIds is undefined", () => {
				const noIds = buildHistoryMapper(undefined, pageSemantics, "בראשית");
				expect(noIds.pageToRoute(CONTENT_OFFSET, undefined)).toBeNull();
			});
		});

		describe("routeToPage", () => {
			it("resolves /929/{id}?book routes", () => {
				expect(mapper.routeToPage("/929/101?book")).toBe(CONTENT_OFFSET + 2);
			});

			it("restores the TOC from its book route", () => {
				expect(mapper.routeToPage("/929/בראשית/תוכן?book")).toBe(1);
				expect(
					mapper.routeToPage(
						"/929/%D7%91%D7%A8%D7%90%D7%A9%D7%99%D7%AA/%D7%AA%D7%95%D7%9B%D7%9F?book",
					),
				).toBe(1);
				expect(mapper.routeToPage("/929/100?book&toc")).toBe(1);
				expect(mapper.routeToPage("/929/100?toc&book")).toBe(1);
			});

			it("restores the front and back cover routes", () => {
				expect(mapper.routeToPage("/929/בראשית/כריכה?book")).toBe(0);
				expect(mapper.routeToPage("/929/בראשית/גב?book")).toBe(9);
				expect(mapper.routeToPage("/929/שמות/גב?book")).toBeNull();
			});

			it("returns null for routes without ?book and without /929/ pattern", () => {
				expect(mapper.routeToPage("/other/101")).toBeNull();
			});

			it("resolves /929/{id}/{slug}?book routes (perush/article deep link)", () => {
				expect(mapper.routeToPage("/929/101/%D7%A8%D7%A9%22%D7%99?book")).toBe(
					CONTENT_OFFSET + 2,
				);
				expect(mapper.routeToPage("/929/100/42?book")).toBe(CONTENT_OFFSET);
			});

			it("resolves bare /929/{id} routes (no ?book)", () => {
				expect(mapper.routeToPage("/929/100")).toBe(CONTENT_OFFSET);
				expect(mapper.routeToPage("/929/102")).toBe(CONTENT_OFFSET + 4);
			});

			it("returns null for unknown perekId", () => {
				expect(mapper.routeToPage("/929/999?book")).toBeNull();
				expect(mapper.routeToPage("/929/999")).toBeNull();
			});

			it("does not map routes or pages for an empty book", () => {
				const empty = buildHistoryMapper([], pageSemantics, "בראשית");
				expect(empty.routeToPage("/929/100")).toBeNull();
				expect(empty.pageToRoute(CONTENT_OFFSET, undefined)).toBeNull();
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
				const noIds = buildHistoryMapper(undefined, pageSemantics, "בראשית");
				expect(noIds.routeToPage("/929/100?book")).toBeNull();
				expect(noIds.pageToRoute(2, undefined)).toBeNull();
			});
		});
	});

	it("recognizes semantic page slugs in decoded and encoded paths", () => {
		expect(bookPageFromPath("/929/בראשית/כריכה")).toBe("front");
		expect(bookPageFromPath("/929/בראשית/תוכן")).toBe("toc");
		expect(bookPageFromPath("/929/בראשית/גב")).toBe("back");
		expect(
			bookPageFromPath(
				"/929/%D7%91%D7%A8%D7%90%D7%A9%D7%99%D7%AA/%D7%AA%D7%95%D7%9B%D7%9F",
			),
		).toBe("toc");
		expect(bookPageFromPath("/929/1")).toBeNull();
		expect(bookPageFromPath("/929/בראשית/תוכן", "שמות")).toBeNull();
		expect(bookPageFromPath("/929/1/תוכן", "בראשית")).toBeNull();
	});

	it("recognizes semantic page keys supplied by rewrites", () => {
		expect(bookPageFromQuery("front")).toBe("front");
		expect(bookPageFromQuery("toc")).toBe("toc");
		expect(bookPageFromQuery("back")).toBe("back");
		expect(bookPageFromQuery("unknown")).toBeNull();
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

	describe("seferBookExitPath", () => {
		it("returns the perek the flipbook's history wrote to the location", () => {
			expect(seferBookExitPath("/929/30", "בראשית", 10)).toBe("/929/30");
			expect(seferBookExitPath("/929/30?book", "בראשית", 10)).toBe("/929/30");
		});

		it("falls back to the entry perek on book-chrome exits", () => {
			expect(seferBookExitPath("/929/בראשית/כריכה", "בראשית", 10)).toBe(
				"/929/10",
			);
			expect(seferBookExitPath("/929/בראשית/תוכן", "בראשית", 10)).toBe(
				"/929/10",
			);
			expect(seferBookExitPath("/929/בראשית/גב", "בראשית", 10)).toBe("/929/10");
		});

		it("falls back to the entry perek on non-perek paths", () => {
			expect(seferBookExitPath("/929", "בראשית", 10)).toBe("/929/10");
			expect(seferBookExitPath("/מסורה/8", "בראשית", 10)).toBe("/929/10");
		});
	});

	describe("runDownload", () => {
		it("resolves to the file payload on success", async () => {
			const result = await runDownload(async () => ({
				ext: "pdf",
				data: "x",
			}));
			expect(result).toEqual({ ext: "pdf", data: "x" });
		});

		it("resolves to null when the export is unavailable, so the library treats it as cancellation", async () => {
			const result = await runDownload(async () => ({
				error: "not_implemented",
			}));
			expect(result).toBeNull();
		});

		it("rejects with the action's safe message on a structured failure", async () => {
			const rejection = runDownload(async () => ({
				error: "service_unavailable",
				message: "לא ניתן היה לטעון את האיור של בראשית ב",
			}));
			await expect(rejection).rejects.toThrow(DownloadFailedError);
			await expect(rejection).rejects.toThrow(
				"לא ניתן היה לטעון את האיור של בראשית ב",
			);
		});

		it("rejects with the generic message when the action supplies none", async () => {
			const rejection = runDownload(async () => ({
				error: "service_unavailable",
			}));
			await expect(rejection).rejects.toThrow(DOWNLOAD_FAILED_MESSAGE);
		});

		it("rejects a failed server action instead of swallowing it to null", async () => {
			const consoleSpy = jest
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const rejection = runDownload(async () => {
				throw new Error("network");
			});
			await expect(rejection).rejects.toThrow(DownloadFailedError);
			await expect(rejection).rejects.toThrow(DOWNLOAD_FAILED_MESSAGE);
			expect(consoleSpy).toHaveBeenCalledWith(
				"Download action failed:",
				expect.any(Error),
			);
			consoleSpy.mockRestore();
		});

		it.each([[null], [undefined], ["not-an-object"], [{}]])(
			"rejects a malformed resolved outcome (%o) instead of leaking a TypeError",
			async (malformed) => {
				const consoleSpy = jest
					.spyOn(console, "error")
					.mockImplementation(() => {});
				const rejection = runDownload(
					async () =>
						malformed as unknown as { ext: string; data: string },
				);
				await expect(rejection).rejects.toThrow(DownloadFailedError);
				await expect(rejection).rejects.toThrow(DOWNLOAD_FAILED_MESSAGE);
				expect(consoleSpy).toHaveBeenCalledWith(
					"Download action returned malformed outcome:",
					malformed,
				);
				consoleSpy.mockRestore();
			},
		);

		it("succeeds on retry after a rejection", async () => {
			const consoleSpy = jest
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const action = jest
				.fn()
				.mockRejectedValueOnce(new Error("down"))
				.mockResolvedValueOnce({ ext: "pdf", data: "retry" });
			await expect(runDownload(action)).rejects.toThrow(DownloadFailedError);
			await expect(runDownload(action)).resolves.toEqual({
				ext: "pdf",
				data: "retry",
			});
			consoleSpy.mockRestore();
		});
	});

	describe("downloadErrorMessage", () => {
		it("returns the safe message a DownloadFailedError carries", () => {
			expect(
				downloadErrorMessage(new DownloadFailedError("שרת התמונות לא זמין")),
			).toBe("שרת התמונות לא זמין");
		});

		it("falls back to the generic message for an empty DownloadFailedError", () => {
			expect(downloadErrorMessage(new DownloadFailedError())).toBe(
				DOWNLOAD_FAILED_MESSAGE,
			);
		});

		it("does not leak messages of internal errors", () => {
			expect(downloadErrorMessage(new Error("db credentials x"))).toBe(
				DOWNLOAD_FAILED_MESSAGE,
			);
			expect(downloadErrorMessage("raw string failure")).toBe(
				DOWNLOAD_FAILED_MESSAGE,
			);
			expect(downloadErrorMessage(undefined)).toBe(DOWNLOAD_FAILED_MESSAGE);
		});
	});
});
