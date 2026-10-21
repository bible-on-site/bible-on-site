import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same createServerFn passthrough as the sibling server tests: the wrapped
// status function is invoked directly instead of over RPC.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

import {
	articleInvalidation,
	articlePath,
	authorInvalidation,
	authorPath,
	getWebsiteRevalidationStatus,
	lastRevalidationFailure,
	pediaEntryPath,
	pediaInvalidation,
	revalidateWebsite,
} from "~/server/website-revalidate";

const ENV_KEYS = ["VITE_WEBSITE_URL", "REVALIDATE_SECRET"] as const;

describe("revalidateWebsite", () => {
	let savedEnv: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		process.env.VITE_WEBSITE_URL = "https://site.test/";
		process.env.REVALIDATE_SECRET = "s3cr3t";
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));
		// Clear the recorded failure so tests start from a clean slate.
		await revalidateWebsite([]);
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

	it("POSTs the tag with the secret in a header, never the URL", async () => {
		await expect(revalidateWebsite([{ tag: "articles" }])).resolves.toBe(true);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [input, init] = fetchSpy.mock.calls[0];
		const url = new URL(String(input));
		expect(url.origin).toBe("https://site.test");
		expect(url.pathname).toBe("/api/revalidate");
		expect(url.searchParams.get("tag")).toBe("articles");
		// The secret must not ride the URL on the cluster's plaintext hop —
		// URLs end up in access logs, headers do not.
		expect(url.search).not.toContain("secret");
		expect(new Headers(init?.headers).get("x-revalidate-secret")).toBe(
			"s3cr3t",
		);
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
		delete process.env.REVALIDATE_SECRET;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(revalidateWebsite([{ tag: "articles" }])).resolves.toBe(
			false,
		);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
		// Unconfigured is the documented no-op, not a surfaced failure.
		expect(lastRevalidationFailure()).toBeNull();
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

	it("forwards each changed public url as a repeated url parameter", async () => {
		await revalidateWebsite([
			{ tag: "articles", urls: ["/929/5/12", "/929/7/3"] },
		]);

		const url = calledUrls()[0];
		expect(url.searchParams.getAll("url")).toEqual([
			"/929/5/12",
			"/929/7/3",
		]);
	});

	it("sends no url parameter when the change reports none", async () => {
		await revalidateWebsite([{ tag: "articles" }]);

		expect(calledUrls()[0].searchParams.getAll("url")).toEqual([]);
	});

	it("article saves expire the shared articles tag", async () => {
		await revalidateWebsite(articleInvalidation());

		expect(calledUrls().map((u) => u.searchParams.get("tag"))).toEqual([
			"articles",
		]);
	});

	it("article saves carry the changed article urls", async () => {
		await revalidateWebsite(articleInvalidation("/929/5/12", "/929/7/12"));

		const url = calledUrls()[0];
		expect(url.searchParams.get("tag")).toBe("articles");
		expect(url.searchParams.getAll("url")).toEqual([
			"/929/5/12",
			"/929/7/12",
		]);
	});

	it("author saves expire authors and articles (names render inside articles)", async () => {
		await revalidateWebsite(authorInvalidation("/929/authors/x"));

		const urls = calledUrls();
		expect(urls.map((u) => u.searchParams.get("tag"))).toEqual([
			"authors",
			"articles",
		]);
		expect(urls[1].searchParams.getAll("url")).toEqual(["/929/authors/x"]);
	});

	it("pedia saves expire entity refs, every entry route, and the index", async () => {
		await revalidateWebsite(pediaInvalidation("/pedia/משה"));

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
		// The changed entry urls ride the /pedia index invalidation call.
		expect(urls[2].searchParams.getAll("url")).toEqual(["/pedia/משה"]);
	});

	describe("failure surfacing", () => {
		it("records the unapplied subset so the editor can see stale content", async () => {
			fetchSpy
				.mockResolvedValueOnce(new Response("{}", { status: 200 }))
				.mockResolvedValueOnce(new Response("no", { status: 500 }));
			vi.spyOn(console, "error").mockImplementation(() => {});

			await revalidateWebsite([{ tag: "authors" }, { path: "/929/3" }]);

			const failure = lastRevalidationFailure();
			expect(failure?.requests).toEqual([{ path: "/929/3" }]);
			expect(Number.isNaN(Date.parse(failure?.failedAt ?? ""))).toBe(false);
		});

		it("clears the recorded failure once a batch fully applies", async () => {
			fetchSpy.mockResolvedValueOnce(new Response("no", { status: 500 }));
			vi.spyOn(console, "error").mockImplementation(() => {});
			await revalidateWebsite([{ tag: "articles" }]);
			expect(lastRevalidationFailure()).not.toBeNull();

			await revalidateWebsite([{ tag: "articles" }]);
			expect(lastRevalidationFailure()).toBeNull();
		});

		it("exposes the failure through the status server function", async () => {
			fetchSpy.mockResolvedValue(new Response("no", { status: 500 }));
			vi.spyOn(console, "error").mockImplementation(() => {});
			await revalidateWebsite([{ tag: "articles" }]);

			const status = await getWebsiteRevalidationStatus();
			expect(status.lastFailure?.requests).toEqual([{ tag: "articles" }]);
		});
	});
});

describe("public path helpers", () => {
	it("builds the article page path", () => {
		expect(articlePath(5, 12)).toBe("/929/5/12");
	});

	it("percent-encodes author names and strips quote characters", () => {
		expect(authorPath(`רש"י`)).toBe(`/929/authors/${encodeURIComponent("רשי")}`);
		expect(authorPath("  דוד  ")).toBe(
			`/929/authors/${encodeURIComponent("דוד")}`,
		);
	});

	it("builds the pedia entry path", () => {
		expect(pediaEntryPath("משה")).toBe("/pedia/משה");
	});
});
