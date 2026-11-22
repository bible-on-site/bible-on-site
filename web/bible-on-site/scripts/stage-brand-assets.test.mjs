import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { STAGED_ASSETS, stageBrandAssets } from "./stage-brand-assets.mjs";

const website = fileURLToPath(new URL("..", import.meta.url));
const branding = resolve(website, "../shared/branding");

test("staging reproduces every canonical brand asset byte-for-byte", () => {
	stageBrandAssets();
	for (const [source, destination] of STAGED_ASSETS) {
		assert.deepEqual(
			readFileSync(resolve(website, destination)),
			readFileSync(resolve(branding, source)),
			destination,
		);
	}
});

test("every historical brand URL still has a staged file", () => {
	const destinations = new Set(STAGED_ASSETS.map(([, destination]) => destination));
	for (const required of [
		"public/fonts/AlHeperekUI-Regular.woff2",
		"public/fonts/AlHeperekUI-SemiBold.woff2",
		"public/fonts/AlHeperekUI-Bold.woff2",
		"public/fonts/AlHeperek-license.txt",
		"public/font-license.txt",
		"public/apple-touch-icon.png",
		"public/images/logos/header-logo.jpg",
		"public/images/logos/header-logo.svg",
		"public/images/logos/header-logo-reversed.svg",
		"public/images/logos/logo192.webp",
		"public/images/logos/logo-white-letters-69.webp",
		"src/app/favicon.ico",
		"src/lib/download/logo_header.jpg",
		"src/lib/download/fonts/AlHeperekUI-Regular.ttf",
		"src/lib/download/fonts/AlHeperekUI-Bold.ttf",
	]) {
		assert.ok(destinations.has(required), required);
	}
});
