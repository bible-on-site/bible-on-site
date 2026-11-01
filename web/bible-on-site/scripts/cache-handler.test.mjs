import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import nodeFsModule from "next/dist/server/lib/node-fs-methods.js";
import routeCacheKeyModule from "next/dist/server/lib/route-cache-key.js";
import Handler, { filesystemSafeCacheKey } from "../cache-handler.mjs";

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

test("quoted slugs become legal filenames while Unicode stays unchanged", () => {
	assert.equal(
		filesystemSafeCacheKey(`${ROUTE_PREFIX}/929/1/רש"י`),
		`${ROUTE_PREFIX}/929/1/רש%22י`,
	);
	assert.equal(
		filesystemSafeCacheKey(`${ROUTE_PREFIX}/929/1/רמבן`),
		`${ROUTE_PREFIX}/929/1/רמבן`,
	);
	// Preserve legal Unicode and spaces; encode only filesystem-unsafe bytes.
	assert.equal(
		filesystemSafeCacheKey(`${ROUTE_PREFIX}/x/a b?c*d`),
		`${ROUTE_PREFIX}/x/a b%3Fc%2Ad`,
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
		const encoded = `${dist}/route-cache/APP_PAGE/deadbeef/$/929/1/רש%22י`;
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

test("filename-safe Unicode and spaces preserve existing seed paths", () => {
	assert.equal(
		filesystemSafeCacheKey(`${ROUTE_PREFIX}/parasha/בא`),
		`${ROUTE_PREFIX}/parasha/בא`,
	);
	assert.equal(
		filesystemSafeCacheKey("/pedia/name with spaces"),
		"/pedia/name with spaces",
	);
	assert.equal(filesystemSafeCacheKey("/x/CON.html"), "/x/%43%4F%4E.html");
	assert.equal(filesystemSafeCacheKey("/x/com1.meta"), "/x/%63%6F%6D%31.meta");
	assert.equal(
		filesystemSafeCacheKey("/x/folder./child "),
		"/x/folder%2E/child%20",
	);
	assert.notEqual(
		filesystemSafeCacheKey('/x/a"b'),
		filesystemSafeCacheKey("/x/a%22b"),
	);
});

test("raw Hebrew seeds retain logical identity and promote every artifact", async (t) => {
	const dist = mkdtempSync(join(tmpdir(), "route-cache-seed-"));
	try {
		const owner = { kind: "APP_PAGE", sourceRoute: "/parasha/[unit]/page" };
		const key = routeCacheKeyModule.getRouteCacheKey("/parasha/בא", owner);
		const legacy = join(dist, "app", "parasha", "בא");
		const segmentPath = "/parasha/$d$unit/__PAGE__";
		mkdirSync(dirname(legacy), { recursive: true });
		writeFileSync(`${legacy}.html`, "<html>unchanged seed</html>");
		writeFileSync(`${legacy}.rsc`, "seed-rsc");
		mkdirSync(dirname(`${legacy}.segments${segmentPath}`), { recursive: true });
		writeFileSync(
			`${legacy}.segments${segmentPath}.segment.rsc`,
			"seed-segment",
		);
		writeFileSync(
			`${legacy}.meta`,
			JSON.stringify({
				headers: { "x-next-cache-tags": "private-cache-seed-test" },
				segmentPaths: [segmentPath],
				routeCache: { key, owner, isFallback: false },
				routeCacheLastModified: 1,
			}),
		);
		const handler = new Handler({
			dev: false,
			fs: nodeFs,
			flushToDisk: true,
			serverDistDir: dist,
			revalidatedTags: [],
			maxMemoryCacheSize: 0,
		});
		const ctx = {
			kind: "APP_PAGE",
			isFallback: false,
			isRoutePPREnabled: false,
		};
		const seed = await handler.get(key, ctx);
		assert.equal(seed.value.html, "<html>unchanged seed</html>");
		assert.equal(seed.value.rscData.toString(), "seed-rsc");
		assert.equal(
			seed.value.segmentData.get(segmentPath).toString(),
			"seed-segment",
		);
		const scoped = join(dist, key);
		assert.equal(
			readFileSync(`${scoped}.html`, "utf8"),
			"<html>unchanged seed</html>",
		);
		assert.equal(readFileSync(`${scoped}.rsc`, "utf8"), "seed-rsc");
		assert.equal(
			readFileSync(`${scoped}.segments${segmentPath}.segment.rsc`, "utf8"),
			"seed-segment",
		);
		const promoted = JSON.parse(readFileSync(`${scoped}.meta`, "utf8"));
		assert.equal(promoted.routeCache.key, key);
		assert.deepEqual(promoted.routeCache.owner, owner);
		assert.equal(promoted.routeCacheLastModified, 1);
		assert.equal(
			(await handler.get(key, ctx)).value.html,
			"<html>unchanged seed</html>",
		);
		// Next writes expiration with Date.now but checks it against the
		// performance epoch. Align the clocks so wall-clock skew cannot make
		// immediate expiration appear to be scheduled in the future.
		t.mock.method(Date, "now", () =>
			Math.floor(performance.timeOrigin + performance.now()),
		);
		await handler.revalidateTag("private-cache-seed-test");
		assert.equal(await handler.get(key, ctx), null);
	} finally {
		rmSync(dist, { recursive: true, force: true });
	}
});

test("reserved basenames and suffixes persist through the real filesystem", async () => {
	const dist = mkdtempSync(join(tmpdir(), "route-cache-reserved-"));
	try {
		const handler = new Handler({
			dev: false,
			fs: nodeFs,
			flushToDisk: true,
			serverDistDir: dist,
			revalidatedTags: [],
			maxMemoryCacheSize: 0,
		});
		for (const slug of [
			"CON",
			"CON.txt",
			"com1.meta",
			"folder./entry",
			"name ",
			"control\u0001name",
			"control\u001Fname",
		]) {
			const key = `${ROUTE_PREFIX}/x/${slug}`;
			const ctx = {
				kind: "APP_PAGE",
				isFallback: false,
				isRoutePPREnabled: false,
			};
			await handler.set(
				key,
				{
					kind: "APP_PAGE",
					html: "<html>legal</html>",
					rscData: Buffer.from("rsc"),
					headers: {},
					status: 200,
					postponed: undefined,
				},
				ctx,
			);
			assert.equal(
				(await handler.get(key, ctx)).value.html,
				"<html>legal</html>",
			);
		}
	} finally {
		rmSync(dist, { recursive: true, force: true });
	}
});

test("existing percent-encoded seeds retain the default read and promotion", async () => {
	const dist = mkdtempSync(join(tmpdir(), "route-cache-encoded-seed-"));
	try {
		const owner = {
			kind: "APP_PAGE",
			sourceRoute: "/929/[number]/[slug]/page",
		};
		const slug = encodeURIComponent('רש"י');
		const key = routeCacheKeyModule.getRouteCacheKey(`/929/1/${slug}`, owner);
		const legacy = join(dist, "app", "929", "1", slug);
		mkdirSync(dirname(legacy), { recursive: true });
		writeFileSync(`${legacy}.html`, "<html>encoded seed</html>");
		writeFileSync(`${legacy}.rsc`, "encoded-rsc");
		writeFileSync(
			`${legacy}.meta`,
			JSON.stringify({
				headers: {},
				routeCache: { key, owner, isFallback: false },
			}),
		);
		const options = {
			dev: false,
			fs: nodeFs,
			flushToDisk: true,
			serverDistDir: dist,
			revalidatedTags: [],
			maxMemoryCacheSize: 0,
		};
		const ctx = {
			kind: "APP_PAGE",
			isFallback: false,
			isRoutePPREnabled: false,
		};
		const DefaultCache = Object.getPrototypeOf(Handler);
		const original = await new DefaultCache({
			...options,
			flushToDisk: false,
		}).get(key, ctx);
		assert.equal(original.value.html, "<html>encoded seed</html>");
		const handler = new Handler(options);
		const cached = await handler.get(key, ctx);
		assert.equal(cached.value.html, original.value.html);
		assert.equal(cached.value.rscData.toString(), "encoded-rsc");
		assert.equal((await handler.get(key, ctx)).value.html, original.value.html);
		const promoted = JSON.parse(
			readFileSync(handler.getFilePath(`${key}.meta`, "APP_PAGE"), "utf8"),
		);
		assert.equal(promoted.routeCache.key, key);
	} finally {
		rmSync(dist, { recursive: true, force: true });
	}
});

test("scoped quote and literal-percent keys remain distinct on disk", async () => {
	const dist = mkdtempSync(join(tmpdir(), "route-cache-distinct-"));
	try {
		const handler = new Handler({
			dev: false,
			fs: nodeFs,
			flushToDisk: true,
			serverDistDir: dist,
			revalidatedTags: [],
			maxMemoryCacheSize: 0,
		});
		const ctx = {
			kind: "APP_PAGE",
			isFallback: false,
			isRoutePPREnabled: false,
		};
		const quote = `${ROUTE_PREFIX}/x/a"b`;
		const percent = `${ROUTE_PREFIX}/x/a%22b`;
		for (const [key, html] of [
			[quote, "quote"],
			[percent, "percent"],
		]) {
			await handler.set(
				key,
				{
					kind: "APP_PAGE",
					html,
					rscData: Buffer.from(html),
					headers: {},
					status: 200,
					postponed: undefined,
				},
				ctx,
			);
		}
		assert.equal((await handler.get(quote, ctx)).value.html, "quote");
		assert.equal((await handler.get(percent, ctx)).value.html, "percent");
		assert.notEqual(
			handler.getFilePath(`${quote}.html`, "APP_PAGE"),
			handler.getFilePath(`${percent}.html`, "APP_PAGE"),
		);
	} finally {
		rmSync(dist, { recursive: true, force: true });
	}
});
