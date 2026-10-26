import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
			await screen.findByText(/דף פירושונים — 2 ערכים/),
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
				},
			}),
		);
		expect(
			await screen.findByText(/«משה» מפנה ישירות לערך היעד/),
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
});
