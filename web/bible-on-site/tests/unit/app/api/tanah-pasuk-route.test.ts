/**
 * @jest-environment node
 */
import { GET } from "@/app/api/tanah/pasuk/[perekId]/[pasuk]/route";

function requestFor(perekId: string, pasuk: string) {
	return GET(new Request("http://localhost"), {
		params: Promise.resolve({ perekId, pasuk }),
	});
}

describe("GET /api/tanah/pasuk/[perekId]/[pasuk]", () => {
	it("returns reference and pasuk text for a valid ref", async () => {
		const res = await requestFor("29", "23");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reference).toContain("בראשית");
		expect(body.reference).toContain('כ"ג');
		expect(body.text).toContain("לֵאָ֣ה");
	});

	it.each([
		["0", "1"],
		["930", "1"],
		["abc", "1"],
		["29", "0"],
		["29", "abc"],
	])("returns 404 for invalid perekId/pasuk (%s, %s)", async (p, v) => {
		const res = await requestFor(p, v);
		expect(res.status).toBe(404);
		expect(await res.json()).toBeNull();
	});

	it("returns 404 for a pasuk beyond the perek length", async () => {
		const res = await requestFor("29", "999");
		expect(res.status).toBe(404);
	});
});
