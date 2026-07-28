/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { PersonFamilyTree } from "../../../src/app/tanahpedia/components/PersonFamilyTree";
import type {
	PersonFamilyChildEdge,
	PersonFamilySpouseEdge,
	PersonFamilySummary,
} from "../../../src/lib/tanahpedia/types";

jest.mock("next/link", () => ({
	__esModule: true,
	default({ href, children }: { href: string; children: React.ReactNode }) {
		return <a href={href}>{children}</a>;
	},
}));

function related(
	id: string,
	name: string,
	entryUniqueName: string | null = `entry-${id}`,
	sex: string | null = null,
) {
	return {
		personId: `pid-${id}`,
		entityId: id,
		displayName: name,
		entryUniqueName,
		entryTitle: name,
		sex,
	};
}

const baseSummary: PersonFamilySummary = {
	focalPersonId: "fp",
	focalEntityId: "fe",
	focalDisplayName: "שמשון",
	focalSex: null,
	focalBirthYyyymmdd: null,
	parents: [],
	children: [],
	spouses: [],
	siblings: [],
};

function spouseEdge({
	id,
	name,
	unionType = "MARRIAGE",
	unionOrder = 1,
	altGroupId = null,
	sourceCitation = null,
	personSourceCitation = null,
	unionEndReason = null,
	unionStartDate = null,
	unionEndDate = null,
}: {
	id: string;
	name: string;
	unionType?: string;
	unionOrder?: number | null;
	altGroupId?: string | null;
	sourceCitation?: string | null;
	personSourceCitation?: string | null;
	unionEndReason?: string | null;
	unionStartDate?: number | string | null;
	unionEndDate?: number | string | null;
}): PersonFamilySpouseEdge {
	return {
		related: related(id, name, `entry-${id}`, "FEMALE"),
		unionType,
		unionOrder,
		altGroupId,
		sourceCitation,
		personSourceCitation,
		unionEndReason,
		unionStartDate,
		unionEndDate,
	};
}

function childEdge({
	id,
	name,
	altGroupId = null,
	sourceCitation = null,
	coParentEntityId = null,
	coParentDisplayName = null,
	coParentUnionOrder = null,
	relationshipType = "BIOLOGICAL",
}: {
	id: string;
	name: string;
	altGroupId?: string | null;
	sourceCitation?: string | null;
	coParentEntityId?: string | null;
	coParentDisplayName?: string | null;
	coParentUnionOrder?: number | null;
	relationshipType?: string;
}): PersonFamilyChildEdge {
	return {
		related: related(id, name, `entry-${id}`, "MALE"),
		parentRole: "FATHER",
		relationshipType,
		altGroupId,
		sourceCitation,
		coParentEntityId,
		coParentDisplayName,
		coParentUnionOrder,
	};
}

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
					related: related("s1", "דלילה", `entry-s1`, "FEMALE"),
					unionType: "MARRIAGE",
					unionOrder: 1,
					altGroupId: null,
					sourceCitation: null,
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
			],
			children: [
				{
					related: related("c1", "ילד", `entry-c1`, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
					coParentEntityId: null,
					coParentDisplayName: null,
					coParentUnionOrder: null,
				},
			],
			siblings: [related("sb", "אח", null, "MALE")],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getByRole("region", { name: /משפחה/i })).toBeTruthy();
		expect(screen.getByText("הורים")).toBeInTheDocument();
		expect(screen.getByText("בנות זוג")).toBeInTheDocument();
		expect(screen.getByText("ילדים")).toBeInTheDocument();
		expect(screen.getByText("אח")).toBeInTheDocument();
		expect(screen.getAllByText("אחים").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText("שמשון").parentElement).toHaveAttribute(
			"data-has-sex-mark",
			"",
		);
		expect(screen.getByText("דלילה").parentElement).toHaveAttribute(
			"data-has-sex-mark",
			"",
		);
		expect(screen.getByText("מנוח").parentElement).not.toHaveAttribute(
			"data-has-sex-mark",
		);
		const childCard = screen.getByTestId("family-child-card");
		expect(childCard).toHaveTextContent("ילד");
		expect(childCard.textContent).not.toMatch(/\bאב\b/);
	});

	it("marks equal parent columns and the responsive spouse-only layout", () => {
		const parent = (id: string, name: string, role: "FATHER" | "MOTHER") => ({
			related: related(id, name),
			parentRole: role,
			relationshipType: "BIOLOGICAL",
			altGroupId: null,
			sourceCitation: null,
		});
		const summary: PersonFamilySummary = {
			...baseSummary,
			parents: [
				parent("father", "מנוח", "FATHER"),
				parent("mother", "הצללפוני", "MOTHER"),
			],
			spouses: [
				spouseEdge({ id: "spouse-1", name: "בת פלשתים מתמנתה" }),
				spouseEdge({ id: "spouse-2", name: "אשת שמשון מעזה", unionOrder: 2 }),
				spouseEdge({ id: "spouse-3", name: "דלילה", unionOrder: 3 }),
			],
		};

		const { container } = render(<PersonFamilyTree summary={summary} />);

		expect(container.querySelector('[data-parent-count="2"]')).not.toBeNull();
		expect(
			container.querySelector('[data-spouse-layout="spouse-only"]'),
		).not.toBeNull();
		expect(screen.getAllByTestId("family-spouse-card")).toHaveLength(3);
	});

	it("renders a child's own source citation inside its card box, not as an external ribbon", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			children: [
				childEdge({
					id: "c-reuven",
					name: "ראובן",
					sourceCitation: "בראשית כט לב",
				}),
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		const childCard = screen.getByTestId("family-child-card");
		expect(childCard).toHaveTextContent("ראובן");
		expect(childCard).toHaveTextContent("בראשית כט לב");
	});

	it("renders a spouse's own source citation inside its card box, alongside (not instead of) the relationship citation", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				spouseEdge({
					id: "bilhah",
					name: "בלהה",
					unionOrder: 3,
					sourceCitation: "הכתב והקבלה בראשית לב כג",
					personSourceCitation: "בראשית ל ד",
				}),
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		const spouseCard = screen.getByTestId("family-spouse-card");
		expect(spouseCard).toHaveTextContent("בלהה");
		expect(spouseCard).toHaveTextContent("בראשית ל ד");
		expect(spouseCard).not.toHaveTextContent("הכתב והקבלה");
		expect(screen.getByText("הכתב והקבלה בראשית לב כג")).toBeInTheDocument();
	});

	it("renders a spouse's own citation only once when it matches the relationship citation (no external ribbon)", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				spouseEdge({
					id: "leah",
					name: "לאה",
					unionOrder: 1,
					sourceCitation: null,
					personSourceCitation: "בראשית כט כג",
				}),
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		const spouseCard = screen.getByTestId("family-spouse-card");
		expect(spouseCard).toHaveTextContent("לאה");
		expect(spouseCard).toHaveTextContent("בראשית כט כג");
		expect(screen.getAllByText("בראשית כט כג")).toHaveLength(1);
	});

	it("shows אחים מבוגרים and אחים צעירים when sibling birth dates bracket focal", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalBirthYyyymmdd: 20000101,
			siblings: [
				{
					...related("old", "אח מבוגר", null, "MALE"),
					birthDateYyyymmdd: 19950101,
				},
				{
					...related("young", "אח צעיר", null, "MALE"),
					birthDateYyyymmdd: 20050101,
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getByText("אחים מבוגרים")).toBeInTheDocument();
		expect(screen.getByText("אחים צעירים")).toBeInTheDocument();
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
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
				{
					related: related("s1", "דלילה"),
					unionType: "FORBIDDEN_WITH_GENTILE",
					unionOrder: 1,
					altGroupId: "g1",
					sourceCitation: 'רש"י',
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getByText("דלילה")).toBeInTheDocument();
		expect(screen.getByText('הרמב"ם: נישואין תקפים')).toBeInTheDocument();
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
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
				{
					related: related("s1", "דלילה"),
					unionType: "FORBIDDEN_WITH_GENTILE",
					unionOrder: 1,
					altGroupId: "other",
					sourceCitation: 'רש"י',
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(screen.getAllByText("דלילה").length).toBe(1);
		expect(screen.getByText('הרמב"ם: נישואין תקפים')).toBeInTheDocument();
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
					coParentEntityId: null,
					coParentDisplayName: null,
					coParentUnionOrder: null,
				},
				{
					related: related("c1", "ילד חלופי"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: "g2",
					sourceCitation: null,
					coParentEntityId: null,
					coParentDisplayName: null,
					coParentUnionOrder: null,
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
					personSourceCitation: null,
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

	it("wraps Tanach-style citation in a link to the perek page", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			parents: [
				{
					related: related("p1", "יצחק", `entry-p1`, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: "בראשית כח",
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		const link = screen.getByRole("link", { name: "בראשית כח" });
		expect(link.getAttribute("href")).toMatch(/^\/929\/\d+$/);
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

	it("aligns children under spouse columns with aria labels per co-parent", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				{
					related: related("e-leah", "לאה", `entry-leah`, "FEMALE"),
					unionType: "MARRIAGE",
					unionOrder: 1,
					altGroupId: null,
					sourceCitation: null,
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
				{
					related: related("e-rachel", "רחל", `entry-rachel`, "FEMALE"),
					unionType: "MARRIAGE",
					unionOrder: 2,
					altGroupId: null,
					sourceCitation: null,
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
			],
			children: [
				{
					related: related("c1", "ראובן", `entry-c1`, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
					coParentEntityId: "e-leah",
					coParentDisplayName: "לאה",
					coParentUnionOrder: 1,
				},
				{
					related: related("c2", "יוסף", `entry-c2`, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
					coParentEntityId: "e-rachel",
					coParentDisplayName: "רחל",
					coParentUnionOrder: 2,
				},
			],
		};
		render(<PersonFamilyTree summary={summary} />);
		expect(
			screen.getByRole("group", { name: /ילדים מ.לאה/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("group", { name: /ילדים מ.רחל/ }),
		).toBeInTheDocument();
	});

	it("sorts parents by role and renders unlinked names with relationship labels", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			parents: [
				{
					related: related("mother", "אם", null, "FEMALE"),
					parentRole: "MOTHER",
					relationshipType: "ADOPTIVE",
					altGroupId: null,
					sourceCitation: " ",
				},
				{
					related: related("father", "אב", null, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
				},
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		const parentRowText = screen
			.getByText("הורים")
			.closest("section")?.textContent;
		expect(parentRowText).toContain("אב");
		expect(parentRowText).toContain("אם");
		expect(parentRowText?.indexOf("אב")).toBeLessThan(
			parentRowText?.indexOf("אם") ?? Number.POSITIVE_INFINITY,
		);
		expect(screen.getByText(/מאמץ|מאמצת|אימוץ/)).toBeInTheDocument();
		expect(screen.getAllByText("אב").some((node) => node.closest("a"))).toBe(
			false,
		);
	});

	it("renders loose children in a separate spouse matrix column", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				{
					related: related("spouse", "לאה", `entry-spouse`, "FEMALE"),
					unionType: "MARRIAGE",
					unionOrder: 1,
					altGroupId: null,
					sourceCitation: null,
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
			],
			children: [
				{
					related: related("mapped", "בן ממופה", `entry-mapped`, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
					coParentEntityId: "spouse",
					coParentDisplayName: "לאה",
					coParentUnionOrder: 1,
				},
				{
					related: related("loose", "בן ללא מיפוי", null, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: "בראשית א\nבראשית ב",
					coParentEntityId: null,
					coParentDisplayName: null,
					coParentUnionOrder: null,
				},
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(
			screen.getByRole("group", { name: "ילדים ללא מיפוי מלא לבת זוג בגרף" }),
		).toBeInTheDocument();
		expect(screen.getByText("בן ללא מיפוי").closest("a")).toBeNull();
		expect(screen.getByRole("link", { name: "בראשית א" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "בראשית ב" })).toBeInTheDocument();
	});

	it("renders Jacob children in chronology swimlanes including loose children", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalDisplayName: "יעקב",
			focalSex: "MALE",
			spouses: [
				{
					related: related("leah", "לאה", `entry-leah`, "FEMALE"),
					unionType: "MARRIAGE",
					unionOrder: 1,
					altGroupId: null,
					sourceCitation: null,
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
				{
					related: related("rachel", "רחל", `entry-rachel`, "FEMALE"),
					unionType: "MARRIAGE",
					unionOrder: 2,
					altGroupId: null,
					sourceCitation: null,
					personSourceCitation: null,
					unionEndReason: null,
					unionStartDate: null,
					unionEndDate: null,
				},
			],
			children: [
				{
					related: related("reuven", "ראובן", `entry-reuven`, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
					coParentEntityId: "leah",
					coParentDisplayName: "לאה",
					coParentUnionOrder: 1,
				},
				{
					related: related("yosef", "יוסף", `entry-yosef`, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
					coParentEntityId: "rachel",
					coParentDisplayName: "רחל",
					coParentUnionOrder: 2,
				},
				{
					related: related("unknown", "ילד נוסף", null, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
					coParentEntityId: "unknown-mother",
					coParentDisplayName: "אם אחרת",
					coParentUnionOrder: null,
				},
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(screen.getByText("אחר")).toBeInTheDocument();
		expect(screen.getByText("ראובן")).toBeInTheDocument();
		expect(screen.getByText("יוסף")).toBeInTheDocument();
		expect(screen.getByText("ילד נוסף")).toBeInTheDocument();
	});

	it("groups non-matrix children by co-parent with named and unnamed buckets", () => {
		const sara = "\u05e9\u05e8\u05d4";
		const hagar = "\u05d4\u05d2\u05e8";
		const summary: PersonFamilySummary = {
			...baseSummary,
			children: [
				childEdge({
					id: "hagar-child",
					name: "\u05d9\u05dc\u05d3 \u05de\u05d4\u05d2\u05e8",
					coParentEntityId: "hagar",
					coParentDisplayName: hagar,
					coParentUnionOrder: 2,
				}),
				childEdge({
					id: "sara-child",
					name: "\u05d9\u05dc\u05d3 \u05de\u05e9\u05e8\u05d4",
					coParentEntityId: "sara",
					coParentDisplayName: sara,
					coParentUnionOrder: 1,
				}),
				childEdge({
					id: "unknown-child",
					name: "\u05d9\u05dc\u05d3 \u05dc\u05dc\u05d0 \u05d4\u05d5\u05e8\u05d4",
					coParentEntityId: null,
					coParentDisplayName: null,
					coParentUnionOrder: null,
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(screen.getAllByText(new RegExp(sara)).length).toBeGreaterThan(0);
		expect(screen.getAllByText(new RegExp(hagar)).length).toBeGreaterThan(0);
		expect(
			screen.getByText(/\u05dc\u05d0 \u05de\u05d6\u05d5\u05d4\u05d4/),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"\u05d9\u05dc\u05d3 \u05dc\u05dc\u05d0 \u05d4\u05d5\u05e8\u05d4",
			),
		).toBeInTheDocument();
	});

	it("orders same-partner spouse opinions by halachic rank and fallback union type", () => {
		const spouseName = "\u05d0\u05e9\u05d4";
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				spouseEdge({
					id: "spouse",
					name: spouseName,
					unionType: "UNKNOWN_CUSTOM",
					unionOrder: 1,
					altGroupId: "g1",
				}),
				spouseEdge({
					id: "spouse",
					name: spouseName,
					unionType: "BETROTHAL",
					unionOrder: 1,
					altGroupId: "g1",
					unionStartDate: "19000101",
				}),
				spouseEdge({
					id: "spouse",
					name: spouseName,
					unionType: "BANNED_INCEST",
					unionOrder: 1,
					altGroupId: "g1",
					unionEndDate: 19100101,
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(screen.getByText(spouseName)).toBeInTheDocument();
		expect(screen.getAllByText(/UNKNOWN_CUSTOM/).length).toBeGreaterThan(0);
		expect(screen.getByText(/1900-01-01/)).toBeInTheDocument();
		expect(screen.getByText(/1910-01-01/)).toBeInTheDocument();
	});

	it("renders Jacob chronology swimlanes when enough known children are present", () => {
		const leah = "\u05dc\u05d0\u05d4";
		const rachel = "\u05e8\u05d7\u05dc";
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalDisplayName: "\u05d9\u05e2\u05e7\u05d1",
			focalSex: "MALE",
			spouses: [
				spouseEdge({ id: "leah", name: leah, unionOrder: 1 }),
				spouseEdge({ id: "rachel", name: rachel, unionOrder: 2 }),
			],
			children: [
				childEdge({
					id: "yosef",
					name: "\u05d9\u05d5\u05e1\u05e3",
					coParentEntityId: "rachel",
					coParentDisplayName: rachel,
					coParentUnionOrder: 2,
				}),
				childEdge({
					id: "shimon",
					name: "\u05e9\u05de\u05e2\u05d5\u05df",
					coParentEntityId: "leah",
					coParentDisplayName: leah,
					coParentUnionOrder: 1,
				}),
				childEdge({
					id: "reuven",
					name: "\u05e8\u05d0\u05d5\u05d1\u05df",
					coParentEntityId: "leah",
					coParentDisplayName: leah,
					coParentUnionOrder: 1,
				}),
				childEdge({
					id: "dan",
					name: "\u05d3\u05df",
					coParentEntityId: "bilhah",
					coParentDisplayName: "\u05d1\u05dc\u05d4\u05d4",
					coParentUnionOrder: null,
				}),
				childEdge({
					id: "naftali",
					name: "\u05e0\u05e4\u05ea\u05dc\u05d9",
					coParentEntityId: "bilhah",
					coParentDisplayName: "\u05d1\u05dc\u05d4\u05d4",
					coParentUnionOrder: null,
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(screen.getByText("\u05d0\u05d7\u05e8")).toBeInTheDocument();
		expect(
			screen.getByText("\u05e8\u05d0\u05d5\u05d1\u05df"),
		).toBeInTheDocument();
		expect(
			screen.getByText("\u05e9\u05de\u05e2\u05d5\u05df"),
		).toBeInTheDocument();
		expect(screen.getByText("\u05d9\u05d5\u05e1\u05e3")).toBeInTheDocument();
		expect(screen.getByText("\u05d3\u05df")).toBeInTheDocument();
		expect(
			screen.getByText("\u05e0\u05e4\u05ea\u05dc\u05d9"),
		).toBeInTheDocument();
	});

	it("measures spouse matrix rows with ResizeObserver and disconnects on unmount", () => {
		const originalResizeObserver = global.ResizeObserver;
		const observe = jest.fn();
		const disconnect = jest.fn();

		class MockResizeObserver {
			observe = observe;
			disconnect = disconnect;
		}

		global.ResizeObserver =
			MockResizeObserver as unknown as typeof ResizeObserver;

		const originalGetBoundingClientRect =
			HTMLElement.prototype.getBoundingClientRect;
		HTMLElement.prototype.getBoundingClientRect = function () {
			const isSpouseCard = this.hasAttribute("data-matrix-spouse-card");
			return {
				width: isSpouseCard ? 80 : 300,
				height: isSpouseCard ? 40 : 100,
				top: isSpouseCard ? 30 : 0,
				left: isSpouseCard ? 50 : 0,
				right: isSpouseCard ? 130 : 300,
				bottom: isSpouseCard ? 70 : 100,
				x: isSpouseCard ? 50 : 0,
				y: isSpouseCard ? 30 : 0,
				toJSON: () => ({}),
			} as DOMRect;
		};

		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [spouseEdge({ id: "leah", name: "\u05dc\u05d0\u05d4" })],
			children: [
				childEdge({
					id: "mapped",
					name: "\u05d9\u05dc\u05d3 \u05de\u05de\u05d5\u05e4\u05d4",
					coParentEntityId: "leah",
					coParentDisplayName: "\u05dc\u05d0\u05d4",
					coParentUnionOrder: 1,
				}),
			],
		};

		const { unmount } = render(<PersonFamilyTree summary={summary} />);

		expect(observe).toHaveBeenCalled();
		unmount();
		expect(disconnect).toHaveBeenCalled();

		HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
		global.ResizeObserver = originalResizeObserver;
	});

	it("renders matrix when ResizeObserver is unavailable", () => {
		const originalResizeObserver = global.ResizeObserver;
		global.ResizeObserver = undefined as unknown as typeof ResizeObserver;

		try {
			const summary: PersonFamilySummary = {
				...baseSummary,
				focalSex: "MALE",
				spouses: [spouseEdge({ id: "leah", name: "\u05dc\u05d0\u05d4" })],
				children: [
					childEdge({
						id: "mapped",
						name: "\u05d9\u05dc\u05d3 \u05de\u05de\u05d5\u05e4\u05d4",
						coParentEntityId: "leah",
						coParentDisplayName: "\u05dc\u05d0\u05d4",
						coParentUnionOrder: 1,
					}),
				],
			};

			render(<PersonFamilyTree summary={summary} />);

			expect(
				screen.getByRole("group", { name: /\u05dc\u05d0\u05d4/ }),
			).toBeInTheDocument();
		} finally {
			global.ResizeObserver = originalResizeObserver;
		}
	});

	it("sorts mixed parent alt groups with default parents first", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			parents: [
				{
					related: related(
						"alt-mother",
						"\u05d0\u05dd \u05d7\u05dc\u05d5\u05e4\u05d9\u05ea",
						null,
						"FEMALE",
					),
					parentRole: "MOTHER",
					relationshipType: "ADOPTIVE",
					altGroupId: "alt",
					sourceCitation: null,
				},
				{
					related: related("father", "\u05d0\u05d1", null, "MALE"),
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					altGroupId: null,
					sourceCitation: null,
				},
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		const parentSectionText =
			screen.getByText("\u05d4\u05d5\u05e8\u05d9\u05dd").closest("section")
				?.textContent ?? "";
		expect(parentSectionText.indexOf("\u05d0\u05d1")).toBeLessThan(
			parentSectionText.indexOf(
				"\u05d0\u05dd \u05d7\u05dc\u05d5\u05e4\u05d9\u05ea",
			),
		);
		expect(
			screen.getAllByText("\u05d7\u05dc\u05d5\u05e4\u05d9").length,
		).toBeGreaterThan(0);
	});

	it("sorts co-parent child buckets by display name when union order is absent", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			children: [
				childEdge({
					id: "child-z",
					name: "\u05d9\u05dc\u05d3 \u05d6",
					coParentEntityId: "z-parent",
					coParentDisplayName: "\u05d6\u05dc\u05e4\u05d4",
				}),
				childEdge({
					id: "child-a",
					name: "\u05d9\u05dc\u05d3 \u05d0",
					coParentEntityId: "a-parent",
					coParentDisplayName: "\u05d0\u05d4\u05d5\u05d1\u05d4",
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		const treeText =
			screen.getByRole("region", { name: /\u05de\u05e9\u05e4\u05d7\u05d4/ })
				.textContent ?? "";
		expect(treeText.indexOf("\u05d0\u05d4\u05d5\u05d1\u05d4")).toBeLessThan(
			treeText.indexOf("\u05d6\u05dc\u05e4\u05d4"),
		);
	});

	it("shows a co-parent subtitle for a single named child bucket", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			children: [
				childEdge({
					id: "only-child",
					name: "\u05d9\u05dc\u05d3",
					coParentEntityId: "named-parent",
					coParentDisplayName:
						"\u05d4\u05d5\u05e8\u05d4 \u05de\u05d6\u05d5\u05d4\u05d4",
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(
			screen.getByText(
				/\u05d4\u05d5\u05e8\u05d4 \u05de\u05d6\u05d5\u05d4\u05d4/,
			),
		).toBeInTheDocument();
	});

	it("sorts ungrouped non-matrix children by display name", () => {
		const firstChild = "\u05d0\u05dc\u05e3";
		const secondChild = "\u05d1\u05d9\u05ea";
		const summary: PersonFamilySummary = {
			...baseSummary,
			children: [
				childEdge({ id: "second", name: secondChild }),
				childEdge({ id: "first", name: firstChild }),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		const childTexts = screen
			.getAllByTestId("family-child-card")
			.map((card) => card.textContent ?? "");
		expect(childTexts[0]).toContain(firstChild);
		expect(childTexts[1]).toContain(secondChild);
		expect(
			screen.queryByText(/\u05dc\u05d0 \u05de\u05d6\u05d5\u05d4\u05d4/),
		).not.toBeInTheDocument();
	});

	it("orders child co-parent buckets by known union order before name and unknown", () => {
		const orderedParent =
			"\u05d4\u05d5\u05e8\u05d4 \u05e8\u05d0\u05e9\u05d5\u05df";
		const namedParent = "\u05d4\u05d5\u05e8\u05d4 \u05e9\u05e0\u05d9";
		const looseChild = "\u05d9\u05dc\u05d3 \u05dc\u05dc\u05d0";
		const summary: PersonFamilySummary = {
			...baseSummary,
			children: [
				childEdge({
					id: "named",
					name: "\u05d9\u05dc\u05d3 \u05de\u05d4\u05d5\u05e8\u05d4 \u05e9\u05e0\u05d9",
					coParentEntityId: "named-parent",
					coParentDisplayName: namedParent,
				}),
				childEdge({
					id: "loose",
					name: looseChild,
					coParentEntityId: null,
					coParentDisplayName: null,
				}),
				childEdge({
					id: "ordered",
					name: "\u05d9\u05dc\u05d3 \u05de\u05d4\u05d5\u05e8\u05d4 \u05e8\u05d0\u05e9\u05d5\u05df",
					coParentEntityId: "ordered-parent",
					coParentDisplayName: orderedParent,
					coParentUnionOrder: 1,
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		const treeText =
			screen.getByRole("region", { name: /\u05de\u05e9\u05e4\u05d7\u05d4/ })
				.textContent ?? "";
		expect(treeText.indexOf(orderedParent)).toBeLessThan(
			treeText.indexOf(namedParent),
		);
		expect(treeText.indexOf(namedParent)).toBeLessThan(
			treeText.indexOf(looseChild),
		);
	});

	it("keeps unknown co-parent child buckets after identified buckets", () => {
		const orderedChild =
			"\u05d9\u05dc\u05d3 \u05de\u05d4\u05d5\u05e8\u05d4 \u05de\u05e1\u05d5\u05d3\u05e8";
		const unnamedChild =
			"\u05d9\u05dc\u05d3 \u05de\u05d4\u05d5\u05e8\u05d4 \u05dc\u05dc\u05d0 \u05e9\u05dd";
		const looseChild = "\u05d9\u05dc\u05d3 \u05d7\u05d5\u05e4\u05e9\u05d9";
		const summary: PersonFamilySummary = {
			...baseSummary,
			children: [
				childEdge({
					id: "loose-first",
					name: looseChild,
					coParentEntityId: null,
					coParentDisplayName: null,
				}),
				childEdge({
					id: "unnamed-parent",
					name: unnamedChild,
					coParentEntityId: "unnamed-parent",
					coParentDisplayName: null,
				}),
				childEdge({
					id: "ordered-parent",
					name: orderedChild,
					coParentEntityId: "ordered-parent",
					coParentDisplayName:
						"\u05d4\u05d5\u05e8\u05d4 \u05de\u05e1\u05d5\u05d3\u05e8",
					coParentUnionOrder: 1,
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		const treeText =
			screen.getByRole("region", { name: /\u05de\u05e9\u05e4\u05d7\u05d4/ })
				.textContent ?? "";
		expect(treeText.indexOf(orderedChild)).toBeLessThan(
			treeText.indexOf(unnamedChild),
		);
		expect(treeText.indexOf(unnamedChild)).toBeLessThan(
			treeText.indexOf(looseChild),
		);
	});

	it("shows child relationship ribbons without requiring a citation", () => {
		const childName = "\u05d9\u05dc\u05d3 \u05de\u05d0\u05d5\u05de\u05e5";
		const summary: PersonFamilySummary = {
			...baseSummary,
			children: [
				childEdge({
					id: "adopted",
					name: childName,
					relationshipType: "ADOPTIVE",
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		const childCard = screen.getByTestId("family-child-card");
		expect(childCard).toHaveTextContent(childName);
		expect(childCard).toHaveTextContent("\u05d0\u05d9\u05de\u05d5\u05e5");
	});

	it("sorts non-Jacob matrix children and renders empty spouse columns", () => {
		const leah = "\u05dc\u05d0\u05d4";
		const rachel = "\u05e8\u05d7\u05dc";
		const firstChild = "\u05d0\u05dc\u05e3";
		const secondChild = "\u05d1\u05d9\u05ea";
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				spouseEdge({ id: "leah", name: leah, unionOrder: 1 }),
				spouseEdge({ id: "rachel", name: rachel, unionOrder: 2 }),
			],
			children: [
				childEdge({
					id: "second",
					name: secondChild,
					coParentEntityId: "leah",
					coParentDisplayName: leah,
					coParentUnionOrder: 1,
				}),
				childEdge({
					id: "first",
					name: firstChild,
					coParentEntityId: "leah",
					coParentDisplayName: leah,
					coParentUnionOrder: 1,
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(
			screen.getByRole("group", { name: new RegExp(leah) }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("group", { name: new RegExp(rachel) }),
		).toBeInTheDocument();
		const treeText =
			screen.getByRole("region", { name: /\u05de\u05e9\u05e4\u05d7\u05d4/ })
				.textContent ?? "";
		expect(treeText.indexOf(firstChild)).toBeLessThan(
			treeText.indexOf(secondChild),
		);
	});

	it("renders single-spouse timeline blocks without order ribbons", () => {
		const spouseName =
			"\u05d0\u05e9\u05d4 \u05d7\u05dc\u05d5\u05e4\u05d9\u05ea";
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				spouseEdge({
					id: "alternate",
					name: spouseName,
					unionOrder: null,
					altGroupId: "alt-spouse",
					unionEndDate: 19000101,
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(screen.getByText(spouseName)).toBeInTheDocument();
		expect(screen.getByText(/1900-01-01/)).toBeInTheDocument();
		expect(screen.queryByText(/\u05e1\u05d3\u05e8/)).not.toBeInTheDocument();
	});

	it("fuses reversed forbidden rows and sorts same-rank spouse opinions", () => {
		const fusedName = "\u05d6\u05d9\u05d5\u05d5\u05d2 \u05d4\u05e4\u05d5\u05da";
		const customName =
			"\u05d3\u05e2\u05d4 \u05de\u05d5\u05ea\u05d0\u05de\u05ea";
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				spouseEdge({
					id: "fused",
					name: fusedName,
					unionType: "FORBIDDEN_WITH_GENTILE",
					unionOrder: 1,
				}),
				spouseEdge({
					id: "fused",
					name: fusedName,
					unionType: "MARRIAGE",
					unionOrder: 1,
				}),
				spouseEdge({
					id: "custom",
					name: customName,
					unionType: "ZZZ_CUSTOM",
					unionOrder: null,
					altGroupId: "custom",
				}),
				spouseEdge({
					id: "custom",
					name: customName,
					unionType: "AAA_CUSTOM",
					unionOrder: null,
					altGroupId: "custom",
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(screen.getAllByText(fusedName).length).toBe(1);
		const treeText =
			screen.getByRole("region", { name: /\u05de\u05e9\u05e4\u05d7\u05d4/ })
				.textContent ?? "";
		expect(treeText.indexOf("AAA_CUSTOM")).toBeLessThan(
			treeText.indexOf("ZZZ_CUSTOM"),
		);
	});

	it("sorts same-role parents inside an alternate parent group by display name", () => {
		const firstParent = "\u05d0\u05dd \u05d0";
		const secondParent = "\u05d0\u05dd \u05d1";
		const summary: PersonFamilySummary = {
			...baseSummary,
			parents: [
				{
					related: related("second-parent", secondParent, null, "FEMALE"),
					parentRole: "MOTHER",
					relationshipType: "ADOPTIVE",
					altGroupId: "alt",
					sourceCitation: null,
				},
				{
					related: related("first-parent", firstParent, null, "FEMALE"),
					parentRole: "MOTHER",
					relationshipType: "STEP",
					altGroupId: "alt",
					sourceCitation: null,
				},
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		const treeText =
			screen.getByRole("region", { name: /\u05de\u05e9\u05e4\u05d7\u05d4/ })
				.textContent ?? "";
		expect(treeText.indexOf(firstParent)).toBeLessThan(
			treeText.indexOf(secondParent),
		);
	});

	it("renders Jacob child ordering without spouse data and without a loose matrix column", () => {
		const leah = "\u05dc\u05d0\u05d4";
		const rachel = "\u05e8\u05d7\u05dc";
		const jacobChildren = [
			childEdge({
				id: "yosef",
				name: "\u05d9\u05d5\u05e1\u05e3",
				coParentEntityId: "rachel",
				coParentDisplayName: rachel,
				coParentUnionOrder: 2,
			}),
			childEdge({
				id: "shimon",
				name: "\u05e9\u05de\u05e2\u05d5\u05df",
				coParentEntityId: "leah",
				coParentDisplayName: leah,
				coParentUnionOrder: 1,
			}),
			childEdge({
				id: "reuven",
				name: "\u05e8\u05d0\u05d5\u05d1\u05df",
				coParentEntityId: "leah",
				coParentDisplayName: leah,
				coParentUnionOrder: 1,
			}),
			childEdge({
				id: "levi",
				name: "\u05dc\u05d5\u05d9",
				coParentEntityId: "leah",
				coParentDisplayName: leah,
				coParentUnionOrder: 1,
			}),
			childEdge({
				id: "yehuda",
				name: "\u05d9\u05d4\u05d5\u05d3\u05d4",
				coParentEntityId: "leah",
				coParentDisplayName: leah,
				coParentUnionOrder: 1,
			}),
		];

		const { rerender } = render(
			<PersonFamilyTree
				summary={{
					...baseSummary,
					focalDisplayName: "\u05d9\u05e2\u05e7\u05d1",
					children: jacobChildren,
				}}
			/>,
		);

		let treeText =
			screen.getByRole("region", { name: /\u05de\u05e9\u05e4\u05d7\u05d4/ })
				.textContent ?? "";
		expect(treeText.indexOf("\u05e8\u05d0\u05d5\u05d1\u05df")).toBeLessThan(
			treeText.indexOf("\u05e9\u05de\u05e2\u05d5\u05df"),
		);
		expect(treeText.indexOf("\u05e9\u05de\u05e2\u05d5\u05df")).toBeLessThan(
			treeText.indexOf("\u05d9\u05d5\u05e1\u05e3"),
		);

		rerender(
			<PersonFamilyTree
				summary={{
					...baseSummary,
					focalDisplayName: "\u05d9\u05e2\u05e7\u05d1",
					focalSex: "MALE",
					spouses: [
						spouseEdge({ id: "leah", name: leah, unionOrder: 1 }),
						spouseEdge({ id: "rachel", name: rachel, unionOrder: 2 }),
					],
					children: jacobChildren,
				}}
			/>,
		);

		treeText =
			screen.getByRole("region", { name: /\u05de\u05e9\u05e4\u05d7\u05d4/ })
				.textContent ?? "";
		expect(treeText).not.toContain("\u05d0\u05d7\u05e8");
		expect(screen.getByText("\u05d9\u05d5\u05e1\u05e3")).toBeInTheDocument();
	});

	it("keeps incompatible spouse rows separate when they cannot be fused", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				spouseEdge({
					id: "same-order-a",
					name: "\u05d0\u05d5\u05e8\u05d4",
					unionType: "MARRIAGE",
					unionOrder: 1,
				}),
				spouseEdge({
					id: "same-order-b",
					name: "\u05d1\u05e8\u05d4",
					unionType: "FORBIDDEN_WITH_GENTILE",
					unionOrder: 1,
				}),
				spouseEdge({
					id: "same-partner",
					name: "\u05d2\u05d9\u05dc\u05d4",
					unionType: "MARRIAGE",
					unionOrder: 2,
				}),
				spouseEdge({
					id: "same-partner",
					name: "\u05d2\u05d9\u05dc\u05d4",
					unionType: "FORBIDDEN_WITH_GENTILE",
					unionOrder: 3,
				}),
				spouseEdge({
					id: "non-comp",
					name: "\u05d3\u05dc\u05d9\u05d4",
					unionType: "MARRIAGE",
					unionOrder: 4,
				}),
				spouseEdge({
					id: "non-comp",
					name: "\u05d3\u05dc\u05d9\u05d4",
					unionType: "BETROTHAL",
					unionOrder: 4,
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(screen.getByText("\u05d0\u05d5\u05e8\u05d4")).toBeInTheDocument();
		expect(screen.getByText("\u05d1\u05e8\u05d4")).toBeInTheDocument();
		expect(screen.getAllByText("\u05d2\u05d9\u05dc\u05d4").length).toBe(2);
		expect(screen.getAllByText("\u05d3\u05dc\u05d9\u05d4").length).toBe(2);
	});

	it("renders spouse opinions without order ribbons when order is absent", () => {
		const summary: PersonFamilySummary = {
			...baseSummary,
			focalSex: "MALE",
			spouses: [
				spouseEdge({
					id: "spouse",
					name: "\u05d0\u05e9\u05d4",
					unionType: "MARRIAGE",
					unionOrder: null,
					altGroupId: "same",
				}),
				spouseEdge({
					id: "spouse",
					name: "\u05d0\u05e9\u05d4",
					unionType: "BETROTHAL",
					unionOrder: null,
					altGroupId: "same",
				}),
			],
		};

		render(<PersonFamilyTree summary={summary} />);

		expect(screen.getByText("\u05d0\u05e9\u05d4")).toBeInTheDocument();
		expect(screen.queryByText(/\u05e1\u05d3\u05e8/)).not.toBeInTheDocument();
		expect(
			screen.getAllByText(/\u05d0\u05d9\u05e8\u05d5\u05e1\u05d9\u05df/).length,
		).toBeGreaterThan(0);
	});
});
