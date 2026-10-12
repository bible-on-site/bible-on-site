/**
 * @jest-environment jsdom
 */
jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		onClick,
		className,
	}: {
		children: React.ReactNode;
		href: string;
		onClick?: React.MouseEventHandler;
		className?: string;
	}) => (
		<a href={href} onClick={onClick} className={className}>
			{children}
		</a>
	),
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { PerushimSection } from "../../../src/app/929/[number]/components/PerushimSection";
import type { PerushSummary } from "../../../src/lib/perushim";

const samplePerushim: PerushSummary[] = [
	{ id: 1, name: 'רש"י', parshanName: 'רש"י', noteCount: 55 },
	{
		id: 14,
		name: "ביאור שטיינזלץ",
		parshanName: "עדין שטיינזלץ",
		noteCount: 31,
	},
];

describe("PerushimSection", () => {
	it("renders section header and empty message when no perushim", () => {
		render(<PerushimSection perekId={1} perushim={[]} />);
		expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
		expect(screen.getByText("אין פרשנות לפרק זה")).toBeTruthy();
	});

	it("shows an empty carousel when the database supplies null commentaries", () => {
		render(<PerushimSection perekId={1} perushim={null} />);
		expect(screen.getByText("אין פרשנות לפרק זה")).toBeVisible();
	});

	it("renders carousel links when perushim provided (SEO mode)", () => {
		render(<PerushimSection perekId={1} perushim={samplePerushim} />);
		expect(screen.getByRole("link", { name: /רש"י/ })).toBeTruthy();
		expect(screen.getByRole("link", { name: /ביאור שטיינזלץ/ })).toBeTruthy();
		expect(screen.getByText("55 פסוקים")).toBeTruthy();
	});

	it("renders decorative SVG icons instead of emoji", () => {
		const { container } = render(
			<PerushimSection perekId={1} perushim={[samplePerushim[0]]} />,
		);
		expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
		for (const src of ["/icons/open-book.svg", "/icons/note.svg"]) {
			const icon = container.querySelector(`img[src*="${src}"]`);
			expect(icon?.getAttribute("aria-hidden")).toBe("true");
		}
	});

	it("renders links with correct href for SEO", () => {
		render(<PerushimSection perekId={5} perushim={[samplePerushim[0]]} />);
		const link = screen.getByRole("link", { name: /רש"י/ });
		expect(link).toHaveAttribute(
			"href",
			`/929/5/${encodeURIComponent('רש"י')}`,
		);
	});

	// Regression coverage for #2115: carousel selection must navigate to the
	// dedicated perush page (top-of-page presentation) like article cards —
	// never expand a second full view below the scripture.
	it("lets a plain click navigate instead of expanding an inline view", () => {
		const pushStateSpy = jest.spyOn(history, "pushState");
		render(<PerushimSection perekId={1} perushim={[samplePerushim[0]]} />);
		const link = screen.getByRole("link", { name: /רש"י/ });

		// fireEvent.click returns false when the click's default is prevented.
		expect(fireEvent.click(link)).toBe(true);
		expect(pushStateSpy).not.toHaveBeenCalled();

		// The carousel stays; no in-place full view appears below the text.
		expect(screen.queryByText(/חזרה לפרשנים/)).toBeNull();
		expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
		pushStateSpy.mockRestore();
	});

	it("delegates to onPerushClick when provided (keeps crawlable links)", () => {
		const onPerushClick = jest.fn();
		render(
			<PerushimSection
				perekId={1}
				perushim={[samplePerushim[0]]}
				onPerushClick={onPerushClick}
			/>,
		);
		const link = screen.getByRole("link", { name: /רש"י/ });
		expect(link.getAttribute("href")).toBe(
			`/929/1/${encodeURIComponent('רש"י')}`,
		);
		// The delegated handler suppresses default navigation for in-place view.
		expect(fireEvent.click(link)).toBe(false);
		expect(onPerushClick).toHaveBeenCalledWith(samplePerushim[0]);
	});

	it("lets modifier-clicks follow the href instead of opening in place", () => {
		const onPerushClick = jest.fn();
		render(
			<PerushimSection
				perekId={1}
				perushim={[samplePerushim[0]]}
				onPerushClick={onPerushClick}
			/>,
		);
		const link = screen.getByRole("link", { name: /רש"י/ });

		fireEvent.click(link, { ctrlKey: true });

		expect(onPerushClick).not.toHaveBeenCalled();
	});

	it("shows the loading state instead of carousel items", () => {
		render(
			<PerushimSection
				perekId={1}
				perushim={samplePerushim}
				onPerushClick={jest.fn()}
				loading
			/>,
		);
		expect(screen.getByText("מתחבר לפירוש...")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});
});
