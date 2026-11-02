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
import type { AdminDedication } from "~/server/dedications";

const server = vi.hoisted(() => ({
	listDedications: vi.fn(),
	getDedicationTypes: vi.fn(),
	getDedicationTargetOptions: vi.fn(),
	createDedication: vi.fn(),
	updateDedication: vi.fn(),
	deleteDedication: vi.fn(),
}));

vi.mock("~/server/dedications", () => server);
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: { component: unknown }) => config,
}));

import { Route } from "~/routes/dedications";

const types = [
	{ id: 4, description: "לעילוי נשמת" },
	{ id: 9, description: "לרפואה" },
	{ id: 11, description: " " },
];
const options = {
	sefarim: [
		{ id: 1, name: "בראשית" },
		{ id: 2, name: "שמות" },
	],
	heleks: [
		{ id: 1, name: "תורה" },
		{ id: 2, name: "נביאים" },
	],
	parashaCount: 54,
};

const dedication = (patch: Partial<AdminDedication> = {}): AdminDedication => ({
	id: 7,
	subject: "שרה",
	expiresAt: null,
	expired: false,
	purposes: ["לעילוי נשמת"],
	purposeTypeIds: [4],
	targets: [{ kind: "sefer", label: "בראשית", seferId: 1, expiresAt: null }],
	...patch,
});

const clients: QueryClient[] = [];
function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	clients.push(client);
	const { component: Page } = Route as unknown as {
		component: () => React.ReactElement;
	};
	render(
		<QueryClientProvider client={client}>
			<Page />
		</QueryClientProvider>,
	);
	return client;
}

async function newForm() {
	renderPage();
	await screen.findByText("לעילוי נשמת שרה");
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "ערוך" })).toBeEnabled(),
	);
	fireEvent.click(screen.getByRole("button", { name: "הקדשה חדשה" }));
	return screen.getByLabelText("מוקדש ל");
}

function targetRows() {
	return screen
		.queryAllByRole("button", { name: "הסר" })
		.map((button) => within(button.parentElement as HTMLElement));
}

function addTarget(kind: string) {
	fireEvent.click(screen.getByRole("button", { name: "+ הוסף יעד" }));
	const row = targetRows().at(-1);
	if (!row) throw new Error("target row missing");
	fireEvent.change(row.getAllByRole("combobox")[0], {
		target: { value: kind },
	});
	return row;
}

describe("DedicationsPage", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		server.listDedications.mockResolvedValue([dedication()]);
		server.getDedicationTypes.mockResolvedValue(types);
		server.getDedicationTargetOptions.mockResolvedValue(options);
		server.createDedication.mockResolvedValue({ id: 8 });
		server.updateDedication.mockResolvedValue({ id: 7 });
		server.deleteDedication.mockResolvedValue({ ok: true });
	});

	afterEach(() => {
		for (const client of clients.splice(0)) client.clear();
		vi.restoreAllMocks();
	});

	it("shows loading and empty states and sends the search and status filters", async () => {
		let resolveList: (rows: AdminDedication[]) => void = () => undefined;
		server.listDedications.mockImplementationOnce(
			() =>
				new Promise<AdminDedication[]>((resolve) => {
					resolveList = resolve;
				}),
		);
		server.listDedications.mockResolvedValue([]);
		renderPage();
		expect(screen.getByText("טוען...")).toBeInTheDocument();
		await act(async () => resolveList([]));
		expect(await screen.findByText("אין הקדשות להצגה")).toBeInTheDocument();
		fireEvent.change(screen.getByPlaceholderText("חיפוש לפי שם המוקדש..."), {
			target: { value: "שרה" },
		});
		await waitFor(() =>
			expect(server.listDedications).toHaveBeenCalledWith({
				data: { search: "שרה", show: "active" },
			}),
		);
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "expired" },
		});
		await waitFor(() =>
			expect(server.listDedications).toHaveBeenCalledWith({
				data: { search: "שרה", show: "expired" },
			}),
		);
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "all" },
		});
		await waitFor(() =>
			expect(server.listDedications).toHaveBeenCalledWith({
				data: { search: "שרה", show: "all" },
			}),
		);
	});

	it("renders ongoing and expired dedications including assignment expiry", async () => {
		server.listDedications.mockResolvedValue([
			dedication(),
			dedication({
				id: 8,
				subject: "דוד",
				purposes: ["", " "],
				purposeTypeIds: [],
				expired: true,
				expiresAt: "2026-01-01 00:00:00",
				targets: [
					{ kind: "masora", label: "הכול", expiresAt: "2025-12-01 12:00:00" },
				],
			}),
		]);
		renderPage();
		expect(
			await screen.findByText("לעילוי נשמת שרה"),
		).toBeInTheDocument();
		expect(screen.getByText("מתמשך")).toBeInTheDocument();
		const expiredRow = screen.getByText("דוד").closest("tr");
		expect(expiredRow).toHaveClass("opacity-60");
		expect(
			within(expiredRow as HTMLElement).getByText("2026-01-01 00:00:00 (פג)"),
		).toBeInTheDocument();
		expect(
			screen.getByText("מסורה על הפרק: הכול (עד 2025-12-01 12:00:00 UTC)"),
		).toBeInTheDocument();
	});

	it("keeps editing disabled until purpose types arrive and preserves stored purpose ids", async () => {
		let resolveTypes: (value: typeof types) => void = () => undefined;
		server.getDedicationTypes.mockReturnValue(
			new Promise<typeof types>((resolve) => {
				resolveTypes = resolve;
			}),
		);
		renderPage();
		const edit = await screen.findByRole("button", { name: "ערוך" });
		expect(edit).toBeDisabled();
		expect(edit).toHaveAttribute("title", "טוען מטרות...");
		await act(async () => resolveTypes(types));
		await waitFor(() => expect(edit).toBeEnabled());
		fireEvent.click(edit);
		expect(screen.getByRole("checkbox", { name: "לעילוי נשמת" })).toBeChecked();
		expect(screen.getByRole("checkbox", { name: "לרפואה" })).not.toBeChecked();
		fireEvent.click(screen.getByRole("button", { name: "שמור" }));
		await waitFor(() =>
			expect(server.updateDedication).toHaveBeenCalledWith({
				data: expect.objectContaining({ id: 7, purposeTypeIds: [4] }),
			}),
		);
	});

	it("creates a dedication with purposes, UTC expiry and a perek range then refreshes the list", async () => {
		const client = renderPage();
		await screen.findByText("לעילוי נשמת שרה");
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "ערוך" })).toBeEnabled(),
		);
		const invalidate = vi.spyOn(client, "invalidateQueries");
		fireEvent.click(screen.getByRole("button", { name: "הקדשה חדשה" }));
		expect(screen.getByText("...")).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("מוקדש ל"), {
			target: { value: "רחל" },
		});
		fireEvent.click(screen.getByRole("checkbox", { name: "לעילוי נשמת" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "לרפואה" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "לעילוי נשמת" }));
		expect(screen.getByText("לרפואת רחל")).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("תוקף ההקדשה (UTC, ריק = מתמשך)"), {
			target: { value: "2027-02-03T04:05" },
		});
		const row = addTarget("perek");
		fireEvent.change(row.getByPlaceholderText("מפרק"), {
			target: { value: "17" },
		});
		fireEvent.change(row.getByPlaceholderText("עד פרק"), {
			target: { value: "22" },
		});
		fireEvent.change(row.getByLabelText("תוקף יעד (UTC):"), {
			target: { value: "2027-01-01T00:00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "צור" }));
		await waitFor(() =>
			expect(server.createDedication).toHaveBeenCalledWith({
				data: {
					subject: "רחל",
					purposeTypeIds: [9],
					expiresAt: "2027-02-03 04:05:00",
					targets: [
						{
							kind: "perek",
							perekIdLow: 17,
							perekIdHigh: 22,
							expiresAt: "2027-01-01 00:00:00",
						},
					],
				},
			}),
		);
		await waitFor(() =>
			expect(screen.queryByLabelText("מוקדש ל")).not.toBeInTheDocument(),
		);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dedications"] });
	});

	it("submits every target identity, removes rows and clears assignment expiry", async () => {
		await newForm();
		fireEvent.change(screen.getByLabelText("מוקדש ל"), {
			target: { value: "יעקב" },
		});
		const sefer = addTarget("sefer");
		fireEvent.change(sefer.getAllByRole("combobox")[1], {
			target: { value: "2" },
		});
		const helek = addTarget("helek");
		fireEvent.change(helek.getAllByRole("combobox")[1], {
			target: { value: "2" },
		});
		const parasha = addTarget("parasha");
		expect(parasha.getByPlaceholderText("1-54")).toHaveAttribute("max", "54");
		fireEvent.change(parasha.getByPlaceholderText("1-54"), {
			target: { value: "12" },
		});
		const article = addTarget("article");
		fireEvent.change(article.getByPlaceholderText("מזהה מאמר"), {
			target: { value: "42" },
		});
		const entry = addTarget("entry");
		fireEvent.change(entry.getByPlaceholderText("מזהה ערך קנוני"), {
			target: { value: "entry-moses" },
		});
		const masora = addTarget("masora");
		expect(masora.getByText("כל יחידות המסורה")).toBeInTheDocument();
		fireEvent.change(masora.getByLabelText("תוקף יעד (UTC):"), {
			target: { value: "2027-01-01T00:00" },
		});
		fireEvent.change(masora.getByLabelText("תוקף יעד (UTC):"), {
			target: { value: "" },
		});
		const removed = addTarget("entry");
		fireEvent.change(removed.getByPlaceholderText("מזהה ערך קנוני"), {
			target: { value: "remove-me" },
		});
		fireEvent.click(removed.getByRole("button", { name: "הסר" }));
		fireEvent.click(screen.getByRole("button", { name: "צור" }));
		await waitFor(() =>
			expect(server.createDedication).toHaveBeenCalledWith({
				data: {
					subject: "יעקב",
					purposeTypeIds: [],
					expiresAt: null,
					targets: [
						{ kind: "sefer", seferId: 2 },
						{ kind: "helek", helekId: 2 },
						{ kind: "parasha", parashaId: 12 },
						{ kind: "article", articleId: 42 },
						{ kind: "entry", entryId: "entry-moses" },
						{ kind: "masora", expiresAt: null },
					],
				},
			}),
		);
	});

	it("restores all raw target ids and expiries when editing without deriving them from labels", async () => {
		const targets: AdminDedication["targets"] = [
			{
				kind: "perek",
				label: "range label",
				perekIdLow: 4,
				perekIdHigh: 9,
				expiresAt: "2027-05-06 07:08:00",
			},
			{ kind: "sefer", label: "book label", seferId: 2, expiresAt: null },
			{ kind: "helek", label: "section label", helekId: 2, expiresAt: null },
			{ kind: "parasha", label: "weekly label", parashaId: 3, expiresAt: null },
			{
				kind: "article",
				label: "article label",
				articleId: 15,
				expiresAt: null,
			},
			{
				kind: "entry",
				label: "entry label",
				entryId: "entry-1",
				expiresAt: null,
			},
			{ kind: "masora", label: "masora label", expiresAt: null },
		];
		server.listDedications.mockResolvedValue([
			dedication({ targets, expiresAt: "2027-01-02 03:04:00" }),
		]);
		renderPage();
		const edit = await screen.findByRole("button", { name: "ערוך" });
		await waitFor(() => expect(edit).toBeEnabled());
		fireEvent.click(edit);
		expect(
			screen.getByRole("heading", { name: "עריכת הקדשה #7" }),
		).toBeInTheDocument();
		expect(screen.getByLabelText("תוקף ההקדשה (UTC, ריק = מתמשך)")).toHaveValue(
			"2027-01-02T03:04",
		);
		expect(targetRows()[0].getByLabelText("תוקף יעד (UTC):")).toHaveValue(
			"2027-05-06T07:08",
		);
		fireEvent.change(screen.getByLabelText("תוקף ההקדשה (UTC, ריק = מתמשך)"), {
			target: { value: "" },
		});
		fireEvent.click(screen.getByRole("button", { name: "שמור" }));
		await waitFor(() =>
			expect(server.updateDedication).toHaveBeenCalledWith({
				data: {
					id: 7,
					subject: "שרה",
					purposeTypeIds: [4],
					expiresAt: null,
					targets: targets.map(({ label: _label, ...target }) => target),
				},
			}),
		);
	});

	it("cancels an editor without saving", async () => {
		await newForm();
		fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
		expect(screen.queryByLabelText("מוקדש ל")).not.toBeInTheDocument();
		expect(server.createDedication).not.toHaveBeenCalled();
		expect(server.updateDedication).not.toHaveBeenCalled();
	});

	it("stores the displayed default helek when its selector is left unchanged", async () => {
		await newForm();
		fireEvent.change(screen.getByLabelText("מוקדש ל"), { target: { value: "רחל" } });
		const row = addTarget("helek");
		expect(row.getAllByRole("combobox")[1]).toHaveValue("1");
		fireEvent.click(screen.getByRole("button", { name: "צור" }));
		await waitFor(() =>
			expect(server.createDedication).toHaveBeenCalledWith({
				data: expect.objectContaining({
					targets: [{ kind: "helek", helekId: 1 }],
				}),
			}),
		);
	});

	it("disables save while pending, retains the form on failure and displays the create error", async () => {
		let rejectCreate: (error: Error) => void = () => undefined;
		server.createDedication.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectCreate = reject;
			}),
		);
		await newForm();
		fireEvent.change(screen.getByLabelText("מוקדש ל"), {
			target: { value: "רחל" },
		});
		fireEvent.click(screen.getByRole("button", { name: "צור" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "צור" })).toBeDisabled(),
		);
		await act(async () => rejectCreate(new Error("Creation failed")));
		expect(await screen.findByText("Creation failed")).toBeInTheDocument();
		expect(screen.getByLabelText("מוקדש ל")).toHaveValue("רחל");
		expect(screen.getByRole("button", { name: "צור" })).toBeEnabled();
	});

	it("displays update failures without closing the editor", async () => {
		server.updateDedication.mockRejectedValue(new Error("Update failed"));
		renderPage();
		const edit = await screen.findByRole("button", { name: "ערוך" });
		await waitFor(() => expect(edit).toBeEnabled());
		fireEvent.click(edit);
		fireEvent.click(screen.getByRole("button", { name: "שמור" }));
		expect(await screen.findByText("Update failed")).toBeInTheDocument();
		expect(screen.getByLabelText("מוקדש ל")).toHaveValue("שרה");
	});

	it("requires confirmation before deleting, then refreshes the list", async () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
		const client = renderPage();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const remove = await screen.findByRole("button", { name: "מחק" });
		fireEvent.click(remove);
		expect(confirm).toHaveBeenCalledWith('למחוק את ההקדשה "שרה"?');
		expect(server.deleteDedication).not.toHaveBeenCalled();
		confirm.mockReturnValue(true);
		fireEvent.click(remove);
		await waitFor(() =>
			expect(server.deleteDedication).toHaveBeenCalledWith({ data: 7 }),
		);
		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dedications"] }),
		);
	});

	it("displays delete errors and leaves the row available", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
		server.deleteDedication.mockRejectedValue(new Error("Delete failed"));
		renderPage();
		fireEvent.click(await screen.findByRole("button", { name: "מחק" }));
		expect(await screen.findByText("Delete failed")).toBeInTheDocument();
		expect(screen.getByText("לעילוי נשמת שרה")).toBeInTheDocument();
	});
});
