import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchEntitiesMock, linkExistingEntityToEntryMock } = vi.hoisted(
	() => ({
		searchEntitiesMock: vi.fn(),
		linkExistingEntityToEntryMock: vi.fn(),
	}),
);

vi.mock("~/server/tanahpedia/structural", () => ({
	searchEntities: searchEntitiesMock,
	linkExistingEntityToEntry: linkExistingEntityToEntryMock,
}));

import { ExistingEntityPicker } from "~/components/tanahpedia/ExistingEntityPicker";

function renderPicker(onLinked = vi.fn()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<ExistingEntityPicker
				entryId="entry-1"
				entityType="PERSON"
				onLinked={onLinked}
			/>
		</QueryClientProvider>,
	);
	return { onLinked };
}

describe("ExistingEntityPicker", () => {
	beforeEach(() => {
		searchEntitiesMock.mockReset().mockResolvedValue([
			{ entityId: "e1", entityType: "PERSON", name: "משה" },
			{ entityId: "e2", entityType: "PLACE", name: "חברון" },
		]);
		linkExistingEntityToEntryMock.mockReset().mockResolvedValue({
			linkId: "link-1",
		});
	});

	describe("when it mounts", () => {
		it("lists the entities the search returned", async () => {
			renderPicker();
			expect(await screen.findByText("משה")).toBeInTheDocument();
			expect(screen.getByText("חברון")).toBeInTheDocument();
		});

		it("scopes the search to the selected entity type", async () => {
			renderPicker();
			await waitFor(() =>
				expect(searchEntitiesMock).toHaveBeenCalledWith({
					data: { entryId: "entry-1", query: "", entityType: "PERSON" },
				}),
			);
		});
	});

	describe("when the user types", () => {
		it("searches for the typed text", async () => {
			renderPicker();
			fireEvent.change(screen.getByRole("searchbox"), {
				target: { value: "מש" },
			});
			await waitFor(() =>
				expect(searchEntitiesMock).toHaveBeenCalledWith({
					data: { entryId: "entry-1", query: "מש", entityType: "PERSON" },
				}),
			);
		});
	});

	describe("when an entity is linked", () => {
		it("links it and notifies the parent", async () => {
			const { onLinked } = renderPicker();
			await screen.findByText("משה");

			fireEvent.click(screen.getAllByRole("button", { name: "קשר" })[0]);

			await waitFor(() =>
				expect(linkExistingEntityToEntryMock).toHaveBeenCalledWith({
					data: { entryId: "entry-1", entityId: "e1" },
				}),
			);
			await waitFor(() => expect(onLinked).toHaveBeenCalled());
		});
	});

	describe("when nothing matches", () => {
		it("says so", async () => {
			searchEntitiesMock.mockResolvedValue([]);
			renderPicker();
			expect(
				await screen.findByText("לא נמצאו יישויות מתאימות."),
			).toBeInTheDocument();
		});
	});

	describe("when the search fails", () => {
		it("shows an error", async () => {
			searchEntitiesMock.mockRejectedValue(new Error("boom"));
			renderPicker();
			expect(
				await screen.findByText("חיפוש היישויות נכשל."),
			).toBeInTheDocument();
		});
	});
});
