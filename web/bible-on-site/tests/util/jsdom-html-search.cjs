const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/**
 * HTML search uses HTMLElement, but jsdom still creates HTMLUnknownElement.
 * Correct only DOM creation in the test realm; this is not a parser polyfill.
 * https://html.spec.whatwg.org/multipage/grouping-content.html#the-search-element
 */
function installHtmlSearchElementSupport(realm) {
	const { document, HTMLElement, HTMLUnknownElement } = realm;
	if (!document || !HTMLElement || !HTMLUnknownElement) return false;
	const createElement = document.createElement;
	if (!(createElement.call(document, "search") instanceof HTMLUnknownElement)) {
		return false;
	}
	document.createElement = function (...args) {
		const element = Reflect.apply(createElement, this, args);
		if (
			element.namespaceURI === HTML_NAMESPACE &&
			element.localName === "search" &&
			element instanceof HTMLUnknownElement
		) {
			Object.setPrototypeOf(element, HTMLElement.prototype);
		}
		return element;
	};
	return true;
}

module.exports = { installHtmlSearchElementSupport };
