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

/** Lays out `count` RTL cards (100px, no gap) in a 250px viewport scrolled by `scrollLeft`. */
function layout(scroller: HTMLElement, count: number, scrollLeft = 0) {
	Object.defineProperties(scroller, {
		scrollWidth: { configurable: true, value: count * CARD_WIDTH },
		clientWidth: { configurable: true, value: VIEWPORT_WIDTH },
		scrollLeft: { configurable: true, writable: true, value: scrollLeft },
	});
	scroller.style.direction = "rtl";
	scroller.getBoundingClientRect = () => rect(0, VIEWPORT_WIDTH);
	Array.from(scroller.children).forEach((card, i) => {
		Object.defineProperty(card, "offsetWidth", {
			configurable: true,
			value: CARD_WIDTH,
		});
		// RTL: card 1 hugs the right edge; negative scrollLeft moves cards right.
		card.getBoundingClientRect = () =>
			rect(
				VIEWPORT_WIDTH - (i + 1) * CARD_WIDTH - scroller.scrollLeft,
				CARD_WIDTH,
			);
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
});
