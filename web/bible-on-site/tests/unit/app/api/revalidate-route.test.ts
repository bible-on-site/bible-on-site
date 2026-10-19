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

import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { POST } from "../../../../src/app/api/revalidate/route";

const mockRevalidateTag = revalidateTag as jest.MockedFunction<
	typeof revalidateTag
>;
const mockRevalidatePath = revalidatePath as jest.MockedFunction<
	typeof revalidatePath
>;

function req(url: string) {
	return new NextRequest(new URL(url, "http://localhost:3001"));
}

describe("POST /api/revalidate", () => {
	const nodeEnv = process.env.NODE_ENV;
	beforeEach(() => {
		jest.clearAllMocks();
		process.env.NODE_ENV = "development";
	});
	afterEach(() => {
		process.env.NODE_ENV = nodeEnv;
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
		expect(mockRevalidatePath).toHaveBeenCalledWith("/929/5", undefined);
		expect(mockRevalidateTag).not.toHaveBeenCalled();
	});

	it("forwards the page type for dynamic route patterns", async () => {
		const res = await POST(
			req("/api/revalidate?path=/pedia/[slug]&type=page"),
		);

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
		expect(mockRevalidatePath).toHaveBeenCalledWith("/929/5", undefined);
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
		process.env.NODE_ENV = "production";
		delete process.env.REVALIDATE_SECRET;

		const res = await POST(req("/api/revalidate?tag=articles&secret=x"));

		expect(res.status).toBe(401);
		expect(mockRevalidateTag).not.toHaveBeenCalled();
	});

	it("rejects a wrong secret in production", async () => {
		process.env.NODE_ENV = "production";
		process.env.REVALIDATE_SECRET = "expected";

		const res = await POST(req("/api/revalidate?tag=articles&secret=no"));

		expect(res.status).toBe(401);
		expect(mockRevalidateTag).not.toHaveBeenCalled();
	});

	it("accepts the configured secret in production", async () => {
		process.env.NODE_ENV = "production";
		process.env.REVALIDATE_SECRET = "expected";

		const res = await POST(
			req("/api/revalidate?tag=articles&secret=expected"),
		);

		expect(res.status).toBe(200);
		expect(mockRevalidateTag).toHaveBeenCalledWith("articles", {
			expire: 0,
		});
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
});
