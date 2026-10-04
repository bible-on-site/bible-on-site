/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../../../../shared/recitation/mp3-gapless.js";

const fixture = readFileSync(
	resolve(process.cwd(), "../../data/recitation/fixtures/seek.mp3"),
);
const metadata = {
	sampleRate: 44100,
	rawSamples: 89856,
	samples: 88200,
	skip: 1105,
	discard: 551,
};

function audio(length: number, channels = 1, rate = 44100): AudioBuffer {
	const samples = Array.from({ length: channels }, (_, channel) =>
		Float32Array.from({ length }, (_, i) => i + channel),
	);
	return {
		length,
		numberOfChannels: channels,
		sampleRate: rate,
		getChannelData: (channel: number) => samples[channel],
		copyToChannel: (source: Float32Array, channel: number) =>
			samples[channel].set(source),
	} as AudioBuffer;
}
const context = {
	createBuffer: (channels: number, length: number, rate: number) =>
		audio(length, channels, rate),
} as AudioContext;

test("reads encoder delay and padding from independently encoded fixture", () => {
	expect(recitationMp3.read(fixture)).toEqual(metadata);
	// A Buffer can be a view into a larger allocation.
	const larger = Buffer.concat([Buffer.alloc(13), fixture]);
	expect(recitationMp3.read(larger.subarray(13))).toEqual(metadata);
});

test("removes codec delay from raw Apple frames in every channel", () => {
	const decoded = audio(metadata.rawSamples, 2);
	const corrected = recitationMp3.normalize(decoded, metadata, context);
	expect(corrected.length).toBe(metadata.samples);
	for (let channel = 0; channel < 2; channel++) {
		expect(corrected.getChannelData(channel)).toEqual(
			decoded
				.getChannelData(channel)
				.subarray(metadata.skip, metadata.skip + metadata.samples),
		);
	}
});

test("preserves already gapless Chromium samples and untagged original recordings", () => {
	const decoded = audio(metadata.samples);
	expect(recitationMp3.normalize(decoded, metadata, context)).toBe(decoded);
	const original = readFileSync(
		resolve(
			process.cwd(),
			"../../app/BibleOnSite.Tests/Fixtures/esther-10.mp3",
		),
	);
	expect(recitationMp3.read(original)).toBeNull();
	expect(recitationMp3.normalize(decoded, null, context)).toBe(decoded);
});

test("rejects unexplained decoder lengths instead of guessing a time correction", () => {
	expect(() =>
		recitationMp3.normalize(audio(metadata.samples + 100), metadata, context),
	).toThrow("Unsupported MP3 decoder time origin");
});

test("ignores incomplete headers and metadata", () => {
	for (const size of [0, 3, 10, 50, 80]) {
		expect(recitationMp3.read(fixture.subarray(0, size))).toBeNull();
	}
});
