/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({
	unstable_cache: (fn: (...args: never[]) => unknown) => fn,
	revalidateTag: jest.fn(),
	revalidatePath: jest.fn(),
}));

const mockRender = jest.fn();
jest.mock("@/lib/markdown/render", () => ({
	renderMarkdown: (...args: unknown[]) => mockRender(...args),
}));

import { GET, HEAD } from "@/app/md/[[...path]]/route";

const REQ = new Request("https://example.com/md/929/1");
const ctx = (path?: string[]) => ({ params: Promise.resolve({ path }) });

describe("/md/[[...path]] route (issue #3257)", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	it("serves UTF-8 markdown with canonical + alternate link headers", async () => {
		mockRender.mockResolvedValue({
			title: "בראשית א",
			canonicalPath: "/929/1",
			markdown: "# בראשית א\n\nא. text",
		});
		const response = await GET(REQ, ctx(["929", "1"]));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"text/markdown; charset=utf-8",
		);
		expect(response.headers.get("vary")).toContain("Accept");
		const link = response.headers.get("link") ?? "";
		expect(link).toContain('</929/1>; rel="alternate"; type="text/html"');
		expect(link).toContain('</929/1.md>; rel="alternate"; type="text/markdown"');
		expect(link).toContain('rel="help"');
		expect(await response.text()).toContain("# בראשית א");
	});

	it("serves the same headers and an empty body on HEAD", async () => {
		mockRender.mockResolvedValue({
			title: "t",
			canonicalPath: "/929/2",
			markdown: "body",
		});
		const response = await HEAD(REQ, ctx(["929", "2"]));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"text/markdown; charset=utf-8",
		);
		expect(await response.text()).toBe("");
	});

	it("404s paths outside the corpus allowlist", async () => {
		for (const path of [
			["api", "search"],
			["dev", "x"],
			["929", "930"],
			["foo"],
		]) {
			mockRender.mockClear();
			const response = await GET(REQ, ctx(path));
			expect(response.status).toBe(404);
			expect(mockRender).not.toHaveBeenCalled();
		}
	});

	it("404s genuinely missing/unpublished content", async () => {
		mockRender.mockResolvedValue(null);
		const response = await GET(REQ, ctx(["929", "1", "9999"]));
		expect(response.status).toBe(404);
	});

	it("503s transient backend failures with Retry-After and no-store", async () => {
		mockRender.mockRejectedValue(new Error("ECONNREFUSED mysql"));
		const response = await GET(REQ, ctx(["929", "1"]));
		expect(response.status).toBe(503);
		expect(response.headers.get("retry-after")).toBe("60");
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = await response.text();
		// Never leak backend details.
		expect(body).not.toContain("mysql");
		expect(body).not.toContain("ECONNREFUSED");
	});

	it("URI-encodes Hebrew canonical paths in Link headers", async () => {
		mockRender.mockResolvedValue({
			title: "פרשת בראשית",
			canonicalPath: "/פרשה/בראשית",
			markdown: "# פרשת בראשית",
		});
		const response = await GET(
			REQ,
			ctx(["פרשה", "בראשית"]),
		);
		expect(response.status).toBe(200);
		const link = response.headers.get("link") ?? "";
		// Header values are ByteString: Hebrew travels URI-encoded.
		expect(link).toContain(
			`<${encodeURI("/פרשה/בראשית")}>; rel="alternate"; type="text/html"`,
		);
		expect(link).toContain(
			`<${encodeURI("/פרשה/בראשית")}.md>; rel="alternate"; type="text/markdown"`,
		);
	});

	it("503s non-Error rejections without exposing the value", async () => {
		mockRender.mockRejectedValue("plain string failure");
		const response = await GET(REQ, ctx(["929", "1"]));
		expect(response.status).toBe(503);
		expect(await response.text()).toBe("Service unavailable");
	});

	it("renders the root document for the bare /md path", async () => {
		mockRender.mockResolvedValue({
			title: "home",
			canonicalPath: "/",
			markdown: "# root",
		});
		const response = await GET(REQ, ctx(undefined));
		expect(response.status).toBe(200);
	});
});
