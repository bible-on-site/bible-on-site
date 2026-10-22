/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

jest.mock("@/util/environment", () => ({ isProduction: jest.fn() }));

import {
	ANALYTICS_CONSENT_KEY,
	ANALYTICS_NOTICE_KEY,
	getAnalyticsStatus,
	markAnalyticsNoticeSeen,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import { AnalyticsConsentBanner } from "../../../src/app/components/AnalyticsConsentBanner";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;
const noticeName = "מידע על מדידת שימוש";

describe("AnalyticsConsentBanner", () => {
	beforeEach(() => {
		localStorage.clear();
		mockIsProduction.mockReturnValue(true);
	});

	it("shows an entry disclosure and opt-out without an approval button", () => {
		render(<AnalyticsConsentBanner />);
		expect(screen.getByRole("region", { name: noticeName })).toHaveAttribute(
			"data-nosnippet",
		);
		expect(screen.getAllByRole("button")).toHaveLength(2);
		expect(
			screen.getByRole("button", { name: "כיבוי מדידה" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /מאשר|אישור|הסכמה/ }),
		).not.toBeInTheDocument();
		expect(screen.getByText(/המשך השימוש מאפשר מדידה/)).toBeInTheDocument();
	});

	it("includes the disclosure in initial server HTML and excludes it from snippets", () => {
		const html = renderToString(<AnalyticsConsentBanner />);
		expect(html).toContain(noticeName);
		expect(html).toContain("data-nosnippet");
		expect(html).toContain("/#privacyPolicy");
	});

	it("links to the privacy policy and leaves measurement pending when opened synthetically", () => {
		render(<AnalyticsConsentBanner />);
		const link = screen.getByRole("link");
		expect(link).toHaveAttribute("href", "/#privacyPolicy");
		expect(link).toHaveAttribute("rel", "privacy-policy");
		fireEvent.click(link);
		expect(getAnalyticsStatus()).toBe("pending");
	});

	it("does not treat synthetic document clicks as continued use", () => {
		render(
			<>
				<AnalyticsConsentBanner />
				<button type="button">לפרק הבא</button>
			</>,
		);
		fireEvent.click(screen.getByRole("button", { name: "לפרק הבא" }));
		expect(localStorage.getItem(ANALYTICS_NOTICE_KEY)).toBeNull();
		expect(getAnalyticsStatus()).toBe("pending");
		expect(
			screen.getByRole("region", { name: noticeName }),
		).toBeInTheDocument();
	});

	it("dismisses the notice without recording an explicit permission", () => {
		render(<AnalyticsConsentBanner />);
		fireEvent.click(screen.getByRole("button", { name: "סגירת ההודעה" }));
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
		expect(getAnalyticsStatus()).toBe("enabled");
		expect(
			screen.queryByRole("region", { name: noticeName }),
		).not.toBeInTheDocument();
	});

	it.each(["wheel", "touchmove"])(
		"does not enable from a synthetic %s reading event",
		(eventType) => {
			render(<AnalyticsConsentBanner />);
			fireEvent(document.body, new Event(eventType, { bubbles: true }));
			expect(getAnalyticsStatus()).toBe("pending");
		},
	);

	it("stores an opt-out and removes the disclosure without recording continued use", () => {
		render(<AnalyticsConsentBanner />);
		fireEvent.click(screen.getByRole("button", { name: "כיבוי מדידה" }));
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
		expect(localStorage.getItem(ANALYTICS_NOTICE_KEY)).toBeNull();
		expect(getAnalyticsStatus()).toBe("disabled");
		expect(
			screen.queryByRole("region", { name: noticeName }),
		).not.toBeInTheDocument();
	});

	it.each(["granted", "denied"])(
		"ignores the retired %s response and shows the revised notice",
		(oldChoice) => {
			localStorage.setItem("analyticsConsent", oldChoice);
			render(<AnalyticsConsentBanner />);
			expect(
				screen.getByRole("region", { name: noticeName }),
			).toBeInTheDocument();
		},
	);

	it.each(["granted", "denied"])(
		"stays hidden after a current %s preference",
		(choice) => {
			localStorage.setItem(ANALYTICS_CONSENT_KEY, choice);
			const { container } = render(<AnalyticsConsentBanner />);
			expect(container).toBeEmptyDOMElement();
		},
	);

	it("stays hidden on later visits after the current disclosure was seen", () => {
		markAnalyticsNoticeSeen();
		const { container } = render(<AnalyticsConsentBanner />);
		expect(container).toBeEmptyDOMElement();
	});

	it("does not render or register continued use outside production", () => {
		mockIsProduction.mockReturnValue(false);
		const { container } = render(<AnalyticsConsentBanner />);
		fireEvent.click(document.body);
		expect(container).toBeEmptyDOMElement();
		expect(getAnalyticsStatus()).toBe("pending");
	});
});
