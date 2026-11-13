import type { ScriptureRange } from "@/lib/reading/contract";
import {
	pieceSpotContaining,
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
					{ startMs: 0, endMs: 200, pasuk: 1 },
					{ startMs: 300, endMs: 500, pasuk: 2 },
					{ startMs: 600, endMs: 800, pasuk: 3 },
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
			{ startMs: 300, endMs: 500, pasuk: 2 },
			{ startMs: 600, endMs: 800, pasuk: 3 },
		]);
		expect(pieces[1].intervals).toEqual([
			{ startMs: 0, endMs: 200, pasuk: 1 },
		]);
	});

	it("keeps declared order when a reading revisits a perek", () => {
		const pieces = rangePlaybackPieces(
			[range(1, 1, 1, 1), range(2, 1, 2, 1), range(1, 3, 1, 3)],
			pasukCount,
			wordsByPerek,
		);
		expect(pieces.map((piece) => piece.perekId)).toEqual([1, 2, 1]);
		expect(pieces[2].intervals).toEqual([
			{ startMs: 600, endMs: 800, pasuk: 3 },
		]);
	});

	it("merges adjacent same-perek slices into one piece", () => {
		const pieces = rangePlaybackPieces(
			[range(1, 1, 1, 1), range(1, 2, 1, 2)],
			pasukCount,
			wordsByPerek,
		);
		expect(pieces).toHaveLength(1);
		expect(pieces[0].intervals).toEqual([
			{ startMs: 0, endMs: 200, pasuk: 1 },
			{ startMs: 300, endMs: 500, pasuk: 2 },
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
			{ startMs: 100, endMs: 200, pasuk: 1 },
			{ startMs: 300, endMs: 400, pasuk: 2 },
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

	it("skips pesukim and whole slices without aligned words", () => {
		// The manifest exists for perek 1 but aligns only pasuk 1: pasuk 2
		// drops its interval slot, and a slice entirely outside the aligned
		// span contributes no piece at all.
		const sparse = new Map<number, RecitationWord[]>([
			[1, [word(1, 1, 0, 100), word(1, 2, 100, 200)]],
		]);
		expect(rangePlaybackPieces([range(1, 1, 1, 3)], pasukCount, sparse))
			.toEqual([
				{
					perekId: 1,
					intervals: [{ startMs: 0, endMs: 200, pasuk: 1 }],
				},
			]);
		expect(
			rangePlaybackPieces([range(1, 4, 1, 5)], () => 5, sparse),
		).toEqual([]);
	});
});

describe("pieceSpotContaining", () => {
	// A reading that repeats perek 1's first pasuk: the same perek,
	// pasuk and timestamps appear in pieces 0 and 2.
	const pieces: RecitationPlaybackPiece[] = [
		{ perekId: 1, intervals: [{ startMs: 0, endMs: 200, pasuk: 1 }] },
		{ perekId: 2, intervals: [{ startMs: 0, endMs: 200, pasuk: 1 }] },
		{ perekId: 1, intervals: [{ startMs: 0, endMs: 200, pasuk: 1 }] },
	];

	it("finds the first matching copy by default", () => {
		expect(pieceSpotContaining(pieces, 1, 100)).toEqual({
			pieceIndex: 0,
			intervalIndex: 0,
		});
	});

	it("selects the tapped copy's ordinal regardless of playback position", () => {
		expect(pieceSpotContaining(pieces, 1, 100, 1)).toEqual({
			pieceIndex: 2,
			intervalIndex: 0,
		});
		expect(pieceSpotContaining(pieces, 1, 100, 0)).toEqual({
			pieceIndex: 0,
			intervalIndex: 0,
		});
	});

	it("resolves a later copy merged into the same piece", () => {
		// Two adjacent identical ranges merge into one piece carrying two
		// identical intervals — occurrence 1 is the second interval, not
		// a later piece.
		const merged: RecitationPlaybackPiece[] = [
			{
				perekId: 1,
				intervals: [
					{ startMs: 0, endMs: 200, pasuk: 1 },
					{ startMs: 0, endMs: 200, pasuk: 1 },
				],
			},
		];
		expect(pieceSpotContaining(merged, 1, 100, 1)).toEqual({
			pieceIndex: 0,
			intervalIndex: 1,
		});
	});

	it("matches ordinals by pasuk even when timestamps differ per copy", () => {
		// A clipped repeat shares only part of the first copy's interval;
		// a tap inside the overlap still selects the copy the ordinal
		// names, not the first containing interval.
		const clipped: RecitationPlaybackPiece[] = [
			{ perekId: 1, intervals: [{ startMs: 0, endMs: 200, pasuk: 1 }] },
			{ perekId: 1, intervals: [{ startMs: 100, endMs: 200, pasuk: 1 }] },
		];
		expect(pieceSpotContaining(clipped, 1, 150, 1)).toEqual({
			pieceIndex: 1,
			intervalIndex: 0,
		});
		expect(pieceSpotContaining(clipped, 1, 150, 0)).toEqual({
			pieceIndex: 0,
			intervalIndex: 0,
		});
	});

	it("falls back to the first containing interval for out-of-range ordinals", () => {
		expect(pieceSpotContaining(pieces, 1, 100, 9)).toEqual({
			pieceIndex: 0,
			intervalIndex: 0,
		});
	});

	it("ignores pieces from other perakim and unmatched positions", () => {
		expect(pieceSpotContaining(pieces, 2, 50)).toEqual({
			pieceIndex: 1,
			intervalIndex: 0,
		});
		expect(pieceSpotContaining(pieces, 1, 250)).toBeNull();
		expect(pieceSpotContaining(pieces, 3, 100)).toBeNull();
	});

	it("uses the interval end as an exclusive bound", () => {
		expect(pieceSpotContaining(pieces, 1, 200)).toBeNull();
		expect(pieceSpotContaining(pieces, 1, 0)).toEqual({
			pieceIndex: 0,
			intervalIndex: 0,
		});
	});

	it("keeps counting copies past intervals of other pesukim", () => {
		// A piece carrying several pesukim: the second pass must skip the
		// non-matching pasuk interval before reaching the tapped copy.
		const mixed: RecitationPlaybackPiece[] = [
			{
				perekId: 1,
				intervals: [
					{ startMs: 0, endMs: 200, pasuk: 1 },
					{ startMs: 300, endMs: 500, pasuk: 2 },
					{ startMs: 600, endMs: 800, pasuk: 1 },
				],
			},
		];
		expect(pieceSpotContaining(mixed, 1, 650, 1)).toEqual({
			pieceIndex: 0,
			intervalIndex: 2,
		});
	});
});

describe("resumePieces", () => {
	const pieces: RecitationPlaybackPiece[] = [
		{
			perekId: 1,
			intervals: [
				{ startMs: 0, endMs: 200, pasuk: 1 },
				{ startMs: 300, endMs: 500, pasuk: 2 },
				{ startMs: 600, endMs: 800, pasuk: 3 },
			],
		},
		{ perekId: 2, intervals: [{ startMs: 0, endMs: 200, pasuk: 1 }] },
	];

	it("trims the bookmarked pasuk interval and drops earlier pieces", () => {
		expect(resumePieces(pieces, 0, 1, 350)).toEqual([
			{
				perekId: 1,
				intervals: [
					{ startMs: 350, endMs: 500, pasuk: 2 },
					{ startMs: 600, endMs: 800, pasuk: 3 },
				],
			},
			{ perekId: 2, intervals: [{ startMs: 0, endMs: 200, pasuk: 1 }] },
		]);
	});

	it("resumes from a later piece's first interval", () => {
		expect(resumePieces(pieces, 1, 0, 100)).toEqual([
			{ perekId: 2, intervals: [{ startMs: 100, endMs: 200, pasuk: 1 }] },
		]);
	});

	it("drops earlier identical intervals inside a merged piece", () => {
		// Adjacent duplicate ranges merge identical intervals into one
		// piece; the explicit interval index resumes at the tapped copy
		// instead of replaying the first.
		const repeated: RecitationPlaybackPiece[] = [
			{
				perekId: 1,
				intervals: [
					{ startMs: 0, endMs: 200, pasuk: 1 },
					{ startMs: 0, endMs: 200, pasuk: 1 },
					{ startMs: 600, endMs: 800, pasuk: 3 },
				],
			},
		];
		expect(resumePieces(repeated, 0, 1, 50)).toEqual([
			{
				perekId: 1,
				intervals: [
					{ startMs: 50, endMs: 200, pasuk: 1 },
					{ startMs: 600, endMs: 800, pasuk: 3 },
				],
			},
		]);
	});

	it("drops the whole piece when the bookmark is past its last interval", () => {
		expect(resumePieces(pieces, 0, 5, 100)).toEqual(pieces.slice(1));
	});

	it("leaves the interval untrimmed when the tap sits on its edge", () => {
		// A tap exactly at an interval bound never shifts its start.
		expect(resumePieces(pieces, 0, 0, 0)).toEqual(pieces);
		expect(resumePieces(pieces, 0, 1, 500)).toEqual([
			{
				perekId: 1,
				intervals: [
					{ startMs: 300, endMs: 500, pasuk: 2 },
					{ startMs: 600, endMs: 800, pasuk: 3 },
				],
			},
			{ perekId: 2, intervals: [{ startMs: 0, endMs: 200, pasuk: 1 }] },
		]);
	});
});
