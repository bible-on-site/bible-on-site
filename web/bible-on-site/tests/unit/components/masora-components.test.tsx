/**
 * @jest-environment jsdom
 *
 * Render coverage for the מסורה reader components: unit nav, unit
 * breadcrumb (link vs. plain-text fallbacks), unit text slices
 * (incl. Tanahpedia entity refs), the unit layout wiring, the landing
 * page, and the hash-scroll behavior of ScrollToUnitPasuk.
 */
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";

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
	PerushimSection: () => <div data-testid="perushim-section" />,
}));
jest.mock("@/app/929/[number]/components/ArticlesSection", () => ({
	ArticlesSection: () => <div data-testid="articles-section" />,
}));

// The portal-based preview is covered by the /929 suite; here a plain
// link is enough to prove the render callback runs.
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

// Layout collaborators are covered elsewhere; isolate the wiring.
jest.mock("@/app/components/UnitSwipeNavigation", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));
jest.mock("@/app/929/[number]/components/ReaderSettings", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/lib/download/register-tanach", () => ({}));

const actualMasora = jest.requireActual<
	typeof import("@/data/masora/masora-units")
>("@/data/masora/masora-units");
const mockFirstUnits = jest.fn(actualMasora.getMasoraFirstUnitBySefer);
jest.mock("@/data/masora/masora-units", () => ({
	...jest.requireActual("@/data/masora/masora-units"),
	getMasoraFirstUnitBySefer: () => mockFirstUnits(),
}));

import { ScrollToUnitPasuk } from "@/app/components/reading/ScrollToUnitPasuk";
import { UnitBreadcrumb } from "@/app/masora/[unit]/components/UnitBreadcrumb";
import { UnitNav } from "@/app/masora/[unit]/components/UnitNav";
import { UnitText } from "@/app/masora/[unit]/components/UnitText";
import MasoraUnitLayout from "@/app/masora/[unit]/layout";
import MasoraUnitPage from "@/app/masora/[unit]/page";
import MasoraLanding from "@/app/masora/page";
import { getMasoraUnitById } from "@/data/masora/masora-units";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";

describe("UnitNav", () => {
	it("links to the previous and next units by their headings", () => {
		render(<UnitNav prev={getMasoraUnitById(1)} next={getMasoraUnitById(3)} />);
		expect(screen.getByRole("link", { name: /פרשה קודמת/ })).toHaveAttribute(
			"href",
			"/מסורה/1",
		);
		expect(screen.getByRole("link", { name: /פרשה הבאה/ })).toHaveAttribute(
			"href",
			"/מסורה/3",
		);
	});

	it("renders placeholders at the corpus edges", () => {
		const { container } = render(<UnitNav prev={null} next={null} />);
		expect(screen.queryByRole("link")).toBeNull();
		expect(container.querySelectorAll("nav > span").length).toBe(2);
	});
});

describe("UnitBreadcrumb", () => {
	it("links each level into the division root", () => {
		render(<UnitBreadcrumb unit={getMasoraUnitById(1)} />);
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
		expect(nav).toHaveAttribute("data-testid", "masora-unit-breadcrumb-1");
		expect(screen.getByRole("link", { name: "מסורה על הפרק" })).toHaveAttribute(
			"href",
			"/מסורה",
		);
	});

	it("picks the helek grid style for נביאים and כתובים sefarim", () => {
		const firstUnits = actualMasora.getMasoraFirstUnitBySefer();
		const yehoshua = firstUnits.find((u) => u.seferName === "יהושע");
		const tehillim = firstUnits.find((u) => u.seferName === "תהילים");
		if (!yehoshua || !tehillim) {
			throw new Error("expected first units for יהושע and תהילים");
		}
		const { unmount } = render(<UnitBreadcrumb unit={yehoshua} />);
		expect(
			screen.getByRole("button", { name: /חלק נוכחי: נביאים/ }),
		).toBeInTheDocument();
		unmount();
		render(<UnitBreadcrumb unit={tehillim} />);
		expect(
			screen.getByRole("button", { name: /חלק נוכחי: כתובים/ }),
		).toBeInTheDocument();
	});

	it("renders plain text when a level has no first unit", () => {
		mockFirstUnits.mockReturnValueOnce([]);
		render(<UnitBreadcrumb unit={getMasoraUnitById(1)} />);
		// With no first units, helek and sefer entries degrade to text.
		expect(screen.queryByRole("link", { name: "נביאים" })).toBeNull();
		expect(screen.queryByRole("link", { name: "שמות" })).toBeNull();
		expect(screen.getByText("נביאים")).toBeInTheDocument();
		// The breadcrumb shell itself is unaffected.
		expect(
			screen.getByRole("link", { name: "מסורה על הפרק" }),
		).toBeInTheDocument();
	});
});

describe("MasoraLanding", () => {
	it("groups sefarim by חלק and links first units", () => {
		render(<MasoraLanding />);
		for (const helek of ["תורה", "נביאים", "כתובים"]) {
			expect(screen.getByRole("heading", { name: helek })).toBeInTheDocument();
		}
		expect(screen.getAllByRole("link", { name: /בראשית/ })[0]).toHaveAttribute(
			"href",
			"/מסורה/1",
		);
	});

	it("falls back to plain text for a sefer without a first unit", () => {
		mockFirstUnits.mockReturnValue([]);
		render(<MasoraLanding />);
		expect(screen.queryByRole("link", { name: /מסורה\// })).toBeNull();
		mockFirstUnits.mockImplementation(actualMasora.getMasoraFirstUnitBySefer);
	});
});

describe("UnitText", () => {
	it("renders a cross-perek unit with perek labels and anchors", () => {
		const unit = getMasoraUnitById(8); // בראשית ב ד - ג טו
		render(<UnitText unit={unit} entityRefsByPerek={{}} />);
		expect(document.getElementById("pasuk-2-4")).toBeInTheDocument();
		expect(document.getElementById("pasuk-3-15")).toBeInTheDocument();
		// Multi-perek slices carry the perek source label.
		expect(screen.getAllByText(/בראשית ב/).length).toBeGreaterThan(0);
	});

	it("wraps referenced segments in Tanahpedia links", () => {
		const unit = getMasoraUnitById(1);
		const ref: PerekEntityReference = {
			entityId: "e1",
			entityName: "אלוהים",
			entityType: "PERSON",
			entryUniqueName: "אלוהים",
			pasukNumber: 1,
			segmentStart: null,
			segmentEnd: null,
		};
		render(<UnitText unit={unit} entityRefsByPerek={{ 1: [ref] }} />);
		expect(document.querySelector("[data-entry='אלוהים']")).toBeInTheDocument();
	});
});

describe("MasoraUnitLayout", () => {
	it("wires adjacent-unit hrefs for valid units", async () => {
		const jsx = await MasoraUnitLayout({
			children: <div data-testid="unit-body" />,
			params: Promise.resolve({ unit: "5" }),
		});
		render(jsx);
		expect(screen.getByTestId("unit-body")).toBeInTheDocument();
	});

	it("handles out-of-range units without nav hrefs", async () => {
		const jsx = await MasoraUnitLayout({
			children: <div data-testid="unit-body" />,
			params: Promise.resolve({ unit: "0" }),
		});
		render(jsx);
		expect(screen.getByTestId("unit-body")).toBeInTheDocument();
	});
});

describe("MasoraUnitPage", () => {
	it("renders heading, unit text and service-backed sections", async () => {
		const jsx = await MasoraUnitPage({
			params: Promise.resolve({ unit: "8" }),
		});
		render(jsx);
		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
			"בראשית ב ד - ג טו",
		);
		expect(document.getElementById("pasuk-2-4")).toBeInTheDocument();
		expect(screen.getByTestId("perushim-section")).toBeInTheDocument();
		expect(screen.getByTestId("articles-section")).toBeInTheDocument();
	});

	it("renders both closing-break labels", async () => {
		const bereshit = actualMasora.getMasoraUnitsForSefer("בראשית");
		const ptuha = bereshit.find((u) => u.closingBreak === "ptuha");
		const stuma = bereshit.find((u) => u.closingBreak === "stuma");
		if (!ptuha || !stuma) {
			throw new Error("expected ptuha and stuma units in בראשית");
		}

		const { unmount } = render(
			await MasoraUnitPage({
				params: Promise.resolve({ unit: String(ptuha.unitId) }),
			}),
		);
		expect(screen.getByText("פרשה פתוחה")).toBeInTheDocument();
		unmount();
		render(
			await MasoraUnitPage({
				params: Promise.resolve({ unit: String(stuma.unitId) }),
			}),
		);
		expect(screen.getByText("פרשה סתומה")).toBeInTheDocument();
	});

	it("calls notFound for an unknown unit", async () => {
		await expect(
			MasoraUnitPage({ params: Promise.resolve({ unit: "99999" }) }),
		).rejects.toThrow("NEXT_NOT_FOUND");
	});
});

describe("ScrollToUnitPasuk", () => {
	function mountArticle(withVerse = true) {
		document.body.innerHTML = "";
		const article = document.createElement("div");
		article.setAttribute("data-unit-text", "");
		if (withVerse) {
			const verse = document.createElement("span");
			verse.id = "pasuk-1-5";
			verse.scrollIntoView = jest.fn();
			article.appendChild(verse);
		}
		document.body.appendChild(article);
		return article;
	}

	it("marks the hashed verse and scrolls to it", async () => {
		const article = mountArticle();
		window.location.hash = "#pasuk-1-5";
		render(<ScrollToUnitPasuk />);
		const verse = document.getElementById("pasuk-1-5") as HTMLElement;
		expect(verse).toHaveAttribute("data-pasuk-highlight");
		expect(verse).toHaveAttribute("aria-current", "location");
		// The scroll is deferred to the next animation frame.
		await waitFor(() => expect(verse.scrollIntoView).toHaveBeenCalled());
		expect(article.dataset.pasukNavigationReady).toBe("");
	});

	it("re-selects on hashchange and ignores foreign hashes", () => {
		mountArticle();
		render(<ScrollToUnitPasuk />);
		const verse = document.getElementById("pasuk-1-5") as HTMLElement;
		act(() => {
			window.location.hash = "#pasuk-1-5";
			fireEvent(window, new Event("hashchange"));
		});
		expect(verse).toHaveAttribute("data-pasuk-highlight");
		act(() => {
			window.location.hash = "#other-anchor";
			fireEvent(window, new Event("hashchange"));
		});
		expect(verse).not.toHaveAttribute("data-pasuk-highlight");
	});

	it("ignores hashes for verses missing from the unit text", () => {
		const article = mountArticle();
		// A verse that exists but lives outside the unit article.
		const outsider = document.createElement("span");
		outsider.id = "pasuk-2-7";
		document.body.appendChild(outsider);
		render(<ScrollToUnitPasuk />);
		act(() => {
			window.location.hash = "#pasuk-1-9"; // no such element
			fireEvent(window, new Event("hashchange"));
			window.location.hash = "#pasuk-2-7"; // exists, not in article
			fireEvent(window, new Event("hashchange"));
		});
		expect(article.querySelector("[data-pasuk-highlight]")).toBeNull();
		expect(outsider).not.toHaveAttribute("data-pasuk-highlight");
	});

	it("does nothing without the article container", () => {
		document.body.innerHTML = "";
		window.location.hash = "#pasuk-1-5";
		render(<ScrollToUnitPasuk />);
		expect(document.querySelector("[data-pasuk-highlight]")).toBeNull();
	});
});
