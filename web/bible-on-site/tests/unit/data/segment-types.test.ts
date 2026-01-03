import {
	isKtivDifferentThanQri,
	isQriDifferentThanKtiv,
	type KtivSegment,
	type QriSegment,
} from "../../../src/data/db/tanah-view-types";

describe("Segment type inference", () => {
	describe("isQriDifferentThanKtiv", () => {
		it("returns true when qri has ktivOffset", () => {
			const qriWithPair: QriSegment = {
				type: "qri",
				value: "יְקוּם",
				recordingTimeFrame: {
					from: "00:00:00" as never,
					to: "00:00:00" as never,
				},
				ktivOffset: -1,
			};
			expect(isQriDifferentThanKtiv(qriWithPair)).toBe(true);
		});

		it("returns false when qri has no ktivOffset (regular vocalized text)", () => {
			const regularQri: QriSegment = {
				type: "qri",
				value: "בְּרֵאשִׁית",
				recordingTimeFrame: {
					from: "00:00:00" as never,
					to: "00:00:00" as never,
				},
			};
			expect(isQriDifferentThanKtiv(regularQri)).toBe(false);
		});

		it("returns false when ktivOffset is undefined", () => {
			const qri: QriSegment = {
				type: "qri",
				value: "אֱלֹהִים",
				recordingTimeFrame: {
					from: "00:00:00" as never,
					to: "00:00:00" as never,
				},
				ktivOffset: undefined,
			};
			expect(isQriDifferentThanKtiv(qri)).toBe(false);
		});

		it("returns true when ktivOffset is 0 (orphan qri - קרי ולא כתיב)", () => {
			const orphanQri: QriSegment = {
				type: "qri",
				value: "הוּא",
				recordingTimeFrame: {
					from: "00:00:00" as never,
					to: "00:00:00" as never,
				},
				ktivOffset: 0,
			};
			// Orphan qri still differs from ktiv (there is no ktiv)
			expect(isQriDifferentThanKtiv(orphanQri)).toBe(true);
		});
	});

	describe("isKtivDifferentThanQri", () => {
		it("returns true when ktiv has non-zero qriOffset", () => {
			const ktivWithPair: KtivSegment = {
				type: "ktiv",
				value: "יקום",
				qriOffset: 1,
			};
			expect(isKtivDifferentThanQri(ktivWithPair)).toBe(true);
		});

		it("returns false when ktiv has qriOffset=0 (orphan ktiv - כתיב ולא קרי)", () => {
			const orphanKtiv: KtivSegment = {
				type: "ktiv",
				value: "יקום",
				qriOffset: 0,
			};
			// Orphan ktiv has no paired qri to differ from
			expect(isKtivDifferentThanQri(orphanKtiv)).toBe(false);
		});
	});

	describe("Ktiv/Qri pair relationship", () => {
		it("ktiv qriOffset and qri ktivOffset should be consistent (sum to 0)", () => {
			// When ktiv has qriOffset=1, the qri at offset +1 should have ktivOffset=-1
			const ktiv: KtivSegment = {
				type: "ktiv",
				value: "יקום",
				qriOffset: 1,
			};
			const qri: QriSegment = {
				type: "qri",
				value: "יְקוּם",
				recordingTimeFrame: {
					from: "00:00:00" as never,
					to: "00:00:00" as never,
				},
				ktivOffset: -1,
			};

			// Both should be recognized as having a pair
			expect(isKtivDifferentThanQri(ktiv)).toBe(true);
			expect(isQriDifferentThanKtiv(qri)).toBe(true);

			// Verify the relationship: ktiv.qriOffset + qri.ktivOffset = 0
			// biome-ignore lint/style/noNonNullAssertion: Validated above with type guards
			expect(ktiv.qriOffset + qri.ktivOffset!).toBe(0);
		});

		it("multi-qri case: multiple qri segments with offsets pointing to same ktiv", () => {
			// When 1 ktiv is followed by 2 qri segments (e.g., כתיב מילה חדה וקרי תרתין מילין)
			// The span is derived by counting qris with offsets pointing to same ktiv
			const ktiv: KtivSegment = {
				type: "ktiv",
				value: "ובניהו",
				qriOffset: 1, // Points to first qri
			};
			const qri1: QriSegment = {
				type: "qri",
				value: "וּבְנֵי",
				recordingTimeFrame: {
					from: "00:00:00" as never,
					to: "00:00:00" as never,
				},
				ktivOffset: -1, // Points back to ktiv
			};
			const qri2: QriSegment = {
				type: "qri",
				value: "יָהוּ",
				recordingTimeFrame: {
					from: "00:00:00" as never,
					to: "00:00:00" as never,
				},
				ktivOffset: -2, // Also points back to same ktiv (2 positions back)
			};

			expect(isKtivDifferentThanQri(ktiv)).toBe(true);
			expect(isQriDifferentThanKtiv(qri1)).toBe(true);
			expect(isQriDifferentThanKtiv(qri2)).toBe(true);
		});

		it("multi-ktiv case: multiple ktiv segments with offsets pointing to same qri", () => {
			// When 2 ktivs are followed by 1 qri (e.g., כתיב תרתין מילין וקרי מילה חדה)
			// The span is derived by counting ktivs with offsets pointing to same qri
			const ktiv1: KtivSegment = {
				type: "ktiv",
				value: "את",
				qriOffset: 2, // Skips ktiv2, points to qri
			};
			const ktiv2: KtivSegment = {
				type: "ktiv",
				value: "שר",
				qriOffset: 1, // Points to qri
			};
			const qri: QriSegment = {
				type: "qri",
				value: "אֶתְשָׁר",
				recordingTimeFrame: {
					from: "00:00:00" as never,
					to: "00:00:00" as never,
				},
				ktivOffset: -1, // Points to immediate preceding ktiv (ktiv2)
			};

			expect(isKtivDifferentThanQri(ktiv1)).toBe(true);
			expect(isKtivDifferentThanQri(ktiv2)).toBe(true);
			expect(isQriDifferentThanKtiv(qri)).toBe(true);
		});
	});
});
