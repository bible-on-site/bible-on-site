import type { Page } from "@playwright/test";
import type { TurnInput, TurnSamples } from "./turn-metrics";

declare global {
	interface Window {
		__seferTurns?: {
			inputs: TurnInput[];
			frames: number[];
			raf: number;
			listener: (event: Event) => void;
			eventType: string;
		};
	}
}

/** Capture trusted input timestamps before the app's handler and the first
 * subsequent render opportunity with motion. This is not an INP measurement.
 */
export async function startTurnProbe(page: Page, gesture: "drag" | "toolbar") {
	await page.evaluate((inputGesture) => {
		if (window.__seferTurns) throw new Error("Turn probe already running");
		const probe = {
			inputs: [] as TurnInput[],
			frames: [] as number[],
			raf: 0,
			eventType: inputGesture === "drag" ? "pointerdown" : "click",
			listener: (event: Event) => {
				const selector =
					inputGesture === "drag"
						? ".he-book .page"
						: "button.flipbook-toolbar-next";
				if (
					!(event.target instanceof Element) ||
					!event.target.closest(selector)
				)
					return;
				probe.inputs.push({
					at: event.timeStamp,
					trusted: event.isTrusted,
					chapter: Number(location.pathname.split("/").at(-1)),
					firstMotion: null,
					responseFrame: null,
					settled: null,
					frameStart: probe.frames.length,
					frameEnd: null,
				});
			},
		};
		window.__seferTurns = probe;
		document.addEventListener(probe.eventType, probe.listener, true);
		let previous: number | null = null;
		const tick = (now: number) => {
			if (window.__seferTurns !== probe) return;
			if (previous !== null) probe.frames.push(now - previous);
			previous = now;
			const input = probe.inputs.at(-1);
			if (
				input &&
				input.firstMotion === null &&
				document.querySelector(".he-book .page--flipping")
			) {
				input.firstMotion = now;
				requestAnimationFrame((next) => {
					input.responseFrame = next;
				});
			}
			probe.raf = requestAnimationFrame(tick);
		};
		probe.raf = requestAnimationFrame(tick);
	}, gesture);
}

export async function stopTurnProbe(page: Page): Promise<TurnSamples> {
	return page.evaluate(() => {
		const probe = window.__seferTurns;
		if (!probe) throw new Error("Turn probe missing");
		window.__seferTurns = undefined;
		cancelAnimationFrame(probe.raf);
		document.removeEventListener(probe.eventType, probe.listener, true);
		return { inputs: probe.inputs, frames: probe.frames };
	});
}

export async function markTurnSettled(page: Page) {
	await page.evaluate(() => {
		const input = window.__seferTurns?.inputs.at(-1);
		if (!input) throw new Error("Completed turn has no trusted input");
		input.settled = performance.now();
		input.frameEnd = window.__seferTurns?.frames.length ?? null;
	});
}
