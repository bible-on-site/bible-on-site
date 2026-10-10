import type { Pasuk } from "@/data/db/tanah-view-types";
import {
	parseRecitation,
	playableWords,
	verseRange,
	wordAtPosition,
} from "@/lib/recitation";

const pesukim = [
	{
		segments: [
			{ type: "qri", value: "בְּרֵאשִׁית" },
			{ type: "qri", value: "בָּרָא" },
		],
	},
] as Pasuk[];
const manifest = {
	version: 1,
	alignmentStatus: "ready",
	perekId: 1,
	audioUrl:
		"https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings/1_record.mp3",
	audioSha256: "a".repeat(64),
	textSha256: "b".repeat(64),
	durationMs: 10000,
	words: [
		{ pasuk: 1, segment: 1, text: "בְּרֵאשִׁית", startMs: 1200, endMs: 1800 },
		{ pasuk: 1, segment: 2, text: "בָּרָא", startMs: 1900, endMs: 2300 },
	],
};

test("validated timings preserve segment identity and derive verse ranges", () => {
	expect(parseRecitation(manifest, 1, pesukim).words).toHaveLength(2);
	expect(verseRange(manifest.words, 1)).toEqual({ startMs: 1200, endMs: 2300 });
	expect(verseRange(manifest.words, 2)).toBeNull();
});

test("derived playback leaves original MP3 identity and approved times intact", () => {
	const playback = {
		format: "ogg-opus",
		bitrate: 24000,
		audioSha256: "c".repeat(64),
		audioUrl: `https://example.com/recordings/opus-24k/${"c".repeat(64)}.ogg`,
	};
	const result = parseRecitation({ ...manifest, playback }, 1, pesukim);
	expect(result.audioSha256).toBe(manifest.audioSha256);
	expect(result.words).toEqual(manifest.words);
	for (const invalid of [
		{ ...playback, bitrate: 12000 },
		{ ...playback, audioSha256: "a" },
		{ ...playback, audioUrl: "https://example.com/other.ogg" },
		{ ...playback, format: "unknown" },
	])
		expect(() =>
			parseRecitation({ ...manifest, playback: invalid }, 1, pesukim),
		).toThrow("derived");
});

test.each([
	{ ...manifest, perekId: 2 },
	{ ...manifest, audioUrl: "javascript:alert(1)" },
	{ ...manifest, audioUrl: manifest.audioUrl.replace("1_record", "2_record") },
	{ ...manifest, durationMs: 0 },
	{ ...manifest, words: [manifest.words[0]] },
	{
		...manifest,
		words: [manifest.words[0], { ...manifest.words[1], startMs: 1799 }],
	},
	{
		...manifest,
		words: [manifest.words[0], { ...manifest.words[1], text: "אחר" }],
	},
	{
		...manifest,
		words: [manifest.words[0], { ...manifest.words[1], endMs: 10001 }],
	},
	{
		...manifest,
		words: [manifest.words[0], { ...manifest.words[1], startMs: Number.NaN }],
	},
	{ ...manifest, words: [...manifest.words].reverse() },
])("rejects stale or invalid timing data", (value) => {
	expect(() => parseRecitation(value, 1, pesukim)).toThrow();
});

test("chapter playback can be available before word alignment", () => {
	const words = manifest.words.map((w) => ({
		...w,
		startMs: null,
		endMs: null,
	}));
	const data = parseRecitation(
		{ ...manifest, alignmentStatus: "pending", words },
		1,
		pesukim,
	);
	expect(data.words).toHaveLength(2);
	expect(playableWords(data)).toEqual([]);
	expect(() => parseRecitation({ ...manifest, words }, 1, pesukim)).toThrow();
});

test("rejects a whole missing verse, including in pending output", () => {
	const source = [...pesukim, pesukim[0]];
	for (const alignmentStatus of ["ready", "pending", "needs_review"]) {
		expect(() =>
			parseRecitation({ ...manifest, alignmentStatus }, 1, source),
		).toThrow();
	}
});

test.each([
	"http://localhost:9000/assets/recordings/1_record.mp3",
	"http://127.0.0.1:9000/assets/recordings/1_record.mp3",
])("permits local object-storage recording URLs: %s", (audioUrl) => {
	expect(parseRecitation({ ...manifest, audioUrl }, 1, pesukim).audioUrl).toBe(
		audioUrl,
	);
});

test.each([
	"not a URL",
	"http://example.com/recordings/1_record.mp3",
	"https://user:password@example.com/recordings/1_record.mp3",
	`${manifest.audioUrl}?token=secret`,
	`${manifest.audioUrl}#fragment`,
])("rejects unsafe or malformed recording URLs: %s", (audioUrl) => {
	expect(() => parseRecitation({ ...manifest, audioUrl }, 1, pesukim)).toThrow(
		"Invalid recitation manifest",
	);
});

test.each([
	[null, null],
	[Number.NaN, null],
	[Number.POSITIVE_INFINITY, null],
	[0, null],
	[1200, 1],
	[1799.9, 1],
	[1800, null],
	[1900, 2],
	[2300, null],
	[9000, null],
])(
	"word at audio-clock position %s preserves silence and exclusive end boundaries",
	(position, segment) => {
		expect(wordAtPosition(manifest.words, position)?.segment ?? null).toBe(
			segment,
		);
	},
);
