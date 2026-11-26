import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContributionDiff } from "~/components/tanahpedia/ContributionDiff";
import type { ReviewedChange } from "~/lib/tanahpedia/contributions";

describe("typed contribution diff", () => {
	it("distinguishes existing links from exact new word spans and keeps evidence sources separate", () => {
		const kept = {
			perekId: 64,
			pasukNumber: 2,
			segmentStart: 7,
			segmentEnd: 8,
			text: "פִּ֣י הַחִירֹ֔ת",
		};
		const newSpan = {
			...kept,
			segmentStart: 14,
			segmentEnd: 15,
			text: "בַּ֣עַל צְפֹ֔ן",
		};
		render(
			<ContributionDiff
				changes={[
					{
						kind: "place_profile",
						targetId: "place",
						before: { occurrences: [kept], entry: null, identification: null },
						after: {
							entry: null,
							occurrences: [kept, newSpan],
							identification: {
								basis: "commentary",
								modernName: "אתר לבדיקה",
								latitude: 30.1,
								longitude: 32.2,
								citation: "מקור זיהוי",
								coordinateCitation: "מקור מדידה",
							},
						},
						labels: { "64:2:14:15": "שמות יד ב", place: "אתר במצרים" },
					},
				]}
			/>,
		);
		const occurrences = within(
			screen.getByRole("region", { name: "קישורי מילים במקרא" }),
		);
		expect(occurrences.getByText("1 להוספה · 1 כבר קיימים")).toBeVisible();
		expect(
			occurrences.getByRole("row", { name: "שמות יד ב בַּ֣עַל צְפֹ֔ן 14-15" }),
		).toBeVisible();
		expect(occurrences.queryByText(kept.text)).not.toBeInTheDocument();
		const identification = within(
			screen.getByRole("region", { name: "זיהוי וקואורדינטות" }),
		);
		expect(identification.getByText("זיהוי לפי פירוש")).toBeVisible();
		expect(identification.getByText("מקור זיהוי")).toBeVisible();
		expect(identification.getByText("מקור מדידה")).toBeVisible();
		expect(identification.getByText("30.1, 32.2")).toBeVisible();
	});

	it("paginates a large place list and labels a newly proposed entry", () => {
		const occurrences = Array.from({ length: 41 }, (_, i) => ({
			perekId: 64,
			pasukNumber: 2,
			segmentStart: i,
			segmentEnd: i,
			text: `מופע ${i + 1}`,
		}));
		render(
			<ContributionDiff
				changes={[
					{
						kind: "place_profile",
						targetId: "place",
						before: null,
						labels: {},
						after: {
							entry: {
								title: "מקום חדש",
								uniqueName: "מקום",
								displayName: "שם מוצע",
							},
							occurrences,
							identification: null,
						},
					},
				]}
			/>,
		);
		expect(screen.getByRole("region", { name: "ערך חדש" })).toHaveTextContent(
			"מקום חדש",
		);
		expect(screen.getByText("מופע 40")).toBeVisible();
		expect(screen.queryByText("מופע 41")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "הקודם" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "הבא" }));
		expect(screen.getByText("מופע 41")).toBeVisible();
		expect(screen.getByRole("button", { name: "הבא" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "הקודם" }));
		expect(screen.getByText("מופע 40")).toBeVisible();
	});
	it("renders unresolved names, unlabeled alias targets, booleans and partial legacy dates", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "alias_mapping",
						targetId: "alias",
						before: null,
						after: {
							name: "Alias",
							targets: [{ entryId: "raw-id", label: "" }],
						},
						labels: {},
					},
					{
						kind: "prophecy_quality",
						targetId: "quality",
						before: { isGood: false },
						after: { isGood: true },
						labels: {},
					},
					{
						kind: "person_death_date",
						targetId: "death",
						before: { deathDate: 0 },
						after: { deathDate: -1 },
						labels: {},
					},
					{
						kind: "person_birth_date",
						targetId: "birth",
						before: { birthDate: 100 },
						after: { birthDate: 57849901 },
						labels: {},
					},
				]}
			/>,
		);
		expect(screen.getByText("raw-id")).toBeInTheDocument();
		expect(screen.getByText("פורענות")).toBeInTheDocument();
		expect(screen.getByText("טובה")).toBeInTheDocument();
		expect(screen.getByText("טרם נפטר")).toBeInTheDocument();
		expect(screen.getByText("? תשרי ?")).toBeInTheDocument();
		expect(screen.getByText("1 ? 5784")).toBeInTheDocument();
	});
	it("renders structured cited claims and synchronized MAIN names alongside the reviewed values", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "metadata",
						targetId: "person",
						before: { displayName: "Old" },
						after: { displayName: "New" },
						personNames: [{ id: "main", name: "Old main" }],
						labels: {},
					},
					{
						kind: "source_reference",
						targetId: "source",
						before: null,
						after: {
							targetKind: "person_birth_date",
							targetId: "fact",
							sourceType: "other",
							sourceText: "Source",
						},
						sourceTarget: {
							kind: "person_birth_date",
							id: "fact",
							state: {
								personId: "person",
								birthDate: 57840000,
								altGroupId: null,
								legacyField: "Retained source fact",
							},
						},
						labels: { "personId:person": "Named person" },
					},
					{
						kind: "source_reference",
						targetId: "source2",
						before: null,
						after: {
							targetKind: "parent_child",
							targetId: "edge",
							sourceType: "tanah",
							perekId: 1,
							pasukNumber: 2,
						},
						sourceTarget: {
							kind: "parent_child",
							id: "edge",
							state: {
								parentId: "parent",
								childId: "child",
								sourceCitation: "בראשית א ב",
							},
						},
						labels: { parent: "Parent", child: "Child" },
					},
				]}
			/>,
		);
		expect(screen.getAllByLabelText("הטענה המצוטטת")).toHaveLength(2);
		expect(screen.getByText("Named person")).toBeInTheDocument();
		expect(screen.getByText("legacyField")).toBeInTheDocument();
		expect(screen.getByText("Parent")).toBeInTheDocument();
		expect(screen.getByText("? לא ידוע 5784")).toBeInTheDocument();
		expect(screen.getByText(/Old main/)).toHaveTextContent("New");
	});
	it("displays free metadata that matches an object prototype property", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "metadata",
						targetId: "one",
						before: { displayName: "constructor" },
						after: { displayName: "toString" },
						labels: {},
					},
				]}
			/>,
		);
		expect(screen.getByText("constructor")).toBeInTheDocument();
		expect(screen.getByText("toString")).toBeInTheDocument();
	});
	it("shows added, changed and removed fields without requiring a file diff", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "metadata",
						targetId: "one",
						before: { displayName: "קודם" },
						after: { displayName: "מוצע" },
						labels: {},
					},
					{
						kind: "entry",
						targetId: "two",
						before: null,
						after: {
							title: "חדש",
							uniqueName: "חדש",
							entityType: "PERSON",
							displayName: "איש",
						},
						labels: {},
					},
				]}
			/>,
		);
		expect(screen.getByText("קודם")).toBeInTheDocument();
		expect(screen.getByText("מוצע")).toBeInTheDocument();
		expect(screen.getAllByRole("table")).toHaveLength(2);
		expect(
			screen.getByText(/הערך ייווצר עם מטא-נתונים וגוף ריק/),
		).toBeInTheDocument();
	});
	it("renders a named parent-child comparison and retained citations", () => {
		const change: ReviewedChange = {
			kind: "parent_child",
			targetId: "link",
			before: {
				parentId: "a",
				childId: "b",
				relationshipType: "STEP",
				sourceCitation: "מקור ישן",
			},
			after: {
				parentId: "a",
				childId: "c",
				relationshipType: "BIOLOGICAL",
				sourceCitation: "מקור חדש",
			},
			labels: { a: "יעקב", b: "אפרים", c: "יוסף" },
		};
		render(<ContributionDiff changes={[change]} />);
		expect(screen.getByLabelText("הקשר הקודם")).toHaveTextContent("יעקב");
		expect(screen.getByLabelText("הקשר המוצע")).toHaveTextContent("יוסף");
		expect(screen.getByText("מקור חדש")).toBeInTheDocument();
	});
	it("visualizes union additions and relationship deletions", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "union",
						targetId: "add",
						before: null,
						after: { person1Id: "a", person2Id: "b", unionType: "MARRIAGE" },
						labels: { a: "אברהם", b: "שרה" },
					},
					{
						kind: "parent_child",
						targetId: "remove",
						before: { parentId: "a", childId: "c", parentRole: "FATHER" },
						after: null,
						labels: { a: "אברהם", c: "יצחק" },
					},
				]}
			/>,
		);
		expect(screen.getByText("מחיקה")).toBeInTheDocument();
		expect(screen.getByLabelText("הקשר המוצע")).toHaveTextContent("שרה");
	});
	it("plots valid old and new coordinates and links to their actual locations", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "place",
						targetId: "place",
						before: {
							placeId: "p",
							latitude: 31.7,
							longitude: 35.2,
							modernName: null,
						},
						after: {
							placeId: "p",
							latitude: 31.8,
							longitude: 35.3,
							modernName: "ירושלים",
						},
						labels: { p: "ירושלים" },
					},
				]}
			/>,
		);
		expect(screen.getByRole("img")).toBeInTheDocument();
		const links = screen.getAllByRole("link");
		expect(links[0]).toHaveAttribute(
			"href",
			expect.stringContaining("mlat=31.7"),
		);
		expect(links[1]).toHaveAttribute(
			"href",
			expect.stringContaining("mlon=35.3"),
		);
	});
	it("omits the coordinate plot when an identification has no coordinates", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "place",
						targetId: "place",
						before: null,
						after: {
							placeId: "p",
							modernName: "מקום",
							latitude: null,
							longitude: null,
						},
						labels: {},
					},
				]}
			/>,
		);
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
	});
	it("keeps nearby corrections visibly separated and represents equal/polar coordinates without invalid geometry", () => {
		const change: ReviewedChange = {
			kind: "place",
			targetId: "nearby",
			before: { latitude: 31.778, longitude: 35.235 },
			after: { latitude: 31.779, longitude: 35.236 },
			labels: {},
		};
		const { container, rerender } = render(
			<ContributionDiff changes={[change]} />,
		);
		const points = container.querySelectorAll("circle");
		expect(
			Math.abs(
				Number(points[0].getAttribute("cx")) -
					Number(points[1].getAttribute("cx")),
			),
		).toBeGreaterThan(50);
		for (const [latitude, longitude] of [
			[90, 180],
			[-90, -180],
			[0, 0],
		]) {
			rerender(
				<ContributionDiff
					changes={[
						{
							...change,
							before: { latitude, longitude },
							after: { latitude, longitude },
						},
					]}
				/>,
			);
			for (const point of container.querySelectorAll("circle")) {
				expect(Number(point.getAttribute("cx"))).toBeGreaterThanOrEqual(40);
				expect(Number(point.getAttribute("cx"))).toBeLessThanOrEqual(320);
				expect(Number.isFinite(Number(point.getAttribute("cy")))).toBe(true);
			}
		}
	});
	it("shows enum labels without translating free metadata that resembles an enum", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "entry",
						targetId: "entry",
						before: null,
						after: {
							title: "PERSON",
							uniqueName: "PERSON",
							entityType: "PERSON",
							displayName: "PERSON",
						},
						labels: {},
					},
				]}
			/>,
		);
		expect(screen.getByText("אישים")).toBeInTheDocument();
		expect(screen.getAllByText("PERSON")).toHaveLength(3);
	});
});
