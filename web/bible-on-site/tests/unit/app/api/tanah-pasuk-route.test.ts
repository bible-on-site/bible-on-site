/**
 * @jest-environment node
 */
jest.mock("@/lib/perushim", () => ({
	getPerushimByPerekId: jest.fn(),
	getPerushNotes: jest.fn(),
}));

import { GET } from "@/app/api/tanah/pasuk/[perekId]/[pasuk]/route";
import { getPerushimByPerekId, getPerushNotes } from "@/lib/perushim";

const mockPerushim = getPerushimByPerekId as jest.MockedFunction<
	typeof getPerushimByPerekId
>;
const mockNotes = getPerushNotes as jest.MockedFunction<typeof getPerushNotes>;

function requestFor(perekId: string, pasuk: string, query = "") {
	return GET(new Request(`http://localhost/api/tanah/pasuk/${perekId}/${pasuk}${query}`), {
		params: Promise.resolve({ perekId, pasuk }),
	});
}

describe("GET /api/tanah/pasuk/[perekId]/[pasuk]", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns reference and pasuk text for a valid ref", async () => {
		const res = await requestFor("29", "23");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reference).toContain("בראשית");
		expect(body.reference).toContain('כ"ג');
		expect(body.text).toContain("לֵאָ֣ה");
		expect(body.noteHtml).toBeUndefined();
	});

	it("includes the perush note when a perush is given and has a note", async () => {
		mockPerushim.mockResolvedValue([
			{ id: 23, name: "הכתב והקבלה", parshanName: "רימ", noteCount: 1 },
		]);
		mockNotes.mockResolvedValue([
			{ pasuk: 23, noteIdx: 1, noteContent: "<p>דברי הפירוש</p>" },
			{ pasuk: 24, noteIdx: 1, noteContent: "<p>אחר</p>" },
		]);
		const res = await requestFor(
			"32",
			"23",
			`?perush=${encodeURIComponent("הכתב והקבלה")}`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reference).toContain("הכתב והקבלה");
		expect(body.noteHtml).toContain("דברי הפירוש");
		expect(body.noteHtml).not.toContain("אחר");
		expect(mockNotes).toHaveBeenCalledWith(23, 32);
	});

	it("falls back to the plain pasuk preview when the perush has no note", async () => {
		mockPerushim.mockResolvedValue([]);
		const res = await requestFor(
			"32",
			"23",
			`?perush=${encodeURIComponent("לא קיים")}`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.noteHtml).toBeUndefined();
		expect(body.reference).not.toContain("לא קיים");
	});

	it("falls back when the perush exists but has no note for the pasuk", async () => {
		mockPerushim.mockResolvedValue([
			{ id: 23, name: "הכתב והקבלה", parshanName: "רימ", noteCount: 1 },
		]);
		mockNotes.mockResolvedValue([
			{ pasuk: 5, noteIdx: 1, noteContent: "<p>אחר</p>" },
		]);
		const res = await requestFor(
			"32",
			"23",
			`?perush=${encodeURIComponent("הכתב והקבלה")}`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.noteHtml).toBeUndefined();
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
