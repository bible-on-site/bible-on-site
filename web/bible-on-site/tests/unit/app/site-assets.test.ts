import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/jsonld";

/**
 * Guards the static assets crawlers and Lighthouse probe on every origin —
 * /manifest.json and /apple-touch-icon.png. When they 404 the app router logs
 * NoFallbackError noise into stderr during perf runs (#1022).
 */
describe("public/manifest.json", () => {
	const path = resolve(process.cwd(), "public/manifest.json");
	const manifest = () => JSON.parse(readFileSync(path, "utf8"));

	it("exists and contains valid JSON", () => {
		expect(() => manifest()).not.toThrow();
	});

	it("declares the site identity in the user's language and direction", () => {
		const m = manifest();
		expect(m.name).toBe(SITE_NAME);
		expect(m.short_name).toBe(SITE_NAME);
		expect(m.description).toBe(SITE_DESCRIPTION);
		expect(m.lang).toBe("he");
		expect(m.dir).toBe("rtl");
		expect(m.start_url).toBe("/");
		expect(m.scope).toBe("/");
	});

	it("lists square icons that resolve to files under public/", () => {
		const icons: { src: string; sizes: string; type: string }[] =
			manifest().icons;
		expect(icons.length).toBeGreaterThan(0);
		for (const icon of icons) {
			const [width, height] = icon.sizes.split("x").map(Number);
			expect(width).toBeGreaterThan(0);
			expect(width).toBe(height);
			expect(icon.src.startsWith("/")).toBe(true);
			expect(
				existsSync(resolve(process.cwd(), "public", icon.src.slice(1))),
			).toBe(true);
		}
	});
});

describe("public/apple-touch-icon.png", () => {
	it("is a real 180x180 PNG (the default apple-touch-icon size)", () => {
		const buf = readFileSync(
			resolve(process.cwd(), "public/apple-touch-icon.png"),
		);
		expect(buf.subarray(0, 8)).toEqual(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		);
		expect(buf.readUInt32BE(16)).toBe(180);
		expect(buf.readUInt32BE(20)).toBe(180);
	});
});
