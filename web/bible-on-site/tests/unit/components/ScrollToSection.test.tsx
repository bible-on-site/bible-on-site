/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToSection } from "@/app/components/ScrollToSection";

const reducedMotion = (matches: boolean) => {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: jest.fn((query: string) => ({
			matches: query === "(prefers-reduced-motion: reduce)" && matches,
		})),
	});
};

describe("ScrollToSection", () => {
	it("returns null and scrolls to section smoothly", () => {
		reducedMotion(false);
		const scrollIntoView = jest.fn();
		const el = document.createElement("div");
		el.id = "target-section";
		el.scrollIntoView = scrollIntoView;
		document.body.appendChild(el);

		const { container } = render(
			<ScrollToSection sectionId="target-section" />,
		);
		expect(container.firstChild).toBeNull();

		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "smooth",
			block: "start",
		});

		document.body.removeChild(el);
	});

	it("jumps instantly when the user prefers reduced motion", () => {
		reducedMotion(true);
		const scrollIntoView = jest.fn();
		const el = document.createElement("div");
		el.id = "target-section";
		el.scrollIntoView = scrollIntoView;
		document.body.appendChild(el);

		render(<ScrollToSection sectionId="target-section" />);

		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "auto",
			block: "start",
		});

		document.body.removeChild(el);
	});

	it("does not throw when element is missing", () => {
		const { container } = render(<ScrollToSection sectionId="non-existent" />);
		expect(container.firstChild).toBeNull();
	});
});
