/**
 * Download interfaces for sefer and page-ranges.
 * Consumers implement these; actions call them when provided.
 */

/** Describes one page in a range for the page-ranges download handler */
export interface SemanticPageInfo {
	/** Zero-based page index in the book */
	pageIndex: number;
	/** Display page number (e.g. Hebrew letter or "1") */
	semanticName: string;
	/** Title for the page (e.g. "פרק א'") */
	title: string;
}

/** Result of a download: file extension and binary content */
export type DownloadResult = [ext: string, bin: Uint8Array];

/** Optional context for page-ranges download (e.g. sefer name for Tanach) */
export interface PageRangesDownloadContext {
	seferName?: string;
}

/**
 * Sefer download handler.
 * Receives no arguments; consumer decides scope (e.g. current sefer from context).
 * Returns [extension, binary] for the downloaded file.
 */
export type SeferDownloadHandler = () => Promise<DownloadResult>;

/**
 * Page-ranges download handler.
 * Receives page indices and semantic info for the selected range.
 * Optional context (e.g. seferName) for implementations that need it.
 * Returns [extension, binary] for the downloaded file.
 */
export type PageRangesDownloadHandler = (
	pages: number[],
	semanticPages: SemanticPageInfo[],
	context?: PageRangesDownloadContext,
) => Promise<DownloadResult>;
