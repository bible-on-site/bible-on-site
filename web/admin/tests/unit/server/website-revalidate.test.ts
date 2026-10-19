import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ARTICLE_INVALIDATION,
	AUTHOR_INVALIDATION,
	PEDIA_INVALIDATION,
	revalidateWebsite,
} from "~/server/website-revalidate";

const ENV_KEYS = ["VITE_WEBSITE_URL", "VITE_REVALIDATION_SECRET"] as const;

describe("revalidateWebsite", () => {
	let savedEnv: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		process.env.VITE_WEBSITE_URL = "https://site.test/";
		process.env.VITE_REVALIDATION_SECRET = "s3cr3t";
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
		fetchSpy.mockRestore();
	});

	function calledUrls(): URL[] {
		return fetchSpy.mock.calls.map((call: unknown[]) => new URL(String(call[0])));
	}

	it("POSTs the tag with the configured secret", async () => {
		await expect(revalidateWebsite([{ tag: "articles" }])).resolves.toBe(true);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [input, init] = fetchSpy.mock.calls[0];
		const url = new URL(String(input));
		expect(url.origin).toBe("https://site.test");
		expect(url.pathname).toBe("/api/revalidate");
		expect(url.searchParams.get("tag")).toBe("articles");
		expect(url.searchParams.get("secret")).toBe("s3cr3t");
		expect(init?.method).toBe("POST");
	});

	it("forwards path and type for dynamic route patterns", async () => {
		await revalidateWebsite([{ path: "/pedia/[slug]", type: "page" }]);

		const url = calledUrls()[0];
		expect(url.searchParams.get("path")).toBe("/pedia/[slug]");
		expect(url.searchParams.get("type")).toBe("page");
	});

	it("skips the call when the website is not configured", async () => {
		delete process.env.VITE_WEBSITE_URL;
		delete process.env.VITE_REVALIDATION_SECRET;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(revalidateWebsite([{ tag: "articles" }])).resolves.toBe(
			false,
		);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("reports failure without throwing when the site rejects", async () => {
		fetchSpy.mockResolvedValue(new Response("no", { status: 401 }));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(revalidateWebsite([{ tag: "articles" }])).resolves.toBe(
			false,
		);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("reports failure without throwing when the request errors", async () => {
		fetchSpy.mockRejectedValue(new Error("connect refused"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(revalidateWebsite([{ tag: "articles" }])).resolves.toBe(
			false,
		);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("fires all requests and fails when any of them fail", async () => {
		fetchSpy
			.mockResolvedValueOnce(new Response("{}", { status: 200 }))
			.mockResolvedValueOnce(new Response("no", { status: 500 }));
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			revalidateWebsite([{ tag: "authors" }, { path: "/929/3" }]),
		).resolves.toBe(false);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("article saves expire the shared articles tag", async () => {
		await revalidateWebsite(ARTICLE_INVALIDATION);

		expect(calledUrls().map((u) => u.searchParams.get("tag"))).toEqual([
			"articles",
		]);
	});

	it("author saves expire authors and articles (names render inside articles)", async () => {
		await revalidateWebsite(AUTHOR_INVALIDATION);

		expect(calledUrls().map((u) => u.searchParams.get("tag"))).toEqual([
			"authors",
			"articles",
		]);
	});

	it("pedia saves expire entity refs, every entry route, and the index", async () => {
		await revalidateWebsite(PEDIA_INVALIDATION);

		const urls = calledUrls();
		expect(urls.map((u) => u.searchParams.get("tag"))).toContain(
			"tanahpedia-entity-refs",
		);
		const paths = urls.map(
			(u) =>
				`${u.searchParams.get("path")}:${u.searchParams.get("type") ?? ""}`,
		);
		expect(paths).toContain("/pedia/[slug]:page");
		expect(paths).toContain("/pedia:");
	});
});
