/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import TanahpediaLayout from "../../../src/app/pedia/layout";

describe("TanahpediaLayout", () => {
	it("uses the shared site typography within the pedia page shell", () => {
		const { container } = render(
			<TanahpediaLayout>
				<div />
			</TanahpediaLayout>,
		);
		const wrapper = container.querySelector(".tanahpedia-layout");
		expect(wrapper).not.toBeNull();
		expect(wrapper).toHaveAttribute("data-page-header", "solid");
	});
});
