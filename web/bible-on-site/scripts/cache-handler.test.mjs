import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import nodeFsModule from "next/dist/server/lib/node-fs-methods.js";
import Handler, {
	filesystemSafeCacheKey,
} from "../cache-handler.mjs";

const nodeFs = nodeFsModule.nodeFs;
const ROUTE_PREFIX = "/route-cache/APP_PAGE/deadbeef/$";

test("ASCII storage keys pass through unchanged", () => {
	for (const key of [
		`${ROUTE_PREFIX}/929/1/686`,
		"/route-cache/PAGES/a1b2/$/about",
		"9f2c1aa0cafe",
		"/route-cache/APP_PAGE/00/$/calendar.segments",
	]) {
		assert.equal(filesystemSafeCacheKey(key), key);
	}
});

test("quoted and Unicode slugs become legal filenames on every OS", () => {
	assert.equal(
		filesystemSafeCacheKey(`${ROUTE_PREFIX}/929/1/רש"י`),
		`${ROUTE_PREFIX}/929/1/%D7%A8%D7%A9%22%D7%99`,
	);
	assert.equal(
		filesystemSafeCacheKey(`${ROUTE_PREFIX}/929/1/רמבן`),
		`${ROUTE_PREFIX}/929/1/%D7%A8%D7%9E%D7%91%D7%9F`,
	);
	// The `"` was the only NTFS-illegal byte, but every non-safe byte is
	// encoded so the whole segment stays portable and deterministic.
	assert.equal(
		filesystemSafeCacheKey(`${ROUTE_PREFIX}/x/a b?c*d`),
		`${ROUTE_PREFIX}/x/a%20b%3Fc%2Ad`,
	);
});

test("segments hostile to path resolution are fully encoded", () => {
	for (const segment of [".", "..", "CON", "com1", "LPT9"]) {
		const key = `${ROUTE_PREFIX}/dir/${segment}`;
		assert.equal(
			filesystemSafeCacheKey(key).split("/").pop(),
			[...new TextEncoder().encode(segment)]
				.map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
				.join(""),
		);
	}
});

test("characters legal on Windows keep their literal form", () => {
	// `$` markers, URI-unreserved bytes and Windows-legal punctuation are not
	// encoded — matching the encodeURIComponent convention build output uses,
	// except `*`, which NTFS forbids and is therefore encoded.
	assert.equal(
		filesystemSafeCacheKey(`${ROUTE_PREFIX}/x/$d$number-._~'()!`),
		`${ROUTE_PREFIX}/x/$d$number-._~'()!`,
	);
});

test("set/get persist scoped entries under filesystem-safe names", async () => {
	const dist = mkdtempSync(join(tmpdir(), "route-cache-"));
	try {
		const handler = new Handler({
			dev: false,
			fs: nodeFs,
			flushToDisk: true,
			serverDistDir: dist,
			revalidatedTags: [],
			maxMemoryCacheSize: 0,
		});
		const key = `${ROUTE_PREFIX}/929/1/רש"י`;
		await handler.set(
			key,
			{
				kind: "APP_PAGE",
				html: "<html>רש״י</html>",
				rscData: Buffer.from("rsc"),
				segmentData: new Map([
					["/929/$d$number/$d$slug/__PAGE__", Buffer.from("seg")],
				]),
				headers: {},
				status: 200,
				postponed: undefined,
			},
			{ kind: "APP_PAGE", isFallback: false, isRoutePPREnabled: false },
		);
		// The persisted artifacts use the encoded slug — NTFS-legal — while the
		// route-cache namespace and source-route hash are preserved.
		const encoded = `${dist}/route-cache/APP_PAGE/deadbeef/$/929/1/%D7%A8%D7%A9%22%D7%99`;
		assert.equal(readFileSync(`${encoded}.html`, "utf8"), "<html>רש״י</html>");
		assert.equal(readFileSync(`${encoded}.rsc`, "utf8"), "rsc");
		assert.equal(
			readFileSync(
				`${encoded}.segments/929/$d$number/$d$slug/__PAGE__.segment.rsc`,
				"utf8",
			),
			"seg",
		);
		// Reading back through the public (decoded) key resolves the same entry.
		const cached = await handler.get(key, { kind: "APP_PAGE" });
		assert.equal(cached.value.html, "<html>רש״י</html>");
		assert.equal(cached.value.rscData.toString(), "rsc");
		assert.equal(
			cached.value.segmentData
				.get("/929/$d$number/$d$slug/__PAGE__")
				.toString(),
			"seg",
		);
	} finally {
		rmSync(dist, { recursive: true, force: true });
	}
});

test("an ASCII slug still persists under its readable name", async () => {
	const dist = mkdtempSync(join(tmpdir(), "route-cache-"));
	try {
		const handler = new Handler({
			dev: false,
			fs: nodeFs,
			flushToDisk: true,
			serverDistDir: dist,
			revalidatedTags: [],
			maxMemoryCacheSize: 0,
		});
		const key = `${ROUTE_PREFIX}/929/1/686`;
		await handler.set(
			key,
			{
				kind: "APP_PAGE",
				html: "<html>perek</html>",
				rscData: Buffer.from("rsc"),
				segmentData: undefined,
				headers: {},
				status: 200,
				postponed: undefined,
			},
			{ kind: "APP_PAGE", isFallback: false, isRoutePPREnabled: false },
		);
		assert.equal(
			readFileSync(
				`${dist}/route-cache/APP_PAGE/deadbeef/$/929/1/686.html`,
				"utf8",
			),
			"<html>perek</html>",
		);
		const cached = await handler.get(key, { kind: "APP_PAGE" });
		assert.equal(cached.value.html, "<html>perek</html>");
	} finally {
		rmSync(dist, { recursive: true, force: true });
	}
});
