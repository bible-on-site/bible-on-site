import { expect, test } from "../util/playwright/test-fixture";
import { TOP_NAV_BLUE, topNavBackground } from "../util/playwright/top-nav";

const PARASHA_ROOT = `/${encodeURIComponent("פרשה")}`;

/** Encoded public path for a canonical slug (issue #2738). */
const unitPath = (slug: string) =>
	`${PARASHA_ROOT}/${encodeURIComponent(slug)}`;

/** Matches a decoded pathname exactly — browser URLs stay percent-encoded. */
const pathnameIs = (path: string) => (url: URL) =>
	decodeURIComponent(url.pathname) === path;

/**
 * פרשה reader e2e — the weekly Torah-reading division under its own
 * root. Covers the landing (five Torah sefarim only), a unit's Torah
 * text, the labeled Haftarah custom variants, multi-range auxiliary
 * readings, unit navigation, and indexable base readings with duplicate
 * presentation/content variants excluded from search.
 *
 * Issue #2738: public unit URLs are canonical Hebrew-name slugs —
 * legacy numeric ids, researched aliases, and the ASCII route dir
 * permanent-redirect to them.
 */
test.describe("פרשה reading root", () => {
	// Unit pages render Torah text, every Haftarah variant, perushim,
	// articles, and the embedded sefer book — cold compilation under the
	// e2e dev server can exceed the default 20s budget and parallel
	// workers thrash the first-hit compile even further.
	test.describe.configure({ timeout: 120_000 });

	test("landing lists only the five Torah sefarim", async ({ page }) => {
		await page.goto(PARASHA_ROOT);
		await expect(
			page.getByRole("heading", { name: "פרשה על הפרק" }),
		).toBeVisible();
		await expect(page).toHaveTitle(/פרשה על הפרק/);

		for (const sefer of ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"]) {
			await expect(
				page.getByRole("heading", { name: `ספר ${sefer}` }),
			).toBeVisible();
		}
		// Prophetic sefarim appear only inside Haftarah readings — never
		// as primary sefarim.
		await expect(page.getByRole("heading", { name: "ספר ישעיהו" })).toHaveCount(
			0,
		);

		// Reference sections render but do not replace static content.
		await expect(
			page.getByRole("heading", { name: "פרשיות מחוברות" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", {
				name: "הפטרות לשבתות ומועדים מיוחדים",
			}),
		).toBeVisible();

		// Every listed parasha href is a canonical Hebrew-name slug.
		for (const link of await page
			.locator("ol a[href]")
			.evaluateAll((anchors) =>
				anchors.map((a) => decodeURIComponent(a.getAttribute("href") ?? "")),
			)) {
			expect(link).toMatch(/^\/פרשה\/[א-ת-]+$/);
		}

		await page
			.getByRole("link", { name: /פרשת בראשית/ })
			.first()
			.click();
		// First visit compiles the unit route — allow for cold dev servers.
		await page.waitForURL(pathnameIs("/פרשה/בראשית"), { timeout: 90_000 });
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת בראשית/ }),
		).toBeVisible();
	});

	test("legacy numeric and alias URLs permanent-redirect to canonical slugs", async ({
		request,
		baseURL,
	}) => {
		for (const [legacy, slug] of [
			["/פרשה/1", "/פרשה/בראשית"],
			["/פרשה/54", "/פרשה/וזאת-הברכה"],
			["/parasha/1", "/פרשה/בראשית"],
			["/פרשה/תצווה", "/פרשה/תצוה"],
			["/פרשה/שלח לך", "/פרשה/שלח"],
			["/פרשה/פרשת לך לך", "/פרשה/לך-לך"],
		] as const) {
			const response = await request.get(legacy, {
				maxRedirects: 0,
			});
			expect(response.status(), legacy).toBe(308);
			const location = response.headers().location ?? "";
			// The proxy emits a same-origin (relative) Location — resolve it
			// against the configured baseURL (the suite's per-worktree port).
			expect(
				decodeURIComponent(
					new URL(location, baseURL ?? "http://localhost").pathname,
				),
				legacy,
			).toBe(slug);
		}
	});

	test("numeric and alias entry points land on the canonical page", async ({
		page,
	}) => {
		await page.goto(`${PARASHA_ROOT}/3`);
		await page.waitForURL(pathnameIs("/פרשה/לך-לך"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת לך לך/ }),
		).toBeVisible();
	});

	test("renders the shared blue top bar on direct load", async ({ page }) => {
		await page.goto(PARASHA_ROOT);
		await expect(
			page.getByRole("heading", { name: "פרשה על הפרק" }),
		).toBeVisible();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("keeps the shared blue top bar when navigating from another page", async ({
		page,
	}) => {
		await page.goto("/");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		await page
			.locator("#main-menu")
			.getByRole("link", { name: "פרשה על הפרק", exact: true })
			.click();
		await page.waitForURL(
			(url) => decodeURIComponent(url.pathname) === "/פרשה",
		);
		await expect(
			page.getByRole("heading", { name: "פרשה על הפרק" }),
		).toBeVisible();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("unit page renders Torah text and labeled Haftarah variants", async ({
		page,
	}) => {
		await page.goto(unitPath("בראשית"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת בראשית/ }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "קריאת התורה" }),
		).toBeVisible();

		// Canonical pasuk anchors across the whole Torah range
		// (בראשית א א - ו ח → perekIds 1-6).
		await expect(page.locator("#pasuk-1-1")).toBeAttached();
		await expect(page.locator("#pasuk-6-8")).toBeAttached();

		// Every custom variant is labeled — nothing flattened.
		await expect(
			page.getByRole("heading", { name: "הפטרה", exact: true }),
		).toBeVisible();
		for (const custom of ["ספרדים", "אשכנזים", "תימנים"]) {
			await expect(
				page.getByRole("heading", { name: `הפטרה - ${custom}` }),
			).toBeVisible();
		}
		// Haftarah text renders (ישעיהו מב → perekId 376); auxiliary
		// anchors are scope-suffixed so overlapping variants stay unique.
		await expect(page.locator("#pasuk-376-5-haftara-sefaradi")).toBeAttached();

		// Range-scoped commentary/article sections for both readings.
		await expect(
			page.getByRole("heading", { name: "פרשנים על הפרשה" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "פרשנים על ההפטרה" }),
		).toBeVisible();

		// Adjacent-unit navigation by parasha identity — canonical slugs.
		// Soft navigations compile the target RSC route under the dev
		// server — same cold-compile budget as the landing nav above.
		await page.getByRole("link", { name: /פרשה הבאה/ }).click();
		await page.waitForURL(pathnameIs("/פרשה/נח"), { timeout: 90_000 });
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת נח/ }),
		).toBeVisible();
		await page.getByRole("link", { name: /פרשה קודמת/ }).click();
		await page.waitForURL(pathnameIs("/פרשה/בראשית"), { timeout: 90_000 });
	});

	test("multi-range Haftarah preserves the perek jump", async ({ page }) => {
		// פרשת יתרו (unit 17): אשכנזים reads ישעיהו ו-ז plus ט ה-ו —
		// separate ranges, never filled in between.
		await page.goto(unitPath("יתרו"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת יתרו/ }),
		).toBeVisible();
		await expect(page.locator("#pasuk-341-6-haftara-ashkenazi")).toBeAttached();
		await expect(page.locator("#pasuk-343-5-haftara-ashkenazi")).toBeAttached();
		// The skipped perek's pesukim (ישעיהו ח → perekId 342) are absent.
		await expect(page.locator('[id^="pasuk-342-"]')).toHaveCount(0);
	});

	test("renders every aliyah division inline at its canonical positions", async ({
		page,
	}, testInfo) => {
		// פרשת ויגש (unit 11): שבת + חול + the documented חב"ד re-slicing
		// of עליות ג-ה — all three layers show together inline (#3165);
		// nothing is hidden behind a selector.
		await page.goto(unitPath("ויגש"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת ויגש/ }),
		).toBeVisible();

		const torahText = page.locator('[data-unit-text="torah"]');
		// `~=` matches a layer's key inside a merged marker's
		// space-separated constituent keys as well as a standalone one.
		const markersAt = (pasukId: string, key?: string) =>
			torahText.locator(
				`#${pasukId} [data-aliyah-marker]${key ? `[data-aliyah-key~='${key}']` : ""}`,
			);

		// No layer hides — the marker contract renders everything.
		await expect(torahText.locator("[data-aliyah-marker][hidden]")).toHaveCount(
			0,
		);

		// The base and custom divisions each sit at their own canonical
		// starts: Shabbat's רביעי at מה יט, חב"ד's רביעי at מה כח.
		await expect(markersAt("pasuk-45-19", "Vayigash:shabbat")).toHaveText(
			/שבת רביעי/,
		);
		await expect(markersAt("pasuk-45-28", 'Vayigash:shabbat:חב"ד')).toHaveText(
			/חב"ד רביעי/,
		);
		await expect(markersAt("pasuk-46-8", 'Vayigash:shabbat:חב"ד')).toHaveText(
			/חב"ד חמישי/,
		);

		// Coincident agreeing boundaries merge into one shared pill —
		// the three coincident ראשוןs become a single marker tagged with
		// the shared schemes; the agreeing חב"ד custom folds into the
		// detail without a name of its own, while every constituent key
		// rides along so emphasis works for any merged layer.
		const startCluster = markersAt("pasuk-44-18");
		await expect(startCluster).toHaveCount(1);
		expect(await startCluster.getAttribute("data-aliyah-key")).toBe(
			'Vayigash:shabbat Vayigash:shabbat:חב"ד Vayigash:weekday',
		);
		await expect(startCluster).toHaveText(/שבת\+חול ראשון/);
		await expect(startCluster).toHaveAttribute(
			"data-aliyah-category",
			"shared",
		);
		// The merged detail still enumerates every agreeing layer.
		expect(await startCluster.getAttribute("aria-label")).toContain(
			"קריאת חול",
		);
		expect(await startCluster.getAttribute("aria-label")).toContain(
			'מנהג חב"ד',
		);

		// Weekday boundaries mark their own positions too.
		await expect(markersAt("pasuk-44-21", "Vayigash:weekday")).toHaveText(
			/חול שני/,
		);

		// Maftir keeps its role distinction.
		await expect(markersAt("pasuk-47-25", "Vayigash:shabbat")).toHaveAttribute(
			"data-aliyah-role",
			"maftir",
		);

		// Scripture itself is never duplicated — one span per pasuk.
		await expect(page.locator("#pasuk-45-19")).toHaveCount(1);
		await expect(page.locator("#pasuk-45-28")).toHaveCount(1);

		await testInfo.attach("aliyah-all-layers", {
			body: await page.locator("#pasuk-44-18").screenshot(),
			contentType: "image/png",
		});
	});

	test("the legend emphasizes a layer without hiding the rest", async ({
		page,
	}, testInfo) => {
		await page.goto(unitPath("ויגש"));
		const legend = page.getByRole("group", {
			name: "חלוקות העליות בטקסט",
		});
		await expect(legend).toBeVisible();
		// One entry per rendered layer, each in its own marker style.
		for (const entry of ["שבת", 'חב"ד', "חול"]) {
			await expect(
				legend.getByRole("button", { name: entry, exact: true }),
			).toBeVisible();
		}

		const torahText = page.locator('[data-unit-text="torah"]');
		const emphasized = () =>
			torahText.locator("[data-aliyah-marker][data-aliyah-selected]");

		// The default Shabbat layer is emphasized out of the box — merged
		// pills count when the layer rides among their constituents.
		expect(await emphasized().count()).toBeGreaterThan(0);
		for (const key of await emphasized().evaluateAll((els) =>
			els.map((el) => el.getAttribute("data-aliyah-key")),
		)) {
			expect(key?.split(" ")).toContain("Vayigash:shabbat");
		}

		// Selecting the custom emphasizes it and mirrors ?variant= — the
		// base markers remain visible beside it.
		const chabadEntry = legend.getByRole("button", {
			name: 'חב"ד',
			exact: true,
		});
		await chabadEntry.click();
		await expect(chabadEntry).toHaveAttribute("aria-pressed", "true");
		// Emphasis moves wholly to the variant layer: every lit marker —
		// merged pill or standalone — carries the variant key, and no
		// variant-free marker stays selected.
		expect(await emphasized().count()).toBeGreaterThan(0);
		for (const key of await emphasized().evaluateAll((els) =>
			els.map((el) => el.getAttribute("data-aliyah-key")),
		)) {
			expect(key?.split(" ")).toContain('Vayigash:shabbat:חב"ד');
		}
		await expect(page).toHaveURL(/variant=/, { timeout: 60_000 });
		await testInfo.attach("aliyah-variant-emphasized", {
			body: await legend.screenshot(),
			contentType: "image/png",
		});

		// The old selector's URL contract still applies as an emphasis
		// input — ?scheme= emphasizes the weekday layer on load.
		await page.goto(`${unitPath("ויגש")}?scheme=weekday`);
		await expect(
			page
				.locator(
					'[data-unit-text="torah"] [data-aliyah-key~="Vayigash:weekday"][data-aliyah-selected]',
				)
				.first(),
		).toBeAttached();
	});

	test("marker detail reveals on hover and keyboard focus", async ({
		page,
	}) => {
		await page.goto(unitPath("ויגש"));
		const marker = page
			.locator('[data-unit-text="torah"] [data-aliyah-key~="Vayigash:shabbat"]')
			.first();
		// The full division detail is the marker's accessible name.
		await expect(marker).toHaveAttribute(
			"aria-label",
			/פרשת ויגש · קריאת שבת · עלייה ראשונה/,
		);
		const detail = marker.locator('[class*="aliyahMarkerDetail"]');
		await expect(detail).toBeHidden();
		await marker.focus();
		await expect(detail).toBeVisible();
		await expect(detail).toHaveText(/עלייה ראשונה \(בראשית מד יח-ל\)/);
		// Hover reveals the same bubble.
		await marker.evaluate((el) => el.blur());
		await marker.hover();
		await expect(detail).toBeVisible();
	});

	test("joined-reading markers keep their own numbering inline", async ({
		page,
	}) => {
		// מסעי (unit 43): the joined מטות-מסעי layer marks its later
		// aliyot inside the unit under the joined reading's own tag and
		// numbering — beside מסעי's standalone markers and the join's
		// documented אשכנז re-slicing at its own coordinate (#3165).
		await page.goto(unitPath("מסעי"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת מסעי/ }),
		).toBeVisible();
		const torahText = page.locator('[data-unit-text="torah"]');
		const joined = torahText.locator(
			'[data-aliyah-key~="Matot-Masei:shabbat"]',
		);
		expect(await joined.count()).toBeGreaterThan(0);
		await expect(joined.first()).toHaveAttribute(
			"data-aliyah-category",
			"joined",
		);
		// Joined ordinals continue the combined reading — the unit's
		// joined markers start mid-sequence (חמישי), never remapped to
		// standalone numbering.
		const ordinals = await joined
			.locator('[class*="aliyahMarkerOrdinal"]')
			.allTextContents();
		expect(ordinals).not.toContain("ראשון");
		expect(ordinals).toContain("מפטיר");
		// The join's אשכנז re-slicing marks its חמישי at במדבר לג יא —
		// the base joined חמישי stays at לג נ, both visible inline.
		await expect(
			torahText.locator(
				'#pasuk-150-11 [data-aliyah-marker][data-aliyah-category="variant"]',
			),
		).toHaveText(/אשכנז חמישי/);
		await expect(
			torahText.locator(
				'#pasuk-150-50 [data-aliyah-key~="Matot-Masei:shabbat"]',
			),
		).toHaveText(/מטות-מסעי חמישי/);
	});

	test("book spreads show every division layer, not only Shabbat", async ({
		page,
	}) => {
		// Issue #3165: the Sefer must not silently keep a Shabbat-only
		// layer — ויגש's spread carries its weekday and חב"ד markers in
		// the book DOM too.
		await page.goto(`${unitPath("ויגש")}?book`);
		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });
		// The flipbook mounts spreads lazily after the overlay opens — wait
		// for the unit's book text before asserting its marker layers.
		const bookTorah = page.locator('[data-sefer-unit-text="11:torah"]');
		await expect(bookTorah.first()).toBeAttached({ timeout: 30_000 });
		await expect(
			bookTorah.locator('[data-aliyah-key~="Vayigash:weekday"]').first(),
		).toBeAttached();
		await expect(
			bookTorah.locator("[data-aliyah-key~='Vayigash:shabbat:חב\"ד']").first(),
		).toBeAttached();
	});

	test("inline markers wrap naturally on narrow viewports", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 360, height: 720 });
		await page.goto(unitPath("ויגש"));
		const torahText = page.locator('[data-unit-text="torah"]');
		const cluster = torahText.locator("#pasuk-44-18 [data-aliyah-marker]");
		// The three coincident layers merge into one pill that still
		// stays inside the text column — inline flow wraps it rather
		// than overflowing.
		await expect(cluster).toHaveCount(1);
		const textBox = await torahText.boundingBox();
		for (const box of await cluster.evaluateAll((els) =>
			els.map((el) => {
				const rect = el.getBoundingClientRect();
				return { left: rect.left, right: rect.right };
			}),
		)) {
			expect(box.left).toBeGreaterThanOrEqual((textBox?.x ?? 0) - 1);
			expect(box.right).toBeLessThanOrEqual(
				(textBox?.x ?? 0) + (textBox?.width ?? 0) + 1,
			);
		}
	});

	test("joined parashot keep separate unit identities", async ({ page }) => {
		// ויקהל (22) and פקודי (23) are joined in some years but stay
		// distinct addressable units — the joined name never resolves.
		await page.goto(unitPath("ויקהל"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת ויקהל/ }),
		).toBeVisible();
		await page.goto(unitPath("פקודי"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת פקודי/ }),
		).toBeVisible();
		const joined = await page.goto(unitPath("ויקהל-פקודי"));
		expect(joined?.status()).toBe(404);
	});

	test("seo policy: base parasha units stay indexable and self-canonical", async ({
		page,
	}) => {
		await page.goto(unitPath("בראשית"));
		await expect(
			page.locator('meta[name="robots"][content*="noindex"]'),
		).toHaveCount(0);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			/%D7%A4%D7%A8%D7%A9%D7%94\/(?:%D7%91%D7%A8%D7%90%D7%A9%D7%99%D7%AA)|פרשה\/בראשית/,
		);
	});

	test("seo policy: duplicate views stay usable without contaminating base responses", async ({
		request,
	}) => {
		for (const suffix of [
			"",
			"?perush=Rashi",
			"",
			"?book&article=123",
			"",
			"?haftaraPerush=Rashi",
			"?haftaraArticle=123",
			"?book",
			"?variant=x",
			"?utm_source=test",
			"",
		]) {
			const response = await request.get(`${unitPath("בראשית")}${suffix}`);
			expect(response.status()).toBe(200);
			expect(response.headers()["x-robots-tag"]).toBe(
				suffix && !suffix.startsWith("?utm_") ? "noindex, follow" : undefined,
			);
			const html = await response.text();
			expect(html).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
			expect(html).toMatch(
				/<link rel="canonical" href="[^"]*\/(?:%D7%91%D7%A8%D7%90%D7%A9%D7%99%D7%AA|בראשית)"/,
			);
		}
		for (const path of [
			`${PARASHA_ROOT}/${encodeURIComponent("בראשית")}/${encodeURIComponent("כריכה")}`,
		]) {
			const response = await request.get(path);
			expect(response.status(), path).toBe(200);
			expect(response.headers()["x-robots-tag"], path).toBe("noindex, follow");
		}
		// A legacy numeric deep link redirects first, preserving the
		// selection — the canonical page then noindexes the variant.
		const legacy = await request.get("/פרשה/1?perush=Rashi", {
			maxRedirects: 0,
		});
		expect(legacy.status()).toBe(308);
		const location = decodeURIComponent(legacy.headers().location ?? "");
		expect(location).toContain("/פרשה/בראשית");
		expect(location).toContain("perush=Rashi");
	});

	test("book view opens on ?book and shows the sefer book", async ({
		page,
	}) => {
		await page.goto(`${unitPath("בראשית")}?book`);
		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });
	});

	test("book-chrome cover route still lands on the sefer's first parasha", async ({
		page,
	}) => {
		// Book-chrome public URLs carry ?book (the flipbook history mapper
		// emits them that way) — /פרשה/{sefer}/{cover-slug}?book.
		await page.goto(
			`${PARASHA_ROOT}/${encodeURIComponent("בראשית")}/${encodeURIComponent("כריכה")}?book`,
		);
		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });
	});

	test("unknown unit ids and unknown names return 404", async ({ page }) => {
		for (const path of [
			`${PARASHA_ROOT}/55`,
			unitPath("דמיון"),
			`${PARASHA_ROOT}/${encodeURIComponent("פרשת דמיון")}`,
		]) {
			const response = await page.goto(path);
			expect(response?.status(), path).toBe(404);
		}
	});
});
