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

import { DailyBulletinSection } from "@/app/components/DailyBulletinSection";

describe("DailyBulletinSection", () => {
	it("renders exactly three join cards with stable first-party actions", () => {
		render(<DailyBulletinSection />);
		expect(
			screen.getByRole("heading", { name: "עלון יומי" }),
		).toBeInTheDocument();
		const telegram = screen.getByRole("link", { name: "הצטרפות לערוץ" });
		expect(telegram).toHaveAttribute("href", "/join/telegram");
		const whatsapp = screen.getByRole("link", { name: "הצטרפות לקבוצה" });
		expect(whatsapp).toHaveAttribute("href", "/join/whatsapp");
		const email = screen.getByRole("link", { name: "עמוד הרשמה נפרד" });
		expect(email).toHaveAttribute("href", "/join/email");
	});

	it("anchors the cards for the section scroll targets", () => {
		const { container } = render(<DailyBulletinSection />);
		expect(container.querySelector("#bulletin")).not.toBeNull();
		expect(container.querySelector("#bulletin-telegram")).not.toBeNull();
		expect(container.querySelector("#bulletin-whatsapp")).not.toBeNull();
		expect(container.querySelector("#bulletin-email")).not.toBeNull();
	});

	it("embeds the reusable signup form in the email card", () => {
		render(<DailyBulletinSection />);
		expect(screen.getByRole("checkbox")).toBeInTheDocument();
		expect(screen.getByLabelText(/כתובת דוא"ל/)).toBeInTheDocument();
	});

	it("never embeds provider invitation URLs in the markup", () => {
		const { container } = render(<DailyBulletinSection />);
		expect(container.innerHTML).not.toContain("t.me/");
		expect(container.innerHTML).not.toContain("chat.whatsapp.com");
		expect(container.innerHTML).not.toContain("wa.me");
	});
});
