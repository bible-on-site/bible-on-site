/**
 * Registers Tanach PDF handlers (page ranges + full sefer).
 * Import this in a server context (e.g. 929 layout) so download actions can use it.
 *
 * Uses the Rust-based bulletin service for high-quality Hebrew PDF rendering.
 */
import { getSeferColor } from "@/data/sefer-colors";

import { createBulletinPageRangesHandler, generatePdfViaBulletin } from "./bulletin-client";
import { setPageRangesDownloadHandler, setSeferDownloadHandler } from "./handlers";

setPageRangesDownloadHandler(createBulletinPageRangesHandler());

setSeferDownloadHandler(async ({ seferName, perekIds }) => {
	if (perekIds.length === 0) {
		throw new Error("Full sefer download requires at least one perek id");
	}
	const accent = getSeferColor(seferName).replace(/^#/, "");
	const bin = await generatePdfViaBulletin(perekIds, {
		seferName,
		includeCover: true,
		includeToc: true,
		coverAccentHex: accent,
	});
	return ["pdf", bin];
});
