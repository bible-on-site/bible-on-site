import { isPasukCitationHash } from "@/lib/pasuk-anchor";

describe("isPasukCitationHash", () => {
	it("matches flat perek pasuk anchors", () => {
		expect(isPasukCitationHash("#pasuk-3")).toBe(true);
		expect(isPasukCitationHash("#pasuk-176")).toBe(true);
	});

	it("matches ranged unit pasuk anchors (RangedPerushView links)", () => {
		expect(isPasukCitationHash("#pasuk-1-5")).toBe(true);
		expect(isPasukCitationHash("#pasuk-25-12")).toBe(true);
	});

	it("rejects non-citation and malformed hashes", () => {
		expect(isPasukCitationHash("")).toBe(false);
		expect(isPasukCitationHash("#pasuk")).toBe(false);
		expect(isPasukCitationHash("#pasuk-0")).toBe(false);
		expect(isPasukCitationHash("#pasuk-1-0")).toBe(false);
		expect(isPasukCitationHash("#pasuk-1-5-haftarah")).toBe(false);
		expect(isPasukCitationHash("#pasuk-1-5-6")).toBe(false);
		expect(isPasukCitationHash("#perush-3")).toBe(false);
		expect(isPasukCitationHash("pasuk-3")).toBe(false);
	});
});
