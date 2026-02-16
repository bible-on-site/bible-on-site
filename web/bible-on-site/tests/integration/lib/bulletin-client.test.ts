/**
 * Integration tests for the bulletin PDF service client.
 *
 * These tests validate:
 * - Request payload construction (perek data, sefer name)
 * - Bulletin service communication (mocked HTTP)
 * - Error handling (service down, bad response, empty payload)
 * - Handler factory pattern
 *
 * The bulletin service (web/bulletin) is mocked via fetch — the Rust service
 * does not need to be running for these tests.
 */

// Mock data access module that bulletin-client imports
jest.mock("@/data/perek-dto", () => ({
	getPerekByPerekId: jest.fn((id: number) => ({
		perekId: id,
		perekHeb: id === 1 ? "א" : id === 2 ? "ב" : "ג",
		header: id === 1 ? "בריאת העולם" : "",
		pesukim: [
			{
				segments: [
					{ t: "בראשית ברא אלהים" },
					{ t: "את השמים ואת הארץ" },
				],
			},
			{
				segments: [{ t: "ויאמר אלהים יהי אור" }],
			},
		],
	})),
}));

// Mock tanach-pdf utility functions (bulletin-client depends on these)
jest.mock("@/lib/download/tanach-pdf", () => ({
	semanticPagesToPerekIds: jest.fn(
		(semanticPages: Array<{ title: string }>, _seferName: string) =>
			semanticPages.map((_sp, i) => i + 1),
	),
	segmentsToText: jest.fn(
		(segments: Array<{ t: string }>) =>
			segments.map((s) => s.t).join(" "),
	),
	stripTaamim: jest.fn((text: string) => text),
}));

import {
	generatePdfViaBulletin,
	createBulletinPageRangesHandler,
} from "@/lib/download/bulletin-client";
import { getPerekByPerekId } from "@/data/perek-dto";

// ─────── Helpers ─────────────────────────────────────────────────
// jsdom doesn't provide the Fetch API's Response class, so we build
// a minimal duck-typed stand-in that matches what bulletin-client uses.

function makeFakeResponse(
	body: Uint8Array | string,
	init: { status: number; statusText?: string; headers?: Record<string, string> },
) {
	const isString = typeof body === "string";
	return {
		ok: init.status >= 200 && init.status < 300,
		status: init.status,
		statusText: init.statusText ?? "",
		headers: new Map(Object.entries(init.headers ?? {})),
		text: () => Promise.resolve(isString ? body : new TextDecoder().decode(body)),
		arrayBuffer: () =>
			Promise.resolve(
				isString
					? new TextEncoder().encode(body).buffer
					: (body as Uint8Array).buffer,
			),
	};
}

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function makeFakePdf(sizeBytes = 2048): Uint8Array {
	const buf = new Uint8Array(sizeBytes);
	buf.set(PDF_HEADER);
	return buf;
}

// ─────── Tests ───────────────────────────────────────────────────

describe("bulletin-client", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	describe("generatePdfViaBulletin", () => {
		it("sends correctly shaped request to the bulletin service", async () => {
			const fakePdf = makeFakePdf();
			let capturedBody: string | undefined;

			global.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
				capturedBody = init.body as string;
				return makeFakeResponse(fakePdf, {
					status: 200,
					headers: { "content-type": "application/pdf" },
				});
			}) as typeof fetch;

			await generatePdfViaBulletin([1], "בראשית");

			expect(global.fetch).toHaveBeenCalledTimes(1);
			const [callUrl, callInit] = (global.fetch as jest.Mock).mock.calls[0];
			expect(callUrl).toContain("/api/generate-pdf");
			expect(callInit.method).toBe("POST");
			expect(callInit.headers["Content-Type"]).toBe("application/json");

			const body = JSON.parse(capturedBody as string);
			expect(body.seferName).toBe("בראשית");
			expect(body.perakim).toHaveLength(1);
			expect(body.perakim[0].perekId).toBe(1);
			expect(body.perakim[0].perekHeb).toBe("א");
			expect(body.perakim[0].header).toBe("בריאת העולם");
			expect(body.perakim[0].pesukim).toBeInstanceOf(Array);
			expect(body.perakim[0].pesukim.length).toBeGreaterThan(0);
			expect(body.includeArticles).toBe(true);
			expect(body.articleIds).toEqual([]);
			expect(body.authorIds).toEqual([]);
		});

		it("returns PDF bytes on success", async () => {
			const fakePdf = makeFakePdf(4096);
			global.fetch = jest.fn().mockResolvedValue(
				makeFakeResponse(fakePdf, {
					status: 200,
					headers: { "content-type": "application/pdf" },
				}),
			) as typeof fetch;

			const result = await generatePdfViaBulletin([1, 2], "בראשית");

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(4096);
			expect(result[0]).toBe(0x25); // %
			expect(result[1]).toBe(0x50); // P
			expect(result[2]).toBe(0x44); // D
			expect(result[3]).toBe(0x46); // F
		});

		it("throws on non-OK response from bulletin service", async () => {
			global.fetch = jest.fn().mockResolvedValue(
				makeFakeResponse('{"error":"DB connection failed"}', {
					status: 500,
					statusText: "Internal Server Error",
				}),
			) as typeof fetch;

			await expect(
				generatePdfViaBulletin([1], "בראשית"),
			).rejects.toThrow(/Bulletin service error 500/);
		});

		it("throws on network failure", async () => {
			global.fetch = jest.fn().mockRejectedValue(
				new TypeError("fetch failed"),
			) as typeof fetch;

			await expect(
				generatePdfViaBulletin([1], "בראשית"),
			).rejects.toThrow("fetch failed");
		});

		it("fetches perek data from bundled JSON for each perekId", async () => {
			global.fetch = jest.fn().mockResolvedValue(
				makeFakeResponse(makeFakePdf(), { status: 200 }),
			) as typeof fetch;

			await generatePdfViaBulletin([1, 2, 3], "שמות");

			expect(getPerekByPerekId).toHaveBeenCalledTimes(3);
			expect(getPerekByPerekId).toHaveBeenCalledWith(1);
			expect(getPerekByPerekId).toHaveBeenCalledWith(2);
			expect(getPerekByPerekId).toHaveBeenCalledWith(3);
		});

		it("sends multiple perakim in a single request", async () => {
			let capturedBody: string | undefined;
			global.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
				capturedBody = init.body as string;
				return makeFakeResponse(makeFakePdf(), { status: 200 });
			}) as typeof fetch;

			await generatePdfViaBulletin([1, 2, 3], "במדבר");

			const body = JSON.parse(capturedBody as string);
			expect(body.perakim).toHaveLength(3);
			expect(body.perakim[0].perekId).toBe(1);
			expect(body.perakim[1].perekId).toBe(2);
			expect(body.perakim[2].perekId).toBe(3);
		});
	});

	describe("createBulletinPageRangesHandler", () => {
		it("returns a handler function", () => {
			const handler = createBulletinPageRangesHandler();
			expect(typeof handler).toBe("function");
		});

		it("throws when context.seferName is missing", async () => {
			const handler = createBulletinPageRangesHandler();

			await expect(
				handler(
					[0, 1],
					[
						{ pageIndex: 0, semanticName: "א", title: "פרק א'" },
						{ pageIndex: 1, semanticName: "ב", title: "פרק ב'" },
					],
				),
			).rejects.toThrow("Tanach PDF requires context.seferName");
		});

		it("throws when no content pages in range", async () => {
			const { semanticPagesToPerekIds } = jest.requireMock(
				"@/lib/download/tanach-pdf",
			);
			semanticPagesToPerekIds.mockReturnValueOnce([]);

			const handler = createBulletinPageRangesHandler();

			await expect(
				handler(
					[0],
					[{ pageIndex: 0, semanticName: "א", title: "פרק א'" }],
					{ seferName: "בראשית" },
				),
			).rejects.toThrow("No content pages in selected range");
		});

		it("returns ['pdf', Uint8Array] tuple on success", async () => {
			const fakePdf = makeFakePdf();
			global.fetch = jest.fn().mockResolvedValue(
				makeFakeResponse(fakePdf, { status: 200 }),
			) as typeof fetch;

			const handler = createBulletinPageRangesHandler();
			const [ext, bin] = await handler(
				[0, 1],
				[
					{ pageIndex: 0, semanticName: "א", title: "פרק א'" },
					{ pageIndex: 1, semanticName: "ב", title: "פרק ב'" },
				],
				{ seferName: "בראשית" },
			);

			expect(ext).toBe("pdf");
			expect(bin).toBeInstanceOf(Uint8Array);
			expect(bin.length).toBeGreaterThan(0);
		});
	});
});
