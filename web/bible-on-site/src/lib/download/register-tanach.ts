/**
 * Registers the Tanach PDF page-ranges handler.
 * Import this in a server context (e.g. 929 layout) so download actions can use it.
 */
import { setPageRangesDownloadHandler } from "./handlers";
import { createTanachPageRangesHandler } from "./tanach-pdf";

setPageRangesDownloadHandler(createTanachPageRangesHandler());
