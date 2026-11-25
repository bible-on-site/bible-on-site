import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UndoToastProvider } from "~/components/UndoToast";

const {
	createEntityMock,
	deleteEntityExternalReferenceMock,
	getEntryStructuralContextMock,
	getPlacesMock,
	removeEntityMock,
	replacePlaceIdentificationsMock,
	updateEntityDisplayNameMock,
	updateFamilyPersonNodeMock,
	updatePersonMainNameMock,
	updatePersonSexMock,
	updateSayingDateMock,
	upsertEntityExternalReferenceMock,
} = vi.hoisted(() => ({
	createEntityMock: vi.fn(),
	deleteEntityExternalReferenceMock: vi.fn(),
	getEntryStructuralContextMock: vi.fn(),
	getPlacesMock: vi.fn(),
	removeEntityMock: vi.fn(),
	replacePlaceIdentificationsMock: vi.fn(),
	updateEntityDisplayNameMock: vi.fn(),
	updateFamilyPersonNodeMock: vi.fn(),
	updatePersonMainNameMock: vi.fn(),
	updatePersonSexMock: vi.fn(),
	updateSayingDateMock: vi.fn(),
	upsertEntityExternalReferenceMock: vi.fn(),
}));

vi.mock("~/server/tanahpedia/structural", () => ({
	getEntryStructuralContext: getEntryStructuralContextMock,
	createEntityAndLinkToEntry: createEntityMock,
	updateEntityDisplayName: updateEntityDisplayNameMock,
	updatePersonMainName: updatePersonMainNameMock,
	updatePersonSex: updatePersonSexMock,
	updateSayingDate: updateSayingDateMock,
	replacePlaceIdentifications: replacePlaceIdentificationsMock,
	searchEntities: vi.fn().mockResolvedValue([]),
	linkExistingEntityToEntry: vi.fn(),
}));

vi.mock("~/server/tanahpedia/entries", () => ({
	removeEntity: removeEntityMock,
}));

vi.mock("~/server/tanahpedia/family", () => ({
	updateFamilyPersonNode: updateFamilyPersonNodeMock,
}));

vi.mock("~/server/tanahpedia/places", () => ({
	getPlaces: getPlacesMock,
}));

vi.mock("~/server/tanahpedia/external-references", () => ({
	upsertEntityExternalReference: upsertEntityExternalReferenceMock,
	deleteEntityExternalReference: deleteEntityExternalReferenceMock,
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
			<UndoToastProvider durationMs={30}>
				<EntryStructuralPanel entryId="entry-1" />
			</UndoToastProvider>
		</QueryClientProvider>,
	);
}

describe("EntryStructuralPanel", () => {
	beforeEach(() => {
		getEntryStructuralContextMock.mockReset().mockResolvedValue({
			entryId: "entry-1",
			linkedEntities: [],
		});
		getPlacesMock.mockReset().mockResolvedValue([]);
		for (const mock of [
			createEntityMock,
			deleteEntityExternalReferenceMock,
			removeEntityMock,
			replacePlaceIdentificationsMock,
			updateEntityDisplayNameMock,
			updateFamilyPersonNodeMock,
			updatePersonMainNameMock,
			updatePersonSexMock,
			updateSayingDateMock,
			upsertEntityExternalReferenceMock,
		]) {
			mock.mockReset().mockResolvedValue({ ok: true });
		}
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

		it("stringifies a non-Error rejection from entity creation", async () => {
			createEntityMock.mockRejectedValue("raw create failure");
			renderPanel();
			const name = await screen.findByLabelText("שם ראשוני");

			fireEvent.change(name, { target: { value: "ערך" } });
			fireEvent.click(screen.getByRole("button", { name: "צור וקשר לערך" }));

			expect(await screen.findByText("raw create failure")).toBeInTheDocument();
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
							birthPlace: null,
							deathPlace: null,
							activityPlaces: [],
						},
						place: null,
						externalReferences: [
							{
								source: "WIKIDATA",
								url: "https://www.wikidata.org/wiki/Q9181",
							},
							{
								source: "SEFARIA",
								url: "https://www.sefaria.org/topics/abraham",
							},
						],
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
						externalReferences: [],
					},
					{
						linkId: "nation-link",
						entityId: "nation-entity",
						entityType: "NATION",
						displayName: "ישראל",
						person: null,
						place: null,
						externalReferences: [],
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

		it("saves linked and free-text person place facts", async () => {
			getPlacesMock.mockResolvedValue([
				{ id: "place-1", entity_id: "place-entity", name: "ירושלים" },
			]);
			renderPanel();
			const id = await screen.findByText("person-entity");
			const card = id.closest("div.rounded-lg");
			if (!card) throw new Error("Expected person card");
			const controls = within(card as HTMLElement);

			// Free-text birth place: pick the text option then type the name.
			fireEvent.change(await controls.findByLabelText("מקום לידה"), {
				target: { value: "__free_text__" },
			});
			fireEvent.change(controls.getByPlaceholderText("שם המקום"), {
				target: { value: " דבינסק " },
			});
			// Linked death place from the catalogue.
			fireEvent.change(controls.getByLabelText("מקום פטירה"), {
				target: { value: "place-1" },
			});
			// One activity place, linked.
			fireEvent.click(controls.getByRole("button", { name: "+ מקום" }));
			const activitySelect = card.querySelector(
				'select[id^="ap-person-entity-"]',
			);
			if (!activitySelect) throw new Error("Expected activity place select");
			fireEvent.change(activitySelect, { target: { value: "place-1" } });
			fireEvent.click(controls.getByRole("button", { name: "שמור מקומות" }));

			await waitFor(() =>
				expect(updateFamilyPersonNodeMock).toHaveBeenCalledWith({
					data: {
						entityId: "person-entity",
						birthPlaceId: null,
						birthPlaceText: "דבינסק",
						deathPlaceId: "place-1",
						deathPlaceText: null,
						activityPlaces: [{ placeId: "place-1", placeText: null }],
					},
				}),
			);
		});

		it("rejects saving an empty free-text place fact", async () => {
			renderPanel();
			const id = await screen.findByText("person-entity");
			const card = id.closest("div.rounded-lg");
			if (!card) throw new Error("Expected person card");
			const controls = within(card as HTMLElement);

			fireEvent.change(await controls.findByLabelText("מקום לידה"), {
				target: { value: "__free_text__" },
			});
			fireEvent.click(controls.getByRole("button", { name: "שמור מקומות" }));

			expect(await controls.findByRole("alert")).toHaveTextContent(
				"הזן טקסט חופשי או בחר מקום מקושר",
			);
			expect(updateFamilyPersonNodeMock).not.toHaveBeenCalled();
		});

		it("renders stored place facts, edits rows, and clears facts", async () => {
			getPlacesMock.mockResolvedValue([
				{ id: "place-1", entity_id: "place-entity", name: "ירושלים" },
			]);
			getEntryStructuralContextMock.mockResolvedValue({
				entryId: "entry-1",
				linkedEntities: [
					{
						linkId: "person-link",
						entityId: "person-entity",
						entityType: "PERSON",
						displayName: "יעקב",
						person: {
							personId: "person-id",
							mainName: "יעקב",
							mainNameRowId: "main-name-row",
							sex: "MALE",
							sexRowId: "sex-row",
							// Linked to a place missing from the catalogue.
							birthPlace: {
								id: "b1",
								placeId: "place-9",
								placeText: null,
								placeName: "ארץ ישראל",
							},
							deathPlace: {
								id: "d1",
								placeId: null,
								placeText: "מצרים",
								placeName: null,
							},
							activityPlaces: [
								// Linked to a place missing from the catalogue, no name.
								{
									id: "a1",
									placeId: "place-8",
									placeText: null,
									placeName: null,
								},
								{ id: "a2", placeId: null, placeText: "חרן", placeName: null },
								// A row without a persisted id gets a positional key.
								{
									id: "",
									placeId: "place-1",
									placeText: null,
									placeName: "ירושלים",
								},
								// A degenerate row with neither id nor text
								// renders as an empty free-text draft.
								{
									id: "a4",
									placeId: null,
									placeText: null,
									placeName: null,
								},
							],
						},
						place: null,
						externalReferences: [],
					},
				],
			});
			renderPanel();
			const id = await screen.findByText("person-entity");
			const card = id.closest("div.rounded-lg");
			if (!card) throw new Error("Expected person card");
			const controls = within(card as HTMLElement);

			// A linked place missing from the catalogue keeps an option carrying
			// the stored entity name so the select stays coherent.
			const birthSelect = (await controls.findByLabelText(
				"מקום לידה",
			)) as HTMLSelectElement;
			expect(birthSelect).toHaveValue("place-9");
			expect(
				within(birthSelect).getByRole("option", { name: "ארץ ישראל" }),
			).toBeInTheDocument();

			// Free-text death and activity places show their stored text inputs.
			expect(controls.getByLabelText("מקום פטירה")).toHaveValue(
				"__free_text__",
			);
			const textInputs = controls.getAllByPlaceholderText("שם המקום");
			expect(textInputs[0]).toHaveValue("מצרים");
			expect(textInputs[1]).toHaveValue("חרן");
			expect(textInputs[2]).toHaveValue("");

			const activitySelects = () =>
				Array.from(
					card.querySelectorAll('select[id^="ap-person-entity-"]'),
				) as HTMLSelectElement[];
			expect(activitySelects()).toHaveLength(4);
			// placeName null → the fallback option shows the raw place id.
			expect(activitySelects()[0]).toHaveValue("place-8");
			expect(
				within(activitySelects()[0]).getByRole("option", { name: "place-8" }),
			).toBeInTheDocument();
			expect(activitySelects()[1]).toHaveValue("__free_text__");
			expect(activitySelects()[2]).toHaveValue("place-1");
			expect(activitySelects()[3]).toHaveValue("__free_text__");

			// Retarget the first activity row and delete the last two —
			// the degenerate empty row would fail validation on save.
			fireEvent.change(activitySelects()[0], { target: { value: "place-1" } });
			fireEvent.click(controls.getAllByRole("button", { name: "מחק" })[3]);
			fireEvent.click(controls.getAllByRole("button", { name: "מחק" })[2]);
			expect(activitySelects()).toHaveLength(2);

			fireEvent.click(controls.getByRole("button", { name: "שמור מקומות" }));
			await waitFor(() =>
				expect(updateFamilyPersonNodeMock).toHaveBeenCalledWith({
					data: {
						entityId: "person-entity",
						birthPlaceId: "place-9",
						birthPlaceText: null,
						deathPlaceId: null,
						deathPlaceText: "מצרים",
						activityPlaces: [
							{ placeId: "place-1", placeText: null },
							{ placeId: null, placeText: "חרן" },
						],
					},
				}),
			);

			// Clearing a fact via the "-" option sends nulls on save.
			fireEvent.change(birthSelect, { target: { value: "" } });
			fireEvent.change(controls.getByLabelText("מקום פטירה"), {
				target: { value: "" },
			});
			fireEvent.click(controls.getByRole("button", { name: "שמור מקומות" }));
			await waitFor(() =>
				expect(updateFamilyPersonNodeMock).toHaveBeenCalledWith({
					data: {
						entityId: "person-entity",
						birthPlaceId: null,
						birthPlaceText: null,
						deathPlaceId: null,
						deathPlaceText: null,
						activityPlaces: [
							{ placeId: "place-1", placeText: null },
							{ placeId: null, placeText: "חרן" },
						],
					},
				}),
			);
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

		it("renders empty fields for a person and place row with null details", async () => {
			getEntryStructuralContextMock.mockResolvedValue({
				entryId: "entry-1",
				linkedEntities: [
					{
						linkId: "person-link",
						entityId: "person-entity",
						entityType: "PERSON",
						displayName: "אלמני",
						person: {
							personId: "person-id",
							mainName: null,
							mainNameRowId: null,
							sex: null,
							sexRowId: null,
							birthPlace: null,
							deathPlace: null,
							activityPlaces: [],
						},
						place: null,
						externalReferences: [],
					},
					{
						linkId: "place-link",
						entityId: "place-entity",
						entityType: "PLACE",
						displayName: "מקום",
						person: null,
						place: {
							placeId: "place-id",
							identifications: [
								{
									id: "",
									modern_name: null,
									latitude: null,
									longitude: null,
								},
							],
						},
						externalReferences: [],
					},
				],
			});
			renderPanel();

			const personId = await screen.findByText("person-entity");
			const personCard = personId.closest("div.rounded-lg") as HTMLElement;
			const personControls = within(personCard);
			expect(personControls.getByLabelText(/person_name/)).toHaveValue("");
			expect(personControls.getByLabelText(/person_sex/)).toHaveValue("");
			expect(
				personControls.getByRole("button", { name: "שמור מין" }),
			).toBeDisabled();

			const placeId = await screen.findByText("place-entity");
			const placeCard = placeId.closest("div.rounded-lg") as HTMLElement;
			const placeControls = within(placeCard);
			expect(placeControls.getByPlaceholderText("שם מודרני")).toHaveValue("");
			// number inputs report valueAsNumber: empty is null
			expect(placeControls.getByPlaceholderText("latitude")).toHaveValue(null);
			expect(placeControls.getByPlaceholderText("longitude")).toHaveValue(null);
		});

		it("removes an identification row before saving", async () => {
			renderPanel();
			const id = await screen.findByText("place-entity");
			const card = id.closest("div.rounded-lg");
			if (!card) throw new Error("Expected place card");
			const controls = within(card as HTMLElement);

			fireEvent.click(controls.getByRole("button", { name: "+ שורה" }));
			expect(controls.getAllByPlaceholderText("שם מודרני")).toHaveLength(2);

			fireEvent.click(controls.getAllByRole("button", { name: "מחק" })[1]);
			expect(controls.getAllByPlaceholderText("שם מודרני")).toHaveLength(1);

			fireEvent.click(controls.getByRole("button", { name: "שמור זיהויים" }));
			await waitFor(() =>
				expect(replacePlaceIdentificationsMock).toHaveBeenCalledWith({
					data: {
						placeId: "place-id",
						rows: [
							{
								id: "identification-id",
								modern_name: "Jerusalem",
								latitude: 31.77,
								longitude: 35.23,
							},
						],
					},
				}),
			);
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

		it("keeps the link when the pending unlink is undone", async () => {
			renderPanel();
			const id = await screen.findByText("person-entity");
			const card = id.closest("div.rounded-lg");
			if (!card) throw new Error("Expected person card");

			fireEvent.click(
				within(card as HTMLElement).getByRole("button", {
					name: "הסר קישור",
				}),
			);

			const toast = await screen.findByRole("status");
			fireEvent.click(within(toast).getByRole("button", { name: "ביטול" }));
			await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
			expect(removeEntityMock).not.toHaveBeenCalled();
		});

		describe("external identifiers", () => {
			async function personCardElement() {
				const id = await screen.findByText("person-entity");
				const card = id.closest("div.rounded-lg");
				if (!card) throw new Error("Expected person card");
				return card as HTMLElement;
			}

			// The row of one source: its input plus the save/remove buttons that
			// sit next to it inside the same flex container.
			function sourceRow(card: HTMLElement, sourceLabel: string) {
				const input = within(card).getByLabelText(sourceLabel);
				const row = input.closest("div.flex");
				if (!row) throw new Error("Expected source row");
				return { input, row: within(row as HTMLElement) };
			}

			it("shows the section on every linked entity card with saved mappings", async () => {
				renderPanel();
				for (const entityId of [
					"person-entity",
					"place-entity",
					"nation-entity",
				]) {
					const el = await screen.findByText(entityId);
					const card = el.closest("div.rounded-lg") as HTMLElement;
					expect(within(card).getByText(/מזהים חיצוניים/)).toBeInTheDocument();
				}
				const card = await personCardElement();
				expect(sourceRow(card, "Wikidata").input).toHaveValue(
					"https://www.wikidata.org/wiki/Q9181",
				);
				expect(sourceRow(card, "Sefaria").input).toHaveValue(
					"https://www.sefaria.org/topics/abraham",
				);
				// The check-the-match link renders the saved URL with a readable id.
				const open = sourceRow(card, "Wikidata").row.getByRole("link", {
					name: /פתח Q9181/,
				});
				expect(open).toHaveAttribute(
					"href",
					"https://www.wikidata.org/wiki/Q9181",
				);
				expect(open).toHaveAttribute("target", "_blank");
			});

			it("adds a new mapping with a null snapshot", async () => {
				renderPanel();
				const { input, row } = sourceRow(
					await personCardElement(),
					"ויקיפדיה (אנגלית)",
				);

				fireEvent.change(input, {
					target: { value: "https://en.wikipedia.org/wiki/Abraham" },
				});
				fireEvent.click(row.getByRole("button", { name: "שמור" }));

				await waitFor(() =>
					expect(upsertEntityExternalReferenceMock).toHaveBeenCalledWith({
						data: {
							entityId: "person-entity",
							source: "WIKIPEDIA_EN",
							url: "https://en.wikipedia.org/wiki/Abraham",
							expectedUrl: null,
						},
					}),
				);
			});

			it("updates an existing mapping with the loaded URL as snapshot", async () => {
				renderPanel();
				const { input, row } = sourceRow(await personCardElement(), "Wikidata");

				fireEvent.change(input, { target: { value: "Q42" } });
				fireEvent.click(row.getByRole("button", { name: "שמור" }));

				await waitFor(() =>
					expect(upsertEntityExternalReferenceMock).toHaveBeenCalledWith({
						data: {
							entityId: "person-entity",
							source: "WIKIDATA",
							url: "Q42",
							expectedUrl: "https://www.wikidata.org/wiki/Q9181",
						},
					}),
				);
			});

			it("removes a mapping with the loaded URL as snapshot", async () => {
				renderPanel();
				const { row } = sourceRow(await personCardElement(), "Wikidata");

				fireEvent.click(row.getByRole("button", { name: "הסר" }));

				await waitFor(() =>
					expect(deleteEntityExternalReferenceMock).toHaveBeenCalledWith({
						data: {
							entityId: "person-entity",
							source: "WIKIDATA",
							expectedUrl: "https://www.wikidata.org/wiki/Q9181",
						},
					}),
				);
			});

			it("keeps the draft and shows the error when a save fails", async () => {
				upsertEntityExternalReferenceMock.mockRejectedValue(
					new Error("המיפוי השתנה על ידי עורך אחר"),
				);
				renderPanel();
				const card = await personCardElement();
				const { input, row } = sourceRow(card, "Wikidata");

				fireEvent.change(input, { target: { value: "Q42" } });
				fireEvent.click(row.getByRole("button", { name: "שמור" }));

				expect(await within(card).findByRole("alert")).toHaveTextContent(
					"המיפוי השתנה על ידי עורך אחר",
				);
				expect(input).toHaveValue("Q42");
			});

			it("keeps a draft when a save rejects with a plain message", async () => {
				upsertEntityExternalReferenceMock.mockRejectedValue("save unavailable");
				renderPanel();
				const card = await personCardElement();
				const { input, row } = sourceRow(card, "Wikidata");
				fireEvent.change(input, { target: { value: "Q42" } });
				fireEvent.click(row.getByRole("button", { name: "שמור" }));
				expect(await within(card).findByRole("alert")).toHaveTextContent(
					"save unavailable",
				);
				expect(input).toHaveValue("Q42");
			});

			it.each([new Error("remove unavailable"), "remove unavailable"])(
				"keeps a stored mapping when removal fails: %s",
				async (failure) => {
					deleteEntityExternalReferenceMock.mockRejectedValue(failure);
					renderPanel();
					const card = await personCardElement();
					const { input, row } = sourceRow(card, "Wikidata");
					fireEvent.click(row.getByRole("button", { name: "הסר" }));
					expect(await within(card).findByRole("alert")).toHaveTextContent(
						"remove unavailable",
					);
					expect(input).toHaveValue("https://www.wikidata.org/wiki/Q9181");
					expect(
						row.getByRole("link", { name: /פתח Q9181/ }),
					).toBeInTheDocument();
					await waitFor(() =>
						expect(row.getByRole("button", { name: "הסר" })).toBeEnabled(),
					);
				},
			);

			it("keeps another source's draft when a saved refresh returns", async () => {
				const person = (externalReferences: unknown[]) => ({
					linkId: "person-link",
					entityId: "person-entity",
					entityType: "PERSON",
					displayName: "משה",
					person: null,
					place: null,
					externalReferences,
				});
				// First fetch: the saved snapshot. Every later fetch: the
				// committed Wikidata update — the English-Wikipedia row has no
				// stored mapping in either.
				getEntryStructuralContextMock.mockResolvedValue({
					entryId: "entry-1",
					linkedEntities: [
						person([
							{
								source: "WIKIDATA",
								url: "https://www.wikidata.org/wiki/Q42",
							},
						]),
					],
				});
				getEntryStructuralContextMock.mockResolvedValueOnce({
					entryId: "entry-1",
					linkedEntities: [
						person([
							{
								source: "WIKIDATA",
								url: "https://www.wikidata.org/wiki/Q9181",
							},
						]),
					],
				});
				renderPanel();
				const card = await personCardElement();
				const wikidata = sourceRow(card, "Wikidata");
				const wikipediaEn = sourceRow(card, "ויקיפדיה (אנגלית)");

				fireEvent.change(wikipediaEn.input, {
					target: { value: "https://en.wikipedia.org/wiki/Abraham" },
				});
				fireEvent.change(wikidata.input, { target: { value: "Q42" } });
				fireEvent.click(wikidata.row.getByRole("button", { name: "שמור" }));

				await waitFor(() =>
					expect(wikidata.input).toHaveValue(
						"https://www.wikidata.org/wiki/Q42",
					),
				);
				expect(wikipediaEn.input).toHaveValue(
					"https://en.wikipedia.org/wiki/Abraham",
				);
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
	it("edits and clears a saying date", async () => {
		getEntryStructuralContextMock.mockResolvedValue({
			entryId: "entry-1",
			linkedEntities: [
				{
					linkId: "link",
					entityId: "entity",
					entityType: "SAYING",
					displayName: "אמרה",
					saying: { sayingId: "saying-1", sayingDate: 24480906 },
					externalReferences: [],
				},
			],
		});
		renderPanel();
		const input = await screen.findByLabelText("תאריך האמרה");
		expect(input).toHaveValue("24480906");
		fireEvent.change(input, { target: { value: "24480907" } });
		fireEvent.click(screen.getByRole("button", { name: "שמור תאריך אמרה" }));
		await waitFor(() =>
			expect(updateSayingDateMock).toHaveBeenCalledWith({
				data: { sayingId: "saying-1", sayingDate: 24480907 },
			}),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "שמור תאריך אמרה" }),
			).toBeEnabled(),
		);
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.click(screen.getByRole("button", { name: "שמור תאריך אמרה" }));
		await waitFor(() =>
			expect(updateSayingDateMock).toHaveBeenLastCalledWith({
				data: { sayingId: "saying-1", sayingDate: null },
			}),
		);
	});
	it("starts an undated saying empty and preserves input when saving fails", async () => {
		getEntryStructuralContextMock.mockResolvedValue({
			entryId: "entry-1",
			linkedEntities: [
				{
					linkId: "link",
					entityId: "entity",
					entityType: "SAYING",
					displayName: "אמרה",
					saying: { sayingId: "saying-1", sayingDate: null },
					externalReferences: [],
				},
			],
		});
		updateSayingDateMock.mockRejectedValue(new Error("תאריך עברי לא תקין"));
		renderPanel();
		const input = await screen.findByLabelText("תאריך האמרה");
		expect(input).toHaveValue("");
		fireEvent.change(input, { target: { value: "24480931" } });
		fireEvent.click(screen.getByRole("button", { name: "שמור תאריך אמרה" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"תאריך עברי לא תקין",
		);
		expect(input).toHaveValue("24480931");
		expect(
			screen.getByRole("button", { name: "שמור תאריך אמרה" }),
		).toBeEnabled();
	});
});
