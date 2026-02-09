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

import { Footer } from "@/app/components/Footer";

describe("Footer", () => {
	it("renders footer with navigation links", () => {
		render(<Footer />);
		expect(
			screen.getByRole("link", { name: /על הפרק בתקשורת/i }),
		).toHaveAttribute("href", "/journalism");
		expect(
			screen.getByRole("link", { name: /רבנים מברכים/i }),
		).toHaveAttribute("href", "/rabbis-blessing");
	});

	it("renders copyright with year range", () => {
		render(<Footer />);
		expect(screen.getByText(/תנ״ך על הפרק/)).toBeInTheDocument();
	});

	it("renders GitHub link", () => {
		render(<Footer />);
		const gh = screen.getByRole("link", { name: /GitHub/i });
		expect(gh).toHaveAttribute(
			"href",
			"https://github.com/bible-on-site/bible-on-site",
		);
	});
});
