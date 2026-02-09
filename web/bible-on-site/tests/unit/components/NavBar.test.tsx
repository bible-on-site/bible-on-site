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
		const homeLink = document.querySelector('a[href="./"]');
		expect(homeLink).toBeInTheDocument();
		expect(homeLink).toHaveAttribute("href", "./");
	});

	it("renders app and daily bulletin links", () => {
		render(<NavBar />);
		expect(screen.getByRole("link", { name: /יישומון/ })).toHaveAttribute(
			"href",
			"/app",
		);
		expect(
			screen.getByRole("link", { name: /עלון יומי/ }),
		).toHaveAttribute("href", "/dailyBulletin");
		expect(
			screen.getByRole("link", { name: /קבוצת ווטסאפ/ }),
		).toHaveAttribute("href", "/whatsappGroup");
	});
});
