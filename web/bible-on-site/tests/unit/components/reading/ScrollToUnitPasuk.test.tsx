/**
 * Unit tests for ScrollToUnitPasuk — the client helper that re-highlights
 * the hash-selected pasuk inside a scoped reading-unit article. Unit pages
 * may render several unit-text articles (Torah text plus Haftarah
 * variants), so the scroller resolves `pasuk-{perek}-{pasuk}` hashes
 * against scope-suffixed anchors when the canonical id is absent or lives
 * in another article.
 */
import { render } from "@testing-library/react";
import { ScrollToUnitPasuk } from "../../../../src/app/components/reading/ScrollToUnitPasuk";

jest.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

const HASH = "#pasuk-1-2";

function setHash(hash: string) {
	window.history.replaceState(null, "", `/פרשה/1${hash}`);
}

/** Mounts an article for `scope` plus optional elements outside it. */
function mountArticle(
	scope: string,
	insideIds: string[],
	outsideIds: string[] = [],
	staleHighlight = false,
): HTMLElement {
	document.body.innerHTML = `
		${outsideIds.map((id) => `<span id="${id}"></span>`).join("")}
		<article data-unit-text="${scope}">
			${insideIds.map((id) => `<span id="${id}"></span>`).join("")}
			${staleHighlight ? `<span id="stale" data-pasuk-highlight aria-current="location"></span>` : ""}
		</article>`;
	return document.querySelector("article") as HTMLElement;
}

describe("ScrollToUnitPasuk", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setHash("");
		// jsdom lacks rAF/scrollIntoView; the effect schedules through them.
		window.requestAnimationFrame = (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		};
		window.cancelAnimationFrame = () => {};
		Element.prototype.scrollIntoView = jest.fn();
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("does nothing when no article matches the scope", () => {
		setHash(HASH);
		expect(() => render(<ScrollToUnitPasuk scope="missing" />)).not.toThrow();
		expect(document.querySelector("[data-unit-text]")).toBeNull();
	});

	it("marks the article ready and highlights the canonical pasuk", () => {
		const article = mountArticle("", [HASH.slice(1)]);
		setHash(HASH);
		render(<ScrollToUnitPasuk />);
		const verse = document.getElementById(HASH.slice(1)) as HTMLElement;
		expect(article).toHaveAttribute("data-pasuk-navigation-ready");
		expect(verse).toHaveAttribute("data-pasuk-highlight");
		expect(verse).toHaveAttribute("aria-current", "location");
		expect(verse.scrollIntoView).toHaveBeenCalled();
	});

	it("falls back to the scope-suffixed anchor when the canonical id is missing", () => {
		mountArticle("haftara-x", [`${HASH.slice(1)}-haftara-x`]);
		setHash(HASH);
		render(<ScrollToUnitPasuk scope="haftara-x" />);
		const scoped = document.getElementById(`${HASH.slice(1)}-haftara-x`);
		expect(scoped).toHaveAttribute("data-pasuk-highlight");
	});

	it("falls back to the scoped anchor when the canonical id sits in another article", () => {
		// The canonical pasuk-1-2 belongs to the Torah article; the Haftarah
		// variant's own anchor must win inside its article.
		mountArticle("haftara-x", [`${HASH.slice(1)}-haftara-x`], [HASH.slice(1)]);
		setHash(HASH);
		render(<ScrollToUnitPasuk scope="haftara-x" />);
		expect(document.getElementById(HASH.slice(1))).not.toHaveAttribute(
			"data-pasuk-highlight",
		);
		expect(
			document.getElementById(`${HASH.slice(1)}-haftara-x`),
		).toHaveAttribute("data-pasuk-highlight");
	});

	it("never scope-falls-back for the torah scope", () => {
		mountArticle("torah", [], []);
		setHash(HASH);
		render(<ScrollToUnitPasuk scope="torah" />);
		expect(document.getElementById(HASH.slice(1))).toBeNull();
	});

	it("clears stale highlights and ignores non-pasuk hashes", () => {
		mountArticle("", [], [], true);
		setHash("#other");
		render(<ScrollToUnitPasuk />);
		expect(document.getElementById("stale")).not.toHaveAttribute(
			"data-pasuk-highlight",
		);
		expect(document.getElementById("stale")).not.toHaveAttribute(
			"aria-current",
		);
	});

	it("re-selects the pasuk on hashchange", () => {
		mountArticle("", [HASH.slice(1)]);
		setHash("");
		render(<ScrollToUnitPasuk />);
		const verse = document.getElementById(HASH.slice(1)) as HTMLElement;
		expect(verse).not.toHaveAttribute("data-pasuk-highlight");
		setHash(HASH);
		window.dispatchEvent(new Event("hashchange"));
		expect(verse).toHaveAttribute("data-pasuk-highlight");
	});

	it("re-selects the pasuk on popstate", () => {
		mountArticle("", [HASH.slice(1)]);
		setHash("");
		render(<ScrollToUnitPasuk />);
		setHash(HASH);
		window.dispatchEvent(new Event("popstate"));
		expect(document.getElementById(HASH.slice(1))).toHaveAttribute(
			"data-pasuk-highlight",
		);
	});

	it("removes listeners and cancels the pending frame on unmount", () => {
		mountArticle("", [HASH.slice(1)]);
		setHash(HASH);
		const cancelSpy = jest.fn();
		window.cancelAnimationFrame = cancelSpy;
		const { unmount } = render(<ScrollToUnitPasuk />);
		unmount();
		expect(cancelSpy).toHaveBeenCalled();
		// After unmount the listeners are gone, so no highlight is re-applied.
		const verse = document.getElementById(HASH.slice(1)) as HTMLElement;
		verse.removeAttribute("data-pasuk-highlight");
		window.dispatchEvent(new Event("hashchange"));
		expect(verse).not.toHaveAttribute("data-pasuk-highlight");
	});
});
