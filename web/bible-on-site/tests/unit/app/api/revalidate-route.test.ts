/**
 * @jest-environment node
 *
 * The revalidate route is the only on-demand ingress for the site's
 * freshness contract: DB-backed content is cached indefinitely
 * (unstable_cache revalidate: false) and pages are prerendered, so an
 * admin save must reach this endpoint for new content to become public.
 * Tag invalidation must expire immediately: the admin workflow is
 * "save, reload, see the change"; stale-while-revalidate ("max") keeps
 * serving the old page on the first reload after invalidation, which is
 * the reported "ISR does not work" symptom.
 */
jest.mock("next/cache", () => ({
	revalidateTag: jest.fn(),
	revalidatePath: jest.fn(),
}));

const mockAfter = jest.fn((task: () => unknown) => task());
jest.mock("next/server", () => {
	const actual = jest.requireActual("next/server");
	return { ...actual, after: (task: () => unknown) => mockAfter(task) };
});

jest.mock("../../../../src/lib/seo/indexnow", () => ({
	submitIndexNow: jest.fn(),
	collectSubmissionPaths: jest.fn((paths: string[]) => paths),
}));

jest.mock("../../../../src/lib/revalidate/dependencies", () => ({
	resolveEntityChanges: jest.fn(),
}));

// The real contract stays in place — the mock only exists so one test can
// make the parser throw a non-validation error (the route's rethrow arm).
jest.mock("../../../../src/lib/revalidate/contract", () => {
	const actual = jest.requireActual(
		"../../../../src/lib/revalidate/contract",
	);
	return {
		...actual,
		parseEntityChanges: jest.fn(actual.parseEntityChanges),
	};
});

import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { POST } from "../../../../src/app/api/revalidate/route";
import { parseEntityChanges } from "../../../../src/lib/revalidate/contract";
import { resolveEntityChanges } from "../../../../src/lib/revalidate/dependencies";
import {
	collectSubmissionPaths,
	submitIndexNow,
} from "../../../../src/lib/seo/indexnow";

const mockRevalidateTag = revalidateTag as jest.MockedFunction<
	typeof revalidateTag
>;
const mockRevalidatePath = revalidatePath as jest.MockedFunction<
	typeof revalidatePath
>;
const mockSubmit = submitIndexNow as jest.MockedFunction<
	typeof submitIndexNow
>;
const mockCollect = collectSubmissionPaths as jest.MockedFunction<
	typeof collectSubmissionPaths
>;
const mockResolve = resolveEntityChanges as jest.MockedFunction<
	typeof resolveEntityChanges
>;
const mockParse = parseEntityChanges as jest.MockedFunction<
	typeof parseEntityChanges
>;

function req(url: string, headers?: Record<string, string>) {
	return new NextRequest(new URL(url, "http://localhost:3001"), {
		method: "POST",
		headers,
	});
}

function jsonReq(
	url: string,
	body: string,
	headers?: Record<string, string>,
) {
	return new NextRequest(new URL(url, "http://localhost:3001"), {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body,
	});
}

describe("POST /api/revalidate", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.replaceProperty(process.env, "NODE_ENV", "development");
	});
	afterEach(() => {
		jest.restoreAllMocks();
		delete process.env.REVALIDATE_SECRET;
	});

	it("expires the tag immediately so the next request re-renders", async () => {
		const res = await POST(req("/api/revalidate?tag=articles"));

		expect(res.status).toBe(200);
		expect(mockRevalidateTag).toHaveBeenCalledWith("articles", {
			expire: 0,
		});
		expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
		const body = await res.json();
		expect(body.revalidated).toBe(true);
		expect(body.tag).toBe("articles");
	});

	it("invalidates a literal path on the next visit", async () => {
		const res = await POST(req("/api/revalidate?path=/929/5"));

		expect(res.status).toBe(200);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/929/5");
		expect(mockRevalidateTag).not.toHaveBeenCalled();
	});

	it("forwards the page type for dynamic route patterns", async () => {
		const res = await POST(
			req("/api/revalidate?path=/pedia/[slug]&type=page"),
		);

		expect(res.status).toBe(200);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/pedia/[slug]", "page");
	});

	it("defaults a dynamic route pattern to the page type", async () => {
		const res = await POST(req("/api/revalidate?path=/pedia/[slug]"));

		expect(res.status).toBe(200);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/pedia/[slug]", "page");
	});

	it("applies tag and path together in a single call", async () => {
		const res = await POST(
			req("/api/revalidate?tag=articles&path=/929/5"),
		);

		expect(res.status).toBe(200);
		expect(mockRevalidateTag).toHaveBeenCalledWith("articles", {
			expire: 0,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/929/5");
	});

	it("rejects a request without path or tag", async () => {
		const res = await POST(req("/api/revalidate"));

		expect(res.status).toBe(400);
		expect(mockRevalidateTag).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("rejects an invalid revalidatePath type", async () => {
		const res = await POST(
			req("/api/revalidate?path=/pedia/[slug]&type=bogus"),
		);

		expect(res.status).toBe(400);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("rejects a path that is not site-relative", async () => {
		const res = await POST(req("/api/revalidate?path=https://evil.test/x"));

		expect(res.status).toBe(400);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("rejects every call in production without a configured secret", async () => {
		jest.replaceProperty(process.env, "NODE_ENV", "production");
		delete process.env.REVALIDATE_SECRET;

		const res = await POST(req("/api/revalidate?tag=articles&secret=x"));

		expect(res.status).toBe(401);
		expect(mockRevalidateTag).not.toHaveBeenCalled();
	});

	it("rejects a wrong secret in production", async () => {
		jest.replaceProperty(process.env, "NODE_ENV", "production");
		process.env.REVALIDATE_SECRET = "expected";

		const res = await POST(req("/api/revalidate?tag=articles&secret=no"));

		expect(res.status).toBe(401);
		expect(mockRevalidateTag).not.toHaveBeenCalled();
	});

	it("accepts the configured secret in production", async () => {
		jest.replaceProperty(process.env, "NODE_ENV", "production");
		process.env.REVALIDATE_SECRET = "expected";

		const res = await POST(
			req("/api/revalidate?tag=articles&secret=expected"),
		);

		expect(res.status).toBe(200);
		expect(mockRevalidateTag).toHaveBeenCalledWith("articles", {
			expire: 0,
		});
	});

	it("accepts the secret via the x-revalidate-secret header in production", async () => {
		jest.replaceProperty(process.env, "NODE_ENV", "production");
		process.env.REVALIDATE_SECRET = "expected";

		const res = await POST(
			req("/api/revalidate?tag=articles", {
				"x-revalidate-secret": "expected",
			}),
		);

		expect(res.status).toBe(200);
		expect(mockRevalidateTag).toHaveBeenCalledWith("articles", {
			expire: 0,
		});
	});

	it("prefers the header over a query secret in production", async () => {
		jest.replaceProperty(process.env, "NODE_ENV", "production");
		process.env.REVALIDATE_SECRET = "expected";

		const res = await POST(
			req("/api/revalidate?tag=articles&secret=stale", {
				"x-revalidate-secret": "expected",
			}),
		);

		expect(res.status).toBe(200);
	});

	it("rejects a wrong header secret in production", async () => {
		jest.replaceProperty(process.env, "NODE_ENV", "production");
		process.env.REVALIDATE_SECRET = "expected";

		const res = await POST(
			req("/api/revalidate?tag=articles", {
				"x-revalidate-secret": "no",
			}),
		);

		expect(res.status).toBe(401);
		expect(mockRevalidateTag).not.toHaveBeenCalled();
	});

	it("returns 500 when invalidation throws", async () => {
		mockRevalidateTag.mockImplementationOnce(() => {
			throw new Error("cache offline");
		});
		const errorSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const res = await POST(req("/api/revalidate?tag=articles"));

		expect(res.status).toBe(500);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	describe("IndexNow notification", () => {
		it("submits explicit url params plus a literal path after success", async () => {
			const res = await POST(
				req("/api/revalidate?tag=articles&path=/929/5&url=/929/5/12&url=/929/authors/x"),
			);

			expect(res.status).toBe(200);
			expect(mockCollect).toHaveBeenCalledWith([
				"/929/5",
				"/929/5/12",
				"/929/authors/x",
			]);
			expect(mockSubmit).toHaveBeenCalledTimes(1);
		});

		it("does not forward a dynamic path pattern to IndexNow", async () => {
			const res = await POST(
				req("/api/revalidate?path=/pedia/[slug]&type=page&url=/pedia/abc"),
			);

			expect(res.status).toBe(200);
			expect(mockCollect).toHaveBeenCalledWith(["/pedia/abc"]);
		});

		it("accepts an operator call carrying only url params", async () => {
			const res = await POST(req("/api/revalidate?url=/929/1&url=/929/2"));

			expect(res.status).toBe(200);
			expect(mockRevalidateTag).not.toHaveBeenCalled();
			expect(mockRevalidatePath).not.toHaveBeenCalled();
			expect(mockCollect).toHaveBeenCalledWith(["/929/1", "/929/2"]);
		});

		it("schedules no submission when nothing invalidates", async () => {
			const res = await POST(req("/api/revalidate"));

			expect(res.status).toBe(400);
			expect(mockAfter).not.toHaveBeenCalled();
			expect(mockSubmit).not.toHaveBeenCalled();
		});

		it("rejects a url that is not site-relative", async () => {
			const res = await POST(
				req("/api/revalidate?url=https://evil.test/x"),
			);

			expect(res.status).toBe(400);
			expect(mockSubmit).not.toHaveBeenCalled();
		});

		it("runs the submission through the after hook, not inline", async () => {
			mockAfter.mockClear();
			mockSubmit.mockReturnValue(Promise.resolve("submitted"));
			await POST(req("/api/revalidate?url=/929/1"));

			expect(mockAfter).toHaveBeenCalledTimes(1);
			expect(mockSubmit).toHaveBeenCalledTimes(1);
		});

		it("does not notify when invalidation throws", async () => {
			mockRevalidateTag.mockImplementationOnce(() => {
				throw new Error("cache offline");
			});
			jest.spyOn(console, "error").mockImplementation(() => {});

			const res = await POST(
				req("/api/revalidate?tag=articles&url=/929/5"),
			);

			expect(res.status).toBe(500);
			expect(mockSubmit).not.toHaveBeenCalled();
		});
	});

	describe("typed entity changes", () => {
		const resolvedOut = {
			tags: ["article:12", "perek:5:articles"],
			paths: ["/929/5", "/929/5/12"],
			patterns: [{ path: "/pedia/[slug]", type: "page" as const }],
			urls: ["/929/5", "/929/5/12"],
		};

		beforeEach(() => {
			mockResolve.mockResolvedValue(resolvedOut);
		});

		it("resolves entity changes into tags, paths and IndexNow urls", async () => {
			const res = await POST(
				jsonReq(
					"/api/revalidate",
					JSON.stringify({
						changes: [
							{ kind: "article", id: 12, perekIds: [5] },
						],
					}),
				),
			);

			expect(res.status).toBe(200);
			expect(mockResolve).toHaveBeenCalledWith([
				{ kind: "article", id: 12, perekIds: [5] },
			]);
			expect(mockRevalidateTag).toHaveBeenCalledWith("article:12", {
				expire: 0,
			});
			expect(mockRevalidateTag).toHaveBeenCalledWith(
				"perek:5:articles",
				{ expire: 0 },
			);
			expect(mockRevalidatePath).toHaveBeenCalledWith("/929/5");
			expect(mockRevalidatePath).toHaveBeenCalledWith(
				"/pedia/[slug]",
				"page",
			);
			const body = await res.json();
			expect(body.resolved).toEqual({ tags: 2, paths: 2, patterns: 1 });
			expect(mockCollect).toHaveBeenCalledWith([
				"/929/5",
				"/929/5/12",
			]);
		});

		it("combines typed changes with a legacy query tag", async () => {
			mockResolve.mockResolvedValue({
				tags: [],
				paths: ["/929/5"],
				patterns: [],
				urls: ["/929/5"],
			});
			const res = await POST(
				jsonReq(
					"/api/revalidate?tag=perushim",
					JSON.stringify({
						changes: [
							{ kind: "article", id: 12, perekIds: [5] },
						],
					}),
				),
			);

			expect(res.status).toBe(200);
			expect(mockRevalidateTag).toHaveBeenCalledWith("perushim", {
				expire: 0,
			});
			expect(mockRevalidatePath).toHaveBeenCalledWith("/929/5");
		});

		it("rejects malformed JSON before any invalidation", async () => {
			const res = await POST(jsonReq("/api/revalidate", "{oops"));

			expect(res.status).toBe(400);
			expect(mockResolve).not.toHaveBeenCalled();
			expect(mockRevalidateTag).not.toHaveBeenCalled();
		});

		it("rejects a malformed change payload before any invalidation", async () => {
			const res = await POST(
				jsonReq(
					"/api/revalidate",
					JSON.stringify({ changes: [{ kind: "bogus" }] }),
				),
			);

			expect(res.status).toBe(400);
			expect(mockResolve).not.toHaveBeenCalled();
			expect(mockRevalidateTag).not.toHaveBeenCalled();
		});

		it("rethrows an unexpected parser error instead of masking it as a 400", async () => {
			mockParse.mockImplementationOnce(() => {
				throw new TypeError("unexpected validator crash");
			});

			await expect(
				POST(
					jsonReq(
						"/api/revalidate",
						JSON.stringify({ changes: [{ kind: "bogus" }] }),
					),
				),
			).rejects.toThrow("unexpected validator crash");
			expect(mockResolve).not.toHaveBeenCalled();
			expect(mockRevalidateTag).not.toHaveBeenCalled();
		});

		it("rejects an oversized body by content-length", async () => {
			const res = await POST(
				jsonReq(
					"/api/revalidate",
					"{}",
					{ "content-length": String(70 * 1024) },
				),
			);

			expect(res.status).toBe(400);
			expect(mockResolve).not.toHaveBeenCalled();
		});

		it("bounds the decoded body when content-length is small", async () => {
			const res = await POST(
				jsonReq(
					"/api/revalidate",
					`{"changes":${" ".repeat(70 * 1024)}`,
					{ "content-length": "10" },
				),
			);

			expect(res.status).toBe(400);
			expect(mockResolve).not.toHaveBeenCalled();
		});

		it("returns 500 when dependency resolution fails", async () => {
			mockResolve.mockRejectedValueOnce(new Error("db down"));
			jest.spyOn(console, "error").mockImplementation(() => {});

			const res = await POST(
				jsonReq(
					"/api/revalidate",
					JSON.stringify({
						changes: [{ kind: "author", id: 3, name: "x" }],
					}),
				),
			);

			expect(res.status).toBe(500);
			expect(mockRevalidateTag).not.toHaveBeenCalled();
			expect(mockSubmit).not.toHaveBeenCalled();
		});

		it("rejects a typed request that resolves to nothing", async () => {
			mockResolve.mockResolvedValueOnce({
				tags: [],
				paths: [],
				patterns: [],
				urls: [],
			});
			const res = await POST(
				jsonReq(
					"/api/revalidate",
					JSON.stringify({
						changes: [{ kind: "author", id: 3, name: "x" }],
					}),
				),
			);

			expect(res.status).toBe(400);
			expect(mockRevalidateTag).not.toHaveBeenCalled();
		});
	});
});
