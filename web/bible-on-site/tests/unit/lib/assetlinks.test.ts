import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the Digital Asset Links file served at /.well-known/assetlinks.json.
 * Android App Links break silently if this file is removed, malformed, or
 * points at the wrong package/fingerprint.
 */
describe("public/.well-known/assetlinks.json", () => {
	const path = resolve(process.cwd(), "public/.well-known/assetlinks.json");

	it("exists and contains valid JSON", () => {
		expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
	});

	it("declares handle_all_urls for the app package", () => {
		const links = JSON.parse(readFileSync(path, "utf8"));
		expect(Array.isArray(links)).toBe(true);
		expect(links.length).toBeGreaterThan(0);
		for (const entry of links) {
			expect(entry.relation).toContain(
				"delegate_permission/common.handle_all_urls",
			);
			expect(entry.target.namespace).toBe("android_app");
			expect(entry.target.package_name).toBe("com.tanah.daily929");
		}
	});

	it("has at least one SHA-256 cert fingerprint", () => {
		const links = JSON.parse(readFileSync(path, "utf8"));
		const fingerprints = links.flatMap(
			(entry: { target: { sha256_cert_fingerprints?: string[] } }) =>
				entry.target.sha256_cert_fingerprints ?? [],
		);
		expect(fingerprints.length).toBeGreaterThan(0);
		for (const fp of fingerprints) {
			expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
		}
	});
});
