import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	getMoed,
	listMoadim,
	upsertMoed,
	deleteMoed,
	invalidateQueries,
	state,
} = vi.hoisted(() => ({
	getMoed: vi.fn(),
	listMoadim: vi.fn(),
	upsertMoed: vi.fn(),
	deleteMoed: vi.fn(),
	invalidateQueries: vi.fn(),
	state: {
		isLoading: false,
		upsertError: null as Error | null,
		deleteError: null as Error | null,
		pending: false,
	},
}));

// The component registers the upsert mutation first and the delete mutation
// second on every render — the call index tells them apart.
let mutationCallIndex = 0;
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryFn }: { queryFn: () => unknown }) => ({
		data: state.isLoading ? undefined : queryFn(),
		isLoading: state.isLoading,
	}),
	useQueryClient: () => ({ invalidateQueries }),
	useMutation: ({
		mutationFn,
		onSuccess,
	}: {
		mutationFn: (variables: unknown) => unknown;
		onSuccess?: (result: unknown) => void;
	}) => {
		const index = mutationCallIndex++;
		return {
			mutate: (variables: unknown) => onSuccess?.(mutationFn(variables)),
			error: index % 2 === 0 ? state.upsertError : state.deleteError,
			isPending: state.pending,
		};
	},
}));
vi.mock("~/server/moadim", () => ({
	listMoadim: (...args: unknown[]) => listMoadim(...args),
	getMoed: (...args: unknown[]) => getMoed(...args),
	upsertMoed: (...args: unknown[]) => upsertMoed(...args),
	deleteMoed: (...args: unknown[]) => deleteMoed(...args),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => ({ options }),
}));

import { Route } from "~/routes/moadim";

function Page() {
	const Component = Route.options.component;
	if (!Component) throw new Error("Moadim route component is missing");
	return <Component />;
}

const MOED = {
	id: 7,
	slug: "פסח",
	name: "פסח",
	annualOrder: 3,
	published: true,
	sectionCount: 1,
	rangeCount: 2,
	articleCount: 4,
	dateLabel: "טו-כב בניסן",
};

const MOED_DETAIL = {
	id: 7,
	slug: "פסח",
	name: "פסח",
	summary: null,
	hebrewMonth: null,
	dateLabel: "טו-כב בניסן",
	annualOrder: 3,
	published: true,
	sections: [
		{
			id: 1,
			label: "תורה",
			position: 1,
			ranges: [
				{
					id: 1,
					position: 1,
					perekIdStart: 470,
					pasukStart: 1,
					perekIdEnd: 470,
					pasukEnd: 10,
				},
			],
		},
	],
};

beforeEach(() => {
	listMoadim.mockReset().mockReturnValue([]);
	getMoed.mockReset();
	upsertMoed.mockReset();
	deleteMoed.mockReset();
	invalidateQueries.mockReset();
	state.isLoading = false;
	state.upsertError = null;
	state.deleteError = null;
	state.pending = false;
	mutationCallIndex = 0;
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("Moadim catalogue page", () => {
	it("renders the catalogue with publication state and counts", () => {
		listMoadim.mockReturnValue([
			MOED,
			{
				...MOED,
				id: 8,
				name: "דין",
				slug: "דין",
				published: false,
				dateLabel: null,
				sectionCount: 2,
				rangeCount: 3,
				articleCount: 6,
			},
		]);
		render(<Page />);
		expect(
			screen.getByRole("heading", { name: "מועדים על הפרק" }),
		).toBeVisible();
		// "פסח" appears twice — the name cell and the slug cell.
		expect(screen.getAllByText("פסח")).toHaveLength(2);
		expect(screen.getByText("— טו-כב בניסן")).toBeInTheDocument();
		expect(screen.getByText("1 / 2")).toBeInTheDocument();
		expect(screen.getByText("2 / 3")).toBeInTheDocument();
		expect(screen.getByText("4")).toBeInTheDocument();
		expect(screen.getByText("6")).toBeInTheDocument();
		expect(screen.getByText("מפורסם")).toBeInTheDocument();
		expect(screen.getByText("טיוטה")).toBeInTheDocument();
	});

	it("shows the loading and missing-schema placeholders", () => {
		state.isLoading = true;
		const { unmount } = render(<Page />);
		expect(screen.getByText("טוען...")).toBeInTheDocument();
		unmount();
		state.isLoading = false;
		listMoadim.mockReturnValue(undefined);
		render(<Page />);
		expect(screen.getByText("סכמת המועדים עוד לא נפרסה")).toBeInTheDocument();
	});

	it("shows the empty-catalogue row", () => {
		render(<Page />);
		expect(screen.getByText("אין מועדים להצגה")).toBeInTheDocument();
	});

	it("surfaces a mutation error", () => {
		listMoadim.mockReturnValue([MOED]);
		state.deleteError = new Error("boom");
		render(<Page />);
		expect(screen.getByText("boom")).toBeInTheDocument();
	});
});

describe("Moed delete", () => {
	it("deletes only after confirmation and refreshes the catalogue", () => {
		listMoadim.mockReturnValue([MOED]);
		render(<Page />);
		vi.spyOn(window, "confirm").mockReturnValue(false);
		fireEvent.click(screen.getByRole("button", { name: "מחק" }));
		expect(deleteMoed).not.toHaveBeenCalled();

		vi.spyOn(window, "confirm").mockReturnValue(true);
		fireEvent.click(screen.getByRole("button", { name: "מחק" }));
		expect(deleteMoed).toHaveBeenCalledWith({ data: 7 });
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["moadim"],
		});
	});
});

describe("Moed form", () => {
	it("opens an empty create form and closes on cancel", () => {
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: "מועד חדש" }));
		expect(
			screen.getByRole("heading", { name: "מועד חדש" }),
		).toBeInTheDocument();
		const submit = screen.getByRole("button", { name: "צור" });
		expect(submit).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
		expect(
			screen.queryByRole("heading", { name: "מועד חדש" }),
		).not.toBeInTheDocument();
	});

	it("creates a moed with the mapped input and closes", () => {
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: "מועד חדש" }));
		fireEvent.change(screen.getByLabelText("שם המועד *"), {
			target: { value: "סוכות" },
		});
		fireEvent.change(screen.getByLabelText(/מיקום במעגל השנתי/), {
			target: { value: "5" },
		});
		fireEvent.change(screen.getByLabelText("חודש עברי"), {
			target: { value: "תשרי" },
		});
		fireEvent.change(screen.getByLabelText("תווית תאריך"), {
			target: { value: "טו-כב בתשרי" },
		});
		fireEvent.change(screen.getByLabelText("תקציר"), {
			target: { value: "חג הסוכות" },
		});
		fireEvent.click(screen.getByLabelText("מפורסם באתר"));
		fireEvent.click(screen.getByRole("button", { name: "צור" }));
		expect(upsertMoed).toHaveBeenCalledWith({
			data: {
				name: "סוכות",
				slug: undefined,
				summary: "חג הסוכות",
				hebrewMonth: "תשרי",
				dateLabel: "טו-כב בתשרי",
				annualOrder: 5,
				published: true,
				sections: [
					{
						label: "",
						ranges: [
							{
								perekIdStart: 1,
								pasukStart: 1,
								perekIdEnd: 1,
								pasukEnd: 1,
							},
						],
					},
				],
			},
		});
		expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["moadim"] });
		expect(screen.queryByRole("heading", { name: "מועד חדש" })).toBeNull();
	});

	it("edits a moed through the detail load and submits the id", async () => {
		listMoadim.mockReturnValue([MOED]);
		getMoed.mockReturnValue(MOED_DETAIL);
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: "ערוך" }));
		expect(
			await screen.findByRole("heading", { name: "עריכת פסח" }),
		).toBeInTheDocument();
		expect(getMoed).toHaveBeenCalledWith({ data: 7 });
		const label = screen.getByDisplayValue("תורה");
		fireEvent.change(label, { target: { value: "הפטרה" } });
		fireEvent.click(screen.getByRole("button", { name: "שמור" }));
		expect(upsertMoed).toHaveBeenCalledWith({
			data: expect.objectContaining({
				id: 7,
				name: "פסח",
				slug: "פסח",
				summary: null,
				sections: [
					{
						label: "הפטרה",
						ranges: [
							{
								id: 1,
								position: 1,
								perekIdStart: 470,
								pasukStart: 1,
								perekIdEnd: 470,
								pasukEnd: 10,
							},
						],
					},
				],
			}),
		});
	});

	it("does nothing when the detail load returns null", async () => {
		listMoadim.mockReturnValue([MOED]);
		getMoed.mockReturnValue(null);
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: "ערוך" }));
		await Promise.resolve();
		expect(screen.queryByRole("heading", { name: /עריכת/ })).toBeNull();
	});

	it("adds and removes sections and ranges", () => {
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: "מועד חדש" }));
		fireEvent.click(screen.getByRole("button", { name: "+ הוסף סעיף" }));
		expect(screen.getAllByPlaceholderText(/תווית הסעיף/)).toHaveLength(2);
		fireEvent.click(screen.getAllByRole("button", { name: "+ טווח" })[0]);
		expect(screen.getAllByText("מפרק")).toHaveLength(3);
		fireEvent.click(screen.getAllByRole("button", { name: "הסר" })[0]);
		expect(screen.getAllByText("מפרק")).toHaveLength(2);
		fireEvent.click(screen.getAllByRole("button", { name: "הסר סעיף" })[0]);
		expect(screen.getAllByPlaceholderText(/תווית הסעיף/)).toHaveLength(1);
	});

	it("edits range coordinates", () => {
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: "מועד חדש" }));
		const rangeRow = screen.getByText("מפרק").parentElement as HTMLElement;
		const ranges = within(rangeRow).getAllByDisplayValue("1");
		fireEvent.change(ranges[0], { target: { value: "100" } });
		fireEvent.change(ranges[1], { target: { value: "5" } });
		fireEvent.change(ranges[2], { target: { value: "102" } });
		fireEvent.change(ranges[3], { target: { value: "7" } });
		fireEvent.change(screen.getByLabelText("שם המועד *"), {
			target: { value: "x" },
		});
		fireEvent.click(screen.getByRole("button", { name: "צור" }));
		expect(upsertMoed).toHaveBeenCalledWith({
			data: expect.objectContaining({
				sections: [
					{
						label: "",
						ranges: [
							{
								perekIdStart: 100,
								pasukStart: 5,
								perekIdEnd: 102,
								pasukEnd: 7,
							},
						],
					},
				],
			}),
		});
	});

	it("edits the slug field", () => {
		render(<Page />);
		fireEvent.click(screen.getByRole("button", { name: "מועד חדש" }));
		fireEvent.change(screen.getByLabelText(/סלאג/), {
			target: { value: "custom-slug" },
		});
		fireEvent.change(screen.getByLabelText("שם המועד *"), {
			target: { value: "x" },
		});
		fireEvent.click(screen.getByRole("button", { name: "צור" }));
		expect(upsertMoed).toHaveBeenCalledWith({
			data: expect.objectContaining({ slug: "custom-slug" }),
		});
	});
});
