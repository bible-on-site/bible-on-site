/** @jest-environment jsdom */
test("the shared test environment creates HTML search with its standard interface", () => {
	const search = document.createElement("search");
	expect(Object.getPrototypeOf(search) === HTMLElement.prototype).toBe(true);
	expect(search).not.toBeInstanceOf(HTMLUnknownElement);
});

const {
	installHtmlSearchElementSupport,
} = require("../util/jsdom-html-search.cjs");

// Isolated real documents model both the current gap and future native support.
function creationRealm(searchSupported: boolean) {
	const fixtureDocument = document.implementation.createHTMLDocument();
	const createElement = fixtureDocument.createElement;
	Object.defineProperty(fixtureDocument, "createElement", {
		configurable: true,
		writable: true,
		value(this: Document, ...args: Parameters<Document["createElement"]>) {
			const element = Reflect.apply(createElement, this, args) as HTMLElement;
			if (
				element.namespaceURI === "http://www.w3.org/1999/xhtml" &&
				element.localName === "search"
			) {
				Object.setPrototypeOf(
					element,
					(searchSupported ? HTMLElement : HTMLUnknownElement).prototype,
				);
			}
			return element;
		},
	});
	return { document: fixtureDocument, HTMLElement, HTMLUnknownElement };
}

test("corrects HTML search creation while preserving its semantic tag and GET form", () => {
	const realm = creationRealm(false);
	expect(realm.document.createElement("search")).toBeInstanceOf(
		HTMLUnknownElement,
	);
	expect(installHtmlSearchElementSupport(realm)).toBe(true);
	const search = realm.document.createElement("SEARCH");
	search.setAttribute("aria-label", "Site search");
	const form = realm.document.createElement("form");
	form.setAttribute("action", "/search");
	form.setAttribute("method", "get");
	const input = realm.document.createElement("input");
	input.name = "q";
	input.type = "search";
	input.value = "test query";
	form.append(input);
	search.append(form);
	realm.document.body.append(search);

	expect(Object.getPrototypeOf(search) === HTMLElement.prototype).toBe(true);
	expect(search).not.toBeInstanceOf(HTMLUnknownElement);
	expect(search.localName).toBe("search");
	expect(search.tagName).toBe("SEARCH");
	expect(search.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
	expect(realm.document.body.querySelector("search")).toBe(search);
	expect(search.getAttribute("aria-label")).toBe("Site search");
	expect(form.getAttribute("action")).toBe("/search");
	expect(form.getAttribute("method")).toBe("get");
	expect(new FormData(form).get("q")).toBe("test query");
});

test("leaves unknown HTML, standard elements, and SVG creation unchanged", () => {
	const realm = creationRealm(false);
	const createElementNS = realm.document.createElementNS;
	installHtmlSearchElementSupport(realm);
	expect(realm.document.createElement("unknownhtmltag")).toBeInstanceOf(
		HTMLUnknownElement,
	);
	expect(realm.document.createElement("input")).toBeInstanceOf(
		HTMLInputElement,
	);
	expect(realm.document.createElementNS).toBe(createElementNS);
	const svg = realm.document.createElementNS(
		"http://www.w3.org/2000/svg",
		"search",
	);
	expect(svg).toBeInstanceOf(SVGElement);
	expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
	expect(svg.localName).toBe("search");
});

test("preserves the native receiver and validation for other documents", () => {
	const realm = creationRealm(false);
	installHtmlSearchElementSupport(realm);
	const xml = document.implementation.createDocument(null, "root");
	const foreign = realm.document.createElement.call(xml, "search");
	expect(foreign.ownerDocument).toBe(xml);
	expect(foreign.namespaceURI).toBeNull();
	expect(foreign).not.toBeInstanceOf(HTMLElement);
	expect(() => realm.document.createElement("invalid tag name")).toThrow();
});

test("does not wrap a modern supported implementation or wrap a shim twice", () => {
	const supported = creationRealm(true);
	const nativeCreate = supported.document.createElement;
	expect(installHtmlSearchElementSupport(supported)).toBe(false);
	expect(supported.document.createElement).toBe(nativeCreate);
	const legacy = creationRealm(false);
	installHtmlSearchElementSupport(legacy);
	const installedCreate = legacy.document.createElement;
	expect(installHtmlSearchElementSupport(legacy)).toBe(false);
	expect(legacy.document.createElement).toBe(installedCreate);
});

test("does not install in a Node environment without DOM constructors", () => {
	expect(installHtmlSearchElementSupport({})).toBe(false);
	expect(installHtmlSearchElementSupport({ document })).toBe(false);
});
