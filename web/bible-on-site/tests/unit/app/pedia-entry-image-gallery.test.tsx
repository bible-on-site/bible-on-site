/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { EntryImageGallery } from "../../../src/app/pedia/components/EntryImageGallery";
import type {
	PediaImage,
	PediaImageLink,
} from "../../../src/lib/tanahpedia/types";

function image(over: Partial<PediaImage> = {}): PediaImage {
	return {
		imageId: "img-1",
		url: "https://cdn.example.com/avraham.jpg",
		width: 800,
		height: 600,
		altText: "דיוקן אברהם אבינו",
		caption: null,
		creator: null,
		creditLine: null,
		sourceName: null,
		sourceUrl: null,
		licenseName: null,
		licenseUrl: null,
		isPublicDomain: false,
		modifications: null,
		...over,
	};
}

function link(over: Partial<PediaImageLink> = {}): PediaImageLink {
	return {
		id: "link-1",
		ownerKind: "ENTRY",
		ownerId: "entry-1",
		sortOrder: 0,
		isPrimary: false,
		image: image(),
		...over,
	};
}

describe("EntryImageGallery (#3769)", () => {
	it("renders nothing when the entry has no images", () => {
		const { container } = render(
			<EntryImageGallery entryImages={[]} entityImages={[]} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders entry images first, then entity images, under the תמונות section", () => {
		render(
			<EntryImageGallery
				entryImages={[
					link({ id: "entry-link", image: image({ altText: "ערך" }) }),
				]}
				entityImages={[
					link({
						id: "entity-link",
						ownerKind: "ENTITY",
						ownerId: "ent-1",
						image: image({ altText: "ישות" }),
					}),
				]}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "תמונות" }),
		).toBeInTheDocument();
		const imgs = screen.getAllByRole("img");
		expect(imgs.map((img) => img.getAttribute("alt"))).toEqual([
			"ערך",
			"ישות",
		]);
	});

	it("joins caption and credit in the caption line", () => {
		render(
			<EntryImageGallery
				entryImages={[
					link({
						image: image({
							caption: "שמשון הגיבור",
							creditLine: "Wikimedia Commons",
						}),
					}),
				]}
				entityImages={[]}
			/>,
		);

		expect(
			screen.getByText("שמשון הגיבור · Wikimedia Commons"),
		).toBeInTheDocument();
	});

	it("falls back to the credit alone when there is no caption", () => {
		const { container } = render(
			<EntryImageGallery
				entryImages={[link({ image: image({ creator: "אמן" }) })]}
				entityImages={[]}
			/>,
		);
		// The credit line rides in the figcaption; the same value also shows
		// inside the provenance list, so assert the caption span itself.
		const credit = container.querySelector("figcaption > span");
		expect(credit?.textContent).toBe("אמן");
	});

	it("exposes the full provenance behind the ⓘ details, public domain distinct", () => {
		render(
			<EntryImageGallery
				entryImages={[
					link({
						image: image({
							creator: "יוצר לדוגמה",
							// Keeps the concise credit distinct from the creator so
							// provenance assertions match one element each.
							creditLine: "קרדיט",
							sourceName: "Wikimedia Commons",
							sourceUrl: "https://commons.example.com/f.jpg",
							isPublicDomain: true,
							modifications: "חיתוך מהמקור",
							altText: "דיוקן",
						}),
					}),
				]}
				entityImages={[]}
			/>,
		);

		expect(
			screen.getByLabelText("פרטי התמונה והקרדיט"),
		).toBeInTheDocument();
		expect(screen.getByText("יוצר/צלם")).toBeInTheDocument();
		expect(screen.getByText("יוצר לדוגמה")).toBeInTheDocument();
		// A public-domain asset shows נחלת הכלל, not a license name.
		expect(screen.getByText("נחלת הכלל")).toBeInTheDocument();
		expect(screen.getByText("חיתוך מהמקור")).toBeInTheDocument();
		expect(screen.getByText(/תיאור: דיוקן/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Wikimedia Commons" })).toHaveAttribute(
			"href",
			"https://commons.example.com/f.jpg",
		);
	});

	it("shows a license link when the asset is licensed, not public domain", () => {
		render(
			<EntryImageGallery
				entryImages={[
					link({
						image: image({
							licenseName: "CC BY-SA 4.0",
							licenseUrl:
								"https://creativecommons.org/licenses/by-sa/4.0/",
						}),
					}),
				]}
				entityImages={[]}
			/>,
		);

		expect(
			screen.getByRole("link", { name: "CC BY-SA 4.0" }),
		).toHaveAttribute(
			"href",
			"https://creativecommons.org/licenses/by-sa/4.0/",
		);
		expect(screen.queryByText("נחלת הכלל")).not.toBeInTheDocument();
	});
});
