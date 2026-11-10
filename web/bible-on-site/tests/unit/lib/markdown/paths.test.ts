import {
	canonicalPathForTarget,
	markdownTargetForPath,
	splitMarkdownSuffix,
} from "@/lib/markdown/paths";

describe("splitMarkdownSuffix", () => {
	it("strips a trailing .md case-insensitively", () => {
		expect(splitMarkdownSuffix("/929/1.md")).toEqual({
			contentPath: "/929/1",
			isMarkdown: true,
		});
		expect(splitMarkdownSuffix("/929/1.MD")).toEqual({
			contentPath: "/929/1",
			isMarkdown: true,
		});
	});

	it("leaves plain paths unchanged", () => {
		expect(splitMarkdownSuffix("/929/1")).toEqual({
			contentPath: "/929/1",
			isMarkdown: false,
		});
		expect(splitMarkdownSuffix("/x.mdx")).toEqual({
			contentPath: "/x.mdx",
			isMarkdown: false,
		});
	});
});

describe("markdownTargetForPath", () => {
	it.each([
		["/", { kind: "home" }],
		["/929", { kind: "tanah-index" }],
		["/929/1", { kind: "perek", perekId: 1 }],
		["/929/929", { kind: "perek", perekId: 929 }],
		["/929/12/34", { kind: "article", perekId: 12, articleId: 34 }],
		["/929/1/רש\"י", { kind: "perush", perekId: 1, name: 'רש"י' }],
		["/929/authors", { kind: "authors-index" }],
		["/929/authors/הרב-א", { kind: "author", slug: "הרב-א" }],
		["/פרשה", { kind: "parasha-index" }],
		["/פרשה/בראשית", { kind: "parasha", unitId: 1 }],
		["/מסורה", { kind: "masora-index" }],
		["/מסורה/1", { kind: "masora", unitId: 1 }],
		["/masora/1", { kind: "masora", unitId: 1 }],
		["/מועדים", { kind: "moadim-index" }],
		["/מועדים/פסח", { kind: "moed", slug: "פסח" }],
		["/pedia", { kind: "pedia-index" }],
		["/pedia/אברהם", { kind: "pedia", slug: "אברהם" }],
	])("resolves %s", (path, expected) => {
		expect(markdownTargetForPath(path)).toEqual(expected);
	});

	it("resolves percent-encoded paths the same way", () => {
		expect(
			markdownTargetForPath(`/${encodeURIComponent("פרשה")}/${encodeURIComponent("בראשית")}`),
		).toEqual({ kind: "parasha", unitId: 1 });
	});

	it.each([
		// Off-corpus and management surfaces never resolve.
		"/api/search",
		"/api/dev/x",
		"/dev/dashboard",
		"/dev",
		"/search",
		"/calendar",
		"/robots.txt",
		"/sitemap.xml",
		"/openapi.json",
		"/llms.txt",
		"/.well-known/api-catalog",
		"/md/929/1",
		// Out-of-range corpus ids are missing, not routable.
		"/929/0",
		"/929/930",
		"/929/1/2/3",
		"/פרשה/55",
		"/פרשה/not-a-unit",
		"/מסורה/0",
		"/מסורה/abc",
		"/929/authors/a/b",
		"/929/abc",
		"/pedia/a/b",
		"/foo/bar",
		"/%invalid",
		// Extra depth under a known family is off-corpus too.
		"/מועדים/פסח/extra",
		"/masora/1/deep",
	])("returns null for %s", (path) => {
		expect(markdownTargetForPath(path)).toBeNull();
	});
});

describe("canonicalPathForTarget", () => {
	it.each([
		[{ kind: "home" } as const, "/"],
		[{ kind: "tanah-index" } as const, "/929"],
		[{ kind: "perek", perekId: 1 } as const, "/929/1"],
		[{ kind: "article", perekId: 1, articleId: 7 } as const, "/929/1/7"],
		[{ kind: "perush", perekId: 1, name: 'רש"י' } as const, `/929/1/${encodeURIComponent('רש"י')}`],
		[{ kind: "authors-index" } as const, "/929/authors"],
		[{ kind: "author", slug: "הרב-א" } as const, `/929/authors/${encodeURIComponent("הרב-א")}`],
		[{ kind: "parasha-index" } as const, "/פרשה"],
		[{ kind: "parasha", unitId: 1 } as const, "/פרשה/בראשית"],
		[{ kind: "masora-index" } as const, "/מסורה"],
		[{ kind: "masora", unitId: 3 } as const, "/מסורה/3"],
		[{ kind: "moadim-index" } as const, "/מועדים"],
		[{ kind: "pedia-index" } as const, "/pedia"],
		[{ kind: "moed", slug: "פסח" } as const, "/מועדים/פסח"],
		[{ kind: "pedia", slug: "אברהם" } as const, `/pedia/${encodeURIComponent("אברהם")}`],
		[{ kind: "pedia", slug: "person" } as const, `/pedia/${encodeURIComponent("אישים")}`],
	])("maps %j to %s", (target, expected) => {
		expect(canonicalPathForTarget(target)).toBe(expected);
	});
});
