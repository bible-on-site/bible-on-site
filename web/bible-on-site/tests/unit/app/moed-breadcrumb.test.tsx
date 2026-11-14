/**
 * @jest-environment jsdom
 *
 * Regression for issue #3266: the מועדים detail breadcrumb reuses the
 * shared breadcrumb shell with the hierarchy תנ"ך על הפרק > מועדים על
 * הפרק > current moed. A moed spans sefarim, so no fake sefer level is
 * allowed; the current node is the sibling picker over the published
 * catalogue with canonical moed links.
 */
import { render, screen, within } from "@testing-library/react";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
	}) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

import { MoedBreadcrumb } from "@/app/moadim/components/MoedBreadcrumb";
import type { MoedSummary } from "@/lib/moadim";

const moed = (over: Partial<MoedSummary>): MoedSummary => ({
	id: 1,
	slug: "פסח",
	name: "פסח",
	summary: null,
	hebrewMonth: "ניסן",
	dateLabel: 'ט"ו בניסן',
	annualOrder: 1,
	...over,
});

const CATALOGUE: MoedSummary[] = [
	moed({ id: 1, slug: "פסח", name: "פסח", annualOrder: 1 }),
	moed({ id: 2, slug: "שבועות", name: "שבועות", annualOrder: 2 }),
	moed({ id: 3, slug: "פורים", name: "פורים", annualOrder: 3 }),
];

describe("MoedBreadcrumb — מועדים על הפרק levels (#3266)", () => {
	it("renders exactly three levels: home, מועדים root, current moed", () => {
		render(<MoedBreadcrumb moed={CATALOGUE[2]} siblings={CATALOGUE} />);
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });

		const levels = nav.querySelectorAll("ol > li");
		expect(levels).toHaveLength(3);
		for (const level of levels) {
			expect(level.textContent?.trim()).not.toBe("");
		}

		expect(
			within(levels[0] as HTMLElement).getByRole("link", {
				name: 'תנ"ך על הפרק',
			}),
		).toHaveAttribute("href", "/");
		expect(
			within(levels[1] as HTMLElement).getByRole("link", {
				name: "מועדים על הפרק",
			}),
		).toHaveAttribute("href", "/מועדים");
		expect(
			within(levels[2] as HTMLElement).getByRole("button", {
				name: "המועד הנוכחי: פורים. לחץ לבחירת מועד אחר",
			}),
		).toBeInTheDocument();
		expect(levels[2]).toHaveAttribute("aria-current", "page");

		// A moed has no single parent sefer — no invented middle level.
		expect(within(nav).queryByRole("button", { name: /ספר נוכחי/ })).toBeNull();
		expect(within(nav).queryByText("חלק")).toBeNull();
	});

	it("offers every published sibling by its canonical slug link", () => {
		render(<MoedBreadcrumb moed={CATALOGUE[2]} siblings={CATALOGUE} />);
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
		const button = within(nav).getByRole("button", {
			name: "המועד הנוכחי: פורים. לחץ לבחירת מועד אחר",
		});
		const drop = button.nextElementSibling as HTMLElement;

		const links = within(drop).getAllByRole("link");
		expect(links).toHaveLength(3);
		for (const sibling of CATALOGUE) {
			expect(
				within(drop).getByRole("link", { name: sibling.name }),
			).toHaveAttribute("href", `/מועדים/${sibling.slug}`);
		}
		// The current moed stays in the list carrying the page marker.
		expect(within(drop).getByRole("link", { name: "פורים" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(within(drop).getByRole("link", { name: "פסח" })).not.toHaveAttribute(
			"aria-current",
		);
	});
});
