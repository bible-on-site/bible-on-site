import type { ScriptureRange } from "@/lib/reading/contract";
import {
	pieceIndexContaining,
	type RecitationPlaybackPiece,
	type RecitationWord,
	rangePlaybackPieces,
	resumePieces,
} from "@/lib/recitation";

const word = (
	pasuk: number,
	segment: number,
	startMs: number,
	endMs: number,
): RecitationWord => ({ pasuk, segment, text: "מילה", startMs, endMs });

const range = (
	startPerek: number,
	startPasuk: number,
	endPerek: number,
	endPasuk: number,
	segmentIndex?: { start?: number; end?: number },
): ScriptureRange => ({
	start: {
		perekId: startPerek,
		pasuk: startPasuk,
		segmentIndex: segmentIndex?.start,
	},
	end: {
		perekId: endPerek,
		pasuk: endPasuk,
		segmentIndex: segmentIndex?.end,
	},
});

// Two-perakim fixture: perek 1 has three pesukim of two words each,
// perek 2 has two pesukim; every word is 100ms wide on its own clock.
const wordsByPerek = new Map<number, RecitationWord[]>([
	[
		1,
		[
			word(1, 1, 0, 100),
			word(1, 2, 100, 200),
			word(2, 1, 300, 400),
			word(2, 2, 400, 500),
			word(3, 1, 600, 700),
			word(3, 2, 700, 800),
		],
	],
	[
		2,
		[
			word(1, 1, 0, 100),
			word(1, 2, 100, 200),
			word(2, 1, 300, 400),
			word(2, 2, 400, 500),
		],
	],
]);
const pasukCount = (perekId: number) => (perekId === 1 ? 3 : 2);

describe("rangePlaybackPieces", () => {
	it("produces one pasuk interval per included pasuk inside a perek", () => {
		const pieces = rangePlaybackPieces(
			[range(1, 1, 1, 3)],
			pasukCount,
			wordsByPerek,
		);
		expect(pieces).toEqual([
			{
				perekId: 1,
				intervals: [
					{ startMs: 0, endMs: 200 },
					{ startMs: 300, endMs: 500 },
					{ startMs: 600, endMs: 800 },
				],
			},
		]);
	});

	it("splits a cross-perek range into ordered per-perek pieces", () => {
		const pieces = rangePlaybackPieces(
			[range(1, 2, 2, 1)],
			pasukCount,
			wordsByPerek,
		);
		expect(pieces.map((piece) => piece.perekId)).toEqual([1, 2]);
		expect(pieces[0].intervals).toEqual([
			{ startMs: 300, endMs: 500 },
			{ startMs: 600, endMs: 800 },
		]);
		expect(pieces[1].intervals).toEqual([{ startMs: 0, endMs: 200 }]);
	});

	it("keeps declared order when a reading revisits a perek", () => {
		const pieces = rangePlaybackPieces(
			[range(1, 1, 1, 1), range(2, 1, 2, 1), range(1, 3, 1, 3)],
			pasukCount,
			wordsByPerek,
		);
		expect(pieces.map((piece) => piece.perekId)).toEqual([1, 2, 1]);
		expect(pieces[2].intervals).toEqual([{ startMs: 600, endMs: 800 }]);
	});

	it("merges adjacent same-perek slices into one piece", () => {
		const pieces = rangePlaybackPieces(
			[range(1, 1, 1, 1), range(1, 2, 1, 2)],
			pasukCount,
			wordsByPerek,
		);
		expect(pieces).toHaveLength(1);
		expect(pieces[0].intervals).toEqual([
			{ startMs: 0, endMs: 200 },
			{ startMs: 300, endMs: 500 },
		]);
	});

	it("clips mid-pasuk bounds to the included segments' words", () => {
		const pieces = rangePlaybackPieces(
			[range(1, 1, 1, 2, { start: 1, end: 0 })],
			pasukCount,
			wordsByPerek,
		);
		// Pasuk 1 starts at segment 1 → only its second word; pasuk 2 ends
		// at segment 0 → only its first word.
		expect(pieces[0].intervals).toEqual([
			{ startMs: 100, endMs: 200 },
			{ startMs: 300, endMs: 400 },
		]);
	});

	it("skips perakim without a manifest", () => {
		const pieces = rangePlaybackPieces(
			[range(1, 1, 3, 1)],
			() => 2,
			new Map([[1, wordsByPerek.get(1) as RecitationWord[]]]),
		);
		expect(pieces.map((piece) => piece.perekId)).toEqual([1]);
	});
});

describe("pieceIndexContaining", () => {
	// A reading that repeats perek 1's first pasuk: the same perek and
	// timestamps appear in pieces 0 and 2.
	const pieces: RecitationPlaybackPiece[] = [
		{ perekId: 1, intervals: [{ startMs: 0, endMs: 200 }] },
		{ perekId: 2, intervals: [{ startMs: 0, endMs: 200 }] },
		{ perekId: 1, intervals: [{ startMs: 0, endMs: 200 }] },
	];

	it("finds the first matching piece by default", () => {
		expect(pieceIndexContaining(pieces, 1, 100)).toBe(0);
	});

	it("prefers the occurrence at or after the reading position", () => {
		expect(pieceIndexContaining(pieces, 1, 100, 1)).toBe(2);
		expect(pieceIndexContaining(pieces, 1, 100, 2)).toBe(2);
	});

	it("falls back to the first match when every occurrence already played", () => {
		expect(pieceIndexContaining(pieces, 1, 100, 3)).toBe(0);
	});

	it("ignores pieces from other perakim and unmatched positions", () => {
		expect(pieceIndexContaining(pieces, 2, 50)).toBe(1);
		expect(pieceIndexContaining(pieces, 1, 250)).toBe(-1);
		expect(pieceIndexContaining(pieces, 3, 100)).toBe(-1);
	});

	it("uses the interval end as an exclusive bound", () => {
		expect(pieceIndexContaining(pieces, 1, 200)).toBe(-1);
		expect(pieceIndexContaining(pieces, 1, 0)).toBe(0);
	});
});

describe("resumePieces", () => {
	const pieces: RecitationPlaybackPiece[] = [
		{
			perekId: 1,
			intervals: [
				{ startMs: 0, endMs: 200 },
				{ startMs: 300, endMs: 500 },
				{ startMs: 600, endMs: 800 },
			],
		},
		{ perekId: 2, intervals: [{ startMs: 0, endMs: 200 }] },
	];

	it("trims the bookmarked pasuk interval and drops earlier pieces", () => {
		expect(resumePieces(pieces, 0, 350)).toEqual([
			{
				perekId: 1,
				intervals: [
					{ startMs: 350, endMs: 500 },
					{ startMs: 600, endMs: 800 },
				],
			},
			{ perekId: 2, intervals: [{ startMs: 0, endMs: 200 }] },
		]);
	});

	it("resumes from a later piece's first interval", () => {
		expect(resumePieces(pieces, 1, 100)).toEqual([
			{ perekId: 2, intervals: [{ startMs: 100, endMs: 200 }] },
		]);
	});

	it("drops intervals fully before a gap bookmark", () => {
		expect(resumePieces(pieces, 0, 250)).toEqual([
			{
				perekId: 1,
				intervals: [
					{ startMs: 300, endMs: 500 },
					{ startMs: 600, endMs: 800 },
				],
			},
			{ perekId: 2, intervals: [{ startMs: 0, endMs: 200 }] },
		]);
	});
});
