import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";
import { test } from "../../../util/playwright/test-fixture";

const root = resolve(process.cwd(), "../..");
const decoderScript = readFileSync(
	resolve(root, "app/BibleOnSite/Resources/Raw/recitation-mpeg.min.js"),
	"utf8",
);
if (
	decoderScript !==
	execFileSync(
		process.execPath,
		[
			resolve(
				root,
				"app/devops/recitation-decoder/build-native-recitation-decoder.mjs",
			),
			"--stdout",
		],
		{ encoding: "utf8" },
	)
)
	throw new Error("App and website MPEG decoder versions differ");
// App-side trigger for the duplicated manifest rule (#2391): a decoder bump
// in the app manifest must land in web/bible-on-site/package.json too.
execFileSync(process.execPath, [
	resolve(root, "app/devops/recitation-decoder/check-decoder-pins.mjs"),
]);
const html = readFileSync(
	resolve(root, "app/BibleOnSite/Resources/Raw/recitation-audio.html"),
	"utf8",
);
const recording = readFileSync(
	resolve(root, "data/recitation/fixtures/seek.mp3"),
);
const reference = gunzipSync(
	readFileSync(
		resolve(root, "app/BibleOnSite.Tests/Fixtures/seek-reference.pcm.gz"),
	),
);
const opusRecording = readFileSync(
	resolve(root, "data/recitation/fixtures/seek.ogg"),
);
const opusReference = gunzipSync(
	readFileSync(resolve(root, "data/recitation/fixtures/seek-opus.pcm.gz")),
);

const originalPath = resolve(root, "app/BibleOnSite.Tests/Fixtures");
const original = readFileSync(resolve(originalPath, "esther-10.mp3"));
const originalReference = gunzipSync(
	readFileSync(resolve(originalPath, "esther-10-reference.pcm.gz")),
);
const originalMetadata = JSON.parse(
	readFileSync(resolve(originalPath, "esther-10-reference.json"), "utf8"),
) as {
	sha256: string;
	frames: number;
	sampleRate: number;
	ranges: { start: number; end: number }[];
};
if (
	createHash("sha256").update(original).digest("hex") !==
	originalMetadata.sha256
)
	throw new Error("Original recording fixture changed");

async function nativeResult<T>(page: Page, expression: string): Promise<T> {
	// Native Android/WebView2 serialize the evaluated value; MAUI's Apple
	// script wrapper uses JSON.stringify. Controls then trims outer quotes
	// without unescaping. Exercise that transport before parsing in C#.
	// https://github.com/dotnet/maui/blob/10.0.110/src/Controls/src/Core/WebView/WebView.cs
	const value = await page.evaluate(expression);
	const result = JSON.stringify(value).replace(/^"+|"+$/g, "");
	return JSON.parse(result) as T;
}

const clipRanges = [
	[{ start: 0, end: 2000 }],
	[{ start: 101, end: 599 }],
	[
		{ start: 0, end: 200 },
		{ start: 1800, end: 2000 },
	],
];
for (const fixture of [
	{
		name: "tagged gapless MP3",
		recording,
		frames: 88200,
		sampleRate: 44100,
		channels: 2,
		chapter: reference,
		selections: clipRanges.map((ranges) => ({
			ranges,
			expected: Buffer.concat(
				ranges.map(({ start, end }) =>
					reference.subarray(
						Math.round(start * 44.1) * 2,
						Math.round(end * 44.1) * 2,
					),
				),
			),
		})),
	},
	{
		name: "24 kbps Ogg Opus playback copy",
		recording: opusRecording,
		frames: 96000,
		sampleRate: 48000,
		channels: 1,
		chapter: opusReference,
		selections: clipRanges.map((ranges) => ({
			ranges,
			expected: Buffer.concat(
				ranges.map(({ start, end }) =>
					opusReference.subarray(
						Math.round(start * 48) * 2,
						Math.round(end * 48) * 2,
					),
				),
			),
		})),
	},
	{
		name: "original Esther 10 MP3",
		recording: original,
		frames: originalMetadata.frames,
		sampleRate: originalMetadata.sampleRate,
		channels: 2,
		chapter: null,
		selections: (() => {
			let offset = 0;
			const individual = originalMetadata.ranges.map((range) => {
				const length =
					(Math.round(range.end * 44.1) - Math.round(range.start * 44.1)) * 2;
				const expected = originalReference.subarray(offset, offset + length);
				offset += length;
				return { ranges: [range], expected };
			});
			return [
				...individual,
				{ ranges: originalMetadata.ranges, expected: originalReference },
			];
		})(),
	},
]) {
	test(`app decoder preserves FFmpeg time origin and approved sample ranges: ${fixture.name}`, async ({
		page,
	}) => {
		await page.route("**/recitation-decoder", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><html><body></body></html>",
			}),
		);
		await page.goto("/recitation-decoder");
		await page.setContent(html);
		await page.evaluate(decoderScript);
		await page.evaluate("recitation.begin()");
		const encoded = fixture.recording.toString("base64");
		for (let offset = 0; offset < encoded.length; offset += 32768) {
			await page.evaluate(
				`recitation.append(${JSON.stringify(encoded.slice(offset, offset + 32768))})`,
			);
		}
		await page.evaluate("recitation.finish()");
		await expect
			.poll(async () => {
				const status = await nativeResult<{ state: string; error?: string }>(
					page,
					"recitation.status()",
				);
				if (status.error) throw new Error(status.error);
				return status.state;
			})
			.toBe("ready");
		expect(
			(await nativeResult<{ frames: number }>(page, "recitation.status()"))
				.frames,
		).toBe(fixture.frames);
		const pullWave = async (length: number) => {
			const parts: Buffer[] = [];
			for (let offset = 0; offset < length; offset += 262144) {
				const chunk = await nativeResult<{ data: string }>(
					page,
					`recitation.chunk(${offset},262144)`,
				);
				parts.push(Buffer.from(chunk.data, "base64"));
			}
			return Buffer.concat(parts);
		};
		const expectClose = (wave: Buffer, expected: Buffer) => {
			expect(wave.toString("ascii", 0, 4)).toBe("RIFF");
			expect(wave.readUInt32LE(24)).toBe(fixture.sampleRate);
			const channels = wave.readUInt16LE(22);
			expect(channels).toBe(fixture.channels);
			expect(wave.length - 44).toBe(expected.length * channels);
			let squaredError = 0;
			let squaredSignal = 0;
			for (let i = 0; i < expected.length; i += 2) {
				const correct = expected.readInt16LE(i);
				for (let channel = 0; channel < channels; channel++) {
					const actual = wave.readInt16LE(i * channels + channel * 2 + 44);
					squaredError += (actual - correct) ** 2;
					squaredSignal += correct ** 2;
				}
			}
			// Independent FFmpeg decoding: codec rounding is allowed; a timing shift is not.
			expect(Math.sqrt(squaredError / squaredSignal)).toBeLessThan(0.001);
		};
		for (const { ranges, expected } of fixture.selections) {
			const result = await nativeResult<{ length: number }>(
				page,
				`recitation.clip(${JSON.stringify(ranges)})`,
			);
			expectClose(await pullWave(result.length), expected);
		}
		if (fixture.chapter) {
			// AVPlayer has no Ogg demuxer: iOS chapters ship as decoded PCM.
			const result = await nativeResult<{ length: number }>(
				page,
				"recitation.chapter()",
			);
			expectClose(await pullWave(result.length), fixture.chapter);
		}
		for (const ranges of [
			[{ start: -100, end: 200 }],
			[
				{
					start: fixture.frames / (fixture.sampleRate / 1000) - 100,
					end: fixture.frames / (fixture.sampleRate / 1000) + 100,
				},
			],
			[],
		]) {
			await expect(
				page.evaluate(`recitation.clip(${JSON.stringify(ranges)})`),
			).rejects.toThrow();
		}
		await page.evaluate("recitation.reset()");
		await expect(page.evaluate("recitation.chapter()")).rejects.toThrow();
		expect(
			(await nativeResult<{ state: string }>(page, "recitation.status()"))
				.state,
		).toBe("idle");
	});
}
