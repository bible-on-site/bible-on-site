/**
 * @jest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import type { AriaAttributes, ReactNode } from "react";
import { TanahpediaBreadcrumb } from "../../../src/app/pedia/components/TanahpediaBreadcrumb";

jest.mock("next/link", () => ({
	__esModule: true,
	default({
		href,
		children,
		className,
		"aria-current": ariaCurrent,
	}: {
		href: string;
		children: ReactNode;
		className?: string;
		"aria-current"?: AriaAttributes["aria-current"];
	}) {
		return (
			<a href={href} className={className} aria-current={ariaCurrent}>
				{children}
			</a>
		);
	},
}));

// The component consumes the shared taxonomy contract directly (#3710), so
// the assertions below pin the real Hebrew labels — drift in
// web/shared/tanahpedia/ fails here.
describe("TanahpediaBreadcrumb", () => {
	it("renders category and entry dropdown links with the current entry marked", () => {
		render(
			<TanahpediaBreadcrumb
				currentCategory="PROPHET"
				currentEntryTitle="Moshe"
				currentEntryUniqueName="moshe"
				siblingEntries={[
					{ uniqueName: "moshe", title: "Moshe" },
					{ uniqueName: "yehoshua bin nun", title: "Yehoshua" },
				]}
			/>,
		);

		expect(screen.getByRole("button", { name: /נביאים/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Moshe/ })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "אישים" })).toHaveAttribute(
			"href",
			"/pedia/אישים",
		);
		expect(screen.getByRole("link", { name: "מלכים" })).toHaveAttribute(
			"href",
			"/pedia/מלכים",
		);
		expect(screen.getByRole("link", { name: "חיות" })).toHaveAttribute(
			"href",
			"/pedia/חיות",
		);
		expect(screen.getByRole("link", { name: "טהורים" })).toHaveAttribute(
			"href",
			"/pedia/טהורים",
		);

		const currentEntry = screen.getByRole("link", { name: "Moshe" });
		expect(currentEntry).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("link", { name: "Yehoshua" })).toHaveAttribute(
			"href",
			"/pedia/yehoshua%20bin%20nun",
		);
	});

	it("renders a plain current entry crumb when there are no siblings", () => {
		render(<TanahpediaBreadcrumb currentEntryTitle="Standalone" />);

		const breadcrumb = screen.getByTestId("tanahpedia-breadcrumb");
		expect(within(breadcrumb).getByText("Standalone")).toBeInTheDocument();
		expect(
			within(breadcrumb).queryByRole("button", { name: /Standalone/ }),
		).not.toBeInTheDocument();
	});
});
