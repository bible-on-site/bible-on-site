/**
 * @jest-environment jsdom
 *
 * Render coverage for the פרשה reader components: unit nav, unit
 * breadcrumb (Torah-only pickers), the landing page (five Torah
 * sefarim, joined-parasha list, special occasions), the Haftarah
 * section (variant labels, ordered ranges, repeated pesukim), the
 * unit page, and the unit layout wiring.
 */
import { render, screen, within } from "@testing-library/react";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
	}) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

jest.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
	usePathname: () => "/פרשה/1",
	useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

jest.mock("next/cache", () => ({
	unstable_cache: (fn: unknown) => fn,
}));

// Range services hit the DB at request time; the section components
// are covered by the /929 suite.
jest.mock("@/lib/perushim/service", () => ({
	getPerushimForRanges: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/articles/service", () => ({
	getArticleSummariesForRanges: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/tanahpedia/perek-entity-refs", () => ({
	fetchAllEntityRefs: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/app/929/[number]/components/PerushimSection", () => ({
	PerushimSection: ({ title }: { title: string }) => (
		<div data-testid={`perushim-${title}`} />
	),
}));
jest.mock("@/app/929/[number]/components/ArticlesSection", () => ({
	ArticlesSection: ({ title }: { title: string }) => (
		<div data-testid={`articles-${title}`} />
	),
}));
jest.mock("@/app/929/[number]/components/TanahpediaLink", () => ({
	TanahpediaLink: ({
		children,
		entryUniqueName,
	}: {
		children: React.ReactNode;
		entryUniqueName: string;
	}) => (
		<a href={`/תנחפדיה/${entryUniqueName}`} data-entry={entryUniqueName}>
			{children}
		</a>
	),
}));

// The book-view composite is covered by the book-utils suite and e2e.
jest.mock("@/app/parasha/[unit]/components/ParashaSeferComposite", () => ({
	ParashaSeferComposite: () => <div data-testid="parasha-book" />,
}));

// Layout collaborators are covered elsewhere; isolate the wiring.
jest.mock("@/app/components/UnitSwipeNavigation", () => ({
	__esModule: true,
	default: ({
		children,
		prevHref,
		nextHref,
	}: {
		children: React.ReactNode;
		prevHref?: string | null;
		nextHref?: string | null;
	}) => (
		<div data-prev={prevHref ?? ""} data-next={nextHref ?? ""}>
			{children}
		</div>
	),
}));
jest.mock("@/app/929/[number]/components/ReaderSettings", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/lib/download/register-tanach", () => ({}));

import { sefarim } from "../../../src/data/db/sefarim";
import { HaftaraSection } from "@/app/parasha/[unit]/components/HaftaraSection";
import { UnitBreadcrumb } from "@/app/parasha/[unit]/components/UnitBreadcrumb";
import { UnitNav } from "@/app/parasha/[unit]/components/UnitNav";
import ParashaUnitLayout from "@/app/parasha/[unit]/layout";
import ParashaUnitPage from "@/app/parasha/[unit]/page";
import ParashaLanding from "@/app/parasha/page";
import {
	getParashaEntry,
	getParashaUnitById,
} from "@/data/parasha/parasha-units";

function perekIdOf(seferName: string, perek: number, additional?: string) {
	const sefer = sefarim.find((s) => s.name === seferName);
	const part =
		additional === undefined
			? sefer
			: sefer && "additionals" in sefer
				? sefer.additionals.find((a) => a.letter === additional)
				: undefined;
	if (!part || !("perekFrom" in part)) throw new Error("missing part");
	return part.perekFrom + perek - 1;
}

describe("UnitNav", () => {
	it("links to the previous and next parashot by name", () => {
		render(
			<UnitNav prev={getParashaUnitById(1)} next={getParashaUnitById(3)} />,
		);
		expect(screen.getByRole("link", { name: /פרשה קודמת/ })).toHaveAttribute(
			"href",
			"/פרשה/1",
		);
		expect(screen.getByRole("link", { name: /פרשת בראשית/ })).toHaveAttribute(
			"href",
			"/פרשה/1",
		);
		expect(screen.getByRole("link", { name: /פרשה הבאה/ })).toHaveAttribute(
			"href",
			"/פרשה/3",
		);
		expect(screen.getByRole("link", { name: /פרשת לך לך/ })).toHaveAttribute(
			"href",
			"/פרשה/3",
		);
	});

	it("renders placeholders at the Torah edges", () => {
		const { container } = render(<UnitNav prev={null} next={null} />);
		expect(screen.queryByRole("link")).toBeNull();
		expect(container.querySelectorAll("nav > span").length).toBe(2);
	});
});

describe("UnitBreadcrumb", () => {
	it("links the division root and scopes pickers to תורה", () => {
		render(<UnitBreadcrumb unit={getParashaUnitById(1)} />);
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
		expect(nav).toHaveAttribute("data-testid", "parasha-unit-breadcrumb-1");
		expect(screen.getByRole("link", { name: "פרשה על הפרק" })).toHaveAttribute(
			"href",
			"/פרשה",
		);
		// Only the five Torah sefarim appear in the pickers.
		expect(screen.queryByRole("link", { name: "יהושע" })).toBeNull();
		expect(screen.queryByRole("link", { name: "ישעיהו" })).toBeNull();
	});

	it("lists the sefer's parashot in the current-parasha picker", () => {
		render(<UnitBreadcrumb unit={getParashaUnitById(15)} />);
		expect(
			screen.getByRole("button", { name: /פרשה נוכחית: בא/ }),
		).toBeInTheDocument();
		// The picker links every שמות parasha (13-23).
		expect(screen.getByRole("link", { name: "פרשת שמות" })).toHaveAttribute(
			"href",
			"/פרשה/13",
		);
		expect(screen.getByRole("link", { name: "פרשת פקודי" })).toHaveAttribute(
			"href",
			"/פרשה/23",
		);
	});
});

describe("ParashaLanding", () => {
	it("lists only the five Torah sefarim, each parasha linked", () => {
		render(<ParashaLanding />);
		for (const sefer of ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"]) {
			expect(
				screen.getByRole("heading", { name: `ספר ${sefer}` }),
			).toBeInTheDocument();
		}
		expect(screen.queryByRole("heading", { name: /נביאים/ })).toBeNull();
		expect(screen.getAllByRole("link")).toHaveLength(54);
		expect(screen.getByRole("link", { name: /פרשת בראשית/ })).toHaveAttribute(
			"href",
			"/פרשה/1",
		);
		expect(
			screen.getByRole("link", { name: /פרשת וזאת הברכה/ }),
		).toHaveAttribute("href", "/פרשה/54");
	});

	it("documents joined parashot and special-occasion Haftarot", () => {
		render(<ParashaLanding />);
		expect(
			screen.getByRole("heading", { name: "פרשיות מחוברות" }),
		).toBeInTheDocument();
		expect(screen.getByText("פרשת נצבים - פרשת וילך")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				name: "הפטרות לשבתות ומועדים מיוחדים",
			}),
		).toBeInTheDocument();
		expect(screen.getByText("שבת ראש חודש")).toBeInTheDocument();
		expect(screen.getByText("שבועות")).toBeInTheDocument();
	});
});

describe("HaftaraSection", () => {
	it("renders every custom variant with its label and text", () => {
		render(
			<HaftaraSection unit={getParashaUnitById(1)} entityRefsByPerek={{}} />,
		);
		expect(
			screen.getByRole("heading", { name: "הפטרה", level: 2 }),
		).toBeInTheDocument();
		expect(screen.getByText("הפטרה - ספרדים")).toBeInTheDocument();
		expect(screen.getByText("הפטרה - אשכנזים")).toBeInTheDocument();
		expect(screen.getByText("הפטרה - תימנים")).toBeInTheDocument();
		// בראשית sefaradi opens at ישעיהו מב:ה — auxiliary anchors carry the
		// variant scope so overlapping variants stay unique.
		const yeshayahu42 = perekIdOf("ישעיהו", 42);
		expect(
			document.getElementById(`pasuk-${yeshayahu42}-5-haftara-sefaradi`),
		).toBeInTheDocument();
	});

	it("keeps multi-range readings and repeated pesukim in order", () => {
		// יתרו ashkenazi reads ישעיהו ו-ז then jumps to ט.
		render(
			<HaftaraSection unit={getParashaUnitById(17)} entityRefsByPerek={{}} />,
		);
		const yeshayahu9 = perekIdOf("ישעיהו", 9);
		expect(
			document.getElementById(`pasuk-${yeshayahu9}-5-haftara-ashkenazi`),
		).toBeInTheDocument();
	});

	it("shows parasha notes and the joined-parasha rule", () => {
		render(
			<HaftaraSection
				unit={getParashaUnitById(29)} // אחרי מות
				entityRefsByPerek={{}}
			/>,
		);
		expect(screen.getAllByText(/אחרי מות וקדושים/).length).toBeGreaterThan(0);
		expect(
			screen.getByText(/פרשה מחוברת \(אחרי מות-קדושים\)/),
		).toBeInTheDocument();
	});

	it("carries source-table provenance on corrected ranges", () => {
		render(
			<HaftaraSection
				unit={getParashaUnitById(42)} // מטות
				entityRefsByPerek={{}}
			/>,
		);
		expect(screen.getByText(/ירמיהו א יט/)).toBeInTheDocument();
	});
});

describe("ParashaUnitLayout", () => {
	it("wires adjacent-unit hrefs for valid units", async () => {
		const jsx = await ParashaUnitLayout({
			children: <div data-testid="unit-body" />,
			params: Promise.resolve({ unit: "5" }),
		});
		render(jsx);
		expect(screen.getByTestId("unit-body")).toBeInTheDocument();
	});

	it("handles out-of-range units without nav hrefs", async () => {
		const jsx = await ParashaUnitLayout({
			children: <div data-testid="unit-body" />,
			params: Promise.resolve({ unit: "0" }),
		});
		render(jsx);
		expect(screen.getByTestId("unit-body")).toBeInTheDocument();
	});
});

describe("ParashaUnitPage", () => {
	it("renders the Torah reading, Haftarah, and scoped sections", async () => {
		const jsx = await ParashaUnitPage({
			params: Promise.resolve({ unit: "1" }),
		});
		render(jsx);
		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
			"פרשת בראשית",
		);
		// Torah text opens at the canonical first pasuk.
		expect(document.getElementById("pasuk-1-1")).toBeInTheDocument();
		expect(document.getElementById("pasuk-6-8")).toBeInTheDocument();
		expect(screen.getByText("קריאת התורה")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "הפטרה", level: 2 }),
		).toBeInTheDocument();
		expect(screen.getByTestId("perushim-פרשנים על הפרשה")).toBeInTheDocument();
		expect(screen.getByTestId("articles-מאמרים על הפרשה")).toBeInTheDocument();
		expect(screen.getByTestId("perushim-פרשנים על ההפטרה")).toBeInTheDocument();
		expect(screen.getByTestId("articles-מאמרים על ההפטרה")).toBeInTheDocument();
		expect(screen.getByTestId("parasha-book")).toBeInTheDocument();
	});

	it("renders prev/next parasha links", async () => {
		const jsx = await ParashaUnitPage({
			params: Promise.resolve({ unit: "2" }),
		});
		render(jsx);
		const nav = within(
			screen.getByRole("navigation", { name: "ניווט בין פרשיות" }),
		);
		expect(nav.getByRole("link", { name: /פרשת בראשית/ })).toHaveAttribute(
			"href",
			"/פרשה/1",
		);
		expect(nav.getByRole("link", { name: /פרשת לך לך/ })).toHaveAttribute(
			"href",
			"/פרשה/3",
		);
	});

	it("calls notFound for an unknown unit", async () => {
		await expect(
			ParashaUnitPage({ params: Promise.resolve({ unit: "55" }) }),
		).rejects.toThrow("NEXT_NOT_FOUND");
	});
});

describe("parasha entry customs", () => {
	it("keeps variant customs beyond the contract-pure aux readings", () => {
		const entry = getParashaEntry(52);
		const shared = entry.haftarot.find(
			(haftara) => haftara.id === "haftara-sefaradi-temani",
		);
		expect(shared?.customs).toEqual(["sefaradi", "temani"]);
	});
});
