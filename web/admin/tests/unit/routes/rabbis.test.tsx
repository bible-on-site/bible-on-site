import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UndoToastProvider } from "~/components/UndoToast";

const { getAuthors, deleteAuthor, invalidateQueries } = vi.hoisted(() => ({
	getAuthors: vi.fn(),
	deleteAuthor: vi.fn(),
	invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryFn }: { queryFn: () => unknown }) => ({
		data: queryFn(),
		isLoading: false,
	}),
	useQueryClient: () => ({ invalidateQueries }),
	useMutation: ({
		mutationFn,
		onSuccess,
	}: {
		mutationFn: (variables: unknown) => unknown;
		onSuccess?: (result: unknown) => void;
	}) => ({
		mutate: (variables: unknown) => onSuccess?.(mutationFn(variables)),
		isPending: false,
	}),
}));
vi.mock("~/server/authors", () => ({
	getAuthors: () => getAuthors(),
	deleteAuthor: (args: unknown) => deleteAuthor(args),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => ({ options }),
	useMatch: () => false,
	Link: ({
		to,
		params,
		className,
		children,
	}: {
		to: string;
		params?: { id?: string };
		className?: string;
		children: React.ReactNode;
	}) => (
		<a href={`${to.replace("$id", params?.id ?? "")}`} className={className}>
			{children}
		</a>
	),
	Outlet: () => null,
}));

import { Route } from "~/routes/rabbis";

function Page() {
	const Component = Route.options.component;
	if (!Component) throw new Error("Rabbis route component is missing");
	return (
		<UndoToastProvider durationMs={30}>
			<Component />
		</UndoToastProvider>
	);
}

const AUTHOR = {
	id: 7,
	name: "רבנו תם",
	details: "מחבר חידושים",
	imageUrl: null,
};

beforeEach(() => {
	getAuthors.mockReset().mockReturnValue([AUTHOR]);
	deleteAuthor.mockReset().mockReturnValue({ success: true });
	invalidateQueries.mockReset();
});

describe("Rabbis list page", () => {
	it("lists authors with edit and delete actions", async () => {
		render(<Page />);
		expect(
			await screen.findByRole("heading", { name: "ניהול רבנים" }),
		).toBeVisible();
		expect(screen.getByText("רבנו תם")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "מחק" }),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /עריכה/ })).toHaveAttribute(
			"href",
			"/rabbis/7",
		);
	});

	it("delays deletion behind an undo toast, then refreshes the list", async () => {
		render(<Page />);
		fireEvent.click(await screen.findByRole("button", { name: "מחק" }));
		// The click schedules — it must not delete synchronously.
		expect(deleteAuthor).not.toHaveBeenCalled();

		const toast = await screen.findByRole("status");
		expect(toast).toHaveTextContent('הרב "רבנו תם" יימחק');

		await waitFor(() =>
			expect(deleteAuthor).toHaveBeenCalledWith({ data: 7 }),
		);
		await waitFor(() =>
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: ["authors"],
			}),
		);
	});

	it("cancels the pending delete from the toast undo button", async () => {
		render(<Page />);
		fireEvent.click(await screen.findByRole("button", { name: "מחק" }));

		const toast = await screen.findByRole("status");
		fireEvent.click(
			within(toast).getByRole("button", { name: "ביטול" }),
		);
		await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
		expect(deleteAuthor).not.toHaveBeenCalled();
	});
});
