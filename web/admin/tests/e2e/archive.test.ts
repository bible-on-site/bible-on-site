import { expect, test } from "../util/test-fixture";

test("archive login is excluded from crawlers and requires login", async ({
	page,
}, testInfo) => {
	await page.route("**/archive/api", (route) =>
		route.fulfill({ status: 401, json: { error: "login" } }),
	);
	const response = await page.goto("/archive");
	expect(response?.headers()["x-robots-tag"]).toContain("noindex");
	expect(response?.headers()["cache-control"]).toContain("no-store");
	await expect(
		page.getByRole("heading", { name: "כניסה לארכיון" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "כניסה לחשבון" }),
	).toHaveAttribute("href", "/archive/auth/login");
	// Local launcher uses the existing administrator dev session.
	await page.screenshot({
		path: testInfo.outputPath("archive-login.png"),
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
		{ name: "archive_session", value: "ui-test-placeholder", url: baseURL },
	]);
	const files: {
		id: string;
		filename: string;
		size: number;
		partSize: number;
		status: string;
		createdAt: string;
	}[] = [];
	let initialListing = true;
	let loggedOut = false;
	await page.route("**/archive/api**", async (route) => {
		const request = route.request();
		if (request.method() === "GET") {
			if (loggedOut)
				return route.fulfill({ status: 401, json: { error: "login" } });
			if (initialListing) {
				expect(request.headers()["x-archive-path"] || "").toBe("");
				initialListing = false;
			}
			return route.fulfill({
				json: {
					id: "author-home",
					homeId: "author-home",
					path: "/authors/מחבר לדוגמה/",
					isAdmin: false,
					quotaName: "מחבר לדוגמה",
					breadcrumbs: [{ id: "author-home", name: "מחבר לדוגמה" }],
					username: "משתמש לדוגמה",
					quota: 1_000_000_000_000,
					allocated: files.reduce((sum, file) => sum + file.size, 0),
					files,
				},
			});
		}
		if (request.method() === "PUT")
			return route.fulfill({ json: { ok: true } });
		const data = request.postDataJSON();
		if (data.action === "logout") {
			loggedOut = true;
			return route.fulfill({ json: { url: "/archive" } });
		}
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
	await page.goto("/archive/");
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
	await expect(
		page.getByRole("button", { name: "מחיקה", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "מאמרים", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "חזרה לניהול", exact: true }),
	).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("archive-author.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "יציאה מהחשבון" }).click();
	await expect(
		page.getByRole("heading", { name: "כניסה לארכיון" }),
	).toBeVisible();
});

test("administrators browse root and named author homes", async ({
	page,
}, testInfo) => {
	const routeWarnings: string[] = [];
	page.on("console", (message) => {
		if (message.text().includes("Generated path"))
			routeWarnings.push(message.text());
	});
	const root = "00000000-0000-0000-0000-000000000001",
		authors = "00000000-0000-0000-0000-000000000002",
		home = "11111111-1111-1111-1111-111111111111";
	const names: Record<string, string> = {
		[root]: "/",
		[authors]: "authors",
		[home]: "מחבר לדוגמה",
	};
	const folder = (id: string) => ({
		id,
		filename: names[id],
		kind: "folder",
		size: 0,
		partSize: 0,
		status: "ready",
		createdAt: "2026-11-10",
		updatedAt: "2026-11-10 00:00:00.000000",
	});
	await page.route("**/archive/api", (route) => {
		const headers = route.request().headers();
		const path = decodeURIComponent(headers["x-archive-path"] || "");
		const id =
			headers["x-archive-directory"] ||
			(path.startsWith("/authors/מחבר לדוגמה")
				? home
				: path.startsWith("/authors")
					? authors
					: root);
		const crumbs =
			id === root
				? [root]
				: id === authors
					? [root, authors]
					: [root, authors, home];
		return route.fulfill({
			json: {
				id,
				homeId: root,
				path:
					id === root
						? "/"
						: id === authors
							? "/authors/"
							: "/authors/מחבר לדוגמה/",
				username: "מנהל",
				isAdmin: true,
				quotaName: id === home ? "מחבר לדוגמה" : "מנהל",
				quota: 1_000_000_000_000,
				allocated: 0,
				breadcrumbs: crumbs.map((id) => ({ id, name: names[id] })),
				files:
					id === root
						? [folder(authors)]
						: id === authors
							? [folder(home)]
							: [
									{
										id: "22222222-2222-2222-2222-222222222222",
										filename: "חומרי לימוד.pdf",
										kind: "file",
										size: 1024,
										status: "ready",
									},
								],
				nextCursor: null,
			},
		});
	});
	await page.goto("/archive");
	await expect(page.getByRole("link", { name: "חזרה לניהול" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "פתיחת תיקייה authors" }),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("archive-admin-root.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "פתיחת תיקייה authors" }).click();
	await page.getByRole("button", { name: "פתיחת תיקייה מחבר לדוגמה" }).click();
	await expect(
		page.getByText("חומרי לימוד.pdf", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "מחיקה", exact: true }),
	).toBeVisible();
	await expect(page.getByText("מכסה עבור מחבר לדוגמה")).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("archive-admin-author.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: testInfo.outputPath("archive-mobile.png"),
		fullPage: true,
	});
	expect(routeWarnings).toEqual([]);
});

test("dropped files and folders upload into the current directory", async ({
	page,
	context,
	baseURL,
}, testInfo) => {
	await context.addCookies([
		{ name: "archive_session", value: "ui-test-placeholder", url: baseURL },
	]);
	const starts: { filename: string; directory: string }[] = [];
	const mkdirs: { name: string; directory: string }[] = [];
	const created: Record<string, string> = {};
	await page.route("**/archive/api**", async (route) => {
		const request = route.request();
		if (request.method() === "GET")
			return route.fulfill({
				json: {
					id: "author-home",
					homeId: "author-home",
					path: "/authors/מחבר לדוגמה/",
					isAdmin: false,
					quotaName: "מחבר לדוגמה",
					breadcrumbs: [{ id: "author-home", name: "מחבר לדוגמה" }],
					username: "משתמש לדוגמה",
					quota: 1_000_000_000_000,
					allocated: 0,
					files: [],
				},
			});
		if (request.method() === "PUT") return route.fulfill({ json: { ok: true } });
		const data = request.postDataJSON();
		if (data.action === "mkdir") {
			mkdirs.push({ name: data.name, directory: data.directory });
			created[data.name] = `folder-${mkdirs.length}`;
			return route.fulfill({ json: { id: created[data.name] } });
		}
		if (data.action === "start") {
			starts.push({ filename: data.filename, directory: data.directory });
			return route.fulfill({
				json: { id: `upload-${starts.length}`, partSize: 8_388_608 },
			});
		}
		return route.fulfill({ json: { ok: true } });
	});
	await page.goto("/archive/");
	await expect(
		page.getByText("התיקייה עדיין ריקה.", { exact: false }),
	).toBeVisible();
	const zone = page.getByRole("region", { name: "הוספת קבצים לתיקייה" });

	// A real DataTransfer carries real file entries through the drop pipeline.
	const transfer = await page.evaluateHandle(() => {
		const data = new DataTransfer();
		data.items.add(new File(["dropped one"], "גרירה-1.txt"));
		data.items.add(new File(["dropped two"], "גרירה-2.txt"));
		return data;
	});
	await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
	await expect(page.getByText("שחררו כדי להעלות לתיקייה הנוכחית")).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("archive-dragover.png"),
	});
	await zone.dispatchEvent("drop", { dataTransfer: transfer });
	await expect
		.poll(() => starts.length)
		.toBe(2);
	expect(starts).toEqual([
		{ filename: "גרירה-1.txt", directory: "author-home" },
		{ filename: "גרירה-2.txt", directory: "author-home" },
	]);
	await page.screenshot({
		path: testInfo.outputPath("archive-drop-uploaded.png"),
	});

	// Dropped folders keep their structure through real archive folders.
	await page.evaluate(() => {
		const fileEntry = (name: string) => ({
			isFile: true,
			isDirectory: false,
			name,
			file: (resolve: (file: File) => void) =>
				resolve(new File(["nested"], name)),
		});
		const children = [fileEntry("בתוך.txt")];
		let read = false;
		const folder = {
			isFile: false,
			isDirectory: true,
			name: "תיקיית-גרירה",
			createReader: () => ({
				readEntries: (resolve: (entries: unknown[]) => void) => {
					resolve(read ? [] : children);
					read = true;
				},
			}),
		};
		const event = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "dataTransfer", {
			value: {
				items: [
					{ kind: "file", webkitGetAsEntry: () => folder },
				],
				files: [],
				types: ["Files"],
			},
		});
		document
			.querySelector('section[aria-label="הוספת קבצים לתיקייה"]')
			?.dispatchEvent(event);
	});
	await expect
		.poll(() => mkdirs.length)
		.toBe(1);
	expect(mkdirs[0]).toEqual({
		name: "תיקיית-גרירה",
		directory: "author-home",
	});
	await expect
		.poll(() => starts.length)
		.toBe(3);
	expect(starts[2]).toEqual({
		filename: "בתוך.txt",
		directory: "folder-1",
	});
});

test("a second drop while an upload runs is refused with a message", async ({
	page,
	context,
	baseURL,
}) => {
	await context.addCookies([
		{ name: "archive_session", value: "ui-test-placeholder", url: baseURL },
	]);
	let startCalls = 0;
	let holdUpload = true;
	let releaseUpload: () => void = () => {};
	await page.route("**/archive/api**", async (route) => {
		const request = route.request();
		if (request.method() === "GET")
			return route.fulfill({
				json: {
					id: "author-home",
					homeId: "author-home",
					path: "/authors/מחבר לדוגמה/",
					isAdmin: false,
					quotaName: "מחבר לדוגמה",
					breadcrumbs: [{ id: "author-home", name: "מחבר לדוגמה" }],
					username: "משתמש לדוגמה",
					quota: 1_000_000_000_000,
					allocated: 0,
					files: [],
				},
			});
		if (request.method() === "PUT") {
			if (holdUpload) {
				holdUpload = false;
				await new Promise<void>((resolve) => {
					releaseUpload = resolve;
				});
			}
			return route.fulfill({ json: { ok: true } });
		}
		const data = request.postDataJSON();
		if (data.action === "start") {
			startCalls++;
			return route.fulfill({ json: { id: "upload-1", partSize: 2 } });
		}
		return route.fulfill({ json: { ok: true } });
	});
	await page.goto("/archive/");
	await expect(
		page.getByText("התיקייה עדיין ריקה.", { exact: false }),
	).toBeVisible();
	await page.getByLabel("בחירת קבצים להעלאה").setInputFiles({
		name: "מתמשך.bin",
		mimeType: "application/octet-stream",
		buffer: Buffer.from("long enough to need a part"),
	});
	await expect(page.getByRole("button", { name: "ביטול ההעלאה" })).toBeVisible();
	const transfer = await page.evaluateHandle(() => {
		const data = new DataTransfer();
		data.items.add(new File(["late"], "מאוחר.txt"));
		return data;
	});
	const zone = page.getByRole("region", { name: "הוספת קבצים לתיקייה" });
	await zone.dispatchEvent("drop", { dataTransfer: transfer });
	await expect(page.getByRole("alert")).toContainText(
		"יש להמתין לסיום הפעולה הנוכחית",
	);
	expect(startCalls).toBe(1);
	releaseUpload();
	await expect(page.getByRole("button", { name: "ביטול ההעלאה" })).toHaveCount(
		0,
	);
});
