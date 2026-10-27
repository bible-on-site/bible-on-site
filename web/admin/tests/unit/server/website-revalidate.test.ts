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
	articleChange,
	articlePath,
	authorChange,
	authorPath,
	getWebsiteRevalidationStatus,
	lastRevalidationFailure,
	mergeCoveringSpans,
	pediaEntryChange,
	pediaEntryPath,
	revalidateWebsite,
} from "~/server/website-revalidate";

const ENV_KEYS = ["VITE_WEBSITE_URL", "REVALIDATE_SECRET"] as const;
/** One tick past the 300ms debounce window. */
const FLUSH_MS = 301;

describe("revalidateWebsite", () => {
	let savedEnv: Record<string, string | undefined>;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		vi.useFakeTimers();
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		process.env.VITE_WEBSITE_URL = "https://site.test/";
		process.env.REVALIDATE_SECRET = "s3cr3t";
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));
		// Failed deliveries ride the next flush — drain any leftovers (and
		// clear the recorded failure), then reset the spy so each test sees
		// only its own calls.
		await flush(revalidateWebsite([]));
		fetchSpy.mockClear();
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
		fetchSpy.mockRestore();
		vi.useRealTimers();
	});

	/** Advance past the debounce window, then await the caller's promise. */
	async function flush(pending: Promise<boolean>): Promise<boolean> {
		await vi.advanceTimersByTimeAsync(FLUSH_MS);
		return pending;
	}

	function calledUrls(): URL[] {
		return fetchSpy.mock.calls.map(
			(call: unknown[]) => new URL(String(call[0])),
		);
	}

	it("POSTs the tag with the secret in a header, never the URL", async () => {
		await expect(
			flush(revalidateWebsite([{ tag: "articles" }])),
		).resolves.toBe(true);

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
		await flush(revalidateWebsite([{ path: "/pedia/[slug]", type: "page" }]));

		const url = calledUrls()[0];
		expect(url.searchParams.get("path")).toBe("/pedia/[slug]");
		expect(url.searchParams.get("type")).toBe("page");
	});

	it("sends typed changes as a JSON body, not query params", async () => {
		await flush(
			revalidateWebsite([
				{
					changes: [
						{ kind: "article", id: 12, perekIds: [5, 7] },
						{ kind: "author", id: 3, name: "רשי" },
					],
				},
			]),
		);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [input, init] = fetchSpy.mock.calls[0];
		const url = new URL(String(input));
		expect(url.searchParams.get("tag")).toBeNull();
		expect(new Headers(init?.headers).get("content-type")).toBe(
			"application/json",
		);
		expect(JSON.parse(String(init?.body))).toEqual({
			changes: [
				{ kind: "article", id: 12, perekIds: [5, 7] },
				{ kind: "author", id: 3, name: "רשי" },
			],
		});
	});

	it("debounces a burst of saves into one merged changes request", async () => {
		const first = revalidateWebsite([
			{ changes: [{ kind: "article", id: 1, perekIds: [1] }] },
		]);
		const second = revalidateWebsite([
			{ changes: [{ kind: "article", id: 2, perekIds: [2] }] },
		]);
		await vi.advanceTimersByTimeAsync(FLUSH_MS);
		await Promise.all([first, second]);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		expect(body.changes).toEqual([
			{ kind: "article", id: 1, perekIds: [1] },
			{ kind: "article", id: 2, perekIds: [2] },
		]);
	});

	it("chunks oversized change batches to the website contract limit", async () => {
		const changes = Array.from({ length: 70 }, (_, i) => ({
			kind: "article" as const,
			id: i,
			perekIds: [i],
		}));
		await flush(revalidateWebsite([{ changes }]));

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const first = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		const second = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body));
		expect(first.changes).toHaveLength(64);
		expect(second.changes).toHaveLength(6);
	});

	it("skips the call when the website is not configured", async () => {
		delete process.env.VITE_WEBSITE_URL;
		delete process.env.REVALIDATE_SECRET;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			flush(revalidateWebsite([{ tag: "articles" }])),
		).resolves.toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
		// Unconfigured is the documented no-op, not a surfaced failure.
		expect(lastRevalidationFailure()).toBeNull();
		warnSpy.mockRestore();
	});

	it("reports failure without throwing when the site rejects", async () => {
		fetchSpy.mockResolvedValue(new Response("no", { status: 401 }));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			flush(revalidateWebsite([{ tag: "articles" }])),
		).resolves.toBe(false);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("reports failure without throwing when the request errors", async () => {
		fetchSpy.mockRejectedValue(new Error("connect refused"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			flush(revalidateWebsite([{ tag: "articles" }])),
		).resolves.toBe(false);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("fires all requests and fails when any of them fail", async () => {
		fetchSpy
			.mockResolvedValueOnce(new Response("{}", { status: 200 }))
			.mockResolvedValueOnce(new Response("no", { status: 500 }));
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			flush(
				revalidateWebsite([{ tag: "authors" }, { path: "/929/3" }]),
			),
		).resolves.toBe(false);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("forwards each changed public url as a repeated url parameter", async () => {
		await flush(
			revalidateWebsite([
				{ tag: "articles", urls: ["/929/5/12", "/929/7/3"] },
			]),
		);

		const url = calledUrls()[0];
		expect(url.searchParams.getAll("url")).toEqual([
			"/929/5/12",
			"/929/7/3",
		]);
	});

	it("sends no url parameter when the change reports none", async () => {
		await flush(revalidateWebsite([{ tag: "articles" }]));

		expect(calledUrls()[0].searchParams.getAll("url")).toEqual([]);
	});

	describe("failure surfacing", () => {
		it("records the unapplied subset so the editor can see stale content", async () => {
			fetchSpy
				.mockResolvedValueOnce(new Response("{}", { status: 200 }))
				.mockResolvedValueOnce(new Response("no", { status: 500 }));
			vi.spyOn(console, "error").mockImplementation(() => {});

			await flush(
				revalidateWebsite([{ tag: "authors" }, { path: "/929/3" }]),
			);

			const failure = lastRevalidationFailure();
			expect(failure?.requests).toEqual([{ path: "/929/3" }]);
			expect(Number.isNaN(Date.parse(failure?.failedAt ?? ""))).toBe(
				false,
			);
		});

		it("retries undelivered requests on the next flush", async () => {
			fetchSpy.mockResolvedValueOnce(new Response("no", { status: 500 }));
			vi.spyOn(console, "error").mockImplementation(() => {});
			await flush(revalidateWebsite([{ tag: "articles" }]));
			expect(lastRevalidationFailure()).not.toBeNull();

			await flush(revalidateWebsite([{ tag: "authors" }]));

			// The retried articles post precedes the new authors post.
			expect(fetchSpy).toHaveBeenCalledTimes(3);
			expect(
				calledUrls()[1].searchParams.get("tag"),
			).toBe("articles");
			expect(
				calledUrls()[2].searchParams.get("tag"),
			).toBe("authors");
			expect(lastRevalidationFailure()).toBeNull();
		});

		it("merges retried changes with the next flush's changes", async () => {
			fetchSpy.mockResolvedValueOnce(new Response("no", { status: 500 }));
			vi.spyOn(console, "error").mockImplementation(() => {});
			await flush(
				revalidateWebsite([
					{ changes: [{ kind: "author", id: 1, name: "a" }] },
				]),
			);

			await flush(
				revalidateWebsite([
					{ changes: [{ kind: "author", id: 2, name: "b" }] },
				]),
			);

			expect(fetchSpy).toHaveBeenCalledTimes(2);
			const body = JSON.parse(
				String(fetchSpy.mock.calls[1]?.[1]?.body),
			);
			expect(body.changes).toEqual([
				{ kind: "author", id: 1, name: "a" },
				{ kind: "author", id: 2, name: "b" },
			]);
		});

		it("exposes the failure through the status server function", async () => {
			fetchSpy.mockResolvedValue(new Response("no", { status: 500 }));
			vi.spyOn(console, "error").mockImplementation(() => {});
			await flush(revalidateWebsite([{ tag: "articles" }]));

			const status = await getWebsiteRevalidationStatus();
			expect(status.lastFailure?.requests).toEqual([
				{ tag: "articles" },
			]);
		});
	});
});

describe("typed-change builders", () => {
	it("articleChange carries the old ∪ new perek/author/coverage sets", () => {
		expect(
			articleChange({
				id: 12,
				perekIds: [5, 7],
				authorIds: [3, 4],
				coveringSpans: [{ perekId: 9, pasukFrom: 2, pasukTo: 4 }],
			}),
		).toEqual({
			changes: [
				{
					kind: "article",
					id: 12,
					perekIds: [5, 7],
					authorIds: [3, 4],
					coveringSpans: [{ perekId: 9, pasukFrom: 2, pasukTo: 4 }],
				},
			],
		});
	});

	it("authorChange carries the pre-rename name for the old slug", () => {
		expect(authorChange({ id: 3, name: "רשי", oldName: "רבנו שלמה" })).toEqual(
			{
				changes: [
					{
						kind: "author",
						id: 3,
						name: "רשי",
						oldName: "רבנו שלמה",
					},
				],
			},
		);
		expect(authorChange({ id: 3, name: "רשי" })).toEqual({
			changes: [{ kind: "author", id: 3, name: "רשי" }],
		});
	});

	it("pediaEntryChange carries the old name and relations a delete loses", () => {
		expect(
			pediaEntryChange({
				uniqueName: "משה",
				oldUniqueName: "משה רבנו",
				entityTypes: ["PERSON"],
				synonymNames: ["משה בן עמרם"],
				refPerekIds: [12],
			}),
		).toEqual({
			changes: [
				{
					kind: "pedia-entry",
					uniqueName: "משה",
					oldUniqueName: "משה רבנו",
					entityTypes: ["PERSON"],
					synonymNames: ["משה בן עמרם"],
					refPerekIds: [12],
				},
			],
		});
	});

	it("mergeCoveringSpans merges contiguous verses within each perek", () => {
		expect(
			mergeCoveringSpans([
				{ perek_id: 5, pasuk: 3 },
				{ perek_id: 5, pasuk: 1 },
				{ perek_id: 5, pasuk: 2 },
				{ perek_id: 5, pasuk: 5 },
				{ perek_id: 7, pasuk: 1 },
			]),
		).toEqual([
			{ perekId: 5, pasukFrom: 1, pasukTo: 3 },
			{ perekId: 5, pasukFrom: 5, pasukTo: 5 },
			{ perekId: 7, pasukFrom: 1, pasukTo: 1 },
		]);
		expect(mergeCoveringSpans([])).toEqual([]);
	});
});

describe("public path helpers", () => {
	it("builds the article page path", () => {
		expect(articlePath(5, 12)).toBe("/929/5/12");
	});

	it("percent-encodes author names and strips quote characters", () => {
		expect(authorPath(`רש"י`)).toBe(
			`/929/authors/${encodeURIComponent("רשי")}`,
		);
		expect(authorPath("  דוד  ")).toBe(
			`/929/authors/${encodeURIComponent("דוד")}`,
		);
	});

	it("builds the pedia entry path", () => {
		expect(pediaEntryPath("משה")).toBe("/pedia/משה");
	});
});
