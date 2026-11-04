/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { BulletinJoinCarousel } from "@/app/components/BulletinJoinCarousel";

const CARD_WIDTH = 100;
const VIEWPORT_WIDTH = 120;

function rect(left: number, width: number) {
	return { left, right: left + width, width } as DOMRect;
}

/** Positions the slides like a 3-card RTL track; index 0 hugs the right edge. */
function layout(track: HTMLElement, scrollLeft = 0) {
	Object.defineProperties(track, {
		clientWidth: { configurable: true, value: VIEWPORT_WIDTH },
	});
	track.getBoundingClientRect = () => rect(0, VIEWPORT_WIDTH);
	Array.from(track.children).forEach((slide, i) => {
		const start = VIEWPORT_WIDTH - (i + 1) * CARD_WIDTH;
		slide.getBoundingClientRect = () =>
			rect(start - scrollLeft, CARD_WIDTH);
	});
}

function renderCarousel() {
	render(
		<div dir="rtl">
			<BulletinJoinCarousel>
				<article data-channel="telegram" />
				<article data-channel="whatsapp" />
				<article data-channel="email" />
			</BulletinJoinCarousel>
		</div>,
	);
	return document.querySelector("ul") as HTMLElement;
}

describe("BulletinJoinCarousel", () => {
	beforeEach(() => {
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			writable: true,
			value: (query: string) => ({
				matches: false,
				media: query,
				addEventListener: jest.fn(),
				removeEventListener: jest.fn(),
			}),
		});
	});

	it("exposes a labelled region with three slides and controls", () => {
		renderCarousel();
		expect(
			screen.getByRole("region", { name: "ערוצי הצטרפות לעלון היומי" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("listitem")).toHaveLength(3);
		expect(
			screen.getByRole("button", { name: "הכרטיס הבא" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "הכרטיס הקודם" }),
		).toBeInTheDocument();
		expect(
			screen.getAllByRole("button", { name: /כרטיס \d מתוך 3/ }),
		).toHaveLength(3);
	});

	it("scrolls to the requested slide when a dot is clicked", () => {
		const track = renderCarousel();
		const slide = track.children[2] as HTMLElement;
		slide.scrollIntoView = jest.fn();
		fireEvent.click(screen.getByRole("button", { name: "כרטיס 3 מתוך 3" }));
		expect(slide.scrollIntoView).toHaveBeenCalledWith(
			expect.objectContaining({ inline: "center" }),
		);
	});

	it("wraps next/prev around the card list", () => {
		const track = renderCarousel();
		const first = track.children[0] as HTMLElement;
		const last = track.children[2] as HTMLElement;
		first.scrollIntoView = jest.fn();
		last.scrollIntoView = jest.fn();
		fireEvent.click(screen.getByRole("button", { name: "הכרטיס הקודם" }));
		expect(last.scrollIntoView).toHaveBeenCalled();
	});

	it("tracks the slide nearest the viewport center on scroll", () => {
		const track = renderCarousel();
		layout(track, -CARD_WIDTH);
		fireEvent.scroll(track);
		const dots = screen.getAllByRole("button", { name: /כרטיס \d מתוך 3/ });
		expect(dots[1]).toHaveAttribute("aria-current", "true");
		expect(dots[0]).not.toHaveAttribute("aria-current");
	});

	it("scrolls on arrow keys in the RTL direction", () => {
		const track = renderCarousel();
		const second = track.children[1] as HTMLElement;
		second.scrollIntoView = jest.fn();
		fireEvent.keyDown(
			screen.getByRole("region", { name: "ערוצי הצטרפות לעלון היומי" }),
			{ key: "ArrowLeft" },
		);
		expect(second.scrollIntoView).toHaveBeenCalled();
	});

	it("uses non-smooth scrolling under reduced motion", () => {
		const track = renderCarousel();
		const slide = track.children[1] as HTMLElement;
		slide.scrollIntoView = jest.fn();
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			writable: true,
			value: (query: string) => ({
				matches: query.includes("prefers-reduced-motion"),
				media: query,
				addEventListener: jest.fn(),
				removeEventListener: jest.fn(),
			}),
		});
		fireEvent.click(screen.getByRole("button", { name: "הכרטיס הבא" }));
		expect(slide.scrollIntoView).toHaveBeenCalledWith(
			expect.objectContaining({ behavior: "auto" }),
		);
	});
});
