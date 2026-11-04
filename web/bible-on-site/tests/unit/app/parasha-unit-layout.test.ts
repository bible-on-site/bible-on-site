/**
 * @jest-environment jsdom
 *
 * The פרשה unit layout resolves the route segment to adjacent units
 * for the swipe-navigation chrome (issue #2738). Canonical slugs get
 * prev/next hrefs; anything else (aliases, numeric ids, unknown or
 * malformed segments — all redirected or 404'd before this layout
 * would serve them) gets none.
 */
// The download-handler registration is a server-side effect unrelated
// to the swipe chrome — its unstable_cache chain can't load in jsdom.
jest.mock("@/lib/download/register-tanach", () => ({}));

import ParashaUnitLayout from "@/app/parasha/[unit]/layout";

const layout = (unit: string) =>
	ParashaUnitLayout({ children: null, params: Promise.resolve({ unit }) });

const swipeHrefs = async (unit: string) => {
	const tree = await layout(unit);
	const props = tree.props as { prevHref: string | null; nextHref: string | null };
	return { prev: props.prevHref, next: props.nextHref };
};

describe("פרשה unit layout", () => {
	it("wires canonical-unit swipe navigation to the adjacent slugs", async () => {
		expect(await swipeHrefs("לך-לך")).toEqual({
			prev: "/פרשה/נח",
			next: "/פרשה/וירא",
		});
	});

	it("decodes a percent-encoded param before resolving", async () => {
		expect(await swipeHrefs(encodeURIComponent("לך-לך"))).toEqual({
			prev: "/פרשה/נח",
			next: "/פרשה/וירא",
		});
	});

	it.each([
		["a numeric unit id", "3"],
		["an alias form", "שלח לך"],
		["an unknown segment", "not-a-unit"],
		["malformed percent-encoding", "%"],
	])("suppresses swipe navigation for %s", async (_label, unit) => {
		expect(await swipeHrefs(unit)).toEqual({ prev: null, next: null });
	});
});
