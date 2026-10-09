jest.mock("@/data/sefer-colors", () => ({
	getSeferColor: jest.fn(() => "#123abc"),
}));

const mockPageRangesHandler = jest.fn();
const mockGeneratePdfViaBulletin = jest.fn(
	async (_perekIds: number[], _options?: unknown) =>
		new Uint8Array([1, 2, 3]),
);

jest.mock("../../../src/lib/download/bulletin-client", () => ({
	createBulletinPageRangesHandler: jest.fn(() => mockPageRangesHandler),
	generatePdfViaBulletin: (perekIds: number[], options?: unknown) =>
		mockGeneratePdfViaBulletin(perekIds, options),
}));

import { getSeferColor } from "@/data/sefer-colors";
import {
	getPageRangesDownloadHandler,
	getSeferDownloadHandler,
	setPageRangesDownloadHandler,
	setSeferDownloadHandler,
} from "../../../src/lib/download/handlers";

const mockGetSeferColor = getSeferColor as jest.MockedFunction<
	typeof getSeferColor
>;

describe("register tanach downloads", () => {
	afterEach(() => {
		jest.resetModules();
		jest.clearAllMocks();
		setPageRangesDownloadHandler(null);
		setSeferDownloadHandler(null);
	});

	it("registers bulletin-backed page range and full sefer handlers", async () => {
		await import("../../../src/lib/download/register-tanach");

		expect(getPageRangesDownloadHandler()).toBe(mockPageRangesHandler);
		const seferHandler = getSeferDownloadHandler();
		expect(seferHandler).not.toBeNull();

		await expect(
			seferHandler?.({ seferName: "Bereshit", perekIds: [] }),
		).rejects.toThrow("Full sefer download requires at least one perek id");

		const result = await seferHandler?.({
			seferName: "Bereshit",
			perekIds: [1, 2],
		});

		expect(result).toEqual(["pdf", new Uint8Array([1, 2, 3])]);
		expect(mockGetSeferColor).toHaveBeenCalledWith("Bereshit");
		expect(mockGeneratePdfViaBulletin).toHaveBeenCalledWith([1, 2], {
			seferName: "Bereshit",
			includeCover: true,
			includeToc: true,
			coverAccentHex: "123abc",
		});
	});
});
