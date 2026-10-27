/**
 * @jest-environment node
 */

import { getCalendarArtifactBounds } from "@/lib/download/calendar-artifacts";
import {
	calendarPdfManifestUrl,
	getCalendarPdfManifest,
	MANIFEST_TTL_MS,
	resetCalendarPdfManifestCache,
} from "@/lib/download/calendar-pdf-manifest";

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
	},
};

function mockFetch(impl: () => Promise<Response>) {
	return jest
		.spyOn(globalThis, "fetch")
		.mockImplementation(impl as typeof fetch);
}

beforeEach(() => {
	resetCalendarPdfManifestCache();
	jest.restoreAllMocks();
});

describe("calendarPdfManifestUrl", () => {
	it("resolves the manifest object under the assets base", () => {
		expect(calendarPdfManifestUrl()).toContain(
			"/generated/calendar-pdf/manifest.json",
		);
	});
});

describe("getCalendarPdfManifest", () => {
	it("fetches and parses the manifest", async () => {
		mockFetch(async () => new Response(JSON.stringify(VALID_MANIFEST)));
		const manifest = await getCalendarPdfManifest();
		expect(manifest?.artifacts["month:578512"].filename).toBe(
			"learning-calendar-578512.pdf",
		);
	});

	it("returns null on non-2xx, malformed JSON and network failure", async () => {
		mockFetch(async () => new Response("", { status: 404 }));
		expect(await getCalendarPdfManifest()).toBeNull();

		resetCalendarPdfManifestCache();
		mockFetch(async () => new Response("nope", { status: 200 }));
		expect(await getCalendarPdfManifest()).toBeNull();

		resetCalendarPdfManifestCache();
		mockFetch(async () => {
			throw new Error("offline");
		});
		expect(await getCalendarPdfManifest()).toBeNull();
	});

	it("caches the result for the TTL — one fetch serves many requests", async () => {
		const fetchSpy = mockFetch(
			async () => new Response(JSON.stringify(VALID_MANIFEST)),
		);
		const t0 = Date.now();
		expect(await getCalendarPdfManifest(t0)).not.toBeNull();
		expect(
			await getCalendarPdfManifest(t0 + MANIFEST_TTL_MS - 1),
		).not.toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		// After the TTL the manifest is refetched.
		expect(
			await getCalendarPdfManifest(t0 + MANIFEST_TTL_MS + 1),
		).not.toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("dedupes concurrent requests onto one in-flight fetch", async () => {
		let resolveFetch: (r: Response) => void = () => {};
		const fetchSpy = mockFetch(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				}),
		);
		const pending = [
			getCalendarPdfManifest(),
			getCalendarPdfManifest(),
			getCalendarPdfManifest(),
		];
		resolveFetch(new Response(JSON.stringify(VALID_MANIFEST)));
		const results = await Promise.all(pending);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		for (const manifest of results) {
			expect(manifest?.fingerprint).toBe("fp");
		}
	});
});
