import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Page, TestInfo } from "@playwright/test";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { CONTRIBUTION_RECORDS } from "../../src/lib/tanahpedia/contribution-records";
import {
	FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES,
	FAMILY_UNION_TYPES,
} from "../../src/server/tanahpedia/family-api-spec";
import { expect, test } from "../util/test-fixture";

async function capture(page: Page, info: TestInfo, name: string) {
	const path = info.outputPath(`${name}.png`);
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({ path, fullPage: true });
	await info.attach(name, { path, contentType: "image/png" });
}

test.describe("Issues and typed pull requests", () => {
	test("registers and configures a versioned agent on an existing runtime", async ({
		page,
	}, testInfo) => {
		const name = `סוכן בדיקה ${randomUUID()}`;
		await page.goto("/contribution-agents");
		await expect(
			page.getByRole("article", { name: "Local LLM", exact: true }),
		).toBeVisible();
		const install = page.getByRole("form", {
			name: "התקנת הגדרת סוכן",
			exact: true,
		});
		await install.getByLabel("שם הסוכן", { exact: true }).fill(name);
		await install.getByLabel("מודל", { exact: true }).fill("test-local");
		await install
			.getByRole("button", { name: "התקנת הגדרה", exact: true })
			.click();
		const agent = page.getByRole("article", { name, exact: true });
		await expect(agent).toBeVisible();
		await expect(
			agent.getByText("ההוראות והכלים מעודכנים", { exact: true }),
		).toBeVisible();
		await agent.getByLabel("סוכן פעיל", { exact: true }).uncheck();
		await agent
			.getByRole("button", { name: "שמירת הגדרות הסוכן", exact: true })
			.click();
		await expect(
			agent.getByText("הגדרת הסוכן עודכנה", { exact: true }),
		).toBeVisible();
		await page.reload();
		await expect(agent.getByLabel("מודל", { exact: true })).toHaveValue(
			"test-local",
		);
		await expect(
			agent.getByLabel("סוכן פעיל", { exact: true }),
		).not.toBeChecked();
		await capture(page, testInfo, "versioned-agent-configuration");
		await page.setViewportSize({ width: 390, height: 844 });
		await capture(page, testInfo, "versioned-agent-configuration-mobile");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
	});
	test("reviews a cross-category proposal with dates, names, sources and alias routing", async ({
		page,
	}, testInfo) => {
		const problems: string[] = [];
		page.on("pageerror", (error) => problems.push(error.message));
		page.on("requestfailed", (request) =>
			problems.push(
				`${request.method()} ${request.url()} ${request.failure()?.errorText}`,
			),
		);
		const title = `קטגוריות מובנות - ${randomUUID().slice(0, 8)}`;
		await page.goto("/pull-requests?id=new");
		await page.getByLabel("כותרת", { exact: true }).fill(title);
		await page
			.getByLabel("תיאור", { exact: true })
			.fill("נתוני בדיקה לסקירה בלבד. אין למזג תוכן זה.");
		await page
			.getByRole("button", { name: "+ הוספת מקור", exact: true })
			.click();
		await page.getByLabel("הפניה למקור", { exact: true }).fill("בראשית יא כו");
		const kind = () =>
			page.getByRole("combobox", { name: "סוג שינוי", exact: true });
		for (const key of Object.keys(CONTRIBUTION_RECORDS))
			await expect(
				kind().first().locator(`option[value="${key}"]`),
			).toHaveCount(1);
		async function first(label: string, index = 0) {
			const select = page
				.getByRole("combobox", { name: label, exact: true })
				.nth(index);
			const id = await select
				.locator('option[value]:not([value=""])')
				.first()
				.getAttribute("value");
			if (!id) throw new Error(`Missing fixture for ${label}`);
			await select.selectOption(id);
			return id;
		}
		await kind().first().selectOption("person_birth_date");
		const person = await first("איש");
		await page.getByLabel("שנה - תאריך לידה", { exact: true }).fill("1948");
		await page
			.getByLabel("חודש - תאריך לידה", { exact: true })
			.selectOption("1");
		await page.getByLabel("יום - תאריך לידה", { exact: true }).fill("2");
		const formPath = testInfo.outputPath("category-hebrew-date-form.png");
		await page
			.locator(".contribution-change-fields")
			.first()
			.screenshot({ path: formPath });
		await testInfo.attach("category-hebrew-date-form", {
			path: formPath,
			contentType: "image/png",
		});
		await page
			.getByRole("button", { name: "+ הוספת שינוי", exact: true })
			.click();
		await kind().nth(1).selectOption("person_name");
		await page
			.getByRole("combobox", { name: "איש", exact: true })
			.nth(1)
			.selectOption(person);
		await page.getByLabel("שם", { exact: true }).fill("כינוי בדיקה");
		await page
			.getByRole("button", { name: "+ הוספת שינוי", exact: true })
			.click();
		await kind().nth(2).selectOption("source_reference");
		await first("הטענה או היישות");
		await page
			.getByRole("combobox", { name: "פרק", exact: true })
			.selectOption("1");
		await page.getByLabel("פסוק", { exact: true }).fill("1");
		await page
			.getByRole("button", { name: "+ הוספת שינוי", exact: true })
			.click();
		await kind().nth(3).selectOption("alias_mapping");
		await page
			.getByLabel("כינוי", { exact: true })
			.fill(`כינוי-בדיקה-${randomUUID().slice(0, 8)}`);
		await page
			.getByRole("button", { name: "הוספת יעד לכינוי", exact: true })
			.click();
		await first("ערך יעד 1");
		expect(
			await page.locator("form").evaluate((form) =>
				Array.from((form as HTMLFormElement).elements)
					.filter(
						(e) =>
							e instanceof HTMLInputElement ||
							e instanceof HTMLSelectElement ||
							e instanceof HTMLTextAreaElement,
					)
					.filter((e) => !(e as HTMLInputElement).checkValidity())
					.map((e) => ({
						label: e.getAttribute("aria-label"),
						value: (e as HTMLInputElement).value,
					})),
			),
		).toEqual([]);
		await page.getByRole("button", { name: "פתיחת PR", exact: true }).click();
		try {
			await expect(page.getByRole("heading", { level: 1 })).toContainText(
				title,
			);
		} catch (error) {
			const path = testInfo.outputPath("cross-category-failure.json");
			await writeFile(
				path,
				JSON.stringify({
					problems,
					url: page.url(),
					html: await page.content(),
				}),
			);
			await testInfo.attach("cross-category-failure", {
				path,
				contentType: "application/json",
			});
			throw error;
		}
		await page.getByRole("tab", { name: "שינויים 4", exact: true }).click();
		await expect(page.locator(".contribution-diff")).toHaveCount(4);
		await expect(page.locator(".contribution-diffs")).toContainText(
			"2 תשרי 1948",
		);
		await expect(page.locator(".contribution-diffs")).toContainText("בראשית א");
		await expect(page.locator(".contribution-diffs")).toContainText(
			"כינוי בדיקה",
		);
		await expect(
			page.getByRole("button", { name: "מיזוג PR", exact: true }),
		).toBeDisabled();
		await capture(page, testInfo, "cross-category-domain-diff");
		await page
			.getByRole("button", { name: "סגירה ללא מיזוג", exact: true })
			.click();
	});
	test("offers the exact family-tree relationship types under one family category", async ({
		page,
	}, testInfo) => {
		await page.goto("/pull-requests?id=new");
		await expect(
			page.getByRole("combobox", { name: "סוג שינוי", exact: true }),
		).toHaveValue("family");
		const relation = page.getByRole("combobox", {
			name: "סוג קשר משפחתי",
			exact: true,
		});
		await expect(relation.locator("option")).toHaveCount(
			FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES.length + FAMILY_UNION_TYPES.length,
		);
		expect(
			await relation
				.locator("option")
				.evaluateAll((options) =>
					options.map((option) => (option as HTMLOptionElement).value),
				),
		).toEqual([
			...FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES.map(
				(type) => `parent_child:${type}`,
			),
			...FAMILY_UNION_TYPES.map((type) => `union:${type}`),
		]);
		await relation.selectOption("union:PILEGESH");
		await expect(
			page.getByRole("combobox", { name: "איש ראשון", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("combobox", { name: "איש שני", exact: true }),
		).toBeVisible();
		await capture(page, testInfo, "defined-family-relationship-types");
		await relation.selectOption("parent_child:FOSTER");
		await expect(
			page.getByRole("combobox", { name: "תפקיד ההורה", exact: true }),
		).toBeVisible();
	});
	test("assignment starts a workstation implementation and human PR comments trigger another reviewed pass", async ({
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
		await expect(
			page.getByText("העבודה נמצאת בתור", { exact: true }),
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
			const { context, turns } = JSON.parse(input.messages[1].content);
			const issue = context.item.kind === "issue";
			const action =
				!issue && turns.length === 0
					? {
							action: "tool",
							name: "discussion",
							arguments: { source: "item" },
						}
					: {
							action: "complete",
							result: issue
								? {
										outcome: "implemented",
										summary: "נוצרה הצעה לסקירת אדם",
										responses: [],
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
									}
								: {
										outcome: "revised",
										summary: "תיאור ההצעה עודכן לפי ההערה",
										responses: context.pendingCommentIds.map(
											(commentId: string) => ({
												commentId,
												status: "addressed",
												body: "תיאור ההצעה עודכן; ההערה המקורית נשמרת",
											}),
										),
										draft: {
											description:
												"התיאור תוקן בעקבות תגובת האדם, ונדרשת סקירה מחודשת.",
										},
									},
						};
			if (!issue && turns.length)
				expect(JSON.stringify(turns)).toContain(
					"יש להסביר שההצעה עוסקת במטא-נתונים בלבד",
				);
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					model: "doradsoft",
					message: { content: JSON.stringify(action) },
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
			const run = async (contributionId: string) =>
				await promisify(execFile)(
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
						contributionId,
					],
					{ timeout: 15000, windowsHide: true },
				);
			const { stdout } = await run(issueId);
			expect(stdout).toContain("completed");
			expect(stdout).not.toContain("ויולד את אברם");
			expect(inferenceCalls).toBe(1);
			await expect(
				page.getByText("הסוכן סיים את העבודה", { exact: true }),
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
			const prId = new URL(page.url()).searchParams.get("id");
			if (!prId) throw new Error("Generated PR ID missing");
			await page.getByLabel("אחראי", { exact: true }).selectOption("local_llm");
			await page
				.getByRole("button", { name: "שמירת שיוך והפעלת סוכן", exact: true })
				.click();
			await page.getByRole("tab", { name: /^תיאור ודיון/ }).click();
			await page
				.getByLabel("הוספת תגובה", { exact: true })
				.fill("יש להסביר שההצעה עוסקת במטא-נתונים בלבד");
			await page
				.getByRole("button", { name: "שליחת תגובה", exact: true })
				.click();
			await expect(
				page.getByText("יש להסביר שההצעה עוסקת במטא-נתונים בלבד", {
					exact: true,
				}),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "הפעלה נוספת", exact: true }),
			).toBeDisabled();
			await expect(
				page.getByRole("heading", {
					name: "ממתין לסיום הטיפול של הסוכן",
					exact: true,
				}),
			).toBeVisible();
			await capture(page, testInfo, "agent-comment-pass-pending");
			const revision = await run(prId);
			expect(revision.stdout).toContain("completed");
			await expect(
				page.getByText("תיאור ההצעה עודכן; ההערה המקורית נשמרת", {
					exact: true,
				}),
			).toBeVisible();
			expect(inferenceCalls).toBe(3);
			await expect(
				page.getByText("יש להסביר שההצעה עוסקת במטא-נתונים בלבד", {
					exact: true,
				}),
			).toBeVisible();
			await expect(
				page.getByText("התיאור תוקן בעקבות תגובת האדם, ונדרשת סקירה מחודשת.", {
					exact: true,
				}),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "מיזוג PR", exact: true }),
			).toBeDisabled();
			await capture(page, testInfo, "agent-human-comment-resolution");
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
				.getByRole("button", {
					name:
						kind === "local_llm" || kind === "aws_llm"
							? "שמירת שיוך והפעלת סוכן"
							: "שמירת שיוך",
					exact: true,
				})
				.click();
			await expect(
				page
					.locator(".contribution-event")
					.filter({ hasText: "שינה שיוך" })
					.last(),
			).toBeVisible();
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

	test("uses ordinary PRs for manual and deterministic article-link changes", async ({
		page,
	}, testInfo) => {
		const address = new URL(process.env.DB_URL ?? "");
		if (
			!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname) ||
			!/^\/tanah_(?:test|e2e_[a-f0-9]{4,16})$/.test(address.pathname)
		)
			throw new Error(
				"Article-link E2E requires a disposable loopback Tanah fixture",
			);
		address.searchParams.delete("ssl-mode");
		const connection = await mysql.createConnection(address.toString());
		const articleName = `מאמר קישורים לבדיקה ${randomUUID().slice(0, 8)}`;
		const content = "<p>הפניה מפורשת לבראשית א א לצורך בדיקת קישורי המאמר.</p>";
		let articleId: number | undefined, authorId: number | undefined;
		try {
			const [chapters] = await connection.execute<RowDataPacket[]>(
				"SELECT id FROM tanah_perek WHERE pasuk_count > 0 ORDER BY id LIMIT 1",
			);
			if (!chapters.length) throw new Error("Canonical test chapter missing");
			const chapter = Number(chapters[0].id);
			const [author] = await connection.execute<mysql.ResultSetHeader>(
				"INSERT INTO tanah_author (name,details) VALUES (?,?)",
				[articleName, "מחבר לבדיקת ממשק מבודדת"],
			);
			authorId = author.insertId;
			const [article] = await connection.execute<mysql.ResultSetHeader>(
				"INSERT INTO tanah_article (perek_id,author_id,name,abstract,content,priority) VALUES (?,?,?,?,?,0)",
				[chapter, authorId, articleName, "תקציר בדיקה", content],
			);
			articleId = article.insertId;
			await page.goto("/?tab=prs&id=new");
			await page
				.getByLabel("כותרת", { exact: true })
				.fill(`קישור מוצע - ${articleName}`);
			await page
				.getByLabel("תיאור", { exact: true })
				.fill("הוספת כיסוי פסוק מתוך הפניה מפורשת, ללא עריכת גוף המאמר.");
			await page
				.getByRole("button", { name: "+ הוספת מקור", exact: true })
				.click();
			await page
				.getByLabel("הפניה למקור", { exact: true })
				.fill(`מאמר ${articleId}`);
			await page
				.getByLabel("ציטוט רלוונטי", { exact: true })
				.fill("בראשית א א");
			await page
				.getByRole("combobox", { name: "סוג שינוי", exact: true })
				.selectOption("article_links");
			await page
				.getByLabel("מספר מאמר", { exact: true })
				.fill(String(articleId));
			await page
				.getByRole("button", { name: "טעינת המאמר", exact: true })
				.click();
			await expect(
				page.getByRole("region", { name: "המאמר שנבחר" }),
			).toContainText(articleName);
			await page
				.getByRole("button", { name: "+ הוספת קישור מוצע", exact: true })
				.click();
			await page
				.getByLabel("פרק בקישור 1 פסוק 1", { exact: true })
				.fill(String(chapter));
			await page
				.getByLabel("מספר פסוק בקישור 1 פסוק 1", { exact: true })
				.fill("1");
			await capture(page, testInfo, "article-link-ordinary-pr-composer");
			await page.getByRole("button", { name: "פתיחת PR", exact: true }).click();
			await expect(page.getByRole("heading", { level: 1 })).toContainText(
				articleName,
			);
			await expect(
				page.getByRole("button", { name: "מיזוג PR", exact: true }),
			).toBeDisabled();
			await page.getByRole("tab", { name: "שינויים 1", exact: true }).click();
			await expect(
				page.getByRole("region", { name: "השוואת קישורי המאמר" }),
			).toContainText("בראשית א א");
			await expect(page.locator(".contribution-diff tbody")).not.toContainText(
				"contentHash",
			);
			await capture(page, testInfo, "article-link-ordinary-pr-diff");
			await page
				.getByRole("button", { name: "סגירה ללא מיזוג", exact: true })
				.click();

			// Discovery and a repeated checkpoint request open the very same PR.
			const discover = async () => {
				await page.goto("/?tab=prs");
				await page.getByText("איתור קישורים למאמר", { exact: true }).click();
				await page
					.getByLabel("מספר מאמר לאיתור", { exact: true })
					.fill(String(articleId));
				await page
					.getByRole("button", { name: "איתור ופתיחת PR", exact: true })
					.click();
				await expect(page).toHaveURL(
					(url) =>
						url.pathname === "/" &&
						url.searchParams.get("tab") === "prs" &&
						Boolean(url.searchParams.get("id")),
				);
				return new URL(page.url()).searchParams.get("id");
			};
			const generatedId = await discover();
			await expect(
				page.getByRole("button", { name: "מיזוג PR", exact: true }),
			).toBeDisabled();
			await expect(
				page.getByText("נדרש אישור מ-doradsoft", { exact: true }).first(),
			).toBeVisible();
			await capture(page, testInfo, "deterministic-article-link-pr-review");
			expect(await discover()).toBe(generatedId);
			await page
				.getByRole("button", { name: "סגירה ללא מיזוג", exact: true })
				.click();
			const [unchanged] = await connection.execute<RowDataPacket[]>(
				"SELECT content,coverage_verified,(SELECT COUNT(*) FROM tanah_article_covering_source WHERE article_id=?) AS links FROM tanah_article WHERE id=?",
				[articleId, articleId],
			);
			expect(unchanged[0]).toMatchObject({
				content,
				coverage_verified: 0,
				links: 0,
			});
		} finally {
			if (articleId !== undefined) {
				await connection.execute(
					"DELETE FROM tanah_article_link_proposal WHERE article_id=?",
					[articleId],
				);
				await connection.execute(
					"DELETE FROM tanah_article_link_checkpoint WHERE article_id=?",
					[articleId],
				);
				await connection.execute("DELETE FROM tanah_article WHERE id=?", [
					articleId,
				]);
			}
			if (authorId !== undefined)
				await connection.execute("DELETE FROM tanah_author WHERE id=?", [
					authorId,
				]);
			await connection.end();
		}
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
			!/^\/tanah_(?:test|e2e_[a-f0-9]{4,16})$/.test(configured.pathname)
		)
			throw new Error("Migration E2E requires a loopback Tanah test fixture");
		const id = new URL(page.url()).searchParams.get("id");
		if (!id) throw new Error("Created PR ID missing");
		// mysql2 does not accept the Rust populator's URL-only ssl-mode option.
		configured.searchParams.delete("ssl-mode");
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
		await page.getByRole("tab", { name: "תיאור ודיון 0", exact: true }).click();
		await page.getByText(/^הצגת גרסה 1 -/).click();
		await expect(
			page.locator(".contribution-raw-sequence").first(),
		).toContainText('"kind": "entry"');
		await capture(page, testInfo, "recovered-pr-retained-history");
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
		await capture(page, testInfo, "mobile-issues-queue");
		for (const viewport of [390, 812, 1024, 1280]) {
			await page.setViewportSize({ width: viewport, height: 844 });
			const width = await page.evaluate(() => ({
				document: document.documentElement.scrollWidth,
				viewport: innerWidth,
			}));
			expect(width.document).toBeLessThanOrEqual(width.viewport);
			if (viewport === 812)
				await capture(page, testInfo, "medium-width-admin-navigation");
		}
	});
});
