/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";

// Mock next/script to avoid SSR issues in tests
jest.mock("next/script", () => {
	return function MockScript({
		children,
		id,
	}: {
		children?: string;
		id?: string;
	}) {
		return <script data-testid={id}>{children}</script>;
	};
});

// Mock the environment module
jest.mock("@/util/environment", () => ({
	isProduction: jest.fn(),
}));

import { isProduction } from "@/util/environment";
import { GoogleAnalytics } from "../../../src/app/components/GoogleAnalytics";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

describe("GoogleAnalytics", () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	describe("when in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(true);
		});

		it("renders Google Analytics scripts", () => {
			const { container } = render(<GoogleAnalytics />);
			const scripts = container.querySelectorAll("script");
			expect(scripts.length).toBeGreaterThan(0);
		});

		it("includes the GA measurement ID in the script", () => {
			const { getByTestId } = render(<GoogleAnalytics />);
			const gaScript = getByTestId("google-analytics");
			expect(gaScript.textContent).toContain("G-220MEPY7WL");
		});
	});

	describe("when not in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(false);
		});

		it("returns null and renders nothing", () => {
			const { container } = render(<GoogleAnalytics />);
			expect(container.firstChild).toBeNull();
		});
	});
});
