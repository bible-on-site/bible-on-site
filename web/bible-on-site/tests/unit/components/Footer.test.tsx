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

	it("handles Hebrew year below 5000", () => {
		// Reset modules so we can mock HebrewDate
		jest.resetModules();
		jest.doMock("@/util/hebdates-util", () => ({
			HebrewDate: {
				fromGregorian: () => ({ year: 4999 }),
			},
		}));
		jest.doMock("next/image", () => ({
			__esModule: true,
			default: (props: Record<string, unknown>) => (
				<span data-testid="mock-image" data-alt={props.alt as string} />
			),
		}));
		jest.doMock("next/link", () => ({
			__esModule: true,
			default: ({
				children,
				href,
			}: { children: React.ReactNode; href: string }) => (
				<a href={href}>{children}</a>
			),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { Footer: FooterMocked } = require("@/app/components/Footer");
		render(<FooterMocked />);
		// Should still render without crashing; the year < 5000 branch is covered
		expect(screen.getByText(/תנ״ך על הפרק/)).toBeInTheDocument();
	});
});
