import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect } from "@playwright/test";
import { test } from "../../../util/playwright/test-fixture";

const root = resolve(process.cwd(), "../..");
const gapless = readFileSync(
	resolve(root, "web/shared/recitation/mp3-gapless.js"),
	"utf8",
);
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

for (const fixture of [
	{
		name: "tagged gapless MP3",
		recording,
		frames: 88200,
		selections: [
			[{ start: 0, end: 2000 }],
			[{ start: 101, end: 599 }],
			[
				{ start: 0, end: 200 },
				{ start: 1800, end: 2000 },
			],
		].map((ranges) => ({
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
		name: "original Esther 10 MP3",
		recording: original,
		frames: originalMetadata.frames,
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
		await page.evaluate(() => {
			const Original =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext })
					.webkitAudioContext;
			window.AudioContext = class extends Original {
				constructor() {
					super({ sampleRate: 44100 });
				}
			};
		});
		await page.setContent(html);
		await page.addScriptTag({ content: gapless });
		await page.evaluate("recitation.begin()");
		const encoded = fixture.recording.toString("base64");
		for (let offset = 0; offset < encoded.length; offset += 32768) {
			await page.evaluate(
				`recitation.append(${JSON.stringify(encoded.slice(offset, offset + 32768))})`,
			);
		}
		await page.evaluate("recitation.finish()");
		await expect
			.poll(() => page.evaluate("JSON.parse(recitation.status()).state"))
			.toBe("ready");
		expect(await page.evaluate("JSON.parse(recitation.status()).frames")).toBe(
			fixture.frames,
		);
		for (const { ranges, expected } of fixture.selections) {
			const result = await page.evaluate<{ length: number }>(
				`JSON.parse(recitation.clip(${JSON.stringify(ranges)}))`,
			);
			const parts: Buffer[] = [];
			for (let offset = 0; offset < result.length; offset += 49152) {
				const chunk = await page.evaluate<{ data: string }>(
					`JSON.parse(recitation.chunk(${offset},49152))`,
				);
				parts.push(Buffer.from(chunk.data, "base64"));
			}
			const wave = Buffer.concat(parts);
			expect(wave.toString("ascii", 0, 4)).toBe("RIFF");
			expect(wave.readUInt32LE(24)).toBe(44100);
			expect(wave.length - 44).toBe(expected.length);
			let squaredError = 0;
			let squaredSignal = 0;
			for (let i = 0; i < expected.length; i += 2) {
				const actual = wave.readInt16LE(i + 44),
					correct = expected.readInt16LE(i);
				squaredError += (actual - correct) ** 2;
				squaredSignal += correct ** 2;
			}
			// Independent FFmpeg decoding: codec rounding is allowed; a timing shift is not.
			expect(Math.sqrt(squaredError / squaredSignal)).toBeLessThan(0.001);
		}
		for (const ranges of [
			[{ start: -100, end: 200 }],
			[
				{
					start: fixture.frames / 44.1 - 100,
					end: fixture.frames / 44.1 + 100,
				},
			],
			[],
		]) {
			await expect(
				page.evaluate(`recitation.clip(${JSON.stringify(ranges)})`),
			).rejects.toThrow();
		}
		await page.evaluate("recitation.reset()");
		expect(await page.evaluate("JSON.parse(recitation.status()).state")).toBe(
			"idle",
		);
	});
}
