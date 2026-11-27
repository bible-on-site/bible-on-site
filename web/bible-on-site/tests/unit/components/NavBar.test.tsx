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
		prefetch: _prefetch,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
		prefetch?: boolean | "auto" | null;
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
		expect(
			screen.getByRole("link", { name: "על הפרק הלימוד בחלוקה המוכרת" }),
		).toHaveAttribute("href", "/929");
		expect(
			screen.getByRole("link", {
				name: "מסורה על הפרק חלוקת המסורה היהודית הקדומה",
			}),
		).toHaveAttribute("href", "/מסורה");
		expect(
			screen.getByRole("link", { name: "הרבנים איתור מאמרים לפי המחברים" }),
		).toHaveAttribute("href", "/929/authors");
		expect(
			screen.getByRole("link", { name: "תנאי שימוש והצהרות פרטיות ונגישות" }),
		).toHaveAttribute("href", "/tos");
		expect(screen.getByRole("link", { name: "צור קשר" })).toHaveAttribute(
			"href",
			"/contact",
		);
		expect(screen.getByRole("link", { name: "תרומות" })).toHaveAttribute(
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
		expect(logo).toHaveAttribute("width", "36");
		expect(logo).toHaveAttribute("height", "36");
		expect(logo).toHaveAttribute("loading", "lazy");
		expect(logo.closest("a")).toHaveAttribute("href", "/");
	});

	it("renders app and daily bulletin links without the WhatsApp row (#3731)", () => {
		render(<NavBar version="1.2.3" />);
		expect(screen.getByRole("link", { name: "יישומון" })).toHaveAttribute(
			"href",
			"/app",
		);
		expect(
			screen.getByRole("link", {
				name: "עלון יומי הפרק היומי והמאמרים ישירות אליכם",
			}),
		).toHaveAttribute("href", "/dailyBulletin");
		// The WhatsApp row left the drawer; the bulletin card and the
		// /whatsappGroup landing page keep serving the join action.
		expect(
			screen.queryByRole("link", { name: /ווטסאפ/ }),
		).not.toBeInTheDocument();
	});

	it("orders the five groups, their items, subtitles and nested store links (#3731)", () => {
		render(<NavBar version="1.2.3" />);
		// biome-ignore lint/style/noNonNullAssertion: NavBar always renders #main-menu
		const menu = document.getElementById("main-menu")!;
		const groups = Array.from(
			menu.querySelectorAll<HTMLHeadingElement>("h2"),
		).map((h2) => {
			const list = h2.nextElementSibling;
			const items = Array.from(list?.children ?? []).map((li) => {
				const anchor = li.querySelector("a");
				return {
					label: anchor?.children[1]?.children[0]?.textContent ?? null,
					subtitle: anchor?.querySelector("small")?.textContent ?? null,
					href: anchor?.getAttribute("href"),
					sub: Array.from(
						li.querySelector("ul")?.querySelectorAll("a") ?? [],
					).map((sub) => sub.textContent),
				};
			});
			return { title: h2.textContent, items };
		});
		expect(groups).toEqual([
			{
				title: "לימוד על הפרק",
				items: [
					{
						label: "על הפרק",
						subtitle: "הלימוד בחלוקה המוכרת",
						href: "/929",
						sub: [],
					},
				],
			},
			{
				title: "חלוקות נוספות",
				items: [
					{
						label: "מסורה על הפרק",
						subtitle: "חלוקת המסורה היהודית הקדומה",
						href: "/מסורה",
						sub: [],
					},
					{
						label: "פרשה על הפרק",
						subtitle: "לימוד לפי סדר הפרשות",
						href: "/פרשה",
						sub: [],
					},
					{
						label: "מועדים על הפרק",
						subtitle: "לימוד במעגל השנה",
						href: "/מועדים",
						sub: [],
					},
					{
						label: "הרבנים",
						subtitle: "איתור מאמרים לפי המחברים",
						href: "/929/authors",
						sub: [],
					},
				],
			},
			{
				title: "אפשרויות לימוד נוספות",
				items: [
					{
						label: "עלון יומי",
						subtitle: "הפרק היומי והמאמרים ישירות אליכם",
						href: "/dailyBulletin",
						sub: [],
					},
					{
						label: "יישומון",
						subtitle: null,
						href: "/app",
						sub: ["App Store", "Google Play", "Microsoft Store"],
					},
				],
			},
			{
				title: "כלי לימוד",
				items: [
					{
						label: "תנכפדיה",
						subtitle: 'אנציקלופדיה תנ"כית',
						href: "/pedia",
						sub: [],
					},
					{
						label: "לוח לימוד יומי",
						subtitle: "לוח עזר פרקים לפי תאריך",
						href: "/לוח",
						sub: [],
					},
				],
			},
			{
				title: "שונות",
				items: [
					{
						label: "תנאי שימוש",
						subtitle: "והצהרות פרטיות ונגישות",
						href: "/tos",
						sub: [],
					},
					{ label: "תרומות", subtitle: null, href: "/donation", sub: [] },
					{ label: "צור קשר", subtitle: null, href: "/contact", sub: [] },
				],
			},
		]);
	});

	it("keeps each subtitle inside its item's single link", () => {
		render(<NavBar version="1.2.3" />);
		const link = screen.getByRole("link", {
			name: "לוח לימוד יומי לוח עזר פרקים לפי תאריך",
		});
		expect(link.querySelector("small")).toHaveTextContent(
			"לוח עזר פרקים לפי תאריך",
		);
	});

	it("keeps the three store links nested under יישומון as external links", () => {
		render(<NavBar version="1.2.3" />);
		const app = screen.getByRole("link", { name: "יישומון" });
		const item = app.closest("li");
		const stores = Array.from(item?.querySelectorAll(":scope > ul a") ?? []);
		expect(stores.map((a) => a.textContent)).toEqual([
			"App Store",
			"Google Play",
			"Microsoft Store",
		]);
		for (const store of stores) {
			expect(store).toHaveAttribute("target", "_blank");
			expect(store.getAttribute("href")).toMatch(/^https:/);
			expect(store.querySelector("img")).toBeInTheDocument();
			expect(store.querySelector("[dir='ltr']")).toHaveTextContent(
				store.textContent ?? "",
			);
		}
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

		it("marks nothing on /whatsappGroup — the drawer no longer carries that row", () => {
			mockPathname = "/whatsappGroup";
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
		// biome-ignore lint/style/noNonNullAssertion: NavBar always renders #main-menu
		const getMenu = () => document.getElementById("main-menu")!;

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

		it("does not treat an aliased rewrite hydration as navigation away", () => {
			mockPathname = "/929/rabbis";
			const { rerender } = render(<NavBar version="1.2.3" />);
			fireEvent.click(getTrigger());
			expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
			mockPathname = "/929/authors";
			rerender(<NavBar version="1.2.3" />);
			expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
		});

		it("shows a labeled close button that closes the menu and returns focus", () => {
			render(<NavBar version="1.2.3" />);
			fireEvent.click(getTrigger());
			const close = screen.getByRole("button", { name: "סגור" });
			expect(close).toBeVisible();
			fireEvent.click(close);
			expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
			expect(getTrigger()).toHaveFocus();
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
