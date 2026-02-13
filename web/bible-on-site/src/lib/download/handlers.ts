/**
 * Optional download handlers. Set by the consumer; actions use these when present.
 */
import type { PageRangesDownloadHandler, SeferDownloadHandler } from "./types";

let seferHandler: SeferDownloadHandler | null = null;
let pageRangesHandler: PageRangesDownloadHandler | null = null;

export function setSeferDownloadHandler(
	handler: SeferDownloadHandler | null,
): void {
	seferHandler = handler;
}

export function setPageRangesDownloadHandler(
	handler: PageRangesDownloadHandler | null,
): void {
	pageRangesHandler = handler;
}

export function getSeferDownloadHandler(): SeferDownloadHandler | null {
	return seferHandler;
}

export function getPageRangesDownloadHandler(): PageRangesDownloadHandler | null {
	return pageRangesHandler;
}
