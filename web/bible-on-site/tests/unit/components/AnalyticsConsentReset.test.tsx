/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/util/environment", () => ({ isProduction: jest.fn() }));

import {
	ANALYTICS_CONSENT_KEY,
	getAnalyticsConsent,
	getAnalyticsStatus,
	markAnalyticsNoticeSeen,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import { AnalyticsConsentBanner } from "../../../src/app/components/AnalyticsConsentBanner";
import { AnalyticsConsentReset } from "../../../src/app/components/AnalyticsConsentReset";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

describe("AnalyticsConsentReset", () => {
	beforeEach(() => {
		localStorage.clear();
		mockIsProduction.mockReturnValue(true);
	});

	it("offers a direct enable control while measurement is pending", () => {
		render(<AnalyticsConsentReset />);
		expect(screen.getByText(/כבויה/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "הפעלת מדידה" }));
		expect(getAnalyticsConsent()).toBe("granted");
		expect(getAnalyticsStatus()).toBe("enabled");
		expect(
			screen.getByRole("button", { name: "כיבוי מדידה" }),
		).toBeInTheDocument();
	});

	it("disables continued-use measurement directly and never reopens an approval prompt", () => {
		markAnalyticsNoticeSeen();
		render(
			<>
				<AnalyticsConsentReset />
				<AnalyticsConsentBanner />
			</>,
		);
		expect(screen.getByText(/פעילה/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "כיבוי מדידה" }));
		expect(getAnalyticsConsent()).toBe("denied");
		expect(getAnalyticsStatus()).toBe("disabled");
		expect(screen.queryByRole("region")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "הפעלת מדידה" }),
		).toBeInTheDocument();
	});

	it("reenables a saved opt-out in one action", () => {
		localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
		render(<AnalyticsConsentReset />);
		fireEvent.click(screen.getByRole("button", { name: "הפעלת מדידה" }));
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
		expect(screen.getByText(/פעילה/)).toBeInTheDocument();
	});

	it("disables an explicitly enabled preference", () => {
		localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
		render(<AnalyticsConsentReset />);
		fireEvent.click(screen.getByRole("button", { name: "כיבוי מדידה" }));
		expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
	});

	it("renders nothing outside production", () => {
		mockIsProduction.mockReturnValue(false);
		const { container } = render(<AnalyticsConsentReset />);
		expect(container).toBeEmptyDOMElement();
	});
});
