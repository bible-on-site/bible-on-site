/**
 * @jest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import {
	STATS_ANIMATION_DURATION_SECONDS,
	StatsCounters,
} from "@/app/components/StatsCounters";

const STATS = [
	{ label: "רבנים כותבים על הפרק", value: 3 },
	{ label: "מאמרים על הפרק", value: 4 },
	{ label: "ערכים על הפרק בתנכפדיה", value: 1250 },
];

type IOCallback = (entries: { isIntersecting: boolean }[]) => void;

let ioCallback: IOCallback;
let disconnectCalls: number;
let now: number;
let rafQueue: FrameRequestCallback[];

const installIntersectionObserver = () => {
	ioCallback = () => {};
	disconnectCalls = 0;
	class MockIO {
		constructor(cb: IntersectionObserverCallback) {
			ioCallback = cb as IOCallback;
		}
		observe() {}
		unobserve() {}
		disconnect() {
			disconnectCalls += 1;
		}
	}
	Object.defineProperty(window, "IntersectionObserver", {
		configurable: true,
		writable: true,
		value: MockIO,
	});
};

/** Advance the fake clock by `ms` and run every queued rAF callback. */
const step = (ms: number) => {
	now += ms;
	const queue = rafQueue;
	rafQueue = [];
	act(() => {
		for (const cb of queue) cb(now);
	});
};

const triggerIntersection = () => {
	act(() => {
		ioCallback([{ isIntersecting: true }]);
	});
};

const animatedNumbers = () =>
	Array.from(document.querySelectorAll('[aria-hidden="true"]')).map(
		(el) => el.textContent,
	);

const formatted = (n: number) => n.toLocaleString("he-IL");

beforeEach(() => {
	now = 0;
	rafQueue = [];
	jest.spyOn(performance, "now").mockImplementation(() => now);
	jest
		.spyOn(window, "requestAnimationFrame")
		.mockImplementation((cb: FrameRequestCallback) => {
			rafQueue.push(cb);
			return rafQueue.length;
		});
	jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
	delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe("StatsCounters", () => {
	it("keeps the real totals accessible and renders one counter per stat", () => {
		render(<StatsCounters stats={STATS} />);
		for (const { label, value } of STATS) {
			// biome-ignore lint/style/noNonNullAssertion: the label is rendered by the component
			const stat = screen.getByText(label).closest("div")!;
			expect(stat.textContent).toContain(formatted(value));
		}
	});

	describe("without IntersectionObserver", () => {
		it("shows the final totals with no animation", () => {
			render(<StatsCounters stats={STATS} />);
			expect(animatedNumbers()).toEqual(STATS.map((s) => formatted(s.value)));
		});
	});

	describe("with IntersectionObserver", () => {
		beforeEach(installIntersectionObserver);

		it("resets to zero until the section enters the viewport", () => {
			render(<StatsCounters stats={STATS} />);
			expect(animatedNumbers()).toEqual(["0", "0", "0"]);
		});

		it("animates every counter from 0 to its target over one shared duration", () => {
			render(<StatsCounters stats={STATS} />);
			triggerIntersection();
			step(STATS_ANIMATION_DURATION_SECONDS * 500);
			for (const [i, { value }] of STATS.entries()) {
				const shown = Number(animatedNumbers()[i]?.replace(/[^\d]/g, ""));
				expect(shown).toBeGreaterThan(0);
				expect(shown).toBeLessThanOrEqual(value);
			}
			step(STATS_ANIMATION_DURATION_SECONDS * 500);
			step(200); // settle margin: the eased tail must land exactly on target
			expect(animatedNumbers()).toEqual(STATS.map((s) => formatted(s.value)));
		});

		it("never overshoots and keeps the totals after a later entry", () => {
			render(<StatsCounters stats={STATS} />);
			triggerIntersection();
			step(STATS_ANIMATION_DURATION_SECONDS * 10_000);
			expect(animatedNumbers()).toEqual(STATS.map((s) => formatted(s.value)));
			expect(disconnectCalls).toBeGreaterThan(0);
			triggerIntersection();
			expect(animatedNumbers()).toEqual(STATS.map((s) => formatted(s.value)));
		});

		it("cancels pending animation work on unmount", () => {
			const { unmount } = render(<StatsCounters stats={STATS} />);
			triggerIntersection();
			unmount();
			expect(window.cancelAnimationFrame).toHaveBeenCalled();
			expect(disconnectCalls).toBeGreaterThan(0);
			step(STATS_ANIMATION_DURATION_SECONDS * 10_000);
		});
	});

	describe("with prefers-reduced-motion", () => {
		beforeEach(() => {
			installIntersectionObserver();
			Object.defineProperty(window, "matchMedia", {
				configurable: true,
				writable: true,
				value: () => ({ matches: true }),
			});
		});

		it("shows the final totals without counting", () => {
			render(<StatsCounters stats={STATS} />);
			expect(animatedNumbers()).toEqual(STATS.map((s) => formatted(s.value)));
		});
	});
});
