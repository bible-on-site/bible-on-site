/**
 * @jest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import type { AriaAttributes, ReactNode } from "react";
import { TanahpediaBreadcrumb } from "../../../src/app/tanahpedia/components/TanahpediaBreadcrumb";

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

jest.mock("../../../src/lib/tanahpedia/service", () => ({
	CATEGORY_LABELS: {
		PERSON: "People",
		PROPHET: "Prophets",
		KING: "Kings",
		PLACE: "Places",
		EVENT: "Events",
		WAR: "Wars",
		SAYING: "Sayings",
		PROPHECY: "Prophecies",
		OBJECT: "Objects",
		TEMPLE_TOOL: "Temple tools",
		ASTRONOMICAL_OBJECT: "Astronomical objects",
		ANIMAL: "Animals",
		BEHEMA: "Behema",
		CHAYA: "Chaya",
		OF: "Birds",
		SHERETZ: "Sheretz",
		TAHOR: "Tahor",
		TAMEH: "Tameh",
		PLANT: "Plants",
		SEFER: "Books",
		TANAH_SEFER: "Tanach books",
		NATION: "Nations",
	},
	ENTITY_TYPE_LABELS: {
		PERSON: "People",
		PLACE: "Places",
		EVENT: "Events",
		SAYING: "Sayings",
		OBJECT: "Objects",
		ANIMAL: "Animals",
		PLANT: "Plants",
		SEFER: "Books",
		NATION: "Nations",
	},
}));

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

		expect(
			screen.getByRole("button", { name: /Prophets/ }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Moshe/ })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "People" })).toHaveAttribute(
			"href",
			"/tanahpedia/person",
		);
		expect(screen.getByRole("link", { name: "Kings" })).toHaveAttribute(
			"href",
			"/tanahpedia/person?role=king",
		);
		expect(screen.getByRole("link", { name: "Chaya" })).toHaveAttribute(
			"href",
			"/tanahpedia/animal?kind=chaya",
		);
		expect(screen.getByRole("link", { name: "Tahor" })).toHaveAttribute(
			"href",
			"/tanahpedia/animal?purity=tahor",
		);

		const currentEntry = screen.getByRole("link", { name: "Moshe" });
		expect(currentEntry).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("link", { name: "Yehoshua" })).toHaveAttribute(
			"href",
			"/tanahpedia/entry/yehoshua%20bin%20nun",
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
