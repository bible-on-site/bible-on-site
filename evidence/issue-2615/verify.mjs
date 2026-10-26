/**
 * Red/green verification for Tanahpedia footnotes (#2615).
 * Usage: node verify.mjs <baseURL> <label>
 * Runs the same assertions as tests/e2e/tanahpedia-footnotes.test.ts
 * against any running server and saves screenshots alongside.
 */
import { createRequire } from "node:module";
const require = createRequire(
	"C:/Users/hageg/Desktop/devin workspace/bos-wt/issue-2615-footnotes/web/bible-on-site/package.json",
);
const { chromium } = require("playwright-core");
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://127.0.0.1:3002";
const label = process.argv[3] ?? "run";
const dir = dirname(fileURLToPath(import.meta.url));
const MOSHE = `/pedia/${encodeURIComponent("משה-רבנו")}`;
const YEHOSHUA = `/pedia/${encodeURIComponent("יהושע-בן-נון")}`;

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
	if (cond) {
		pass++;
		console.log(`  PASS ${name}`);
	} else {
		failures.push(name);
		console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

console.log(`\n== ${label} :: ${base} ==\n`);

await page.goto(`${base}${MOSHE}`, { waitUntil: "domcontentloaded" });
const list = page.locator("article ol.footnotes");
const listVisible = await list.isVisible().catch(() => false);
check("ol.footnotes present", listVisible);

if (listVisible) {
	const items = list.locator(":scope > li");
	const count = await items.count();
	check(">50 notes", count > 50, `count=${count}`);

	const lst = await list.evaluate((el) => getComputedStyle(el).listStyleType);
	check("list-style-type none", lst === "none", lst);
	const liLst = await items
		.first()
		.evaluate((el) => getComputedStyle(el).listStyleType);
	check("li inherits list-style none", liLst === "none", liLst);

	for (const [id, letter] of [
		["fn:1", "א"],
		["fn:10", "י"],
		["fn:11", "יא"],
		["fn:15", "טו"],
		["fn:16", "טז"],
		["fn:54", "נד"],
	]) {
		const item = page.locator(`article li[id="${id}"]`);
		const n = await item.count();
		check(`li#${id} exists`, n === 1);
		if (n !== 1) continue;
		check(`#${id} data-marker`, (await item.getAttribute("data-marker")) === letter);
		const pc = await item.evaluate((el) => getComputedStyle(el, "::before").content);
		check(`#${id} ::before="${letter}"`, pc === `"${letter}"`, pc);
		const text = ((await item.textContent()) ?? "").trim();
		check(`#${id} text not starting with marker`, !text.startsWith(letter), text.slice(0, 30));
	}

	const labelPc = await list.evaluate((el) => getComputedStyle(el, "::before").content);
	check("list ::before הערות", labelPc === '"הערות"', labelPc);
	const h = await page.locator("article h1,h2,h3,h4,h5,h6", { hasText: "הערות" }).count();
	check("no הערות heading", h === 0);

	const firstText = ((await items.first().innerText()) ?? "").trim();
	check("innerText starts with שמות", firstText.startsWith("שמות"), firstText.slice(0, 30));

	/* inline reference */
	const ref = page.locator('article sup[id="fnref:1"] a.footnote-ref');
	check("sup#fnref:1 a.footnote-ref", (await ref.count()) === 1);
	if ((await ref.count()) === 1) {
		check("ref data-marker", (await ref.getAttribute("data-marker")) === "א");
		check("ref href", (await ref.getAttribute("href")) === "#fn:1");
		check("ref role", (await ref.getAttribute("role")) === "doc-noteref");
		check("ref aria-label", (await ref.getAttribute("aria-label")) === "הערה א");
		const rpc = await ref.evaluate((el) => getComputedStyle(el, "::before").content);
		check("ref ::before=א", rpc === '"א"', rpc);
		check("ref empty text", ((await ref.textContent()) ?? "") === "");
		const m = await page.locator('sup[id="fnref:1"]').evaluate((el) => {
			const cs = getComputedStyle(el);
			return { fs: Number.parseFloat(cs.fontSize), va: cs.verticalAlign };
		});
		const bodyFs = await page
			.locator("article")
			.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
		check("sup vertical-align", m.va === "super", m.va);
		check("sup smaller font", m.fs < bodyFs, `${m.fs} vs ${bodyFs}`);
	}

	/* navigation */
	const ref5 = page.getByRole("link", { name: "הערה ה", exact: true });
	if ((await ref5.count()) === 1) {
		await ref5.click();
		check("nav → #fn:5", page.url().endsWith("#fn:5"), page.url());
		const back = page.locator('article li[id="fn:5"] a.footnote-backref');
		check("backref href", (await back.getAttribute("href")) === "#fnref:5");
		check("backref role", (await back.getAttribute("role")) === "doc-backlink");
		await back.click();
		check("nav back → #fnref:5", page.url().endsWith("#fnref:5"), page.url());
	} else {
		check("nav ref הערה ה found", false);
	}

	/* keyboard */
	const ref7 = page.getByRole("link", { name: "הערה ז", exact: true });
	if ((await ref7.count()) === 1) {
		await ref7.focus();
		await page.keyboard.press("Enter");
		await page.waitForURL(/#fn:7$/, { timeout: 5000 }).catch(() => {});
		check("keyboard → #fn:7", page.url().endsWith("#fn:7"), page.url());
	} else {
		check("kbd ref הערה ז found", false);
	}
}

/* unique ids + count on the short entry */
await page.goto(`${base}${YEHOSHUA}`, { waitUntil: "domcontentloaded" });
const ids = await page.locator("article [id]").evaluateAll((els) => els.map((el) => el.id));
check("unique ids", new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} dupes`);
const shortCount = await page.locator("article ol.footnotes > li").count();
check("יהושע 10 notes", shortCount === 10, `count=${shortCount}`);

/* screenshots for PR evidence */
mkdirSync(join(dir, "shots"), { recursive: true });
await page.goto(`${base}${MOSHE}`, { waitUntil: "networkidle" }).catch(() => {});
const notes = page.locator("article ol.footnotes");
await notes.scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: join(dir, "shots", `${label}-notes.png`) });
const firstRef = page.locator('article sup[id="fnref:1"]');
await firstRef.scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: join(dir, "shots", `${label}-inline.png`) });
await page.setViewportSize({ width: 420, height: 900 });
await notes.scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: join(dir, "shots", `${label}-notes-narrow.png`) });

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
	console.log("FAILED:", failures.join(" | "));
	process.exit(1);
}
