/**
 * Stages the canonical shared brand assets (#3708) into the served locations
 * the site has always exposed: public/ static files, the app-router favicon,
 * and the PDF renderer inputs under src/lib/download/. The shared copies in
 * web/shared/branding are the only tracked sources; every staged file is a
 * build artifact regenerated here, so consumers keep their existing URLs and
 * the standalone trace keeps working with package-relative paths.
 *
 * Runs as a side effect of next.config.mjs (dev/build), the unit-test pretest
 * hook, and generate-calendar-pdfs.mts.
 */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const website = fileURLToPath(new URL("..", import.meta.url));
const branding = resolve(website, "../shared/branding");

const FONT_WEIGHTS = ["Regular", "SemiBold", "Bold"];
const FAVICON_SIZES = [16, 24, 32, 48];

/** [source under web/shared/branding, destination under the website root] */
export const STAGED_ASSETS = [
	...FONT_WEIGHTS.flatMap((weight) => [
		[`fonts/AlHeperekUI-${weight}.woff2`, `public/fonts/AlHeperekUI-${weight}.woff2`],
		[
			`fonts/AlHeperekUI-${weight}.ttf`,
			`src/lib/download/fonts/AlHeperekUI-${weight}.ttf`,
		],
	]),
	["fonts/AlHeperek-license.txt", "public/fonts/AlHeperek-license.txt"],
	["fonts/AlHeperek-license.txt", "public/font-license.txt"],
	["derived/logo_header.jpg", "src/lib/download/logo_header.jpg"],
	["derived/logo_header.jpg", "public/images/logos/header-logo.jpg"],
	["derived/favicon.ico", "src/app/favicon.ico"],
	["derived/logo192.webp", "public/images/logos/logo192.webp"],
	[
		"derived/logo-white-letters-69.webp",
		"public/images/logos/logo-white-letters-69.webp",
	],
	["derived/apple-touch-icon.png", "public/apple-touch-icon.png"],
	["logos/header-logo.svg", "public/images/logos/header-logo.svg"],
	["logos/header-logo-reversed.svg", "public/images/logos/header-logo-reversed.svg"],
	...FAVICON_SIZES.flatMap((size) => [
		[`logos/favicon-${size}.svg`, `public/images/logos/favicon-${size}.svg`],
		[`derived/favicon-${size}.png`, `public/images/logos/favicon-${size}.png`],
	]),
];

export function stageBrandAssets({ check = false } = {}) {
	for (const [source, destination] of STAGED_ASSETS) {
		const target = resolve(website, destination);
		const canonical = resolve(branding, source);
		// --check (e.g. the calendar-PDF verifier) must stay fully read-only:
		// it proves the staged copy is byte-identical without any write.
		if (check) {
			const staged = readFileSync(target);
			if (!staged.equals(readFileSync(canonical))) {
				throw new Error(
					`Staged brand asset differs from web/shared/branding/${source}: ${destination}`,
				);
			}
			continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(canonical, target);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const check = process.argv.slice(2).includes("--check");
	stageBrandAssets({ check });
	console.log(
		`${check ? "Verified" : "Staged"} ${STAGED_ASSETS.length} shared brand assets.`,
	);
}
