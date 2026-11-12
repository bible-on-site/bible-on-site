import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { expect, type TestInfo, test } from "@playwright/test";
import { reportBenchmark } from "../util/benchmark";
import {
	captureTurnFailureTrace,
	exerciseConsecutiveTurns,
} from "../util/turn-failure-trace";
import { dispatchTurnInput, prepareTurnInput } from "../util/turn-input";
import {
	reduceTurnBlockingSamples,
	reduceTurnSamples,
	TURN_BLOCKING_FRAME_ALLOWANCE,
	TURN_BLOCKING_HARD_LIMIT_MS,
	TURN_BLOCKING_LIMIT_MS,
	type TURN_LIMITS,
	turnBlockingBudgetFailures,
	turnBudgetFailures,
	turnProfileSettings,
	turnQualificationFailures,
	turnRenderingProfile,
	turnVisibilityFailures,
} from "../util/turn-metrics";
import {
	markTurnSettled,
	startTurnProbe,
	stopTurnProbe,
	turnContentIsVisible,
	waitForTurnCommit,
	waitForVisibleTurnContent,
} from "../util/turn-probe";
import { startTurnQualificationTrace } from "../util/turn-qualification-trace";

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
const originalTraces = new Map<
	string,
	{
		trace: Awaited<ReturnType<typeof startTurnQualificationTrace>>;
		path: string;
	}
>();

async function finishOriginalTrace(testInfo: TestInfo, keep: boolean) {
	const original = originalTraces.get(testInfo.testId);
	if (!original) return;
	originalTraces.delete(testInfo.testId);
	try {
		await original.trace.finish(keep ? original.path : undefined);
	} catch (error) {
		// Diagnostic collection must preserve the original timing failure.
		await testInfo.attach("original-turn-trace-error", {
			body: String(error),
			contentType: "text/plain",
		});
	}
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture destructuring before testInfo.
test.afterEach(async ({}, testInfo) => {
	await finishOriginalTrace(
		testInfo,
		testInfo.status !== testInfo.expectedStatus,
	);
});

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
				if (process.env.CI || process.env.SEFER_TURN_TRACE === "1") {
					originalTraces.set(testInfo.testId, {
						trace: await startTurnQualificationTrace(browser),
						path: `.playwright-report/perf/diagnostics/sefer-turn-traces/${chapter}-${mode}-${gesture}.original.trace.json`,
					});
				}
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
				await page.bringToFront();
				await page.screenshot({ path: testInfo.outputPath("before.png") });
				await testInfo.attach("before", {
					path: testInfo.outputPath("before.png"),
					contentType: "image/png",
				});
				const system = await browser.newBrowserCDPSession();
				const hardware = await system.send("SystemInfo.getInfo");
				await system.detach();
				const renderingProfile = turnRenderingProfile(hardware.gpu);
				const { cpuRate, limits } = turnProfileSettings(renderingProfile);
				const client = await page.context().newCDPSession(page);
				const inputPoint = await prepareTurnInput(page, gesture);
				await client.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
				await startTurnProbe(page, gesture);
				let samples: Awaited<ReturnType<typeof stopTurnProbe>>;
				try {
					await exerciseConsecutiveTurns(
						page,
						client,
						gesture,
						inputPoint,
						chapter,
					);
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
								cpuRate,
								browser: browser.version(),
								headless: testInfo.project.use.headless ?? true,
								gpu: hardware.gpu,
								renderingProfile,
								limits,
								blockingLimitMs: TURN_BLOCKING_LIMIT_MS,
								blockingHardLimitMs: TURN_BLOCKING_HARD_LIMIT_MS,
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
				const blocking = reduceTurnBlockingSamples(samples, chapter, 6);
				for (const [phase, values, work] of [
					["all-turns", metrics, blocking],
					["first-turn", metrics.firstTurn, blocking.firstTurn],
					[
						"consecutive-turns",
						metrics.consecutiveTurns,
						blocking.consecutiveTurns,
					],
				] as const) {
					const name = `sefer-handoff/${renderingProfile}/cpu-${cpuRate}x/${chapter}/${mode}/${gesture}/${phase}`;
					for (const [key, limit] of Object.entries(limits)) {
						if (renderingProfile === "software-work" && key !== "responseP95Ms")
							continue;
						// Fixed-budget ratios retain absolute limits, including zero
						// blocking, without a noisy percentage-of-history threshold.
						reportBenchmark({
							name: `${name}/${key}`,
							measure: "frame_budget_ratio",
							value: values[key as keyof typeof TURN_LIMITS] / limit,
							upperValue: 1,
						});
					}
					reportBenchmark({
						name: `${name}/blockingDurationMaxMs`,
						measure: "frame_budget_ratio",
						value: work.blockingDurationMaxMs / TURN_BLOCKING_HARD_LIMIT_MS,
						upperValue: 1,
					});
					reportBenchmark({
						name: `${name}/blockingOverLimitCount`,
						measure: "frame_budget_ratio",
						value:
							work.blockingOverLimitCount /
							(TURN_BLOCKING_FRAME_ALLOWANCE + 1),
						upperValue: 1,
					});
				}
				const failures = [
					...turnQualificationFailures(metrics, blocking, renderingProfile),
					...turnVisibilityFailures(samples.visibility),
				];
				const qualification = {
					renderingProfile,
					cpuRate,
					limits,
					metrics,
					blocking,
					budgetFailures: turnBudgetFailures(metrics, limits),
					failures,
				};
				const qualificationDirectory = `${TURN_DIAGNOSTICS}/qualification`;
				await mkdir(qualificationDirectory, { recursive: true });
				const qualificationPath = `${qualificationDirectory}/${chapter}-${mode}-${gesture}.json`;
				await writeFile(
					qualificationPath,
					JSON.stringify(qualification, null, 2),
				);
				await testInfo.attach("turn-qualification", {
					path: qualificationPath,
					contentType: "application/json",
				});
				// Close the original recording before the independent diagnostic replay.
				await finishOriginalTrace(
					testInfo,
					failures.length > 0 || process.env.SEFER_TURN_TRACE === "1",
				);
				if (failures.length) {
					try {
						await captureTurnFailureTrace(
							page,
							browser,
							chapter,
							mode,
							gesture,
						);
					} catch (error) {
						// A diagnostic failure cannot replace the original timing failure.
						await testInfo.attach("turn-trace-error", {
							body: String(error),
							contentType: "text/plain",
						});
					}
				}
				expect(failures, JSON.stringify(metrics)).toEqual([]);
			});
		}
	}
}

test("turn probe retains visibility changes and removes its listener", async ({
	page,
}) => {
	await page.goto("about:blank");
	await startTurnProbe(page, "toolbar");
	const initial = await page.evaluate(() => document.visibilityState);
	await page.evaluate(() => {
		for (const state of ["hidden", "visible"]) {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: state,
			});
			document.dispatchEvent(new Event("visibilitychange"));
		}
		Reflect.set(window, "__visibilityControl", window.__seferTurns);
	});
	const samples = await stopTurnProbe(page);
	expect(samples.visibility?.started).toBe(initial);
	expect(samples.visibility?.stopped).toBe("visible");
	expect(samples.visibility?.changes.map((change) => change.state)).toEqual([
		"hidden",
		"visible",
	]);
	expect(samples.visibility?.changes.every((change) => change.at > 0)).toBe(
		true,
	);
	const retainedChanges = await page.evaluate(() => {
		document.dispatchEvent(new Event("visibilitychange"));
		return Reflect.get(window, "__visibilityControl").visibilityChanges.length;
	});
	expect(retainedChanges).toBe(2);
});

for (const stallPhase of ["input", "animation"] as const) {
	test(
		stallPhase === "input"
			? "turn probe detects an injected second-turn stall"
			: "turn probe detects an injected second-turn animation stall",
		async ({ page, isMobile }, testInfo) => {
			test.skip(isMobile, "Desktop regression probe control");
			await page.route("**/929/125?book", (route) =>
				route.fulfill({
					status: 200,
					contentType: "text/html",
					body: '<style>.page--flipping{transform:translateX(2px)}</style><button class="flipbook-toolbar-next">Next</button><div class="he-book"><div class="page current-page"><div class="flipbook-page-content">Front</div></div><div class="page current-page"><div class="flipbook-page-content">Back</div></div></div>',
				}),
			);
			await page.goto("/929/125?book", { waitUntil: "load" });
			// A minimal control isolates the probe from app code. Native clicks still
			// carry real browser timestamps; the second handler deliberately blocks.
			await page.evaluate((phase) => {
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
				const block = () => {
					const end = performance.now() + 250;
					while (performance.now() < end) {
						/* deliberate positive control */
					}
				};
				document.querySelector("button")?.addEventListener("click", () => {
					const turn = () => {
						if (count === 1 && phase === "animation") block();
						document.querySelector(".page")?.classList.add("page--flipping");
						count++;
						history.replaceState(null, "", `/929/${300 + count}?book`);
						requestAnimationFrame(() =>
							requestAnimationFrame(() =>
								document
									.querySelector(".page")
									?.classList.remove("page--flipping"),
							),
						);
					};
					if (count === 1 && phase === "input") block();
					if (count === 1 && phase === "animation") requestAnimationFrame(turn);
					else turn();
				});
			}, stallPhase);
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
				const serialization = { duringTiming: 0, total: 0 };
				Object.defineProperty(window, "__seferDiagnosticSerialization", {
					value: serialization,
					configurable: true,
				});
			});
			await startTurnProbe(page, "toolbar");
			await page.evaluate(() => {
				// Native long-frame delivery is optional. These labelled diagnostic
				// stubs exercise export ordering without requiring a browser entry.
				const serialization = Reflect.get(
					window,
					"__seferDiagnosticSerialization",
				);
				for (const name of [
					"serialization-control:a",
					"serialization-control:b",
				]) {
					const startTime = performance.now();
					window.__seferTurns?.recordLongFrames([
						{
							name,
							entryType: "serialization-control",
							startTime,
							duration: 1,
							toJSON() {
								serialization.total++;
								if (window.__seferTurns) serialization.duringTiming++;
								return {
									name,
									entryType: "serialization-control",
									startTime,
									duration: 1,
									blockingDuration: 0,
									firstUIEventTimestamp: 0,
									renderStart: 0,
									styleAndLayoutStart: 0,
									scripts: [],
								};
							},
						} as PerformanceEntry,
					]);
				}
			});
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
			const serialization = (await page.evaluate(() =>
				Reflect.get(window, "__seferDiagnosticSerialization"),
			)) as { duringTiming: number; total: number };
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
			if (stallPhase === "animation")
				expect(
					turnBlockingBudgetFailures(
						reduceTurnBlockingSamples(samples, 300, 2),
					).some((failure) => failure.startsWith("consecutive turns/")),
				).toBe(true);
			expect(serialization.duringTiming).toBe(0);
			expect(serialization.total).toBe(2);
			expect(
				samples.longAnimationFrames?.filter((frame) => frame.duration === 1),
			).toHaveLength(2);
		},
	);
}
