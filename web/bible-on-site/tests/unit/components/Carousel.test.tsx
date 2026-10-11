/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { Carousel } from "../../../src/app/929/[number]/components/Carousel";

const CARD_WIDTH = 100;
const VIEWPORT_WIDTH = 250;

function rect(left: number, width: number) {
	return { left, right: left + width, width } as DOMRect;
}

/** Lays out `count` 100px cards (no gap) in a viewport scrolled by `scrollLeft`. */
function layout(
	scroller: HTMLElement,
	count: number,
	scrollLeft = 0,
	{ dir = "rtl", viewport = VIEWPORT_WIDTH } = {},
) {
	Object.defineProperties(scroller, {
		scrollWidth: { configurable: true, value: count * CARD_WIDTH },
		clientWidth: { configurable: true, value: viewport },
		scrollLeft: { configurable: true, writable: true, value: scrollLeft },
	});
	scroller.style.direction = dir;
	scroller.getBoundingClientRect = () => rect(0, viewport);
	Array.from(scroller.children).forEach((card, i) => {
		// RTL: card 1 hugs the right edge; negative scrollLeft moves cards right.
		const start =
			dir === "rtl" ? viewport - (i + 1) * CARD_WIDTH : i * CARD_WIDTH;
		card.getBoundingClientRect = () =>
			rect(start - scroller.scrollLeft, CARD_WIDTH);
	});
}

function renderCarousel(count: number) {
	const { container } = render(
		<div dir="rtl">
			<Carousel className="track" prevLabel="פרשן קודם" nextLabel="פרשן הבא">
				{Array.from({ length: count }, (_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static test cards
					<a key={i} href={`#${i}`}>
						{i}
					</a>
				))}
			</Carousel>
		</div>,
	);
	return container.querySelector(".track") as HTMLElement;
}

describe("Carousel", () => {
	it("hides the controls while every card fits", () => {
		renderCarousel(2);
		expect(screen.queryByRole("button", { name: "פרשן הבא" })).toBeNull();
		expect(screen.queryByTestId("carousel-position")).toBeNull();
	});

	it("shows controls and position when cards overflow, prev disabled at start", () => {
		const scroller = renderCarousel(5);
		layout(scroller, 5);
		fireEvent.scroll(scroller);

		expect(screen.getByRole("button", { name: "פרשן קודם" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "פרשן הבא" })).toBeEnabled();
		expect(screen.getByTestId("carousel-position")).toHaveTextContent(
			"1-2 / 5",
		);
	});

	it("scrolls one card per click, negative left toward the RTL end", () => {
		const scroller = renderCarousel(5);
		layout(scroller, 5, -CARD_WIDTH);
		scroller.scrollBy = jest.fn();
		fireEvent.scroll(scroller);

		fireEvent.click(screen.getByRole("button", { name: "פרשן הבא" }));
		expect(scroller.scrollBy).toHaveBeenCalledWith(
			expect.objectContaining({ left: -CARD_WIDTH }),
		);

		fireEvent.click(screen.getByRole("button", { name: "פרשן קודם" }));
		expect(scroller.scrollBy).toHaveBeenLastCalledWith(
			expect.objectContaining({ left: CARD_WIDTH }),
		);
	});

	it("disables next at the end and updates the position", () => {
		const scroller = renderCarousel(5);
		layout(scroller, 5, -(5 * CARD_WIDTH - VIEWPORT_WIDTH));
		fireEvent.scroll(scroller);

		expect(screen.getByRole("button", { name: "פרשן הבא" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "פרשן קודם" })).toBeEnabled();
		expect(screen.getByTestId("carousel-position")).toHaveTextContent(
			"4-5 / 5",
		);
	});

	it("prev from the end aligns the partially hidden card instead of skipping it", () => {
		const scroller = renderCarousel(5);
		// End position: card 3 is half hidden, cards 4-5 fully visible.
		layout(scroller, 5, -(5 * CARD_WIDTH - VIEWPORT_WIDTH));
		scroller.scrollBy = jest.fn();
		fireEvent.scroll(scroller);

		fireEvent.click(screen.getByRole("button", { name: "פרשן קודם" }));
		expect(scroller.scrollBy).toHaveBeenCalledWith(
			expect.objectContaining({ left: CARD_WIDTH / 2 }),
		);
	});

	it("scrolls LTR without animation under reduced motion", () => {
		const original = window.matchMedia;
		window.matchMedia = jest.fn(() => ({ matches: true })) as never;
		const scroller = renderCarousel(5);
		layout(scroller, 5, CARD_WIDTH, { dir: "ltr", viewport: 150 });
		scroller.scrollBy = jest.fn();
		fireEvent.scroll(scroller);

		expect(screen.getByTestId("carousel-position")).toHaveTextContent("2 / 5");
		fireEvent.click(screen.getByRole("button", { name: "פרשן הבא" }));
		expect(scroller.scrollBy).toHaveBeenCalledWith({
			left: CARD_WIDTH,
			behavior: "auto",
		});
		fireEvent.click(screen.getByRole("button", { name: "פרשן קודם" }));
		expect(scroller.scrollBy).toHaveBeenLastCalledWith({
			left: -CARD_WIDTH,
			behavior: "auto",
		});
		window.matchMedia = original;
	});

	it("omits the position while no card is fully visible", () => {
		const scroller = renderCarousel(3);
		layout(scroller, 3, 0, { viewport: 50 });
		fireEvent.scroll(scroller);

		expect(screen.getByRole("button", { name: "פרשן הבא" })).toBeEnabled();
		expect(screen.queryByTestId("carousel-position")).toBeNull();
	});

	it("re-measures through ResizeObserver when available", () => {
		const observe = jest.fn();
		const disconnect = jest.fn();
		global.ResizeObserver = jest.fn(() => ({
			observe,
			disconnect,
			unobserve: jest.fn(),
		})) as never;
		const { unmount } = render(
			<Carousel className="track" prevLabel="p" nextLabel="n">
				<a href="#0">0</a>
			</Carousel>,
		);
		expect(observe).toHaveBeenCalled();
		unmount();
		expect(disconnect).toHaveBeenCalled();
		// @ts-expect-error restore jsdom, which has no ResizeObserver
		delete global.ResizeObserver;
	});

	it("ignores a queued resize callback after navigation unmounts the carousel", () => {
		let resize: ResizeObserverCallback | undefined;
		global.ResizeObserver = jest.fn((callback: ResizeObserverCallback) => {
			resize = callback;
			return {
				observe: jest.fn(),
				disconnect: jest.fn(),
				unobserve: jest.fn(),
			};
		}) as never;
		const { unmount } = render(
			<Carousel className="track" prevLabel="p" nextLabel="n">
				<a href="#0">0</a>
			</Carousel>,
		);
		unmount();
		expect(() => resize?.([], {} as ResizeObserver)).not.toThrow();
		// @ts-expect-error restore jsdom, which has no ResizeObserver
		delete global.ResizeObserver;
	});

	describe("scrollStorageKey position memory", () => {
		const KEY = "carousel-scroll-test";

		beforeEach(() => sessionStorage.clear());

		function renderStored(count: number, key: string | null = KEY) {
			return render(
				<div dir="rtl">
					<Carousel
						className="track"
						prevLabel="פרשן קודם"
						nextLabel="פרשן הבא"
						scrollStorageKey={key ?? undefined}
					>
						{Array.from({ length: count }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static test cards
							<a key={i} href={`#${i}`}>
								{i}
							</a>
						))}
					</Carousel>
				</div>,
			).container.querySelector(".track") as HTMLElement;
		}

		function storedPosition() {
			const raw = sessionStorage.getItem(KEY);
			return raw ? JSON.parse(raw) : null;
		}

		/**
		 * Uniform card layout resolved through the prototypes, so even a
		 * remounted scroller reports real geometry to the mount-time restore.
		 */
		function installTrackLayout({
			dir = "rtl",
			dims = { viewport: VIEWPORT_WIDTH },
		}: {
			dir?: "rtl" | "ltr";
			dims?: { viewport: number };
		} = {}) {
			const realRect = HTMLElement.prototype.getBoundingClientRect;
			// jsdom's getComputedStyle does not inherit direction from the `dir`
			// attribute, so report it for the track like a real browser would.
			const realGetComputedStyle = window.getComputedStyle;
			window.getComputedStyle = (el: Element, pseudo?: string | null) => {
				const style = realGetComputedStyle(el, pseudo);
				if (el instanceof HTMLElement && el.classList.contains("track")) {
					Object.defineProperty(style, "direction", {
						configurable: true,
						value: dir,
					});
				}
				return style;
			};
			HTMLElement.prototype.getBoundingClientRect = function (
				this: HTMLElement,
			) {
				if (this.classList.contains("track")) return rect(0, dims.viewport);
				const track = this.parentElement;
				if (track?.classList.contains("track")) {
					const i = Array.prototype.indexOf.call(track.children, this);
					const start =
						dir === "rtl"
							? dims.viewport - (i + 1) * CARD_WIDTH
							: i * CARD_WIDTH;
					return rect(start - track.scrollLeft, CARD_WIDTH);
				}
				return realRect.call(this);
			};
			const scrollWidth = Object.getOwnPropertyDescriptor(
				HTMLElement.prototype,
				"scrollWidth",
			);
			const clientWidth = Object.getOwnPropertyDescriptor(
				HTMLElement.prototype,
				"clientWidth",
			);
			Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
				configurable: true,
				get(this: HTMLElement) {
					return this.classList.contains("track")
						? this.children.length * CARD_WIDTH
						: 0;
				},
			});
			Object.defineProperty(HTMLElement.prototype, "clientWidth", {
				configurable: true,
				get(this: HTMLElement) {
					return this.classList.contains("track") ? dims.viewport : 0;
				},
			});
			return () => {
				HTMLElement.prototype.getBoundingClientRect = realRect;
				window.getComputedStyle = realGetComputedStyle;
				if (scrollWidth) {
					Object.defineProperty(
						HTMLElement.prototype,
						"scrollWidth",
						scrollWidth,
					);
				} else {
					Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
				}
				if (clientWidth) {
					Object.defineProperty(
						HTMLElement.prototype,
						"clientWidth",
						clientWidth,
					);
				} else {
					Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
				}
			};
		}

		it("remembers the scrolled position and restores it on remount", () => {
			const undo = installTrackLayout();
			const scroller = renderStored(5);
			scroller.scrollLeft = -2 * CARD_WIDTH;
			fireEvent.scroll(scroller);
			expect(storedPosition()).toEqual({ itemIndex: 2, itemGap: 0 });

			// A second mount (e.g. returning from a perush) picks it back up.
			const remounted = renderStored(5);
			expect(remounted.scrollLeft).toBe(-2 * CARD_WIDTH);
			undo();
		});

		it("restores the stored position even before any layout", () => {
			sessionStorage.setItem(KEY, JSON.stringify({ itemIndex: 2, itemGap: 0 }));
			const undo = installTrackLayout();
			const scroller = renderStored(5);
			expect(scroller.scrollLeft).toBe(-2 * CARD_WIDTH);
			expect(screen.getByTestId("carousel-position")).toHaveTextContent(
				"3-4 / 5",
			);
			undo();
		});

		it("keeps the position while a loading placeholder shrinks the scroller, then restores it when the items return", () => {
			const undo = installTrackLayout();
			const rendered = render(
				<div dir="rtl">
					<Carousel
						className="track"
						prevLabel="פרשן קודם"
						nextLabel="פרשן הבא"
						scrollStorageKey={KEY}
					>
						{Array.from({ length: 5 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static test cards
							<a key={i} href={`#${i}`}>
								{i}
							</a>
						))}
					</Carousel>
				</div>,
			);
			const scroller = rendered.container.querySelector(
				".track",
			) as HTMLElement;
			scroller.scrollLeft = -2 * CARD_WIDTH;
			fireEvent.scroll(scroller);
			expect(storedPosition()).toEqual({ itemIndex: 2, itemGap: 0 });

			// Loading placeholder: the scroller shrinks and the browser clamps
			// scrollLeft back to 0 — the remembered position must survive both.
			rendered.rerender(
				<div dir="rtl">
					<Carousel
						className="track"
						prevLabel="פרשן קודם"
						nextLabel="פרשן הבא"
						scrollStorageKey={KEY}
					>
						<p>מתחבר לפירוש...</p>
					</Carousel>
				</div>,
			);
			scroller.scrollLeft = 0; // the browser's clamp on shrink
			fireEvent.scroll(scroller);
			expect(storedPosition()).toEqual({ itemIndex: 2, itemGap: 0 });

			// The cards return in the same instance (e.g. a failed load).
			rendered.rerender(
				<div dir="rtl">
					<Carousel
						className="track"
						prevLabel="פרשן קודם"
						nextLabel="פרשן הבא"
						scrollStorageKey={KEY}
					>
						{Array.from({ length: 5 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static test cards
							<a key={i} href={`#${i}`}>
								{i}
							</a>
						))}
					</Carousel>
				</div>,
			);
			expect(scroller.scrollLeft).toBe(-2 * CARD_WIDTH);
			undo();
		});

		it("restores the same card when the viewport changed while away", () => {
			sessionStorage.setItem(KEY, JSON.stringify({ itemIndex: 3, itemGap: 0 }));
			const undo = installTrackLayout({ dims: { viewport: 150 } });
			const scroller = renderStored(5);
			// Card 4 realigns to the start edge of the narrower viewport.
			expect(scroller.scrollLeft).toBe(-3 * CARD_WIDTH);
			expect(screen.getByTestId("carousel-position")).toHaveTextContent(
				"4 / 5",
			);
			undo();
		});

		it("restores the place after a widened viewport briefly fits every card", () => {
			const dims = { viewport: VIEWPORT_WIDTH };
			const undo = installTrackLayout({ dims });
			const rendered = render(
				<div dir="rtl">
					<Carousel
						className="track"
						prevLabel="פרשן קודם"
						nextLabel="פרשן הבא"
						scrollStorageKey={KEY}
					>
						{Array.from({ length: 5 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static test cards
							<a key={i} href={`#${i}`}>
								{i}
							</a>
						))}
					</Carousel>
				</div>,
			);
			const scroller = rendered.container.querySelector(
				".track",
			) as HTMLElement;
			scroller.scrollLeft = -2 * CARD_WIDTH;
			fireEvent.scroll(scroller);
			expect(storedPosition()).toEqual({ itemIndex: 2, itemGap: 0 });

			// Widening until every card fits clamps scrollLeft to the start —
			// the remembered place must not be overwritten by that clamp.
			dims.viewport = 5 * CARD_WIDTH;
			scroller.scrollLeft = 0;
			fireEvent.scroll(scroller);
			expect(storedPosition()).toEqual({ itemIndex: 2, itemGap: 0 });

			// Narrowing back replays the remembered card instead of the clamp.
			dims.viewport = VIEWPORT_WIDTH;
			fireEvent(window, new Event("resize"));
			expect(scroller.scrollLeft).toBe(-2 * CARD_WIDTH);
			undo();
		});

		it("leaves storage and position alone without a key", () => {
			const undo = installTrackLayout();
			const scroller = renderStored(5, null);
			scroller.scrollLeft = -2 * CARD_WIDTH;
			fireEvent.scroll(scroller);
			expect(sessionStorage.length).toBe(0);
			undo();
		});
	});
});
