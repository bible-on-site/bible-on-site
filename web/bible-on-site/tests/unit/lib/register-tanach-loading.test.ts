const mockHeavyDependencyLoad = jest.fn((name: string) => {
	throw new Error(`Reader registration loaded optional ${name}`);
});

jest.mock("@pdf-lib/fontkit", () => mockHeavyDependencyLoad("font codecs"));
jest.mock("sharp", () => mockHeavyDependencyLoad("image processor"));

jest.mock("@/data/perek-dto", () => ({
	getPerekByPerekId: jest.fn(),
}));

jest.mock("@/data/sefer-dto", () => ({
	getSeferByName: jest.fn(),
	getPerekIdsForSefer: jest.fn(),
}));

describe("reader download registration", () => {
	it("registers both callbacks without loading PDF or image processors", async () => {
		const handlers = await import("../../../src/lib/download/handlers");
		await import("../../../src/lib/download/register-tanach");

		expect(handlers.getPageRangesDownloadHandler()).toEqual(
			expect.any(Function),
		);
		expect(handlers.getSeferDownloadHandler()).toEqual(expect.any(Function));
		expect(mockHeavyDependencyLoad).not.toHaveBeenCalled();
	});
});
