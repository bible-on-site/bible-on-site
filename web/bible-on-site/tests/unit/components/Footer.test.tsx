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
	}: {
		children: React.ReactNode;
		href: string;
	}) => <a href={href}>{children}</a>,
}));

import { Footer } from "@/app/components/Footer";

describe("Footer", () => {
	it("renders footer with navigation links", () => {
		render(<Footer />);
		expect(
			screen.getByRole("link", { name: /על הפרק בתקשורת/i }),
		).toHaveAttribute("href", "/journalism");
		expect(screen.getByRole("link", { name: /רבנים מברכים/i })).toHaveAttribute(
			"href",
			"/rabbis-blessing",
		);
		expect(screen.getByRole("link", { name: /הצהרת נגישות/i })).toHaveAttribute(
			"href",
			"/accessibility",
		);
	});

	it("renders copyright with year range", () => {
		render(<Footer />);
		expect(screen.getByText(/תנ"ך על הפרק/)).toBeInTheDocument();
	});

	it("renders GitHub link", () => {
		render(<Footer />);
		const gh = screen.getByRole("link", { name: /GitHub/i });
		expect(gh).toHaveAttribute(
			"href",
			"https://github.com/bible-on-site/bible-on-site",
		);
	});

	describe("copyright Hebrew year", () => {
		const originalMockDate = process.env.MOCK_DATE;

		afterEach(() => {
			if (originalMockDate === undefined) {
				delete process.env.MOCK_DATE;
			} else {
				process.env.MOCK_DATE = originalMockDate;
			}
		});

		it("shows the new Hebrew year after tzeit on erev Rosh Hashanah", () => {
			// 29 Elul 5785, 20:30 in Jerusalem: civil dusk (~19:00) has passed,
			// so the Hebrew date is already 1 Tishrei 5786.
			process.env.MOCK_DATE = "2025-09-22T17:30:00.000Z";
			render(<Footer />);
			expect(screen.getByText(/תנ"ך על הפרק/)).toHaveTextContent(
				"ה'תשפ\"ו",
			);
		});

		it("shows the outgoing Hebrew year before tzeit on erev Rosh Hashanah", () => {
			// 29 Elul 5785, 18:30 in Jerusalem: still before civil dusk.
			process.env.MOCK_DATE = "2025-09-22T15:30:00.000Z";
			render(<Footer />);
			expect(screen.getByText(/תנ"ך על הפרק/)).toHaveTextContent(
				"ה'תשפ\"ה",
			);
		});
	});

	it("handles Hebrew year below 5000", () => {
		// Reset modules so we can mock HebrewDate
		jest.resetModules();
		jest.doMock("@/util/date", () => ({
			getCurrentDate: () => new Date("2024-01-01T00:00:00.000Z"),
		}));
		jest.doMock("@/util/hebdates-util", () => ({
			constructTsetAwareHDate: () => ({ year: 4999 }),
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
			}: {
				children: React.ReactNode;
				href: string;
			}) => <a href={href}>{children}</a>,
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { Footer: FooterMocked } = require("@/app/components/Footer");
		render(<FooterMocked />);
		// Should still render without crashing; the year < 5000 branch is covered
		expect(screen.getByText(/תנ"ך על הפרק/)).toBeInTheDocument();
	});
});
