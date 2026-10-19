/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/util/environment", () => ({
	isProduction: jest.fn(),
}));

import {
	ANALYTICS_CONSENT_KEY,
	getAnalyticsConsent,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import { AnalyticsConsentReset } from "../../../src/app/components/AnalyticsConsentReset";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

describe("AnalyticsConsentReset", () => {
	beforeEach(() => {
		localStorage.clear();
		mockIsProduction.mockReturnValue(true);
	});

	describe("when in production", () => {
		it("shows the stored grant and a change button", () => {
			localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
			render(<AnalyticsConsentReset />);
			expect(screen.getByText(/מאושרת/)).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: "לחצו כאן לשינוי הבחירה" }),
			).toBeInTheDocument();
		});

		it("shows the stored denial", () => {
			localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
			render(<AnalyticsConsentReset />);
			expect(screen.getByText(/נדחתה/)).toBeInTheDocument();
		});

		it("forgetting the answer re-arms the consent banner", () => {
			localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
			render(<AnalyticsConsentReset />);
			fireEvent.click(
				screen.getByRole("button", { name: "לחצו כאן לשינוי הבחירה" }),
			);
			expect(getAnalyticsConsent()).toBeNull();
			// Undecided again, so the control hides while the banner re-asks.
			expect(
				screen.queryByRole("button", { name: "לחצו כאן לשינוי הבחירה" }),
			).not.toBeInTheDocument();
		});

		it("renders nothing before the user decides", () => {
			const { container } = render(<AnalyticsConsentReset />);
			expect(container).toBeEmptyDOMElement();
		});
	});

	describe("when not in production", () => {
		it("renders nothing even with a stored answer", () => {
			mockIsProduction.mockReturnValue(false);
			localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
			const { container } = render(<AnalyticsConsentReset />);
			expect(container).toBeEmptyDOMElement();
		});
	});
});
