/**
 * Unit tests for SharedUnitText — the flat unit-page text renderer that
 * resolves slices against the canonical corpus. When a range points at a
 * perek the corpus cannot supply, the resolver yields undefined and the
 * slice renders nothing.
 */
import { render } from "@testing-library/react";
import { SharedUnitText } from "../../../../src/app/components/reading/UnitText";

jest.mock(
	"../../../../src/app/components/reading/ScrollToUnitPasuk",
	() => ({
		ScrollToUnitPasuk: () => null,
	}),
);

jest.mock("../../../../src/data/perek-dto", () => ({
	getPerekByPerekId: () => undefined,
}));

describe("SharedUnitText", () => {
	it("renders an empty scoped article when the corpus cannot resolve a perek", () => {
		const { container } = render(
			<SharedUnitText
				ranges={[
					{
						start: { perekId: 1, pasuk: 1 },
						end: { perekId: 1, pasuk: 2 },
					},
				]}
				entityRefsByPerek={{}}
				pasukCount={() => 5}
				scrollScope="torah"
			/>,
		);
		const article = container.querySelector("article");
		expect(article).not.toBeNull();
		expect(article).toHaveAttribute("data-unit-text", "torah");
		expect(article?.textContent).toBe("");
	});
});
