/**
 * @jest-environment node
 */

import { Temporal } from "temporal-polyfill/full";
import { GET } from "@/app/api/calendar-pdf/route";
import {
	getCalendarArtifactBounds,
	listCalendarArtifactKeys,
} from "@/lib/download/calendar-artifacts";
import { resetCalendarPdfManifestCache } from "@/lib/download/calendar-pdf-manifest";
import { calendarPdfObjectKey } from "@/lib/download/calendar-pdf-plan";
import { getCurrentDate } from "@/util/date";

jest.mock("@/util/date", () => ({ getCurrentDate: jest.fn() }));

const SHA256_A = "a".repeat(64);
const SHA256_B = "b".repeat(64);

function manifestFor(
	artifacts: Record<
		string,
		{ sha256?: string; bytes?: number; filename?: string }
	>,
) {
	return {
		version: 1,
		fingerprint: "fp-test",
		generatedAt: "2026-01-01T00:00:00.000Z",
		bounds: getCalendarArtifactBounds(),
		artifacts: Object.fromEntries(
			Object.entries(artifacts).map(([key, a]) => [
				key,
				{
					object: calendarPdfObjectKey(a.sha256 ?? SHA256_A),
					sha256: a.sha256 ?? SHA256_A,
					bytes: a.bytes ?? 1000,
					filename: a.filename ?? "learning-calendar.pdf",
				},
			]),
		),
	};
}

function mockManifestFetch(manifest: unknown) {
	return jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
		return new Response(JSON.stringify(manifest), { status: 200 });
	});
}

function requestFor(path: string) {
	return GET(new Request(`http://localhost/api/calendar-pdf${path}`));
}

beforeEach(() => {
	resetCalendarPdfManifestCache();
	jest.restoreAllMocks();
	jest.mocked(getCurrentDate).mockReturnValue(new Date("2026-10-28T10:00:00Z"));
});

describe("GET /api/calendar-pdf", () => {
	it("enforces the inclusive next-cycle anniversary before resolving the manifest", async () => {
		const fetch = mockManifestFetch(manifestFor({ "cycle:5": {} }));
		const opens = Temporal.PlainDate.from({
			calendar: "hebrew",
			year: 5788,
			monthCode: "M07",
			day: 9,
		}).withCalendar("iso8601");
		jest
			.mocked(getCurrentDate)
			.mockReturnValue(new Date(`${opens.subtract({ days: 1 })}T10:00:00Z`));
		expect((await requestFor("?view=cycle&cycle=5")).status).toBe(404);
		expect(fetch).not.toHaveBeenCalled();
		jest.mocked(getCurrentDate).mockReturnValue(new Date(`${opens}T10:00:00Z`));
		expect((await requestFor("?view=cycle&cycle=5")).status).toBe(302);
	});

	it("rejects a missing or invalid month param", async () => {
		expect((await requestFor("")).status).toBe(400);
		expect((await requestFor("?month=abc")).status).toBe(400);
		expect((await requestFor("?month=5785")).status).toBe(400);
	});

	it("redirects a month request to the published artifact", async () => {
		mockManifestFetch(manifestFor({ "month:578601": {} }));
		const res = await requestFor("?month=578601");
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toContain(
			`/generated/calendar-pdf/objects/${SHA256_A}.pdf`,
		);
	});

	it("canonicalizes cycle requests — the unused month param selects the same artifact", async () => {
		mockManifestFetch(manifestFor({ "cycle:4": { sha256: SHA256_B } }));
		const withMonth = await requestFor("?month=578702&view=cycle&cycle=4");
		const bare = await requestFor("?view=cycle&cycle=4");
		expect(withMonth.status).toBe(302);
		expect(bare.status).toBe(302);
		expect(withMonth.headers.get("Location")).toBe(
			bare.headers.get("Location"),
		);
		expect(bare.headers.get("Location")).toContain(`${SHA256_B}.pdf`);
	});

	it("redirects a year request to the published artifact", async () => {
		mockManifestFetch(manifestFor({ "year:5786": {} }));
		const res = await requestFor("?month=578601&view=year");
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toContain(`${SHA256_A}.pdf`);
	});

	it("falls back to the month artifact for an invalid cycle param", async () => {
		mockManifestFetch(manifestFor({ "month:578601": {} }));
		const res = await requestFor("?month=578601&view=cycle&cycle=abc");
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toContain(`${SHA256_A}.pdf`);
	});

	it("404s for valid requests outside the generated bounds", async () => {
		mockManifestFetch(manifestFor({}));
		expect((await requestFor("?month=999912")).status).toBe(404);
		expect(
			(await requestFor("?month=578601&view=cycle&cycle=999")).status,
		).toBe(404);
		expect((await requestFor("?month=000101")).status).toBe(404);
	});

	it("503s with Retry-After for in-bounds keys missing from the manifest", async () => {
		mockManifestFetch(manifestFor({}));
		const res = await requestFor("?month=578601");
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("30");
		expect((await requestFor("?month=578601&view=cycle&cycle=4")).status).toBe(
			503,
		);
	});

	it("rejects ineligible keys even when the manifest lists them", async () => {
		// Out-of-band artifacts published via --include are in the manifest but
		// outside the default bounds — publication cannot override eligibility.
		mockManifestFetch(manifestFor({ "cycle:99": {}, "month:999912": {} }));
		expect((await requestFor("?view=cycle&cycle=99&month=578601")).status).toBe(
			404,
		);
		expect((await requestFor("?month=999912")).status).toBe(404);
	});

	it("503s when the manifest cannot be fetched", async () => {
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
		const res = await requestFor("?month=578601");
		expect(res.status).toBe(503);
	});

	it("503s when the manifest is malformed", async () => {
		jest
			.spyOn(globalThis, "fetch")
			.mockImplementation(
				async () => new Response("not json", { status: 200 }),
			);
		expect((await requestFor("?month=578601")).status).toBe(503);
	});

	it("503s when the manifest endpoint errors", async () => {
		jest
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => new Response("", { status: 500 }));
		expect((await requestFor("?month=578601")).status).toBe(503);
	});

	it("covers the whole generated set in the manifest contract", () => {
		// Guard: the bounded set stays bounded and keys keep their format —
		// the route can only answer for keys the pipeline publishes.
		const keys = listCalendarArtifactKeys();
		expect(keys.length).toBeGreaterThan(500);
		expect(keys.length).toBeLessThan(1000);
		for (const key of keys) {
			expect(key).toMatch(/^(month:\d{6}|year:\d{1,4}|cycle:\d+)$/);
		}
	});
});
