/**
 * @jest-environment node
 */
jest.mock("@/lib/tanahpedia/service", () => ({
	getEntryByUniqueName: jest.fn(),
}));

import { GET } from "@/app/api/tanahpedia/preview/[uniqueName]/route";
import { getEntryByUniqueName } from "@/lib/tanahpedia/service";

const mockGetEntry = getEntryByUniqueName as jest.MockedFunction<
	typeof getEntryByUniqueName
>;

describe("GET /api/tanahpedia/preview/[uniqueName]", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 404 when entry missing", async () => {
		mockGetEntry.mockResolvedValue(null);
		const res = await GET(new Request("http://localhost"), {
			params: Promise.resolve({ uniqueName: "nope" }),
		});
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toBeNull();
		expect(mockGetEntry).toHaveBeenCalledWith("nope");
	});

	it("returns title and snippet when entry exists", async () => {
		mockGetEntry.mockResolvedValue({
			id: "1",
			uniqueName: "שמשון",
			title: "שמשון",
			content: "<p>נזיר</p>",
			createdAt: "",
			updatedAt: "",
			entities: [],
		});
		const res = await GET(new Request("http://localhost"), {
			params: Promise.resolve({ uniqueName: encodeURIComponent("שמשון") }),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.title).toBe("שמשון");
		expect(json.snippet).toContain("נזיר");
	});

	it("truncates long content in snippet", async () => {
		const longText = "א".repeat(500);
		mockGetEntry.mockResolvedValue({
			id: "1",
			uniqueName: "x",
			title: "t",
			content: `<p>${longText}</p>`,
			createdAt: "",
			updatedAt: "",
			entities: [],
		});
		const res = await GET(new Request("http://localhost"), {
			params: Promise.resolve({ uniqueName: "x" }),
		});
		const json = await res.json();
		expect(json.snippet.length).toBeLessThan(longText.length + 50);
		expect(json.snippet).toContain("…");
	});
});
