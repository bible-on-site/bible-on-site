import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Page, TestInfo } from "@playwright/test";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { expect, test } from "../util/test-fixture";

async function capture(page: Page, info: TestInfo, name: string) {
	const path = info.outputPath(`${name}.png`);
	await page.screenshot({ path, fullPage: true });
	await info.attach(name, { path, contentType: "image/png" });
}

test.describe("Issues and typed pull requests", () => {
	test("a workstation worker turns a queued issue into a model-authored PR requiring review", async ({
		page,
	}, testInfo) => {
		const title = `הפקה מקומית ${randomUUID()}`;
		await page.goto("/issues?id=new");
		await page.getByLabel("כותרת", { exact: true }).fill(title);
		await page
			.getByLabel("תיאור", { exact: true })
			.fill("נדרש ערך חדש לאברם עם מטא-נתונים בלבד, בהתבסס על המקור המצורף.");
		await page
			.getByRole("combobox", { name: "אחראי", exact: true })
			.selectOption("local_llm");
		await page
			.getByRole("button", { name: "+ הוספת מקור", exact: true })
			.click();
		await page.getByLabel("הפניה למקור", { exact: true }).fill("בראשית יא כו");
		await page
			.getByLabel("ציטוט רלוונטי", { exact: true })
			.fill("ויולד את אברם");
		await page
			.getByRole("button", { name: "פתיחת פנייה", exact: true })
			.click();
		await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
		const issueId = new URL(page.url()).searchParams.get("id");
		if (!issueId) throw new Error("Created issue ID missing");
		await page
			.getByRole("button", { name: "שליחה לעובד מקומי", exact: true })
			.click();
		await expect(
			page.getByText("ממתין לעובד בתחנת העבודה", { exact: true }),
		).toBeVisible();
		let inferenceCalls = 0;
		const ollama = createServer(async (request, response) => {
			const parts: Buffer[] = [];
			for await (const chunk of request) parts.push(Buffer.from(chunk));
			const input = JSON.parse(Buffer.concat(parts).toString("utf8"));
			if (
				request.url !== "/api/chat" ||
				request.headers.authorization ||
				!input.format
			) {
				response.writeHead(400);
				response.end();
				return;
			}
			inferenceCalls++;
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					model: "doradsoft",
					message: {
						content: JSON.stringify({
							pullRequests: [
								{
									title: "ערך לאברם לפי המקור",
									description: "מטא-נתונים עם מקור; ללא טקסט לערך.",
									evidenceIndexes: [0],
									changes: [
										{
											kind: "entry",
											after: {
												title: "אברם",
												uniqueName: `worker-${randomUUID()}`,
												entityType: "PERSON",
												displayName: "אברם",
											},
										},
									],
								},
							],
						}),
					},
				}),
			);
		});
		await new Promise<void>((resolve) =>
			ollama.listen(0, "127.0.0.1", resolve),
		);
		try {
			const address = ollama.address();
			if (!address || typeof address === "string")
				throw new Error("Local inference endpoint missing");
			const script = fileURLToPath(
				new URL("../../../../devops/contribution-worker.mjs", import.meta.url),
			);
			const { stdout } = await promisify(execFile)(
				process.execPath,
				[
					script,
					"--once",
					"--dev",
					"--origin",
					"http://localhost:3101",
					"--ollama",
					`http://127.0.0.1:${address.port}`,
					"--model",
					"test-local",
					"--issue",
					issueId,
				],
				{ timeout: 15000, windowsHide: true },
			);
			expect(stdout).toContain("completed");
			expect(stdout).not.toContain("ויולד את אברם");
			expect(inferenceCalls).toBe(1);
			await expect(
				page.getByText("העובד המקומי יצר הצעות לסקירה", { exact: true }),
			).toBeVisible();
			await capture(page, testInfo, "workstation-generation-completed");
			await page
				.getByRole("link", { name: "פתיחת הצעה 1 לסקירה", exact: true })
				.click();
			await expect(
				page.getByText("Local LLM", { exact: true }).first(),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "מיזוג PR", exact: true }),
			).toBeDisabled();
			await page.getByRole("tab", { name: "שינויים 1", exact: true }).click();
			await expect(page.getByRole("table")).toContainText("אברם");
			await capture(page, testInfo, "workstation-model-pr-review-gate");
			await page
				.getByRole("button", { name: "סגירה ללא מיזוג", exact: true })
				.click();
		} finally {
			await new Promise<void>((resolve, reject) =>
				ollama.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
	test("supports all four issue assignee kinds and durable discussion", async ({
		page,
	}, testInfo) => {
		const title = `בדיקת שיוך ${randomUUID()}`;
		await page.goto("/issues");
		await page.getByRole("link", { name: "+ פנייה חדשה", exact: true }).click();
		await page.getByLabel("כותרת", { exact: true }).fill(title);
		await page
			.getByLabel("תיאור", { exact: true })
			.fill("פניית בדיקה עבור שיוך ודיון, ללא שינוי בתוכן האתר.");
		await expect(page.getByLabel("אחראי", { exact: true })).toHaveValue(
			"unassigned",
		);
		await page
			.getByRole("button", { name: "+ הוספת מקור", exact: true })
			.click();
		await page.getByLabel("הפניה למקור", { exact: true }).fill("בראשית יא כו");
		await page
			.getByLabel("ציטוט רלוונטי", { exact: true })
			.fill("ויולד את אברם את נחור ואת הרן");
		await page
			.getByRole("button", { name: "פתיחת פנייה", exact: true })
			.click();
		await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
		await page.reload();
		await expect(
			page.getByText("ויולד את אברם את נחור ואת הרן", { exact: true }),
		).toBeVisible();
		for (const kind of ["human", "aws_llm", "local_llm", "unassigned"]) {
			await page.getByLabel("אחראי", { exact: true }).selectOption(kind);
			if (kind === "human")
				await page
					.getByLabel("שם משתמש אחראי", { exact: true })
					.fill("doradsoft");
			await page
				.getByRole("button", { name: "שמירת שיוך", exact: true })
				.click();
			await expect(page.locator(".contribution-event").last()).toContainText(
				"שינה שיוך",
			);
			await page.reload();
			await expect(page.getByLabel("אחראי", { exact: true })).toHaveValue(kind);
		}
		await page
			.getByLabel("הוספת תגובה", { exact: true })
			.fill("הערת בדיקה נשמרת בהיסטוריה");
		await page
			.getByRole("button", { name: "שליחת תגובה", exact: true })
			.click();
		await expect(
			page.getByText("הערת בדיקה נשמרת בהיסטוריה", { exact: true }),
		).toBeVisible();
		await capture(page, testInfo, "issue-assignment-and-discussion");
		await page
			.getByRole("button", { name: "סגירה ללא מיזוג", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "פתיחה מחדש", exact: true }),
		).toBeVisible();
	});

	test("creates an evidence-backed metadata-only entry PR with a domain diff", async ({
		page,
	}, testInfo) => {
		const title = `הצעת מטא-נתונים ${randomUUID()}`;
		await page.goto("/pull-requests");
		await page.getByRole("link", { name: "+ PR חדש", exact: true }).click();
		await page.getByLabel("כותרת", { exact: true }).fill(title);
		await page
			.getByLabel("תיאור", { exact: true })
			.fill("הצעת בדיקה מבוססת מקור. הערך לא ייווצר לפני אישור ומיזוג.");
		await page
			.getByRole("button", { name: "+ הוספת מקור", exact: true })
			.click();
		await page.getByLabel("הפניה למקור", { exact: true }).fill("בראשית יא כו");
		await page
			.getByLabel("ציטוט רלוונטי", { exact: true })
			.fill("ויולד את אברם");
		await page
			.getByRole("combobox", { name: "סוג שינוי", exact: true })
			.selectOption("entry");
		await page.getByLabel("כותרת", { exact: true }).nth(1).fill("אברם");
		await page
			.getByLabel("שם ייחודי", { exact: true })
			.fill(`בדיקה-${randomUUID()}`);
		await page.getByLabel("שם תצוגה", { exact: true }).fill("אברם");
		await page.getByRole("button", { name: "פתיחת PR", exact: true }).click();
		await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
		await expect(
			page.getByRole("button", { name: "מיזוג PR", exact: true }),
		).toBeDisabled();
		await expect(
			page.getByText("נדרש אישור מ-doradsoft", { exact: true }).first(),
		).toBeVisible();
		await page.getByRole("tab", { name: "שינויים 1", exact: true }).click();
		await expect(page.getByRole("table")).toBeVisible();
		await expect(
			page.getByText(
				"הערך ייווצר עם מטא-נתונים וגוף ריק. טקסט הערך נכתב בנפרד על ידי עורך.",
			),
		).toBeVisible();
		await expect(page.locator(".contribution-diff tbody")).toContainText(
			"אברם",
		);
		await capture(page, testInfo, "metadata-entry-domain-diff");
		// Fault injection is confined to the staging record this test created in
		// loopback tanah_test. No encyclopedia content or production DB is touched.
		const configured = new URL(process.env.DB_URL ?? "");
		if (
			!["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname) ||
			configured.pathname !== "/tanah_test"
		)
			throw new Error("Migration E2E requires loopback tanah_test");
		const id = new URL(page.url()).searchParams.get("id");
		if (!id) throw new Error("Created PR ID missing");
		const connection = await mysql.createConnection(configured.toString());
		try {
			const [rows] = await connection.execute<RowDataPacket[]>(
				"SELECT data FROM tanahpedia_contribution WHERE id=? AND title=?",
				[id, title],
			);
			if (rows.length !== 1) throw new Error("Owned staging PR missing");
			const item =
				typeof rows[0].data === "string"
					? JSON.parse(rows[0].data)
					: rows[0].data;
			const migration = {
				id: randomUUID(),
				status: "failed",
				from: 99,
				to: 1,
				at: new Date().toISOString(),
				steps: [],
				error: "Fixture: missing conversion from a retired API",
				sequence: JSON.stringify(item.changes),
			};
			item.apiVersion = 99;
			item.apiMigration = migration;
			item.apiMigrationHistory = [migration];
			await connection.execute(
				"UPDATE tanahpedia_contribution SET data=?, version=version+1 WHERE id=? AND title=?",
				[JSON.stringify(item), id, title],
			);
		} finally {
			await connection.end();
		}
		await page.reload();
		await expect(
			page.getByText("couldn't migrate to latest API", { exact: true }).first(),
		).toBeVisible();
		await page.getByRole("tab", { name: "שינויים 1", exact: true }).click();
		await expect(page.getByRole("table")).toHaveCount(0);
		await expect(
			page.locator(".contribution-raw-sequence").first(),
		).toContainText('"kind": "entry"');
		await expect(
			page.getByRole("button", { name: "מיזוג PR", exact: true }),
		).toBeDisabled();
		await capture(page, testInfo, "api-migration-failed-raw-sequence");
		await page.getByRole("button", { name: "תיקון הרצף", exact: true }).click();
		await page
			.getByRole("button", { name: "שמירת רצף מתוקן", exact: true })
			.click();
		await expect(
			page.getByText("couldn't migrate to latest API", { exact: true }),
		).toHaveCount(0);
		await page.getByRole("tab", { name: "שינויים 1", exact: true }).click();
		await expect(page.getByRole("table")).toBeVisible();
		await page
			.getByRole("button", { name: "סגירה ללא מיזוג", exact: true })
			.click();
	});

	test("keeps queue controls usable at a narrow mobile viewport", async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/issues");
		await expect(
			page.getByRole("heading", { name: "פניות", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "+ פנייה חדשה", exact: true }),
		).toBeVisible();
		const width = await page.evaluate(() => ({
			document: document.documentElement.scrollWidth,
			viewport: innerWidth,
		}));
		expect(width.document).toBeLessThanOrEqual(width.viewport);
		await capture(page, testInfo, "mobile-issues-queue");
	});
});
