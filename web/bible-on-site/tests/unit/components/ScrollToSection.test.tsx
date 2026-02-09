/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToSection } from "@/app/components/ScrollToSection";

describe("ScrollToSection", () => {
	it("returns null and closes menu then scrolls to section", () => {
		const scrollIntoView = jest.fn();
		const el = document.createElement("div");
		el.id = "target-section";
		el.scrollIntoView = scrollIntoView;
		document.body.appendChild(el);

		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.id = "menu-toggle";
		checkbox.checked = true;
		document.body.appendChild(checkbox);

		const { container } = render(<ScrollToSection sectionId="target-section" />);
		expect(container.firstChild).toBeNull();

		expect(checkbox.checked).toBe(false);
		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "smooth",
			block: "start",
		});

		document.body.removeChild(el);
		document.body.removeChild(checkbox);
	});

	it("does not throw when element or checkbox is missing", () => {
		const { container } = render(
			<ScrollToSection sectionId="non-existent" />,
		);
		expect(container.firstChild).toBeNull();
	});
});
