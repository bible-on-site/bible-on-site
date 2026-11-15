/**
 * @jest-environment node
 */
jest.mock("@/lib/search/service", () => ({
	...jest.requireActual("@/lib/search/service"),
	searchSite: jest.fn(),
}));

import { GET } from "@/app/api/search/route";
import { GET as openapiGET } from "@/app/openapi.json/route";
import { searchSite } from "@/lib/search/service";
import type { SearchResponse } from "@/lib/search/types";

const mockSearch = searchSite as jest.MockedFunction<typeof searchSite>;

const EMPTY: SearchResponse = {
	query: "בראשית",
	types: ["perek", "pasuk", "perush", "author", "article", "tanahpedia"],
	results: [],
	counts: {},
	availability: [],
};

function requestFor(path: string) {
	return GET(new Request(`http://localhost/api/search${path}`));
}

describe("GET /api/search", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockSearch.mockResolvedValue(EMPTY);
	});

	it("searches with parsed params and marks the response no-store", async () => {
		const res = await requestFor(
			`?q=${encodeURIComponent("בראשית")}&type=perek,pasuk&limit=5`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(mockSearch).toHaveBeenCalledWith("בראשית", ["perek", "pasuk"], {
			limit: 5,
		});
		const body = await res.json();
		expect(body.query).toBe("בראשית");
	});

	it("rejects a missing or blank q", async () => {
		expect((await requestFor("")).status).toBe(400);
		expect((await requestFor("?q=")).status).toBe(400);
		expect((await requestFor("?q=%20%20")).status).toBe(400);
	});

	it("rejects an overlong q with 414", async () => {
		const res = await requestFor(`?q=${"א".repeat(300)}`);
		expect(res.status).toBe(414);
	});

	it("rejects an out-of-range limit", async () => {
		expect((await requestFor("?q=א&limit=0")).status).toBe(400);
		expect((await requestFor("?q=א&limit=51")).status).toBe(400);
	});

	it("rejects a malformed limit instead of coercing or defaulting", async () => {
		// parseInt("5oops") would return 5; "abc" would silently default.
		for (const bad of ["5oops", "abc", "5.5", "0x10", "", "-3"]) {
			const res = await requestFor(`?q=א&limit=${encodeURIComponent(bad)}`);
			expect(res.status).toBe(400);
			expect((await res.json()).error).toBe("invalid_limit");
		}
	});

	it("rejects a type param with no valid values", async () => {
		expect((await requestFor("?q=א&type=bogus")).status).toBe(400);
	});

	it("defaults to all types and default limit", async () => {
		const res = await requestFor(`?q=${encodeURIComponent("את")}`);
		expect(res.status).toBe(200);
		expect(mockSearch).toHaveBeenCalledWith(
			"את",
			["perek", "pasuk", "perush", "author", "article", "tanahpedia"],
			{ limit: undefined },
		);
	});

	it("returns 500 when the service itself throws", async () => {
		mockSearch.mockRejectedValue(new Error("boom"));
		jest.spyOn(console, "error").mockImplementation(() => {});
		const res = await requestFor(`?q=${encodeURIComponent("את")}`);
		expect(res.status).toBe(500);
	});

	it("returns 500 for a non-Error rejection too", async () => {
		mockSearch.mockRejectedValue("plain failure");
		jest.spyOn(console, "error").mockImplementation(() => {});
		const res = await requestFor(`?q=${encodeURIComponent("את")}`);
		expect(res.status).toBe(500);
	});

	it.each([
		["", 400],
		[`?q=${"א".repeat(257)}`, 414],
		["?q=test&limit=0", 400],
		["?q=test&type=bogus", 400],
		["?q=test", 500],
	])("documents the actual error response for %s", async (path, status) => {
		mockSearch.mockRejectedValue(new Error("unavailable"));
		jest.spyOn(console, "error").mockImplementation(() => {});
		const response = await requestFor(path);
		expect(response.status).toBe(status);
		const doc = await openapiGET().json();
		const responses = doc.paths["/api/search"].get.responses;
		expect(responses[String(response.status)]).toBeDefined();
		expect(responses).not.toHaveProperty("503");
	});

	it("keeps partial results at 200 with the documented availability field", async () => {
		const partial = {
			...EMPTY,
			availability: ["חיפוש המאמרים אינו זמין כרגע"],
		};
		mockSearch.mockResolvedValue(partial);
		const response = await requestFor("?q=test");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(partial);
		const doc = await openapiGET().json();
		const schema =
			doc.paths["/api/search"].get.responses["200"].content["application/json"]
				.schema;
		expect([...schema.required].sort()).toEqual(Object.keys(partial).sort());
	});
});
