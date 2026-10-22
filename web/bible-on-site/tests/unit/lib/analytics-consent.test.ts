/** @jest-environment jsdom */
import {
	ANALYTICS_CONSENT_EVENT,
	ANALYTICS_CONSENT_KEY,
	clearAnalyticsConsent,
	getAnalyticsConsent,
	getAnalyticsConsentServerSnapshot,
	setAnalyticsConsent,
	subscribeAnalyticsConsent,
} from "@/lib/analytics-consent";

beforeEach(() => {
	localStorage.clear();
});

describe("analytics-consent", () => {
	it("returns null before the user decides", () => {
		expect(getAnalyticsConsent()).toBeNull();
	});

	it("round-trips granted and denied through localStorage", () => {
		setAnalyticsConsent("granted");
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
		expect(getAnalyticsConsent()).toBe("granted");
		setAnalyticsConsent("denied");
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
		expect(getAnalyticsConsent()).toBe("denied");
	});

	it("treats malformed stored values as undecided", () => {
		for (const raw of ["yes", "1", "true", "{oops", ""]) {
			localStorage.setItem(ANALYTICS_CONSENT_KEY, raw);
			expect(getAnalyticsConsent()).toBeNull();
		}
	});

	it("keeps a prior denial on the next visit", () => {
		localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
		expect(getAnalyticsConsent()).toBe("denied");
	});

	it("clearAnalyticsConsent forgets the answer and notifies subscribers", () => {
		setAnalyticsConsent("denied");
		const heard = jest.fn();
		window.addEventListener(ANALYTICS_CONSENT_EVENT, heard, { once: true });
		clearAnalyticsConsent();
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
		expect(getAnalyticsConsent()).toBeNull();
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it("tolerates localStorage read and write failures", () => {
		const getSpy = jest
			.spyOn(Storage.prototype, "getItem")
			.mockImplementation(() => {
				throw new Error("storage denied");
			});
		expect(getAnalyticsConsent()).toBeNull();
		getSpy.mockRestore();

		const setSpy = jest
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("quota exceeded");
			});
		expect(() => setAnalyticsConsent("granted")).not.toThrow();
		setSpy.mockRestore();

		const removeSpy = jest
			.spyOn(Storage.prototype, "removeItem")
			.mockImplementation(() => {
				throw new Error("quota exceeded");
			});
		expect(() => clearAnalyticsConsent()).not.toThrow();
		removeSpy.mockRestore();
	});

	it("dispatches the change event on save", () =>
		new Promise<void>((resolve) => {
			window.addEventListener(ANALYTICS_CONSENT_EVENT, () => resolve(), {
				once: true,
			});
			setAnalyticsConsent("granted");
		}));

	it("notifies subscribers on save and on cross-tab storage events", () => {
		const seen: (string | null)[] = [];
		const unsubscribe = subscribeAnalyticsConsent(() =>
			seen.push(getAnalyticsConsent()),
		);
		setAnalyticsConsent("granted");
		expect(seen).toEqual(["granted"]);
		// Events for unrelated keys do not re-read our key.
		localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
		window.dispatchEvent(new StorageEvent("storage", { key: "otherPref" }));
		expect(seen).toEqual(["granted"]);
		window.dispatchEvent(
			new StorageEvent("storage", { key: ANALYTICS_CONSENT_KEY }),
		);
		expect(seen).toEqual(["granted", "denied"]);
		unsubscribe();
		setAnalyticsConsent("granted");
		expect(seen).toEqual(["granted", "denied"]);
	});

	it("returns a hidden sentinel from the server snapshot so SSR emits nothing", () => {
		expect(getAnalyticsConsentServerSnapshot()).not.toBeNull();
		expect(getAnalyticsConsentServerSnapshot()).not.toBe("granted");
	});
});
