/**
 * @jest-environment jsdom
 *
 * The פרשה unit page consolidates its canonical URL to the /929 perek
 * page when a unit spans exactly one whole perek with no auxiliary
 * readings. No real parasha qualifies today (every one carries
 * Haftarot), so the unit fixture is synthetic — the other parasha
 * services stay real.
 */
import { render, screen } from "@testing-library/react";
import type { ReadingUnit } from "../../../src/lib/reading/contract";
import { getPerekByPerekId } from "../../../src/data/perek-dto";

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
	PerushimSection: ({
		title,
		perekId,
	}: {
		title: string;
		perekId: number;
	}) => <div data-testid={`perushim-${title}`} data-perek={perekId} />,
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
jest.mock("@/app/parasha/[unit]/components/ParashaSeferComposite", () => ({
	ParashaSeferComposite: () => <div data-testid="parasha-book" />,
}));

// A synthetic unit covering all of בראשית א (the only perek in the
// canonical corpus whose pasuk count the real perek-dto supplies) with
// no auxiliary readings — the exact shape that consolidates to /929.
const perekOnePasukCount = getPerekByPerekId(1).pesukim.length;
const mockWholePerekUnit: ReadingUnit = {
	division: "parasha",
	unitId: 1,
	slug: "1",
	seferName: "בראשית",
	order: 1,
	heading: "בראשית",
	ranges: [
		{
			start: { perekId: 1, pasuk: 1 },
			end: { perekId: 1, pasuk: perekOnePasukCount },
		},
	],
};

jest.mock("@/data/parasha/parasha-units", () => {
	const actual = jest.requireActual("@/data/parasha/parasha-units");
	return {
		...actual,
		getParashaUnitById: () => mockWholePerekUnit,
		getParashaUnitCount: () => 1,
	};
});

import ParashaUnitPage, {
	generateMetadata,
} from "@/app/parasha/[unit]/page";

describe("פרשה unit page — whole-perek consolidation", () => {
	it("canonicalizes to the equivalent /929 perek without noindex", async () => {
		const metadata = await generateMetadata({
			params: Promise.resolve({ unit: "1" }),
		});
		expect(metadata.alternates?.canonical).toBe("/929/1");
		expect(metadata.title).toContain("פרשת בראשית");
		expect(metadata.robots).toBeUndefined();
	});

	it("falls back to the unit's first range perek for Haftarah sections", async () => {
		const jsx = await ParashaUnitPage({
			params: Promise.resolve({ unit: "1" }),
		});
		render(jsx);
		// No auxiliary readings → the Haftarah perushim section scopes to
		// the Torah range's start perek.
		expect(screen.getByTestId("perushim-פרשנים על ההפטרה")).toHaveAttribute(
			"data-perek",
			"1",
		);
		expect(screen.getByTestId("parasha-book")).toBeInTheDocument();
	});
});
