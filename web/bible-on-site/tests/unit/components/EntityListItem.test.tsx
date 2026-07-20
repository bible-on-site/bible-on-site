/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { EntityListItem } from "@/app/tanahpedia/components/EntityListItem";
import type { EntityWithEntries } from "@/lib/tanahpedia/types";

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

function entity(
	entityName: string,
	linkedEntries: EntityWithEntries["linkedEntries"],
): EntityWithEntries {
	return {
		entityType: "PERSON",
		entityId: `entity-${entityName}`,
		entityName,
		linkedEntries,
	};
}

describe("EntityListItem", () => {
	it("renders an unlinked entity with the no-entry badge", () => {
		render(<EntityListItem entity={entity("Unlinked person", [])} />);

		expect(screen.getByText("Unlinked person")).toBeInTheDocument();
		expect(screen.getByText(/אין ערך/)).toBeInTheDocument();
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});

	it("links the entity name when exactly one entry exists", () => {
		render(
			<EntityListItem
				entity={entity("Single entry person", [
					{
						id: "entry-1",
						uniqueName: "person one",
						title: "Person One",
					},
				])}
			/>,
		);

		const link = screen.getByRole("link", { name: "Single entry person" });
		expect(link).toHaveAttribute(
			"href",
			"/tanahpedia/entry/person%20one",
		);
	});

	it("renders multiple entry title links next to the entity name", () => {
		render(
			<EntityListItem
				entity={entity("Shared entity", [
					{
						id: "entry-1",
						uniqueName: "first",
						title: "First Entry",
					},
					{
						id: "entry-2",
						uniqueName: "second entry",
						title: "Second Entry",
					},
				])}
			/>,
		);

		expect(screen.getByText("Shared entity")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "First Entry" })).toHaveAttribute(
			"href",
			"/tanahpedia/entry/first",
		);
		expect(screen.getByRole("link", { name: "Second Entry" })).toHaveAttribute(
			"href",
			"/tanahpedia/entry/second%20entry",
		);
	});
});
