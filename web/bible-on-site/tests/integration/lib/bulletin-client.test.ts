/**
 * Integration tests for the bulletin PDF service client.
 *
 * Tests validate:
 * - Request payload construction (just perek IDs — no text data)
 * - Binary invocation via subprocess (mocked execFileSync) — dev mode
 * - Lambda invocation via AWS SDK (mocked @aws-sdk/client-lambda) — production mode
 * - Error handling (binary not found, crash, empty output, Lambda errors)
 * - Handler factory pattern
 */

const mockSend = jest.fn();
jest.mock("@aws-sdk/client-lambda", () => ({
	LambdaClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
	InvokeCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

jest.mock("node:child_process", () => ({
	execFileSync: jest.fn(),
}));

jest.mock("node:fs", () => ({
	existsSync: jest.fn(),
	readFileSync: jest.fn().mockReturnValue(new Uint8Array([0, 1, 2, 3])),
}));

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

function makeLambdaResponse(pdfBuf: Buffer) {
	return {
		Payload: Buffer.from(
			JSON.stringify({
				statusCode: 200,
				body: pdfBuf.toString("base64"),
				isBase64Encoded: true,
				headers: { "content-type": "application/pdf" },
			}),
		),
	};
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

	describe("generatePdfViaBulletin (dev mode — no BULLETIN_LAMBDA_NAME)", () => {
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

	describe("generatePdfViaBulletin (production mode — BULLETIN_LAMBDA_NAME set)", () => {
		beforeEach(() => {
			process.env.BULLETIN_LAMBDA_NAME = "bible-on-site-bulletin";
			mockSend.mockReset();
		});

		afterEach(() => {
			delete process.env.BULLETIN_LAMBDA_NAME;
		});

		it("invokes the Lambda with correct function name and payload", async () => {
			mockSend.mockResolvedValue(makeLambdaResponse(makeFakePdf()));

			await generatePdfViaBulletin([1, 2, 3]);

			expect(mockSend).toHaveBeenCalledTimes(1);
			const invokeInput = mockSend.mock.calls[0][0];
			expect(invokeInput.FunctionName).toBe("bible-on-site-bulletin");

			const event = JSON.parse(
				Buffer.from(invokeInput.Payload).toString("utf-8"),
			);
			expect(event.httpMethod).toBe("POST");
			expect(event.path).toBe("/api/generate-pdf");
			const body = JSON.parse(event.body);
			expect(body.perakimIds).toEqual([1, 2, 3]);
			expect(body.includeArticles).toBe(true);
		});

		it("returns PDF bytes from Lambda response", async () => {
			const fakePdf = makeFakePdf(4096);
			mockSend.mockResolvedValue(makeLambdaResponse(fakePdf));

			const result = await generatePdfViaBulletin([1]);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(4096);
		});

		it("throws when Lambda returns FunctionError", async () => {
			mockSend.mockResolvedValue({
				FunctionError: "Unhandled",
				Payload: Buffer.from("stack trace here"),
			});

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/Bulletin Lambda error/,
			);
		});

		it("throws when Lambda returns empty payload", async () => {
			mockSend.mockResolvedValue({ Payload: undefined });

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/empty payload/,
			);
		});

		it("throws when Lambda returns non-200 status", async () => {
			mockSend.mockResolvedValue({
				Payload: Buffer.from(
					JSON.stringify({ statusCode: 500, body: '{"error":"oops"}' }),
				),
			});

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/Bulletin Lambda returned status 500/,
			);
		});

		it("throws when Lambda returns too few bytes", async () => {
			mockSend.mockResolvedValue({
				Payload: Buffer.from(
					JSON.stringify({
						statusCode: 200,
						body: Buffer.from([0, 1]).toString("base64"),
						isBase64Encoded: true,
					}),
				),
			});

			await expect(generatePdfViaBulletin([1])).rejects.toThrow(
				/expected a PDF/,
			);
		});

		it("does not invoke the local binary", async () => {
			mockSend.mockResolvedValue(makeLambdaResponse(makeFakePdf()));

			await generatePdfViaBulletin([1]);

			expect(mockExecFileSync).not.toHaveBeenCalled();
		});

		it("handler works with Lambda path", async () => {
			mockSend.mockResolvedValue(makeLambdaResponse(makeFakePdf()));

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
