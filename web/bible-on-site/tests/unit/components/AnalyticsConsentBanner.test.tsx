/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/util/environment", () => ({
	isProduction: jest.fn(),
}));

import { ANALYTICS_CONSENT_KEY } from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import { AnalyticsConsentBanner } from "../../../src/app/components/AnalyticsConsentBanner";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

describe("AnalyticsConsentBanner", () => {
	beforeEach(() => {
		localStorage.clear();
		mockIsProduction.mockReturnValue(true);
	});

	describe("when in production", () => {
		it("shows the opt-in banner before the user decides", () => {
			render(<AnalyticsConsentBanner />);
			expect(
				screen.getByRole("region", { name: "הסכמה לאנליטיקה" }),
			).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "מאשר" })).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: "לא תודה" }),
			).toBeInTheDocument();
		});

		it("links to the privacy policy section", () => {
			render(<AnalyticsConsentBanner />);
			expect(screen.getByRole("link")).toHaveAttribute(
				"href",
				"/#privacyPolicy",
			);
		});

		it("accept persists a grant and dismisses the banner", () => {
			render(<AnalyticsConsentBanner />);
			fireEvent.click(screen.getByRole("button", { name: "מאשר" }));
			expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
			expect(
				screen.queryByRole("region", { name: "הסכמה לאנליטיקה" }),
			).not.toBeInTheDocument();
		});

		it("reject persists a denial and dismisses the banner", () => {
			render(<AnalyticsConsentBanner />);
			fireEvent.click(screen.getByRole("button", { name: "לא תודה" }));
			expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
			expect(
				screen.queryByRole("region", { name: "הסכמה לאנליטיקה" }),
			).not.toBeInTheDocument();
		});

		it("stays hidden on later visits after a grant", () => {
			localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
			const { container } = render(<AnalyticsConsentBanner />);
			expect(container).toBeEmptyDOMElement();
		});

		it("respects a prior denial on later visits and never re-asks", () => {
			localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
			const { container } = render(<AnalyticsConsentBanner />);
			expect(container).toBeEmptyDOMElement();
		});
	});

	describe("when not in production", () => {
		it("renders nothing even before the user decides", () => {
			mockIsProduction.mockReturnValue(false);
			const { container } = render(<AnalyticsConsentBanner />);
			expect(container).toBeEmptyDOMElement();
		});
	});
});
