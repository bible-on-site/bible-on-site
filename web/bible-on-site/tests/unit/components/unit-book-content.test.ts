/**
 * @jest-environment jsdom
 *
 * Contract coverage for alternative-division in-book content URLs
 * (issue #2191): scope params, route parsing across the public Hebrew
 * root and its ASCII route dir, deep-link hrefs, and content-history
 * writes that keep the unit's book route as their page address.
 */
import {
	type UnitBookContent,
	unitBookContentFromRoute,
	unitBookContentHref,
	unitBookContentParam,
	unitBookContentSlug,
	writeUnitBookContentHistory,
} from "@/app/components/reading/unit-book-content";
import { resolveParashaSegment } from "@/data/parasha/parasha-slugs";

const MASORA_ROOTS = ["/מסורה", "/masora"] as const;
const PARASHA_ROOTS = ["/פרשה", "/parasha"] as const;
/** The פרשה division's segment adapter: canonical slugs plus every
 * backward-compatible form (issue #2738). */
const parashaUnitIdFor = (segment: string) =>
	resolveParashaSegment(segment)?.unitId ?? null;

describe("unitBookContentParam", () => {
	it("maps scopes and kinds to the flat page's param names", () => {
		expect(unitBookContentParam("torah", "perush")).toBe("perush");
		expect(unitBookContentParam("torah", "article")).toBe("article");
		expect(unitBookContentParam("haftara", "perush")).toBe("haftaraPerush");
		expect(unitBookContentParam("haftara", "article")).toBe(
			"haftaraArticle",
		);
	});
});

describe("unitBookContentFromRoute", () => {
	it("parses a Torah content deep link", () => {
		expect(
			unitBookContentFromRoute("/מסורה/5?book&perush=x", MASORA_ROOTS),
		).toEqual({
			unitId: 5,
			haftara: false,
			perush: "x",
			article: undefined,
			haftaraPerush: undefined,
			haftaraArticle: undefined,
		});
	});

	it("parses a Haftarah content deep link on a canonical slug", () => {
		expect(
			unitBookContentFromRoute(
				"/פרשה/לך-לך?book&haftara&haftaraPerush=y",
				PARASHA_ROOTS,
				parashaUnitIdFor,
			),
		).toEqual({
			unitId: 3,
			haftara: true,
			perush: undefined,
			article: undefined,
			haftaraPerush: "y",
			haftaraArticle: undefined,
		});
	});

	it("parses legacy numeric and alias parasha segments", () => {
		expect(
			unitBookContentFromRoute(
				"/פרשה/3?book&article=4",
				PARASHA_ROOTS,
				parashaUnitIdFor,
			),
		).toMatchObject({ unitId: 3, article: "4" });
		expect(
			unitBookContentFromRoute(
				"/parasha/שלח לך?book",
				PARASHA_ROOTS,
				parashaUnitIdFor,
			),
		).toMatchObject({ unitId: 37 });
		expect(
			unitBookContentFromRoute(
				"/פרשה/דמיון?book",
				PARASHA_ROOTS,
				parashaUnitIdFor,
			),
		).toBeNull();
	});

	it("accepts the ASCII route dir and percent-encoded roots", () => {
		expect(unitBookContentFromRoute("/masora/5?book", MASORA_ROOTS)).toEqual({
			unitId: 5,
			haftara: false,
			perush: undefined,
			article: undefined,
			haftaraPerush: undefined,
			haftaraArticle: undefined,
		});
		expect(
			unitBookContentFromRoute(
				`/${encodeURIComponent("מסורה")}/7?book&article=12`,
				MASORA_ROOTS,
			),
		).toMatchObject({ unitId: 7, article: "12" });
	});

	it("rejects routes outside the book or outside the division", () => {
		// No ?book — a flat page route carries no in-book selection.
		expect(
			unitBookContentFromRoute("/מסורה/5?perush=x", MASORA_ROOTS),
		).toBeNull();
		// The bare division root has no unit.
		expect(unitBookContentFromRoute("/מסורה?book", MASORA_ROOTS)).toBeNull();
		expect(
			unitBookContentFromRoute(
				"/פרשה/חיי-שרה?book",
				MASORA_ROOTS,
				parashaUnitIdFor,
			),
		).toBeNull();
		expect(unitBookContentFromRoute("/929/5?book", MASORA_ROOTS)).toBeNull();
		// Book-chrome paths carry no unit selection on their own either —
		// the slug segment is not numeric.
		expect(
			unitBookContentFromRoute("/מסורה/5/כריכה?book", MASORA_ROOTS),
		).toEqual({
			unitId: 5,
			haftara: false,
			perush: undefined,
			article: undefined,
			haftaraPerush: undefined,
			haftaraArticle: undefined,
		});
		expect(
			unitBookContentFromRoute("/מסורה/abc?book", MASORA_ROOTS),
		).toBeNull();
	});
});

describe("unitBookContentSlug", () => {
	const content: UnitBookContent = {
		unitId: 5,
		haftara: true,
		perush: "a",
		haftaraPerush: "b",
	};

	it("returns the scope's selection, preferring perush over article", () => {
		expect(unitBookContentSlug(content, 5, "torah")).toBe("a");
		expect(unitBookContentSlug(content, 5, "haftara")).toBe("b");
		expect(
			unitBookContentSlug(
				{ ...content, perush: undefined, article: "c" },
				5,
				"torah",
			),
		).toBe("c");
	});

	it("returns undefined for another unit or empty content", () => {
		expect(unitBookContentSlug(content, 6, "torah")).toBeUndefined();
		expect(unitBookContentSlug(null, 5, "torah")).toBeUndefined();
	});
});

describe("unitBookContentHref", () => {
	it("builds scope-qualified deep links inside the book", () => {
		expect(unitBookContentHref("/מסורה/5", "torah", "perush", "x")).toBe(
			"/מסורה/5?book=&perush=x",
		);
		expect(
			unitBookContentHref("/פרשה/לך-לך", "haftara", "perush", "y"),
		).toBe("/פרשה/לך-לך?book=&haftara=&haftaraPerush=y");
		expect(
			unitBookContentHref("/פרשה/לך-לך", "haftara", "article", "7"),
		).toBe("/פרשה/לך-לך?book=&haftara=&haftaraArticle=7");
	});
});

describe("writeUnitBookContentHistory", () => {
	beforeEach(() => {
		history.replaceState(null, "", "/מסורה/5?book=&keep=1");
	});

	it("writes a scope content route preserving unrelated params", () => {
		const route = writeUnitBookContentHistory(
			"/מסורה",
			5,
			"torah",
			"perush",
			"x",
		);
		expect(route).toBe("/מסורה/5?book=&keep=1&perush=x");
		expect(decodeURIComponent(location.pathname + location.search)).toBe(
			"/מסורה/5?book=&keep=1&perush=x",
		);
	});

	it("clears the scope's selection when kind is omitted", () => {
		history.replaceState(
			null,
			"",
			"/פרשה/לך-לך?book=&haftara=&haftaraPerush=y&perush=z",
		);
		// The פרשה caller passes the canonical slug as the unit segment.
		writeUnitBookContentHistory("/פרשה", "לך-לך", "haftara");
		// Clearing the haftara selection drops only its params; the
		// spread flag and the Torah selection survive.
		expect(decodeURIComponent(location.pathname) + location.search).toBe(
			"/פרשה/לך-לך?book=&haftara=&perush=z",
		);
	});

	it("marks the haftara scope on the route", () => {
		writeUnitBookContentHistory("/פרשה", "לך-לך", "haftara", "perush", "y");
		expect(decodeURIComponent(location.pathname) + location.search).toBe(
			"/פרשה/לך-לך?book=&keep=1&haftara=&haftaraPerush=y",
		);
	});

	it("replaces instead of pushing when asked", () => {
		const pushes: string[] = [];
		const original = History.prototype.pushState;
		History.prototype.pushState = function (
			this: History,
			state: unknown,
			title: string,
			url?: string | URL | null,
		) {
			pushes.push(String(url));
			return original.call(this, state, title, url);
		};
		try {
			writeUnitBookContentHistory(
				"/מסורה",
				5,
				"torah",
				"perush",
				"x",
				true,
			);
			expect(pushes).toEqual([]);
			expect(decodeURIComponent(location.search)).toContain("perush=x");
		} finally {
			History.prototype.pushState = original;
		}
	});
});
