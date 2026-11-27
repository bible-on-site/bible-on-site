import { expect, it } from "vitest";
import missingBuildAsset from "~/server/missing-build-asset.server";

it.each(["GET", "HEAD"])(
	"returns an uncached 404 for missing build asset %s",
	async (method) => {
		const missing = await missingBuildAsset.fetch(
			new Request("https://admin.test/assets/missing.js", { method }),
		);
		expect(missing.status).toBe(404);
		expect(missing.headers.get("Cache-Control")).toBe("no-store");
		expect(missing.headers.get("Location")).toBeNull();
	},
);
