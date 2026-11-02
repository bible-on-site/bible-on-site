/**
 * @jest-environment node
 */

import { getCalendarArtifactBounds } from "@/lib/download/calendar-artifacts";
import {
	CALENDAR_PDF_CLIENT_MANIFEST_TTL_MS,
	resetCalendarPdfAssetCache,
	resolveCalendarPdfAsset,
} from "@/lib/download/calendar-pdf-client";

const MANIFEST_URL =
	"https://assets.example/generated/calendar-pdf/manifest.json";

const VALID_MANIFEST = {
	version: 1,
	fingerprint: "fp",
	generatedAt: "2026-01-01T00:00:00.000Z",
	bounds: getCalendarArtifactBounds(),
	artifacts: {
		"month:578512": {
			object: "generated/calendar-pdf/objects/x.pdf",
			sha256: "x",
			bytes: 10,
			filename: "learning-calendar-578512.pdf",
		},
		"cycle:4": {
			object: "generated/calendar-pdf/objects/y.pdf",
			sha256: "y",
			bytes: 99,
			filename: "learning-calendar-cycle-4.pdf",
		},
	},
};

function mockFetch(impl: () => Promise<Response>) {
	return jest
		.spyOn(globalThis, "fetch")
		.mockImplementation(impl as typeof fetch);
}

beforeEach(() => {
	resetCalendarPdfAssetCache();
	jest.restoreAllMocks();
});

describe("resolveCalendarPdfAsset", () => {
	it("maps a canonical key to the published object URL and filename", async () => {
		mockFetch(async () => new Response(JSON.stringify(VALID_MANIFEST)));

		const asset = await resolveCalendarPdfAsset(MANIFEST_URL, "cycle:4");

		expect(asset).toEqual({
			url: "https://assets.example/generated/calendar-pdf/objects/y.pdf",
			filename: "learning-calendar-cycle-4.pdf",
		});
	});

	it("returns null when the artifact is absent from the manifest", async () => {
		mockFetch(async () => new Response(JSON.stringify(VALID_MANIFEST)));

		expect(
			await resolveCalendarPdfAsset(MANIFEST_URL, "cycle:99"),
		).toBeNull();
	});

	it("returns null on non-2xx, malformed JSON and network failure", async () => {
		mockFetch(async () => new Response("", { status: 404 }));
		expect(
			await resolveCalendarPdfAsset(MANIFEST_URL, "cycle:4"),
		).toBeNull();

		resetCalendarPdfAssetCache();
		mockFetch(async () => new Response("nope", { status: 200 }));
		expect(
			await resolveCalendarPdfAsset(MANIFEST_URL, "cycle:4"),
		).toBeNull();

		resetCalendarPdfAssetCache();
		mockFetch(async () => {
			throw new Error("offline");
		});
		expect(
			await resolveCalendarPdfAsset(MANIFEST_URL, "cycle:4"),
		).toBeNull();
	});

	it("caches the manifest for the TTL — one fetch serves many lookups", async () => {
		const fetchSpy = mockFetch(
			async () => new Response(JSON.stringify(VALID_MANIFEST)),
		);
		const t0 = Date.now();

		expect(
			await resolveCalendarPdfAsset(MANIFEST_URL, "month:578512", t0),
		).not.toBeNull();
		expect(
			await resolveCalendarPdfAsset(
				MANIFEST_URL,
				"cycle:4",
				t0 + CALENDAR_PDF_CLIENT_MANIFEST_TTL_MS - 1,
			),
		).not.toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// After the TTL the manifest is refetched.
		expect(
			await resolveCalendarPdfAsset(
				MANIFEST_URL,
				"cycle:4",
				t0 + CALENDAR_PDF_CLIENT_MANIFEST_TTL_MS + 1,
			),
		).not.toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("dedupes concurrent lookups onto one in-flight fetch", async () => {
		let resolveFetch: (r: Response) => void = () => {};
		const fetchSpy = mockFetch(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				}),
		);

		const pending = [
			resolveCalendarPdfAsset(MANIFEST_URL, "cycle:4"),
			resolveCalendarPdfAsset(MANIFEST_URL, "month:578512"),
			resolveCalendarPdfAsset(MANIFEST_URL, "cycle:4"),
		];
		resolveFetch(new Response(JSON.stringify(VALID_MANIFEST)));
		const results = await Promise.all(pending);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(results[0]?.filename).toBe("learning-calendar-cycle-4.pdf");
		expect(results[1]?.filename).toBe("learning-calendar-578512.pdf");
		expect(results[2]?.filename).toBe("learning-calendar-cycle-4.pdf");
	});

	it("caches a failed fetch so a burst of retries stays off the origin", async () => {
		const fetchSpy = mockFetch(async () => {
			throw new Error("offline");
		});
		const t0 = Date.now();

		expect(
			await resolveCalendarPdfAsset(MANIFEST_URL, "cycle:4", t0),
		).toBeNull();
		expect(
			await resolveCalendarPdfAsset(
				MANIFEST_URL,
				"cycle:4",
				t0 + CALENDAR_PDF_CLIENT_MANIFEST_TTL_MS - 1,
			),
		).toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("never resolves an artifact from a URL outside the manifest contract", async () => {
		const fetchSpy = mockFetch(
			async () => new Response(JSON.stringify(VALID_MANIFEST)),
		);

		expect(
			await resolveCalendarPdfAsset(
				"https://assets.example/some/other.json",
				"cycle:4",
			),
		).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
