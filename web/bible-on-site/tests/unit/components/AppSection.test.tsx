/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

import { AppSection } from "@/app/components/AppSection";

describe("AppSection", () => {
	it("renders section heading and subheading", () => {
		render(<AppSection />);
		expect(
			screen.getByRole("heading", { level: 1, name: /יישֹוּמוֹן תנ"ך על הפרק/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", {
				level: 2,
				name: /הורידו את האפליקציה/,
			}),
		).toBeInTheDocument();
	});

	it("renders app platform links", () => {
		render(<AppSection />);
		expect(screen.getByRole("link", { name: "App Store" })).toHaveAttribute(
			"href",
			expect.stringContaining("apps.apple.com"),
		);
		expect(
			screen.getByRole("link", { name: "Google Play" }),
		).toHaveAttribute("href", expect.stringContaining("play.google.com"));
		expect(
			screen.getByRole("link", { name: "Microsoft Store" }),
		).toHaveAttribute("href", expect.stringContaining("apps.microsoft.com"));
	});

	it("renders section with id app", () => {
		render(<AppSection />);
		expect(document.getElementById("app")).toBeInTheDocument();
	});

	it("renders disabled platform when href is null", () => {
		// Mock a platform with null href to test the disabled branch
		jest.resetModules();
		jest.doMock("@/app/components/appPlatforms", () => ({
			appPlatforms: [
				{
					id: "coming-soon",
					name: "Coming Soon",
					description: "Coming soon platform",
					icon: "/icons/coming-soon.svg",
					href: null,
				},
				{
					id: "active",
					name: "Active Platform",
					description: "Active platform",
					icon: "/icons/active.svg",
					href: "https://example.com",
				},
			],
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { AppSection: AppSectionMocked } = require("@/app/components/AppSection");
		render(<AppSectionMocked />);
		// The null-href platform should be a <span>, not a link
		expect(screen.queryByRole("link", { name: "Coming Soon" })).toBeNull();
		expect(screen.getByText("Coming Soon")).toBeInTheDocument();
		// The active platform should still be a link
		expect(
			screen.getByRole("link", { name: "Active Platform" }),
		).toBeInTheDocument();
	});
});
