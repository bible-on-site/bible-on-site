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
	focalSex: null,
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
			focalSex: "MALE",
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
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
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
		expect(screen.getByText("בנות זוג")).toBeInTheDocument();
		expect(screen.getByText("ילדים")).toBeInTheDocument();
		expect(screen.getByText("אח")).toBeInTheDocument();
		expect(screen.queryByText("אחים")).not.toBeInTheDocument();
		expect(screen.getByText("שמשון")).toBeInTheDocument();
	});

	it("merges two union rows for the same spouse into one card with opinion badges", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				{
					related: related("s1", "דלילה"),
					unionType: "MARRIAGE",
					unionOrder: 1,
					altGroupId: "g1",
					sourceCitation: "משנה תורה",
				},
				{
					related: related("s1", "דלילה"),
					unionType: "FORBIDDEN_WITH_GENTILE",
					unionOrder: 1,
					altGroupId: "g1",
					sourceCitation: "רש״י",
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getByText("דלילה")).toBeInTheDocument();
		expect(
			screen.getByText('הרמב"ם: נישואין תקפים'),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/רש"י, רד"ק ותוספות: קשר פסול עם גויה \(אינו נישואין כהלכת התורה\)/,
			),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/לפי כל השיטות היא הייתה בת זוגו; נחלקים רק בטיב הקשר מול התורה/,
			),
		).toBeInTheDocument();
		expect(screen.queryByText("חלופי")).not.toBeInTheDocument();
	});

	it("fuses marriage and forbidden rows for the same partner even without matching altGroupId", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				{
					related: related("s1", "דלילה"),
					unionType: "MARRIAGE",
					unionOrder: 1,
					altGroupId: null,
					sourceCitation: "משנה תורה",
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
				{
					related: related("s1", "דלילה"),
					unionType: "FORBIDDEN_WITH_GENTILE",
					unionOrder: 1,
					altGroupId: "other",
					sourceCitation: "רש״י",
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getAllByText("דלילה").length).toBe(1);
		expect(
			screen.getByText('הרמב"ם: נישואין תקפים'),
		).toBeInTheDocument();
	});

	it("renders alt group labels when altGroupId set on children", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			children: [
				{
					related: related("c1", "ילד חלופי"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: "g1",
					sourceCitation: null,
				},
				{
					related: related("c1", "ילד חלופי"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: "g2",
					sourceCitation: null,
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getAllByText("חלופי").length).toBeGreaterThan(0);
		expect(screen.getAllByText("ילד חלופי").length).toBe(2);
	});

	it("shows union end reason and dates on spouse card", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				{
					related: related("s1", "בת זוג"),
					unionType: "MARRIAGE",
					unionOrder: 1,
					altGroupId: null,
					sourceCitation: null,
					unionEndReason: "DEATH",
					unionStartDate: 18000101,
					unionEndDate: 18500101,
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getByText(/פטירה/)).toBeInTheDocument();
		expect(screen.getByText(/1850-01-01/)).toBeInTheDocument();
		expect(screen.getByText(/התחלה 1800-01-01/)).toBeInTheDocument();
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
