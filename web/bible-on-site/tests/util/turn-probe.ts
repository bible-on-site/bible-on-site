import type { Page } from "@playwright/test";
import type {
	TurnInput,
	TurnLongAnimationFrame,
	TurnSamples,
} from "./turn-metrics";

declare global {
	interface Window {
		__seferTurns?: {
			inputs: TurnInput[];
			frames: number[];
			repeatedFrameTimestamps: number[];
			startedAt: number;
			stoppedAt: number | undefined;
			longAnimationFramesSupported: boolean;
			longAnimationFrames: TurnLongAnimationFrame[];
			observer: PerformanceObserver | undefined;
			recordLongFrames: (entries: PerformanceEntry[]) => void;
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
			repeatedFrameTimestamps: [] as number[],
			startedAt: performance.now(),
			stoppedAt: undefined as number | undefined,
			longAnimationFramesSupported:
				PerformanceObserver.supportedEntryTypes.includes(
					"long-animation-frame",
				),
			longAnimationFrames: [] as TurnLongAnimationFrame[],
			observer: undefined as PerformanceObserver | undefined,
			recordLongFrames: (entries: PerformanceEntry[]): void => {
				for (const entry of entries) {
					if (
						entry.startTime + entry.duration > probe.startedAt &&
						entry.startTime < (probe.stoppedAt ?? Infinity)
					) {
						probe.longAnimationFrames.push(entry.toJSON());
					}
				}
			},
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
		// Browser-produced records explain a slow CI frame without tracing,
		// polling layout, or adding synchronous work to each animation frame.
		if (probe.longAnimationFramesSupported) {
			probe.observer = new PerformanceObserver((entries) =>
				probe.recordLongFrames(entries.getEntries()),
			);
			probe.observer.observe({ type: "long-animation-frame", buffered: true });
		}
		document.addEventListener(probe.eventType, probe.listener, true);
		let previous: number | null = null;
		const tick = (now: number) => {
			if (window.__seferTurns !== probe) return;
			if (previous !== null) {
				// Multiple callbacks can describe the same render opportunity.
				// Keep that evidence separately; the next distinct timestamp still
				// measures the full gap, including any blocked time.
				if (now === previous) probe.repeatedFrameTimestamps.push(now);
				else if (probe.inputs.length > 0) probe.frames.push(now - previous);
			}
			previous = now;
			const input = probe.inputs.at(-1);
			if (
				input &&
				input.firstMotion === null &&
				document.querySelector(".he-book .page--flipping")
			) {
				// rAF's supplied timestamp is the scheduled frame start, which can
				// precede an input handled in that frame. Record observation times
				// on the same performance clock as native event timestamps instead.
				input.firstMotion = performance.now();
				requestAnimationFrame(() => {
					input.responseFrame = performance.now();
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
		probe.stoppedAt = performance.now();
		window.__seferTurns = undefined;
		cancelAnimationFrame(probe.raf);
		document.removeEventListener(probe.eventType, probe.listener, true);
		if (probe.observer) {
			probe.recordLongFrames(probe.observer.takeRecords());
			probe.observer.disconnect();
		}
		return {
			inputs: probe.inputs,
			frames: probe.frames,
			repeatedFrameTimestamps: probe.repeatedFrameTimestamps,
			longAnimationFramesSupported: probe.longAnimationFramesSupported,
			longAnimationFrames: probe.longAnimationFrames,
		};
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

export async function waitForTurnCommit(page: Page, target: number) {
	await page.waitForFunction(
		(chapter) => {
			if (
				Number(location.pathname.split("/").at(-1)) !== chapter ||
				document.querySelector(".he-book .page--flipping") ||
				typeof window.__seferTurns?.inputs.at(-1)?.responseFrame !== "number"
			)
				return false;
			const current = Array.from(
				document.querySelectorAll(".he-book .page.current-page"),
			);
			return (
				current.length === 2 &&
				current.every((page) => {
					const content = page.querySelector(".flipbook-page-content");
					return content?.textContent?.trim();
				})
			);
		},
		target,
		{ timeout: 5_000, polling: "raf" },
	);
}

/** Runs in the page; opacity/visibility hiding must not qualify as readable text. */
export function turnContentIsVisible() {
	if (window.__seferTurns) {
		throw new Error("Check visible content outside the turn timing window");
	}
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
				}) && !!content.textContent?.trim()
			);
		})
	);
}

/** Rendering assertions stay outside the cadence probe's critical path. */
export async function waitForVisibleTurnContent(page: Page) {
	await page.waitForFunction(turnContentIsVisible, null, {
		timeout: 5_000,
		polling: "raf",
	});
}
