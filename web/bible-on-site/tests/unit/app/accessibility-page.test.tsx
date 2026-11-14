/**
 * @jest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		className,
	}: {
		children: React.ReactNode;
		href: string;
		className?: string;
	}) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
}));

import AccessibilityPage, { metadata } from "@/app/accessibility/page";

describe("accessibility page", () => {
	describe("metadata", () => {
		it("has a Hebrew title and canonical URL", () => {
			expect(metadata.title).toContain("הצהרת נגישות");
			expect(metadata.title).toContain('תנ"ך על הפרק');
			expect(metadata.alternates?.canonical).toBe("/accessibility");
			expect(metadata.description).toBeTruthy();
		});
	});

	describe("content", () => {
		it("renders the הצהרת נגישות main heading", () => {
			render(<AccessibilityPage />);
			expect(
				screen.getByRole("heading", { level: 1, name: "הצהרת נגישות" }),
			).toBeInTheDocument();
		});

		it("describes website and app accessibility separately", () => {
			render(<AccessibilityPage />);
			expect(
				screen.getByRole("heading", { name: /נגישות באתר/ }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("heading", { name: /נגישות ביישומון/ }),
			).toBeInTheDocument();
		});

		it("states known limitations without a blanket full-compliance claim", () => {
			render(<AccessibilityPage />);
			expect(
				screen.getByRole("heading", { name: /מגבלות/ }),
			).toBeInTheDocument();
		});

		it("provides working accessibility contact routes", () => {
			render(<AccessibilityPage />);
			expect(
				screen.getByRole("link", { name: /tanah\.site@gmail\.com/ }),
			).toHaveAttribute("href", "mailto:tanah.site@gmail.com");
			expect(screen.getByRole("link", { name: /ווטסאפ/ })).toHaveAttribute(
				"href",
				"https://wa.me/37257078640",
			);
		});

		it("explains which context helps reproduce a difficulty", () => {
			render(<AccessibilityPage />);
			const main = screen.getByRole("main");
			expect(within(main).getAllByText(/דפדפן|מכשיר/).length).toBeGreaterThan(
				0,
			);
		});

		it("carries a last-updated date", () => {
			render(<AccessibilityPage />);
			expect(screen.getByText(/עודכנה לאחרונה/)).toBeInTheDocument();
		});

		it("links back to the homepage", () => {
			render(<AccessibilityPage />);
			expect(
				screen.getByRole("link", { name: /חזרה לעמוד הראשי/ }),
			).toHaveAttribute("href", "/");
		});
	});
});
