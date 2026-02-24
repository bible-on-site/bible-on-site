/**
 * Integration tests for the bulletin PDF service client.
 *
 * Tests validate:
 * - Request payload construction (just perek IDs — no text data)
 * - Binary invocation via subprocess (mocked execFileSync) — dev mode
 * - Lambda invocation via fetch (mocked global.fetch) — production mode
 * - Error handling (binary not found, crash, empty output, HTTP errors)
 * - Handler factory pattern
 */

// Mock child_process — the client spawns the bulletin binary
jest.mock("node:child_process", () => ({
	execFileSync: jest.fn(),
}));

// Mock fs — used to find the binary
jest.mock("node:fs", () => ({
	existsSync: jest.fn(),
	readFileSync: jest.fn().mockReturnValue(new Uint8Array([0, 1, 2, 3])),
}));

// Mock tanach-pdf utility functions
jest.mock("@/lib/download/tanach-pdf", () => ({
	semanticPagesToPerekIds: jest.fn(
		(semanticPages: Array<{ title: string }>, _seferName: string) =>
			semanticPages.map((_sp, i) => i + 1),
	),
}));

import {
	generatePdfViaBulletin,
	createBulletinPageRangesHandler,
} from "@/lib/download/bulletin-client";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const mockExecFileSync = execFileSync as jest.MockedFunction<
	typeof execFileSync
>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

function makeFakePdf(sizeBytes = 2048): Buffer {
	const buf = Buffer.alloc(sizeBytes);
	PDF_HEADER.copy(buf);
	return buf;
}

describe("bulletin-client", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockExistsSync.mockImplementation(
			(path: string) =>
				path.includes("target/debug/bulletin") ||
				path.includes("target\\debug\\bulletin"),
		);
	});

	describe("generatePdfViaBulletin (dev mode — no BULLETIN_SERVICE_URL)", () => {
		it("sends just perek IDs on stdin — no text data", async () => {
			const fakePdf = makeFakePdf();
			mockExecFileSync.mockReturnValue(fakePdf);

			await generatePdfViaBulletin([1, 2, 3]);

			expect(mockExecFileSync).toHaveBeenCalledTimes(1);
			const [_binary, _args, opts] = mockExecFileSync.mock.calls[0];

			const body = JSON.parse(opts.input);
			expect(body.perakimIds).toEqual([1, 2, 3]);
			expect(body.includeArticles).toBe(true);
			expect(body.articleIds).toEqual([]);
			expect(body.authorIds).toEqual([]);
			expect(body.pesukim).toBeUndefined();
			expect(body.perakim).toBeUndefined();
			expect(body.seferName).toBeUndefined();
		});

		it("returns PDF bytes on success", async () => {
			const fakePdf = makeFakePdf(4096);
			mockExecFileSync.mockReturnValue(fakePdf);

			const result = await generatePdfViaBulletin([1, 2]);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(4096);
			expect(result[0]).toBe(0x25); // %
			expect(result[1]).toBe(0x50); // P
			expect(result[2]).toBe(0x44); // D
			expect(result[3]).toBe(0x46); // F
		});

		it("throws when binary is not found", async () => {
			mockExistsSync.mockReturnValue(false);

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/Bulletin binary not found/,
			);
		});

		it("throws when binary crashes", async () => {
			mockExecFileSync.mockImplementation(() => {
				throw new Error("Command failed: exit code 1");
			});

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/Command failed/,
			);
		});

		it("throws when binary returns too few bytes", async () => {
			mockExecFileSync.mockReturnValue(Buffer.from([0, 1]));

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/expected a PDF/,
			);
		});

		it("sends multiple perak IDs in a single invocation", async () => {
			mockExecFileSync.mockReturnValue(makeFakePdf());

			await generatePdfViaBulletin([100, 200, 300]);

			const [_binary, _args, opts] = mockExecFileSync.mock.calls[0];
			const body = JSON.parse(opts.input);
			expect(body.perakimIds).toEqual([100, 200, 300]);
		});

		it("sets a 30s timeout on the subprocess", async () => {
			mockExecFileSync.mockReturnValue(makeFakePdf());

			await generatePdfViaBulletin([1]);

			const [_binary, _args, opts] = mockExecFileSync.mock.calls[0];
			expect(opts.timeout).toBe(30_000);
		});
	});

	describe("generatePdfViaBulletin (production mode — BULLETIN_SERVICE_URL set)", () => {
		const mockFetch = jest.fn();
		const originalFetch = global.fetch;

		beforeEach(() => {
			process.env.BULLETIN_SERVICE_URL = "https://test-lambda.example.com";
			global.fetch = mockFetch;
			mockFetch.mockReset();
		});

		afterEach(() => {
			delete process.env.BULLETIN_SERVICE_URL;
			global.fetch = originalFetch;
		});

		it("calls fetch with the correct URL and payload", async () => {
			const fakePdf = makeFakePdf();
			mockFetch.mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(fakePdf.buffer),
			});

			await generatePdfViaBulletin([1, 2, 3]);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, opts] = mockFetch.mock.calls[0];
			expect(url).toBe(
				"https://test-lambda.example.com/api/generate-pdf",
			);
			expect(opts.method).toBe("POST");
			expect(opts.headers["Content-Type"]).toBe("application/json");

			const body = JSON.parse(opts.body);
			expect(body.perakimIds).toEqual([1, 2, 3]);
			expect(body.includeArticles).toBe(true);
		});

		it("returns PDF bytes from Lambda response", async () => {
			const fakePdf = makeFakePdf(4096);
			mockFetch.mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(fakePdf.buffer),
			});

			const result = await generatePdfViaBulletin([1]);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(4096);
		});

		it("throws when Lambda returns non-OK status", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				text: () => Promise.resolve('{"error":"internal"}'),
			});

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/Bulletin service returned 500/,
			);
		});

		it("throws when Lambda returns too few bytes", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				arrayBuffer: () =>
					Promise.resolve(new ArrayBuffer(2)),
			});

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/expected a PDF/,
			);
		});

		it("does not invoke the local binary", async () => {
			const fakePdf = makeFakePdf();
			mockFetch.mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(fakePdf.buffer),
			});

			await generatePdfViaBulletin([1]);

			expect(mockExecFileSync).not.toHaveBeenCalled();
		});

		it("handler works with Lambda path", async () => {
			const fakePdf = makeFakePdf();
			mockFetch.mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(fakePdf.buffer),
			});

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
			mockExecFileSync.mockReturnValue(makeFakePdf());

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
