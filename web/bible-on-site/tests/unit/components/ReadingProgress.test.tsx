/**
 * Component tests for ReadingProgress (#2607): rendering contract, the
 * scroll-paint path against stubbed jsdom geometry, keyed vs positional
 * unit location, document vs element scrollers, and listener cleanup.
 */
import { act, render } from "@testing-library/react";
import type React from "react";
import {
	READING_PROGRESS_LABEL,
	ReadingProgress,
} from "../../../src/app/components/ReadingProgress";
import type { ReadingProgressUnit } from "../../../src/lib/reading-metrics/types";

/** Fixture copy — referenced via expressions so JSX holds no literal text. */
const T = {
	unitA: "מילים יחידה א",
	unitB: "מילים יחידה ב",
	first: "קטע ראשון",
	second: "קטע שני",
	third: "קטע שלישי",
	scoped: "מילים בטווח",
	other: "מילים אחרות",
	words: "מילים",
} as const;

const rect = (top: number, height: number): DOMRect =>
	({
		top,
		bottom: top + height,
		left: 0,
		right: 100,
		width: 100,
		height,
		x: 0,
		y: top,
		toJSON: () => ({}),
	}) as DOMRect;

/**
 * Stubbed layout: each element's base top in *scroll-content* space.
 * Served client rects subtract the scroll container's scrollTop, exactly
 * like real layout — so toContentY maps them back to a stable content
 * axis and scrolling does not register as layout drift.
 */
let elRects = new Map<Element, { top: number; height: number }>();
let scrollEl: Element | null = null;

const setRect = (el: Element, top: number, height: number) => {
	elRects.set(el, { top, height });
};

const scrollShift = (el: Element | null): number =>
	el && scrollEl && scrollEl !== el && scrollEl.contains(el)
		? Number(scrollEl.scrollTop)
		: 0;

const setScroller = (
	el: Element,
	{ scrollTop = 0, scrollHeight = 1000, clientHeight = 200 } = {},
) => {
	scrollEl = el;
	for (const [key, value] of Object.entries({
		scrollTop,
		scrollHeight,
		clientHeight,
	})) {
		Object.defineProperty(el, key, { value, configurable: true });
	}
};

/** Rects each range resolves to, keyed by its commonAncestorContainer. */
let rangeLines = new Map<Node, { top: number; height: number }[]>();
let rangeRect = new Map<Node, { top: number; height: number }>();

const rangeHost = (range: Range): Element | null =>
	range.commonAncestorContainer instanceof Element
		? range.commonAncestorContainer
		: range.commonAncestorContainer.parentElement;

let rafQueue: FrameRequestCallback[] = [];
const flushRaf = async () => {
	const queue = rafQueue;
	rafQueue = [];
	for (const cb of queue) cb(0);
};

const unit = (key: string | null, wordCount: number): ReadingProgressUnit => ({
	key,
	wordCount,
	cumulativeWords: 0,
});

/** Trigger the effect's re-measure after stubbing geometry. */
const remeasure = async () => {
	await act(async () => {
		window.dispatchEvent(new Event("resize"));
	});
};

const scroll = async (scroller: Element, scrollTop: number) => {
	await act(async () => {
		setScroller(scroller, { scrollTop });
		scroller.dispatchEvent(new Event("scroll"));
	});
	await act(flushRaf);
};

const renderInScroller = (ui: React.ReactElement) =>
	render(
		<div className="scroll">
			{ui}
			<div className="content">
				<div data-u="a">{T.unitA}</div>
				<div data-u="b">{T.unitB}</div>
			</div>
		</div>,
	);

beforeEach(() => {
	jest.restoreAllMocks();
	elRects = new Map();
	scrollEl = null;
	rangeLines = new Map();
	rangeRect = new Map();
	rafQueue = [];
	global.requestAnimationFrame = (cb: FrameRequestCallback) => {
		rafQueue.push(cb);
		return rafQueue.length;
	};
	global.cancelAnimationFrame = jest.fn();
	global.ResizeObserver = jest.fn(() => ({
		observe: jest.fn(),
		unobserve: jest.fn(),
		disconnect: jest.fn(),
	})) as unknown as typeof ResizeObserver;
	jest
		.spyOn(Element.prototype, "getBoundingClientRect")
		.mockImplementation(function (this: Element) {
			const e = elRects.get(this);
			if (!e) return rect(0, 0);
			return rect(e.top - scrollShift(this), e.height);
		});
	// jsdom does not implement Range layout methods — define them outright
	// (jest.spyOn needs an existing property). jsdom is per-suite, so the
	// assignment cannot leak into other test files.
	Range.prototype.getBoundingClientRect = function (this: Range) {
		const e = rangeRect.get(this.commonAncestorContainer);
		if (!e) return rect(0, 0);
		return rect(e.top - scrollShift(rangeHost(this)), e.height);
	};
	Range.prototype.getClientRects = function (this: Range) {
		const lines = rangeLines.get(this.commonAncestorContainer) ?? [];
		const shift = scrollShift(rangeHost(this));
		return lines.map((l) =>
			rect(l.top - shift, l.height),
		) as unknown as DOMRectList;
	};
});

describe("ReadingProgress", () => {
	it("renders nothing when no units are stored", () => {
		const { container } = render(
			<ReadingProgress units={[]} content=".content" />,
		);
		expect(container.firstChild).toBeNull();
		expect(document.querySelector('[role="progressbar"]')).toBeNull();
	});

	it("honours stickyTop and className on the track", () => {
		const { container } = render(
			<ReadingProgress
				units={[unit(null, 5)]}
				content=".content"
				stickyTop="72px"
				className="extra"
			/>,
		);
		const track = container.firstElementChild as HTMLElement;
		expect(track.style.top).toBe("72px");
		expect(track.className).toContain("extra");
	});

	it("paints counted-word progress from the element scroller position", async () => {
		const units = [unit("a", 40), unit("b", 60)];
		const { container } = renderInScroller(
			<ReadingProgress
				units={units}
				scroller=".scroll"
				content=".content"
				unitSelector='[data-u="{key}"]'
			/>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const a = container.querySelector('[data-u="a"]') as Element;
		const b = container.querySelector('[data-u="b"]') as Element;
		setRect(content, 0, 200);
		setRect(a, 0, 100);
		setRect(b, 100, 100);
		// A zero-size line rect is skipped by the line filter.
		rangeLines.set(a, [{ top: 0, height: 50 }, { top: 50, height: 50 }, { top: 0, height: 0 }]);
		rangeLines.set(b, [{ top: 100, height: 50 }, { top: 150, height: 50 }]);
		setScroller(scroller);
		await remeasure();

		const bar = container.querySelector('[role="progressbar"]');
		const fill = bar?.firstElementChild as HTMLElement;
		expect(bar?.getAttribute("aria-label")).toBe(READING_PROGRESS_LABEL);
		expect(bar?.getAttribute("aria-valuemin")).toBe("0");
		expect(bar?.getAttribute("aria-valuemax")).toBe("100");

		// scrollTop 400 of range 800 → half the content extent → anchor 100:
		// unit a (40 words) fully read, unit b's first line at its top edge
		// → 40/100 words.
		await scroll(scroller, 400);
		expect(fill.style.width).toBe("40%");
		expect(bar?.getAttribute("aria-valuenow")).toBe("40");

		// Back-scrolling lowers the position — not a completion record.
		await scroll(scroller, 0);
		expect(fill.style.width).toBe("0%");

		// Fully scrolled → every counted word passed.
		await scroll(scroller, 800);
		expect(fill.style.width).toBe("100%");
	});

	it("treats a missing keyed element as a zero-height unit", async () => {
		const units = [unit("gone", 50), unit("b", 50)];
		const { container } = renderInScroller(
			<ReadingProgress
				units={units}
				scroller=".scroll"
				content=".content"
				unitSelector='[data-u="{key}"]'
			/>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const b = container.querySelector('[data-u="b"]') as Element;
		setRect(content, 0, 100);
		setRect(b, 50, 50);
		rangeLines.set(b, [{ top: 50, height: 50 }]);
		setScroller(scroller);
		await remeasure();
		// At rest the absent unit still counts as passed — it anchored at
		// the content top — so the bar starts at 50/100 words.
		const fill = container.querySelector(
			'[role="progressbar"] > div',
		) as HTMLElement;
		expect(fill.style.width).toBe("50%");
	});

	it("splits colon keys into {k1}/{k2} selector parts", async () => {
		const { container } = render(
			<div className="scroll">
				<ReadingProgress
					units={[unit("3:1", 10)]}
					scroller=".scroll"
					content=".content"
					unitSelector='[data-pasuk="{k1}"][data-note="{k2}"]'
				/>
				<div className="content">
					<div data-pasuk="3" data-note="1">
						{T.words}
					</div>
				</div>
			</div>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const note = container.querySelector("[data-pasuk]") as Element;
		setRect(content, 0, 100);
		setRect(note, 0, 100);
		rangeLines.set(note, [{ top: 0, height: 100 }]);
		setScroller(scroller);
		await remeasure();
		await scroll(scroller, 800);
		const fill = container.querySelector(
			'[role="progressbar"] > div',
		) as HTMLElement;
		expect(fill.style.width).toBe("100%");
	});

	it("segments the content root positionally without a unitSelector", async () => {
		const { container } = render(
			<div className="scroll">
				<ReadingProgress
					units={[unit(null, 10), unit(null, 10)]}
					scroller=".scroll"
					content=".content"
				/>
				<div className="content">
					<p>{T.first}</p>
					<p>{T.second}</p>
				</div>
			</div>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const [first, second] = Array.from(content.querySelectorAll("p"));
		setRect(content, 0, 200);
		rangeRect.set(first, { top: 0, height: 100 });
		rangeRect.set(second, { top: 100, height: 100 });
		rangeLines.set(first, [{ top: 0, height: 100 }]);
		rangeLines.set(second, [{ top: 100, height: 100 }]);
		setScroller(scroller);
		await remeasure();
		// Anchor 50 → half of the first (10-word) block → 25%.
		await scroll(scroller, 200);
		const fill = container.querySelector(
			'[role="progressbar"] > div',
		) as HTMLElement;
		expect(fill.style.width).toBe("25%");
	});

	it("falls back to whole-content geometry when DOM segments diverge", async () => {
		const { container } = render(
			<div className="scroll">
				<ReadingProgress
					units={[unit(null, 10)]}
					scroller=".scroll"
					content=".content"
				/>
				<div className="content">
					<p>{T.first}</p>
					<p>{T.second}</p>
					<p>{T.third}</p>
				</div>
			</div>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		setRect(content, 0, 200);
		rangeLines.set(content, [{ top: 0, height: 100 }, { top: 100, height: 100 }]);
		setScroller(scroller);
		await remeasure();
		await scroll(scroller, 200);
		const fill = container.querySelector(
			'[role="progressbar"] > div',
		) as HTMLElement;
		expect(fill.style.width).toBe("25%");
	});

	it("scopes content lookup through the scope selector", async () => {
		const { container } = render(
			<div className="scroll">
				<div className="pane" data-view="one">
					<ReadingProgress
						units={[unit(null, 10)]}
						scroller=".scroll"
						scope='[data-view="one"]'
						content=".content"
					/>
					<div className="content">
						<p>{T.scoped}</p>
					</div>
				</div>
				<div className="pane" data-view="two">
					<div className="content">
						<p>{T.other}</p>
					</div>
				</div>
			</div>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const scoped = container.querySelector(
			'[data-view="one"] .content',
		) as Element;
		const scopedP = scoped.querySelector("p") as Element;
		setRect(scoped, 0, 100);
		rangeRect.set(scopedP, { top: 0, height: 100 });
		rangeLines.set(scopedP, [{ top: 0, height: 100 }]);
		setScroller(scroller);
		await remeasure();
		await scroll(scroller, 800);
		const fill = container.querySelector(
			'[role="progressbar"] > div',
		) as HTMLElement;
		expect(fill.style.width).toBe("100%");
	});

	it("uses the scope element itself when it matches the content selector", async () => {
		const { container } = render(
			<div className="scroll">
				<div className="content">
					<ReadingProgress
						units={[unit(null, 10)]}
						scroller=".scroll"
						scope=".content"
						content=".content"
					/>
					<p>{T.words}</p>
				</div>
			</div>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const p = content.querySelector("p") as Element;
		setRect(content, 0, 100);
		rangeRect.set(p, { top: 0, height: 100 });
		rangeLines.set(p, [{ top: 0, height: 100 }]);
		setScroller(scroller);
		await remeasure();
		expect(
			container.querySelector('[role="progressbar"]'),
		).not.toBeNull();
	});

	it("reads the document scroller when no scroller selector is given", async () => {
		render(
			<div>
				<ReadingProgress
					units={[unit("a", 10)]}
					content="html"
					unitSelector='[data-u="{key}"]'
				/>
				<div data-u="a">{T.unitA}</div>
			</div>,
		);
		const root = document.documentElement;
		const a = document.querySelector('[data-u="a"]') as Element;
		setRect(a, 400, 200);
		rangeLines.set(a, [{ top: 400, height: 200 }]);
		setScroller(root);
		await remeasure();
		// scrollTop 400 → anchor 500: half of unit a's single line.
		await act(async () => {
			setScroller(root, { scrollTop: 400 });
			document.dispatchEvent(new Event("scroll"));
		});
		await act(flushRaf);
		const bar = document.querySelector('[role="progressbar"]');
		expect(bar).not.toBeNull();
		expect(bar?.getAttribute("aria-valuenow")).toBe("50");
	});

	it("queries the document for content when no scope resolves", async () => {
		render(
			<div className="content">
				<ReadingProgress units={[unit(null, 10)]} content=".content" />
				<p>{T.words}</p>
			</div>,
		);
		const bar = document.querySelector('[role="progressbar"]');
		expect(bar).not.toBeNull();
	});

	it("renders the bar but skips wiring when content is absent", () => {
		const { container } = render(
			<div className="scroll">
				<ReadingProgress
					units={[unit(null, 10)]}
					scroller=".scroll"
					content=".does-not-exist"
				/>
			</div>,
		);
		expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
	});

	it("re-measures when the content top drifts (late images, fonts)", async () => {
		const units = [unit("a", 40), unit("b", 60)];
		const { container } = renderInScroller(
			<ReadingProgress
				units={units}
				scroller=".scroll"
				content=".content"
				unitSelector='[data-u="{key}"]'
			/>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const a = container.querySelector('[data-u="a"]') as Element;
		const b = container.querySelector('[data-u="b"]') as Element;
		setRect(content, 0, 200);
		setRect(a, 0, 100);
		setRect(b, 100, 100);
		rangeLines.set(a, [{ top: 0, height: 100 }]);
		rangeLines.set(b, [{ top: 100, height: 100 }]);
		setScroller(scroller);
		await remeasure();

		// Header grows 100px above the content: the next scroll detects the
		// drift and re-measures before painting — 0% at rest, not a stale
		// position from the pre-drift layout.
		setRect(content, 100, 200);
		setRect(a, 100, 100);
		setRect(b, 200, 100);
		rangeLines.set(a, [{ top: 100, height: 100 }]);
		rangeLines.set(b, [{ top: 200, height: 100 }]);
		await scroll(scroller, 0);
		const fill = container.querySelector(
			'[role="progressbar"] > div',
		) as HTMLElement;
		expect(fill.style.width).toBe("0%");
	});

	it("coalesces repeated scroll events into one animation frame", async () => {
		const { container } = renderInScroller(
			<ReadingProgress
				units={[unit("a", 10)]}
				scroller=".scroll"
				content=".content"
				unitSelector='[data-u="{key}"]'
			/>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const a = container.querySelector('[data-u="a"]') as Element;
		setRect(content, 0, 100);
		setRect(a, 0, 100);
		rangeLines.set(a, [{ top: 0, height: 100 }]);
		setScroller(scroller);
		await remeasure();
		await act(async () => {
			scroller.dispatchEvent(new Event("scroll"));
			scroller.dispatchEvent(new Event("scroll"));
		});
		expect(rafQueue.length).toBe(1);
		await act(flushRaf);
	});

	it("re-measures via document.fonts.ready after webfonts swap", async () => {
		Object.defineProperty(document, "fonts", {
			value: { ready: Promise.resolve() },
			configurable: true,
		});
		const { container } = renderInScroller(
			<ReadingProgress
				units={[unit("a", 10)]}
				scroller=".scroll"
				content=".content"
				unitSelector='[data-u="{key}"]'
			/>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const a = container.querySelector('[data-u="a"]') as Element;
		setRect(content, 0, 100);
		setRect(a, 0, 100);
		rangeLines.set(a, [{ top: 0, height: 100 }]);
		setScroller(scroller);
		await act(async () => {});
		expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
		delete (document as { fonts?: unknown }).fonts;
	});

	it("swallows a rejecting document.fonts.ready", async () => {
		Object.defineProperty(document, "fonts", {
			value: { ready: Promise.reject(new Error("font load failed")) },
			configurable: true,
		});
		const { container } = renderInScroller(
			<ReadingProgress
				units={[unit("a", 10)]}
				scroller=".scroll"
				content=".content"
				unitSelector='[data-u="{key}"]'
			/>,
		);
		setRect(container.querySelector(".content") as Element, 0, 100);
		setRect(container.querySelector('[data-u="a"]') as Element, 0, 100);
		rangeLines.set(container.querySelector('[data-u="a"]') as Element, [
			{ top: 0, height: 100 },
		]);
		setScroller(container.querySelector(".scroll") as Element);
		await act(async () => {});
		delete (document as { fonts?: unknown }).fonts;
	});

	it("re-measures through ResizeObserver when the content resizes", async () => {
		let resizeCallback: ResizeObserverCallback | undefined;
		global.ResizeObserver = jest.fn((cb: ResizeObserverCallback) => {
			resizeCallback = cb;
			return {
				observe: jest.fn(),
				unobserve: jest.fn(),
				disconnect: jest.fn(),
			};
		}) as unknown as typeof ResizeObserver;
		const { container } = renderInScroller(
			<ReadingProgress
				units={[unit("a", 10)]}
				scroller=".scroll"
				content=".content"
				unitSelector='[data-u="{key}"]'
			/>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const a = container.querySelector('[data-u="a"]') as Element;
		setRect(content, 0, 100);
		setRect(a, 0, 100);
		rangeLines.set(a, [{ top: 0, height: 100 }]);
		setScroller(scroller);
		await remeasure();
		await act(async () => {
			resizeCallback?.([], {} as ResizeObserver);
		});
		expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
	});

	it("falls back to documentElement when scrollingElement is absent", async () => {
		Object.defineProperty(document, "scrollingElement", {
			value: null,
			configurable: true,
		});
		render(
			<div>
				<ReadingProgress
					units={[unit("a", 10)]}
					content="html"
					unitSelector='[data-u="{key}"]'
				/>
				<div data-u="a">{T.unitA}</div>
			</div>,
		);
		const root = document.documentElement;
		const a = document.querySelector('[data-u="a"]') as Element;
		setRect(a, 400, 200);
		rangeLines.set(a, [{ top: 400, height: 200 }]);
		setScroller(root);
		await remeasure();
		expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
		delete (document as { scrollingElement?: unknown }).scrollingElement;
	});

	it("removes listeners and the observer on unmount", async () => {
		const disconnect = jest.fn();
		global.ResizeObserver = jest.fn(() => ({
			observe: jest.fn(),
			unobserve: jest.fn(),
			disconnect,
		})) as unknown as typeof ResizeObserver;
		const { container, unmount } = renderInScroller(
			<ReadingProgress
				units={[unit("a", 10)]}
				scroller=".scroll"
				content=".content"
				unitSelector='[data-u="{key}"]'
			/>,
		);
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const a = container.querySelector('[data-u="a"]') as Element;
		setRect(content, 0, 100);
		setRect(a, 0, 100);
		rangeLines.set(a, [{ top: 0, height: 100 }]);
		setScroller(scroller);
		await remeasure();
		await act(async () => {
			scroller.dispatchEvent(new Event("scroll"));
		});
		unmount();
		expect(global.cancelAnimationFrame).toHaveBeenCalled();
		expect(disconnect).toHaveBeenCalled();
		// Post-unmount scroll must not paint or throw.
		await act(async () => {
			scroller.dispatchEvent(new Event("scroll"));
		});
		await act(flushRaf);
	});

	it("re-runs the effect when the units change", async () => {
		const view = (
			units: ReadingProgressUnit[],
		): React.ReactElement => (
			<div className="scroll">
				<ReadingProgress
					units={units}
					scroller=".scroll"
					content=".content"
					unitSelector='[data-u="{key}"]'
				/>
				<div className="content">
					<div data-u="a">{T.unitA}</div>
				</div>
			</div>
		);
		const { container, rerender } = render(view([]));
		expect(container.querySelector('[role="progressbar"]')).toBeNull();
		const scroller = container.querySelector(".scroll") as Element;
		const content = container.querySelector(".content") as Element;
		const a = container.querySelector('[data-u="a"]') as Element;
		setRect(content, 0, 100);
		setRect(a, 0, 100);
		rangeLines.set(a, [{ top: 0, height: 100 }]);
		setScroller(scroller);
		rerender(view([unit("a", 10)]));
		await act(flushRaf);
		expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
	});
});
