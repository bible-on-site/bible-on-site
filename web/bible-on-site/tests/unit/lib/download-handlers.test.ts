import {
	getPageRangesDownloadHandler,
	getSeferDownloadHandler,
	setPageRangesDownloadHandler,
	setSeferDownloadHandler,
} from "../../../src/lib/download/handlers";
import type {
	PageRangesDownloadHandler,
	SeferDownloadHandler,
} from "../../../src/lib/download/types";

describe("download handlers", () => {
	afterEach(() => {
		// Reset handlers to null after each test to avoid cross-test pollution
		setSeferDownloadHandler(null);
		setPageRangesDownloadHandler(null);
	});

	describe("setSeferDownloadHandler + getSeferDownloadHandler", () => {
		it("roundtrip: set and get returns the same handler", () => {
			const handler: SeferDownloadHandler = async () => [
				"pdf",
				new Uint8Array([1]),
			];
			setSeferDownloadHandler(handler);
			expect(getSeferDownloadHandler()).toBe(handler);
		});

		it("returns null when no handler is set", () => {
			expect(getSeferDownloadHandler()).toBeNull();
		});

		it("set to null after setting a handler clears it", () => {
			const handler: SeferDownloadHandler = async () => [
				"pdf",
				new Uint8Array([1]),
			];
			setSeferDownloadHandler(handler);
			expect(getSeferDownloadHandler()).toBe(handler);

			setSeferDownloadHandler(null);
			expect(getSeferDownloadHandler()).toBeNull();
		});
	});

	describe("setPageRangesDownloadHandler + getPageRangesDownloadHandler", () => {
		it("roundtrip: set and get returns the same handler", () => {
			const handler: PageRangesDownloadHandler = async () => [
				"pdf",
				new Uint8Array([2]),
			];
			setPageRangesDownloadHandler(handler);
			expect(getPageRangesDownloadHandler()).toBe(handler);
		});

		it("returns null when no handler is set", () => {
			expect(getPageRangesDownloadHandler()).toBeNull();
		});

		it("set to null after setting a handler clears it", () => {
			const handler: PageRangesDownloadHandler = async () => [
				"pdf",
				new Uint8Array([2]),
			];
			setPageRangesDownloadHandler(handler);
			expect(getPageRangesDownloadHandler()).toBe(handler);

			setPageRangesDownloadHandler(null);
			expect(getPageRangesDownloadHandler()).toBeNull();
		});
	});
});
