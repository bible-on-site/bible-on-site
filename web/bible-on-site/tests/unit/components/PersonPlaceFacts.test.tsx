jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
	}: {
		children: React.ReactNode;
		href: string;
	}) => <a href={href}>{children}</a>,
}));

import { render, screen } from "@testing-library/react";
import { PersonPlaceFactsSection } from "../../../src/app/pedia/components/PersonPlaceFacts";

describe("PersonPlaceFactsSection", () => {
	it("renders nothing when every fact is empty", () => {
		const { container } = render(
			<PersonPlaceFactsSection
				facts={{ birth: null, activity: [], death: null }}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("links a linked place to its entry and keeps free text unlinked", () => {
		render(
			<PersonPlaceFactsSection
				facts={{
					birth: { label: "דבינסק", entryUniqueName: null },
					activity: [],
					death: { label: "טבריה", entryUniqueName: "טבריה" },
				}}
			/>,
		);

		const link = screen.getByRole("link", { name: "טבריה" });
		expect(link).toHaveAttribute(
			"href",
			`/pedia/${encodeURIComponent("טבריה")}`,
		);
		expect(screen.queryByRole("link", { name: "דבינסק" })).toBeNull();
		expect(screen.getByText("דבינסק")).toBeInTheDocument();
	});
});
