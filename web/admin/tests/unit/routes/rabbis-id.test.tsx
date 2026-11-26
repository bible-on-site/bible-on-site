import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
	navigate: vi.fn(),
	getAuthor: vi.fn(),
	createAuthor: vi.fn(),
	updateAuthor: vi.fn(),
	deleteAuthor: vi.fn(),
	uploadAuthorImage: vi.fn(),
	params: { id: "7" },
	imageUpload: null as null | {
		currentImageUrl?: string;
		onUpload: (file: File) => Promise<void>;
		onRemove?: () => void;
	},
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
	ImageUpload: (props: {
		currentImageUrl?: string;
		onUpload: (file: File) => Promise<void>;
		onRemove?: () => void;
	}) => {
		server.imageUpload = props;
		return <div data-testid="image-upload" />;
	},
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

function getImageUploadProps() {
	const props = server.imageUpload;
	if (props === null) throw new Error("ImageUpload props were not captured");
	return props;
}

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
		expect(
			screen
				.getByRole("button", { name: "שומר..." })
				.querySelector(".animate-spin"),
		).toBeInTheDocument();
	});

	it("uploads the picked image and resolves only after the upload finishes", async () => {
		let resolveUpload: (value: unknown) => void = () => undefined;
		server.uploadAuthorImage.mockReturnValue(
			new Promise((resolve) => {
				resolveUpload = resolve;
			}),
		);
		renderPage();
		await waitFor(() => expect(server.imageUpload).not.toBeNull());

		let settled = false;
		const uploadPromise = getImageUploadProps().onUpload(
			new File(["image-bytes"], "portrait.png", { type: "image/png" }),
		).then(() => {
			settled = true;
		});

		await waitFor(() =>
			expect(server.uploadAuthorImage).toHaveBeenCalledWith({
				data: {
					authorId: 7,
					fileName: "portrait.png",
					contentType: "image/png",
					base64Data: expect.any(String),
				},
			}),
		);
		expect(settled).toBe(false);

		resolveUpload({});
		await uploadPromise;
		expect(settled).toBe(true);
	});

	it("propagates image upload failures so ImageUpload can surface them", async () => {
		server.uploadAuthorImage.mockRejectedValue(new Error("s3 offline"));
		renderPage();
		await waitFor(() => expect(server.imageUpload).not.toBeNull());

		await expect(
			getImageUploadProps().onUpload(
				new File(["image-bytes"], "portrait.png", { type: "image/png" }),
			),
		).rejects.toThrow("s3 offline");
	});

	it("deletes the rabbi only after the confirm dialog approves", async () => {
		server.deleteAuthor.mockResolvedValue({});
		renderPage();
		fireEvent.click(await screen.findByRole("button", { name: "מחק רב" }));

		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", {
				name: "ביטול",
			}),
		);
		expect(server.deleteAuthor).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "מחק רב" }));
		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", {
				name: "מחק",
			}),
		);
		await waitFor(() =>
			expect(server.deleteAuthor).toHaveBeenCalledWith({ data: 7 }),
		);
		await waitFor(() =>
			expect(server.navigate).toHaveBeenCalledWith({ to: "/rabbis" }),
		);
	});
});
