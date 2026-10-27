/**
 * Shared Frank Ruhl Libre font loading for the PDF generators.
 *
 * Extracted from tanach-pdf.ts (#2608) so the calendar renderer and the
 * offline artifact generator do not pull scripture/DB modules (perushim,
 * articles, mysql) just to embed a font.
 *
 * Uses the static-weight TTFs (not variable) so fontkit metrics are accurate.
 * pdf-lib's StandardFonts only support WinAnsi (Latin-1) encoding — any
 * non-Latin text (Hebrew, Arabic, etc.) requires an embedded custom font.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let regularFontCache: Uint8Array | null = null;
let boldFontCache: Uint8Array | null = null;

function loadFont(filename: string): Uint8Array {
	const fontPath = resolve(
		process.cwd(),
		"src",
		"lib",
		"download",
		"fonts",
		filename,
	);
	return readFileSync(fontPath);
}

export function getRegularFontBytes(): Uint8Array {
	if (!regularFontCache)
		regularFontCache = loadFont("FrankRuhlLibre-Regular.ttf");
	return regularFontCache;
}

export function getBoldFontBytes(): Uint8Array {
	if (!boldFontCache) boldFontCache = loadFont("FrankRuhlLibre-Bold.ttf");
	return boldFontCache;
}
