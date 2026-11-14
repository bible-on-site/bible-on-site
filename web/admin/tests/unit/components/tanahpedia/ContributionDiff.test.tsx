import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContributionDiff } from "~/components/tanahpedia/ContributionDiff";
import type { ReviewedChange } from "~/lib/tanahpedia/contributions";

describe("typed contribution diff", () => {
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
