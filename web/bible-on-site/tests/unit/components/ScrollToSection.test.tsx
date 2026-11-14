/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToSection } from "@/app/components/ScrollToSection";

describe("ScrollToSection", () => {
	it("returns null and scrolls to section", () => {
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

	it("does not throw when element is missing", () => {
		const { container } = render(<ScrollToSection sectionId="non-existent" />);
		expect(container.firstChild).toBeNull();
	});
});
