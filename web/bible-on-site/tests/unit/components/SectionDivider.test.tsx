/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";

import { SectionDivider } from "@/app/components/SectionDivider";

describe("SectionDivider", () => {
	it("renders a decorative element hidden from assistive technology", () => {
		const { container } = render(<SectionDivider />);
		const divider = container.firstElementChild;
		expect(divider).not.toBeNull();
		expect(divider).toHaveAttribute("aria-hidden", "true");
	});
});
