import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { reportBenchmark } from "../util/benchmark";
import {
	reduceTurnSamples,
	TURN_LIMITS,
	turnBudgetFailures,
} from "../util/turn-metrics";
import {
	markTurnSettled,
	startTurnProbe,
	stopTurnProbe,
} from "../util/turn-probe";

// Every mode/book/gesture has its own unchanged 20s local / 60s CI deadline.
// Full Chromium also uses the desktop rendering path locally; archive hardware
// metadata with results so software-rendered CI is not labelled desktop GPU fps.
test.use({
	channel: "chromium",
	viewport: { width: 1440, height: 900 },
	launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});
test.describe.configure({ retries: 0 });
test.skip(({ isMobile }) => isMobile, "Desktop Chrome/Edge regression profile");
const TURN_DIAGNOSTICS = ".playwright-report/perf/diagnostics/sefer-turns";

for (const [chapter, bookmarks] of [
	[125, 36],
	[300, 47],
] as const) {
	for (const mode of ["leaf", "pinned", "hidden"] as const) {
		for (const gesture of ["drag", "toolbar"] as const) {
			test(`${chapter}: consecutive ${gesture} turns with ${mode} bookmarks`, async ({
				page,
				isMobile,
				browser,
			}, testInfo) => {
				test.skip(isMobile, "Desktop Chrome/Edge regression profile");
				await page.addInitScript((attachment) => {
					localStorage.setItem(
						"seferBookmarks",
						JSON.stringify({
							enabled: attachment !== "hidden",
							placement: "sides",
							orientation: "perpendicular",
							attachment: attachment === "pinned" ? "pinned" : "leaf",
							order: "page",
							upcomingOnly: false,
						}),
					);
				}, mode);
				await page.goto(`/929/${chapter}?book`, { waitUntil: "load" });
				await page.waitForFunction(
					() =>
						document.querySelectorAll(".he-book .page.current-page").length ===
							2 &&
						!document.querySelector(".he-book .page--flipping") &&
						document.querySelector<HTMLButtonElement>(
							"button.flipbook-toolbar-next",
						)?.disabled === false,
					null,
					{ timeout: 5_000 },
				);
				await expect(page.locator(".he-book .flipbook-bookmark")).toHaveCount(
					mode === "hidden" ? 0 : bookmarks,
				);
				await page.screenshot({ path: testInfo.outputPath("before.png") });
				await testInfo.attach("before", {
					path: testInfo.outputPath("before.png"),
					contentType: "image/png",
				});
				const system = await browser.newBrowserCDPSession();
				const hardware = await system.send("SystemInfo.getInfo");
				await system.detach();
				const client = await page.context().newCDPSession(page);
				await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
				await startTurnProbe(page, gesture);
				let samples: Awaited<ReturnType<typeof stopTurnProbe>>;
				try {
					// Immediate handoffs plus the existing 80ms buffer recenter window.
					for (const [index, gap] of [0, 0, 100, 0, 100, 0].entries()) {
						if (gap) await page.waitForTimeout(gap);
						if (gesture === "toolbar") {
							await page.locator("button.flipbook-toolbar-next").click();
						} else {
							const edge = await page.evaluate(() => {
								const surfaces = [
									...document.querySelectorAll(".he-book .page.current-page"),
								]
									.map((element) => element.getBoundingClientRect())
									.filter((box) => box.width > 40 && box.height > 40)
									.sort((a, b) => a.x - b.x);
								const box = surfaces[0];
								if (!box) throw new Error("No visible forward page");
								return {
									x: box.x + 10,
									y: box.y + box.height * 0.85,
									width: box.width,
								};
							});
							await client.send("Input.dispatchMouseEvent", {
								type: "mouseMoved",
								x: edge.x,
								y: edge.y,
							});
							await client.send("Input.dispatchMouseEvent", {
								type: "mousePressed",
								x: edge.x,
								y: edge.y,
								button: "left",
								buttons: 1,
								clickCount: 1,
							});
							const inputs: Promise<unknown>[] = [];
							for (let step = 1; step <= 14; step++) {
								const motion = client.send("Input.dispatchMouseEvent", {
									type: "mouseMoved",
									x: edge.x + (edge.width * 1.4 * step) / 14,
									y: edge.y - (edge.width * 0.1 * step) / 14,
									buttons: 1,
								});
								// Confirm panstart, then preserve the 14-point/11ms input
								// schedule without making physical movement wait for each
								// render acknowledgement (the existing native swipe flow).
								if (step === 1) await motion;
								else inputs.push(motion);
								await delay(11);
							}
							inputs.push(
								client.send("Input.dispatchMouseEvent", {
									type: "mouseReleased",
									x: edge.x + edge.width * 1.4,
									y: edge.y - edge.width * 0.1,
									button: "left",
									buttons: 0,
									clickCount: 1,
								}),
							);
							await Promise.all(inputs);
						}
						await page.waitForFunction(
							(target) => {
								const visible = Array.from(
									document.querySelectorAll(".he-book .page.current-page"),
								);
								return (
									Number(location.pathname.split("/").at(-1)) === target &&
									!document.querySelector(".he-book .page--flipping") &&
									visible.length === 2 &&
									visible.every((page) =>
										page.querySelector(".flipbook-page-content")?.textContent?.trim(),
									)
								);
							},
							chapter + index + 1,
							{ timeout: 5_000, polling: "raf" },
						);
						await markTurnSettled(page);
					}
					await page.waitForTimeout(200);
				} finally {
					samples = await stopTurnProbe(page);
					const samplePath = testInfo.outputPath("turn-samples.json");
					await writeFile(
						samplePath,
						JSON.stringify(
							{
								chapter,
								mode,
								gesture,
								cpuRate: 4,
								browser: browser.version(),
								gpu: hardware.gpu,
								limits: TURN_LIMITS,
								samples,
							},
							null,
							2,
						),
					);
					await testInfo.attach("turn-samples", {
						path: samplePath,
						contentType: "application/json",
					});
					// Keep complete samples in the artifact published even when a
					// timing guard fails before Lighthouse diagnostics can run.
					await mkdir(TURN_DIAGNOSTICS, { recursive: true });
					await copyFile(
						samplePath,
						`${TURN_DIAGNOSTICS}/${chapter}-${mode}-${gesture}.json`,
					);
					await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
					await client.detach();
					await page.screenshot({ path: testInfo.outputPath("after.png") });
					await testInfo.attach("after", {
						path: testInfo.outputPath("after.png"),
						contentType: "image/png",
					});
				}
				const metrics = reduceTurnSamples(samples, chapter, 6);
				for (const [key, limit] of Object.entries(TURN_LIMITS))
					reportBenchmark({
						name: `sefer-handoff/${chapter}/${mode}/${gesture}/${key}`,
						measure: "time_ms",
						value: metrics[key as keyof typeof TURN_LIMITS],
						upperValue: limit,
					});
				for (const [phase, values] of [
					["first-turn", metrics.firstTurn],
					["consecutive-turns", metrics.consecutiveTurns],
				] as const) {
					for (const [key, limit] of Object.entries(TURN_LIMITS))
						reportBenchmark({
							name: `sefer-handoff/${chapter}/${mode}/${gesture}/${phase}/${key}`,
							measure: "time_ms",
							value: values[key as keyof typeof TURN_LIMITS],
							upperValue: limit,
						});
				}
				expect(turnBudgetFailures(metrics), JSON.stringify(metrics)).toEqual(
					[],
				);
			});
		}
	}
}

test("turn probe detects an injected second-turn stall", async ({
	page,
	isMobile,
}, testInfo) => {
	test.skip(isMobile, "Desktop regression probe control");
	await page.route("**/929/125?book", (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/html",
			body: '<button class="flipbook-toolbar-next">Next</button><div class="he-book"><div class="page"></div></div>',
		}),
	);
	await page.goto("/929/125?book", { waitUntil: "load" });
	// A minimal control isolates the probe from app code. Native clicks still
	// carry real browser timestamps; the second handler deliberately blocks.
	await page.evaluate(() => {
		// Native frames can be timestamped before their input. Exaggerate that
		// ordering here: observations must use callback execution time while
		// cadence retains the unchanged spacing between frame timestamps.
		const raf = window.requestAnimationFrame.bind(window);
		window.requestAnimationFrame = (callback) =>
			raf((timestamp) => callback(timestamp - 1_000));
		history.replaceState(null, "", "/929/300?book");
		let count = 0;
		document.querySelector("button")?.addEventListener("click", () => {
			if (count === 1) {
				const end = performance.now() + 250;
				while (performance.now() < end) {
					/* deliberate positive control */
				}
			}
			document.querySelector(".page")?.classList.add("page--flipping");
			count++;
			history.replaceState(null, "", `/929/${300 + count}?book`);
		});
	});
	await startTurnProbe(page, "toolbar");
	for (let index = 0; index < 2; index++) {
		await page.locator("button").click();
		await page.waitForFunction(
			() =>
				typeof window.__seferTurns?.inputs.at(-1)?.responseFrame === "number",
		);
		await page.evaluate(() =>
			document.querySelector(".page")?.classList.remove("page--flipping"),
		);
		await markTurnSettled(page);
	}
	const samples = await stopTurnProbe(page);
	const samplePath = testInfo.outputPath("control-samples.json");
	await writeFile(samplePath, JSON.stringify(samples, null, 2));
	await testInfo.attach("control-samples", {
		path: samplePath,
		contentType: "application/json",
	});
	const metrics = reduceTurnSamples(samples, 300, 2);
	expect(metrics.responseMs[0]).toBeLessThan(200);
	expect(metrics.responseMs[1]).toBeGreaterThanOrEqual(250);
	expect(turnBudgetFailures(metrics).length).toBeGreaterThan(0);
});
