/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { geistSans } from "../../../src/app/pedia/family-tree-font";
import TanahpediaLayout from "../../../src/app/pedia/layout";

describe("TanahpediaLayout", () => {
	it("scopes the Geist Sans font variable to the pedia wrapper", () => {
		const { container } = render(
			<TanahpediaLayout>
				<div />
			</TanahpediaLayout>,
		);
		const wrapper = container.querySelector(".tanahpedia-layout");
		expect(wrapper).not.toBeNull();
		// The variable class defines --font-geist-sans on the wrapper so the
		// family-tree section's font-family resolves it, while keeping the font
		// preload and @font-face off non-pedia routes (issue #2734).
		expect(wrapper?.className).toContain(geistSans.variable);
	});
});
