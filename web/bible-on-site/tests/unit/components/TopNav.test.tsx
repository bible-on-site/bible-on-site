/**
 * @jest-environment jsdom
 */
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import Image from "next/image";
import sharp from "sharp";

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

import { TopNav } from "@/app/components/TopNav";

const searchLink = () => screen.queryByRole("link", { name: "חיפוש" });

describe("TopNav", () => {
	beforeEach(() => {
		mockPathname = "/";
	});

	it("links the logo home and exposes an icon-only labelled search button", () => {
		render(<TopNav />);

		const nav = screen.getByRole("navigation", { name: "ניווט עליון" });
		expect(nav).toHaveClass("top-nav");

		const logo = screen.getByRole("img", { name: 'תנ"ך על הפרק' });
		expect(logo.closest("a")).toHaveAttribute("href", "/");

		// Icon-only: the accessible name comes from aria-label, and the
		// button renders no visible text (#2154).
		const search = screen.getByRole("link", { name: "חיפוש" });
		expect(search).toHaveAttribute("href", "/search");
		expect(search).toHaveAttribute("aria-label", "חיפוש");
		expect(search).toHaveClass("top-nav-search");
		expect(search).not.toHaveTextContent(/\S/);
	});

	it("serves a real DPR3 header bitmap directly while other images remain optimized", async () => {
		const bitmap = await sharp(
			resolve(
				__dirname,
				"../../../public/images/logos/logo-white-letters-69.webp",
			),
		).metadata();
		render(
			<>
				<TopNav />
				<Image
					src="/images/logos/logo192.webp"
					alt="Optimizer control"
					width={72}
					height={72}
				/>
			</>,
		);

		const logo = screen.getByRole("img", { name: 'תנ"ך על הפרק' });
		expect(logo).toHaveAttribute(
			"src",
			"/images/logos/logo-white-letters-69.webp",
		);
		expect(logo).not.toHaveAttribute("srcset");
		expect(logo).toHaveAttribute("loading", "eager");
		expect(logo).toHaveAttribute("width", "69");
		expect(logo).toHaveAttribute("height", "50");
		expect(logo).toHaveStyle({ width: "72px", height: "auto" });
		expect(logo.closest("a")).toHaveAttribute("href", "/");

		// Inspect the actual served bitmap: a responsive srcset alone cannot
		// provide detail if the encoded source still contains only 69 pixels.
		const displayedWidth = Number.parseFloat(logo.style.width);
		const displayedHeight =
			(displayedWidth * Number(logo.getAttribute("height"))) /
			Number(logo.getAttribute("width"));
		expect(bitmap.format).toBe("webp");
		expect(bitmap.width ?? 0).toBeGreaterThanOrEqual(
			Math.ceil(displayedWidth * 3),
		);
		expect(bitmap.height ?? 0).toBeGreaterThanOrEqual(
			Math.ceil(displayedHeight * 3),
		);

		const control = screen.getByRole("img", { name: "Optimizer control" });
		expect(control.getAttribute("src")).toContain("/_next/image?");
		expect(control).toHaveAttribute("srcset");
	});

	it("renders exactly the logo and search entries, in that order", () => {
		render(<TopNav />);

		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute("href", "/");
		expect(links[1]).toHaveAttribute("href", "/search");
	});

	it("shows the search button outside reader sections", () => {
		// The מסורה/פרשה landing roots hold no settings button — the
		// collision only exists inside their unit routes.
		for (const pathname of [
			"/",
			"/search",
			"/tos",
			"/מסורה",
			"/masora",
			"/פרשה",
			"/parasha",
		]) {
			mockPathname = pathname;
			const { unmount } = render(<TopNav />);
			expect(searchLink()).toBeInTheDocument();
			unmount();
		}
	});

	it.each([
		// על הפרק — the whole /929 tree (#2274)
		"/929",
		"/929/11",
		"/929/11/2",
		"/929/authors",
		"/929/rabbis",
		// Masora/Parasha unit readers share the settings corner —
		// public Hebrew paths and internal ASCII route dirs alike.
		"/מסורה/1",
		"/masora/1",
		"/%D7%9E%D7%A1%D7%95%D7%A8%D7%94/1",
		"/פרשה/לך-לך",
		"/parasha/לך-לך",
		"/%D7%A4%D7%A8%D7%A9%D7%94/%D7%9C%D7%9A-%D7%9C%D7%9A",
	])("omits the search button entirely on reader pages (%s)", (pathname) => {
		mockPathname = pathname;
		render(<TopNav />);

		// #2274: no link, no invisible .top-nav-search hit area and no
		// keyboard-focusable remnant — nothing is rendered at all.
		expect(searchLink()).not.toBeInTheDocument();
		expect(document.querySelector(".top-nav-search")).toBeNull();
		expect(screen.getAllByRole("link")).toHaveLength(1);
	});
});
