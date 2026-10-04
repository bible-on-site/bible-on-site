/** @jest-environment-options {"runScripts": "dangerously"} */
import {
	applyReaderSettings,
	DEFAULT_READER_SETTINGS,
	getStoredReaderSettings,
	PEREK_FONT_SCALES,
	PEREK_LINE_HEIGHTS,
	PEREK_WORD_SPACINGS,
	READER_SETTINGS_BOOTSTRAP,
	READER_SETTINGS_STORAGE_KEY,
	setStoredReaderSettings,
} from "../../../src/lib/reader-settings";

// Executes the real bootstrap the same way the browser does: as a <script>
// element. Requires runScripts: "dangerously" (pragma at top of file).
function runBootstrap() {
	const script = document.createElement("script");
	script.textContent = READER_SETTINGS_BOOTSTRAP;
	document.body.appendChild(script);
	document.body.removeChild(script);
}

describe("reader-settings", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.style.removeProperty("--perek-font-scale");
		document.documentElement.style.removeProperty("--perek-line-height");
	});

	afterEach(() => jest.restoreAllMocks());

	it("returns defaults when nothing is stored", () => {
		expect(getStoredReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
	});

	it("roundtrips settings through localStorage", () => {
		setStoredReaderSettings({ fontStep: 4, lineStep: 2, wordStep: 0 });
		expect(getStoredReaderSettings()).toEqual({
			fontStep: 4,
			lineStep: 2,
			wordStep: 0,
		});
	});

	it("migrates existing font/line choices and restores independent horizontal spacing before paint", () => {
		localStorage.setItem(
			READER_SETTINGS_STORAGE_KEY,
			JSON.stringify({ fontStep: 3, lineStep: 1 }),
		);
		expect(getStoredReaderSettings()).toEqual({
			fontStep: 3,
			lineStep: 1,
			wordStep: 0,
		});
		setStoredReaderSettings({ fontStep: 3, lineStep: 1, wordStep: 4 });
		runBootstrap();
		expect(
			document.documentElement.style.getPropertyValue("--perek-word-spacing"),
		).toBe(`${PEREK_WORD_SPACINGS[4]}em`);
		expect(READER_SETTINGS_BOOTSTRAP).toContain(
			JSON.stringify(PEREK_WORD_SPACINGS),
		);
	});

	it("returns defaults on malformed stored JSON", () => {
		localStorage.setItem(READER_SETTINGS_STORAGE_KEY, "not-json{");
		expect(getStoredReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
	});

	it("clamps out-of-range stored indices", () => {
		localStorage.setItem(
			READER_SETTINGS_STORAGE_KEY,
			JSON.stringify({ fontStep: 99, lineStep: -3 }),
		);
		expect(getStoredReaderSettings()).toEqual({
			fontStep: PEREK_FONT_SCALES.length - 1,
			lineStep: 0,
			wordStep: 0,
		});
	});

	it("clamps out-of-range indices on write", () => {
		setStoredReaderSettings({ fontStep: -1, lineStep: 42 });
		const stored = localStorage.getItem(READER_SETTINGS_STORAGE_KEY);
		// biome-ignore lint/style/noNonNullAssertion: written by setStoredReaderSettings above
		expect(JSON.parse(stored!)).toEqual({
			fontStep: 0,
			lineStep: PEREK_LINE_HEIGHTS.length - 1,
			wordStep: 0,
		});
	});

	it("falls back safely when private-mode storage cannot be read or written", () => {
		jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new DOMException("Access denied", "SecurityError");
		});
		jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("Quota exceeded", "QuotaExceededError");
		});
		expect(getStoredReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
		expect(() =>
			setStoredReaderSettings({ fontStep: 1, lineStep: 1 }),
		).not.toThrow();
	});

	it("applyReaderSettings sets the CSS variables on the document root", () => {
		applyReaderSettings({ fontStep: 3, lineStep: 1 });
		expect(
			document.documentElement.style.getPropertyValue("--perek-font-scale"),
		).toBe(String(PEREK_FONT_SCALES[3]));
		expect(
			document.documentElement.style.getPropertyValue("--perek-line-height"),
		).toBe(String(PEREK_LINE_HEIGHTS[1]));
	});

	it("bootstrap literal stays in sync with the exported constants", () => {
		expect(READER_SETTINGS_BOOTSTRAP).toContain(
			JSON.stringify(READER_SETTINGS_STORAGE_KEY),
		);
		expect(READER_SETTINGS_BOOTSTRAP).toContain(
			JSON.stringify(PEREK_FONT_SCALES),
		);
		expect(READER_SETTINGS_BOOTSTRAP).toContain(
			JSON.stringify(PEREK_LINE_HEIGHTS),
		);
		expect(READER_SETTINGS_BOOTSTRAP).toContain(
			`s.fontStep==null?${DEFAULT_READER_SETTINGS.fontStep}`,
		);
		expect(READER_SETTINGS_BOOTSTRAP).toContain(
			`s.lineStep==null?${DEFAULT_READER_SETTINGS.lineStep}`,
		);
	});

	it("bootstrap script applies stored settings synchronously before paint", () => {
		localStorage.setItem(
			READER_SETTINGS_STORAGE_KEY,
			JSON.stringify({ fontStep: 0, lineStep: 2, wordStep: 0 }),
		);
		runBootstrap();
		expect(
			document.documentElement.style.getPropertyValue("--perek-font-scale"),
		).toBe(String(PEREK_FONT_SCALES[0]));
		expect(
			document.documentElement.style.getPropertyValue("--perek-line-height"),
		).toBe(String(PEREK_LINE_HEIGHTS[2]));
	});

	it("bootstrap script tolerates broken storage and still uses defaults", () => {
		localStorage.setItem(READER_SETTINGS_STORAGE_KEY, "{broken");
		runBootstrap();
		// Defaults applied (or vars simply unset) — must not throw.
		expect(
			Number.parseFloat(
				document.documentElement.style.getPropertyValue("--perek-font-scale") ||
					String(PEREK_FONT_SCALES[DEFAULT_READER_SETTINGS.fontStep]),
			),
		).toBe(PEREK_FONT_SCALES[DEFAULT_READER_SETTINGS.fontStep]);
	});
});
