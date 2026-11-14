/** @jest-environment node */
jest.mock("@/data/recitation/opus-playback.json", () => ({
	version: 1,
	profile: "ogg-opus-24k-v1",
	tracks: {
		338: {
			sourceSha256: "a".repeat(64),
			sha256: "b".repeat(64),
			key: `recordings/opus-24k/${"b".repeat(64)}.ogg`,
		},
	},
}));

import { opusPlayback } from "@/lib/recitation-playback";

const originalEnv = { ...process.env };
afterEach(() => {
	process.env = { ...originalEnv };
});

test("only matching original MP3s select immutable playback derivatives", () => {
	delete process.env.S3_ENDPOINT;
	process.env.S3_BUCKET = "bible-on-site-assets";
	process.env.S3_REGION = "il-central-1";
	expect(opusPlayback(338, "a".repeat(64))).toEqual({
		format: "ogg-opus",
		bitrate: 24000,
		audioSha256: "b".repeat(64),
		audioUrl: `https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings/opus-24k/${"b".repeat(64)}.ogg`,
	});
	expect(opusPlayback(338, "c".repeat(64))).toBeUndefined();
	expect(opusPlayback(339, "a".repeat(64))).toBeUndefined();
});

test("the same immutable object keys work with local RustFS", () => {
	process.env.S3_ENDPOINT = "http://localhost:4566/";
	process.env.S3_BUCKET = "bible-on-site-assets-test";
	expect(opusPlayback(338, "a".repeat(64))?.audioUrl).toBe(
		`http://localhost:4566/bible-on-site-assets-test/recordings/opus-24k/${"b".repeat(64)}.ogg`,
	);
});

test("an unset S3 bucket still resolves through the default archive name", () => {
	process.env.S3_ENDPOINT = "http://localhost:4566/";
	delete process.env.S3_BUCKET;
	expect(opusPlayback(338, "a".repeat(64))?.audioUrl).toBe(
		`http://localhost:4566/bible-on-site-assets/recordings/opus-24k/${"b".repeat(64)}.ogg`,
	);
});
