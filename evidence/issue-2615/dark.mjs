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
const ctx = await browser.newContext({
	viewport: { width: 1280, height: 900 },
	colorScheme: "dark",
});
const page = await ctx.newPage();
await page.goto(
	`http://127.0.0.1:3002/pedia/${encodeURIComponent("משה-רבנו")}`,
	{ waitUntil: "domcontentloaded", timeout: 120000 },
);
const notes = page.locator("article ol.footnotes");
await notes.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(dir, "shots", "after-notes-dark.png") });
const ref = page.locator('article sup[id="fnref:1"]');
await ref.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(dir, "shots", "after-inline-dark.png") });
await browser.close();
console.log("dark shots saved");
