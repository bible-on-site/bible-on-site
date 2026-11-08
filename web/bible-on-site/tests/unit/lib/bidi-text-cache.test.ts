/**
 * Bounds test for the module-level UAX #9 run cache (#2620).
 *
 * The cache persists for the server's lifetime, so it must be bounded —
 * otherwise a long-lived process serving varied tanach PDF text (verses,
 * perushim, article titles) would grow it without limit. This file mocks
 * bidi-js so recomputation (a cache miss) is observable by call count.
 */
jest.mock("bidi-js", () => {
	// Singleton: bidi-text.ts and this test must share one mock instance —
	// the factory defers creation so the jest.mock hoist order stays legal.
	const shared = {
		getEmbeddingLevels: jest.fn((text: string) => ({
			paragraphs: [{ start: 0, end: text.length, level: 0 }],
			levels: new Array(text.length).fill(0),
		})),
		getReorderedIndices: jest.fn((text: string) =>
			Array.from({ length: text.length }, (_, i) => i),
		),
		getMirroredCharacter: () => null as string | null,
	};
	return { __esModule: true, default: () => shared };
});

import bidiFactory from "bidi-js";
import { visualTextRuns } from "../../../src/lib/download/bidi-text";

const bidi = bidiFactory() as unknown as {
	getEmbeddingLevels: jest.Mock;
	getReorderedIndices: jest.Mock;
};

describe("visualTextRuns cache bound", () => {
	it("evicts the oldest entry once the cache is full", () => {
		bidi.getEmbeddingLevels.mockClear();
		// Fill to the cap, then overflow it — each unique string is a miss.
		for (let i = 0; i < 1100; i++) {
			visualTextRuns(`label-${i}`);
		}
		expect(bidi.getEmbeddingLevels).toHaveBeenCalledTimes(1100);

		// The earliest label was evicted: recomputing it misses the cache.
		bidi.getEmbeddingLevels.mockClear();
		visualTextRuns("label-0");
		expect(bidi.getEmbeddingLevels).toHaveBeenCalledTimes(1);

		// A recent label is still cached: recomputing it does not miss.
		bidi.getEmbeddingLevels.mockClear();
		visualTextRuns("label-1099");
		expect(bidi.getEmbeddingLevels).not.toHaveBeenCalled();
	});
});
