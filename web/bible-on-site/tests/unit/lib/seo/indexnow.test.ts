/**
 * @jest-environment node
 *
 * IndexNow notifies participating search engines that public URLs changed.
 * The feature is a documented no-op unless `INDEXNOW_KEY` is configured; a
 * delivery failure must never break revalidation or requests, so submission
 * errors are logged and the undelivered URLs stay pending for the next
 * publication event to retry.
 */
import {
	collectSubmissionPaths,
	indexNowKey,
	indexNowKeyFileName,
	pendingIndexNowUrls,
	submitIndexNow,
} from "@/lib/seo/indexnow";

// Must satisfy the protocol format (8-128 [a-zA-Z0-9-]) while staying a
// readable, low-entropy placeholder that secret scanners ignore.
const TEST_KEY = "indexnow-test-key-0001";

function lastRequest(): {
	url: string;
	init?: RequestInit;
} {
	const call = (fetch as jest.Mock).mock.calls.at(-1);
	if (!call) throw new Error("fetch was not called");
	return { url: String(call[0]), init: call[1] as RequestInit | undefined };
}

function lastBody(): {
	host: string;
	key: string;
	keyLocation: string;
	urlList: string[];
} {
	const { init } = lastRequest();
	return JSON.parse(String(init?.body));
}

describe("indexNowKey", () => {
	afterEach(() => {
		delete process.env.INDEXNOW_KEY;
	});

	it("is null when INDEXNOW_KEY is unset", () => {
		delete process.env.INDEXNOW_KEY;
		expect(indexNowKey()).toBeNull();
		expect(indexNowKeyFileName()).toBeNull();
	});

	it.each(["", "   ", "short", "key with space", "key/slash"])(
		"is null for unusable key %j",
		(key) => {
			process.env.INDEXNOW_KEY = key;
			const warnSpy = jest
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			expect(indexNowKey()).toBeNull();
			expect(indexNowKeyFileName()).toBeNull();
			warnSpy.mockRestore();
		},
	);

	it("returns the configured key and its file name", () => {
		process.env.INDEXNOW_KEY = TEST_KEY;
		expect(indexNowKey()).toBe(TEST_KEY);
		expect(indexNowKeyFileName()).toBe(`${TEST_KEY}.txt`);
	});
});

describe("collectSubmissionPaths", () => {
	it("keeps literal content paths and dedupes them", () => {
		expect(
			collectSubmissionPaths(["/929/5", "/929/5", "/pedia"]),
		).toEqual(["/929/5", "/pedia", "/sitemap.xml"]);
	});

	it("adds the chapter page for an article path", () => {
		expect(collectSubmissionPaths(["/929/5/12"])).toEqual([
			"/929/5/12",
			"/929/5",
			"/sitemap.xml",
		]);
	});

	it("adds the authors index for an author path", () => {
		expect(collectSubmissionPaths(["/929/authors/רש\"י"])).toEqual([
			"/929/authors/רש\"י",
			"/929/authors",
			"/sitemap.xml",
		]);
	});

	it("adds the pedia index for an entry path", () => {
		expect(collectSubmissionPaths(["/pedia/משה"])).toEqual([
			"/pedia/משה",
			"/pedia",
			"/sitemap.xml",
		]);
	});

	it("strips query parameters and fragments for clean URLs", () => {
		expect(collectSubmissionPaths(["/929/5?utm=x&fb=1", "/929/5#y"])).toEqual([
			"/929/5",
			"/sitemap.xml",
		]);
	});

	it("drops non-site paths, dynamic patterns and bare indexes", () => {
		expect(
			collectSubmissionPaths([
				"https://evil.test/929/5",
				"//evil.test/x",
				"/pedia/[slug]",
				"",
				"relative",
				"/sitemap.xml",
			]),
		).toEqual(["/sitemap.xml"]);
	});

	it("returns an empty list when nothing submittable was given", () => {
		expect(collectSubmissionPaths([])).toEqual([]);
		expect(collectSubmissionPaths(["/pedia/[slug]"])).toEqual([]);
	});
});

describe("submitIndexNow", () => {
	let fetchSpy: jest.SpyInstance;

	beforeEach(async () => {
		fetchSpy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("ok", { status: 200 }));
		// Flush URLs left pending by a previous test's failed submission.
		process.env.INDEXNOW_KEY = TEST_KEY;
		await submitIndexNow([]);
		fetchSpy.mockClear();
	});

	afterEach(() => {
		delete process.env.INDEXNOW_KEY;
		fetchSpy.mockRestore();
	});

	it("is a no-op without a configured key", async () => {
		delete process.env.INDEXNOW_KEY;
		await expect(submitIndexNow(["/929/5"])).resolves.toBe("skipped");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("is a no-op without URLs to submit", async () => {
		await expect(submitIndexNow([])).resolves.toBe("skipped");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("POSTs clean canonical URLs with the key location", async () => {
		await expect(submitIndexNow(["/929/5", "/929/5"])).resolves.toBe(
			"submitted",
		);
		const { url, init } = lastRequest();
		expect(url).toBe("https://api.indexnow.org/indexnow");
		expect(init?.method).toBe("POST");
		expect(new Headers(init?.headers).get("content-type")).toContain(
			"application/json",
		);
		const body = lastBody();
		expect(body.host).toBe("xn--febl3a.co.il");
		expect(body.key).toBe(TEST_KEY);
		expect(body.keyLocation).toBe(
			`https://xn--febl3a.co.il/${TEST_KEY}.txt`,
		);
		expect(body.urlList).toEqual([
			"https://xn--febl3a.co.il/929/5",
			"https://xn--febl3a.co.il/sitemap.xml",
		]);
	});

	it("percent-encodes Hebrew paths into the submitted URLs", async () => {
		await submitIndexNow(["/pedia/משה"]);
		expect(lastBody().urlList).toEqual([
			`https://xn--febl3a.co.il/pedia/${encodeURIComponent("משה")}`,
			"https://xn--febl3a.co.il/pedia",
			"https://xn--febl3a.co.il/sitemap.xml",
		]);
	});

	it("never throws on a network failure and keeps URLs pending", async () => {
		fetchSpy.mockRejectedValue(new Error("offline"));
		const errorSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await expect(submitIndexNow(["/929/5"])).resolves.toBe("failed");
		expect(errorSpy).toHaveBeenCalled();
		expect(pendingIndexNowUrls()).toEqual([
			"https://xn--febl3a.co.il/929/5",
			"https://xn--febl3a.co.il/sitemap.xml",
		]);
		errorSpy.mockRestore();
	});

	it("keeps URLs pending on a non-2xx response", async () => {
		fetchSpy.mockResolvedValue(new Response("nope", { status: 500 }));
		const errorSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await expect(submitIndexNow(["/pedia/א"])).resolves.toBe("failed");
		expect(pendingIndexNowUrls()).toEqual([
			`https://xn--febl3a.co.il/pedia/${encodeURIComponent("א")}`,
			"https://xn--febl3a.co.il/pedia",
			"https://xn--febl3a.co.il/sitemap.xml",
		]);
		errorSpy.mockRestore();
	});

	it("retries pending URLs merged into the next submission", async () => {
		fetchSpy.mockRejectedValueOnce(new Error("offline"));
		jest.spyOn(console, "error").mockImplementation(() => {});
		await submitIndexNow(["/929/1"]);
		await submitIndexNow(["/929/2"]);

		expect(lastBody().urlList).toEqual([
			"https://xn--febl3a.co.il/929/1",
			"https://xn--febl3a.co.il/sitemap.xml",
			"https://xn--febl3a.co.il/929/2",
		]);
		expect(pendingIndexNowUrls()).toEqual([]);
	});

	it("retries pending URLs even when the next call adds none", async () => {
		fetchSpy.mockRejectedValueOnce(new Error("offline"));
		jest.spyOn(console, "error").mockImplementation(() => {});
		await submitIndexNow(["/929/1"]);
		fetchSpy.mockClear();

		await expect(submitIndexNow([])).resolves.toBe("submitted");
		expect(lastBody().urlList).toEqual([
			"https://xn--febl3a.co.il/929/1",
			"https://xn--febl3a.co.il/sitemap.xml",
		]);
	});

	it("chunks submissions at the protocol batch limit", async () => {
		const paths = Array.from(
			{ length: 10_001 },
			(_, i) => `/pedia/e${i}`,
		);
		await expect(submitIndexNow(paths)).resolves.toBe("submitted");
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(lastBody().urlList).toHaveLength(3);
	});
});
