/**
 * @jest-environment jsdom
 *
 * The dynamic wrapper is the browser-only entry point to the published
 * flip-book engine: this exercises the real lazy loader (issue #2780) so a
 * regression in the chunk import cannot leave readers blank while the
 * coverage gate stays green.
 */
import type React from "react";

interface DynamicCall {
	loader: () => Promise<unknown>;
	options: { ssr?: boolean } | undefined;
}

// Imports are hoisted above top-level initializers, and the next/dynamic mock
// factory runs during the FlipBook import — so the calls are stashed on
// globalThis rather than a module-scope variable.
const globalCalls = globalThis as typeof globalThis & {
	__flipBookDynamicCalls?: DynamicCall[];
};

jest.mock(
	"next/dynamic",
	() =>
		(loader: () => Promise<unknown>, options: { ssr?: boolean }): React.FC => {
			const g = globalThis as typeof globalThis & {
				__flipBookDynamicCalls?: DynamicCall[];
			};
			if (!g.__flipBookDynamicCalls) g.__flipBookDynamicCalls = [];
			g.__flipBookDynamicCalls.push({ loader, options });
			return function DynamicStub() {
				return null;
			};
		},
);

const MockFlipBook = jest.fn(() => null) as unknown as React.FC;

jest.mock("html-flip-book-react", () => ({ FlipBook: MockFlipBook }), {
	virtual: true,
});

import { FlipBook } from "@/app/components/reading/FlipBook";

describe("FlipBook", () => {
	it("registers a browser-only dynamic component", async () => {
		expect(FlipBook).toBeDefined();
		const captured = globalCalls.__flipBookDynamicCalls ?? [];
		expect(captured.length).toBeGreaterThan(0);
		// Other modules in the graph register their own dynamics; the
		// flip-book loader is the call that resolves to the published
		// component.
		const loaders = await Promise.all(captured.map((c) => c.loader()));
		const index = loaders.indexOf(MockFlipBook);
		expect(index).toBeGreaterThanOrEqual(0);
		// Next's dynamic-import transform merges in loadableGenerated
		// (webpack mapping); ssr:false is the part the source declares.
		expect(captured[index]?.options).toMatchObject({ ssr: false });
	});
});
