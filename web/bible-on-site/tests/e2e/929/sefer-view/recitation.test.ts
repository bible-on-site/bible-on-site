import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../../../util/playwright/test-fixture";

/** Exercise the real MP3 decoder without an external audio download. */
const recording = readFileSync(
	resolve(process.cwd(), "../../data/recitation/fixtures/silence-120s.mp3"),
);

async function chapterReader(page: Page, perekId: number, chapter: string) {
	await page.goto(`/929/${perekId}?book`);
	const reader = page.locator(
		`.he-book .page.current-page[data-page-semantic-name="${chapter}"]`,
	);
	const toggle = reader.getByRole("button", { name: "מצב הקראה" });
	await expect(toggle).toBeVisible({ timeout: 60_000 });
	await page.evaluate(() => document.fonts.ready);
	return { toggle, reader, text: reader.locator("article").first() };
}

async function characterPositions(text: Locator) {
	return text.evaluate((element) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const positions = [];
		let node = walker.nextNode();
		while (node) {
			const value = node.textContent ?? "";
			for (let i = 0; i < value.length; i++) {
				const range = document.createRange();
				range.setStart(node, i);
				range.setEnd(node, i + 1);
				const rect = range.getBoundingClientRect();
				positions.push({
					character: value[i],
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				});
			}
			node = walker.nextNode();
		}
		return positions;
	});
}

test.describe("Recitation in the book reader", () => {
	test.beforeEach(({ skipOnNotWideEnough }) => {
		void skipOnNotWideEnough;
	});

	for (const { perekId, chapter } of [
		{ perekId: 829, chapter: "י" },
		{ perekId: 203, chapter: "טז" },
	]) {
		test(`chapter ${perekId}: toggling preserves scripture layout and hovering a verse letter highlights the full verse`, async ({
			page,
		}) => {
			test.setTimeout(90_000);
			// Prepare the real canonical manifest before measuring the interaction;
			// a cold development route compilation can outlast the UI assertion.
			const response = await page.request.get(`/api/recitation/${perekId}`);
			expect(response.ok()).toBe(true);
			const manifest = await response.json();
			expect(manifest.durationMs).toBeLessThanOrEqual(120000);
			await page.route(`**/api/recitation/${perekId}`, async (route) => {
				await route.fulfill({
					response,
					json: {
						...manifest,
						audioSha256: createHash("sha256").update(recording).digest("hex"),
					},
				});
			});
			await page.route(`**/recordings/${perekId}_record.mp3`, (route) =>
				route.fulfill({
					body: recording,
					contentType: "audio/mpeg",
					headers: { "content-length": String(recording.length) },
				}),
			);
			const { toggle, reader, text } = await chapterReader(
				page,
				perekId,
				chapter,
			);
			const original = await characterPositions(text);
			expect(original.length).toBeGreaterThan(100);
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-pressed", "true");
			const enabled = await characterPositions(text);
			expect(enabled.map((p) => p.character)).toEqual(
				original.map((p) => p.character),
			);
			for (let i = 0; i < original.length; i++) {
				for (const metric of ["x", "y", "width", "height"] as const) {
					expect(
						Math.abs(enabled[i][metric] - original[i][metric]),
						`Character ${i} (${original[i].character}): ${metric}`,
					).toBeLessThan(0.05);
				}
			}
			const letter = reader.getByRole("button", { name: "השמעת פסוק א" });
			const verse = letter.locator("..");
			await expect(verse).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
			await letter.hover();
			await expect(verse).toHaveCSS("background-color", "rgb(233, 239, 248)");
			await expect(letter).toHaveCSS("background-color", "rgb(233, 239, 248)");
			await page.keyboard.press("Tab");
			await letter.focus();
			await toggle.hover();
			await expect(verse).toHaveCSS("background-color", "rgb(233, 239, 248)");
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			expect(await characterPositions(text)).toEqual(original);
		});
	}

	test("spoken words advance with real decoded audio, retain hover styling and never reflow scripture", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const response = await page.request.get("/api/recitation/829");
		expect(response.ok()).toBe(true);
		const manifest = await response.json();
		await page.route("**/api/recitation/829", (route) =>
			route.fulfill({
				response,
				json: {
					...manifest,
					audioSha256: createHash("sha256").update(recording).digest("hex"),
				},
			}),
		);
		await page.route("**/recordings/829_record.mp3", (route) =>
			route.fulfill({
				body: recording,
				contentType: "audio/mpeg",
				headers: { "content-length": String(recording.length) },
			}),
		);
		const { toggle, reader, text } = await chapterReader(page, 829, "י");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		const original = await characterPositions(text);
		const first = reader.getByRole("button", {
			name: `השמעת המילה ${manifest.words[0].text}`,
			exact: true,
		});
		const second = reader.getByRole("button", {
			name: `השמעת המילה ${manifest.words[1].text}`,
			exact: true,
		});
		await reader
			.getByRole("button", { name: "השמעת פסוק א", exact: true })
			.click();
		await expect(first).toHaveAttribute("aria-current", "true");
		await expect(first).toHaveCSS("background-color", "rgb(233, 239, 248)");
		await expect(second).toHaveAttribute("aria-current", "true");
		await expect(first).not.toHaveAttribute("aria-current", "true");
		await reader.getByRole("button", { name: "השהיית ההקראה" }).click();
		const paused = await text
			.locator('[data-recitation-active="true"]')
			.allTextContents();
		// A pause can land in recorded silence; freeze that empty state too.
		await page.waitForTimeout(250);
		expect(
			await text.locator('[data-recitation-active="true"]').allTextContents(),
		).toEqual(paused);
		const highlighted = await characterPositions(text);
		for (let i = 0; i < original.length; i++) {
			for (const metric of ["x", "y", "width", "height"] as const) {
				expect(
					Math.abs(highlighted[i][metric] - original[i][metric]),
				).toBeLessThan(0.05);
			}
		}
		await reader.getByRole("button", { name: "המשך ההקראה" }).click();
		await expect(
			reader.getByRole("button", { name: "השמעת כל הפרק" }),
		).toBeVisible({ timeout: 30_000 });
		await expect(text.locator('[data-recitation-active="true"]')).toHaveCount(
			0,
			{ timeout: 12_000 },
		);
		await toggle.click();
		expect(await characterPositions(text)).toEqual(original);
	});

	test("a chapter without a recording is gray, explains availability on hover and never requests audio", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const requests: string[] = [];
		page.on("request", (request) => {
			if (/\/api\/recitation\/|\/recordings\//.test(request.url()))
				requests.push(request.url());
		});
		const { toggle } = await chapterReader(page, 142, "כה");
		await expect(toggle).toBeDisabled();
		await toggle.hover();
		await expect(toggle).toHaveAttribute("title", "אין הקלטה לפרק זה");
		expect(
			Number(await toggle.evaluate((el) => getComputedStyle(el).opacity)),
		).toBeLessThan(0.5);
		await toggle.evaluate((el) => (el as HTMLButtonElement).click());
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		expect(requests).toEqual([]);
	});
});

test("chapter settings shortcut focuses narration and schedules exact verses with chosen speed and pauses", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const starts: {
			when: number;
			offset: number;
			duration: number;
			rate: number;
		}[] = [];
		Object.assign(window, { recitationStarts: starts });
		const create = AudioContext.prototype.createBufferSource;
		AudioContext.prototype.createBufferSource = function () {
			const source = create.call(this);
			const start = source.start.bind(source);
			source.start = (when = 0, offset = 0, duration = 0) => {
				starts.push({
					when,
					offset,
					duration,
					rate: source.playbackRate.value,
				});
				start(when, offset, duration);
			};
			return source;
		};
	});
	const response = await page.request.get("/api/recitation/829");
	expect(response.ok()).toBe(true);
	const manifest = await response.json();
	await page.route("**/api/recitation/829", (route) =>
		route.fulfill({
			response,
			json: {
				...manifest,
				audioSha256: createHash("sha256").update(recording).digest("hex"),
			},
		}),
	);
	await page.route("**/recordings/829_record.mp3", (route) =>
		route.fulfill({
			body: recording,
			contentType: "audio/mpeg",
			headers: { "content-length": String(recording.length) },
		}),
	);
	const { toggle, reader } = await chapterReader(page, 829, "י");
	await expect(
		reader.getByRole("button", { name: "הגדרות קריינות" }),
	).toHaveCount(0);
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	const settings = reader.getByRole("button", { name: "הגדרות קריינות" });
	const play = reader.getByRole("button", { name: "השמעת כל הפרק" });
	const boxes = await Promise.all([
		toggle.boundingBox(),
		settings.boundingBox(),
		play.boundingBox(),
	]);
	expect(
		boxes[0] &&
			boxes[1] &&
			boxes[2] &&
			boxes[0].x < boxes[1].x &&
			boxes[1].x < boxes[2].x,
	).toBe(true);
	await settings.click();
	const settingsBox = await settings.boundingBox();
	const panelBox = await page
		.getByRole("dialog", { name: "הגדרות קריאה" })
		.boundingBox();
	expect(
		settingsBox && panelBox && Math.abs(panelBox.x - settingsBox.x) < 1,
	).toBe(true);
	await expect(page.getByRole("slider", { name: "מהירות" })).toBeFocused();
	await page.getByRole("slider", { name: "מהירות" }).fill("2");
	await page.getByRole("slider", { name: "עוצמה" }).fill("0.4");
	await page
		.getByRole("combobox", { name: "אורך הפסקה בין פסוקים" })
		.selectOption("1000");
	await page.keyboard.press("Escape");
	await expect(settings).toBeFocused();
	await play.click();
	await expect(
		reader.getByRole("button", { name: "השהיית ההקראה" }),
	).toBeVisible();
	const scheduled = await page.evaluate(
		() =>
			(
				window as unknown as {
					recitationStarts: {
						when: number;
						offset: number;
						duration: number;
						rate: number;
					}[];
				}
			).recitationStarts,
	);
	expect(scheduled).toHaveLength(3);
	const words = manifest.words as {
		pasuk: number;
		startMs: number;
		endMs: number;
	}[];
	for (let i = 0; i < scheduled.length; i++) {
		const verse = words.filter((w) => w.pasuk === i + 1);
		expect(scheduled[i].offset).toBe(verse[0].startMs / 1000);
		expect(scheduled[i].duration).toBe(
			(verse[verse.length - 1].endMs - verse[0].startMs) / 1000,
		);
		expect(scheduled[i].rate).toBe(2);
	}
	expect(
		scheduled[2].when - scheduled[1].when - scheduled[1].duration / 2,
	).toBeCloseTo(1, 5);
	await expect(
		reader.locator('[data-recitation-active="true"]').first(),
	).toBeVisible();
	await reader.getByRole("button", { name: "השהיית ההקראה" }).click();
	await expect(
		reader.getByRole("button", { name: "המשך ההקראה" }),
	).toBeVisible();
});
