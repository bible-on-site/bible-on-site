import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getEntryAliases: vi.fn(),
	checkPediaName: vi.fn(),
	saveEntryAlias: vi.fn(),
	removeEntryFromAlias: vi.fn(),
	deleteAliasName: vi.fn(),
	searchEntriesForLink: vi.fn(),
}));

vi.mock("~/server/tanahpedia/aliases", () => ({
	getEntryAliases: mocks.getEntryAliases,
	checkPediaName: mocks.checkPediaName,
	saveEntryAlias: mocks.saveEntryAlias,
	removeEntryFromAlias: mocks.removeEntryFromAlias,
	deleteAliasName: mocks.deleteAliasName,
}));

vi.mock("~/components/editor/entryLinkSearch", () => ({
	searchEntriesForLink: mocks.searchEntriesForLink,
}));

import { EntryAliasesPanel } from "~/components/tanahpedia/EntryAliasesPanel";

const BASE = "http://localhost:3001";
const SELF = {
	entryId: "e-a",
	uniqueName: "משה-רבנו",
	title: "משה רבנו",
};

function renderPanel() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<EntryAliasesPanel
				entryId={SELF.entryId}
				entryUniqueName={SELF.uniqueName}
				entryTitle={SELF.title}
				websiteBase={BASE}
			/>
		</QueryClientProvider>,
	);
	return client;
}

const singleAlias = {
	name: "משה",
	kind: "alias" as const,
	targets: [{ ...SELF, label: null }],
	shadowedByCanonical: null,
	isSelfMain: false,
	reservedCategory: null,
};

const sharedAlias = {
	name: "משה",
	kind: "disambiguation" as const,
	targets: [
		{ ...SELF, label: "הנביא" },
		{
			entryId: "e-b",
			uniqueName: "משה-החוטם",
			title: "משה החוטם",
			label: "החוטם",
		},
	],
	shadowedByCanonical: null,
	isSelfMain: false,
	reservedCategory: null,
};

describe("EntryAliasesPanel", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.getEntryAliases.mockResolvedValue([]);
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) => ({
				kind: "free",
				name: data.name,
			}),
		);
		vi.spyOn(window, "confirm").mockReturnValue(true);
	});

	it("shows an empty state until names exist", async () => {
		renderPanel();

		expect(
			await screen.findByText("אין כתובות נוספות לערך זה עדיין."),
		).toBeInTheDocument();
	});

	it("shows the empty state when the aliases query fails", async () => {
		mocks.getEntryAliases.mockRejectedValue(new Error("boom"));
		renderPanel();

		expect(
			await screen.findByText("אין כתובות נוספות לערך זה עדיין."),
		).toBeInTheDocument();
	});

	it("marks a single-target name as a redirect and shows its full URL", async () => {
		mocks.getEntryAliases.mockResolvedValue([singleAlias]);
		renderPanel();

		expect(await screen.findByText("הפניה לערך זה")).toBeInTheDocument();
		const link = screen.getByRole("link", {
			name: /localhost:3001\/pedia\//,
		});
		expect(link).toHaveAttribute(
			"href",
			`${BASE}/pedia/${encodeURIComponent("משה")}`,
		);
	});

	it("marks a shared name as a disambiguation page with its targets", async () => {
		mocks.getEntryAliases.mockResolvedValue([sharedAlias]);
		renderPanel();

		expect(
			await screen.findByText(/דף פירושונים - 2 ערכים/),
		).toBeInTheDocument();
		expect(screen.getByText(/משה רבנו/)).toBeInTheDocument();
		expect(screen.getByText(/משה החוטם/)).toBeInTheDocument();
		expect(screen.getByText(/- החוטם/)).toBeInTheDocument();
	});

	it("warns when a name is shadowed by another entry's main URL", async () => {
		mocks.getEntryAliases.mockResolvedValue([
			{
				...singleAlias,
				shadowedByCanonical: {
					entryId: "e-b",
					uniqueName: "משה",
					title: "משה אחר",
				},
			},
		]);
		renderPanel();

		expect(
			await screen.findByText(/מוצלת על ידי הכתובת הראשית של «משה אחר»/),
		).toBeInTheDocument();
	});

	it("opens the editor prefilled with this entry as the target", async () => {
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);

		expect(screen.getByText(/יעד יחיד/)).toBeInTheDocument();
		expect(
			screen.getByLabelText("תווית מבדנת עבור משה רבנו"),
		).toBeInTheDocument();
	});

	it("saves a new single-target alias and reports the redirect result", async () => {
		mocks.saveEntryAlias.mockResolvedValue({
			name: "משה",
			targetCount: 1,
			kind: "alias",
		});
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "שמור כתובת" }));

		await waitFor(() =>
			expect(mocks.saveEntryAlias).toHaveBeenCalledWith({
				data: {
					name: "משה",
					targets: [{ entryId: "e-a", label: "" }],
					expectedTargets: [],
				},
			}),
		);
		expect(
			await screen.findByText(/«משה» מפנה ישירות לערך היעד/),
		).toBeInTheDocument();
	});

	it("warns when the save committed but the website invalidation did not apply", async () => {
		mocks.saveEntryAlias.mockResolvedValue({
			name: "משה",
			targetCount: 1,
			kind: "alias",
			websiteFresh: false,
		});
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "שמור כתובת" }));

		expect(
			await screen.findByText(/«משה» מפנה ישירות לערך היעד/),
		).toBeInTheDocument();
		expect(
			await screen.findByText(/עדכון האתר הציבורי לא הוחל/),
		).toBeInTheDocument();
	});

	it("merges in the existing targets when the typed name is shared", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "alias",
							name: "משה",
							targets: [
								{
									entryId: "e-b",
									uniqueName: "משה-החוטם",
									title: "משה החוטם",
									label: "החוטם",
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		expect(await screen.findByText(/כבר משותף/)).toBeInTheDocument();
		expect(
			await screen.findByLabelText("תווית מבדנת עבור משה החוטם"),
		).toBeInTheDocument();
		expect(
			screen.getByLabelText("תווית מבדנת עבור משה רבנו"),
		).toBeInTheDocument();
	});

	it("blocks saving a shared name without distinguishing labels", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "alias",
							name: "משה",
							targets: [
								{
									entryId: "e-b",
									uniqueName: "משה-החוטם",
									title: "משה החוטם",
									label: "החוטם",
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		// The merged set has this entry unlabelled — a shared name requires it.
		expect(
			await screen.findByText(/לכל ערך נדרשת תווית מבדנת/),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeDisabled();
	});

	it("calls the shared-name save with every target once labelled", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "alias",
							name: "משה",
							targets: [
								{
									entryId: "e-b",
									uniqueName: "משה-החוטם",
									title: "משה החוטם",
									label: "החוטם",
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		mocks.saveEntryAlias.mockResolvedValue({
			name: "משה",
			targetCount: 2,
			kind: "disambiguation",
		});
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		// The merge lands the shared name's other target — wait for it so the
		// save carries the full set, then fill this entry's label.
		await screen.findByLabelText("תווית מבדנת עבור משה החוטם");
		fireEvent.change(screen.getByLabelText("תווית מבדנת עבור משה רבנו"), {
			target: { value: "הנביא" },
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "שמור כתובת" }));

		await waitFor(() =>
			expect(mocks.saveEntryAlias).toHaveBeenCalledWith({
				data: {
					name: "משה",
					targets: [
						{ entryId: "e-b", label: "החוטם" },
						{ entryId: "e-a", label: "הנביא" },
					],
					// The baseline is the target set the check returned.
					expectedTargets: [{ entryId: "e-b", label: "החוטם" }],
				},
			}),
		);
		expect(
			await screen.findByText(/דף פירושונים עם 2 ערכים/),
		).toBeInTheDocument();
	});

	it("confirms and removes this entry's association without touching others", async () => {
		mocks.getEntryAliases.mockResolvedValue([sharedAlias]);
		mocks.removeEntryFromAlias.mockResolvedValue({
			name: "משה",
			remainingTargets: 1,
		});
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "הסר מהערך" }));

		expect(window.confirm).toHaveBeenCalled();
		await waitFor(() =>
			expect(mocks.removeEntryFromAlias).toHaveBeenCalledWith({
				data: { name: "משה", entryId: "e-a" },
			}),
		);
	});

	it("does not remove when the confirmation is declined", async () => {
		mocks.getEntryAliases.mockResolvedValue([sharedAlias]);
		vi.spyOn(window, "confirm").mockReturnValue(false);
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "הסר מהערך" }));

		expect(mocks.removeEntryFromAlias).not.toHaveBeenCalled();
	});

	it("warns that removing the only target deletes the name entirely", async () => {
		mocks.getEntryAliases.mockResolvedValue([singleAlias]);
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		mocks.removeEntryFromAlias.mockResolvedValue({
			name: "משה",
			remainingTargets: 0,
		});
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "הסר מהערך" }));

		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining("תמחק את השם לגמרי"),
		);
		expect(await screen.findByText(/«משה» נמחק לגמרי/)).toBeInTheDocument();
	});

	it("reports a failed removal to the user", async () => {
		mocks.getEntryAliases.mockResolvedValue([singleAlias]);
		mocks.removeEntryFromAlias.mockRejectedValue(new Error("boom"));
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "הסר מהערך" }));

		expect(await screen.findByText(/שגיאת שרת/)).toBeInTheDocument();
	});

	it("keeps the copy label when the clipboard write fails", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("denied"));
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		mocks.getEntryAliases.mockResolvedValue([singleAlias]);
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "העתק" }));

		expect(writeText).toHaveBeenCalled();
		expect(
			await screen.findByRole("button", { name: "העתק" }),
		).toBeInTheDocument();
		expect(screen.queryByText("הועתק!")).not.toBeInTheDocument();
	});

	it("copies the alias URL and reverts the acknowledgement", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		mocks.getEntryAliases.mockResolvedValue([singleAlias]);
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "העתק" }));

		expect(writeText).toHaveBeenCalledWith(
			`${BASE}/pedia/${encodeURIComponent("משה")}`,
		);
		expect(await screen.findByText("הועתק!")).toBeInTheDocument();
		expect(
			await screen.findByText("העתק", {}, { timeout: 3000 }),
		).toBeInTheDocument();
	});

	it("flags names shadowed by the entry's own main URL and reserved routes", async () => {
		mocks.getEntryAliases.mockResolvedValue([
			{ ...singleAlias, name: "משה-רבנו", isSelfMain: true },
			{ ...singleAlias, name: "אישים", reservedCategory: "אישים" },
		]);
		renderPanel();

		expect(
			await screen.findByText("זהה לכתובת הראשית - ללא אפקט"),
		).toBeInTheDocument();
		expect(screen.getByText(/שמור לנתיב הקטגוריה «אישים»/)).toBeInTheDocument();
		expect(screen.getByText("לא נגיש")).toBeInTheDocument();
	});

	it("lists shared targets without a label when none was set", async () => {
		mocks.getEntryAliases.mockResolvedValue([
			{
				...sharedAlias,
				targets: [
					{ ...SELF, label: null },
					{
						entryId: "e-b",
						uniqueName: "משה-החוטם",
						title: "משה החוטם",
						label: "החוטם",
					},
				],
			},
		]);
		renderPanel();

		expect(
			await screen.findByText(/דף פירושונים - 2 ערכים/),
		).toBeInTheDocument();
		expect(screen.getByText(/משה רבנו/)).toBeInTheDocument();
		expect(screen.getByText(/- החוטם/)).toBeInTheDocument();
	});

	it("opens an existing shared name's target set for editing", async () => {
		mocks.getEntryAliases.mockResolvedValue([sharedAlias]);
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "ערוך יעדים" }));

		expect(screen.getByText(/עריכת השם «משה»/)).toBeInTheDocument();
		expect(screen.getByLabelText("תווית מבדנת עבור משה רבנו")).toHaveValue(
			"הנביא",
		);
		expect(screen.getByLabelText("תווית מבדנת עבור משה החוטם")).toHaveValue(
			"החוטם",
		);
		expect(
			screen.getByRole("button", { name: "מחק את השם לחלוטין" }),
		).toBeInTheDocument();
		expect(screen.queryByLabelText("שם / כתובת")).not.toBeInTheDocument();
	});

	it("opens a single-target name for editing with an empty label", async () => {
		mocks.getEntryAliases.mockResolvedValue([singleAlias]);
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "ערוך יעדים" }));

		expect(screen.getByText(/עריכת השם «משה»/)).toBeInTheDocument();
		expect(screen.getByLabelText("תווית מבדנת עבור משה רבנו")).toHaveValue("");
		expect(screen.getByText(/יעד יחיד/)).toBeInTheDocument();
	});

	it("deletes the whole name after confirmation in edit mode", async () => {
		mocks.getEntryAliases.mockResolvedValue([sharedAlias]);
		mocks.deleteAliasName.mockResolvedValue({
			name: "משה",
			removedTargets: 2,
		});
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "ערוך יעדים" }));
		fireEvent.click(screen.getByRole("button", { name: "מחק את השם לחלוטין" }));

		expect(window.confirm).toHaveBeenCalledWith(
			expect.stringContaining("למחוק את השם «משה» לגמרי"),
		);
		await waitFor(() =>
			expect(mocks.deleteAliasName).toHaveBeenCalledWith({
				data: { name: "משה" },
			}),
		);
		expect(
			await screen.findByText(/«משה» נמחק לגמרי \(2 יעדים\)/),
		).toBeInTheDocument();
	});

	it("keeps the name when the full deletion is declined", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(false);
		mocks.getEntryAliases.mockResolvedValue([sharedAlias]);
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "ערוך יעדים" }));
		fireEvent.click(screen.getByRole("button", { name: "מחק את השם לחלוטין" }));

		expect(mocks.deleteAliasName).not.toHaveBeenCalled();
	});

	it("reports a failed full-name deletion", async () => {
		mocks.getEntryAliases.mockResolvedValue([sharedAlias]);
		mocks.deleteAliasName.mockRejectedValue(new Error("boom"));
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "ערוך יעדים" }));
		fireEvent.click(screen.getByRole("button", { name: "מחק את השם לחלוטין" }));

		expect(await screen.findByText(/שגיאת שרת/)).toBeInTheDocument();
	});

	it("reports a failed alias save", async () => {
		mocks.saveEntryAlias.mockRejectedValue(
			new Error("VALIDATION: היעד אינו קיים"),
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "שמור כתובת" }));

		expect(await screen.findByText(/נתונים שגויים/)).toBeInTheDocument();
	});

	it("marks the save as pending while the request is in flight", async () => {
		let resolveSave: (value: unknown) => void = () => {};
		mocks.saveEntryAlias.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSave = resolve;
				}),
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "שמור כתובת" }));

		expect(
			await screen.findByRole("button", { name: "שומר..." }),
		).toBeDisabled();
		await act(async () => {
			resolveSave({ name: "משה", targetCount: 1, kind: "alias" });
		});
	});

	it("closes the editor without saving on cancel", async () => {
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);

		fireEvent.click(screen.getByRole("button", { name: "ביטול" }));

		expect(
			screen.queryByRole("button", { name: "שמור כתובת" }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /הוסף שם חלופי/ }),
		).toBeInTheDocument();
	});

	it("normalizes a pasted URL in the name input on blur", async () => {
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		const input = screen.getByLabelText("שם / כתובת");

		fireEvent.change(input, {
			target: { value: `${BASE}/pedia/%D7%9E%D7%A9%D7%94` },
		});
		fireEvent.blur(input);

		expect(input).toHaveValue("משה");
	});

	it("confirms a free name will become a redirect", async () => {
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		expect(
			await screen.findByText("השם פנוי - ייווצר כהפניה."),
		).toBeInTheDocument();
	});

	it("warns that removing the last target deletes the name", async () => {
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		fireEvent.click(screen.getByRole("button", { name: "הסר יעד" }));

		expect(screen.getByText("אין יעדים - השם יימחק.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeDisabled();
	});

	it("adds another entry through the target picker and marks the name shared", async () => {
		mocks.searchEntriesForLink.mockResolvedValue([
			{ id: "e-b", uniqueName: "משה-החוטם", title: "משה החוטם" },
		]);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.click(screen.getByRole("button", { name: /צרף ערך נוסף כיעד/ }));

		fireEvent.change(screen.getByPlaceholderText("הקלד שם ערך…"), {
			target: { value: "משה" },
		});
		fireEvent.click(await screen.findByRole("button", { name: /משה החוטם/ }));

		expect(
			await screen.findByLabelText("תווית מבדנת עבור משה החוטם"),
		).toBeInTheDocument();
		expect(screen.getByText(/משותף עם ערכים נוספים/)).toBeInTheDocument();
		expect(screen.getByText(/«…» יציג דף פירושונים/)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /צרף ערך נוסף כיעד/ }),
		).toBeInTheDocument();
	});

	it("keeps the existing target set when the same entry is picked again", async () => {
		mocks.searchEntriesForLink.mockResolvedValue([
			{ id: "e-b", uniqueName: "משה-החוטם", title: "משה החוטם" },
		]);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.click(screen.getByRole("button", { name: /צרף ערך נוסף כיעד/ }));
		fireEvent.click(await screen.findByRole("button", { name: /משה החוטם/ }));

		fireEvent.click(screen.getByRole("button", { name: /צרף ערך נוסף כיעד/ }));
		fireEvent.click(await screen.findByRole("button", { name: /משה החוטם/ }));

		expect(screen.getAllByLabelText(/תווית מבדנת עבור/)).toHaveLength(2);
	});

	it("blocks a reserved category name in the editor", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "אישים"
					? { kind: "reserved", name: "אישים", categoryLabel: "אישים" }
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "אישים" },
		});

		expect(
			await screen.findByText(/שמור לנתיב הקטגוריה «אישים» - בחר שם אחר/),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeDisabled();
	});

	it("blocks a name held as another entry's main URL", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "canonical",
							name: "משה",
							entry: {
								id: "e-b",
								uniqueName: "משה",
								title: "משה אחר",
							},
							aliasTargets: [],
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		expect(
			await screen.findByText(/הוא הכתובת הראשית של «משה אחר»/),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeDisabled();
	});

	it("blocks naming an alias after the entry's own main URL", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה-רבנו"
					? {
							kind: "self-main",
							name: "משה-רבנו",
							aliasTargets: [],
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה-רבנו" },
		});

		expect(
			await screen.findByText(/זוהי הכתובת הראשית של הערך/),
		).toBeInTheDocument();
	});

	it("shows the server's invalid-name reason", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "invalid",
							name: "משה",
							reason: "סיבה שרירותית מהשרת",
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		expect(await screen.findByText("סיבה שרירותית מהשרת")).toBeInTheDocument();
	});

	it("clears the merged target set when the typed name changes", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "alias",
							name: "משה",
							targets: [
								{
									entryId: "e-b",
									uniqueName: "משה-החוטם",
									title: "משה החוטם",
									label: "החוטם",
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		const input = screen.getByLabelText("שם / כתובת");
		fireEvent.change(input, { target: { value: "משה" } });
		await screen.findByLabelText("תווית מבדנת עבור משה החוטם");

		// The name keys the target set — typing a different name drops the old
		// name's merged targets so they can never leak into the new save.
		fireEvent.change(input, { target: { value: "אחר" } });

		expect(screen.getAllByLabelText(/תווית מבדנת עבור/)).toHaveLength(1);
		expect(
			screen.queryByLabelText("תווית מבדנת עבור משה החוטם"),
		).not.toBeInTheDocument();
	});

	it("re-merges a shared name freshly after the name was changed and retyped", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "alias",
							name: "משה",
							targets: [
								{
									entryId: "e-b",
									uniqueName: "משה-החוטם",
									title: "משה החוטם",
									label: "החוטם",
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		const input = screen.getByLabelText("שם / כתובת");
		fireEvent.change(input, { target: { value: "משה" } });
		const otherLabel = await screen.findByLabelText(
			"תווית מבדנת עבור משה החוטם",
		);
		fireEvent.change(otherLabel, { target: { value: "ערוך" } });

		// Leaving and returning to the shared name is a fresh merge — the
		// in-flight label edit belonged to the discarded draft.
		fireEvent.change(input, { target: { value: "אחר" } });
		await screen.findByText("השם פנוי - ייווצר כהפניה.");
		fireEvent.change(input, { target: { value: "משה" } });
		await screen.findByText(/כבר משותף/);

		expect(
			await screen.findByLabelText("תווית מבדנת עבור משה החוטם"),
		).toHaveValue("החוטם");
	});

	it("does not re-merge targets when the same name resolves again", async () => {
		let calls = 0;
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "alias",
							name: "משה",
							// A slightly different payload defeats structural sharing so the
							// effect re-runs for the same name.
							targets: [
								{
									entryId: "e-b",
									uniqueName: "משה-החוטם",
									title: "משה החוטם",
									label: calls++ === 0 ? "החוטם" : "החוטם עודכן",
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		const client = renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});
		const otherLabel = await screen.findByLabelText(
			"תווית מבדנת עבור משה החוטם",
		);
		fireEvent.change(otherLabel, { target: { value: "ערוך" } });

		// A refetch resolves the same name again — the merge must not run a
		// second time or it would clobber the in-flight label edit.
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["alias-name-check"] });
		});
		// Flush the passive effect scheduled by the refetched render.
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(mocks.checkPediaName).toHaveBeenCalledTimes(2);
		expect(screen.getByLabelText("תווית מבדנת עבור משה החוטם")).toHaveValue(
			"ערוך",
		);
	});

	it("skips the merge once the typed input moved past the checked name", async () => {
		let resolveCheck: ((value: unknown) => void) | null = null;
		mocks.checkPediaName.mockImplementation(
			({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? new Promise((resolve) => {
							resolveCheck = resolve;
						})
					: Promise.resolve({ kind: "free", name: data.name }),
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});
		await waitFor(() =>
			expect(mocks.checkPediaName).toHaveBeenCalledWith({
				data: { name: "משה", forEntryId: "e-a" },
			}),
		);

		// Type ahead while the «משה» check is still in flight, then let it
		// resolve: the merge updater must see the input no longer matches and
		// leave the targets alone.
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משהא" },
		});
		await act(async () => {
			resolveCheck?.({
				kind: "alias",
				name: "משה",
				targets: [
					{
						entryId: "e-b",
						uniqueName: "משה-החוטם",
						title: "משה החוטם",
						label: "החוטם",
					},
				],
			});
		});
		await screen.findByText(/כבר משותף/);
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(screen.getAllByLabelText(/תווית מבדנת עבור/)).toHaveLength(1);
	});

	it("abandons the merge when the editor closed before it ran", async () => {
		let resolveCheck: ((value: unknown) => void) | null = null;
		mocks.checkPediaName.mockImplementation(
			({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? new Promise((resolve) => {
							resolveCheck = resolve;
						})
					: Promise.resolve({ kind: "free", name: data.name }),
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});
		await waitFor(() =>
			expect(mocks.checkPediaName).toHaveBeenCalledWith({
				data: { name: "משה", forEntryId: "e-a" },
			}),
		);

		// Resolve the check while a cancel is already queued: the editor
		// unmounts in the same commit, so the merge must never apply.
		await act(async () => {
			resolveCheck?.({
				kind: "alias",
				name: "משה",
				targets: [
					{
						entryId: "e-b",
						uniqueName: "משה-החוטם",
						title: "משה החוטם",
						label: "החוטם",
					},
				],
			});
			fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
		});

		expect(
			screen.queryByLabelText("תווית מבדנת עבור משה החוטם"),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /הוסף שם חלופי/ }),
		).toBeInTheDocument();
	});

	it("merges a shared target that has no distinguishing label yet", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "alias",
							name: "משה",
							targets: [
								{
									entryId: "e-b",
									uniqueName: "משה-החוטם",
									title: "משה החוטם",
									label: null,
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		expect(
			await screen.findByLabelText("תווית מבדנת עבור משה החוטם"),
		).toHaveValue("");
	});

	it("lists this entry once when the shared name already targets it", async () => {
		mocks.checkPediaName.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? {
							kind: "alias",
							name: "משה",
							targets: [
								{
									entryId: "e-b",
									uniqueName: "משה-החוטם",
									title: "משה החוטם",
									label: "החוטם",
								},
								{
									entryId: SELF.entryId,
									uniqueName: SELF.uniqueName,
									title: SELF.title,
									label: "הנביא",
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		await screen.findByLabelText("תווית מבדנת עבור משה החוטם");
		expect(screen.getAllByLabelText(/תווית מבדנת עבור/)).toHaveLength(2);
	});

	it("blocks saving until the typed name's check resolves and merges", async () => {
		let resolveCheck: ((value: unknown) => void) | null = null;
		mocks.checkPediaName.mockImplementation(
			({ data }: { data: { name: string } }) =>
				data.name === "משה"
					? new Promise((resolve) => {
							resolveCheck = resolve;
						})
					: Promise.resolve({ kind: "free", name: data.name }),
		);
		mocks.saveEntryAlias.mockResolvedValue({
			name: "משה",
			targetCount: 2,
			kind: "disambiguation",
		});
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		// The check is in flight — a fast click must not replace the shared
		// name with a single-target set before its targets were loaded.
		await waitFor(() =>
			expect(mocks.checkPediaName).toHaveBeenCalledWith({
				data: { name: "משה", forEntryId: "e-a" },
			}),
		);
		expect(screen.getByText("בודק את השם…")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeDisabled();

		await act(async () => {
			resolveCheck?.({
				kind: "alias",
				name: "משה",
				targets: [
					{
						entryId: "e-b",
						uniqueName: "משה-החוטם",
						title: "משה החוטם",
						label: "החוטם",
					},
				],
			});
		});

		// The merged target still needs this entry's label before the spec is
		// valid — the save stays blocked until then, then carries the full set.
		await screen.findByLabelText("תווית מבדנת עבור משה החוטם");
		expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeDisabled();
		fireEvent.change(screen.getByLabelText("תווית מבדנת עבור משה רבנו"), {
			target: { value: "הנביא" },
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "שמור כתובת" }));

		await waitFor(() =>
			expect(mocks.saveEntryAlias).toHaveBeenCalledWith({
				data: {
					name: "משה",
					targets: [
						{ entryId: "e-b", label: "החוטם" },
						{ entryId: "e-a", label: "הנביא" },
					],
					expectedTargets: [{ entryId: "e-b", label: "החוטם" }],
				},
			}),
		);
	});

	it("blocks saving and reports it when the name check fails", async () => {
		mocks.checkPediaName.mockRejectedValue(new Error("network down"));
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});

		expect(
			await screen.findByText(/בדיקת השם נכשלה/),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeDisabled();
	});

	it("shows a conflict message when the name changed since the edit opened", async () => {
		mocks.saveEntryAlias.mockRejectedValue(
			new Error("REVISION_CONFLICT: the name drifted"),
		);
		renderPanel();
		fireEvent.click(
			await screen.findByRole("button", { name: /הוסף שם חלופי/ }),
		);
		fireEvent.change(screen.getByLabelText("שם / כתובת"), {
			target: { value: "משה" },
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "שמור כתובת" }));

		expect(
			await screen.findByText(/שונה על ידי מנהל אחר מאז שהעריכה נפתחה/),
		).toBeInTheDocument();
	});

	it("sends the loaded target set as the baseline when editing a shared name", async () => {
		mocks.getEntryAliases.mockResolvedValue([sharedAlias]);
		mocks.saveEntryAlias.mockResolvedValue({
			name: "משה",
			targetCount: 2,
			kind: "disambiguation",
		});
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "ערוך יעדים" }));
		fireEvent.change(screen.getByLabelText("תווית מבדנת עבור משה החוטם"), {
			target: { value: "החוטם המלך" },
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שמור כתובת" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "שמור כתובת" }));

		await waitFor(() =>
			expect(mocks.saveEntryAlias).toHaveBeenCalledWith({
				data: {
					name: "משה",
					targets: [
						{ entryId: "e-a", label: "הנביא" },
						{ entryId: "e-b", label: "החוטם המלך" },
					],
					expectedTargets: [
						{ entryId: "e-a", label: "הנביא" },
						{ entryId: "e-b", label: "החוטם" },
					],
				},
			}),
		);
	});
});
