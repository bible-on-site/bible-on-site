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

import { ContactSection } from "@/app/components/ContactSection";

describe("ContactSection", () => {
	it("renders contact section heading", () => {
		render(<ContactSection />);
		expect(screen.getByRole("heading", { name: /יצירת קשר/i })).toBeInTheDocument();
		expect(screen.getByText(/נשמח לשמוע מכם/i)).toBeInTheDocument();
	});

	it("renders WhatsApp link", () => {
		render(<ContactSection />);
		// Multiple links share "הודעה פרטית" (WhatsApp, Telegram); get by href
		const links = screen.getAllByRole("link", { name: "הודעה פרטית" });
		const wa = links.find(
			(el) => el.getAttribute("href") === "https://wa.me/37257078640",
		);
		expect(wa).toBeInTheDocument();
		expect(wa).toHaveAttribute("href", "https://wa.me/37257078640");
	});

	it("renders phone link", () => {
		render(<ContactSection />);
		const link = screen.getByRole("link", { name: /\+372-57078640/i });
		expect(link).toHaveAttribute("href", "tel:+37257078640");
	});
});
