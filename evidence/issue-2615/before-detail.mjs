import { createRequire } from "node:module";
const require = createRequire(
	"C:/Users/hageg/Desktop/devin workspace/bos-wt/issue-2615-footnotes/web/bible-on-site/package.json",
);
const { chromium } = require("playwright-core");
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(dir, "shots"), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(
	`https://xn--febl3a.co.il/pedia/${encodeURIComponent("משה-רבנו")}`,
	{ waitUntil: "domcontentloaded" },
);

/* legacy notes list */
const info = await page.evaluate(() => {
	const ols = [...document.querySelectorAll("article ol")];
	const ol = ols.find((o) => o.querySelector('li[id^="note-"]')) ?? ols.at(-1);
	if (!ol) return { found: false };
	const li = ol.querySelector("li");
	const cs = getComputedStyle(ol);
	const liCs = getComputedStyle(li, "::marker");
	return {
		found: true,
		listStyleType: cs.listStyleType,
		markerContent: liCs.content,
		firstLiId: li.id,
		firstLiText: li.textContent.trim().slice(0, 60),
		itemCount: ol.querySelectorAll(":scope > li").length,
	};
});
console.log(JSON.stringify(info, null, 2));

/* inline ref styling on production */
const refInfo = await page.evaluate(() => {
	const a = document.querySelector('article a[href="#note-1"]');
	if (!a) return { found: false };
	const sup = a.closest("sup");
	const cs = getComputedStyle(a);
	return {
		found: true,
		text: a.textContent,
		inSup: !!sup,
		supId: sup?.id ?? null,
		fontSize: cs.fontSize,
		color: cs.color,
		underline: cs.textDecorationLine,
	};
});
console.log(JSON.stringify(refInfo, null, 2));

/* screenshots: notes list (dup markers) + inline ref */
const noteLi = page.locator('article ol li[id^="note-"]').first();
const target = (await noteLi.count()) > 0 ? noteLi : page.locator("article ol").last().locator("li").first();
await target.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(dir, "shots", "before-notes.png") });
const ref = page.locator('article a[href="#note-1"]').first();
await ref.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(dir, "shots", "before-inline.png") });
await browser.close();
