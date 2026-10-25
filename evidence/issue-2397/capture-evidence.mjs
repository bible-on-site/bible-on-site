/**
 * Acceptance-evidence capture for #2397 (homepage counters section).
 *
 * Shoots the deployed site (or any EVIDENCE_BASE_URL) and produces:
 *  - after-{desktop,mobile}-sequence.png: the full ספרי התנ"ך -> מספרים על
 *    הפרק -> יישומון -> תנאי שימוש section chain in ONE capture, so every
 *    section boundary (including counters -> app) is visible together.
 *  - after-{desktop,mobile}-boundary.png: tight crop on the counters ->
 *    app wave boundary.
 *  - after-{desktop,mobile}-counters.png: the six counters themselves.
 *
 * Playwright resolves through the website package — no install needed in
 * this directory:
 *   node evidence/issue-2397/capture-evidence.mjs
 * Output lands next to this script.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.EVIDENCE_BASE_URL ?? "https://xn--febl3a.co.il";

// Bare imports resolve from this file's ancestors, which never reach the
// website's node_modules — root the resolution at its package.json.
const websiteRequire = createRequire(
	new URL("../../web/bible-on-site/package.json", import.meta.url),
);
const { chromium } = websiteRequire("@playwright/test");

// Section chain the issue requires in one capture.
const CHAIN = ["#tanah-sefarim", "#numbers", "#app", "#tos"];
// The shared count-up duration is 1.8s; give it headroom.
const ANIMATION_SETTLE_MS = 2600;

async function captureViewport(browser, name, contextOptions) {
	const context = await browser.newContext({
		locale: "he-IL",
		...contextOptions,
	});
	const page = await context.newPage();
	await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });

	// Trigger the scroll-linked count-up, then let the shared 1.8s
	// animation settle so the captures show final values.
	await page.locator("#numbers").scrollIntoViewIfNeeded();
	await page.waitForTimeout(ANIMATION_SETTLE_MS);

	// Document coordinates: boundingBox() is viewport-relative, while a
	// fullPage clip is document-relative — mixing them displaces every
	// crop by the scroll offset. getBoundingClientRect + scroll offset is
	// document space no matter where the page is scrolled.
	const rectOf = (selector) =>
		page.locator(selector).evaluate((el) => {
			const r = el.getBoundingClientRect();
			return {
				x: r.left + window.scrollX,
				y: r.top + window.scrollY,
				width: r.width,
				height: r.height,
			};
		});

	// 1. Full sequence: top of the bookshelf section through the bottom of
	//    the terms section — every boundary in a single frame.
	const first = await rectOf(CHAIN[0]);
	const last = await rectOf(CHAIN[CHAIN.length - 1]);
	const sequence = {
		x: 0,
		y: Math.max(0, first.y),
		width: page.viewportSize().width,
		height: last.y + last.height - Math.max(0, first.y),
	};
	await page.screenshot({
		path: join(OUT, `after-${name}-sequence.png`),
		clip: sequence,
		fullPage: true,
	});

	// 2. Counters -> app boundary: from mid-counters to mid-app so the wave
	//    divider and the muted/white background switch are unmistakable.
	const numbers = await rectOf("#numbers");
	const app = await rectOf("#app");
	const boundary = {
		x: 0,
		y: numbers.y + numbers.height * 0.45,
		width: page.viewportSize().width,
		height: app.y + app.height * 0.5 - (numbers.y + numbers.height * 0.45),
	};
	await page.screenshot({
		path: join(OUT, `after-${name}-boundary.png`),
		clip: boundary,
		fullPage: true,
	});

	// 3. The six counters alone (links included). An element screenshot
	//    scrolls and frames itself — no coordinate math to get wrong.
	await page.locator("#numbers").screenshot({
		path: join(OUT, `after-${name}-counters.png`),
	});

	await context.close();
	console.log(`captured ${name}`);
}

const browser = await chromium.launch();
try {
	await captureViewport(browser, "desktop", {
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	await captureViewport(browser, "mobile", {
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true,
		userAgent:
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
	});
} finally {
	await browser.close();
}
