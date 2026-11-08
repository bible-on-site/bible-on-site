/** @jest-environment node */
jest.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

const mockNotFound = jest.fn(() => {
	throw new Error("NEXT_NOT_FOUND");
});
jest.mock("next/navigation", () => ({
	notFound: () => mockNotFound(),
}));

import {
	generateMetadata,
	generateStaticParams,
} from "@/app/parasha/[unit]/page";
import { generateMetadata as generateLandingMetadata } from "@/app/parasha/page";
import {
	getAllParashaUnits,
	getParashaUnitCount,
} from "@/data/parasha/parasha-units";

describe("פרשה landing metadata", () => {
	it("canonicalizes to the Hebrew root", async () => {
		const metadata = await generateLandingMetadata();
		expect(metadata.alternates?.canonical).toBe("/פרשה");
		expect(metadata.title).toContain("פרשה על הפרק");
		expect(metadata.robots).toBeUndefined();
	});
});

describe("פרשה unit metadata", () => {
	it("keeps the weekly parasha and its Haftarah indexable under its own URL", async () => {
		const metadata = await generateMetadata({
			params: Promise.resolve({ unit: "בראשית" }),
		});
		expect(metadata.alternates?.canonical).toBe("/פרשה/בראשית");
		expect(metadata.title).toContain("פרשת בראשית");
		expect(metadata.title).toContain("פרשה על הפרק");
		expect(metadata.description).toContain("הפטרה");
		expect(metadata.robots).toBeUndefined();
	});

	it("resolves a percent-encoded param — the form the router hands the page", async () => {
		// Rewritten Hebrew segments arrive still-encoded (same convention
		// as /929/[slug]'s rawSlug) — the page decodes before resolving.
		const metadata = await generateMetadata({
			params: Promise.resolve({ unit: encodeURIComponent("לך-לך") }),
		});
		expect(metadata.alternates?.canonical).toBe("/פרשה/לך-לך");
	});

	it.each(getAllParashaUnits())(
		"keeps parasha $unitId ($heading) indexable with its canonical slug",
		async (unit) => {
			const metadata = await generateMetadata({
				params: Promise.resolve({ unit: unit.slug }),
			});
			expect(metadata.alternates?.canonical).toBe(`/פרשה/${unit.slug}`);
			expect(metadata.robots).toBeUndefined();
		},
	);

	it.each([
		// Legacy numeric ids, aliases, and malformed/unknown segments all
		// redirect or 404 at the proxy before reaching the route — and
		// dynamicParams=false only serves the canonical static params.
		// "%" fails decodeURIComponent outright (URI malformed).
		"3",
		"פרשת לך לך",
		"שלח לך",
		"0",
		"-1",
		"55",
		"abc",
		"פרשה-של-דמיון",
		"%",
	])(
		"calls notFound for non-canonical unit %s",
		async (unit) => {
			await expect(
				generateMetadata({ params: Promise.resolve({ unit }) }),
			).rejects.toThrow("NEXT_NOT_FOUND");
			expect(mockNotFound).toHaveBeenCalled();
		},
	);
});

describe("פרשה unit static params", () => {
	it("enumerates every canonical slug — and nothing else — as a prerender target", () => {
		const params = generateStaticParams();
		expect(params).toHaveLength(getParashaUnitCount());
		expect(params).toHaveLength(54);
		expect(params[0]).toEqual({ unit: "בראשית" });
		expect(params[params.length - 1]).toEqual({ unit: "וזאת-הברכה" });
		// Only the canonical Hebrew slugs prerender; numeric ids and
		// aliases reach the page exclusively through 308 redirects.
		expect(params.every((param) => /^[א-ת-]+$/.test(param.unit))).toBe(true);
	});
});
