/** @jest-environment-options {"runScripts": "dangerously"} */
import {
	A11Y_CONTRAST_HIGH,
	A11Y_LINKS_UNDERLINED,
	applySiteA11ySettings,
	DEFAULT_SITE_A11Y_SETTINGS,
	getStoredSiteA11ySettings,
	SITE_A11Y_BOOTSTRAP,
	SITE_A11Y_EVENT,
	SITE_A11Y_STORAGE_KEY,
	SITE_A11Y_VERSION,
	setStoredSiteA11ySettings,
} from "../../../src/lib/site-a11y-settings";

// Executes the real bootstrap the same way the browser does: as a <script>
// element. Requires runScripts: "dangerously" (pragma at top of file).
function runBootstrap() {
	const script = document.createElement("script");
	script.textContent = SITE_A11Y_BOOTSTRAP;
	document.body.appendChild(script);
	document.body.removeChild(script);
}

describe("site-a11y-settings", () => {
	beforeEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.a11yContrast;
		delete document.documentElement.dataset.a11yLinks;
	});

	afterEach(() => jest.restoreAllMocks());

	it("returns defaults when nothing is stored", () => {
		expect(getStoredSiteA11ySettings()).toEqual(DEFAULT_SITE_A11Y_SETTINGS);
	});

	it("roundtrips both preferences through localStorage", () => {
		setStoredSiteA11ySettings({ contrast: true, links: true });
		expect(getStoredSiteA11ySettings()).toEqual({
			contrast: true,
			links: true,
			v: SITE_A11Y_VERSION,
		});
	});

	it.each([{ contrast: true }, { links: true }, {}])(
		"normalizes partial writes to the full schema (%j)",
		(patch) => {
			setStoredSiteA11ySettings(patch);
			expect(getStoredSiteA11ySettings()).toEqual({
				contrast: patch.contrast === true,
				links: patch.links === true,
				v: SITE_A11Y_VERSION,
			});
		},
	);

	it("returns defaults on malformed stored JSON", () => {
		localStorage.setItem(SITE_A11Y_STORAGE_KEY, "not-json{");
		expect(getStoredSiteA11ySettings()).toEqual(DEFAULT_SITE_A11Y_SETTINGS);
	});

	it.each([1, "yes", [true], { contrast: 1, links: "on" }, null])(
		"treats non-boolean stored fields as disabled (%j)",
		(value) => {
			localStorage.setItem(
				SITE_A11Y_STORAGE_KEY,
				JSON.stringify({ contrast: value, links: value }),
			);
			expect(getStoredSiteA11ySettings()).toEqual(DEFAULT_SITE_A11Y_SETTINGS);
		},
	);

	it("falls back safely when storage cannot be read or written", () => {
		jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new DOMException("Access denied", "SecurityError");
		});
		jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("Quota exceeded", "QuotaExceededError");
		});
		expect(getStoredSiteA11ySettings()).toEqual(DEFAULT_SITE_A11Y_SETTINGS);
		expect(() =>
			setStoredSiteA11ySettings({ contrast: true }),
		).not.toThrow();
	});

	it("broadcasts the same-tab change event with the normalized detail", () => {
		const events: CustomEvent[] = [];
		const listener = (e: Event) => events.push(e as CustomEvent);
		window.addEventListener(SITE_A11Y_EVENT, listener);
		setStoredSiteA11ySettings({ links: true });
		expect(events).toHaveLength(1);
		expect(events[0].detail).toEqual({
			contrast: false,
			links: true,
			v: SITE_A11Y_VERSION,
		});
		window.removeEventListener(SITE_A11Y_EVENT, listener);
	});

	it("applies attributes only when enabled — default CSS owns the baseline", () => {
		applySiteA11ySettings({ contrast: true, links: true });
		expect(document.documentElement.dataset.a11yContrast).toBe(
			A11Y_CONTRAST_HIGH,
		);
		expect(document.documentElement.dataset.a11yLinks).toBe(
			A11Y_LINKS_UNDERLINED,
		);
		applySiteA11ySettings({ contrast: false, links: true });
		expect(document.documentElement.dataset.a11yContrast).toBeUndefined();
		expect(document.documentElement.dataset.a11yLinks).toBe(
			A11Y_LINKS_UNDERLINED,
		);
		applySiteA11ySettings(DEFAULT_SITE_A11Y_SETTINGS);
		expect(document.documentElement.dataset.a11yLinks).toBeUndefined();
	});

	it("bootstrap literal stays in sync with the exported constants", () => {
		expect(SITE_A11Y_BOOTSTRAP).toContain(
			JSON.stringify(SITE_A11Y_STORAGE_KEY),
		);
		expect(SITE_A11Y_BOOTSTRAP).toContain(JSON.stringify(A11Y_CONTRAST_HIGH));
		expect(SITE_A11Y_BOOTSTRAP).toContain(
			JSON.stringify(A11Y_LINKS_UNDERLINED),
		);
		expect(SITE_A11Y_BOOTSTRAP).toContain("a11yContrast");
		expect(SITE_A11Y_BOOTSTRAP).toContain("a11yLinks");
	});

	it("bootstrap applies stored preferences to <html> before paint", () => {
		localStorage.setItem(
			SITE_A11Y_STORAGE_KEY,
			JSON.stringify({ contrast: true, links: false }),
		);
		runBootstrap();
		expect(document.documentElement.dataset.a11yContrast).toBe("high");
		expect(document.documentElement.dataset.a11yLinks).toBeUndefined();
	});

	it("bootstrap clears attributes when the stored payload disables them", () => {
		document.documentElement.dataset.a11yContrast = "high";
		document.documentElement.dataset.a11yLinks = "underlined";
		localStorage.setItem(
			SITE_A11Y_STORAGE_KEY,
			JSON.stringify({ contrast: false, links: false }),
		);
		runBootstrap();
		expect(document.documentElement.dataset.a11yContrast).toBeUndefined();
		expect(document.documentElement.dataset.a11yLinks).toBeUndefined();
	});

	it("bootstrap tolerates broken storage and leaves defaults", () => {
		localStorage.setItem(SITE_A11Y_STORAGE_KEY, "{broken");
		expect(() => runBootstrap()).not.toThrow();
		expect(document.documentElement.dataset.a11yContrast).toBeUndefined();
		expect(document.documentElement.dataset.a11yLinks).toBeUndefined();
	});

	it("bootstrap and hydrated settings agree for every stored shape", () => {
		for (const stored of [
			{ contrast: true, links: true },
			{ contrast: true },
			{ links: true },
			{ contrast: "yes", links: 1 },
			"garbage",
		]) {
			localStorage.setItem(SITE_A11Y_STORAGE_KEY, JSON.stringify(stored));
			delete document.documentElement.dataset.a11yContrast;
			delete document.documentElement.dataset.a11yLinks;
			runBootstrap();
			const before = document.documentElement.outerHTML;
			applySiteA11ySettings(getStoredSiteA11ySettings());
			expect(document.documentElement.outerHTML).toBe(before);
		}
	});
});
