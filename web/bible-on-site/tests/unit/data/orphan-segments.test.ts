import {
	isKtivDifferentThanQri,
	isQriDifferentThanKtiv,
	type KtivSegment,
	type QriSegment,
	type Segment,
} from "../../../src/data/db/tanah-view-types";
import { getAllPerakim } from "../../../src/data/sefer-dto";

/**
 * These tests verify the orphan segment edge cases in the actual Tanah data:
 * - כתיב ולא קרי (ktiv without qri): ktiv segments with qriOffset=0
 * - קרי ולא כתיב (qri without ktiv): qri segments with ktivOffset=0
 *
 * Note: The JSON data uses separate fields (qriOffset for ktiv, ktivOffset for qri),
 * while the TypeScript types use a unified qriKtivOffset field.
 */

// Helper type to access the raw JSON fields
interface RawKtivSegment {
	type: "ktiv";
	value: string;
	qriOffset?: number;
}

interface RawQriSegment {
	type: "qri";
	value: string;
	recordingTimeFrame: { from: string; to: string };
	ktivOffset?: number;
}

describe("Orphan segments in Tanah data", () => {
	// Collect all segments from all perakim once
	const allSegments = getAllPerakim().flatMap((perek) =>
		perek.pesukim.flatMap((pasuk) => pasuk.segments),
	);
	// Cast to raw types to access actual JSON field names
	const allKtivSegments = allSegments.filter(
		(s): s is Segment & RawKtivSegment => s.type === "ktiv",
	);
	const allQriSegments = allSegments.filter(
		(s): s is Segment & RawQriSegment => s.type === "qri",
	);

	describe("כתיב ולא קרי (ktiv without qri)", () => {
		// Ktiv segments with qriOffset=0 are orphans (no matching qri)
		const orphanKtivSegments = allKtivSegments.filter((s) => s.qriOffset === 0);

		it("has orphan ktiv segments in the data", () => {
			// According to Rust tests: ~30 cases of כתיב ולא קרי
			expect(orphanKtivSegments.length).toBeGreaterThan(0);
			expect(orphanKtivSegments.length).toBe(30);
		});

		it("orphan ktiv segments have qriOffset=0", () => {
			// qriOffset=0 means "orphan" - no actual qri pair
			for (const segment of orphanKtivSegments) {
				expect(segment.qriOffset).toBe(0);
			}
		});
	});

	describe("קרי ולא כתיב (qri without ktiv)", () => {
		// Qri segments with ktivOffset=0 are orphans (no matching ktiv)
		const orphanQriSegments = allQriSegments.filter((s) => s.ktivOffset === 0);

		it("has orphan qri segments in the data", () => {
			// According to Rust tests: ~11 cases of קרי ולא כתיב
			expect(orphanQriSegments.length).toBeGreaterThan(0);
			expect(orphanQriSegments.length).toBe(11);
		});

		it("orphan qri segments have ktivOffset=0", () => {
			// ktivOffset=0 means "orphan" - no actual ktiv pair
			for (const segment of orphanQriSegments) {
				expect(segment.ktivOffset).toBe(0);
			}
		});
	});

	describe("Regular ktiv/qri pairs", () => {
		// Regular ktiv segments have qriOffset !== 0 and !== undefined
		const regularKtivSegments = allKtivSegments.filter(
			(s) => s.qriOffset !== undefined && s.qriOffset !== 0,
		);

		// Regular qri segments that differ from ktiv have ktivOffset !== 0 and !== undefined
		const regularQriWithOffset = allQriSegments.filter(
			(s) => s.ktivOffset !== undefined && s.ktivOffset !== 0,
		);

		// Regular qri segments without offset (qri same as ktiv)
		const regularQriWithoutOffset = allQriSegments.filter(
			(s) => s.ktivOffset === undefined,
		);

		it("all ktiv segments have qriOffset defined", () => {
			// Every ktiv should have qriOffset (either 0 for orphan or non-zero for pair)
			const ktivWithUndefinedOffset = allKtivSegments.filter(
				(s) => s.qriOffset === undefined,
			);
			expect(ktivWithUndefinedOffset.length).toBe(0);
		});

		it("has ktiv segments with non-zero offset (paired with qri)", () => {
			// These are proper ktiv/qri pairs
			expect(regularKtivSegments.length).toBeGreaterThan(0);
		});

		it("has qri segments with non-zero offset (paired with ktiv)", () => {
			// These are qri segments that differ from ktiv
			expect(regularQriWithOffset.length).toBeGreaterThan(0);
		});

		it("most qri segments have no offset (qri same as ktiv)", () => {
			// Regular vocalized text - qri === ktiv
			expect(regularQriWithoutOffset.length).toBeGreaterThan(300_000);
		});

		it("qri segments with non-zero offset are recognized as different from ktiv", () => {
			for (const segment of regularQriWithOffset) {
				expect(isQriDifferentThanKtiv(segment as unknown as QriSegment)).toBe(
					true,
				);
			}
		});

		it("ktiv segments with non-zero offset are recognized as different from qri", () => {
			for (const segment of regularKtivSegments) {
				expect(isKtivDifferentThanQri(segment as unknown as KtivSegment)).toBe(
					true,
				);
			}
		});
	});

	describe("Offset semantics", () => {
		it("offset=0 marks orphan segments explicitly", () => {
			// The convention: offset=0 means "this segment is orphan"
			// For ktiv: no qri reads this ktiv (כתיב ולא קרי)
			// For qri: no ktiv is written for this qri (קרי ולא כתיב)
			const orphanKtiv = allKtivSegments.filter((s) => s.qriOffset === 0);
			const orphanQri = allQriSegments.filter((s) => s.ktivOffset === 0);

			// Both orphan types should exist
			expect(orphanKtiv.length).toBeGreaterThan(0);
			expect(orphanQri.length).toBeGreaterThan(0);

			// Total orphans should match Rust test expectations
			expect(orphanKtiv.length + orphanQri.length).toBe(41);
		});

		it("non-zero offset indicates actual pair relationship", () => {
			// Positive offset: ktiv points forward to qri (qriOffset > 0)
			// Negative offset: qri points backward to ktiv (ktivOffset < 0)
			const ktivWithPositiveOffset = allKtivSegments.filter(
				(s) => s.qriOffset !== undefined && s.qriOffset > 0,
			);
			const qriWithNegativeOffset = allQriSegments.filter(
				(s) => s.ktivOffset !== undefined && s.ktivOffset < 0,
			);

			expect(ktivWithPositiveOffset.length).toBeGreaterThan(0);
			expect(qriWithNegativeOffset.length).toBeGreaterThan(0);
		});
	});
});
