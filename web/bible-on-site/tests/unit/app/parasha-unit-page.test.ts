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
			params: Promise.resolve({ unit: "1" }),
		});
		expect(metadata.alternates?.canonical).toBe("/פרשה/1");
		expect(metadata.title).toContain("פרשת בראשית");
		expect(metadata.title).toContain("פרשה על הפרק");
		expect(metadata.description).toContain("הפטרה");
		expect(metadata.robots).toBeUndefined();
	});

	it.each(getAllParashaUnits())(
		"keeps parasha $unitId ($heading) indexable with its existing canonical slug",
		async (unit) => {
			const metadata = await generateMetadata({
				params: Promise.resolve({ unit: String(unit.unitId) }),
			});
			expect(metadata.alternates?.canonical).toBe(`/פרשה/${unit.slug}`);
			expect(metadata.robots).toBeUndefined();
		},
	);

	it.each(["0", "-1", "55", "abc"])(
		"calls notFound for out-of-range unit %s",
		async (unit) => {
			await expect(
				generateMetadata({ params: Promise.resolve({ unit }) }),
			).rejects.toThrow("NEXT_NOT_FOUND");
			expect(mockNotFound).toHaveBeenCalled();
		},
	);
});

describe("פרשה unit static params", () => {
	it("enumerates every unit id as a prerender target", () => {
		const params = generateStaticParams();
		expect(params).toHaveLength(getParashaUnitCount());
		expect(params).toHaveLength(54);
		expect(params[0]).toEqual({ unit: "1" });
		expect(params[params.length - 1]).toEqual({ unit: "54" });
	});
});
