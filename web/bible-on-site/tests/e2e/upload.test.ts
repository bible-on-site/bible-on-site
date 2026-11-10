import { expect, test } from "../util/playwright/test-fixture";

test("private upload landing is excluded from crawlers and requires login", async ({
	page,
}, testInfo) => {
	const response = await page.goto("/upload");
	expect(response?.headers()["x-robots-tag"]).toContain("noindex");
	expect(response?.headers()["cache-control"]).toContain("no-store");
	await expect(
		page.getByRole("heading", { name: "כניסה לאזור ההעלאה" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "כניסה לחשבון" }),
	).toHaveAttribute("href", "/upload/auth/login");
	expect((await page.request.get("/upload/api")).status()).toBe(401);
	await page.screenshot({
		path: testInfo.outputPath("upload-login.png"),
		fullPage: true,
	});
});

test("upload directory accepts arbitrary files and shows completed files", async ({
	page,
	context,
	baseURL,
}, testInfo) => {
	// Only the browser transport is stubbed. Production has no authentication bypass.
	await context.addCookies([
		{ name: "upload_session", value: "ui-test-placeholder", url: baseURL },
	]);
	const files: {
		id: string;
		filename: string;
		size: number;
		partSize: number;
		status: string;
		createdAt: string;
	}[] = [];
	await page.route("**/upload/api**", async (route) => {
		const request = route.request();
		if (request.method() === "GET")
			return route.fulfill({
				json: {
					username: "משתמש לדוגמה",
					quota: 1_000_000_000_000,
					allocated: files.reduce((sum, file) => sum + file.size, 0),
					files,
				},
			});
		if (request.method() === "PUT")
			return route.fulfill({ json: { ok: true } });
		const data = request.postDataJSON();
		if (data.action === "start") {
			files.push({
				id: "11111111-1111-1111-1111-111111111111",
				filename: data.filename,
				size: data.size,
				partSize: 8_388_608,
				status: "uploading",
				createdAt: "2026-11-10",
			});
			return route.fulfill({ json: { id: files[0].id, partSize: 8_388_608 } });
		}
		if (data.action === "complete") files[0].status = "ready";
		if (data.action === "remove") files.splice(0);
		return route.fulfill({ json: { ok: true } });
	});
	await page.goto("/upload");
	await expect(
		page.getByText("התיקייה עדיין ריקה.", { exact: false }),
	).toBeVisible();
	await page.getByLabel("בחירת קבצים להעלאה").setInputFiles({
		name: "תוכן.custom",
		mimeType: "application/octet-stream",
		buffer: Buffer.from("arbitrary binary content"),
	});
	await expect(page.getByText("תוכן.custom", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("link", { name: "הורדה", exact: true }),
	).toBeVisible();
	await expect(page.getByText(/1,000 GB/)).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("upload-directory.png"),
		fullPage: true,
	});
});
