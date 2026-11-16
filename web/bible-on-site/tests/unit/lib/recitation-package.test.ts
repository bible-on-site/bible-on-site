/** @jest-environment node */
import type { WarmDerived } from "@/data/db/warm-derived";
import { recitationPackage } from "@/lib/recitation-package";

const derivedKey = Symbol.for("bible-on-site.warm-derived");
const environment = process.env;
const globalStore = globalThis as Record<symbol, unknown>;

type ComputedTrack = ReturnType<typeof recitationPackage>["tracks"][number];

function derivedFrom(tracks: ComputedTrack[]): WarmDerived {
	return {
		corpusSha256: "test",
		perakim: [],
		pesukim: [],
		// The stored artifact strips the deploy-time URL; the consumer must
		// re-attach it from live storage settings.
		recitations: tracks.map(({ audioUrl: _url, ...track }) => track),
	};
}

beforeEach(() => {
	process.env = { ...environment };
	delete process.env.ASSETS_BASE_URL;
	delete process.env.S3_ENDPOINT;
	delete process.env.S3_BUCKET;
	delete process.env.S3_REGION;
});
afterEach(() => {
	Reflect.deleteProperty(globalThis, derivedKey);
	process.env = environment;
});

describe("recitationPackage with the build artifact", () => {
	it("re-attaches runtime recording URLs to stored tracks", () => {
		process.env.ASSETS_BASE_URL = "https://cdn.example";
		globalStore[derivedKey] = derivedFrom([
			{
				perekId: 2,
				audioUrl: "https://build-time.invalid/stripped",
				audioSha256: "a".repeat(64),
				textSha256: "b".repeat(64),
				durationMs: 5000,
				alignmentStatus: "ready",
				words: [
					{
						pasuk: 1,
						segment: 1,
						text: "בראשית",
						startMs: 101,
						endMs: 599,
					},
				],
			},
		]);
		expect(recitationPackage().tracks).toEqual([
			{
				perekId: 2,
				audioUrl: "https://cdn.example/recordings/2_record.mp3",
				audioSha256: "a".repeat(64),
				textSha256: "b".repeat(64),
				durationMs: 5000,
				alignmentStatus: "ready",
				words: [
					{ pasuk: 1, segment: 1, text: "בראשית", startMs: 101, endMs: 599 },
				],
			},
		]);
	});

	it("produces a body byte-identical to the computed package", () => {
		// The artifact path must serialize exactly like the live computation —
		// same key order, same values — so response bodies and etags stay stable.
		const computed = recitationPackage();
		globalStore[derivedKey] = derivedFrom(computed.tracks);
		expect(JSON.stringify(recitationPackage())).toBe(JSON.stringify(computed));
	}, 30_000);
});
