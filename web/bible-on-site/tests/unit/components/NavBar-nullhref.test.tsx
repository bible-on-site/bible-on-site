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

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
	}: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

// Mock appPlatforms with a null-href platform (coming soon)
jest.mock("@/app/components/appPlatforms", () => ({
	appPlatforms: [
		{
			id: "future-store",
			name: "Future Store",
			description: "Coming soon platform",
			icon: "/icons/future.svg",
			href: null,
		},
	],
}));

import { NavBar } from "@/app/components/NavBar";

describe("NavBar (null platform href)", () => {
	it("renders platform link without href when platform.href is null", () => {
		render(<NavBar />);
		const link = screen.getByText("Future Store").closest("a");
		expect(link).toBeTruthy();
		// href attribute should not be set (null → undefined)
		expect(link?.getAttribute("href")).toBeNull();
	});
});
