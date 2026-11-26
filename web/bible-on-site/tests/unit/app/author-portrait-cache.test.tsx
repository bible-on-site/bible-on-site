/** @jest-environment node */

import { renderToStaticMarkup } from "react-dom/server";

type CacheLoader = (...args: unknown[]) => Promise<unknown>;
const mockPersistedCache = new Map<string, unknown>();
const mockReadSnapshot = jest.fn<string, []>();
const mockQuery = jest.fn();
const snapshotKey = Symbol.for("bible-on-site.author-portrait-snapshot");

jest.mock("next/cache", () => ({
	// Keep cached data when page modules reload as a new build. Like
	// unstable_cache, identify an invocation by its callback, key parts and args.
	unstable_cache:
		(load: CacheLoader, keyParts: string[]) =>
		async (...args: unknown[]) => {
			const key = `${load.toString()}-${keyParts.join(",")}-${JSON.stringify(args)}`;
			if (!mockPersistedCache.has(key)) {
				mockPersistedCache.set(key, await load(...args));
			}
			return mockPersistedCache.get(key);
		},
}));

jest.mock("node:fs", () => ({
	...jest.requireActual("node:fs"),
	readFileSync: () => mockReadSnapshot(),
}));

jest.mock("@/lib/api-client", () => ({ query: mockQuery }));

jest.mock("@/data/perek-dto", () => ({ getPerekByPerekId: jest.fn() }));

jest.mock("next/image", () => ({
	__esModule: true,
	default: ({ src }: { src: string }) => <span data-portrait-url={src} />,
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => children,
}));

const author = { id: 39, name: "הרב לדוגמא", details: "" };
const assetBase = "https://assets.example";
const originalEnv = process.env;

beforeEach(() => {
	process.env = { ...originalEnv, ASSETS_BASE_URL: assetBase };
	jest.replaceProperty(process.env, "NODE_ENV", "production");
	delete process.env.S3_ENDPOINT;
	delete process.env.S3_BUCKET;
	mockPersistedCache.clear();
	mockQuery.mockResolvedValue([author]);
});

afterEach(() => {
	jest.restoreAllMocks();
	process.env = originalEnv;
	Reflect.deleteProperty(globalThis, snapshotKey);
});

async function renderBuild(snapshot: string) {
	jest.resetModules();
	Reflect.deleteProperty(globalThis, snapshotKey);
	mockReadSnapshot.mockReturnValue(snapshot);

	const { default: AuthorsPage } = await import("@/app/929/authors/page");
	const { generateMetadata } = await import(
		"@/app/929/authors/[authorParam]/page"
	);

	const listing = renderToStaticMarkup(await AuthorsPage());
	const metadata = await generateMetadata({
		params: Promise.resolve({ authorParam: encodeURIComponent(author.name) }),
	});
	return { listing, images: metadata.openGraph?.images };
}

function expectPortrait(
	result: Awaited<ReturnType<typeof renderBuild>>,
	key: string,
) {
	const url = `${assetBase}/${key}`;
	expect(result.listing).toContain(`data-portrait-url="${url}"`);
	expect(result.images).toEqual([
		expect.objectContaining({ url, alt: author.name }),
	]);
}

it("updates portraits after a rebuild that retains the cached directory and profile", async () => {
	const png = "authors/caricatures/v1/high-res/39.png";
	const jpeg = "authors/high-res/39.jpg?v=0123456789abcdef0123456789abcdef";
	// Non-32-bit IDs ensure JSON property order here actually follows the
	// object insertion order instead of JavaScript's integer-key ordering.
	const otherPortraits = [
		["6000000000", "authors/caricatures/v1/high-res/6000000000.png"],
		["5000000000", "authors/caricatures/v1/high-res/5000000000.png"],
	];
	const snapshot = (portraitKey: string, others: string[][]) =>
		JSON.stringify(Object.fromEntries([["39", portraitKey], ...others]));

	expectPortrait(await renderBuild(snapshot(png, otherPortraits)), png);
	expect(mockQuery).toHaveBeenCalledTimes(2);

	expectPortrait(
		await renderBuild(snapshot(png, [...otherPortraits].reverse())),
		png,
	);
	expect(mockQuery).toHaveBeenCalledTimes(2);

	expectPortrait(await renderBuild(snapshot(jpeg, otherPortraits)), jpeg);
	expect(mockQuery).toHaveBeenCalledTimes(4);
	expect(mockReadSnapshot).toHaveBeenCalledTimes(3);
});
