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
});
