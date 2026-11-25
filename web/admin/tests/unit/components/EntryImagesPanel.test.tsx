import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getEntryImageBundle: vi.fn(),
	putImageAsset: vi.fn(),
	putImageLink: vi.fn(),
	removeImageLink: vi.fn(),
	clearPrimaryImage: vi.fn(),
	uploadPediaImageFile: vi.fn(),
}));

vi.mock("~/server/tanahpedia/images", () => ({
	getEntryImageBundle: mocks.getEntryImageBundle,
	putImageAsset: mocks.putImageAsset,
	putImageLink: mocks.putImageLink,
	removeImageLink: mocks.removeImageLink,
	clearPrimaryImage: mocks.clearPrimaryImage,
}));

vi.mock("~/server/s3", () => ({
	uploadPediaImageFile: mocks.uploadPediaImageFile,
}));

vi.mock("~/components/UndoToast", () => ({
	useUndoAction: () => (action: { commit: () => void }) => action.commit(),
}));

import { EntryImagesPanel } from "~/components/tanahpedia/EntryImagesPanel";
import type {
	EntryImageBundle,
	PediaImageLinkView,
} from "~/server/tanahpedia/images";

function asset(over: Record<string, unknown> = {}) {
	return {
		imageId: "img-1",
		url: "https://cdn.example.com/image.jpg",
		width: 800,
		height: 600,
		altText: "תיאור תמונה",
		caption: "כיתוב",
		creator: "יוצר",
		creditLine: "קרדיט",
		sourceName: "מקור",
		sourceUrl: "https://source.example.com/item",
		licenseName: "CC BY-SA 4.0",
		licenseUrl: "https://license.example.com/",
		isPublicDomain: false,
		modifications: null,
		permissionEvidence: "evidence",
		isPublic: true,
		revision: 5,
		...over,
	};
}

function link(over: Partial<PediaImageLinkView> = {}): PediaImageLinkView {
	return {
		id: "link-1",
		ownerKind: "ENTRY",
		ownerId: "entry-1",
		sortOrder: 0,
		isPrimary: true,
		image: asset(),
		...over,
	};
}

function bundle(): EntryImageBundle {
	return {
		entryLinks: [
			link(),
			link({
				id: "link-2",
				sortOrder: 1,
				isPrimary: false,
				image: asset({ imageId: "img-2", altText: "תמונה שנייה", isPublic: false }),
			}),
		],
		entityGroups: [
			{
				entityId: "entity-1",
				entityType: "PERSON",
				entityName: "אברהם",
				links: [
					link({
						id: "entity-link",
						ownerKind: "ENTITY",
						ownerId: "entity-1",
						isPrimary: false,
						image: asset({ imageId: "entity-img", altText: "תמונת ישות" }),
					}),
				],
			},
		],
	};
}

function renderPanel(data: EntryImageBundle | undefined = bundle()) {
	mocks.getEntryImageBundle.mockResolvedValue(data);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const result = render(
		<QueryClientProvider client={client}>
			<EntryImagesPanel entryId="entry-1" />
		</QueryClientProvider>,
	);
	return { client, ...result };
}

describe("EntryImagesPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.putImageAsset.mockResolvedValue({ imageId: "img-new" });
	});

	it("renders entry and entity scopes with publication and primary state", async () => {
		renderPanel();
		expect(await screen.findByText("תמונת ישות")).toBeTruthy();
		expect(screen.getByText("תמונות הערך")).toBeTruthy();
		expect(screen.getByText("תמונות אברהם")).toBeTruthy();
		expect(screen.getByText("ראשית")).toBeTruthy();
		expect(screen.getByText("לא פורסמה")).toBeTruthy();
		expect(screen.getAllByText("קרדיט").length).toBeGreaterThan(0);
	});

	it("reorders, promotes, cross-links, clears primary, and removes links", async () => {
		renderPanel();
		await screen.findByText("תמונת ישות");

		const firstArgs = (mock: { mock: { calls: unknown[][] } }) =>
			mock.mock.calls.map((call) => call[0]);

		fireEvent.click(screen.getAllByText("↓ אחור")[0]);
		await waitFor(() => expect(mocks.putImageLink).toHaveBeenCalled());
		expect(firstArgs(mocks.putImageLink)).toContainEqual({
			data: { id: "link-1", ownerKind: "ENTRY", ownerId: "entry-1", sortOrder: 1 },
		});
		expect(firstArgs(mocks.putImageLink)).toContainEqual({
			data: { id: "link-2", ownerKind: "ENTRY", ownerId: "entry-1", sortOrder: 0 },
		});

		fireEvent.click(screen.getAllByText("הפוך לראשית")[0]);
		await waitFor(() =>
			expect(firstArgs(mocks.putImageLink)).toContainEqual({
				data: { id: "link-2", ownerKind: "ENTRY", ownerId: "entry-1", isPrimary: true },
			}),
		);

		fireEvent.click(screen.getByText("קשר גם לערך"));
		await waitFor(() =>
			expect(firstArgs(mocks.putImageLink)).toContainEqual({
				data: { ownerKind: "ENTRY", ownerId: "entry-1", imageId: "entity-img" },
			}),
		);

		fireEvent.click(screen.getAllByText("בטל תמונה ראשית")[0]);
		await waitFor(() =>
			expect(firstArgs(mocks.clearPrimaryImage)).toContainEqual({
				data: { ownerKind: "ENTRY", ownerId: "entry-1" },
			}),
		);

		fireEvent.click(screen.getAllByText("הסר קישור")[0]);
		await waitFor(() =>
			expect(firstArgs(mocks.removeImageLink)).toContainEqual({
				data: { ownerKind: "ENTRY", id: "link-1" },
			}),
		);
	});

	it("edits every asset field and saves without attaching again", async () => {
		const { container } = renderPanel();
		await screen.findByText("תמונת ישות");
		fireEvent.click(screen.getAllByText("ערוך פרטים")[0]);
		expect(screen.getByText("עריכת פרטי תמונה")).toBeTruthy();

		for (const input of Array.from(
			container.querySelectorAll<HTMLInputElement>("input"),
		).filter((input) => input.type !== "file" && input.type !== "checkbox")) {
			fireEvent.change(input, { target: { value: input.inputMode === "numeric" ? "640" : "נערך" } });
		}
		for (const checkbox of Array.from(
			container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
		)) {
			fireEvent.click(checkbox);
		}
		fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, {
			target: { value: "ראיות חדשות" },
		});
		fireEvent.click(screen.getByText("שמור תמונה"));

		await waitFor(() => expect(mocks.putImageAsset).toHaveBeenCalled());
		expect(mocks.putImageAsset).toHaveBeenCalledWith({
			data: expect.objectContaining({
				id: "img-1",
				revision: 5,
				width: 640,
				height: 640,
				permissionEvidence: "ראיות חדשות",
				isPublic: false,
				isPublicDomain: true,
			}),
		});
		expect(mocks.putImageLink).not.toHaveBeenCalled();
	});

	it("creates an asset and attaches it to the entry", async () => {
		const { container } = renderPanel({ entryLinks: [], entityGroups: [] });
		expect(await screen.findAllByText("אין תמונות מקושרות.")).toHaveLength(1);
		fireEvent.click(screen.getByText("+ הוסף תמונה"));
		expect(screen.getByText(/תמונה חדשה/)).toBeTruthy();
		const inputs = Array.from(
			container.querySelectorAll<HTMLInputElement>("input"),
		).filter((input) => input.type !== "file" && input.type !== "checkbox");
		fireEvent.change(inputs[0], { target: { value: "https://cdn.example.com/new.jpg" } });
		fireEvent.change(inputs[1], { target: { value: "תיאור חדש" } });
		fireEvent.click(screen.getByText("שמור תמונה"));

		await waitFor(() => expect(mocks.putImageLink).toHaveBeenCalled());
		expect(mocks.putImageAsset).toHaveBeenCalledWith({
			data: expect.objectContaining({
				id: null,
				url: "https://cdn.example.com/new.jpg",
				altText: "תיאור חדש",
			}),
		});
		expect(mocks.putImageLink).toHaveBeenCalledWith({
			data: { ownerKind: "ENTRY", ownerId: "entry-1", imageId: "img-new" },
		});
	});

	it("surfaces mutation errors and cancels the editor", async () => {
		mocks.putImageAsset.mockRejectedValue(new Error("db failed"));
		renderPanel({ entryLinks: [], entityGroups: [] });
		await screen.findByText("אין תמונות מקושרות.");
		fireEvent.click(screen.getByText("+ הוסף תמונה"));
		fireEvent.click(screen.getByText("שמור תמונה"));
		expect(await screen.findByText(/שגיאת שרת/)).toBeTruthy();
		fireEvent.click(screen.getByText("בטל"));
		expect(screen.queryByText(/תמונה חדשה/)).toBeNull();
	});
});
