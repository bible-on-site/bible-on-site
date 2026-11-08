/**
 * @jest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import {
	STATS_ANIMATION_DURATION_SECONDS,
	StatsCounters,
} from "@/app/components/StatsCounters";

const STATS = [
	{ label: "רבנים כותבים על הפרק", text: "עשרות" },
	{ label: "מאמרים על הפרק", value: 4 },
	{ label: "ערכים על הפרק בתנכפדיה", value: 1250 },
];

const LINKED = [
	{ label: "רבנים כותבים על הפרק", text: "עשרות", href: "/929/authors" },
	{ label: "ערכים על הפרק בתנכפדיה", value: 1250, href: "/pedia" },
];

const FINALS = ["עשרות", "4", "1,250"];

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

const animatedValues = () =>
	Array.from(document.querySelectorAll('[aria-hidden="true"]')).map(
		(el) => el.textContent,
	);

const wordElement = () =>
	// biome-ignore lint/style/noNonNullAssertion: the label is rendered
	screen
		.getByText("רבנים כותבים על הפרק")
		.closest("div")!
		.querySelector("dd [aria-hidden]")!;

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
		for (const [i, { label }] of STATS.entries()) {
			// biome-ignore lint/style/noNonNullAssertion: the label is rendered by the component
			const stat = screen.getByText(label).closest("div")!;
			expect(stat.textContent).toContain(FINALS[i]);
		}
	});

	describe("without IntersectionObserver", () => {
		it("shows the final totals with no animation", () => {
			render(<StatsCounters stats={STATS} />);
			expect(animatedValues()).toEqual(FINALS);
		});

		it("keeps the fixed word revealed", () => {
			render(<StatsCounters stats={STATS} />);
			expect(wordElement().className).not.toMatch(/wordHidden/);
		});
	});

	describe("with IntersectionObserver", () => {
		beforeEach(installIntersectionObserver);

		it("resets numeric counters to zero until the section enters the viewport", () => {
			render(<StatsCounters stats={STATS} />);
			expect(animatedValues()).toEqual(["עשרות", "0", "0"]);
		});

		it("ignores a non-intersecting entry and keeps the zeros and hidden word", () => {
			render(<StatsCounters stats={STATS} />);
			act(() => {
				ioCallback([{ isIntersecting: false }]);
			});
			expect(animatedValues()).toEqual(["עשרות", "0", "0"]);
			expect(wordElement().className).toMatch(/wordHidden/);
		});

		it("hides the word until the same viewport trigger reveals it", () => {
			render(<StatsCounters stats={STATS} />);
			expect(wordElement().className).toMatch(/wordHidden/);
			triggerIntersection();
			expect(wordElement().className).not.toMatch(/wordHidden/);
			// The word itself never passes through numeric values.
			expect(wordElement().textContent).toBe("עשרות");
		});

		it("animates every counter from 0 to its target over one shared duration", () => {
			render(<StatsCounters stats={STATS} />);
			triggerIntersection();
			step(STATS_ANIMATION_DURATION_SECONDS * 500);
			for (const [i, stat] of STATS.entries()) {
				if (!("value" in stat)) continue;
				const shown = Number(animatedValues()[i]?.replace(/[^\d]/g, "") ?? "");
				expect(shown).toBeGreaterThan(0);
				expect(shown).toBeLessThanOrEqual(stat.value ?? 0);
			}
			step(STATS_ANIMATION_DURATION_SECONDS * 500);
			step(200); // settle margin: the eased tail must land exactly on target
			expect(animatedValues()).toEqual(FINALS);
		});

		it("never overshoots and keeps the totals after a later entry", () => {
			render(<StatsCounters stats={STATS} />);
			triggerIntersection();
			step(STATS_ANIMATION_DURATION_SECONDS * 10_000);
			expect(animatedValues()).toEqual(FINALS);
			expect(disconnectCalls).toBeGreaterThan(0);
			triggerIntersection();
			expect(animatedValues()).toEqual(FINALS);
		});

		it("restarts the count when the stats change", () => {
			const { rerender } = render(<StatsCounters stats={STATS} />);
			triggerIntersection();
			step(STATS_ANIMATION_DURATION_SECONDS * 10_000);
			rerender(
				<StatsCounters stats={[...STATS, { label: "חדש", value: 7 }]} />,
			);
			// New totals re-enter the animation; settled values reset to zero.
			expect(animatedValues()).toEqual(["עשרות", "0", "0", "0"]);
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

	describe("linked counters", () => {
		it("names each tile link after its label plus the displayed value", () => {
			render(<StatsCounters stats={LINKED} />);

			const rabbis = screen.getByRole("link", {
				name: "רבנים כותבים על הפרק: עשרות",
			});
			expect(rabbis).toHaveAttribute("href", "/929/authors");
			const pedia = screen.getByRole("link", {
				name: "ערכים על הפרק בתנכפדיה: 1,250",
			});
			expect(pedia).toHaveAttribute("href", "/pedia");
		});

		it("keeps each link's accessible name in sync with the count-up", () => {
			installIntersectionObserver();
			render(<StatsCounters stats={LINKED} />);

			// Pre-trigger the tile shows 0 and the name announces 0 — axe's
			// label-content-name rule requires the visible digit inside the name.
			const pedia = () =>
				screen.getByRole("link", { name: /ערכים על הפרק בתנכפדיה/ });
			expect(pedia()).toHaveAccessibleName("ערכים על הפרק בתנכפדיה: 0");
			triggerIntersection();
			step(STATS_ANIMATION_DURATION_SECONDS * 10_000);
			expect(pedia()).toHaveAccessibleName("ערכים על הפרק בתנכפדיה: 1,250");
		});

		it("applies the hidden-word entrance on linked text counters too", () => {
			installIntersectionObserver();
			render(<StatsCounters stats={LINKED} />);

			const rabbis = screen.getByRole("link", { name: /רבנים/ });
			const word = rabbis.querySelector("[aria-hidden]");
			expect(word?.className).toMatch(/wordHidden/);
			triggerIntersection();
			expect(word?.className).not.toMatch(/wordHidden/);
		});

		it("covers a linked stat added before the totals reset", () => {
			installIntersectionObserver();
			const { rerender } = render(<StatsCounters stats={LINKED} />);
			rerender(
				<StatsCounters
					stats={[...LINKED, { label: "חדש", value: 7, href: "/x" }]}
				/>,
			);
			// The effect resets the new tile to 0 — between render and reset the
			// displayed fallback (?? stat.value) keeps the link name valid.
			expect(screen.getByRole("link", { name: "חדש: 0" })).toBeInTheDocument();
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
			expect(animatedValues()).toEqual(FINALS);
			expect(wordElement().className).not.toMatch(/wordHidden/);
		});
	});
});
