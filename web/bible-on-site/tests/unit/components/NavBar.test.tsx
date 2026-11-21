/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

let mockPathname = "/";
jest.mock("next/navigation", () => ({
	usePathname: () => mockPathname,
}));

// next/jest injects development's unoptimized setting; exercise the real
// Next Image renderer with production optimization enabled instead.
jest.mock("next/dist/client/use-image-config", () => {
	const { imageConfigDefault, prepareImageConfig } = jest.requireActual<
		typeof import("next/dist/shared/lib/image-config")
	>("next/dist/shared/lib/image-config");
	return {
		useImageConfig: () =>
			prepareImageConfig(undefined, {
				...imageConfigDefault,
				unoptimized: false,
			}),
	};
});

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
	} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

import { NavBar } from "@/app/components/NavBar";

describe("NavBar", () => {
	it("renders menu with main nav links", () => {
		render(<NavBar version="1.2.3" />);
		expect(screen.getByRole("link", { name: "על הפרק" })).toHaveAttribute(
			"href",
			"/929",
		);
		expect(screen.getByRole("link", { name: "מסורה על הפרק" })).toHaveAttribute(
			"href",
			"/מסורה",
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
		render(<NavBar version="1.2.3" />);
		const homeLink = screen.getByRole("link", { name: "עמוד ראשי" });
		expect(homeLink).toBeInTheDocument();
		expect(homeLink).toHaveAttribute("href", "/");
	});

	it("serves the small sidebar logo directly while preserving its size and lazy loading", () => {
		render(<NavBar version="1.2.3" />);

		const logo = screen.getByRole("img", { name: "עמוד ראשי" });
		expect(logo).toHaveAttribute("src", "/images/logos/logo192.webp");
		expect(logo).not.toHaveAttribute("srcset");
		expect(logo).toHaveAttribute("width", "72");
		expect(logo).toHaveAttribute("height", "72");
		expect(logo).toHaveAttribute("loading", "lazy");
		expect(logo.closest("a")).toHaveAttribute("href", "/");
	});

	it("renders app and daily bulletin links", () => {
		render(<NavBar version="1.2.3" />);
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

	it("groups the menu into לימוד, תוכן and שירות sections", () => {
		render(<NavBar version="1.2.3" />);
		const menu = document.getElementById("main-menu") as HTMLElement;
		const titles = Array.from(menu.querySelectorAll("h2")).map(
			(h) => h.textContent,
		);
		expect(titles).toEqual(["לימוד", "תוכן", "שירות"]);
	});

	it("keeps the accessibility statement out of the side nav (#2396)", () => {
		render(<NavBar version="1.2.3" />);
		// The entry point moved to the top-bar accessibility menu; the footer
		// link (Footer.tsx) remains the secondary access route.
		expect(
			screen.queryByRole("link", { name: /הצהרת נגישות/ }),
		).not.toBeInTheDocument();
	});

	it("displays and updates the version supplied by the server", () => {
		const { container, rerender } = render(<NavBar version="8.9.10" />);
		const versionItem = () =>
			container.querySelector("li[style]") as HTMLElement;
		expect(versionItem().style.getPropertyValue("--version-content")).toBe(
			'"- 8.9.10 -"',
		);

		rerender(<NavBar version="8.9.11" />);
		expect(versionItem().style.getPropertyValue("--version-content")).toBe(
			'"- 8.9.11 -"',
		);
	});

	describe("active item", () => {
		const currentLink = () =>
			document.querySelectorAll("#main-menu a[aria-current='page']");

		it.each([
			["/מסורה", "מסורה על הפרק"],
			["/masora/12", "מסורה על הפרק"],
			["/parasha/כי תשא", "פרשה על הפרק"],
			["/calendar", "לוח לימוד יומי"],
			["/לוח", "לוח לימוד יומי"],
			["/pedia/ירושלים", "תנכפדיה"],
			["/whatsappGroup", "קבוצת ווטסאפ"],
		])("marks %s as current via %s", (path, name) => {
			mockPathname = path;
			render(<NavBar version="1.2.3" />);
			expect(currentLink()).toHaveLength(1);
			expect(currentLink()[0]).toHaveTextContent(name);
			expect(currentLink()[0]).toHaveAttribute("aria-current", "page");
		});

		it("marks הרבנים and not its /929 parent on /929/authors", () => {
			mockPathname = "/929/authors/יהודה הלוי";
			render(<NavBar version="1.2.3" />);
			expect(currentLink()).toHaveLength(1);
			expect(currentLink()[0]).toHaveTextContent("הרבנים");
		});

		it("marks percent-encoded Hebrew paths", () => {
			mockPathname = encodeURI("/מסורה/12");
			render(<NavBar version="1.2.3" />);
			expect(currentLink()).toHaveLength(1);
			expect(currentLink()[0]).toHaveTextContent("מסורה על הפרק");
		});

		it("marks nothing on the homepage", () => {
			mockPathname = "/";
			render(<NavBar version="1.2.3" />);
			expect(currentLink()).toHaveLength(0);
		});

		it("tolerates a malformed percent-encoded pathname", () => {
			mockPathname = "/%E0%A4%A";
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
			render(<NavBar version="1.2.3" />);
			expect(currentLink()).toHaveLength(0);
			expect(warn).toHaveBeenCalled();
			warn.mockRestore();
		});
	});

	describe("menu toggle", () => {
		const getTrigger = () => screen.getByRole("button", { name: "תפריט ראשי" });
		const getMenu = () => document.getElementById("main-menu") as HTMLElement;

		beforeEach(() => {
			mockPathname = "/";
		});

		it("starts closed and inert, opens on trigger click", () => {
			render(<NavBar version="1.2.3" />);
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
			expect(getTrigger()).toHaveAttribute("aria-controls", "main-menu");
			expect(getMenu()).toHaveAttribute("inert");
			fireEvent.click(getTrigger());
			expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
			expect(getMenu()).not.toHaveAttribute("inert");
		});

		it("closes on Escape and returns focus to the trigger", () => {
			render(<NavBar version="1.2.3" />);
			fireEvent.click(getTrigger());
			fireEvent.keyDown(document, { key: "Enter" });
			expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
			fireEvent.keyDown(document, { key: "Escape" });
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
			expect(getTrigger()).toHaveFocus();
		});

		it("closes on overlay click and returns focus to the trigger", () => {
			const { container } = render(<NavBar version="1.2.3" />);
			fireEvent.click(getTrigger());
			fireEvent.click(
				container.querySelector('[aria-hidden="true"]') as Element,
			);
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
			expect(getTrigger()).toHaveFocus();
		});

		it("closes when a menu link is clicked but not on other menu clicks", () => {
			render(<NavBar version="1.2.3" />);
			fireEvent.click(getTrigger());
			fireEvent.click(getMenu());
			expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
			fireEvent.click(screen.getByText("צור קשר"));
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
		});

		it("closes on route change", () => {
			const { rerender } = render(<NavBar version="1.2.3" />);
			fireEvent.click(getTrigger());
			mockPathname = "/929/authors";
			rerender(<NavBar version="1.2.3" />);
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
		});
	});
});
