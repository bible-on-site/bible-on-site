/** @jest-environment jsdom */
import {
	ANALYTICS_CONSENT_EVENT,
	ANALYTICS_CONSENT_KEY,
	ANALYTICS_NOTICE_KEY,
	clearAnalyticsConsent,
	getAnalyticsConsent,
	getAnalyticsConsentServerSnapshot,
	getAnalyticsStatus,
	getAnalyticsStatusServerSnapshot,
	markAnalyticsNoticeSeen,
	setAnalyticsConsent,
	subscribeAnalyticsConsent,
} from "@/lib/analytics-consent";

beforeEach(() => {
	localStorage.clear();
	clearAnalyticsConsent();
});
afterEach(() => {
	jest.restoreAllMocks();
	clearAnalyticsConsent();
});

describe("analytics-consent", () => {
	it("uses a fresh preference key and waits for the entry disclosure", () => {
		expect(ANALYTICS_CONSENT_KEY).toBe("analyticsPreference");
		expect(getAnalyticsConsent()).toBeNull();
		expect(getAnalyticsStatus()).toBe("pending");
	});

	it.each(["granted", "denied"])(
		"ignores the retired %s answer",
		(oldChoice) => {
			localStorage.setItem("analyticsConsent", oldChoice);
			expect(getAnalyticsConsent()).toBeNull();
			expect(getAnalyticsStatus()).toBe("pending");
		},
	);

	it("records continued use separately without recording an explicit grant", () => {
		const heard = jest.fn();
		const unsubscribe = subscribeAnalyticsConsent(heard);
		markAnalyticsNoticeSeen();
		expect(localStorage.getItem(ANALYTICS_NOTICE_KEY)).not.toBeNull();
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
		expect(getAnalyticsConsent()).toBeNull();
		expect(getAnalyticsStatus()).toBe("enabled");
		expect(heard).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it("waits again for an outdated or malformed disclosure version", () => {
		localStorage.setItem(ANALYTICS_NOTICE_KEY, "old-version");
		expect(getAnalyticsStatus()).toBe("pending");
	});

	it("round-trips the direct enable and opt-out preferences", () => {
		setAnalyticsConsent("granted");
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
		expect(getAnalyticsConsent()).toBe("granted");
		expect(getAnalyticsStatus()).toBe("enabled");
		setAnalyticsConsent("denied");
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
		expect(getAnalyticsConsent()).toBe("denied");
		expect(getAnalyticsStatus()).toBe("disabled");
	});

	it("keeps a current opt-out even after the entry disclosure was seen", () => {
		markAnalyticsNoticeSeen();
		localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
		expect(getAnalyticsStatus()).toBe("disabled");
	});

	it.each(["yes", "1", "true", "{oops", ""])(
		"does not enable from malformed preference %s",
		(raw) => {
			localStorage.setItem(ANALYTICS_CONSENT_KEY, raw);
			expect(getAnalyticsConsent()).toBeNull();
			expect(getAnalyticsStatus()).toBe("pending");
		},
	);

	it("clears an explicit preference and notifies listeners", () => {
		setAnalyticsConsent("denied");
		const heard = jest.fn();
		window.addEventListener(ANALYTICS_CONSENT_EVENT, heard, { once: true });
		clearAnalyticsConsent();
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
		expect(getAnalyticsConsent()).toBeNull();
		expect(getAnalyticsStatus()).toBe("pending");
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it("keeps measurement pending when storage cannot be read", () => {
		jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("storage denied");
		});
		expect(getAnalyticsConsent()).toBeNull();
		expect(getAnalyticsStatus()).toBe("pending");
	});

	it("dismisses the disclosure for this session when storage writes fail", () => {
		jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("quota exceeded");
		});
		expect(() => markAnalyticsNoticeSeen()).not.toThrow();
		expect(getAnalyticsStatus()).toBe("enabled");
		expect(getAnalyticsConsent()).toBeNull();
	});

	it("honors a session opt-out when storage writes fail", () => {
		setAnalyticsConsent("granted");
		const setSpy = jest
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("quota exceeded");
			});
		setAnalyticsConsent("denied");
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
		expect(getAnalyticsStatus()).toBe("disabled");
		setAnalyticsConsent("granted");
		expect(getAnalyticsStatus()).toBe("enabled");
		setSpy.mockRestore();
		setAnalyticsConsent("denied");
		expect(getAnalyticsStatus()).toBe("disabled");
	});

	it("clears the session preference even when storage removal fails", () => {
		setAnalyticsConsent("denied");
		const removeSpy = jest
			.spyOn(Storage.prototype, "removeItem")
			.mockImplementation(() => {
				throw new Error("storage denied");
			});
		expect(() => clearAnalyticsConsent()).not.toThrow();
		expect(getAnalyticsConsent()).toBeNull();
		expect(getAnalyticsStatus()).toBe("pending");
		removeSpy.mockRestore();
		clearAnalyticsConsent();
	});

	it("notifies on preferences, disclosure updates and cross-tab clearing, and unsubscribes", () => {
		const seen: string[] = [];
		const unsubscribe = subscribeAnalyticsConsent(() =>
			seen.push(getAnalyticsStatus()),
		);
		setAnalyticsConsent("granted");
		expect(seen).toEqual(["enabled"]);
		localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
		window.dispatchEvent(new StorageEvent("storage", { key: "otherPref" }));
		expect(seen).toEqual(["enabled"]);
		window.dispatchEvent(
			new StorageEvent("storage", { key: ANALYTICS_CONSENT_KEY }),
		);
		window.dispatchEvent(
			new StorageEvent("storage", { key: ANALYTICS_NOTICE_KEY }),
		);
		localStorage.clear();
		window.dispatchEvent(new StorageEvent("storage", { key: null }));
		expect(seen).toEqual(["enabled", "disabled", "disabled", "pending"]);
		unsubscribe();
		setAnalyticsConsent("granted");
		window.dispatchEvent(
			new StorageEvent("storage", { key: ANALYTICS_CONSENT_KEY }),
		);
		expect(seen).toHaveLength(4);
	});

	it("keeps initial server rendering pending irrespective of a saved client preference", () => {
		setAnalyticsConsent("granted");
		expect(getAnalyticsStatusServerSnapshot()).toBe("pending");
		expect(getAnalyticsConsentServerSnapshot()).toBe("unset");
	});
});

it("dismisses for this session even when browser storage refuses writes", () => {
	const write = jest
		.spyOn(Storage.prototype, "setItem")
		.mockImplementation(() => {
			throw new Error("storage unavailable");
		});
	markAnalyticsNoticeSeen();
	expect(getAnalyticsStatus()).toBe("enabled");
	expect(getAnalyticsConsent()).toBeNull();
	setAnalyticsConsent("denied");
	expect(getAnalyticsStatus()).toBe("disabled");
	write.mockRestore();
	clearAnalyticsConsent();
	markAnalyticsNoticeSeen();
});
