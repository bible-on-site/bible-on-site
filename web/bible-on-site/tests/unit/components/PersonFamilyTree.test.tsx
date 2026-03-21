/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { PersonFamilyTree } from "../../../src/app/tanahpedia/components/PersonFamilyTree";
import type { PersonFamilySummary } from "../../../src/lib/tanahpedia/types";

jest.mock("next/link", () => ({
	__esModule: true,
	default({
		href,
		children,
	}: {
		href: string;
		children: React.ReactNode;
	}) {
		return <a href={href}>{children}</a>;
	},
}));

function related(
	id: string,
	name: string,
	entryUniqueName: string | null = `entry-${id}`,
) {
	return {
		entityId: id,
		displayName: name,
		entryUniqueName,
		entryTitle: name,
	};
}

const baseSummary: PersonFamilySummary = {
	focalPersonId: "fp",
	focalEntityId: "fe",
	focalDisplayName: "שמשון",
	parents: [],
	children: [],
	spouses: [],
	siblings: [],
};

describe("PersonFamilyTree", () => {
	it("renders nothing when no edges", () => {
		const { container } = render(<PersonFamilyTree summary={baseSummary} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders משפחה with parents children spouses siblings", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			parents: [
				{
					related: related("p1", "מנוח"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: "שופטים יג",
				},
			],
			spouses: [
				{
					related: related("s1", "דלילה"),
					unionType: "MARRIAGE",
					unionOrder: 1,
					altGroupId: null,
					sourceCitation: null,
				},
			],
			children: [
				{
					related: related("c1", "בן"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
				},
			],
			siblings: [related("sb", "אח", null)],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getByRole("region", { name: /משפחה/i })).toBeTruthy();
		expect(screen.getByText("הורים")).toBeInTheDocument();
		expect(screen.getByText("בני זוג")).toBeInTheDocument();
		expect(screen.getByText("ילדים")).toBeInTheDocument();
		expect(screen.getByText("אחים")).toBeInTheDocument();
		expect(screen.getByText("שמשון")).toBeInTheDocument();
	});

	it("renders alt group labels when altGroupId set on parents", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			parents: [
				{
					related: related("p1", "אב א"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: "g1",
					sourceCitation: null,
				},
				{
					related: related("p2", "אב ב"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: "g2",
					sourceCitation: null,
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getAllByText("חלופי").length).toBeGreaterThan(0);
	});
});
