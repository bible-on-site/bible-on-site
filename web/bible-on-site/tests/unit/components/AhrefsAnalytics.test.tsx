/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";

jest.mock("next/script", () => {
	return function MockScript(props: {
		src?: string;
		"data-key"?: string;
		strategy?: string;
	}) {
		return <pre data-testid="ahrefs-script" {...props} />;
	};
});

jest.mock("@/util/environment", () => ({
	isProduction: jest.fn(),
}));

import { isProduction } from "@/util/environment";
import { AhrefsAnalytics } from "../../../src/app/components/AhrefsAnalytics";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

describe("AhrefsAnalytics", () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	describe("when in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(true);
		});

		it("loads the Ahrefs script with the exact supplied key", () => {
			const { getByTestId } = render(AhrefsAnalytics() as React.ReactElement);
			const script = getByTestId("ahrefs-script");
			expect(script.getAttribute("src")).toBe(
				"https://analytics.ahrefs.com/analytics.js",
			);
			expect(script.getAttribute("data-key")).toBe("G7ksy4fTmIqbChcszvHcDw");
		});

		it("renders exactly one tracker per mount", () => {
			const { container } = render(AhrefsAnalytics() as React.ReactElement);
			expect(
				container.querySelectorAll("[data-testid='ahrefs-script']"),
			).toHaveLength(1);
		});
	});

	describe("when not in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(false);
		});

		it("returns null and renders nothing", () => {
			expect(AhrefsAnalytics()).toBeNull();
		});
	});
});
