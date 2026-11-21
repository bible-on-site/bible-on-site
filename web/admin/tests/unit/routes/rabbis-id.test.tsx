import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
	navigate: vi.fn(),
	getAuthor: vi.fn(),
	createAuthor: vi.fn(),
	updateAuthor: vi.fn(),
	deleteAuthor: vi.fn(),
	uploadAuthorImage: vi.fn(),
	params: { id: "7" },
}));

vi.mock("~/server/authors", () => ({
	getAuthor: server.getAuthor,
	createAuthor: server.createAuthor,
	updateAuthor: server.updateAuthor,
	deleteAuthor: server.deleteAuthor,
}));
vi.mock("~/server/s3", () => ({
	uploadAuthorImage: server.uploadAuthorImage,
}));
vi.mock("~/components/ImageUpload", () => ({
	ImageUpload: () => <div data-testid="image-upload" />,
}));
vi.mock("~/components/AutoSaveIndicator", () => ({
	AutoSaveIndicator: () => <div data-testid="autosave" />,
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: Record<string, unknown>) => ({
		...config,
		useParams: () => ({ id: server.params.id }),
	}),
	useNavigate: () => server.navigate,
	Link: (props: { children?: React.ReactNode; to?: string }) => (
		<>{props.children}</>
	),
}));

import { Route } from "~/routes/rabbis.$id";

const author = {
	id: 7,
	name: "הרב קוק",
	details: "פרטים",
	imageUrl: "",
};

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { component: Page } = Route as unknown as {
		component: () => React.ReactElement;
	};
	render(
		<QueryClientProvider client={client}>
			<Page />
		</QueryClientProvider>,
	);
}

describe("RabbiEditPage", () => {
	beforeEach(() => {
		server.params.id = "7";
		for (const mock of Object.values(server)) {
			if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
		}
		server.getAuthor.mockResolvedValue(author);
	});

	it("renders the new-rabbi form with the save-first placeholder", async () => {
		server.params.id = "new";
		renderPage();
		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: "רב חדש" }),
			).toBeInTheDocument(),
		);
		expect(screen.getByText("שמור את הרב לפני העלאת תמונה")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "שמור עכשיו" })).toBeDisabled();
		expect(server.getAuthor).not.toHaveBeenCalled();
	});

	it("shows the spinner while a save is in flight", async () => {
		server.updateAuthor.mockReturnValue(new Promise(() => {}));
		renderPage();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "שמור עכשיו" }),
			).toBeEnabled(),
		);

		fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שומר..." })).toBeDisabled(),
		);
	});
});
