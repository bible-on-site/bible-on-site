/**
 * @jest-environment jsdom
 *
 * Tests for the client-side media modals exercised for the first time
 * by the opengraph e2e routes (#2631): the journalism masonry gallery
 * lightbox (item selection, RTL arrow navigation, close affordances)
 * and the rabbis-blessing poster lightbox.
 */

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { JournalismGallery } from "../../../src/app/journalism/JournalismGallery";
import { ImageLightbox } from "../../../src/app/rabbis-blessing/ImageLightbox";

const ITEMS = [
	{
		id: 1,
		title: "כתבה ראשונה",
		description: "תיאור ראשון",
		imageUrl: "/images/journalism/1.jpg",
	},
	{
		id: 2,
		title: "כתבה שנייה",
		description: "תיאור שני",
		imageUrl: "/images/journalism/2.jpg",
	},
];

const openModal = () => {
	fireEvent.click(screen.getAllByRole("button")[0]);
	return screen.getByRole("dialog");
};

describe("JournalismGallery", () => {
	describe("when an item is selected", () => {
		it("opens the modal with the item's title and image", () => {
			render(<JournalismGallery items={ITEMS} />);

			const dialog = openModal();

			expect(dialog).toHaveAttribute("aria-label", "כתבה ראשונה");
			expect(
				screen.getByRole("img", { name: "כתבה ראשונה" }),
			).toBeInTheDocument();
			expect(document.body.style.overflow).toBe("hidden");
		});

		it("closes via the close button and releases the scroll lock", () => {
			render(<JournalismGallery items={ITEMS} />);
			openModal();

			fireEvent.click(screen.getByRole("button", { name: "סגור" }));

			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
			expect(document.body.style.overflow).toBe("");
		});

		it("closes via the Escape key", () => {
			render(<JournalismGallery items={ITEMS} />);
			openModal();

			fireEvent.keyDown(document, { key: "Escape" });

			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});

		it("closes when the backdrop is clicked", () => {
			render(<JournalismGallery items={ITEMS} />);
			const dialog = openModal();

			fireEvent.click(dialog);

			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});

		it("stays open when the modal content is clicked", () => {
			render(<JournalismGallery items={ITEMS} />);
			const dialog = openModal();

			fireEvent.click(screen.getByRole("document"));

			expect(dialog).toBeInTheDocument();
		});

		it("closes on Enter and Space keydown on the backdrop", () => {
			render(<JournalismGallery items={ITEMS} />);
			let dialog = openModal();

			fireEvent.keyDown(dialog, { key: "Enter" });
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

			dialog = openModal();
			fireEvent.keyDown(dialog, { key: " " });
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});

		it("ignores unrelated keys on the backdrop", () => {
			render(<JournalismGallery items={ITEMS} />);
			const dialog = openModal();

			fireEvent.keyDown(dialog, { key: "Tab" });

			expect(dialog).toBeInTheDocument();
		});

		it("navigates forward with the next button and wraps around", () => {
			render(<JournalismGallery items={ITEMS} />);
			const dialog = openModal();

			fireEvent.click(screen.getByRole("button", { name: "הבא" }));
			expect(dialog).toHaveAttribute("aria-label", "כתבה שנייה");

			fireEvent.click(screen.getByRole("button", { name: "הבא" }));
			expect(dialog).toHaveAttribute("aria-label", "כתבה ראשונה");
		});

		it("navigates backward with the previous button and wraps around", () => {
			render(<JournalismGallery items={ITEMS} />);
			const dialog = openModal();

			fireEvent.click(screen.getByRole("button", { name: "הקודם" }));

			expect(dialog).toHaveAttribute("aria-label", "כתבה שנייה");
		});

		it("navigates with RTL arrow keys", () => {
			render(<JournalismGallery items={ITEMS} />);
			const dialog = openModal();

			fireEvent.keyDown(document, { key: "ArrowLeft" });
			expect(dialog).toHaveAttribute("aria-label", "כתבה שנייה");

			fireEvent.keyDown(document, { key: "ArrowRight" });
			expect(dialog).toHaveAttribute("aria-label", "כתבה ראשונה");

			fireEvent.keyDown(document, { key: "ArrowDown" });
			expect(dialog).toHaveAttribute("aria-label", "כתבה ראשונה");
		});
	});

	describe("when a single item exists", () => {
		it("opens the modal without navigation buttons", () => {
			render(<JournalismGallery items={[ITEMS[0]]} />);
			const dialog = openModal();

			expect(dialog).toHaveAttribute("aria-label", "כתבה ראשונה");
			expect(
				screen.queryByRole("button", { name: "הבא" }),
			).not.toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: "הקודם" }),
			).not.toBeInTheDocument();
		});
	});
});

describe("ImageLightbox", () => {
	const renderLightbox = () =>
		render(
			<ImageLightbox
				src="/images/blessing.jpg"
				alt="ברכת הרבנים"
				width={1200}
				height={630}
			/>,
		);

	describe("when the poster is clicked", () => {
		it("opens the modal and locks body scroll", () => {
			renderLightbox();

			fireEvent.click(screen.getByRole("button"));
			const dialog = screen.getByRole("dialog");

			expect(dialog).toHaveAttribute("aria-label", "ברכת הרבנים");
			expect(document.body.style.overflow).toBe("hidden");
		});

		it("closes via the close button and releases the scroll lock", () => {
			renderLightbox();
			fireEvent.click(screen.getByRole("button"));

			fireEvent.click(screen.getByRole("button", { name: "סגור" }));

			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
			expect(document.body.style.overflow).toBe("");
		});

		it("closes via the Escape key", () => {
			renderLightbox();
			fireEvent.click(screen.getByRole("button"));

			fireEvent.keyDown(document, { key: "Escape" });

			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});

		it("ignores unrelated keys while open", () => {
			renderLightbox();
			fireEvent.click(screen.getByRole("button"));

			fireEvent.keyDown(document, { key: "Tab" });

			expect(screen.getByRole("dialog")).toBeInTheDocument();
		});

		it("closes on backdrop click and Enter keydown", () => {
			renderLightbox();

			fireEvent.click(screen.getByRole("button"));
			fireEvent.click(screen.getByRole("dialog"));
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

			fireEvent.click(screen.getByRole("button"));
			fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

			fireEvent.click(screen.getByRole("button"));
			fireEvent.keyDown(screen.getByRole("dialog"), { key: " " });
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});

		it("stays open when the modal content is clicked", () => {
			renderLightbox();
			fireEvent.click(screen.getByRole("button"));

			fireEvent.click(screen.getByRole("document"));

			expect(screen.getByRole("dialog")).toBeInTheDocument();
		});
	});
});
