/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import {
	findOpenPerushPanel,
	findPerushPasukGroup,
	findSeferPasuk,
	getSeferOpenPerush,
	scrollToPerushPasuk,
	scrollToSeferPasuk,
	setSeferOpenPerush,
	useSeferOpenPerush,
} from "@/app/929/[number]/components/sefer-pasuk-navigation";

/** Two mounted perakim whose pages reuse identical pasuk numbers. */
function mountFacingPages() {
	document.body.innerHTML = `
		<div data-sefer-perek="1">
			<span data-sefer-pasuk="1">p1v1</span>
			<span data-sefer-pasuk="2">p1v2</span>
		</div>
		<div data-sefer-perush-perek="1" data-sefer-perush="רש&quot;י">
			<div data-perush-pasuk="1"><span>label</span><p>note a</p><p>note b</p></div>
			<div data-perush-pasuk="2"><span>label</span><p>note c</p></div>
		</div>
		<div data-sefer-perek="2">
			<span data-sefer-pasuk="1">p2v1</span>
			<span data-sefer-pasuk="2">p2v2</span>
		</div>
		<div data-sefer-perush-perek="2" data-sefer-perush="אבן עזרא">
			<div data-perush-pasuk="1"><span>label</span><p>note d</p></div>
		</div>`;
}

const scrollIntoView = jest.fn();

beforeEach(() => {
	mountFacingPages();
	scrollIntoView.mockClear();
	Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
	setSeferOpenPerush(1, null);
	setSeferOpenPerush(2, null);
	setSeferOpenPerush(3, null);
	document.body.innerHTML = "";
});

describe("scrollToPerushPasuk", () => {
	it("jumps to the pasuk group in the same perek's open perush", () => {
		const group = document.querySelector(
			'[data-sefer-perush-perek="2"] [data-perush-pasuk="1"]',
		) as Element;
		expect(scrollToPerushPasuk(2, 1)).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledTimes(1);
		expect(scrollIntoView.mock.contexts[0]).toBe(group);
		expect(group).toHaveAttribute("data-pasuk-highlight", "");
		expect(group).toHaveAttribute("aria-current", "location");
		// The identical pasuk number in perek 1 must not be touched.
		const other = document.querySelector(
			'[data-sefer-perush-perek="1"] [data-perush-pasuk="1"]',
		) as Element;
		expect(other).not.toHaveAttribute("data-pasuk-highlight");
	});

	it("returns false when no perush is open for the perek", () => {
		expect(scrollToPerushPasuk(3, 1)).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
		expect(document.querySelector("[data-pasuk-highlight]")).toBeNull();
	});

	it("returns false when the open perush has no note on the pasuk", () => {
		expect(scrollToPerushPasuk(2, 2)).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
		// The perush panel stays put and unhighlighted.
		expect(
			document.querySelector(
				'[data-sefer-perush-perek="2"] [data-pasuk-highlight]',
			),
		).toBeNull();
	});

	it("moves the highlight between pesukim of the same perush", () => {
		scrollToPerushPasuk(1, 1);
		scrollToPerushPasuk(1, 2);
		const highlighted = document.querySelectorAll("[data-pasuk-highlight]");
		expect(highlighted).toHaveLength(1);
		expect(highlighted[0]).toBe(
			document.querySelector(
				'[data-sefer-perush-perek="1"] [data-perush-pasuk="2"]',
			),
		);
		expect(highlighted[0]).toHaveAttribute("aria-current", "location");
	});

	it("resolves the group start even when a pasuk has several notes", () => {
		scrollToPerushPasuk(1, 1);
		const group = document.querySelector(
			'[data-sefer-perush-perek="1"] [data-perush-pasuk="1"]',
		) as Element;
		// The group element itself (not an inner note) is the scroll target.
		expect(scrollIntoView.mock.contexts[0]).toBe(group);
		expect(group.children).toHaveLength(3);
	});

	it("scopes lookups to the supplied root", () => {
		const detached = document.createElement("div");
		detached.innerHTML = `
			<div data-sefer-perush-perek="9">
				<div data-perush-pasuk="1"><p>note</p></div>
			</div>`;
		expect(scrollToPerushPasuk(9, 1, detached)).toBe(true);
		expect(findOpenPerushPanel(9, detached)).not.toBeNull();
		expect(findPerushPasukGroup(9, 1, detached)).not.toBeNull();
	});
});

describe("scrollToSeferPasuk", () => {
	it("jumps to the matching pasuk in the same perek's text page", () => {
		const verse = document.querySelector(
			'[data-sefer-perek="1"] [data-sefer-pasuk="2"]',
		) as Element;
		expect(scrollToSeferPasuk(1, 2)).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledTimes(1);
		expect(scrollIntoView.mock.contexts[0]).toBe(verse);
		expect(verse).toHaveAttribute("data-pasuk-highlight", "");
		expect(verse).toHaveAttribute("aria-current", "location");
		const otherPerek = document.querySelector(
			'[data-sefer-perek="2"] [data-sefer-pasuk="2"]',
		) as Element;
		expect(otherPerek).not.toHaveAttribute("data-pasuk-highlight");
	});

	it("returns false when the perek page is not mounted", () => {
		expect(scrollToSeferPasuk(3, 1)).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it("returns false when the pasuk does not exist in the perek", () => {
		expect(scrollToSeferPasuk(1, 99)).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it("keeps the previous highlight inside the perek cleared", () => {
		scrollToSeferPasuk(1, 1);
		scrollToSeferPasuk(1, 2);
		expect(
			document.querySelectorAll(
				'[data-sefer-perek="1"] [data-pasuk-highlight]',
			),
		).toHaveLength(1);
		expect(findSeferPasuk(1, 1)).not.toHaveAttribute("data-pasuk-highlight");
	});
});

describe("open perush registry", () => {
	it("publishes, updates and clears the open perush per perek", () => {
		expect(getSeferOpenPerush(1)).toBeNull();
		setSeferOpenPerush(1, { name: 'רש"י', pesukim: new Set([1, 2]) });
		expect(getSeferOpenPerush(1)).toEqual({
			name: 'רש"י',
			pesukim: new Set([1, 2]),
		});
		setSeferOpenPerush(1, { name: "אבן עזרא", pesukim: new Set([3]) });
		expect(getSeferOpenPerush(1)?.name).toBe("אבן עזרא");
		setSeferOpenPerush(1, null);
		expect(getSeferOpenPerush(1)).toBeNull();
		expect(getSeferOpenPerush(2)).toBeNull();
	});

	it("keeps the stored entry when the same coverage is republished", () => {
		const published = { name: 'רש"י', pesukim: new Set([1]) };
		setSeferOpenPerush(1, published);
		// Same name and same pesukim set: nothing actually changed.
		setSeferOpenPerush(1, { name: 'רש"י', pesukim: new Set([1]) });
		expect(getSeferOpenPerush(1)).toBe(published);
	});

	it("republishes when the coverage set changes under the same name (#2544)", () => {
		const published = { name: 'רש"י', pesukim: new Set([1]) };
		setSeferOpenPerush(1, published);
		const next = { name: 'רש"י', pesukim: new Set([9]) };
		setSeferOpenPerush(1, next);
		expect(getSeferOpenPerush(1)).toBe(next);
	});

	it("keeps perakim independent", () => {
		setSeferOpenPerush(1, { name: 'רש"י', pesukim: new Set([1]) });
		setSeferOpenPerush(2, { name: "אבן עזרא", pesukim: new Set([1]) });
		expect(getSeferOpenPerush(1)?.name).toBe('רש"י');
		expect(getSeferOpenPerush(2)?.name).toBe("אבן עזרא");
		setSeferOpenPerush(1, null);
		expect(getSeferOpenPerush(2)?.name).toBe("אבן עזרא");
	});
});

describe("useSeferOpenPerush", () => {
	it("reflects the open perush for its perek only", () => {
		const { result } = renderHook(() => useSeferOpenPerush(1));
		expect(result.current).toBeNull();
		act(() =>
			setSeferOpenPerush(2, { name: "אבן עזרא", pesukim: new Set([1]) }),
		);
		expect(result.current).toBeNull();
		act(() => setSeferOpenPerush(1, { name: 'רש"י', pesukim: new Set([1]) }));
		expect(result.current?.name).toBe('רש"י');
		act(() => setSeferOpenPerush(1, null));
		expect(result.current).toBeNull();
	});

	it("stops updating after unmount", () => {
		const { result, unmount } = renderHook(() => useSeferOpenPerush(1));
		unmount();
		act(() => setSeferOpenPerush(1, { name: 'רש"י', pesukim: new Set([1]) }));
		expect(result.current).toBeNull();
	});
});
