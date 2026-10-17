/**
 * Registers Tanach PDF handlers (page ranges + full sefer).
 * Import this in a server context (e.g. 929 layout) so download actions can use it.
 *
 * Uses the Rust-based bulletin service for high-quality Hebrew PDF rendering.
 */
import { getSeferColor } from "@/data/sefer-colors";
import {
	getSeferCoverTitle,
	SEFER_COVER_BRANDING,
	SEFER_COVER_EDITION,
	SEFER_COVER_SUBTITLE,
} from "@/data/sefer-cover";

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
		cover: {
			branding: SEFER_COVER_BRANDING,
			title: getSeferCoverTitle(seferName),
			subtitle: SEFER_COVER_SUBTITLE,
			edition: SEFER_COVER_EDITION,
		},
	});
	return ["pdf", bin];
});
