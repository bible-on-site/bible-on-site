import { describe, expect, it, vi } from "vitest";

const { listMock } = vi.hoisted(() => ({
	listMock: vi.fn(),
}));

vi.mock("~/server/tanahpedia/entries", () => ({
	listTanahpediaEntriesForAdmin: listMock,
}));

import { searchEntriesForLink } from "~/components/editor/entryLinkSearch";

describe("searchEntriesForLink", () => {
	it("maps entry rows into link options", async () => {
		listMock.mockResolvedValue([
			{ id: "e-1", title: "משה רבנו", unique_name: "moshe" },
		]);

		await expect(searchEntriesForLink("משה")).resolves.toEqual([
			{ id: "e-1", title: "משה רבנו", uniqueName: "moshe" },
		]);
		expect(listMock).toHaveBeenCalledWith({ data: { q: "משה" } });
	});

	it("omits the query when the input is blank", async () => {
		listMock.mockResolvedValue([]);

		await searchEntriesForLink("   ");

		expect(listMock).toHaveBeenCalledWith({ data: { q: undefined } });
	});
});
