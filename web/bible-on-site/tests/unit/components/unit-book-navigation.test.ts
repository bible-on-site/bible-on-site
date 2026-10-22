/**
 * @jest-environment jsdom
 *
 * Unit-scoped pasuk <-> perush navigation inside the book (issue
 * #2191): panes are keyed by `{unitId}:{scope}` so Torah and Haftarah
 * spreads never collide, anchors stay canonical (`pasuk-{perek}-{pasuk}`)
 * for cross-reader interoperability, and the open-perush registry
 * gates numeral clicks to pesukim that actually carry a note.
 */
import {
	findOpenUnitPerushPanel,
	findUnitPerushPasukGroup,
	findUnitTextPasuk,
	getUnitOpenPerush,
	handleUnitTextPasukClick,
	scrollToUnitPerushPasuk,
	scrollToUnitTextPasuk,
	setUnitOpenPerush,
	unitBookKey,
} from "@/app/components/reading/unit-book-navigation";

const scrollIntoView = jest.fn();
const TORAH_KEY = unitBookKey(7, "torah");
const HAFTARA_KEY = unitBookKey(7, "haftara");

function textPage(bookKey: string, anchors: string[]): HTMLElement {
	const page = document.createElement("section");
	page.setAttribute("data-sefer-unit-text", bookKey);
	for (const id of anchors) {
		const pasuk = document.createElement("span");
		pasuk.id = id;
		page.append(pasuk);
	}
	document.body.append(page);
	return page;
}

function perushPanel(bookKey: string, groups: string[]): HTMLElement {
	const panel = document.createElement("div");
	panel.setAttribute("data-sefer-unit-perush", bookKey);
	for (const key of groups) {
		const group = document.createElement("div");
		group.setAttribute("data-unit-perush-pasuk", key);
		panel.append(group);
	}
	document.body.append(panel);
	return panel;
}

beforeEach(() => {
	document.body.innerHTML = "";
	scrollIntoView.mockReset();
	setUnitOpenPerush(TORAH_KEY, null);
	setUnitOpenPerush(HAFTARA_KEY, null);
	// biome-ignore lint/suspicious/noExplicitAny: jsdom lacks it.
	(Element.prototype as any).scrollIntoView = scrollIntoView;
});

describe("unitBookKey", () => {
	it("keys each pane by unit and scope", () => {
		expect(unitBookKey(7, "torah")).toBe("7:torah");
		expect(unitBookKey(7, "haftara")).toBe("7:haftara");
	});
});

describe("findUnitTextPasuk", () => {
	it("resolves the canonical pasuk anchor inside the pane", () => {
		textPage(TORAH_KEY, ["pasuk-36-1", "pasuk-36-2"]);
		expect(findUnitTextPasuk(TORAH_KEY, 36, 2)?.id).toBe("pasuk-36-2");
	});

	it("resolves scope-suffixed auxiliary anchors", () => {
		textPage(HAFTARA_KEY, ["pasuk-335-5-haftara-ashkenazi"]);
		expect(findUnitTextPasuk(HAFTARA_KEY, 335, 5)?.id).toBe(
			"pasuk-335-5-haftara-ashkenazi",
		);
	});

	it("scopes the lookup to its own pane", () => {
		textPage(TORAH_KEY, ["pasuk-36-2"]);
		expect(findUnitTextPasuk(HAFTARA_KEY, 36, 2)).toBeNull();
		expect(findUnitTextPasuk(TORAH_KEY, 36, 9)).toBeNull();
	});
});

describe("scrollToUnitTextPasuk", () => {
	it("scrolls and highlights the pasuk inside the text pane", () => {
		textPage(TORAH_KEY, ["pasuk-36-2"]);
		expect(scrollToUnitTextPasuk(TORAH_KEY, 36, 2)).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "start",
		});
		expect(
			document.getElementById("pasuk-36-2")?.getAttribute("aria-current"),
		).toBe("location");
	});

	it("moves the highlight between pesukim", () => {
		textPage(TORAH_KEY, ["pasuk-36-1", "pasuk-36-2"]);
		scrollToUnitTextPasuk(TORAH_KEY, 36, 1);
		scrollToUnitTextPasuk(TORAH_KEY, 36, 2);
		expect(
			document
				.getElementById("pasuk-36-1")
				?.hasAttribute("data-pasuk-highlight"),
		).toBe(false);
		expect(
			document
				.getElementById("pasuk-36-2")
				?.hasAttribute("data-pasuk-highlight"),
		).toBe(true);
	});

	it("returns false when the page or pasuk is not mounted", () => {
		expect(scrollToUnitTextPasuk(TORAH_KEY, 36, 2)).toBe(false);
		textPage(TORAH_KEY, ["pasuk-36-1"]);
		expect(scrollToUnitTextPasuk(TORAH_KEY, 36, 2)).toBe(false);
	});
});

describe("scrollToUnitPerushPasuk", () => {
	it("scrolls the open perush's pasuk group for the pane", () => {
		perushPanel(HAFTARA_KEY, ["335-5", "335-6"]);
		expect(scrollToUnitPerushPasuk(HAFTARA_KEY, 335, 5)).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "start",
		});
	});

	it("returns false with no open perush or no note on the pasuk", () => {
		expect(scrollToUnitPerushPasuk(TORAH_KEY, 36, 2)).toBe(false);
		perushPanel(TORAH_KEY, ["36-1"]);
		expect(scrollToUnitPerushPasuk(TORAH_KEY, 36, 2)).toBe(false);
	});
});

describe("findOpenUnitPerushPanel / findUnitPerushPasukGroup", () => {
	it("locates the panel and pasuk group by bookKey", () => {
		perushPanel(TORAH_KEY, ["36-2"]);
		expect(findOpenUnitPerushPanel(TORAH_KEY)).not.toBeNull();
		expect(findOpenUnitPerushPanel(HAFTARA_KEY)).toBeNull();
		expect(findUnitPerushPasukGroup(TORAH_KEY, 36, 2)).not.toBeNull();
		expect(findUnitPerushPasukGroup(TORAH_KEY, 36, 1)).toBeNull();
	});
});

describe("open-perush registry", () => {
	it("publishes and clears the perush open on a pane", () => {
		const open = { name: 'רש"י', pesukim: new Set(["36-2"]) };
		expect(getUnitOpenPerush(TORAH_KEY)).toBeNull();
		setUnitOpenPerush(TORAH_KEY, open);
		expect(getUnitOpenPerush(TORAH_KEY)).toBe(open);
		setUnitOpenPerush(TORAH_KEY, null);
		expect(getUnitOpenPerush(TORAH_KEY)).toBeNull();
	});
});

describe("handleUnitTextPasukClick", () => {
	function numeralIn(pasukId: string): HTMLElement {
		const anchor = document.createElement("span");
		anchor.id = pasukId;
		const numeral = document.createElement("sup");
		numeral.setAttribute("data-pasuk-num", "");
		anchor.append(numeral);
		document.body.append(anchor);
		return numeral;
	}

	it("scrolls the facing perush when the pasuk carries a note", () => {
		perushPanel(TORAH_KEY, ["36-2"]);
		setUnitOpenPerush(TORAH_KEY, {
			name: 'רש"י',
			pesukim: new Set(["36-2"]),
		});
		handleUnitTextPasukClick(TORAH_KEY, numeralIn("pasuk-36-2"));
		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "start",
		});
	});

	it("ignores pesukim the open perush does not cover", () => {
		perushPanel(TORAH_KEY, ["36-2"]);
		setUnitOpenPerush(TORAH_KEY, {
			name: 'רש"י',
			pesukim: new Set(["36-2"]),
		});
		handleUnitTextPasukClick(TORAH_KEY, numeralIn("pasuk-36-7"));
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it("ignores clicks with no open perush or no numeral", () => {
		perushPanel(TORAH_KEY, ["36-2"]);
		const numeral = numeralIn("pasuk-36-2");
		// No perush published for the pane.
		handleUnitTextPasukClick(TORAH_KEY, numeral);
		expect(scrollIntoView).not.toHaveBeenCalled();
		setUnitOpenPerush(TORAH_KEY, {
			name: 'רש"י',
			pesukim: new Set(["36-2"]),
		});
		// A non-numeral target resolves nothing.
		handleUnitTextPasukClick(
			TORAH_KEY,
			document.createElement("div"),
		);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
