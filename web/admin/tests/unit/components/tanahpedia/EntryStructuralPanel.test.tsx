import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEntryStructuralContextMock } = vi.hoisted(() => ({
	getEntryStructuralContextMock: vi.fn(),
}));

vi.mock("~/server/tanahpedia/structural", () => ({
	getEntryStructuralContext: getEntryStructuralContextMock,
	createEntityAndLinkToEntry: vi.fn(),
	updateEntityDisplayName: vi.fn(),
	updatePersonMainName: vi.fn(),
	updatePersonSex: vi.fn(),
	replacePlaceIdentifications: vi.fn(),
	searchEntities: vi.fn().mockResolvedValue([]),
	linkExistingEntityToEntry: vi.fn(),
}));

vi.mock("~/server/tanahpedia/entries", () => ({
	removeEntity: vi.fn(),
}));

import { EntryStructuralPanel } from "~/components/tanahpedia/EntryStructuralPanel";
import { ENTITY_TYPE_LABELS } from "~/lib/tanahpedia/labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "~/lib/tanahpedia/schema-registry";

function renderPanel() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
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
});
