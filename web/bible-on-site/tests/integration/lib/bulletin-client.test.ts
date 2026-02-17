/**
 * Integration tests for the bulletin PDF service client.
 *
 * Tests validate:
 * - Request payload construction (perek data, sefer name)
 * - Binary invocation via subprocess (mocked execFileSync)
 * - Error handling (binary not found, crash, empty output)
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

// Mock data access module
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

// Mock tanach-pdf utility functions
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
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

// PDF header bytes (%PDF-)
const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

function makeFakePdf(sizeBytes = 2048): Buffer {
	const buf = Buffer.alloc(sizeBytes);
	PDF_HEADER.copy(buf);
	return buf;
}

describe("bulletin-client", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Default: binary exists at debug path
		mockExistsSync.mockImplementation((path: string) =>
			path.includes("target/debug/bulletin") ||
			path.includes("target\\debug\\bulletin"),
		);
	});

	describe("generatePdfViaBulletin", () => {
		it("spawns the binary with correct JSON on stdin", () => {
			const fakePdf = makeFakePdf();
			mockExecFileSync.mockReturnValue(fakePdf);

			generatePdfViaBulletin([1], "בראשית");

			expect(mockExecFileSync).toHaveBeenCalledTimes(1);
			const [_binary, _args, opts] = mockExecFileSync.mock.calls[0];

			// Verify JSON payload sent via stdin
			const body = JSON.parse(opts.input);
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

		it("returns PDF bytes on success", () => {
			const fakePdf = makeFakePdf(4096);
			mockExecFileSync.mockReturnValue(fakePdf);

			const result = generatePdfViaBulletin([1, 2], "בראשית");

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(4096);
			expect(result[0]).toBe(0x25); // %
			expect(result[1]).toBe(0x50); // P
			expect(result[2]).toBe(0x44); // D
			expect(result[3]).toBe(0x46); // F
		});

		it("throws when binary is not found", () => {
			mockExistsSync.mockReturnValue(false);

			expect(() =>
				generatePdfViaBulletin([1], "בראשית"),
			).toThrow(/Bulletin binary not found/);
		});

		it("throws when binary crashes", () => {
			mockExecFileSync.mockImplementation(() => {
				throw new Error("Command failed: exit code 1");
			});

			expect(() =>
				generatePdfViaBulletin([1], "בראשית"),
			).toThrow(/Command failed/);
		});

		it("throws when binary returns too few bytes", () => {
			mockExecFileSync.mockReturnValue(Buffer.from([0, 1]));

			expect(() =>
				generatePdfViaBulletin([1], "בראשית"),
			).toThrow(/expected a PDF/);
		});

		it("fetches perek data from bundled JSON for each perekId", () => {
			mockExecFileSync.mockReturnValue(makeFakePdf());

			generatePdfViaBulletin([1, 2, 3], "שמות");

			expect(getPerekByPerekId).toHaveBeenCalledTimes(3);
			expect(getPerekByPerekId).toHaveBeenCalledWith(1);
			expect(getPerekByPerekId).toHaveBeenCalledWith(2);
			expect(getPerekByPerekId).toHaveBeenCalledWith(3);
		});

		it("sends multiple perakim in a single invocation", () => {
			mockExecFileSync.mockReturnValue(makeFakePdf());

			generatePdfViaBulletin([1, 2, 3], "במדבר");

			const [_binary, _args, opts] = mockExecFileSync.mock.calls[0];
			const body = JSON.parse(opts.input);
			expect(body.perakim).toHaveLength(3);
			expect(body.perakim[0].perekId).toBe(1);
			expect(body.perakim[1].perekId).toBe(2);
			expect(body.perakim[2].perekId).toBe(3);
		});

		it("sets a 30s timeout on the subprocess", () => {
			mockExecFileSync.mockReturnValue(makeFakePdf());

			generatePdfViaBulletin([1], "בראשית");

			const [_binary, _args, opts] = mockExecFileSync.mock.calls[0];
			expect(opts.timeout).toBe(30_000);
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
