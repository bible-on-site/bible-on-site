/**
 * Registers the Tanach PDF page-ranges handler.
 * Import this in a server context (e.g. 929 layout) so download actions can use it.
 *
 * Uses the Rust-based bulletin service for high-quality Hebrew PDF rendering.
 * Falls back to the pdf-lib handler if BULLETIN_URL is explicitly set to "disabled".
 */
import { setPageRangesDownloadHandler } from "./handlers";
import { createBulletinPageRangesHandler } from "./bulletin-client";

setPageRangesDownloadHandler(createBulletinPageRangesHandler());
