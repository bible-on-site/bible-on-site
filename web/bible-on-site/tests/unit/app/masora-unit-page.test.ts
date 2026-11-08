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
} from "@/app/masora/[unit]/page";
import { metadata as sectionMetadata } from "@/app/masora/layout";
import { generateMetadata as generateLandingMetadata } from "@/app/masora/page";
import { getMasoraUnitCount } from "@/data/masora/masora-units";

describe("מסורה landing metadata", () => {
	it("excludes the entire section from search while allowing crawling", () => {
		expect(sectionMetadata.robots).toEqual({ index: false, follow: true });
	});

	it("canonicalizes to the Hebrew root", async () => {
		const metadata = await generateLandingMetadata();
		expect(metadata.alternates?.canonical).toBe("/מסורה");
		expect(metadata.title).toContain("מסורה על הפרק");
		expect(metadata.robots).toBeUndefined();
	});
});

describe("מסורה unit metadata", () => {
	it("consolidates a whole-perek unit to its /929 canonical", async () => {
		// Unit 523 covers exactly במדבר לו — canonical perek 153.
		const metadata = await generateMetadata({
			params: Promise.resolve({ unit: "523" }),
		});
		expect(metadata.alternates?.canonical).toBe("/929/153");
		expect(metadata.title).toContain("במדבר פרשה קס");
		// The section's noindex policy also applies to whole-perek equivalents.
		expect(metadata.robots).toBeUndefined();
	});

	it("keeps a non-equivalent unit self-canonical without overriding section robots", async () => {
		// Unit 1 (בראשית א א-ה) is not a whole perek.
		const metadata = await generateMetadata({
			params: Promise.resolve({ unit: "1" }),
		});
		expect(metadata.alternates?.canonical).toBe("/מסורה/1");
		expect(metadata.title).toContain("בראשית פרשה א");
		expect(metadata.robots).toBeUndefined();
	});

	it.each(["0", "-1", "99999", "abc"])(
		"calls notFound for out-of-range unit %s",
		async (unit) => {
			await expect(
				generateMetadata({ params: Promise.resolve({ unit }) }),
			).rejects.toThrow("NEXT_NOT_FOUND");
			expect(mockNotFound).toHaveBeenCalled();
		},
	);
});

describe("מסורה unit static params", () => {
	it("enumerates every unit id as a prerender target", () => {
		const params = generateStaticParams();
		expect(params).toHaveLength(getMasoraUnitCount());
		expect(params[0]).toEqual({ unit: "1" });
		expect(params[params.length - 1]).toEqual({
			unit: String(getMasoraUnitCount()),
		});
	});
});
