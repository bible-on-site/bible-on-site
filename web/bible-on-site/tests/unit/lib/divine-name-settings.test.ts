/** @jest-environment jsdom */
import {
	DEFAULT_DIVINE_NAME_MASKING,
	maskDivineNameValue,
} from "@/lib/divine-name-masking";
import {
	DIVINE_NAME_MASKING_EVENT,
	DIVINE_NAME_MASKING_KEY,
	getDivineNameMaskingSettings,
	getDivineNameMaskingSnapshot,
	normalizeDivineNameMasking,
	saveDivineNameMaskingSettings,
	subscribeDivineNameMasking,
} from "@/lib/divine-name-settings";

beforeEach(() => {
	localStorage.clear();
	// The settings module keeps a snapshot cache for useSyncExternalStore;
	// resetting through the public save API clears it between tests.
	saveDivineNameMaskingSettings(DEFAULT_DIVINE_NAME_MASKING);
});

describe("normalizeDivineNameMasking", () => {
	it("falls back to defaults for garbage input", () => {
		for (const raw of [null, undefined, 5, "x", []])
			expect(normalizeDivineNameMasking(raw)).toEqual(
				DEFAULT_DIVINE_NAME_MASKING,
			);
	});
	it("rejects option values outside each name's allowed set", () => {
		const normalized = normalizeDivineNameMasking({
			enabled: true,
			elohim: "heh", // a יהוה-only option
			yhwh: "asis", // יהוה has no as-is option
			el: "custom", // אל has no custom option
			shaddai: "elokim",
		});
		expect(normalized).toEqual({
			...DEFAULT_DIVINE_NAME_MASKING,
			enabled: true,
		});
	});
	it("keeps valid choices and trims custom text", () =>
		expect(
			normalizeDivineNameMasking({
				enabled: true,
				elohim: "elokim",
				yhwh: "dalet",
				el: "hyphen",
				shaddai: "custom",
				shaddaiCustom: "  פלוני  ",
			}),
		).toEqual({
			enabled: true,
			elohim: "elokim",
			elohimCustom: "",
			yhwh: "dalet",
			yhwhCustom: "",
			el: "hyphen",
			shaddai: "custom",
			shaddaiCustom: "פלוני",
		}));
	it("caps overlong custom text", () =>
		expect(
			normalizeDivineNameMasking({ yhwhCustom: "א".repeat(200) }).yhwhCustom,
		).toHaveLength(40));
	it("falls back to the default for a non-boolean enabled flag", () =>
		expect(normalizeDivineNameMasking({ enabled: "yes" }).enabled).toBe(true));
});

describe("fresh-install defaults (#2404)", () => {
	it("defaults to enabled masking with אל -> א-ל when nothing was stored", () => {
		expect(DEFAULT_DIVINE_NAME_MASKING).toEqual(
			expect.objectContaining({ enabled: true, el: "hyphen" }),
		);
		localStorage.clear();
		expect(getDivineNameMaskingSettings()).toEqual(
			DEFAULT_DIVINE_NAME_MASKING,
		);
	});
	it("masks אֵל as א-ל on the first read with no stored settings", () => {
		localStorage.clear();
		expect(
			maskDivineNameValue("אֵ֑ל", getDivineNameMaskingSettings()),
		).toBe("א-ל");
	});
	it("keeps a stored disabled toggle and an explicit אל כמות שהוא choice", () => {
		localStorage.setItem(
			DIVINE_NAME_MASKING_KEY,
			JSON.stringify({ enabled: false, el: "asis" }),
		);
		expect(getDivineNameMaskingSettings()).toEqual(
			expect.objectContaining({ enabled: false, el: "asis" }),
		);
	});
	it("does not confuse a stored false with a missing value for the other defaults", () => {
		localStorage.setItem(
			DIVINE_NAME_MASKING_KEY,
			JSON.stringify({ enabled: false }),
		);
		const s = getDivineNameMaskingSettings();
		expect(s.enabled).toBe(false);
		expect(s.el).toBe("hyphen");
	});
});

describe("persistence and change notifications", () => {
	it("round-trips settings through localStorage", () => {
		const settings = normalizeDivineNameMasking({
			enabled: true,
			yhwh: "dalet",
			elohim: "custom",
			elohimCustom: 'הקב"ה',
		});
		saveDivineNameMaskingSettings(settings);
		expect(
			JSON.parse(localStorage.getItem(DIVINE_NAME_MASKING_KEY) ?? "null"),
		).toEqual(settings);
		expect(getDivineNameMaskingSettings()).toEqual(settings);
	});
	it("falls back to defaults when stored JSON is malformed", () => {
		localStorage.setItem(DIVINE_NAME_MASKING_KEY, "{oops");
		expect(getDivineNameMaskingSettings()).toEqual(DEFAULT_DIVINE_NAME_MASKING);
	});
	it("dispatches a change event whose detail carries the settings", () => {
		const seen: string[] = [];
		const unsubscribe = subscribeDivineNameMasking(() =>
			seen.push(getDivineNameMaskingSnapshot().yhwh),
		);
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: true, yhwh: "dalet" }),
		);
		expect(seen).toEqual(["dalet"]);
		unsubscribe();
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: true, yhwh: "heh" }),
		);
		expect(seen).toEqual(["dalet"]);
	});
	it("re-reads localStorage on cross-tab storage events", () => {
		subscribeDivineNameMasking(() => {});
		expect(getDivineNameMaskingSnapshot().enabled).toBe(true);
		localStorage.setItem(
			DIVINE_NAME_MASKING_KEY,
			JSON.stringify({ enabled: true, yhwh: "dalet" }),
		);
		// Events for other keys are ignored; only our key re-reads.
		window.dispatchEvent(new StorageEvent("storage", { key: "otherPref" }));
		expect(getDivineNameMaskingSnapshot().yhwh).toBe("heh");
		window.dispatchEvent(
			new StorageEvent("storage", { key: DIVINE_NAME_MASKING_KEY }),
		);
		expect(getDivineNameMaskingSnapshot().yhwh).toBe("dalet");
	});
	it("keeps the snapshot object stable between changes", () => {
		const first = getDivineNameMaskingSnapshot();
		expect(getDivineNameMaskingSnapshot()).toBe(first);
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: true }),
		);
		expect(getDivineNameMaskingSnapshot()).not.toBe(first);
	});
	it("feeds masked rendering end-to-end", () => {
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: true, elohim: "elokim" }),
		);
		expect(
			maskDivineNameValue("אֱלֹהִ֑ים", getDivineNameMaskingSnapshot()),
		).toBe("אלקים");
	});
	it("emits the saved payload on the documented event", () =>
		new Promise<void>((resolve) => {
			window.addEventListener(
				DIVINE_NAME_MASKING_EVENT,
				(event) => {
					expect((event as CustomEvent).detail.enabled).toBe(true);
					resolve();
				},
				{ once: true },
			);
			saveDivineNameMaskingSettings(
				normalizeDivineNameMasking({ enabled: true }),
			);
		}));
});
