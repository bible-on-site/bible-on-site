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

let logoCache: Uint8Array | null = null;

/**
 * The project's brand logo (the app's logo_header.jpg, vendored next to the
 * fonts). JPEG embeds directly via pdf-lib — keeping it under download/ puts
 * its bytes in the calendar-PDF render fingerprint, so a logo change
 * invalidates the affected cached artifacts (#2727).
 */
export function getLogoBytes(): Uint8Array {
	if (!logoCache) {
		// Copy into a Uint8Array with its own ArrayBuffer — a pooled Node
		// Buffer's .buffer can be larger than the file bytes, and pdf-lib's
		// embedJpg reads it from offset 0 (Buffer pooling broke this in jest).
		logoCache = new Uint8Array(
			readFileSync(
				resolve(process.cwd(), "src", "lib", "download", "logo_header.jpg"),
			),
		);
	}
	return logoCache;
}
