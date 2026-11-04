import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, CDPSession, Page } from "@playwright/test";
import {
	dispatchTurnInput,
	prepareTurnInput,
	type TurnGesture,
	type TurnInputPoint,
} from "./turn-input";
import {
	markTurnSettled,
	startTurnProbe,
	stopTurnProbe,
	waitForTurnCommit,
	waitForVisibleTurnContent,
} from "./turn-probe";

/** The qualification and diagnostic runs exercise the same native inputs. */
export async function exerciseConsecutiveTurns(
	page: Page,
	client: CDPSession,
	gesture: TurnGesture,
	point: TurnInputPoint,
	chapter: number,
) {
	// Immediate handoffs plus the existing 80ms buffer recenter window.
	for (const [index, gap] of [0, 0, 100, 0, 100, 0].entries()) {
		if (gap) await page.waitForTimeout(gap);
		await dispatchTurnInput(client, gesture, point);
		await waitForTurnCommit(page, chapter + index + 1);
		await markTurnSettled(page);
	}
	await page.waitForTimeout(200);
}

/** Profile a separate sequence only after the original measurement fails.
 * Its results never replace the original samples or make the timing gate pass.
 */
export async function captureTurnFailureTrace(
	page: Page,
	browser: Browser,
	chapter: number,
	mode: "leaf" | "pinned" | "hidden",
	gesture: TurnGesture,
) {
	const directory = ".playwright-report/perf/diagnostics/sefer-turn-traces";
	const basename = `${directory}/${chapter}-${mode}-${gesture}`;
	await mkdir(directory, { recursive: true });
	await page.goto(`/929/${chapter}?book`, { waitUntil: "load" });
	await waitForVisibleTurnContent(page);
	await page.waitForFunction(
		() =>
			!document.querySelector(".he-book .page--flipping") &&
			document.querySelector<HTMLButtonElement>("button.flipbook-toolbar-next")
				?.disabled === false,
		null,
		{ timeout: 5_000 },
	);
	const point = await prepareTurnInput(page, gesture);
	const client = await page.context().newCDPSession(page);
	const tracing = await browser.newBrowserCDPSession();
	const complete = new Promise<{ stream?: string }>((resolve) =>
		tracing.once("Tracing.tracingComplete", resolve),
	);
	let traceActive = false;
	try {
		await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
		await client.send("Profiler.enable");
		await client.send("Profiler.setSamplingInterval", { interval: 1_000 });
		await client.send("Profiler.start");
		await tracing.send("Tracing.start", {
			categories: "toplevel,devtools.timeline,blink.user_timing",
			transferMode: "ReturnAsStream",
		});
		traceActive = true;
		await page.evaluate(() => performance.mark("sefer-diagnostic:begin"));
		await startTurnProbe(page, gesture);
		try {
			await exerciseConsecutiveTurns(page, client, gesture, point, chapter);
		} finally {
			const samples = await stopTurnProbe(page);
			await page.evaluate(() => performance.mark("sefer-diagnostic:end"));
			const { profile } = await client.send("Profiler.stop");
			await client.send("Profiler.disable");
			await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
			await writeFile(`${basename}.cpu.json`, JSON.stringify(profile));
			await writeFile(
				`${basename}.samples.json`,
				JSON.stringify({
					kind: "diagnostic-only-after-failure",
					qualificationSamples: `../sefer-turns/${chapter}-${mode}-${gesture}.json`,
					sourceCommit:
						process.env.GITHUB_SHA ?? process.env.SEFER_VALIDATED_HEAD,
					browser: browser.version(),
					chapter,
					mode,
					gesture,
					cpuRate: 4,
					samples,
				}),
			);
			await tracing.send("Tracing.end");
			traceActive = false;
			const { stream } = await complete;
			if (!stream) {
				await writeFile(
					`${basename}.trace-error.txt`,
					"Chromium returned no diagnostic trace stream",
				);
			} else {
				try {
					const chunks: Buffer[] = [];
					for (;;) {
						const chunk = await tracing.send("IO.read", { handle: stream });
						chunks.push(
							Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"),
						);
						if (chunk.eof) break;
					}
					await writeFile(`${basename}.trace.json`, Buffer.concat(chunks));
				} finally {
					await tracing.send("IO.close", { handle: stream });
				}
			}
		}
	} finally {
		if (traceActive) {
			await Promise.allSettled([tracing.send("Tracing.end")]);
		}
		await Promise.allSettled([
			client.send("Emulation.setCPUThrottlingRate", { rate: 1 }),
			client.send("Profiler.disable"),
		]);
		await Promise.allSettled([tracing.detach(), client.detach()]);
	}
}
