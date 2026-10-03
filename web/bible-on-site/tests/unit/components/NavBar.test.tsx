/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

let mockPathname = "/";
jest.mock("next/navigation", () => ({
	usePathname: () => mockPathname,
}));

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

import { NavBar } from "@/app/components/NavBar";

describe("NavBar", () => {
	it("renders menu with main nav links", () => {
		render(<NavBar />);
		expect(screen.getByRole("link", { name: /על הפרק/ })).toHaveAttribute(
			"href",
			"/929",
		);
		expect(screen.getByRole("link", { name: /הרבנים/ })).toHaveAttribute(
			"href",
			"/929/authors",
		);
		expect(screen.getByRole("link", { name: /תנאי שימוש/ })).toHaveAttribute(
			"href",
			"/tos",
		);
		expect(screen.getByRole("link", { name: /צור קשר/ })).toHaveAttribute(
			"href",
			"/contact",
		);
		expect(screen.getByRole("link", { name: /תרומות/ })).toHaveAttribute(
			"href",
			"/donation",
		);
	});

	it("renders home link with correct href", () => {
		render(<NavBar />);
		// Home link has no accessible name (only mock image with alt); get by href
		const homeLink = document.querySelector('a[href="/"]');
		expect(homeLink).toBeInTheDocument();
		expect(homeLink).toHaveAttribute("href", "/");
	});

	it("renders app and daily bulletin links", () => {
		render(<NavBar />);
		expect(screen.getByRole("link", { name: /יישומון/ })).toHaveAttribute(
			"href",
			"/app",
		);
		expect(screen.getByRole("link", { name: /עלון יומי/ })).toHaveAttribute(
			"href",
			"/dailyBulletin",
		);
		expect(screen.getByRole("link", { name: /קבוצת ווטסאפ/ })).toHaveAttribute(
			"href",
			"/whatsappGroup",
		);
	});

	describe("menu toggle", () => {
		const getTrigger = () => screen.getByRole("button", { name: "תפריט ראשי" });
		const getMenu = () => document.getElementById("main-menu") as HTMLElement;

		beforeEach(() => {
			mockPathname = "/";
		});

		it("starts closed and inert, opens on trigger click", () => {
			render(<NavBar />);
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
			expect(getTrigger()).toHaveAttribute("aria-controls", "main-menu");
			expect(getMenu()).toHaveAttribute("inert");
			fireEvent.click(getTrigger());
			expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
			expect(getMenu()).not.toHaveAttribute("inert");
		});

		it("closes on Escape and returns focus to the trigger", () => {
			render(<NavBar />);
			fireEvent.click(getTrigger());
			fireEvent.keyDown(document, { key: "Enter" });
			expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
			fireEvent.keyDown(document, { key: "Escape" });
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
			expect(getTrigger()).toHaveFocus();
		});

		it("closes on overlay click and returns focus to the trigger", () => {
			const { container } = render(<NavBar />);
			fireEvent.click(getTrigger());
			fireEvent.click(
				container.querySelector('[aria-hidden="true"]') as Element,
			);
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
			expect(getTrigger()).toHaveFocus();
		});

		it("closes when a menu link is clicked but not on other menu clicks", () => {
			render(<NavBar />);
			fireEvent.click(getTrigger());
			fireEvent.click(getMenu());
			expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
			fireEvent.click(screen.getByText("צור קשר"));
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
		});

		it("closes on route change", () => {
			const { rerender } = render(<NavBar />);
			fireEvent.click(getTrigger());
			mockPathname = "/929/authors";
			rerender(<NavBar />);
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
		});
	});
});
