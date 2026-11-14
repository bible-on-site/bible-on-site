import {
	DEFAULT_RECITATION_SETTINGS,
	getRecitationSettings,
	normalizeRecitationSettings,
	RECITATION_SETTINGS_EVENT,
	RECITATION_SETTINGS_KEY,
	saveRecitationSettings,
} from "@/lib/recitation-settings";

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());
test("defaults preserve original pauses and malformed/old settings migrate safely", () => {
	expect(getRecitationSettings()).toEqual(DEFAULT_RECITATION_SETTINGS);
	localStorage.setItem(RECITATION_SETTINGS_KEY, "bad JSON");
	expect(getRecitationSettings()).toEqual(DEFAULT_RECITATION_SETTINGS);
	expect(normalizeRecitationSettings({ speed: 1.5 })).toEqual({
		speed: 1.5,
		volume: 1,
		versePauseMs: null,
	});
	expect(
		normalizeRecitationSettings({
			speed: NaN,
			volume: Infinity,
			versePauseMs: NaN,
		}),
	).toEqual({ speed: 1, volume: 1, versePauseMs: 0 });
	expect(
		normalizeRecitationSettings({ speed: -1, volume: 2, versePauseMs: 99999 }),
	).toEqual({ speed: 0.5, volume: 1, versePauseMs: 5000 });
});
test("a muted volume and zero pause roundtrip and notify mounted players", () => {
	const changed = jest.fn();
	window.addEventListener(RECITATION_SETTINGS_EVENT, changed);
	saveRecitationSettings({ speed: 2, volume: 0, versePauseMs: 0 });
	expect(getRecitationSettings()).toEqual({
		speed: 2,
		volume: 0,
		versePauseMs: 0,
	});
	expect(changed.mock.calls[0][0].detail).toEqual(getRecitationSettings());
	window.removeEventListener(RECITATION_SETTINGS_EVENT, changed);
});
test("private-mode storage still allows current-session settings", () => {
	jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
		throw new Error("blocked");
	});
	expect(getRecitationSettings()).toEqual(DEFAULT_RECITATION_SETTINGS);
	jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new Error("blocked");
	});
	expect(() =>
		saveRecitationSettings(DEFAULT_RECITATION_SETTINGS),
	).not.toThrow();
});
