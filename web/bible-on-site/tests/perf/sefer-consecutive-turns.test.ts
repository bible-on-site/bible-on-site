import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { reportBenchmark } from "../util/benchmark";
import { dispatchTurnInput, prepareTurnInput } from "../util/turn-input";
import {
	reduceTurnSamples,
	TURN_LIMITS,
	turnBudgetFailures,
} from "../util/turn-metrics";
import {
	markTurnSettled,
	startTurnProbe,
	stopTurnProbe,
	turnContentIsVisible,
	waitForTurnCommit,
	waitForVisibleTurnContent,
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
					() => {
						const current = Array.from(
							document.querySelectorAll(".he-book .page.current-page"),
						);
						return (
							current.length === 2 &&
							current.every((page) => {
								const content = page.querySelector(".flipbook-page-content");
								return (
									content?.checkVisibility({
										checkOpacity: true,
										checkVisibilityCSS: true,
									}) && content.textContent?.trim()
								);
							}) &&
							!document.querySelector(".he-book .page--flipping") &&
							document.querySelector<HTMLButtonElement>(
								"button.flipbook-toolbar-next",
							)?.disabled === false
						);
					},
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
				const inputPoint = await prepareTurnInput(page, gesture);
				await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
				await startTurnProbe(page, gesture);
				let samples: Awaited<ReturnType<typeof stopTurnProbe>>;
				try {
					// Immediate handoffs plus the existing 80ms buffer recenter window.
					for (const [index, gap] of [0, 0, 100, 0, 100, 0].entries()) {
						if (gap) await page.waitForTimeout(gap);
						await dispatchTurnInput(client, gesture, inputPoint);
						await waitForTurnCommit(page, chapter + index + 1);
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
				await waitForVisibleTurnContent(page);
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
			body: '<button class="flipbook-toolbar-next">Next</button><div class="he-book"><div class="page current-page"><div class="flipbook-page-content">Front</div></div><div class="page current-page"><div class="flipbook-page-content">Back</div></div></div>',
		}),
	);
	await page.goto("/929/125?book", { waitUntil: "load" });
	// A minimal control isolates the probe from app code. Native clicks still
	// carry real browser timestamps; the second handler deliberately blocks.
	await page.evaluate(() => {
		// Native frames can be timestamped before their input. Exaggerate that
		// ordering here: observations must use callback execution time while
		// cadence must still report the blocked interval.
		const raf = window.requestAnimationFrame.bind(window);
		let currentFrame: number | undefined;
		let previousFrame: number | undefined;
		let repeatedFrame: number | undefined;
		let repeatedValue = 0;
		window.requestAnimationFrame = (callback) =>
			raf((timestamp) => {
				if (timestamp !== currentFrame) {
					previousFrame = currentFrame;
					currentFrame = timestamp;
				}
				// A repeated scheduled timestamp is the same render opportunity.
				// It must not become a zero-duration frame or erase a later stall.
				if (
					repeatedFrame === undefined &&
					previousFrame !== undefined &&
					window.__seferTurns?.inputs.length
				) {
					repeatedFrame = timestamp;
					repeatedValue = previousFrame;
				}
				callback(
					(timestamp === repeatedFrame ? repeatedValue : timestamp) - 1_000,
				);
			});
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
			requestAnimationFrame(() =>
				requestAnimationFrame(() =>
					document.querySelector(".page")?.classList.remove("page--flipping"),
				),
			);
		});
	});
	const client = await page.context().newCDPSession(page);
	for (const [property, value] of [
		["opacity", "0"],
		["visibility", "hidden"],
	]) {
		await page.evaluate(
			({ property, value }) => {
				document
					.querySelector<HTMLElement>(".page")
					?.style.setProperty(property, value);
			},
			{ property, value },
		);
		expect(await page.evaluate(turnContentIsVisible)).toBe(false);
		await page.evaluate(
			(name) =>
				document
					.querySelector<HTMLElement>(".page")
					?.style.removeProperty(name),
			property,
		);
	}
	expect(await page.evaluate(turnContentIsVisible)).toBe(true);
	const inputPoint = await prepareTurnInput(page, "toolbar");
	await page.evaluate(() => {
		// The observer must not create a pause by forcing styles/layout itself.
		for (const name of ["checkVisibility", "getBoundingClientRect"]) {
			const descriptor = Object.getOwnPropertyDescriptor(
				Element.prototype,
				name,
			);
			if (!descriptor || typeof descriptor.value !== "function") {
				throw new Error(`Missing layout-read control: ${name}`);
			}
			const original = descriptor.value;
			Object.defineProperty(Element.prototype, name, {
				...descriptor,
				value: function (this: Element, ...args: unknown[]) {
					if (window.__seferTurns) {
						throw new Error(`Observer forced ${name} while timing turns`);
					}
					return Reflect.apply(original, this, args);
				},
			});
		}
	});
	await startTurnProbe(page, "toolbar");
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	for (let index = 0; index < 2; index++) {
		await dispatchTurnInput(client, "toolbar", inputPoint);
		await waitForTurnCommit(page, 301 + index);
		await markTurnSettled(page);
	}
	const samples = await stopTurnProbe(page);
	await client.detach();
	await waitForVisibleTurnContent(page);
	const samplePath = testInfo.outputPath("control-samples.json");
	await writeFile(samplePath, JSON.stringify(samples, null, 2));
	await testInfo.attach("control-samples", {
		path: samplePath,
		contentType: "application/json",
	});
	const metrics = reduceTurnSamples(samples, 300, 2);
	expect(samples.inputs[0].frameStart).toBe(0);
	expect(samples.repeatedFrameTimestamps?.length).toBeGreaterThan(0);
	expect(metrics.responseMs[0]).toBeLessThan(200);
	expect(metrics.responseMs[1]).toBeGreaterThanOrEqual(250);
	expect(turnBudgetFailures(metrics).length).toBeGreaterThan(0);
});
