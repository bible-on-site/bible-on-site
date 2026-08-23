import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	createEntityMock,
	getEntryStructuralContextMock,
	removeEntityMock,
	replacePlaceIdentificationsMock,
	updateEntityDisplayNameMock,
	updatePersonMainNameMock,
	updatePersonSexMock,
} = vi.hoisted(() => ({
	createEntityMock: vi.fn(),
	getEntryStructuralContextMock: vi.fn(),
	removeEntityMock: vi.fn(),
	replacePlaceIdentificationsMock: vi.fn(),
	updateEntityDisplayNameMock: vi.fn(),
	updatePersonMainNameMock: vi.fn(),
	updatePersonSexMock: vi.fn(),
}));

vi.mock("~/server/tanahpedia/structural", () => ({
	getEntryStructuralContext: getEntryStructuralContextMock,
	createEntityAndLinkToEntry: createEntityMock,
	updateEntityDisplayName: updateEntityDisplayNameMock,
	updatePersonMainName: updatePersonMainNameMock,
	updatePersonSex: updatePersonSexMock,
	replacePlaceIdentifications: replacePlaceIdentificationsMock,
	searchEntities: vi.fn().mockResolvedValue([]),
	linkExistingEntityToEntry: vi.fn(),
}));

vi.mock("~/server/tanahpedia/entries", () => ({
	removeEntity: removeEntityMock,
}));

import { EntryStructuralPanel } from "~/components/tanahpedia/EntryStructuralPanel";
import { ENTITY_TYPE_LABELS } from "~/lib/tanahpedia/labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "~/lib/tanahpedia/schema-registry";

function renderPanel() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<EntryStructuralPanel entryId="entry-1" />
		</QueryClientProvider>,
	);
}

describe("EntryStructuralPanel", () => {
	beforeEach(() => {
		getEntryStructuralContextMock.mockReset().mockResolvedValue({
			entryId: "entry-1",
			linkedEntities: [],
		});
		for (const mock of [
			createEntityMock,
			removeEntityMock,
			replacePlaceIdentificationsMock,
			updateEntityDisplayNameMock,
			updatePersonMainNameMock,
			updatePersonSexMock,
		]) {
			mock.mockReset().mockResolvedValue({ ok: true });
		}
		vi.stubGlobal(
			"confirm",
			vi.fn(() => true),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("entity type options", () => {
		it("offers every creatable entity type", async () => {
			renderPanel();
			const select = await screen.findByLabelText("סוג");

			const offered = Array.from(
				select.querySelectorAll("option"),
				(option) => option.value,
			);
			expect(offered).toEqual([...ADMIN_CREATABLE_ENTITY_TYPES]);
		});

		it("is no longer limited to people and places", async () => {
			renderPanel();
			const select = await screen.findByLabelText("סוג");

			const labels = Array.from(
				select.querySelectorAll("option"),
				(option) => option.textContent,
			);
			expect(labels).toContain(ENTITY_TYPE_LABELS.NATION);
			expect(labels).toContain(ENTITY_TYPE_LABELS.WAR);
			expect(labels.length).toBeGreaterThan(2);
		});
	});

	describe("linking an existing entity", () => {
		it("offers the existing-entity search", async () => {
			renderPanel();
			expect(
				await screen.findByLabelText("או קשר יישות קיימת"),
			).toBeInTheDocument();
		});
	});

	describe("creating an entity", () => {
		it("trims the name, uses the selected type, and clears the form", async () => {
			renderPanel();
			const type = await screen.findByLabelText("סוג");
			const name = screen.getByLabelText("שם ראשוני");

			fireEvent.change(type, { target: { value: "WAR" } });
			fireEvent.change(name, { target: { value: "  מלחמת המלכים  " } });
			fireEvent.click(screen.getByRole("button", { name: "צור וקשר לערך" }));

			await waitFor(() =>
				expect(createEntityMock).toHaveBeenCalledWith({
					data: {
						entryId: "entry-1",
						entityType: "WAR",
						displayName: "מלחמת המלכים",
					},
				}),
			);
			await waitFor(() => expect(name).toHaveValue(""));
		});

		it("shows a server error from entity creation", async () => {
			createEntityMock.mockRejectedValue(new Error("duplicate entity"));
			renderPanel();
			const name = await screen.findByLabelText("שם ראשוני");

			fireEvent.change(name, { target: { value: "כפילות" } });
			fireEvent.click(screen.getByRole("button", { name: "צור וקשר לערך" }));

			expect(await screen.findByText("duplicate entity")).toBeInTheDocument();
		});
	});

	describe("linked entity cards", () => {
		beforeEach(() => {
			getEntryStructuralContextMock.mockResolvedValue({
				entryId: "entry-1",
				linkedEntities: [
					{
						linkId: "person-link",
						entityId: "person-entity",
						entityType: "PERSON",
						displayName: "משה",
						person: {
							personId: "person-id",
							mainName: "משה",
							mainNameRowId: "main-name-row",
							sex: "MALE",
							sexRowId: "sex-row",
						},
						place: null,
					},
					{
						linkId: "place-link",
						entityId: "place-entity",
						entityType: "PLACE",
						displayName: "ירושלים",
						person: null,
						place: {
							placeId: "place-id",
							identifications: [
								{
									id: "identification-id",
									modern_name: "Jerusalem",
									latitude: 31.77,
									longitude: 35.23,
								},
							],
						},
					},
					{
						linkId: "nation-link",
						entityId: "nation-entity",
						entityType: "NATION",
						displayName: "ישראל",
						person: null,
						place: null,
					},
				],
			});
		});

		it("edits and removes a linked person", async () => {
			renderPanel();
			const id = await screen.findByText("person-entity");
			const card = id.closest("div.rounded-lg");
			if (!card) throw new Error("Expected person card");
			const controls = within(card as HTMLElement);

			fireEvent.change(controls.getByLabelText(/tanahpedia_entity.name/), {
				target: { value: "משה רבנו" },
			});
			fireEvent.click(controls.getByRole("button", { name: "שמור שם יישות" }));
			await waitFor(() =>
				expect(updateEntityDisplayNameMock).toHaveBeenCalledWith({
					data: { entityId: "person-entity", name: "משה רבנו" },
				}),
			);
			fireEvent.change(controls.getByLabelText(/person_name/), {
				target: { value: "משה בן עמרם" },
			});
			fireEvent.click(controls.getByRole("button", { name: "שמור שם איש" }));
			await waitFor(() =>
				expect(updatePersonMainNameMock).toHaveBeenCalledWith({
					data: {
						personId: "person-id",
						name: "משה בן עמרם",
						mainNameRowId: "main-name-row",
					},
				}),
			);
			fireEvent.change(controls.getByLabelText(/person_sex/), {
				target: { value: "UNKNOWN" },
			});
			fireEvent.click(controls.getByRole("button", { name: "שמור מין" }));
			await waitFor(() =>
				expect(updatePersonSexMock).toHaveBeenCalledWith({
					data: { personId: "person-id", sex: "UNKNOWN", sexRowId: "sex-row" },
				}),
			);
			fireEvent.click(controls.getByRole("button", { name: "הסר קישור" }));

			await waitFor(() => {
				expect(removeEntityMock).toHaveBeenCalledWith({ data: "person-link" });
			});
		});

		it("edits place identifications including a newly added row", async () => {
			renderPanel();
			const id = await screen.findByText("place-entity");
			const card = id.closest("div.rounded-lg");
			if (!card) throw new Error("Expected place card");
			const controls = within(card as HTMLElement);

			fireEvent.change(controls.getByLabelText(/tanahpedia_entity.name/), {
				target: { value: "ירושלים העיר" },
			});
			fireEvent.click(controls.getByRole("button", { name: "שמור שם יישות" }));
			await waitFor(() =>
				expect(updateEntityDisplayNameMock).toHaveBeenCalledWith({
					data: { entityId: "place-entity", name: "ירושלים העיר" },
				}),
			);
			fireEvent.change(controls.getByPlaceholderText("שם מודרני"), {
				target: { value: "Jerusalem City" },
			});
			fireEvent.change(controls.getByPlaceholderText("latitude"), {
				target: { value: "31.8" },
			});
			fireEvent.change(controls.getByPlaceholderText("longitude"), {
				target: { value: "" },
			});
			fireEvent.click(controls.getByRole("button", { name: "+ שורה" }));

			const modernNames = controls.getAllByPlaceholderText("שם מודרני");
			fireEvent.change(modernNames[1], { target: { value: "Zion" } });
			fireEvent.click(controls.getByRole("button", { name: "שמור זיהויים" }));

			await waitFor(() =>
				expect(replacePlaceIdentificationsMock).toHaveBeenCalledWith({
					data: {
						placeId: "place-id",
						rows: [
							{
								id: "identification-id",
								modern_name: "Jerusalem City",
								latitude: 31.8,
								longitude: null,
							},
							expect.objectContaining({ id: undefined, modern_name: "Zion" }),
						],
					},
				}),
			);
			fireEvent.click(controls.getByRole("button", { name: "הסר קישור" }));

			await waitFor(() => {
				expect(removeEntityMock).toHaveBeenCalledWith({ data: "place-link" });
			});
		});

		it("edits, removes, and unlinks a generic entity", async () => {
			renderPanel();
			const id = await screen.findByText("nation-entity");
			const card = id.closest("div.rounded-lg");
			if (!card) throw new Error("Expected generic entity card");
			const controls = within(card as HTMLElement);
			const input = card.querySelector("input");
			if (!input) throw new Error("Expected generic entity name input");

			fireEvent.change(input, { target: { value: "עם ישראל" } });
			fireEvent.click(controls.getByRole("button", { name: "שמור שם יישות" }));
			fireEvent.click(controls.getByRole("button", { name: "הסר קישור" }));

			await waitFor(() => {
				expect(updateEntityDisplayNameMock).toHaveBeenCalledWith({
					data: { entityId: "nation-entity", name: "עם ישראל" },
				});
				expect(removeEntityMock).toHaveBeenCalledWith({ data: "nation-link" });
			});
		});
	});

	describe("loading failures", () => {
		it("shows the loading spinner while context is pending", () => {
			getEntryStructuralContextMock.mockReturnValue(
				new Promise(() => undefined),
			);
			const { container } = renderPanel();

			expect(container.querySelector(".animate-spin")).toBeInTheDocument();
		});

		it("shows the context error", async () => {
			getEntryStructuralContextMock.mockRejectedValue(
				new Error("context down"),
			);
			renderPanel();

			expect(
				await screen.findByText(
					/שגיאה בטעינת מבנה יישויות: Error: context down/,
				),
			).toBeInTheDocument();
		});
	});
});
