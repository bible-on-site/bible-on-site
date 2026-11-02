/**
 * Captures dedication displays for PR evidence (#2731).
 *
 * Usage:
 *   node evidence/issue-2731/capture-evidence.mjs <before|after>
 *
 * Requires the dev server at http://localhost:3001 (override with
 * EVIDENCE_BASE_URL) with the seeded dedication rows (after) or truncated
 * dedication link tables (before). Playwright resolves through the website
 * package — no install needed in this directory.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.EVIDENCE_BASE_URL ?? "http://localhost:3001";
const MODE = process.argv[2] ?? "after";

const websiteRequire = createRequire(
	new URL("../../web/bible-on-site/package.json", import.meta.url),
);
const { chromium } = websiteRequire("@playwright/test");

const SEEDS = [
	// [name, path, viewport]
	["perek-929-1-desktop", "/929/1", { width: 1440, height: 900 }],
	["perek-929-1-mobile", "/929/1", { width: 390, height: 844 }],
	["pedia-entry-desktop", "/pedia/משה-רבנו", { width: 1440, height: 900 }],
	["bookshelf-desktop", "/bookshelf", { width: 1440, height: 900 }],
	["parasha-desktop", "/parasha/1", { width: 1440, height: 900 }],
	["masora-desktop", "/masora/1", { width: 1440, height: 900 }],
];

const browser = await chromium.launch();

for (const [name, path, viewport] of SEEDS) {
	for (const scheme of ["light", "dark"]) {
		const context = await browser.newContext({
			viewport,
			colorScheme: scheme,
			locale: "he-IL",
		});
		const page = await context.newPage();
		try {
			const resp = await page.goto(`${BASE}${path}`, {
				waitUntil: "networkidle",
				timeout: 90_000,
			});
			await page.waitForTimeout(1500);
			const file = join(OUT, `${name}-${scheme}-${MODE}.png`);
			await page.screenshot({ path: file, fullPage: false });
			console.log(`${name}-${scheme}: ${resp?.status()} -> ${file}`);
		} catch (err) {
			console.log(`${name}-${scheme}: FAILED — ${err.message.split("\n")[0]}`);
		}
		await context.close();
	}
}

await browser.close();
